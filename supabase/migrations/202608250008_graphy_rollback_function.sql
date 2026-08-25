begin;

-- Atomic rollback for a Graphy sync run.
--
-- Restoring field-by-field over HTTP could leave a run half-reverted if the
-- connection dropped. Doing it inside one function makes the whole run either
-- fully restored or not restored at all.

create or replace function public.rollback_graphy_sync_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Only columns this sync is allowed to write may be restored. Anything else
  -- is refused rather than interpolated into dynamic SQL.
  allowed_student_columns text[] := array['graphy_learner_id'];
  allowed_enrollment_columns text[] := array[
    'graphy_progress_percent', 'graphy_last_active_at', 'graphy_course_name', 'graphy_synced_at'
  ];
  selected_run public.graphy_sync_runs%rowtype;
  change_row record;
  restored integer := 0;
begin
  if not public.has_permission('imports.manage') then
    raise exception 'You do not have permission to roll back a sync run.' using errcode = '42501';
  end if;

  select * into selected_run from public.graphy_sync_runs where id = p_run_id for update;
  if selected_run.id is null then
    raise exception 'Sync run not found.' using errcode = 'P0002';
  end if;
  if selected_run.status = 'RolledBack' then
    raise exception 'That sync run has already been rolled back.' using errcode = '23505';
  end if;
  if selected_run.mode <> 'applied' then
    raise exception 'A preview run wrote nothing, so there is nothing to roll back.' using errcode = '22023';
  end if;

  for change_row in
    select * from public.graphy_sync_changes
    where run_id = p_run_id and applied and not reverted
    order by id desc
  loop
    if change_row.entity = 'student' then
      if not (change_row.column_name = any(allowed_student_columns)) then
        raise exception 'Refusing to restore unexpected column %.', change_row.column_name using errcode = '42501';
      end if;
      execute format('update public.students set %I = $1 where id = $2', change_row.column_name)
        using change_row.old_value, change_row.student_id;
      restored := restored + 1;

    elsif change_row.entity = 'enrollment' then
      if not (change_row.column_name = any(allowed_enrollment_columns)) then
        raise exception 'Refusing to restore unexpected column %.', change_row.column_name using errcode = '42501';
      end if;
      -- Numeric and timestamp columns need their text form cast back.
      if change_row.column_name = 'graphy_progress_percent' then
        execute 'update public.enrollments set graphy_progress_percent = $1 where id = $2'
          using nullif(change_row.old_value, '')::numeric, change_row.enrollment_id;
      elsif change_row.column_name in ('graphy_last_active_at', 'graphy_synced_at') then
        execute format('update public.enrollments set %I = $1 where id = $2', change_row.column_name)
          using nullif(change_row.old_value, '')::timestamptz, change_row.enrollment_id;
      else
        execute format('update public.enrollments set %I = $1 where id = $2', change_row.column_name)
          using change_row.old_value, change_row.enrollment_id;
      end if;
      restored := restored + 1;
    end if;
  end loop;

  update public.graphy_sync_changes set reverted = true
  where run_id = p_run_id and applied and not reverted;

  update public.graphy_sync_runs
  set status = 'RolledBack', rolled_back_at = now(), rolled_back_by = auth.uid()
  where id = p_run_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_values, reason)
  values (
    auth.uid(), 'graphy.sync_rolled_back', 'graphy_sync_run', p_run_id,
    jsonb_build_object('fields_restored', restored, 'filename', selected_run.filename),
    'Rolled back from the sync history screen'
  );

  return restored;
end;
$$;

revoke all on function public.rollback_graphy_sync_run(uuid) from public, anon;
grant execute on function public.rollback_graphy_sync_run(uuid) to authenticated;

commit;
