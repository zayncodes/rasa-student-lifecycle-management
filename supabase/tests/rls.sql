-- Run with the Supabase local test database after applying every migration.
begin;
select plan(16);

-- These UUIDs and addresses are isolated test identities; no production
-- identities or credentials are used.
insert into auth.users(id,email) values
('00000000-0000-4000-8000-000000000101','trainer-a@example.test'),
('00000000-0000-4000-8000-000000000102','trainer-b@example.test'),
('00000000-0000-4000-8000-000000000103','admin-a@example.test');
insert into public.profiles(id,full_name,email,login_id) values
('00000000-0000-4000-8000-000000000101','Trainer A','trainer-a@example.test','TEST-TRAINER-A'),
('00000000-0000-4000-8000-000000000102','Trainer B','trainer-b@example.test','TEST-TRAINER-B'),
('00000000-0000-4000-8000-000000000103','Admin A','admin-a@example.test','TEST-ADMIN-A');
insert into public.user_roles(user_id,role_id)
select '00000000-0000-4000-8000-000000000101',id from public.roles where code='trainer';
insert into public.user_roles(user_id,role_id)
select '00000000-0000-4000-8000-000000000102',id from public.roles where code='trainer';
insert into public.user_roles(user_id,role_id)
select '00000000-0000-4000-8000-000000000103',id from public.roles where code='super_admin';
insert into public.courses(course_code,name,standard_duration_value,standard_duration_unit,default_fee)
values ('TEST-AUTH-001','Test authorization course',4,'month',1000);

select ok(
  not has_function_privilege('authenticated', 'private.bootstrap_first_administrator(uuid,text,text)', 'execute'),
  'first-administrator bootstrap is unavailable to application users'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000101';
select ok(public.has_role('trainer'),'trainer role is resolved through RBAC');
select ok(not public.is_launch_administrator(),'trainer is outside the administrator-only launch');
select ok(not public.has_permission('students.view'),'launch gate removes trainer student permission');
select ok(not public.has_permission('fees.view'),'trainer has no fee permission');
select is((select count(*) from public.fee_accounts),0::bigint,'trainer direct fee query returns no rows');
select is((select count(*) from public.students),0::bigint,'trainer direct student query returns no rows during launch');
select ok(not public.has_permission('users.manage'),'trainer cannot manage users');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000103';
select ok(public.is_launch_administrator(),'active super administrator passes the launch gate');
select ok(public.has_permission('students.create'),'super administrator retains assigned permissions');
select lives_ok(
  $$select * from public.create_student_record(
    'Authorization Test Student',
    'authorization-student@example.test',
    '+910000000000',
    'TEST-AUTH-001',
    current_date,
    current_date + 120,
    1000,
    0
  )$$,
  'student creation and its audit write commit in one transaction'
);
select is(
  (select count(*) from public.students where email='authorization-student@example.test'),
  1::bigint,
  'student creation persists one record'
);
select is(
  (select count(*) from public.audit_logs where action='student.created' and entity_type='student'),
  1::bigint,
  'student creation produces an audit record'
);
select is(
  public.record_student_payment(
    (select id from public.students where email='authorization-student@example.test'),
    current_date,
    200,
    'Test transfer',
    'TEST-TXN-001',
    'Authorization integration test'
  ),
  800::numeric,
  'payment posting returns the remaining balance'
);
select is(
  (select count(*) from public.audit_logs where action='student.payment_recorded' and entity_type='student'),
  1::bigint,
  'payment posting produces its student audit record'
);
select is(
  (select count(*) from public.audit_logs where action='payment.posted' and entity_type='payment'),
  1::bigint,
  'payment trigger produces an immutable payment audit record'
);

select * from finish();
rollback;
