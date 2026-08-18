#!/usr/bin/env node
/**
 * Controlled production importer for the RASA client workbook.
 *
 * Reads the private JSON produced by `npm run data:audit` and writes normalized
 * lifecycle rows plus a lossless `legacy_student_records` snapshot into Supabase.
 *
 *   npm run data:import -- --file "C:\private\client-students.json" --dry-run
 *   npm run data:import -- --file "C:\private\client-students.json" --confirm
 *
 * Design rules this script follows:
 *   - Never invent data. Fields the workbook does not contain stay NULL and are
 *     reported as warnings rather than filled with plausible-looking values.
 *   - Idempotent. Every student carries `legacy_source_key`, so re-running
 *     updates the same rows instead of creating duplicates.
 *   - Non-destructive on re-run. Child rows (projects, certificates, HR
 *     sessions) are only created when absent, so later staff edits survive.
 *   - Service-role only. This is a server-side administrative tool; the key it
 *     uses bypasses RLS and must never reach a browser bundle.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 250;
const SOURCE_PLATFORM = "Spayee";
// Excel serial dates count from 1899-12-30 in the 1900 date system.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_SERIAL_MIN = 20000; // ~1954, below this a bare number is not a date
const EXCEL_SERIAL_MAX = 60000; // ~2064

function parseArgs(argv) {
  const args = { file: "", dryRun: false, confirm: false, importedBy: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--confirm") args.confirm = true;
    else if (arg === "--file") args.file = argv[++index] ?? "";
    else if (arg.startsWith("--file=")) args.file = arg.slice(7);
    else if (arg === "--imported-by") args.importedBy = argv[++index] ?? null;
    else if (arg.startsWith("--imported-by=")) args.importedBy = arg.slice(14);
  }
  return args;
}

function loadEnvironment() {
  for (const candidate of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.resolve(candidate));
    } catch {
      // A missing env file is fine; the variables may come from the shell.
    }
  }
}

function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/** Workbook placeholders that mean "nothing recorded", not a real value. */
function meaningful(value) {
  const trimmed = text(value);
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (["-", "--", "na", "n/a", "nil", "none", "not recorded", "."].includes(lowered)) return null;
  return trimmed;
}

function isoDate(value) {
  const trimmed = text(value);
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

/** Several workbook columns hold raw Excel serial numbers instead of dates. */
function excelSerialToIso(value) {
  const trimmed = text(value);
  if (!trimmed || !/^\d{4,6}(\.\d+)?$/.test(trimmed)) return null;
  const serial = Number(trimmed);
  if (!Number.isFinite(serial) || serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) return null;
  const date = new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86_400_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function anyDate(value) {
  return isoDate(value) ?? excelSerialToIso(value);
}

/**
 * Owner names arrive with inconsistent casing (asha / Asha / ASHA). Casing is
 * normalized because it is unambiguous; genuinely different spellings are
 * left alone and reported for the operator to merge.
 */
function normalizeOwnerName(value) {
  const trimmed = meaningful(value);
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "unassigned") return null;
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const LIFECYCLE_STATUSES = new Set(["Registered", "Active", "On Hold", "Extended", "Completed", "Dropped", "Cancelled", "Archived"]);
const COURSE_STATUS_BY_LIFECYCLE = new Map([
  ["Active", "Active"],
  ["Completed", "Completed"],
  ["On Hold", "On Hold"],
  ["Extended", "Extended"],
]);
const PROJECT_STATUSES = new Set(["Assigned", "In Progress", "Submitted", "Under Review", "Revision Required", "Completed", "Cancelled"]);
const CERTIFICATE_STATUSES = new Set(["Not Eligible", "Eligible", "Requested", "Generated", "Dispatched", "Delivered", "Cancelled"]);

function buildPlan(payload) {
  const warnings = [];
  const records = [...(payload.records ?? []), ...(payload.archivedRecords ?? [])];
  const sourceFilename = text(payload.source?.filename) ?? "Students Status.xlsx";

  const courseNameCounts = new Map();
  for (const record of records) {
    const code = text(record.courseCode) ?? "UNSPECIFIED";
    const name = text(record.course) ?? code;
    if (!courseNameCounts.has(code)) courseNameCounts.set(code, new Map());
    const counts = courseNameCounts.get(code);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const courses = [...courseNameCounts.entries()].map(([code, names]) => {
    const ranked = [...names.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    if (ranked.length > 1) {
      warnings.push({ scope: "course", code, message: `Course code has ${ranked.length} name spellings; using "${ranked[0][0]}"`, variants: ranked.map(([name]) => name) });
    }
    return {
      course_code: code,
      name: ranked[0][0],
      // The workbook records no duration or fee. These are explicit placeholders
      // that administrators can correct in Settings; the columns are NOT NULL.
      description: "Imported from the client workbook. Duration and default fee are placeholders pending confirmation.",
      standard_duration_value: 1,
      standard_duration_unit: "month",
      default_fee: 0,
      is_active: true,
    };
  });

  const students = [];
  for (const record of records) {
    const legacyKey = text(record.id);
    if (!legacyKey) {
      warnings.push({ scope: "record", code: text(record.code), message: "Row has no stable source id and was skipped" });
      continue;
    }

    const lifecycleStatus = LIFECYCLE_STATUSES.has(record.status) ? record.status : "Registered";
    if (!LIFECYCLE_STATUSES.has(record.status)) {
      warnings.push({ scope: "student", key: legacyKey, message: `Unrecognized workbook status "${record.status}"; stored as Registered` });
    }

    const joiningDate = isoDate(record.joiningDate);
    let tentativeDate = isoDate(record.tentativeCompletionDate);
    if (joiningDate && tentativeDate && tentativeDate < joiningDate) {
      warnings.push({ scope: "enrollment", key: legacyKey, message: `Tentative completion ${tentativeDate} precedes joining ${joiningDate}; stored as NULL and preserved in the raw snapshot` });
      tentativeDate = null;
    }

    // completionDate mirrors the tentative date unless the workbook recorded a
    // separate training completion, so only the latter becomes an actual date.
    const actualDate = meaningful(record.original?.trainingCompletionDate) ? isoDate(record.completionDate) : null;

    const attendance = record.attendanceRecorded === true && Number.isFinite(Number(record.attendance))
      ? Math.min(100, Math.max(0, Number(record.attendance)))
      : null;

    const courseStatus = COURSE_STATUS_BY_LIFECYCLE.get(lifecycleStatus) ?? "Not Started";
    if (!COURSE_STATUS_BY_LIFECYCLE.has(lifecycleStatus)) {
      warnings.push({ scope: "enrollment", key: legacyKey, message: `Workbook records no course progress for a "${lifecycleStatus}" row; course status stored as Not Started` });
    }

    const certificateStatus = CERTIFICATE_STATUSES.has(record.certificateStatus) ? record.certificateStatus : "Not Eligible";
    const projectStatus = PROJECT_STATUSES.has(record.projectStatus) ? record.projectStatus : "Assigned";

    const experienceRaw = meaningful(record.experienceLetterEligibility);
    let experienceLetter = null;
    if (experienceRaw) {
      const issuedOn = anyDate(experienceRaw);
      if (issuedOn) {
        experienceLetter = { status: "Issued", issued_at: `${issuedOn}T00:00:00Z`, eligibility_status: "Imported" };
      } else if (/^(no|not eligible)$/i.test(experienceRaw)) {
        experienceLetter = { status: "Not Eligible", issued_at: null, eligibility_status: "Imported" };
      } else {
        warnings.push({ scope: "experience_letter", key: legacyKey, message: `Unreadable experience-letter value "${experienceRaw}"; stored as Not Eligible` });
        experienceLetter = { status: "Not Eligible", issued_at: null, eligibility_status: "Imported" };
      }
    }

    const hrSessions = [];
    (record.hrSessions ?? []).forEach((value, index) => {
      const raw = meaningful(value);
      if (!raw) return;
      const completedOn = anyDate(raw);
      hrSessions.push({
        session_type: "HR Session",
        sequence_number: index + 1,
        status: completedOn ? "Completed" : "Pending",
        completed_at: completedOn ? `${completedOn}T00:00:00Z` : null,
        notes: completedOn ? null : raw,
      });
      if (!completedOn) {
        warnings.push({ scope: "hr_session", key: legacyKey, message: `HR session ${index + 1} holds free text "${raw}"; stored as Pending with the note preserved` });
      }
    });

    const platformStatus = text(record.platformStatus) ?? "Not Created";
    const feePercent = Number.isFinite(Number(record.feePaidPercent)) && meaningful(record.feePaidPercent) !== null
      ? Math.min(100, Math.max(0, Number(record.feePaidPercent)))
      : null;

    const { original, ...normalized } = record;
    students.push({
      legacyKey,
      student: {
        legacy_source_key: legacyKey,
        student_code: text(record.code),
        full_name: text(record.name) ?? "Unnamed student",
        email: text(record.email)?.toLowerCase() ?? null,
        contact_number: text(record.phone),
        registration_date: isoDate(record.registrationDate),
        lifecycle_status: lifecycleStatus,
        legacy_owner_name: normalizeOwnerName(record.owner),
        notes: meaningful(record.notes),
      },
      enrollment: {
        course_code: text(record.courseCode) ?? "UNSPECIFIED",
        joining_date: joiningDate,
        tentative_completion_date: tentativeDate,
        actual_completion_date: actualDate,
        course_status: courseStatus,
        time_requirement: meaningful(record.timeRequirement),
        course_remarks: meaningful(record.comment),
        course_name_snapshot: text(record.course) ?? text(record.courseCode) ?? "Course not recorded",
        course_code_snapshot: text(record.courseCode) ?? "UNSPECIFIED",
        standard_fee_snapshot: 0,
        legacy_attendance_percentage: attendance,
        legacy_fee_status: meaningful(record.feesStatus),
        legacy_fee_percent: feePercent,
      },
      platform: {
        platform_name: SOURCE_PLATFORM,
        status: platformStatus,
        account_created: platformStatus !== "Not Created",
        study_material_assigned: /material assigned/i.test(platformStatus),
      },
      project: {
        project_name: meaningful(record.project) ?? "Not recorded",
        project_details: meaningful(record.projectDetails),
        project_status: projectStatus,
        deadline: isoDate(record.projectDeadline),
        grade: meaningful(record.grade),
        // The workbook has no review outcome, and project_reviews.outcome is a
        // constrained NOT NULL column, so review text is kept as project remarks
        // instead of fabricating an Approved/Rejected decision.
        remarks: meaningful(record.reviewDetails),
      },
      certificate: {
        status: certificateStatus,
        eligibility_status: "Imported",
        dispatched_at: isoDate(record.certificateDispatchedDate) ? `${isoDate(record.certificateDispatchedDate)}T00:00:00Z` : null,
      },
      experienceLetter,
      hrSessions,
      legacy: {
        source_filename: sourceFilename,
        source_sheet: text(record.sourceSheet) ?? "Unknown sheet",
        source_year: Number.isInteger(record.sourceYear) ? record.sourceYear : null,
        source_row: Number.isInteger(record.sourceRow) ? record.sourceRow : 0,
        raw_data: original ?? {},
        normalized_data: normalized,
        import_warnings: record.importWarnings ?? [],
      },
    });
  }

  return { courses, students, warnings, sourceFilename };
}

function reconciliation(plan, payload) {
  const byYear = new Map();
  for (const entry of plan.students) {
    const year = entry.legacy.source_year ?? "Archived (no cohort year)";
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }
  const emails = new Map();
  for (const entry of plan.students) {
    const email = entry.student.email;
    if (!email) continue;
    emails.set(email, (emails.get(email) ?? 0) + 1);
  }
  const duplicateEmails = [...emails.entries()].filter(([, count]) => count > 1);
  const owners = new Map();
  for (const entry of plan.students) {
    const owner = entry.student.legacy_owner_name ?? "Unassigned";
    owners.set(owner, (owners.get(owner) ?? 0) + 1);
  }
  return {
    expectedOperational: payload.source?.operationalCount ?? (payload.records ?? []).length,
    expectedArchived: payload.source?.archivedCount ?? (payload.archivedRecords ?? []).length,
    planned: plan.students.length,
    byYear: [...byYear.entries()].sort((left, right) => String(right[0]).localeCompare(String(left[0]))),
    duplicateEmails,
    owners: [...owners.entries()].sort((left, right) => right[1] - left[1]),
  };
}

function printReport(plan, summary) {
  console.log("\n=== Workbook reconciliation ===");
  console.log(`Source file        : ${plan.sourceFilename}`);
  console.log(`Expected records   : ${summary.expectedOperational} operational + ${summary.expectedArchived} archived = ${summary.expectedOperational + summary.expectedArchived}`);
  console.log(`Planned for import : ${summary.planned}`);
  console.log(`Course masters     : ${plan.courses.length}`);
  console.log("\nRecords by source year:");
  for (const [year, count] of summary.byYear) console.log(`  ${String(year).padEnd(28)} ${count}`);
  console.log("\nOwner names (casing normalized, review differing spellings):");
  for (const [owner, count] of summary.owners) console.log(`  ${owner.padEnd(28)} ${count}`);
  console.log(`\nDuplicate email addresses: ${summary.duplicateEmails.length} (covering ${summary.duplicateEmails.reduce((total, [, count]) => total + count, 0)} rows)`);
  console.log("  These are imported as separate students and need manual duplicate review.");

  const grouped = new Map();
  for (const warning of plan.warnings) grouped.set(warning.scope, (grouped.get(warning.scope) ?? 0) + 1);
  console.log(`\nImport warnings: ${plan.warnings.length}`);
  for (const [scope, count] of [...grouped.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${scope.padEnd(20)} ${count}`);
  }
  if (summary.planned !== summary.expectedOperational + summary.expectedArchived) {
    console.log("\nWARNING: planned count does not match the workbook totals. Resolve before importing.");
  }
}

async function chunked(rows, handler) {
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    await handler(rows.slice(index, index + BATCH_SIZE));
  }
}

function fail(message, error) {
  console.error(`\n${message}`);
  if (error) console.error(error.message ?? error);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvironment();

  if (!args.file) fail("Usage: npm run data:import -- --file <client-students.json> [--dry-run|--confirm]");

  let payload;
  try {
    payload = JSON.parse(await fs.readFile(path.resolve(args.file), "utf8"));
  } catch (error) {
    fail(`Could not read the extracted workbook JSON at ${args.file}.`, error);
  }

  const plan = buildPlan(payload);
  const summary = reconciliation(plan, payload);
  printReport(plan, summary);

  if (args.dryRun || !args.confirm) {
    console.log("\nDry run only. Nothing was written. Re-run with --confirm to import.");
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (put them in .env.local, never in source control).");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`\nImporting into ${supabaseUrl} ...`);

  // 1. Course masters.
  const { error: courseError } = await supabase.from("courses").upsert(plan.courses, { onConflict: "course_code" });
  if (courseError) fail("Course import failed.", courseError);
  const { data: courseRows, error: courseReadError } = await supabase.from("courses").select("id, course_code");
  if (courseReadError) fail("Could not read back course ids.", courseReadError);
  const courseIdByCode = new Map(courseRows.map((row) => [row.course_code, row.id]));
  console.log(`  courses                 ${plan.courses.length}`);

  // 2. Students, keyed for idempotent re-runs.
  await chunked(plan.students.map((entry) => entry.student), async (batch) => {
    const { error } = await supabase.from("students").upsert(batch, { onConflict: "legacy_source_key" });
    if (error) fail("Student import failed.", error);
  });
  const studentIdByKey = new Map();
  await chunked(plan.students, async (batch) => {
    const { data, error } = await supabase
      .from("students")
      .select("id, legacy_source_key")
      .in("legacy_source_key", batch.map((entry) => entry.legacyKey));
    if (error) fail("Could not read back student ids.", error);
    for (const row of data) studentIdByKey.set(row.legacy_source_key, row.id);
  });
  console.log(`  students                ${studentIdByKey.size}`);

  // 3. Enrollments. Existing rows are updated so staff edits are not duplicated.
  const studentIds = [...studentIdByKey.values()];
  const enrollmentIdByStudent = new Map();
  await chunked(studentIds, async (batch) => {
    const { data, error } = await supabase.from("enrollments").select("id, student_id").in("student_id", batch);
    if (error) fail("Could not read existing enrollments.", error);
    for (const row of data) if (!enrollmentIdByStudent.has(row.student_id)) enrollmentIdByStudent.set(row.student_id, row.id);
  });

  const newEnrollments = [];
  for (const entry of plan.students) {
    const studentId = studentIdByKey.get(entry.legacyKey);
    if (!studentId) continue;
    const courseId = courseIdByCode.get(entry.enrollment.course_code);
    if (!courseId) {
      plan.warnings.push({ scope: "enrollment", key: entry.legacyKey, message: `Course ${entry.enrollment.course_code} missing; enrollment skipped` });
      continue;
    }
    const { course_code: _ignored, ...columns } = entry.enrollment;
    const existingId = enrollmentIdByStudent.get(studentId);
    if (existingId) {
      const { error } = await supabase.from("enrollments").update(columns).eq("id", existingId);
      if (error) fail(`Enrollment update failed for ${entry.legacyKey}.`, error);
    } else {
      newEnrollments.push({ entry, row: { student_id: studentId, course_id: courseId, ...columns } });
    }
  }
  await chunked(newEnrollments, async (batch) => {
    const { data, error } = await supabase.from("enrollments").insert(batch.map((item) => item.row)).select("id, student_id");
    if (error) fail("Enrollment import failed.", error);
    for (const row of data) enrollmentIdByStudent.set(row.student_id, row.id);
  });
  console.log(`  enrollments             ${enrollmentIdByStudent.size}`);

  // 4. Child lifecycle rows, created only where absent.
  const enrollmentIdByKey = new Map();
  for (const entry of plan.students) {
    const studentId = studentIdByKey.get(entry.legacyKey);
    const enrollmentId = studentId ? enrollmentIdByStudent.get(studentId) : null;
    if (enrollmentId) enrollmentIdByKey.set(entry.legacyKey, enrollmentId);
  }
  const allEnrollmentIds = [...enrollmentIdByKey.values()];

  async function existingFor(table) {
    const seen = new Set();
    await chunked(allEnrollmentIds, async (batch) => {
      const { data, error } = await supabase.from(table).select("enrollment_id").in("enrollment_id", batch);
      if (error) fail(`Could not read existing ${table}.`, error);
      for (const row of data) seen.add(row.enrollment_id);
    });
    return seen;
  }

  const [havePlatform, haveProject, haveCertificate, haveExperience, haveHr] = await Promise.all([
    existingFor("learning_platform_accounts"),
    existingFor("student_projects"),
    existingFor("certificates"),
    existingFor("experience_letters"),
    existingFor("hr_sessions"),
  ]);

  const platformRows = [];
  const projectRows = [];
  const certificateRows = [];
  const experienceRows = [];
  const hrRows = [];
  const legacyRows = [];

  for (const entry of plan.students) {
    const enrollmentId = enrollmentIdByKey.get(entry.legacyKey);
    const studentId = studentIdByKey.get(entry.legacyKey);
    if (!enrollmentId || !studentId) continue;
    if (!havePlatform.has(enrollmentId)) platformRows.push({ enrollment_id: enrollmentId, ...entry.platform });
    if (!haveProject.has(enrollmentId)) projectRows.push({ enrollment_id: enrollmentId, ...entry.project });
    if (!haveCertificate.has(enrollmentId)) certificateRows.push({ enrollment_id: enrollmentId, ...entry.certificate });
    if (entry.experienceLetter && !haveExperience.has(enrollmentId)) experienceRows.push({ enrollment_id: enrollmentId, ...entry.experienceLetter });
    if (!haveHr.has(enrollmentId)) for (const session of entry.hrSessions) hrRows.push({ enrollment_id: enrollmentId, ...session });
    legacyRows.push({ student_id: studentId, enrollment_id: enrollmentId, imported_by: args.importedBy, ...entry.legacy });
  }

  const childTables = [
    ["learning_platform_accounts", platformRows],
    ["student_projects", projectRows],
    ["certificates", certificateRows],
    ["experience_letters", experienceRows],
    ["hr_sessions", hrRows],
  ];
  for (const [table, rows] of childTables) {
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(23)} 0 (already present or not recorded)`);
      continue;
    }
    await chunked(rows, async (batch) => {
      const { error } = await supabase.from(table).insert(batch);
      if (error) fail(`${table} import failed.`, error);
    });
    console.log(`  ${table.padEnd(23)} ${rows.length}`);
  }

  // 5. Lossless workbook snapshot.
  await chunked(legacyRows, async (batch) => {
    const { error } = await supabase.from("legacy_student_records").upsert(batch, { onConflict: "source_filename,source_sheet,source_row" });
    if (error) fail("Legacy snapshot import failed.", error);
  });
  console.log(`  legacy_student_records  ${legacyRows.length}`);

  const { count, error: countError } = await supabase.from("students").select("id", { count: "exact", head: true }).not("legacy_source_key", "is", null);
  if (countError) fail("Could not verify the imported student count.", countError);

  console.log("\n=== Import complete ===");
  console.log(`Imported students in database : ${count}`);
  console.log(`Expected from workbook        : ${summary.expectedOperational + summary.expectedArchived}`);
  if (count !== summary.expectedOperational + summary.expectedArchived) {
    console.log("MISMATCH: investigate before treating this import as reconciled.");
    process.exitCode = 2;
  } else {
    console.log("Counts reconcile.");
  }
  console.log(`\nStill needing manual review: ${summary.duplicateEmails.length} duplicate emails, ${plan.warnings.length} import warnings.`);
}

await main();
