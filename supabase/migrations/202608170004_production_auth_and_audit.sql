begin;

alter table public.profiles add column if not exists login_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_login_id_format'
  ) then
    alter table public.profiles
      add constraint profiles_login_id_format
      check (login_id is null or login_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$');
  end if;
end $$;

create unique index if not exists profiles_login_id_unique
  on public.profiles(lower(login_id)) where login_id is not null;

create or replace function public.is_launch_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id
    where p.id = auth.uid()
      and p.is_active
      and r.code in ('super_admin', 'admin')
  );
$$;

-- During the first production release, every permission is additionally gated
-- to an active administrator. A later reviewed migration can relax this gate.
create or replace function public.has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_launch_administrator() and exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.id = auth.uid()
      and p.is_active
      and perm.code = required_permission
  );
$$;

revoke all on function public.is_launch_administrator() from public, anon;
grant execute on function public.is_launch_administrator() to authenticated;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

drop policy if exists notifications_own on public.notifications;
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_admin_own on public.notifications for select
  using (public.is_launch_administrator() and recipient_id = auth.uid());
create policy notifications_admin_own_update on public.notifications for update
  using (public.is_launch_administrator() and recipient_id = auth.uid())
  with check (public.is_launch_administrator() and recipient_id = auth.uid());

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_values jsonb,
  p_new_values jsonb,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_audit_id bigint;
begin
  if current_user_id is null or not public.is_launch_administrator() then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;
  if p_action is null or p_action !~ '^[a-z0-9_.:-]{3,100}$' then
    raise exception 'Invalid audit action.' using errcode = '22023';
  end if;
  if p_entity_type is null or p_entity_type !~ '^[a-z0-9_.:-]{2,100}$' then
    raise exception 'Invalid audit entity type.' using errcode = '22023';
  end if;
  if p_reason is not null and length(p_reason) > 1000 then
    raise exception 'Audit reason is too long.' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_old_values, '{}'::jsonb)::text) > 1048576
    or octet_length(coalesce(p_new_values, '{}'::jsonb)::text) > 1048576
  then
    raise exception 'Audit payload is too large.' using errcode = '22023';
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_values, new_values, reason)
  values (current_user_id, p_action, p_entity_type, p_entity_id, p_old_values, p_new_values, p_reason)
  returning id into created_audit_id;
  return created_audit_id;
end;
$$;

revoke all on function private.write_audit_log(text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function private.write_audit_log(text, text, uuid, jsonb, jsonb, text) to authenticated;

create or replace function private.bootstrap_first_administrator(
  p_user_id uuid,
  p_full_name text,
  p_login_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text;
  normalized_login_id text := upper(trim(p_login_id));
  super_admin_role_id uuid;
begin
  -- Serialize this one-time operation so two SQL editor sessions cannot both
  -- pass the empty-administrator check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rasa.bootstrap_first_administrator', 0));

  if exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.code in ('super_admin', 'admin')
  ) then
    raise exception 'An administrator is already configured.' using errcode = '23505';
  end if;
  if nullif(trim(p_full_name), '') is null then
    raise exception 'Administrator name is required.' using errcode = '22023';
  end if;
  if normalized_login_id !~ '^[A-Z0-9][A-Z0-9_-]{2,63}$' then
    raise exception 'Staff ID must contain 3-64 letters, numbers, underscores or hyphens.' using errcode = '22023';
  end if;

  select lower(email) into user_email from auth.users where id = p_user_id;
  if user_email is null then
    raise exception 'Create or invite the Supabase Auth user before bootstrapping the administrator.' using errcode = 'P0002';
  end if;
  select id into super_admin_role_id from public.roles where code = 'super_admin';
  if super_admin_role_id is null then
    raise exception 'The super administrator role is missing.' using errcode = 'P0002';
  end if;

  insert into public.profiles(id, full_name, email, login_id, is_active)
  values (p_user_id, trim(p_full_name), user_email, normalized_login_id, true)
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    login_id = excluded.login_id,
    is_active = true,
    updated_at = now();

  insert into public.user_roles(user_id, role_id, created_by)
  values (p_user_id, super_admin_role_id, p_user_id)
  on conflict (user_id, role_id) do nothing;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
  values (
    null,
    'system.first_administrator_bootstrapped',
    'profile',
    p_user_id,
    jsonb_build_object('login_id', normalized_login_id, 'role', 'super_admin')
  );
end;
$$;

-- This bootstrap is intentionally callable only by the database owner from the
-- Supabase SQL editor after the Auth user has been created or invited.
revoke all on function private.bootstrap_first_administrator(uuid, text, text) from public, anon, authenticated, service_role;

create or replace function public.create_student_record(
  p_full_name text,
  p_email text,
  p_contact_number text,
  p_course_code text,
  p_joining_date date,
  p_tentative_completion_date date,
  p_total_course_fee numeric,
  p_initial_payment numeric
)
returns table (
  created_student_id uuid,
  created_student_code text,
  created_registration_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  selected_course public.courses%rowtype;
  new_student public.students%rowtype;
  new_enrollment_id uuid;
  new_fee_account_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_launch_administrator()
    or not public.has_permission('students.create')
    or not public.has_permission('students.update')
  then
    raise exception 'You do not have permission to create student enrollments.' using errcode = '42501';
  end if;
  if not public.has_permission('courses.view') then
    raise exception 'You do not have permission to use the course catalogue.' using errcode = '42501';
  end if;
  if not public.has_permission('fees.manage') then
    raise exception 'You do not have permission to create fee accounts.' using errcode = '42501';
  end if;
  if nullif(trim(p_full_name), '') is null then
    raise exception 'Student name is required.' using errcode = '22023';
  end if;
  if nullif(trim(p_email), '') is null and nullif(trim(p_contact_number), '') is null then
    raise exception 'An email address or contact number is required.' using errcode = '22023';
  end if;
  if p_joining_date is null or p_tentative_completion_date is null then
    raise exception 'Joining and completion dates are required.' using errcode = '22023';
  end if;
  if p_tentative_completion_date < p_joining_date then
    raise exception 'Completion date cannot be before the joining date.' using errcode = '22023';
  end if;
  if p_total_course_fee is null or p_initial_payment is null
    or p_total_course_fee < 0 or p_initial_payment < 0 or p_initial_payment > p_total_course_fee
  then
    raise exception 'Initial payment must be between zero and the total course fee.' using errcode = '22023';
  end if;
  if p_total_course_fee > 9999999999.99 then
    raise exception 'Total course fee exceeds the supported amount.' using errcode = '22003';
  end if;

  select * into selected_course
  from public.courses
  where course_code = p_course_code and is_active
  limit 1;
  if not found then
    raise exception 'The selected course is not available.' using errcode = '22023';
  end if;

  insert into public.students (
    full_name, email, contact_number, owner_user_id, lifecycle_status, notes, created_by, updated_by
  ) values (
    trim(p_full_name), nullif(lower(trim(p_email)), ''), nullif(trim(p_contact_number), ''), current_user_id,
    'Registered', 'Created from the RASA operations workspace.', current_user_id, current_user_id
  ) returning * into new_student;

  insert into public.enrollments (
    student_id, course_id, joining_date, tentative_completion_date, course_status,
    course_name_snapshot, course_code_snapshot, standard_fee_snapshot, created_by, updated_by
  ) values (
    new_student.id, selected_course.id, p_joining_date, p_tentative_completion_date, 'Not Started',
    selected_course.name, selected_course.course_code, p_total_course_fee, current_user_id, current_user_id
  ) returning id into new_enrollment_id;

  insert into public.fee_accounts (enrollment_id, total_course_fee, created_by, updated_by)
  values (new_enrollment_id, p_total_course_fee, current_user_id, current_user_id)
  returning id into new_fee_account_id;

  insert into public.learning_platform_accounts (enrollment_id)
  values (new_enrollment_id);

  if p_initial_payment > 0 then
    insert into public.payments (
      fee_account_id, payment_date, amount, payment_method, transaction_reference, remarks, recorded_by
    ) values (
      new_fee_account_id, current_date, p_initial_payment, 'Initial payment', null,
      'Recorded during student registration.', current_user_id
    );

    insert into public.timeline_events (
      student_id, enrollment_id, event_type, title, detail, metadata, actor_id
    ) values (
      new_student.id, new_enrollment_id, 'payment_recorded', 'Initial payment recorded',
      'Recorded during student registration.', jsonb_build_object('amount', p_initial_payment, 'payment_date', current_date), current_user_id
    );
  end if;

  insert into public.timeline_events (
    student_id, enrollment_id, event_type, title, detail, actor_id, occurred_at
  ) values (
    new_student.id, new_enrollment_id, 'student_registered', 'Student registered', selected_course.name,
    current_user_id, new_student.created_at
  );

  perform private.write_audit_log(
    'student.created',
    'student',
    new_student.id,
    null,
    jsonb_build_object(
      'student_code', new_student.student_code,
      'enrollment_id', new_enrollment_id,
      'course_code', selected_course.course_code,
      'total_course_fee', p_total_course_fee,
      'initial_payment', p_initial_payment
    ),
    null
  );

  return query select new_student.id, new_student.student_code, new_student.registration_date;
end;
$$;

create or replace function public.record_student_payment(
  p_student_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_method text,
  p_transaction_reference text,
  p_remarks text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  selected_enrollment_id uuid;
  selected_fee_account_id uuid;
  selected_fee_total numeric;
  pending_amount numeric;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_launch_administrator() or not public.has_permission('fees.manage') then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;
  if p_payment_date is null then
    raise exception 'Payment date is required.' using errcode = '22023';
  end if;
  if nullif(trim(p_payment_method), '') is null then
    raise exception 'Payment method is required.' using errcode = '22023';
  end if;

  select e.id, fa.id, fa.total_course_fee - fa.discount_amount + fa.adjustment_amount
  into selected_enrollment_id, selected_fee_account_id, selected_fee_total
  from public.enrollments e
  join public.fee_accounts fa on fa.enrollment_id = e.id
  where e.student_id = p_student_id and e.archived_at is null
  order by e.created_at desc
  limit 1
  for update of fa;

  if selected_fee_account_id is null then
    raise exception 'No active fee account was found for this student.' using errcode = 'P0002';
  end if;

  pending_amount := selected_fee_total
    - coalesce((select sum(p.amount) from public.payments p where p.fee_account_id = selected_fee_account_id and p.status = 'Posted'), 0);
  if pending_amount <= 0 then
    raise exception 'This fee account is already paid in full.' using errcode = '22023';
  end if;
  if p_amount > pending_amount then
    raise exception 'Payment amount cannot exceed the outstanding balance.' using errcode = '22023';
  end if;

  insert into public.payments (
    fee_account_id, payment_date, amount, payment_method, transaction_reference, remarks, recorded_by
  ) values (
    selected_fee_account_id, p_payment_date, p_amount, trim(p_payment_method),
    nullif(trim(p_transaction_reference), ''), nullif(trim(p_remarks), ''), current_user_id
  );

  insert into public.timeline_events (
    student_id, enrollment_id, event_type, title, detail, metadata, actor_id
  ) values (
    p_student_id, selected_enrollment_id, 'payment_recorded', 'Payment recorded',
    trim(p_payment_method), jsonb_build_object('amount', p_amount, 'payment_date', p_payment_date), current_user_id
  );

  perform private.write_audit_log(
    'student.payment_recorded',
    'student',
    p_student_id,
    null,
    jsonb_build_object(
      'fee_account_id', selected_fee_account_id,
      'amount', p_amount,
      'payment_date', p_payment_date,
      'payment_method', trim(p_payment_method),
      'remaining_balance', pending_amount - p_amount
    ),
    null
  );

  return pending_amount - p_amount;
end;
$$;

revoke all on function public.create_student_record(text, text, text, text, date, date, numeric, numeric) from public, anon;
grant execute on function public.create_student_record(text, text, text, text, date, date, numeric, numeric) to authenticated;
revoke all on function public.record_student_payment(uuid, date, numeric, text, text, text) from public, anon;
grant execute on function public.record_student_payment(uuid, date, numeric, text, text, text) to authenticated;

-- Aggregate lifecycle writes must use the validated, transactional RPCs above
-- (or the reviewed lifecycle editor in the following migration). Keeping raw
-- table DML unavailable prevents orphan enrollments and payment over-posting.
revoke insert, update, delete on table
  public.students,
  public.enrollments,
  public.fee_accounts,
  public.payments,
  public.payment_schedules,
  public.learning_platform_accounts,
  public.timeline_events
from public, anon, authenticated;

commit;
