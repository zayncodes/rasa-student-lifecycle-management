begin;

-- Imported workbook rows may legitimately lack these dates. New student
-- creation remains strict in create_student_record; legacy edits preserve NULL.
alter table public.students alter column registration_date drop not null;
alter table public.students drop constraint if exists students_contact_required;
alter table public.enrollments alter column joining_date drop not null;

create or replace function public.update_student_lifecycle(
  p_student_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  required_permission text;
  allowed_keys text[] := array[
    'editReason', 'name', 'email', 'phone', 'registrationDate', 'ownerId', 'lifecycleStatus',
    'courseCode', 'courseStatus', 'joiningDate', 'tentativeCompletionDate', 'actualCompletionDate',
    'timeRequirement', 'platformStatus', 'attendance', 'feeTotal', 'nextPaymentDate', 'nextPaymentAmount',
    'projectName', 'projectDetails', 'projectStatus', 'projectDeadline', 'projectGrade', 'reviewDetails',
    'reviewOutcome', 'certificateStatus', 'certificateDispatchedDate', 'experienceLetterStatus',
    'hrSessions', 'hrSessionNotes', 'notes'
  ];
  selected_student public.students%rowtype;
  selected_enrollment public.enrollments%rowtype;
  selected_course public.courses%rowtype;
  selected_fee_account public.fee_accounts%rowtype;
  selected_schedule public.payment_schedules%rowtype;
  selected_project public.student_projects%rowtype;
  selected_review public.project_reviews%rowtype;
  v_new_updated_at timestamptz;
  v_owner_id uuid;
  v_registration_date date;
  v_joining_date date;
  v_tentative_completion_date date;
  v_actual_completion_date date;
  v_attendance_percent numeric;
  v_fee_total numeric;
  v_posted_total numeric;
  v_pending_total numeric;
  v_next_payment_date date;
  v_next_payment_amount numeric;
  v_project_name text;
  v_project_deadline date;
  v_project_grade text;
  v_review_feedback text;
  v_review_outcome text;
  v_certificate_status text;
  v_certificate_dispatched_date date;
  v_experience_status text;
  v_edit_reason text;
  session_index integer;
  v_session_status text;
  v_session_note text;
  existing_session_id uuid;
  old_values jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if public.has_role('trainer') then
    raise exception 'Trainer accounts cannot use the administrator lifecycle editor.' using errcode = '42501';
  end if;
  foreach required_permission in array array[
    'students.update', 'courses.view', 'users.view', 'attendance.manage', 'fees.manage',
    'projects.manage', 'projects.grade', 'certificates.manage', 'experience_letters.manage', 'hr.manage'
  ] loop
    if not public.has_permission(required_permission) then
      raise exception 'You do not have all permissions required for lifecycle administration.' using errcode = '42501';
    end if;
  end loop;

  if p_student_id is null or p_expected_updated_at is null then
    raise exception 'Student ID and record version are required.' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A lifecycle update object is required.' using errcode = '22023';
  end if;
  if not (p_payload ?& allowed_keys)
    or exists (select 1 from jsonb_object_keys(p_payload) as supplied_key where not (supplied_key = any(allowed_keys)))
  then
    raise exception 'The lifecycle update contains missing or unsupported fields.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'hrSessions') <> 'array'
    or jsonb_array_length(p_payload -> 'hrSessions') <> 4
    or jsonb_typeof(p_payload -> 'hrSessionNotes') <> 'array'
    or jsonb_array_length(p_payload -> 'hrSessionNotes') <> 4
  then
    raise exception 'Exactly four HR session values and notes are required.' using errcode = '22023';
  end if;

  v_edit_reason := nullif(trim(p_payload ->> 'editReason'), '');
  if v_edit_reason is null or length(v_edit_reason) < 10 or length(v_edit_reason) > 1000 then
    raise exception 'Explain the reason for this change in 10 to 1000 characters.' using errcode = '22023';
  end if;
  if nullif(trim(p_payload ->> 'name'), '') is null or length(trim(p_payload ->> 'name')) > 200 then
    raise exception 'Student name is required and must be 200 characters or fewer.' using errcode = '22023';
  end if;
  begin
    v_owner_id := nullif(p_payload ->> 'ownerId', '')::uuid;
    v_registration_date := (p_payload ->> 'registrationDate')::date;
    v_joining_date := (p_payload ->> 'joiningDate')::date;
    v_tentative_completion_date := nullif(p_payload ->> 'tentativeCompletionDate', '')::date;
    v_actual_completion_date := nullif(p_payload ->> 'actualCompletionDate', '')::date;
    v_attendance_percent := nullif(p_payload ->> 'attendance', '')::numeric;
    v_fee_total := (p_payload ->> 'feeTotal')::numeric;
    v_next_payment_date := nullif(p_payload ->> 'nextPaymentDate', '')::date;
    v_next_payment_amount := nullif(p_payload ->> 'nextPaymentAmount', '')::numeric;
    v_project_deadline := nullif(p_payload ->> 'projectDeadline', '')::date;
    v_certificate_dispatched_date := nullif(p_payload ->> 'certificateDispatchedDate', '')::date;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'One or more dates, identifiers or amounts are invalid.' using errcode = '22023';
  end;

  if v_tentative_completion_date is not null and v_joining_date is not null and v_tentative_completion_date < v_joining_date then
    raise exception 'Tentative completion cannot be before joining.' using errcode = '22023';
  end if;
  if v_actual_completion_date is not null and v_joining_date is not null and v_actual_completion_date < v_joining_date then
    raise exception 'Actual completion cannot be before joining.' using errcode = '22023';
  end if;
  if p_payload ->> 'lifecycleStatus' = 'Completed' and v_actual_completion_date is null then
    raise exception 'Actual completion date is required for a completed student.' using errcode = '22023';
  end if;
  if v_attendance_percent is not null and (v_attendance_percent < 0 or v_attendance_percent > 100) then
    raise exception 'Attendance must be between zero and 100 percent.' using errcode = '22023';
  end if;
  if v_fee_total is not null and (v_fee_total < 0 or v_fee_total > 9999999999.99) then
    raise exception 'Total course fee is outside the supported range.' using errcode = '22023';
  end if;
  if (v_next_payment_date is null) <> (v_next_payment_amount is null) then
    raise exception 'Provide both the next payment date and amount, or leave both blank.' using errcode = '22023';
  end if;
  if v_next_payment_amount is not null and (v_next_payment_amount <= 0 or v_next_payment_amount > 9999999999.99) then
    raise exception 'Next payment amount is outside the supported range.' using errcode = '22023';
  end if;

  v_project_name := nullif(trim(p_payload ->> 'projectName'), '');
  v_project_grade := nullif(trim(p_payload ->> 'projectGrade'), '');
  v_review_feedback := nullif(trim(p_payload ->> 'reviewDetails'), '');
  v_review_outcome := nullif(trim(p_payload ->> 'reviewOutcome'), '');
  v_certificate_status := p_payload ->> 'certificateStatus';
  v_experience_status := p_payload ->> 'experienceLetterStatus';

  if p_payload ->> 'lifecycleStatus' is null
    or p_payload ->> 'lifecycleStatus' not in ('Registered','Active','On Hold','Extended','Completed','Dropped','Cancelled','Archived')
    or (p_payload ->> 'courseStatus' is not null and p_payload ->> 'courseStatus' not in ('Not Started','Active','On Hold','Extended','Completed','Discontinued'))
    or (p_payload ->> 'platformStatus' is not null and p_payload ->> 'platformStatus' not in ('Not Created','Created','Material Assigned'))
    or p_payload ->> 'projectStatus' not in ('Assigned','In Progress','Submitted','Under Review','Revision Required','Completed','Cancelled')
    or (v_certificate_status is not null and v_certificate_status not in ('Not Eligible','Eligible','Requested','Generated','Dispatched','Delivered','Cancelled'))
    or (v_experience_status is not null and v_experience_status not in ('Not Eligible','Eligible','Requested','Issued','Cancelled'))
  then
    raise exception 'One or more lifecycle statuses are invalid.' using errcode = '22023';
  end if;
  if (v_review_feedback is null) <> (v_review_outcome is null)
    or (v_review_outcome is not null and v_review_outcome not in ('Approved','Revision Required','Rejected'))
  then
    raise exception 'Review feedback and a valid outcome must be provided together.' using errcode = '22023';
  end if;
  if v_project_name is null and (
    nullif(trim(p_payload ->> 'projectDetails'), '') is not null
    or v_project_deadline is not null or v_project_grade is not null or v_review_feedback is not null
  ) then
    raise exception 'A project name is required before project details can be saved.' using errcode = '22023';
  end if;
  if v_certificate_dispatched_date is not null and v_certificate_status is null then
    raise exception 'Choose a certificate status before adding a dispatch date.' using errcode = '22023';
  end if;
  if v_certificate_status in ('Dispatched','Delivered') and v_certificate_dispatched_date is null then
    raise exception 'Certificate dispatch date is required for a dispatched or delivered certificate.' using errcode = '22023';
  end if;

  select * into selected_student
  from public.students
  where id = p_student_id and archived_at is null
  for update;
  if selected_student.id is null then
    raise exception 'The student record is unavailable.' using errcode = 'P0002';
  end if;
  if selected_student.updated_at is distinct from p_expected_updated_at then
    raise exception 'This student was changed by another user. Close the editor, reopen the latest record and try again.' using errcode = '40001';
  end if;
  if v_owner_id is not null and not exists (
    select 1 from public.profiles where id = v_owner_id and (is_active or id = selected_student.owner_user_id)
  ) then
    raise exception 'The selected owner is not an active staff member.' using errcode = '22023';
  end if;

  select * into selected_enrollment
  from public.enrollments
  where student_id = p_student_id and archived_at is null
  order by created_at desc
  limit 1
  for update;

  if p_payload ->> 'courseCode' is not null then
    select * into selected_course
    from public.courses
    where course_code = p_payload ->> 'courseCode'
      and (is_active or id = selected_enrollment.course_id)
    limit 1;
    if selected_course.id is null then
      raise exception 'The selected course is not available.' using errcode = '22023';
    end if;
  elsif selected_enrollment.id is not null then
    select * into selected_course from public.courses where id = selected_enrollment.course_id;
  end if;

  old_values := jsonb_build_object(
    'name', selected_student.full_name,
    'email', selected_student.email,
    'phone', selected_student.contact_number,
    'registrationDate', selected_student.registration_date,
    'ownerId', selected_student.owner_user_id,
    'lifecycleStatus', selected_student.lifecycle_status,
    'enrollmentId', selected_enrollment.id,
    'courseCode', selected_enrollment.course_code_snapshot,
    'joiningDate', selected_enrollment.joining_date,
    'tentativeCompletionDate', selected_enrollment.tentative_completion_date,
    'actualCompletionDate', selected_enrollment.actual_completion_date,
    'notes', selected_student.notes
  );

  update public.students set
    full_name = trim(p_payload ->> 'name'),
    email = nullif(trim(p_payload ->> 'email'), ''),
    contact_number = nullif(trim(p_payload ->> 'phone'), ''),
    registration_date = v_registration_date,
    owner_user_id = v_owner_id,
    lifecycle_status = (p_payload ->> 'lifecycleStatus')::public.lifecycle_status,
    notes = nullif(trim(p_payload ->> 'notes'), ''),
    updated_by = current_user_id,
    updated_at = now()
  where id = p_student_id
  returning updated_at into v_new_updated_at;

  if selected_enrollment.id is null and selected_course.id is not null then
    insert into public.enrollments (
      student_id, course_id, joining_date, tentative_completion_date, actual_completion_date,
      course_status, time_requirement, course_name_snapshot, course_code_snapshot,
      standard_fee_snapshot, legacy_attendance_percentage, created_by, updated_by
    ) values (
      p_student_id, selected_course.id, v_joining_date, v_tentative_completion_date, v_actual_completion_date,
      coalesce((p_payload ->> 'courseStatus')::public.course_status, 'Not Started'::public.course_status), nullif(trim(p_payload ->> 'timeRequirement'), ''),
      selected_course.name, selected_course.course_code, coalesce(v_fee_total, selected_course.default_fee, 0), v_attendance_percent, current_user_id, current_user_id
    ) returning * into selected_enrollment;
  elsif selected_enrollment.id is not null then
    update public.enrollments set
      course_id = selected_course.id,
      joining_date = v_joining_date,
      tentative_completion_date = v_tentative_completion_date,
      actual_completion_date = v_actual_completion_date,
      course_status = coalesce((p_payload ->> 'courseStatus')::public.course_status, selected_enrollment.course_status),
      time_requirement = nullif(trim(p_payload ->> 'timeRequirement'), ''),
      course_name_snapshot = selected_course.name,
      course_code_snapshot = selected_course.course_code,
      standard_fee_snapshot = coalesce(v_fee_total, selected_enrollment.standard_fee_snapshot),
      legacy_attendance_percentage = v_attendance_percent,
      updated_by = current_user_id,
      updated_at = now()
    where id = selected_enrollment.id
    returning * into selected_enrollment;
  end if;

  if selected_enrollment.id is not null then
  if p_payload ->> 'platformStatus' is not null then
  insert into public.learning_platform_accounts as existing_platform (
    enrollment_id, account_created, account_created_at, study_material_assigned,
    study_material_assigned_at, status, updated_at
  ) values (
    selected_enrollment.id,
    p_payload ->> 'platformStatus' <> 'Not Created',
    case when p_payload ->> 'platformStatus' <> 'Not Created' then now() else null end,
    p_payload ->> 'platformStatus' = 'Material Assigned',
    case when p_payload ->> 'platformStatus' = 'Material Assigned' then now() else null end,
    p_payload ->> 'platformStatus', now()
  )
  on conflict (enrollment_id, platform_name) do update set
    account_created = excluded.account_created,
    account_created_at = case
      when excluded.account_created then coalesce(existing_platform.account_created_at, now())
      else null
    end,
    study_material_assigned = excluded.study_material_assigned,
    study_material_assigned_at = case
      when excluded.study_material_assigned then coalesce(existing_platform.study_material_assigned_at, now())
      else null
    end,
    status = excluded.status,
    updated_at = now()
  where existing_platform.status is distinct from excluded.status
    or existing_platform.account_created is distinct from excluded.account_created
    or existing_platform.study_material_assigned is distinct from excluded.study_material_assigned;
  end if;

  select * into selected_fee_account
  from public.fee_accounts
  where enrollment_id = selected_enrollment.id
  for update;
  if selected_fee_account.id is null and v_fee_total is not null then
    insert into public.fee_accounts (enrollment_id, total_course_fee, remarks, created_by, updated_by)
    values (selected_enrollment.id, v_fee_total, 'Created through lifecycle editor.', current_user_id, current_user_id)
    returning * into selected_fee_account;
  elsif selected_fee_account.id is not null then
    select coalesce(sum(amount), 0) into v_posted_total
    from public.payments
    where fee_account_id = selected_fee_account.id and status = 'Posted';
    if v_fee_total is not null and v_fee_total < v_posted_total then
      raise exception 'Total course fee cannot be lower than posted payments.' using errcode = '22023';
    end if;
    if v_fee_total is not null then
      update public.fee_accounts set total_course_fee = v_fee_total, updated_by = current_user_id, updated_at = now()
      where id = selected_fee_account.id
      returning * into selected_fee_account;
    else
      v_fee_total := selected_fee_account.total_course_fee;
    end if;
  end if;
  if selected_fee_account.id is not null then
  v_posted_total := coalesce((select sum(amount) from public.payments where fee_account_id = selected_fee_account.id and status = 'Posted'), 0);
  v_pending_total := v_fee_total - selected_fee_account.discount_amount + selected_fee_account.adjustment_amount - v_posted_total;
  if v_pending_total < 0 then
    raise exception 'Fee changes would make the account overpaid.' using errcode = '22023';
  end if;
  if v_next_payment_amount is not null and v_next_payment_amount > v_pending_total then
    raise exception 'Next payment amount cannot exceed the outstanding balance.' using errcode = '22023';
  end if;

  select * into selected_schedule
  from public.payment_schedules
  where fee_account_id = selected_fee_account.id and status = 'Pending'
  order by due_date, created_at
  limit 1
  for update;
  if v_next_payment_date is null then
    if selected_schedule.id is not null then
      update public.payment_schedules set status = 'Cancelled', remarks = v_edit_reason, updated_at = now()
      where id = selected_schedule.id;
    end if;
  elsif selected_schedule.id is null then
    insert into public.payment_schedules (fee_account_id, due_date, amount_due, status, remarks)
    values (selected_fee_account.id, v_next_payment_date, v_next_payment_amount, 'Pending', v_edit_reason);
  else
    update public.payment_schedules set due_date = v_next_payment_date, amount_due = v_next_payment_amount,
      remarks = v_edit_reason, updated_at = now()
    where id = selected_schedule.id;
  end if;
  end if;

  select * into selected_project
  from public.student_projects
  where enrollment_id = selected_enrollment.id
  order by created_at desc
  limit 1
  for update;
  if selected_project.id is not null and v_project_name is null then
    raise exception 'An existing project cannot be cleared from the lifecycle editor.' using errcode = '22023';
  elsif v_project_name is not null and selected_project.id is null then
    insert into public.student_projects (
      enrollment_id, project_name, project_details, deadline, project_status, grade, remarks, created_by, updated_by
    ) values (
      selected_enrollment.id, v_project_name, nullif(trim(p_payload ->> 'projectDetails'), ''), v_project_deadline,
      (p_payload ->> 'projectStatus')::public.project_status, v_project_grade, v_edit_reason, current_user_id, current_user_id
    ) returning * into selected_project;
  elsif v_project_name is not null then
    update public.student_projects set
      project_name = v_project_name,
      project_details = nullif(trim(p_payload ->> 'projectDetails'), ''),
      deadline = v_project_deadline,
      project_status = (p_payload ->> 'projectStatus')::public.project_status,
      grade = v_project_grade,
      remarks = v_edit_reason,
      updated_by = current_user_id,
      updated_at = now()
    where id = selected_project.id
    returning * into selected_project;
  end if;

  if v_review_feedback is not null then
    select * into selected_review
    from public.project_reviews
    where project_id = selected_project.id
    order by review_round desc
    limit 1
    for update;
    if selected_review.id is null then
      insert into public.project_reviews (project_id, reviewer_id, review_round, feedback, outcome, reviewed_at)
      values (selected_project.id, current_user_id, 1, v_review_feedback, v_review_outcome, now());
    elsif selected_review.feedback is distinct from v_review_feedback or selected_review.outcome is distinct from v_review_outcome then
      update public.project_reviews set reviewer_id = current_user_id, feedback = v_review_feedback,
        outcome = v_review_outcome, reviewed_at = now()
      where id = selected_review.id;
    end if;
  end if;

  if v_certificate_status is not null and not exists (
    select 1 from public.certificates
    where enrollment_id = selected_enrollment.id
      and status = v_certificate_status
      and dispatched_at::date is not distinct from v_certificate_dispatched_date
  ) then
  insert into public.certificates (
    enrollment_id, eligibility_status, manual_override, override_reason, overridden_by, overridden_at,
    status, dispatched_at, updated_at
  ) values (
    selected_enrollment.id, 'Manual review', true, v_edit_reason, current_user_id, now(),
    v_certificate_status, v_certificate_dispatched_date::timestamptz, now()
  )
  on conflict (enrollment_id) do update set
    eligibility_status = 'Manual review', manual_override = true, override_reason = v_edit_reason,
    overridden_by = current_user_id, overridden_at = now(), status = v_certificate_status,
    dispatched_at = v_certificate_dispatched_date::timestamptz, updated_at = now();
  end if;

  if v_experience_status is not null and not exists (
    select 1 from public.experience_letters
    where enrollment_id = selected_enrollment.id and status = v_experience_status
  ) then
  insert into public.experience_letters as existing_letter (
    enrollment_id, eligibility_status, manual_override, override_reason, overridden_by, overridden_at,
    status, issued_at, updated_at
  ) values (
    selected_enrollment.id, 'Manual review', true, v_edit_reason, current_user_id, now(), v_experience_status,
    case when v_experience_status = 'Issued' then now() else null end, now()
  )
  on conflict (enrollment_id) do update set
    eligibility_status = 'Manual review', manual_override = true, override_reason = v_edit_reason,
    overridden_by = current_user_id, overridden_at = now(), status = v_experience_status,
    issued_at = case
      when v_experience_status = 'Issued' then coalesce(existing_letter.issued_at, now())
      else null
    end,
    updated_at = now();
  end if;

  for session_index in 0..3 loop
    v_session_status := nullif(trim(p_payload -> 'hrSessions' ->> session_index), '');
    v_session_note := nullif(trim(p_payload -> 'hrSessionNotes' ->> session_index), '');
    if v_session_status is not null then
      if v_session_status not in ('Pending','Scheduled','Completed','Cancelled','No Show') then
        raise exception 'An HR session status is invalid.' using errcode = '22023';
      end if;
      select id into existing_session_id
      from public.hr_sessions
      where enrollment_id = selected_enrollment.id and sequence_number = session_index + 1
      order by created_at desc
      limit 1
      for update;
      if existing_session_id is null then
        insert into public.hr_sessions (
          enrollment_id, session_type, sequence_number, status, completed_at, facilitator_id, notes
        ) values (
          selected_enrollment.id, 'HR Session ' || (session_index + 1), session_index + 1, v_session_status,
          case when v_session_status = 'Completed' then now() else null end, current_user_id, v_session_note
        );
      else
        update public.hr_sessions set
          status = v_session_status,
          completed_at = case
            when v_session_status = 'Completed' then coalesce(completed_at, now())
            else null
          end,
          facilitator_id = current_user_id,
          notes = v_session_note,
          updated_at = now()
        where id = existing_session_id;
      end if;
      existing_session_id := null;
    elsif v_session_note is not null then
      raise exception 'Choose an HR session status before adding session notes.' using errcode = '22023';
    end if;
  end loop;
  end if;

  insert into public.timeline_events (
    student_id, enrollment_id, event_type, title, detail, metadata, actor_id
  ) values (
    p_student_id, selected_enrollment.id, 'student_record_updated', 'Student lifecycle updated', v_edit_reason,
    jsonb_build_object('fields', to_jsonb(allowed_keys), 'source_lineage_preserved', true), current_user_id
  );

  perform private.write_audit_log(
    'student.lifecycle_updated', 'student', p_student_id, old_values,
    (p_payload - 'editReason') || jsonb_build_object(
      'editReason', v_edit_reason,
      'enrollmentId', selected_enrollment.id,
      'sourceLineagePreserved', true
    ),
    v_edit_reason
  );

  return v_new_updated_at;
end;
$$;

revoke all on function public.update_student_lifecycle(uuid, timestamptz, jsonb) from public;
grant execute on function public.update_student_lifecycle(uuid, timestamptz, jsonb) to authenticated;

commit;
