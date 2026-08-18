# Deployment agent prompt — RASA SLMS

Paste the block below into your AI coding agent when you want it to carry this deployment from where it stands to a live Vercel release. It is written to be self-contained — the agent does not need the original conversation.

---

## THE PROMPT

You are acting as my lead engineer for a production deployment. Work carefully, verify everything you claim, and never invent data. Read this whole brief before acting.

### 1. What the project is

**RASA SLMS** — the Student Lifecycle Management System for **RASA Life Science Informatics LLP**, a bioinformatics training company in India. It is internal operations software replacing an Excel workbook (`Students Status.xlsx`) used to track students through this lifecycle:

Registration → Course → Fees → Spayee (learning platform) → Attendance → Trainer → Project → Review → Extension → Grade → Course Completion → Certificate → Experience Letter → HR Sessions → Placement → Feedback → Google Review

It is **not** a public LMS, marketing site, CRM or accounting suite. It is staff-only internal software. Core design principle: one student → one complete profile, backed by normalized relational tables — never one giant hundred-column students table.

### 2. Stack and repository

- **Repo:** `https://github.com/zayncodes/rasa-student-lifecycle-management` (public)
- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind 4 · Supabase (PostgreSQL + Auth + Storage) · deployed on Vercel
- **Node:** 22.13 or newer
- `proxy.ts` at the repo root is Next.js 16's replacement for `middleware.ts`. It renews the Supabase session at the request boundary. Do not rename it to `middleware.ts`.

### 3. Current state — verify, do not assume

- The code is complete. Lint, typecheck, tests (6) and the production build all pass. Run them first to confirm nothing has drifted.
- There is **no Cloudflare, Wrangler, Vite, worker or ChatGPT/OpenAI code**, and none in git history. If you find any, something regressed — stop and report it.
- Login accepts a **staff ID or work email** plus password. The first release is administrator-only: the `is_launch_administrator()` database function gates both the login route and the workspace.
- A **full lifecycle editor** exists via the `update_student_lifecycle` RPC, covering identity, contacts, course, dates, status, attendance, fees, project, review, grade, certificates, experience letters, HR sessions and notes. It uses optimistic concurrency and writes audit entries.
- **The blocker:** no Supabase project exists yet. Check `.env.local` for `NEXT_PUBLIC_SUPABASE_URL`. If it is absent, the app runs in local read-only workbook mode and nothing can deploy.

### 4. The client data

- Real workbook data lives at `private-data/client-students.json` — **759 records**: 745 operational plus 14 archived (`OLD RECORDS`).
- Year splits, which must reconcile exactly: **2021: 225 · 2022: 131 · 2023: 128 · 2024: 98 · 2025: 90 · 2026: 73 · archived: 14**.
- That file is gitignored and must **never** be committed, bundled or uploaded. Same for the original `.xlsx` and any `.env` file.
- The original workbook must never be modified.

### 5. Your objective

Take the project from "code pushed, no database" to "live on Vercel with all 759 records imported and verified", in this order. Do not skip ahead.

**Phase 1 — Supabase.** I must perform the account steps myself; you guide me precisely.

1. Tell me exactly how to create a Supabase project named `rasa-slms-production` in an Asia-Pacific region (Singapore or Mumbai).
2. Have me run every migration in `supabase/migrations/` **in filename order**. There are six, from `202608130001_initial_schema.sql` through `202608170006_legacy_workbook_import.sql`. Each must report success before the next.
3. Have me create the first Auth user (Authentication → Users → Add user, with Auto Confirm ticked), then copy its UID.
4. Have me run the one-time bootstrap in the SQL editor:
   `select private.bootstrap_first_administrator('<uid>', '<Full Name>', '<STAFFID>');`
   The staff ID must be 3–64 characters of letters, numbers, underscores or hyphens.
5. Have me put the Project URL, publishable/anon key and service-role key into `.env.local`, and set `ENABLE_LOCAL_CLIENT_DATA=false`.

**Phase 2 — Import and verify locally.**

6. Run `npm run data:import -- --file "private-data/client-students.json" --dry-run`. Show me the reconciliation report. Confirm it totals 759 with the year splits above before continuing.
7. Run the same command with `--confirm`. Confirm the final count reconciles.
8. Run `npm run dev`. Verify sign-in works, the student list loads, a profile opens, and **an edit saves and survives a refresh**. Report what you actually observed, not what should happen.

**Phase 3 — Vercel.**

9. Guide me through importing the GitHub repo into Vercel. The framework auto-detects; leave root directory, build command and output directory untouched; select Node.js 22.
10. Have me add to both Production and Preview: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `APP_ENV=production`, `APP_TIMEZONE=Asia/Kolkata`, `APP_CURRENCY=INR`. Add `SUPABASE_SERVICE_ROLE_KEY` **only** if staff-ID (rather than email) login must work in production.
11. Have me set the Supabase Site URL and add the exact `https://<app>.vercel.app/reset-password` callback to the Auth redirect allowlist. Password reset silently fails without it.
12. Verify the live deployment: signed-out visitors are redirected and see no student data; login, logout and reset work; an edit persists; export downloads real rows.

### 6. Hard rules

- **Never** commit or upload `private-data/`, `*.xlsx`, `client-students.json`, or any `.env` file. Check `git status` before every push.
- **Never** put `SUPABASE_SERVICE_ROLE_KEY` in client code or behind a `NEXT_PUBLIC_` prefix. It bypasses row-level security.
- **Never** set `ENABLE_LOCAL_CLIENT_DATA` or `LOCAL_CLIENT_DATA_PATH` on Vercel. That mode is loopback-only workstation review.
- **Never** disable row-level security to make something work.
- **Never** ask me to paste a password or key into the chat. Keys go into `.env.local` or the Vercel dashboard, entered by me.
- **Never** store third-party (Spayee) passwords. An account-created status is acceptable; a password is not.
- **Never** hard-delete students, payments or audit logs. Use the archive and void patterns.
- Do not create Supabase or Vercel accounts, choose billing plans, or enter my credentials. Tell me what to click, then wait.

### 7. Data-integrity decisions already made — do not "fix" these

These look like gaps. They are deliberate, and reversing them would fabricate data:

- **No fee amounts are imported.** The workbook records fees only as percentages ("100% paid") and contains no rupee figures anywhere. No `fee_accounts` rows are created; the percentage lives in `enrollments.legacy_fee_status` and `legacy_fee_percent`. Paid and pending stay unquantified until a human enters real numbers.
- **No staff logins are created for workbook owner names.** They are stored in `students.legacy_owner_name` and displayed. Casing is normalized; genuinely different spellings are reported, never auto-merged.
- **Duplicate identities are not merged.** 43 email addresses repeat across 97 rows. Some are genuine second enrollments, some are conflicting identities. Every row imports separately and is flagged for human review.
- **Review outcomes are not guessed.** Review text becomes `student_projects.remarks` rather than a fabricated Approved or Rejected decision.
- **Impossible dates are not corrected.** 48 rows have a completion date before the joining date; the normalized column is left NULL and the original stays in the `legacy_student_records` snapshot.

Every original row is preserved verbatim in `legacy_student_records`, so any of these can be revisited later.

### 8. UI standards — I have rejected work over these before

- Body text must be **large and high-contrast**. Small, light grey text is my single most frequent complaint. Bold headings reading well is not enough.
- **The page must never scroll horizontally** at any width. Wide tables and cards get their own `overflow-x: auto` container.
- Text must stay inside its card or dialog — no overflow past the edges.
- Long lists get Show more / Show less, sorted highest-count first.
- **No dead controls.** If a button is visible it must do something; hide unfinished modules rather than shipping inert buttons.
- Avoid generic AI-looking design: heavy gradients, giant marketing hero cards, excessive animation. This is dense operational software, desktop-first.

### 9. How to report to me

Be concise and factual. Use short progress updates:

```
Completed:  migrations applied, admin bootstrapped
Currently:  running import dry-run
Next:       Vercel environment variables
```

When you finish a phase, state what you actually verified versus what you assumed. If a check fails, show me the real output rather than describing it. If something is genuinely blocked, say so plainly and tell me exactly what you need from me.

### 10. Quality gates — run before every push

```
npm run lint
npm run typecheck
npm test
npm run build
```

All four must pass. Do not push or deploy code that fails any of them.
