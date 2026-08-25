#!/usr/bin/env node
/**
 * Point-in-time snapshot of the RASA SLMS database.
 *
 *   npm run data:snapshot -- --label checkpoint-1
 *
 * Writes every operational table to a single timestamped JSON file inside the
 * git-ignored private-data/ directory. This is a restore reference and audit
 * artifact, not a substitute for Supabase's own backups.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const TABLES = [
  "roles", "permissions", "role_permissions", "profiles", "user_roles",
  "courses", "students", "enrollments", "learning_platform_accounts",
  "attendance_records", "trainers", "trainer_assignments",
  "fee_accounts", "payments", "payment_schedules",
  "student_projects", "project_reviews", "extensions",
  "certificates", "experience_letters", "hr_sessions", "placement_activities",
  "legacy_student_records", "audit_logs",
];

const PAGE = 1000;

function label() {
  const index = process.argv.indexOf("--label");
  return index !== -1 ? process.argv[index + 1] ?? "snapshot" : "snapshot";
}

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // Variables may already be present in the shell.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const snapshot = { label: label(), takenAt: new Date().toISOString(), project: new URL(url).host, tables: {} };
const counts = {};

for (const table of TABLES) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      counts[table] = `skipped (${error.message.slice(0, 60)})`;
      break;
    }
    rows.push(...data);
    if (data.length < PAGE) {
      snapshot.tables[table] = rows;
      counts[table] = rows.length;
      break;
    }
  }
}

const outDir = path.resolve("private-data");
await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `snapshot-${snapshot.label}-${snapshot.takenAt.slice(0, 10)}.json`);
await fs.writeFile(outFile, JSON.stringify(snapshot, null, 1), "utf8");

console.log(`Snapshot: ${outFile}`);
console.log(`Project : ${snapshot.project}`);
for (const [table, count] of Object.entries(counts)) {
  if (count !== 0) console.log(`  ${table.padEnd(28)} ${count}`);
}
