# RASA Student Lifecycle Management System

RASA SLMS is an internal operations application for RASA Life Science Informatics LLP. It is designed to replace spreadsheet-centred tracking with one student lifecycle covering registration, course delivery, fees, attendance, projects, certificates, experience letters, HR sessions, placement and feedback.

## Current readiness

- Fictional student rows have been removed from the application bundle.
- The runtime is a standard Next.js application deployable to Vercel. No Cloudflare Workers, Wrangler, Vite or third-party hosting code remains.
- Staff sign in with a staff ID **or** work email plus a password. The first release is administrator-only: `is_launch_administrator` gates both the login route and the workspace.
- Sessions are renewed at the request boundary in `proxy.ts` (the Next.js 16 name for middleware).
- When Supabase is configured, the main workspace verifies the current Supabase user on the server and database reads remain subject to row-level security (RLS).
- When Supabase is not configured, the application shows an empty setup screen and does not render a student workspace.
- Student creation, payment posting and the full lifecycle editor use transactional database functions with permission checks, optimistic concurrency and audit entries. The editor covers identity, contacts, course, dates, status, attendance, fees, project, review, grade, certificates, experience letters, HR sessions and notes.
- `scripts/import-client-workbook.mjs` (`data:audit`) is lossless extraction tooling. `scripts/import-to-supabase.mjs` (`data:import`) is the controlled production importer.
- Local read-only review exports the rows already loaded from the private local file. Database-backed exports use a permission-checked, audited server endpoint that reloads the requested rows through RLS.

## Prerequisites

- Node.js 22.13 or newer
- Separate staging and production Supabase projects for PostgreSQL, Auth and private document storage
- Supabase CLI for migrations and RLS tests

## Local setup

1. Copy `.env.example` to `.env.local` and supply the browser-safe Supabase URL and publishable key.
2. Install dependencies with `npm install`.
3. Apply every migration in `supabase/migrations` to a non-production project.
4. Start the application with `npm run dev`.

Do not use the production Supabase project for local development. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never be imported by a client component, prefixed with `NEXT_PUBLIC_`, or added to source control.

### Private read-only workbook review

After running `data:audit`, you can inspect the real records locally without copying them into the website bundle. In `.env.local`, set `APP_ENV=development`, `ENABLE_LOCAL_CLIENT_DATA=true`, and `LOCAL_CLIENT_DATA_PATH` to the absolute path of the private extracted JSON, then start the development server on the loopback address. The register includes all 745 operational records plus the 14 `OLD RECORDS` entries marked as archives; archives remain excluded from operational dashboard totals. This mode is read-only and is forcibly unavailable in production builds or when `APP_ENV=production`. Do not use it as an online deployment mode.

## Database files

Apply these in order:

- Base schema and RBAC: `supabase/migrations/202608130001_initial_schema.sql`
- Import staging and RLS hardening: `supabase/migrations/202608130002_client_import_and_security.sql`
- Transactional workspace mutations: `supabase/migrations/202608130003_persist_workspace_mutations.sql`
- Production auth, launch gate and audit: `supabase/migrations/202608170004_production_auth_and_audit.sql`
- Student lifecycle editor: `supabase/migrations/202608170005_student_lifecycle_editor.sql`
- Legacy workbook import support: `supabase/migrations/202608170006_legacy_workbook_import.sql`
- RLS test: `supabase/tests/rls.sql`

The migrations provide normalized lifecycle entities, concurrency-safe `RASA-YYYY-NNNNNN` codes, RBAC helpers, trainer assignment scoping, private document storage and deny-by-default RLS. The role hierarchy is an initial foundation; it still requires production smoke tests for every role and direct database access path.

## Client workbook workflow

1. Retain the original workbook unchanged in private storage outside this repository.
2. Extract values into a private ignored directory and review duplicate identities, uncertain dates, course aliases, fee parsing and credential-like fields.
3. Never import or export third-party passwords. A status showing that a learning-platform account was created is acceptable; a password is not.
4. Apply the migrations to staging.
5. Use a controlled server-side importer to create normalized rows and the corresponding `legacy_student_records` source snapshot in one reconciled workflow.
6. Reconcile source-row counts, year counts, course totals, fee totals, completion totals and duplicate decisions before production import.
7. Back up production and test restore before the final import.

The included `data:audit` script uses the project's portable ExcelJS dependency to produce a private JSON audit artifact: `npm run data:audit -- "C:\path\to\Students Status.xlsx" "C:\private\client-students.json"`. It remains audit tooling rather than a database-import command. Cohort-sheet year and registration/joining year are different reporting dimensions and must remain separate.

### Production import

`npm run data:import` writes the extracted JSON into Supabase. Always dry-run first:

```text
npm run data:import -- --file "C:\private\client-students.json" --dry-run
npm run data:import -- --file "C:\private\client-students.json" --confirm
```

The dry run prints a reconciliation report — records per source year, owner-name variants, duplicate email addresses and every import warning — and writes nothing. Review it before using `--confirm`.

The importer requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. The service-role key bypasses RLS, so this is a workstation-only administrative command; never run it from the deployed application and never commit the key.

What it deliberately does **not** do:

- It does not invent money. The workbook records fees only as percentages ("100% paid"), so no `fee_accounts` rows are created. The percentage is preserved in `enrollments.legacy_fee_status` and `legacy_fee_percent`, and pending/paid amounts stay unquantified.
- It does not create staff logins. Workbook owner names are normalized for casing and stored in `students.legacy_owner_name`; differing spellings are reported rather than merged.
- It does not fabricate review outcomes. Review text becomes `student_projects.remarks` because `project_reviews.outcome` is a constrained column the workbook has no value for.
- It does not merge duplicate identities. Repeated email addresses are imported as separate students and reported for manual review.
- Where a tentative completion date precedes the joining date, the normalized column is left NULL and the original value stays in the `legacy_student_records` snapshot.

Re-running is safe. Students are keyed by `legacy_source_key`, so a second run updates the same rows, and child lifecycle rows are only created when absent so later staff edits are preserved.

## Private Vercel deployment

1. **Create the Supabase project.** In the Supabase dashboard create a project, choose a region close to the users (Asia-Pacific for RASA) and store the database password in a password manager. Copy the Project URL and the publishable/anon key from Project Settings → API.
2. **Apply the migrations.** Run every file in `supabase/migrations` in filename order, either with the Supabase CLI (`supabase db push`) or by pasting each file into the SQL Editor in order.
3. **Create the first administrator.** Add the user in Authentication → Users, then create the matching `profiles` row (including `login_id` if staff-ID sign-in is wanted) and assign `super_admin` through `private.bootstrap_first_administrator`. Never hard-code a password or commit one.
4. **Verify locally.** Put the project URL, publishable key and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, set `ENABLE_LOCAL_CLIENT_DATA=false`, then `npm run dev` and confirm sign-in, the workspace and an edit all work against the real project.
5. **Import and reconcile.** Dry-run `data:import`, review the reconciliation report, then `--confirm`. Check the year totals against the workbook before continuing.
6. **Push to Git.** Push the repository to a private repository. `.gitignore` already excludes `.env*`, `/private-data/`, `*.xlsx` and `client-students.json`; confirm `git status` shows no client data before the first push.
7. **Import into Vercel.** Vercel detects Next.js automatically; keep the project root at the repository root, use the standard `npm run build`, and select Node.js 22. Do not set a custom output directory or install command.
8. **Configure environment variables.** Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `APP_ENV=production`, `APP_TIMEZONE` and `APP_CURRENCY` to the Preview and Production environments. Never add `LOCAL_CLIENT_DATA_PATH`, never enable `ENABLE_LOCAL_CLIENT_DATA`, and never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code. The service-role key is only needed on the deployment if staff-ID (rather than email) sign-in must work in production.
9. **Set the auth redirects.** Add the exact Preview and Production `/reset-password` URLs to the Supabase Auth redirect allowlist and set the Site URL. Set `NEXT_PUBLIC_APP_URL` to the canonical application URL.
10. **Verify the Preview deployment.** Confirm anonymous `/` requests cannot reach the workspace, that login/logout/reset work, that static JavaScript contains no student rows, and that disabled or unassigned users receive no records.
11. **Test RLS directly.** Exercise Super Admin, Admin, HR and Trainer paths, including cross-student access, fees, documents, exports and mutations, against the database rather than only the UI.
12. **Promote to Production** only after client sign-off, a backup/restore test and an audit of the final production build.

Fine-grained hierarchy can be expanded later, but a real-data release must remain invite-only and authenticated. For the first release, restrict accounts to reviewed administrators until role-specific field shaping and export authorization are complete.

## Quality checks

```text
npm run lint
npm run typecheck
npm test
npm run build
```

The client-data findings are in `docs/client-data-audit.md`. Architecture and operating notes are in `docs/architecture.md`, `docs/database-schema.md`, `docs/permissions.md` and `docs/workflows.md`.
