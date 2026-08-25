import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlan, classify, detectMapping, parseCsv, percent, timestamp } from "../scripts/graphy-sync.mjs";

test("CSV parsing handles quotes, embedded commas and blank lines", () => {
  const rows = parseCsv('Email,Name,Progress\r\na@x.com,"Sharma, Rahul",80%\n\nb@x.com,"He said ""hi""",5\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["a@x.com", "Sharma, Rahul", "80%"]);
  assert.deepEqual(rows[2], ["b@x.com", 'He said "hi"', "5"]);
});

test("column detection tolerates Graphy's varying header names", () => {
  const mapping = detectMapping(["Learner ID", "Email Address", "Full Name", "Course Name", "Completion %", "Last Active On"]);
  assert.equal(mapping.learnerId, 0);
  assert.equal(mapping.email, 1);
  assert.equal(mapping.name, 2);
  assert.equal(mapping.courseName, 3);
  assert.equal(mapping.progress, 4);
  assert.equal(mapping.lastActive, 5);
});

test("percentages accept a percent sign and clamp to 0-100", () => {
  assert.equal(percent("80%"), 80);
  assert.equal(percent(" 62.5 "), 62.5);
  assert.equal(percent("140"), 100);
  assert.equal(percent("-3"), 0);
  assert.equal(percent(""), null);
  assert.equal(percent("not a number"), null);
});

test("unparseable dates become null rather than an invalid timestamp", () => {
  assert.equal(timestamp("2026-08-01"), new Date("2026-08-01").toISOString());
  assert.equal(timestamp("garbage"), null);
  assert.equal(timestamp(""), null);
});

test("a differing staff value is protected, not overwritten", () => {
  // Shared column, existing value, no override -> left alone.
  assert.equal(classify("status", "Material Assigned", "Created", false), "protected");
  // Same shared column with --allow-overwrite -> update.
  assert.equal(classify("status", "Material Assigned", "Created", true), "update");
  // Empty value is always safe to fill.
  assert.equal(classify("status", null, "Created", false), "fill");
  // Graphy-owned columns may always be refreshed.
  assert.equal(classify("graphy_progress_percent", 40, 55, false), "update");
  // No proposed value means no change at all.
  assert.equal(classify("graphy_progress_percent", 40, null, false), null);
  // Identical values are never rewritten.
  assert.equal(classify("graphy_progress_percent", 40, 40, false), "unchanged");
});

const students = [
  { id: "s1", email: "one@x.com", contact_number: "+91 98765 43210", full_name: "One", graphy_learner_id: null },
  { id: "s2", email: "dupe@x.com", contact_number: null, full_name: "Two", graphy_learner_id: null },
  { id: "s3", email: "dupe@x.com", contact_number: null, full_name: "Three", graphy_learner_id: null },
];
const enrollmentsByStudent = new Map([
  ["s1", [{ id: "e1", student_id: "s1", graphy_progress_percent: null, graphy_last_active_at: null, graphy_course_name: null }]],
]);

function plan(rows, headers = ["Email", "Name", "Course Name", "Progress"]) {
  return buildPlan({ rows, mapping: detectMapping(headers), students, enrollmentsByStudent, allowOverwrite: false, limit: 0 });
}

test("a matched learner fills empty Graphy columns", () => {
  const { changes, stats } = plan([["one@x.com", "One", "Bioinformatics", "72"]]);
  assert.equal(stats.matched, 1);
  const progress = changes.find((c) => c.column === "graphy_progress_percent");
  assert.equal(progress.action, "fill");
  assert.equal(progress.newValue, "72");
  assert.equal(progress.enrollmentId, "e1");
});

test("an email shared by two students is reported ambiguous and never guessed", () => {
  const { changes, stats } = plan([["dupe@x.com", "Two", "Bioinformatics", "50"]]);
  assert.equal(stats.ambiguous, 1);
  assert.equal(stats.matched, 0);
  assert.equal(changes[0].action, "ambiguous");
  // Nothing writable is produced for an ambiguous row.
  assert.equal(changes.filter((c) => c.action === "fill" || c.action === "update").length, 0);
});

test("a learner absent from RASA SLMS is reported, not created", () => {
  const { changes, stats } = plan([["nobody@x.com", "Ghost", "Bioinformatics", "10"]]);
  assert.equal(stats.unmatched, 1);
  assert.equal(changes[0].action, "unmatched");
  assert.equal(changes.filter((c) => c.action === "fill").length, 0);
});

test("re-running the same export produces no further writes", () => {
  const already = new Map([
    ["s1", [{ id: "e1", student_id: "s1", graphy_progress_percent: 72, graphy_last_active_at: null, graphy_course_name: "Bioinformatics" }]],
  ]);
  const { changes } = buildPlan({
    rows: [["one@x.com", "One", "Bioinformatics", "72"]],
    mapping: detectMapping(["Email", "Name", "Course Name", "Progress"]),
    students, enrollmentsByStudent: already, allowOverwrite: false, limit: 0,
  });
  assert.equal(changes.filter((c) => c.action === "fill" || c.action === "update").length, 0);
  assert.ok(changes.some((c) => c.action === "unchanged"));
});

test("a student with no enrollment still records the learner id without crashing", () => {
  const { changes, stats } = buildPlan({
    rows: [["one@x.com", "One", "Bioinformatics", "72"]],
    mapping: detectMapping(["Email", "Name", "Course Name", "Progress"]),
    students, enrollmentsByStudent: new Map(), allowOverwrite: false, limit: 0,
  });
  assert.equal(stats.matched, 1);
  assert.equal(changes.filter((c) => c.column === "graphy_progress_percent").length, 0);
});
