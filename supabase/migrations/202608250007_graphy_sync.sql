begin;

-- Graphy (Spayee) export synchronisation.
--
-- Design rule: Graphy data NEVER overwrites workbook history or staff-entered
-- values. It lands in its own dedicated columns, so the application can show
-- both sources side by side ("workbook attendance 94% / Graphy progress 78%")
-- and no import can destroy what was already recorded.
--
-- Every applied change is written to graphy_sync_changes with its previous
-- value, which makes any run fully reversible.

-- ---------------------------------------------------------------- students --
-- Graphy's own learner identifier, so a learner stays matched even if their
-- email later changes on either side.
alter table public.students add column if not exists graphy_learner_id text;
create unique index if not exists students_graphy_learner_id_unique
  on public.students (graphy_learner_id) where graphy_learner_id is not null;

-- ------------------------------------------------------------- enrollments --
alter table public.enrollments add column if not exists graphy_progress_percent numeric(5,2)
  check (graphy_progress_percent is null or graphy_progress_percent between 0 and 100);
alter table public.enrollments add column if not exists graphy_last_active_at timestamptz;
alter table public.enrollments add column if not exists graphy_synced_at timestamptz;
alter table public.enrollments add column if not exists graphy_course_name text;

-- ------------------------------------------------------------------- runs ---
create table if not exists public.graphy_sync_runs (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  source text not null default 'graphy-export',
  -- 'preview' writes nothing; 'applied' has committed its changes.
  mode text not null check (mode in ('preview', 'applied')),
  status text not null default 'Completed' check (status in ('Completed', 'Failed', 'RolledBack')),
  total_rows integer not null default 0,
  matched_rows integer not null default 0,
  unmatched_rows integer not null default 0,
  ambiguous_rows integer not null default 0,
  fields_filled integer not null default 0,
  fields_updated integer not null default 0,
  fields_unchanged integer not null default 0,
  fields_protected integer not null default 0,
  notes text,
  run_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.profiles(id)
);

create index if not exists graphy_sync_runs_started_idx on public.graphy_sync_runs (started_at desc);

-- --------------------------------------------------------------- changes ----
-- One row per field the sync touched or deliberately declined to touch. This is
-- both the human-readable report and the rollback source.
create table if not exists public.graphy_sync_changes (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.graphy_sync_runs(id) on delete cascade,
  row_number integer,
  student_id uuid references public.students(id),
  enrollment_id uuid references public.enrollments(id),
  match_key text,
  entity text not null,
  column_name text not null,
  old_value text,
  new_value text,
  action text not null check (action in ('fill', 'update', 'unchanged', 'protected', 'unmatched', 'ambiguous')),
  applied boolean not null default false,
  reverted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists graphy_sync_changes_run_idx on public.graphy_sync_changes (run_id, action);
create index if not exists graphy_sync_changes_student_idx on public.graphy_sync_changes (student_id);

-- --------------------------------------------------------------------- RLS --
alter table public.graphy_sync_runs enable row level security;
alter table public.graphy_sync_changes enable row level security;
revoke all on public.graphy_sync_runs from anon;
revoke all on public.graphy_sync_changes from anon;

-- Sync history can expose learner contact data, so it follows the import
-- permission rather than the broader students.view grant.
create policy graphy_runs_read on public.graphy_sync_runs for select
  using (public.has_permission('imports.manage'));
create policy graphy_runs_manage on public.graphy_sync_runs for all
  using (public.has_permission('imports.manage')) with check (public.has_permission('imports.manage'));
create policy graphy_changes_read on public.graphy_sync_changes for select
  using (public.has_permission('imports.manage'));
create policy graphy_changes_manage on public.graphy_sync_changes for all
  using (public.has_permission('imports.manage')) with check (public.has_permission('imports.manage'));

commit;
