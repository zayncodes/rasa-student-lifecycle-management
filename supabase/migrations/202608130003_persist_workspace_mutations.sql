begin;

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
security invoker
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
  if not public.has_permission('students.create') or not public.has_permission('students.update') then
    raise exception 'You do not have permission to create student enrollments.' using errcode = '42501';
  end if;
  if not public.has_permission('courses.view') then
    raise exception 'You do not have permission to use the course catalogue.' using errcode = '42501';
  end if;
  if not public.has_permission('fees.manage') then
    raise exception 'You do not have permission to create fee accounts.' using errcode = '42501';
  end if;
  if public.has_role('trainer') then
    raise exception 'Trainers cannot create student enrollments or fee accounts.' using errcode = '42501';
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
    trim(p_full_name), nullif(trim(p_email), ''), nullif(trim(p_contact_number), ''), current_user_id,
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

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
  values (
    current_user_id,
    'student.created',
    'student',
    new_student.id,
    jsonb_build_object(
      'student_code', new_student.student_code,
      'enrollment_id', new_enrollment_id,
      'course_code', selected_course.course_code,
      'total_course_fee', p_total_course_fee,
      'initial_payment', p_initial_payment
    )
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
security invoker
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
  if not public.has_permission('fees.manage') then
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

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
  values (
    current_user_id,
    'student.payment_recorded',
    'student',
    p_student_id,
    jsonb_build_object(
      'fee_account_id', selected_fee_account_id,
      'amount', p_amount,
      'payment_date', p_payment_date,
      'payment_method', trim(p_payment_method),
      'remaining_balance', pending_amount - p_amount
    )
  );

  return pending_amount - p_amount;
end;
$$;

create or replace function public.audit_student_export(p_student_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_count integer;
  authorized_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.has_permission('reports.export') then
    raise exception 'You do not have permission to export student records.' using errcode = '42501';
  end if;
  if p_student_ids is null or cardinality(p_student_ids) = 0 or cardinality(p_student_ids) > 2000 then
    raise exception 'Choose between 1 and 2000 student records.' using errcode = '22023';
  end if;

  select count(distinct requested_id) into requested_count
  from unnest(p_student_ids) as requested_id;

  if requested_count <> cardinality(p_student_ids) then
    raise exception 'Duplicate student IDs are not allowed.' using errcode = '22023';
  end if;

  select count(*) into authorized_count
  from public.students s
  where s.id = any(p_student_ids)
    and s.archived_at is null
    and public.has_permission('students.view')
    and (not public.has_role('trainer') or public.trainer_can_access_student(s.id));

  if authorized_count <> requested_count then
    raise exception 'One or more requested student records are unavailable.' using errcode = '42501';
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, new_values)
  values (
    current_user_id,
    'students.exported',
    'student_export',
    jsonb_build_object(
      'record_count', requested_count,
      'student_ids', to_jsonb(p_student_ids)
    )
  );
end;
$$;

revoke all on function public.create_student_record(text, text, text, text, date, date, numeric, numeric) from public;
grant execute on function public.create_student_record(text, text, text, text, date, date, numeric, numeric) to authenticated;
revoke all on function public.record_student_payment(uuid, date, numeric, text, text, text) from public;
grant execute on function public.record_student_payment(uuid, date, numeric, text, text, text) to authenticated;
revoke all on function public.audit_student_export(uuid[]) from public;
grant execute on function public.audit_student_export(uuid[]) to authenticated;

commit;
