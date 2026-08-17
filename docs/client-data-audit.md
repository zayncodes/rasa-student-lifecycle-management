# Client workbook audit and product fit

Source reviewed: `Students Status.xlsx` supplied on 13 August 2026. This document intentionally contains no student names, contact details, private notes, or credentials.

## Conclusion

The application direction is correct, but the workbook cannot be treated as one flat “student” table. A person may have more than one enrollment, email and phone values repeat, and several operational fields contain free-form notes rather than clean statuses. The production source of truth therefore needs separate Student and Enrollment records, with the current table/profile retained as a derived operational view.

The lossless extractor retains every populated source cell and formula before normalization. This makes later cleaning, duplicate review, re-import, and audit possible without changing the original workbook.

## Reconciled inventory

| Source sheet | Operational records |
| --- | ---: |
| 2026 | 73 |
| 2025 | 90 |
| 2024 | 98 |
| 2023 | 128 |
| 2022 | 131 |
| 2021 | 225 |
| **Operational total** | **745** |
| OLD RECORDS archive | 14 |

The workbook contains 18 sheets: six operational year sheets, one archival sheet, and eleven blank sheets. The raw audit layer retains 881 nonblank rows, 12,124 nonblank cells, and 142 formulas across all 18 sheets.

These 745 rows are enrollments/source records, not 745 unique people. Contact-key analysis produces roughly 690 provisional identities, but automatic merging would be unsafe.

## Fields that must be retained

The normalized model and source lineage need to cover:

- name, registration, joining, tentative completion, and training completion;
- raw course name, canonical programme, component certificates/modules, grade, time preference, and customized syllabus;
- owner, email, phone, platform-account status, and study-material status;
- raw fee status, payment schedule text, parsed payment information, currency, and parse confidence;
- attendance percentage and future session-level attendance;
- raw status/comment, trainer feedback, project, review, extension, and experience-letter eligibility;
- certificate status and dispatch date;
- general, video, and Google feedback;
- four HR-session fields;
- source filename, sheet, row, cell value, cached formula result, formula, and import warnings.

Third-party passwords must not be imported or exported. Only an account-created/material-assigned status should be retained.

## Material data-quality findings

- 42 normalized email values repeat, 24 phone keys repeat, and 37 normalized names repeat.
- Some repeated contacts represent legitimate second enrollments, so Student and Enrollment must remain separate.
- 14 repeated email keys are associated with different normalized names and require manual review.
- Across the 745 operational rows, 12 lack email, 76 lack phone, 42 lack registration, and 9 lack course.
- Course names have about 200 raw variants; owner names also have spelling/case variants. Both need alias management.
- Status has roughly 130 raw values and often contains operational prose. Preserve it as a note and derive a separate status code.
- Dates mix Excel dates, serials, partial dates, and free text. Store raw and parsed values with confidence; do not silently coerce uncertain entries.
- Fee values change format by year and mix percentages, amounts, dates, currencies, and completion notes. A single total/paid pair is not lossless.
- Four 2024 records have no student name but do contain enrollment/contact evidence. They are retained with missing-name warnings rather than guessed names.
- Cross-year appended blocks and continuation-only rows are retained in the raw layer but excluded from operational counts to prevent duplication.

## Product features required by the data

### Implemented in the current UI

- cohort/source-year filters on the home dashboard, student directory, and reports;
- searchable access to all 14 archival records without mixing them into operational dashboard totals;
- programme, lifecycle, trainer, search, selection, and working pagination filters;
- selected/current-filter CSV export with spreadsheet-formula neutralization;
- permission-checked, audited production export that reloads allowed rows through RLS;
- source-year cohort reporting instead of invented acquisition channels;
- authentic empty states, real attendance/timeline rendering, and removal of fictional student activity;
- authenticated Supabase boundary, sign-out, RLS foundation, private no-cache response headers;
- database-backed student creation and payment recording RPCs;
- local read-only workbook review mode for the private workstation.

### Required before full production rollout

1. A controlled staging importer that writes normalized tables and the raw `legacy_student_records` source snapshot atomically.
2. Duplicate/contact-conflict review with merge decisions and a reversible audit trail.
3. Course and staff alias managers.
4. Low-confidence date and fee review queues.
5. A multi-enrollment student profile and enrollment-level timeline.
6. Server-side filtered pagination and reporting.
7. Normalized-versus-raw export choices for authorized administrators.
8. Role-specific field shaping, particularly for fees, credentials, documents, and raw workbook notes.
9. Import reconciliation reports for year totals, programmes, fee totals, completion, projects, and certificates.
10. Expanded RLS tests and production backup/restore verification.

## Deployment gate

Do not publish the workbook or extracted JSON as a static asset. Real names, emails, phone numbers, financial information, and private notes must live in the authenticated database. Use the local read-only mode for private review, then import into staging Supabase, reconcile, test permissions, and only then deploy the invite-only production workspace.
