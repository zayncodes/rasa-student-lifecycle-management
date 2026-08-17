begin;

-- Legacy workbook import support.
--
-- The client workbook records facts this schema previously had nowhere to put
-- without inventing values. Rather than fabricate rupee amounts or create staff
-- logins that nobody asked for, the columns below preserve the workbook's own
-- wording next to the normalized data.

-- Idempotency key. The extractor assigns every workbook row a stable id such as
-- 'xlsx-2026-3' (sheet year + source row), so re-running the importer updates
-- the same student instead of creating a second copy.
alter table public.students add column if not exists legacy_source_key text;
create unique index if not exists students_legacy_source_key_unique
  on public.students (legacy_source_key) where legacy_source_key is not null;

-- The workbook's "Owner" column holds RASA staff first names (Pranjali, Sapana,
-- Dhanashri, Prasad). Those people may never receive an application login, and
-- owner_user_id -> profiles -> auth.users cannot be populated without creating
-- real accounts. The name is preserved here and used as a display fallback.
alter table public.students add column if not exists legacy_owner_name text;

-- The workbook tracks fees only as a percentage ("100% paid", "5% paid"). It
-- contains no rupee amounts anywhere, so a fee_accounts row would require
-- inventing total_course_fee. These two columns carry the real information and
-- let the UI show "100% paid" while pending/paid amounts stay unquantified.
alter table public.enrollments add column if not exists legacy_fee_status text;
alter table public.enrollments add column if not exists legacy_fee_percent numeric(5,2)
  check (legacy_fee_percent is null or legacy_fee_percent between 0 and 100);

-- Genuine repeat learners exist in the workbook: 43 email addresses appear on
-- more than one row and some are legitimate second enrollments. The strict
-- one-active-student-per-email guard still protects records created in the
-- application, but imported workbook rows are exempt and are reconciled through
-- the duplicate review report the importer prints.
drop index if exists public.students_email_active_unique;
create unique index if not exists students_email_active_unique
  on public.students (lower(email))
  where archived_at is null and email is not null and legacy_source_key is null;

create index if not exists students_legacy_owner_idx
  on public.students (legacy_owner_name) where archived_at is null;

commit;
