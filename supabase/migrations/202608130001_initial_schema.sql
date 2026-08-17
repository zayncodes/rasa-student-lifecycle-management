-- RASA Student Lifecycle Management System
-- Initial normalized schema, RBAC foundation, concurrency-safe IDs, audit fields and RLS.

create extension if not exists pgcrypto;

create type public.lifecycle_status as enum ('Registered','Active','On Hold','Extended','Completed','Dropped','Cancelled','Archived');
create type public.course_status as enum ('Not Started','Active','On Hold','Extended','Completed','Discontinued');
create type public.payment_status as enum ('Posted','Voided');
create type public.project_status as enum ('Assigned','In Progress','Submitted','Under Review','Revision Required','Completed','Cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  module text not null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  primary key (user_id, role_id)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  course_code text not null unique,
  name text not null,
  description text,
  category text,
  standard_duration_value integer not null check (standard_duration_value > 0),
  standard_duration_unit text not null check (standard_duration_unit in ('day','week','month','year')),
  default_fee numeric(12,2) not null default 0 check (default_fee >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_code_sequences (
  code_year integer primary key,
  last_value bigint not null default 0
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  student_code text unique,
  full_name text not null,
  email text,
  contact_number text,
  registration_date date not null default current_date,
  owner_user_id uuid references public.profiles(id),
  lifecycle_status public.lifecycle_status not null default 'Registered',
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  constraint students_contact_required check (email is not null or contact_number is not null)
);

create unique index students_email_active_unique on public.students (lower(email)) where archived_at is null and email is not null;
create index students_search_name_idx on public.students using gin (to_tsvector('simple', full_name));
create index students_status_idx on public.students (lifecycle_status) where archived_at is null;
create index students_owner_idx on public.students (owner_user_id) where archived_at is null;

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  course_id uuid not null references public.courses(id),
  joining_date date not null,
  tentative_completion_date date,
  actual_completion_date date,
  course_status public.course_status not null default 'Not Started',
  time_requirement text,
  course_remarks text,
  course_name_snapshot text not null,
  course_code_snapshot text not null,
  standard_fee_snapshot numeric(12,2) not null check (standard_fee_snapshot >= 0),
  legacy_attendance_percentage numeric(5,2) check (legacy_attendance_percentage between 0 and 100),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  archived_at timestamptz,
  constraint enrollment_dates_valid check (tentative_completion_date is null or tentative_completion_date >= joining_date)
);
create index enrollments_student_idx on public.enrollments(student_id) where archived_at is null;
create index enrollments_course_status_idx on public.enrollments(course_id, course_status) where archived_at is null;

create table public.learning_platform_accounts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  platform_name text not null default 'Spayee',
  username text,
  account_created boolean not null default false,
  account_created_at timestamptz,
  study_material_assigned boolean not null default false,
  study_material_assigned_at timestamptz,
  status text not null default 'Not Created',
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, platform_name)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  attendance_date date not null,
  status text not null check (status in ('Present','Absent','Leave','Late')),
  session_name text not null default 'General session',
  remarks text,
  marked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, attendance_date, session_name)
);
create index attendance_enrollment_date_idx on public.attendance_records(enrollment_id, attendance_date desc);

create table public.trainers (
  id uuid primary key default gen_random_uuid(),
  linked_user_id uuid unique references public.profiles(id),
  full_name text not null,
  email text,
  phone text,
  specialization text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trainer_assignments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  trainer_id uuid not null references public.trainers(id),
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  assigned_by uuid references public.profiles(id),
  notes text,
  constraint assignment_dates_valid check (unassigned_at is null or unassigned_at >= assigned_at)
);
create unique index one_primary_trainer_per_enrollment on public.trainer_assignments(enrollment_id) where is_primary and unassigned_at is null;
create index trainer_assignments_user_scope_idx on public.trainer_assignments(trainer_id, enrollment_id) where unassigned_at is null;

create table public.trainer_feedback (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  trainer_id uuid not null references public.trainers(id),
  feedback text not null,
  rating numeric(3,2) check (rating between 0 and 5),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.fee_accounts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id),
  total_course_fee numeric(12,2) not null check (total_course_fee >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  adjustment_amount numeric(12,2) not null default 0,
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  fee_account_id uuid not null references public.fee_accounts(id),
  payment_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null,
  transaction_reference text,
  remarks text,
  status public.payment_status not null default 'Posted',
  recorded_by uuid not null references public.profiles(id),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_void_metadata check ((status = 'Posted' and voided_at is null and voided_by is null and void_reason is null) or (status = 'Voided' and voided_at is not null and voided_by is not null and length(trim(void_reason)) >= 5))
);
create index payments_account_date_idx on public.payments(fee_account_id, payment_date desc);

create table public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  fee_account_id uuid not null references public.fee_accounts(id) on delete cascade,
  due_date date not null,
  amount_due numeric(12,2) not null check (amount_due > 0),
  status text not null default 'Pending' check (status in ('Pending','Paid','Waived','Cancelled')),
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_schedule_due_idx on public.payment_schedules(due_date, status) where status = 'Pending';

create table public.student_projects (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  project_name text not null,
  project_details text,
  trainer_id uuid references public.trainers(id),
  assigned_date date not null default current_date,
  start_date date,
  deadline date,
  project_status public.project_status not null default 'Assigned',
  final_submission_status text,
  final_submission_date date,
  grade text,
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create index student_projects_enrollment_idx on public.student_projects(enrollment_id, project_status);
create index student_projects_deadline_idx on public.student_projects(deadline, project_status) where project_status not in ('Completed','Cancelled');

create table public.project_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.student_projects(id) on delete cascade,
  reviewer_id uuid references public.profiles(id),
  review_round integer not null default 1 check (review_round > 0),
  feedback text not null,
  outcome text not null check (outcome in ('Approved','Revision Required','Rejected')),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(project_id, review_round)
);

create table public.extensions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  original_completion_date date not null,
  extended_completion_date date not null,
  reason text not null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Cancelled')),
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint extension_date_valid check (extended_completion_date > original_completion_date)
);

create table public.eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('certificate','experience_letter','course_completion')),
  name text not null,
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_until date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id),
  eligibility_status text not null default 'Not Evaluated',
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  manual_override boolean not null default false,
  override_reason text,
  overridden_by uuid references public.profiles(id),
  overridden_at timestamptz,
  status text not null default 'Not Eligible' check (status in ('Not Eligible','Eligible','Requested','Generated','Dispatched','Delivered','Cancelled')),
  requested_at timestamptz,
  generated_at timestamptz,
  document_path text,
  dispatched_at timestamptz,
  courier_name text,
  tracking_number text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificate_override_reason check (not manual_override or length(trim(override_reason)) >= 5)
);

create table public.experience_letters (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id),
  eligibility_status text not null default 'Not Evaluated',
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  manual_override boolean not null default false,
  override_reason text,
  overridden_by uuid references public.profiles(id),
  status text not null default 'Not Eligible' check (status in ('Not Eligible','Eligible','Requested','Issued','Cancelled')),
  issued_at timestamptz,
  document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experience_override_reason check (not manual_override or length(trim(override_reason)) >= 5)
);

create table public.hr_sessions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  session_type text not null,
  sequence_number integer check (sequence_number is null or sequence_number > 0),
  scheduled_at timestamptz,
  completed_at timestamptz,
  status text not null default 'Pending' check (status in ('Pending','Scheduled','Completed','Cancelled','No Show')),
  facilitator_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hr_sessions_pending_idx on public.hr_sessions(status, scheduled_at) where status in ('Pending','Scheduled');

create table public.placement_activities (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  activity_type text not null,
  status text not null default 'Pending',
  activity_date date,
  organization text,
  details text,
  outcome text,
  handled_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  enrollment_id uuid references public.enrollments(id),
  document_type text not null,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index documents_student_idx on public.documents(student_id) where archived_at is null;

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  enrollment_id uuid references public.enrollments(id),
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  occurred_at timestamptz not null default now()
);
create index timeline_student_date_idx on public.timeline_events(student_id, occurred_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  reason text,
  request_id text,
  ip_address inet,
  occurred_at timestamptz not null default now()
);
create index audit_entity_idx on public.audit_logs(entity_type, entity_id, occurred_at desc);
create index audit_actor_idx on public.audit_logs(actor_id, occurred_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  student_id uuid references public.students(id),
  notification_type text not null,
  title text not null,
  message text not null,
  action_url text,
  due_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications(recipient_id, read_at, created_at desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  storage_path text,
  sheet_name text,
  mapping jsonb not null default '{}'::jsonb,
  status text not null default 'Uploaded' check (status in ('Uploaded','Mapped','Validated','Importing','Completed','Failed','Cancelled')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.import_rows (
  id bigint generated always as identity primary key,
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null,
  normalized_data jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  duplicate_of_student_id uuid references public.students(id),
  status text not null default 'Pending' check (status in ('Pending','Valid','Invalid','Duplicate','Imported','Skipped')),
  unique(import_job_id, row_number)
);

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('text','number','date','boolean','select','multiselect','url')),
  configuration jsonb not null default '{}'::jsonb,
  is_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(entity_type, field_key)
);

create table public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.custom_field_definitions(id),
  entity_id uuid not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(definition_id, entity_id)
);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.assign_student_code() returns trigger language plpgsql security definer set search_path = '' as $$
declare y integer; n bigint;
begin
  if new.student_code is not null then return new; end if;
  y := extract(year from coalesce(new.registration_date, current_date));
  insert into public.student_code_sequences(code_year, last_value) values (y, 1)
  on conflict (code_year) do update set last_value = public.student_code_sequences.last_value + 1
  returning last_value into n;
  new.student_code := format('RASA-%s-%s', y, lpad(n::text, 6, '0'));
  return new;
end; $$;

create trigger students_assign_code before insert on public.students for each row execute function public.assign_student_code();

do $$ declare t text; begin
  foreach t in array array['profiles','roles','courses','students','enrollments','learning_platform_accounts','attendance_records','trainers','trainer_feedback','fee_accounts','payments','payment_schedules','student_projects','eligibility_rules','certificates','experience_letters','hr_sessions','placement_activities','app_settings','custom_field_values'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

create or replace function public.has_permission(required_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.id = auth.uid() and p.is_active and perm.code = required_permission
  );
$$;

create or replace function public.has_role(required_role text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.user_roles ur on ur.user_id = p.id join public.roles r on r.id = ur.role_id
    where p.id = auth.uid() and p.is_active and r.code = required_role
  );
$$;

create or replace function public.trainer_can_access_enrollment(target_enrollment uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trainers t join public.trainer_assignments ta on ta.trainer_id = t.id
    where t.linked_user_id = auth.uid() and ta.enrollment_id = target_enrollment and ta.unassigned_at is null and t.is_active
  );
$$;

create or replace function public.trainer_can_access_student(target_student uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.enrollments e where e.student_id = target_student and public.trainer_can_access_enrollment(e.id));
$$;

create or replace view public.fee_account_summaries with (security_invoker = true) as
select fa.id, fa.enrollment_id, fa.total_course_fee, fa.discount_amount, fa.adjustment_amount,
  coalesce(sum(p.amount) filter (where p.status = 'Posted'), 0)::numeric(12,2) as paid_amount,
  (fa.total_course_fee - fa.discount_amount + fa.adjustment_amount - coalesce(sum(p.amount) filter (where p.status = 'Posted'), 0))::numeric(12,2) as pending_amount
from public.fee_accounts fa left join public.payments p on p.fee_account_id = fa.id group by fa.id;

insert into public.roles(code,name,description,is_system_role) values
('super_admin','Super Admin','Full platform and security administration',true),
('admin','Admin','Operational administration',true),
('hr','HR','Student HR, finance and placement operations',true),
('trainer','Trainer','Assigned-student academic operations',true)
on conflict (code) do nothing;

insert into public.permissions(code,name,module) values
('students.view','View students','students'),('students.create','Create students','students'),('students.update','Update students','students'),('students.archive','Archive students','students'),
('fees.view','View fees','fees'),('fees.manage','Manage fees','fees'),('courses.view','View courses','courses'),('courses.manage','Manage courses','courses'),
('attendance.view','View attendance','attendance'),('attendance.manage','Manage attendance','attendance'),('projects.view','View projects','projects'),('projects.manage','Manage projects','projects'),('projects.review','Review projects','projects'),('projects.grade','Grade projects','projects'),
('certificates.view','View certificates','certificates'),('certificates.manage','Manage certificates','certificates'),('experience_letters.view','View experience letters','experience_letters'),('experience_letters.manage','Manage experience letters','experience_letters'),
('hr.view','View HR records','hr'),('hr.manage','Manage HR records','hr'),('placement.view','View placement','placement'),('placement.manage','Manage placement','placement'),
('reports.view','View reports','reports'),('reports.export','Export reports','reports'),('imports.manage','Manage imports','imports'),('users.view','View users','users'),('users.manage','Manage users','users'),('roles.manage','Manage roles','roles'),('settings.manage','Manage settings','settings'),('audit_logs.view','View audit logs','audit_logs')
on conflict (code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p where r.code = 'super_admin' on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code not in ('roles.manage','settings.manage') where r.code = 'admin' on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('students.view','students.update','fees.view','fees.manage','certificates.view','certificates.manage','experience_letters.view','experience_letters.manage','hr.view','hr.manage','placement.view','placement.manage','reports.view','reports.export') where r.code = 'hr' on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('students.view','attendance.view','attendance.manage','projects.view','projects.manage','projects.review','projects.grade') where r.code = 'trainer' on conflict do nothing;

insert into public.app_settings(key,value,description) values
('organization','{"name":"RASA Life Science Informatics LLP","timezone":"Asia/Kolkata","currency":"INR"}','Organization display defaults'),
('upcoming_payment_window_days','7','Upcoming payment reminder window'),
('certificate_eligibility','{"minimum_attendance_percent":75,"require_course_completion":true,"require_fee_clearance":true,"require_project_completion":true}','Configurable initial certificate eligibility defaults')
on conflict (key) do nothing;

do $$ declare t text; begin
  foreach t in array array['profiles','roles','permissions','role_permissions','user_roles','courses','students','enrollments','learning_platform_accounts','attendance_records','trainers','trainer_assignments','trainer_feedback','fee_accounts','payments','payment_schedules','student_projects','project_reviews','extensions','eligibility_rules','certificates','experience_letters','hr_sessions','placement_activities','documents','timeline_events','audit_logs','notifications','app_settings','import_jobs','import_rows','custom_field_definitions','custom_field_values'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.has_permission('users.view'));
create policy profiles_admin_manage on public.profiles for all using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy rbac_authenticated_read_roles on public.roles for select to authenticated using (true);
create policy rbac_authenticated_read_permissions on public.permissions for select to authenticated using (true);
create policy user_roles_self_or_admin on public.user_roles for select using (user_id = auth.uid() or public.has_permission('users.view'));
create policy user_roles_admin_manage on public.user_roles for all using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy role_permissions_super_manage on public.role_permissions for all using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy courses_staff_read on public.courses for select to authenticated using (public.has_permission('courses.view'));
create policy courses_manage on public.courses for all using (public.has_permission('courses.manage')) with check (public.has_permission('courses.manage'));
create policy students_scope_read on public.students for select using (public.has_permission('students.view') and (not public.has_role('trainer') or public.trainer_can_access_student(id)));
create policy students_create on public.students for insert with check (public.has_permission('students.create'));
create policy students_update on public.students for update using (public.has_permission('students.update') and not public.has_role('trainer')) with check (public.has_permission('students.update') and not public.has_role('trainer'));
create policy enrollments_scope_read on public.enrollments for select using (public.has_permission('students.view') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(id)));
create policy enrollments_admin_manage on public.enrollments for all using (public.has_permission('students.update') and not public.has_role('trainer')) with check (public.has_permission('students.update') and not public.has_role('trainer'));
create policy attendance_scope_read on public.attendance_records for select using (public.has_permission('attendance.view') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id)));
create policy attendance_scope_manage on public.attendance_records for all using (public.has_permission('attendance.manage') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id))) with check (public.has_permission('attendance.manage') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id)));
create policy trainer_assignment_scope_read on public.trainer_assignments for select using (public.has_permission('students.view') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id)));
create policy trainer_feedback_scope_read on public.trainer_feedback for select using (public.has_permission('projects.view') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id)));
create policy trainer_feedback_scope_write on public.trainer_feedback for insert with check (public.has_permission('projects.review') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id)));
create policy projects_scope_read on public.student_projects for select using (public.has_permission('projects.view') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id)));
create policy projects_scope_manage on public.student_projects for all using (public.has_permission('projects.manage') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id))) with check (public.has_permission('projects.manage') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(enrollment_id)));
create policy project_reviews_scope_read on public.project_reviews for select using (exists(select 1 from public.student_projects sp where sp.id = project_id and public.has_permission('projects.view') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(sp.enrollment_id))));
create policy project_reviews_scope_write on public.project_reviews for insert with check (exists(select 1 from public.student_projects sp where sp.id = project_id and public.has_permission('projects.review') and (not public.has_role('trainer') or public.trainer_can_access_enrollment(sp.enrollment_id))));
create policy fees_authorized_read on public.fee_accounts for select using (public.has_permission('fees.view'));
create policy fees_authorized_manage on public.fee_accounts for all using (public.has_permission('fees.manage')) with check (public.has_permission('fees.manage'));
create policy payments_authorized_read on public.payments for select using (public.has_permission('fees.view'));
create policy payments_authorized_manage on public.payments for all using (public.has_permission('fees.manage')) with check (public.has_permission('fees.manage'));
create policy schedules_authorized_read on public.payment_schedules for select using (public.has_permission('fees.view'));
create policy schedules_authorized_manage on public.payment_schedules for all using (public.has_permission('fees.manage')) with check (public.has_permission('fees.manage'));
create policy certificates_authorized_read on public.certificates for select using (public.has_permission('certificates.view'));
create policy certificates_authorized_manage on public.certificates for all using (public.has_permission('certificates.manage')) with check (public.has_permission('certificates.manage'));
create policy experience_authorized_read on public.experience_letters for select using (public.has_permission('experience_letters.view'));
create policy experience_authorized_manage on public.experience_letters for all using (public.has_permission('experience_letters.manage')) with check (public.has_permission('experience_letters.manage'));
create policy hr_authorized_read on public.hr_sessions for select using (public.has_permission('hr.view'));
create policy hr_authorized_manage on public.hr_sessions for all using (public.has_permission('hr.manage')) with check (public.has_permission('hr.manage'));
create policy placement_authorized_read on public.placement_activities for select using (public.has_permission('placement.view'));
create policy placement_authorized_manage on public.placement_activities for all using (public.has_permission('placement.manage')) with check (public.has_permission('placement.manage'));
create policy notifications_own on public.notifications for select using (recipient_id = auth.uid());
create policy notifications_own_update on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy audit_admin_read on public.audit_logs for select using (public.has_permission('audit_logs.view'));
create policy imports_authorized on public.import_jobs for all using (public.has_permission('imports.manage')) with check (public.has_permission('imports.manage'));
create policy import_rows_authorized on public.import_rows for all using (exists(select 1 from public.import_jobs j where j.id = import_job_id and public.has_permission('imports.manage'))) with check (exists(select 1 from public.import_jobs j where j.id = import_job_id and public.has_permission('imports.manage')));
create policy settings_authorized_read on public.app_settings for select to authenticated using (true);
create policy settings_authorized_manage on public.app_settings for all using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

-- Storage policies expect a private bucket named student-documents.
insert into storage.buckets(id,name,public) values ('student-documents','student-documents',false) on conflict (id) do nothing;
create policy student_documents_authorized_read on storage.objects for select using (bucket_id = 'student-documents' and (public.has_permission('students.view') or public.has_permission('certificates.view') or public.has_permission('experience_letters.view')) and not public.has_role('trainer'));
create policy student_documents_authorized_write on storage.objects for insert with check (bucket_id = 'student-documents' and (public.has_permission('students.update') or public.has_permission('certificates.manage') or public.has_permission('experience_letters.manage')) and not public.has_role('trainer'));

revoke all on function public.has_permission(text) from public;
revoke all on function public.has_role(text) from public;
revoke all on function public.trainer_can_access_enrollment(uuid) from public;
revoke all on function public.trainer_can_access_student(uuid) from public;
grant execute on function public.has_permission(text), public.has_role(text), public.trainer_can_access_enrollment(uuid), public.trainer_can_access_student(uuid) to authenticated;

