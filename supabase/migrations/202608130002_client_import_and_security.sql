-- Production hardening and lossless legacy-workbook staging.

alter table public.student_code_sequences enable row level security;
revoke all on public.student_code_sequences from anon, authenticated;

create table if not exists public.legacy_student_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id),
  enrollment_id uuid references public.enrollments(id),
  source_filename text not null,
  source_sheet text not null,
  -- OLD RECORDS has no trustworthy cohort year, so archives retain NULL
  -- instead of receiving a fabricated date.
  source_year integer check (source_year is null or source_year between 2000 and 2100),
  source_row integer not null check (source_row > 0),
  raw_data jsonb not null,
  normalized_data jsonb not null,
  import_warnings jsonb not null default '[]'::jsonb,
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now(),
  unique(source_filename, source_sheet, source_row)
);

create index if not exists legacy_records_year_idx on public.legacy_student_records(source_year);
create index if not exists legacy_records_student_idx on public.legacy_student_records(student_id);
alter table public.legacy_student_records enable row level security;
revoke all on public.legacy_student_records from anon;
-- Raw workbook rows can contain fields from several protected modules. Access
-- follows the import permission rather than the broader students.view grant.
create policy legacy_records_authorized_read on public.legacy_student_records for select
  using (public.has_permission('imports.manage'));
create policy legacy_records_authorized_manage on public.legacy_student_records for all
  using (public.has_permission('imports.manage')) with check (public.has_permission('imports.manage'));

-- Platform usernames and remarks can contain credential-like legacy values, so
-- trainers receive no direct account-row access.
create policy platform_accounts_scope_read on public.learning_platform_accounts for select
  using (public.has_permission('students.view') and not public.has_role('trainer'));
create policy platform_accounts_scope_manage on public.learning_platform_accounts for all
  using (public.has_permission('students.update') and not public.has_role('trainer'))
  with check (public.has_permission('students.update') and not public.has_role('trainer'));
create policy extensions_scope_read on public.extensions for select
  using (
    public.has_permission('students.view')
    and (
      not public.has_role('trainer')
      or public.trainer_can_access_enrollment(enrollment_id)
    )
  );
create policy extensions_scope_manage on public.extensions for all
  using (public.has_permission('students.update') and not public.has_role('trainer'))
  with check (public.has_permission('students.update') and not public.has_role('trainer'));
create policy eligibility_rules_staff_read on public.eligibility_rules for select using (public.has_permission('certificates.view'));
create policy eligibility_rules_manage on public.eligibility_rules for all using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));
create policy document_metadata_read on public.documents for select using (public.has_permission('students.view') and not public.has_role('trainer'));
create policy document_metadata_manage on public.documents for all using (public.has_permission('students.update') and not public.has_role('trainer')) with check (public.has_permission('students.update') and not public.has_role('trainer'));
create policy timeline_scope_read on public.timeline_events for select using (public.has_permission('students.view') and (not public.has_role('trainer') or public.trainer_can_access_student(student_id)));
create policy timeline_scope_write on public.timeline_events for insert
  with check (
    public.has_permission('students.update')
    and not public.has_role('trainer')
    and actor_id = auth.uid()
  );
create policy custom_field_definitions_read on public.custom_field_definitions for select using (public.has_permission('students.view'));
create policy custom_field_definitions_manage on public.custom_field_definitions for all using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));
-- custom_field_values uses a generic entity_id without an enforceable relation
-- to a trainer assignment. Keep it unavailable to trainers until entity-specific
-- policies or access functions are added.
create policy custom_field_values_read on public.custom_field_values for select
  using (public.has_permission('students.view') and not public.has_role('trainer'));
create policy custom_field_values_manage on public.custom_field_values for all
  using (public.has_permission('students.update') and not public.has_role('trainer'))
  with check (public.has_permission('students.update') and not public.has_role('trainer'));

-- Posted payments are financial records: they can be voided with attribution,
-- but not edited in place or deleted.
drop policy if exists payments_authorized_manage on public.payments;
revoke delete on public.payments from anon, authenticated;

create policy payments_authorized_insert on public.payments for insert
  with check (
    public.has_permission('fees.manage')
    and recorded_by = auth.uid()
    and status = 'Posted'
    and voided_at is null
    and voided_by is null
    and void_reason is null
  );

create policy payments_authorized_void on public.payments for update
  using (public.has_permission('fees.manage') and status = 'Posted')
  with check (
    public.has_permission('fees.manage')
    and status = 'Voided'
    and voided_by = auth.uid()
    and voided_at is not null
    and length(trim(void_reason)) >= 5
  );

create or replace function public.enforce_payment_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'Voided' then
    raise exception 'Voided payments are immutable';
  end if;

  if new.fee_account_id is distinct from old.fee_account_id
    or new.payment_date is distinct from old.payment_date
    or new.amount is distinct from old.amount
    or new.payment_method is distinct from old.payment_method
    or new.transaction_reference is distinct from old.transaction_reference
    or new.remarks is distinct from old.remarks
    or new.recorded_by is distinct from old.recorded_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Posted payment details cannot be edited; void the payment instead';
  end if;

  if new.status <> 'Voided' then
    raise exception 'The only permitted payment update is a void';
  end if;

  if auth.uid() is not null then
    new.voided_by := auth.uid();
    new.voided_at := now();
  end if;

  return new;
end;
$$;

create trigger payments_enforce_immutability
before update on public.payments
for each row execute function public.enforce_payment_immutability();

create or replace function public.audit_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_values, new_values)
  values (
    coalesce(auth.uid(), case when tg_op = 'INSERT' then new.recorded_by else new.voided_by end),
    case when tg_op = 'INSERT' then 'payment.posted' else 'payment.voided' end,
    'payment',
    new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger payments_audit_change
after insert or update on public.payments
for each row execute function public.audit_payment_change();

revoke all on function public.enforce_payment_immutability() from public;
revoke all on function public.audit_payment_change() from public;
