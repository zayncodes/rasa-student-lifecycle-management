#!/usr/bin/env node
/**
 * Graphy (Spayee) export -> RASA SLMS synchronisation.
 *
 *   npm run graphy:sync -- --file "C:\path\Graphy Learners.csv"            (preview)
 *   npm run graphy:sync -- --file "C:\path\Graphy Learners.csv" --confirm  (apply)
 *   npm run graphy:sync -- --rollback <run-id>                             (undo a run)
 *   npm run graphy:sync -- --history                                       (list runs)
 *
 * Safety model
 * ------------
 *  1. Graphy data lands in dedicated graphy_* columns. Workbook history and
 *     staff-entered values are never overwritten by construction.
 *  2. Shared columns are only ever FILLED when empty. A differing value is
 *     reported as "protected" and left alone unless --allow-overwrite is given.
 *  3. Nothing is written without --confirm. The preview is the same code path.
 *  4. Every applied change stores its previous value, so any run is reversible
 *     with --rollback.
 *  5. A learner whose email matches more than one student is never guessed at;
 *     it is reported as ambiguous and skipped.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PAGE = 1000;

/* ------------------------------------------------------------------ args -- */

function parseArgs(argv) {
  const args = { file: "", confirm: false, rollback: "", history: false, allowOverwrite: false, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--confirm") args.confirm = true;
    else if (a === "--history") args.history = true;
    else if (a === "--allow-overwrite") args.allowOverwrite = true;
    else if (a === "--file") args.file = argv[++i] ?? "";
    else if (a.startsWith("--file=")) args.file = a.slice(7);
    else if (a === "--rollback") args.rollback = argv[++i] ?? "";
    else if (a.startsWith("--rollback=")) args.rollback = a.slice(11);
    else if (a === "--limit") args.limit = Number(argv[++i] ?? 0);
  }
  return args;
}

function fail(message, error) {
  console.error(`\n${message}`);
  if (error) console.error(error.message ?? error);
  process.exit(1);
}

/* ------------------------------------------------------------- file input -- */

/** Minimal RFC4180 CSV reader: handles quoted fields, embedded commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

async function readTable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv" || ext === ".txt" || ext === ".tsv") {
    const raw = await fs.readFile(filePath, "utf8");
    const rows = parseCsv(ext === ".tsv" ? raw.replace(/\t/g, ",") : raw);
    if (rows.length === 0) fail("The export file is empty.");
    return { headers: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
  }
  if (ext === ".xlsx" || ext === ".xls") {
    let ExcelJS;
    try { ExcelJS = (await import("exceljs")).default; }
    catch { fail("Reading .xlsx needs the exceljs dependency. Export as CSV instead, or run npm install."); }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sheet = wb.worksheets[0];
    if (!sheet) fail("The workbook has no sheets.");
    const out = [];
    sheet.eachRow((r) => {
      const values = [];
      r.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        values.push(v == null ? "" : (typeof v === "object" && v.text ? v.text : (v.result ?? v)));
      });
      out.push(values.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))));
    });
    if (out.length === 0) fail("The sheet is empty.");
    return { headers: out[0].map((h) => String(h).trim()), rows: out.slice(1) };
  }
  fail(`Unsupported file type "${ext}". Export from Graphy as CSV or XLSX.`);
}

/* ------------------------------------------------------- column detection -- */

// Graphy's export headers vary by report and change over time, so each field
// is matched against several aliases rather than one fixed column name.
const FIELD_ALIASES = {
  learnerId: ["learner id", "learnerid", "user id", "userid", "id", "student id"],
  email: ["email", "email id", "email address", "learner email", "user email"],
  name: ["name", "learner name", "full name", "student name", "user name"],
  phone: ["phone", "mobile", "phone number", "mobile number", "contact", "contact number"],
  courseName: ["course", "course name", "product", "product name", "batch", "program", "programme"],
  progress: ["progress", "progress %", "progress percent", "completion", "completion %",
    "course progress", "completion percentage", "percent completed", "% completed"],
  lastActive: ["last active", "last active on", "last accessed", "last login", "last seen", "last activity"],
  enrolledAt: ["enrolled on", "enrolled at", "enrollment date", "enrolment date", "date enrolled", "joined on"],
  accountStatus: ["status", "account status", "learner status", "state"],
};

function normalizeHeader(h) {
  return String(h).toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

function detectMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let index = normalized.findIndex((h, i) => !used.has(i) && aliases.includes(h));
    if (index === -1) {
      index = normalized.findIndex((h, i) => !used.has(i) && aliases.some((a) => h.includes(a)));
    }
    if (index !== -1) { mapping[field] = index; used.add(index); }
  }
  return mapping;
}

/* -------------------------------------------------------------- coercion -- */

function text(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" || t.toLowerCase() === "null" || t === "-" ? null : t;
}

function percent(v) {
  const t = text(v);
  if (!t) return null;
  const n = Number(t.replace("%", "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function timestamp(v) {
  const t = text(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* -------------------------------------------------------------- database -- */

function connect() {
  for (const f of [".env.local", ".env"]) {
    try { process.loadEnvFile(path.resolve(f)); } catch { /* may come from the shell */ }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
    fail(`NEXT_PUBLIC_SUPABASE_URL looks wrong: ${url}\nIt must be the API host (https://<ref>.supabase.co), not the dashboard address.`);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function loadAll(supabase, table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) fail(`Could not read ${table}.`, error);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/* ------------------------------------------------------------------ plan -- */

const GRAPHY_OWNED = new Set([
  "graphy_learner_id", "graphy_progress_percent", "graphy_last_active_at",
  "graphy_course_name", "graphy_synced_at",
]);

function sameValue(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
}

function classify(column, current, proposed, allowOverwrite) {
  if (proposed === null || proposed === undefined) return null;
  if (sameValue(current, proposed)) return "unchanged";
  const isEmpty = current === null || current === undefined || String(current).trim() === "";
  if (GRAPHY_OWNED.has(column)) return isEmpty ? "fill" : "update";
  if (isEmpty) return "fill";
  return allowOverwrite ? "update" : "protected";
}

function buildPlan({ rows, mapping, students, enrollmentsByStudent, allowOverwrite, limit }) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byGraphyId = new Map();
  for (const s of students) {
    if (s.email) {
      const k = s.email.trim().toLowerCase();
      if (!byEmail.has(k)) byEmail.set(k, []);
      byEmail.get(k).push(s);
    }
    if (s.contact_number) {
      const k = s.contact_number.replace(/\D/g, "").slice(-10);
      if (k.length === 10) {
        if (!byPhone.has(k)) byPhone.set(k, []);
        byPhone.get(k).push(s);
      }
    }
    if (s.graphy_learner_id) byGraphyId.set(String(s.graphy_learner_id), [s]);
  }

  const changes = [];
  const stats = { total: 0, matched: 0, unmatched: 0, ambiguous: 0 };
  const cell = (row, field) => (mapping[field] === undefined ? null : row[mapping[field]]);

  const limited = limit > 0 ? rows.slice(0, limit) : rows;
  limited.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for zero-index, +1 for the header row
    stats.total += 1;

    const email = text(cell(row, "email"))?.toLowerCase() ?? null;
    const learnerId = text(cell(row, "learnerId"));
    const phoneKey = (text(cell(row, "phone")) ?? "").replace(/\D/g, "").slice(-10);
    const matchKey = email || learnerId || phoneKey || `row ${rowNumber}`;

    let candidates =
      (learnerId && byGraphyId.get(String(learnerId))) ||
      (email && byEmail.get(email)) ||
      (phoneKey.length === 10 && byPhone.get(phoneKey)) ||
      null;

    if (!candidates || candidates.length === 0) {
      stats.unmatched += 1;
      changes.push({ rowNumber, matchKey, entity: "student", column: "-", action: "unmatched",
        oldValue: null, newValue: text(cell(row, "name")) });
      return;
    }
    if (candidates.length > 1) {
      stats.ambiguous += 1;
      changes.push({ rowNumber, matchKey, entity: "student", column: "-", action: "ambiguous",
        oldValue: `${candidates.length} students share this identifier`, newValue: text(cell(row, "name")) });
      return;
    }

    const student = candidates[0];
    stats.matched += 1;
    const enrollment = (enrollmentsByStudent.get(student.id) ?? [])[0] ?? null;

    const push = (entity, entityId, column, current, proposed) => {
      const action = classify(column, current, proposed, allowOverwrite);
      if (!action) return;
      changes.push({
        rowNumber, matchKey, studentId: student.id, enrollmentId: entity === "enrollment" ? entityId : null,
        entity, column, action,
        oldValue: current === null || current === undefined ? null : String(current),
        newValue: String(proposed),
      });
    };

    push("student", student.id, "graphy_learner_id", student.graphy_learner_id, learnerId);

    if (enrollment) {
      push("enrollment", enrollment.id, "graphy_progress_percent", enrollment.graphy_progress_percent, percent(cell(row, "progress")));
      push("enrollment", enrollment.id, "graphy_last_active_at", enrollment.graphy_last_active_at, timestamp(cell(row, "lastActive")));
      push("enrollment", enrollment.id, "graphy_course_name", enrollment.graphy_course_name, text(cell(row, "courseName")));
    }
  });

  return { changes, stats };
}

/* ---------------------------------------------------------------- report -- */

function report({ headers, mapping, changes, stats, applied }) {
  console.log("\n=== Column detection ===");
  for (const field of Object.keys(FIELD_ALIASES)) {
    const i = mapping[field];
    console.log(`  ${field.padEnd(14)} ${i === undefined ? "— not found in this export" : `"${headers[i]}"`}`);
  }
  const missing = ["email", "learnerId"].every((f) => mapping[f] === undefined);
  if (missing) console.log("\n  WARNING: neither an email nor a learner id column was found. Nothing can be matched.");

  const byAction = {};
  for (const c of changes) byAction[c.action] = (byAction[c.action] ?? 0) + 1;

  console.log("\n=== Rows ===");
  console.log(`  total in file      ${stats.total}`);
  console.log(`  matched            ${stats.matched}`);
  console.log(`  unmatched          ${stats.unmatched}   (learner not in RASA SLMS)`);
  console.log(`  ambiguous          ${stats.ambiguous}   (identifier shared by several students - skipped)`);

  console.log("\n=== Field changes ===");
  console.log(`  fill (was empty)   ${byAction.fill ?? 0}`);
  console.log(`  update             ${byAction.update ?? 0}`);
  console.log(`  unchanged          ${byAction.unchanged ?? 0}`);
  console.log(`  protected          ${byAction.protected ?? 0}   (existing value differs - left untouched)`);

  const interesting = changes.filter((c) => c.action === "fill" || c.action === "update" || c.action === "protected");
  if (interesting.length > 0) {
    console.log(`\n=== What would change (first 25 of ${interesting.length}) ===`);
    for (const c of interesting.slice(0, 25)) {
      const from = c.oldValue === null ? "(empty)" : c.oldValue;
      console.log(`  [${c.action.padEnd(9)}] ${String(c.matchKey).padEnd(32)} ${c.entity}.${c.column}`);
      console.log(`${" ".repeat(14)}${from}  ->  ${c.newValue}`);
    }
  }

  const unmatched = changes.filter((c) => c.action === "unmatched");
  if (unmatched.length > 0) {
    console.log(`\n=== Unmatched learners (first 15 of ${unmatched.length}) ===`);
    for (const c of unmatched.slice(0, 15)) console.log(`  row ${String(c.rowNumber).padEnd(6)} ${c.matchKey}  ${c.newValue ?? ""}`);
    console.log("  These are NOT created automatically. Review them and add deliberately if they belong.");
  }

  if (!applied) {
    console.log("\nPREVIEW ONLY - nothing was written. Re-run with --confirm to apply.");
    console.log("Protected fields stay untouched unless you also pass --allow-overwrite.");
  }
}

/* ----------------------------------------------------------------- apply -- */

async function apply(supabase, { filename, changes, stats, allowOverwrite }) {
  const { data: run, error: runError } = await supabase.from("graphy_sync_runs").insert({
    filename, mode: "applied", total_rows: stats.total,
    matched_rows: stats.matched, unmatched_rows: stats.unmatched, ambiguous_rows: stats.ambiguous,
    fields_filled: changes.filter((c) => c.action === "fill").length,
    fields_updated: changes.filter((c) => c.action === "update").length,
    fields_unchanged: changes.filter((c) => c.action === "unchanged").length,
    fields_protected: changes.filter((c) => c.action === "protected").length,
    notes: allowOverwrite ? "run with --allow-overwrite" : null,
  }).select("id").single();
  if (runError) fail("Could not open a sync run.", runError);

  const writable = changes.filter((c) => c.action === "fill" || c.action === "update");
  const byTarget = new Map();
  for (const c of writable) {
    const key = `${c.entity}:${c.entity === "student" ? c.studentId : c.enrollmentId}`;
    if (!byTarget.has(key)) byTarget.set(key, { entity: c.entity, id: c.entity === "student" ? c.studentId : c.enrollmentId, patch: {} });
    byTarget.get(key).patch[c.column] = c.column.endsWith("_percent") ? Number(c.newValue) : c.newValue;
  }

  let written = 0;
  for (const { entity, id, patch } of byTarget.values()) {
    const table = entity === "student" ? "students" : "enrollments";
    if (entity === "enrollment") patch.graphy_synced_at = new Date().toISOString();
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) fail(`Update failed for ${table} ${id}.`, error);
    written += 1;
  }

  const rows = changes.map((c) => ({
    run_id: run.id, row_number: c.rowNumber, student_id: c.studentId ?? null,
    enrollment_id: c.enrollmentId ?? null, match_key: String(c.matchKey), entity: c.entity,
    column_name: c.column, old_value: c.oldValue, new_value: c.newValue,
    action: c.action, applied: c.action === "fill" || c.action === "update",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("graphy_sync_changes").insert(rows.slice(i, i + 500));
    if (error) fail("Could not record the change log.", error);
  }

  await supabase.from("graphy_sync_runs").update({ completed_at: new Date().toISOString() }).eq("id", run.id);
  console.log(`\n=== Applied ===`);
  console.log(`  records updated : ${written}`);
  console.log(`  fields written  : ${writable.length}`);
  console.log(`  run id          : ${run.id}`);
  console.log(`\nUndo this entire run with:\n  npm run graphy:sync -- --rollback ${run.id}`);
}

/* -------------------------------------------------------------- rollback -- */

async function rollback(supabase, runId) {
  const { data: run, error: runError } = await supabase.from("graphy_sync_runs").select("*").eq("id", runId).maybeSingle();
  if (runError) fail("Could not read that run.", runError);
  if (!run) fail(`No sync run with id ${runId}.`);
  if (run.status === "RolledBack") fail("That run has already been rolled back.");

  const { data: changes, error } = await supabase
    .from("graphy_sync_changes").select("*").eq("run_id", runId).eq("applied", true).eq("reverted", false);
  if (error) fail("Could not read the change log.", error);
  if (!changes || changes.length === 0) fail("That run wrote nothing, so there is nothing to undo.");

  const byTarget = new Map();
  for (const c of changes) {
    const id = c.entity === "student" ? c.student_id : c.enrollment_id;
    const key = `${c.entity}:${id}`;
    if (!byTarget.has(key)) byTarget.set(key, { entity: c.entity, id, patch: {} });
    byTarget.get(key).patch[c.column_name] = c.old_value === null ? null
      : (c.column_name.endsWith("_percent") ? Number(c.old_value) : c.old_value);
  }

  let restored = 0;
  for (const { entity, id, patch } of byTarget.values()) {
    const { error: e } = await supabase.from(entity === "student" ? "students" : "enrollments").update(patch).eq("id", id);
    if (e) fail(`Restore failed for ${entity} ${id}.`, e);
    restored += 1;
  }

  await supabase.from("graphy_sync_changes").update({ reverted: true }).eq("run_id", runId).eq("applied", true);
  await supabase.from("graphy_sync_runs").update({ status: "RolledBack", rolled_back_at: new Date().toISOString() }).eq("id", runId);

  console.log(`Rolled back run ${runId}`);
  console.log(`  records restored : ${restored}`);
  console.log(`  fields restored  : ${changes.length}`);
}

async function history(supabase) {
  const { data, error } = await supabase.from("graphy_sync_runs").select("*").order("started_at", { ascending: false }).limit(20);
  if (error) fail("Could not read sync history.", error);
  if (!data || data.length === 0) return console.log("No Graphy sync runs recorded yet.");
  console.log("\nid                                    when                 status      rows  filled  updated  protected  file");
  for (const r of data) {
    console.log(`${r.id}  ${r.started_at.slice(0, 19).replace("T", " ")}  ${String(r.status).padEnd(10)}  ${String(r.total_rows).padStart(4)}  ${String(r.fields_filled).padStart(6)}  ${String(r.fields_updated).padStart(7)}  ${String(r.fields_protected).padStart(9)}  ${r.filename}`);
  }
}

/* ------------------------------------------------------------------ main -- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = connect();

  if (args.history) return history(supabase);
  if (args.rollback) return rollback(supabase, args.rollback);
  if (!args.file) {
    fail([
      "Usage:",
      '  npm run graphy:sync -- --file "<export.csv>"             preview, writes nothing',
      '  npm run graphy:sync -- --file "<export.csv>" --confirm   apply',
      "  npm run graphy:sync -- --history                         list previous runs",
      "  npm run graphy:sync -- --rollback <run-id>               undo a run",
    ].join("\n"));
  }

  const filePath = path.resolve(args.file);
  const { headers, rows } = await readTable(filePath);
  const mapping = detectMapping(headers);

  const students = await loadAll(supabase, "students", "id, email, contact_number, full_name, graphy_learner_id");
  const enrollments = await loadAll(supabase, "enrollments", "id, student_id, graphy_progress_percent, graphy_last_active_at, graphy_course_name");
  const enrollmentsByStudent = new Map();
  for (const e of enrollments) {
    if (!enrollmentsByStudent.has(e.student_id)) enrollmentsByStudent.set(e.student_id, []);
    enrollmentsByStudent.get(e.student_id).push(e);
  }

  console.log(`File     : ${path.basename(filePath)}`);
  console.log(`Rows     : ${rows.length}`);
  console.log(`Students : ${students.length} in RASA SLMS`);

  const { changes, stats } = buildPlan({ rows, mapping, students, enrollmentsByStudent, allowOverwrite: args.allowOverwrite, limit: args.limit });
  report({ headers, mapping, changes, stats, applied: args.confirm });

  if (args.confirm) await apply(supabase, { filename: path.basename(filePath), changes, stats, allowOverwrite: args.allowOverwrite });
}

export { parseCsv, detectMapping, buildPlan, classify, percent, timestamp, text };

// Only run as a command; the pure functions above are unit tested separately.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
