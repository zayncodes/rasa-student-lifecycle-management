import { getStudentsByIdsForCurrentUser } from "@/lib/students-server";
import { createClient } from "@/lib/supabase/server";
import type { Student } from "@/types/domain";

const MAX_EXPORT_ROWS = 2000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CSV_HEADERS = [
  "Student ID", "Source year", "Source sheet", "Source row", "Name", "Registration date", "Joining date",
  "Tentative completion", "Email", "Phone", "Course", "Course code", "Lifecycle status", "Owner", "Trainer",
  "Certificates / modules", "Time requirement", "Custom syllabus", "Fee status", "Next payment", "Total fee", "Paid",
  "Pending", "Attendance", "Attendance source", "LMS status", "Status / comment", "Trainer feedback", "Project",
  "Project status", "Review details", "Extension", "Grade", "Certificate status", "Certificate dispatched",
  "Experience-letter eligibility", "HR feedback", "HR session 1", "HR session 2", "HR session 3", "HR session 4",
  "Video feedback", "Google review",
];

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const neutralized = /^(?:[\t\r\n]|\s*[=+\-@])/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

function studentCsvRow(student: Student): string {
  const sessions = student.hrSessions ?? [];
  return [
    student.code, student.sourceYear, student.sourceSheet, student.sourceRow, student.name, student.registrationDate,
    student.joiningDate, student.completionDate, student.email, student.phone, student.course, student.courseCode,
    student.status, student.owner, student.trainer, student.certificates, student.timeRequirement, student.syllabusCustomized,
    student.feesStatus, student.nextPayment, student.feeTotal, student.paid, student.feeTotal - student.paid,
    student.attendance, student.attendanceSource, student.platformStatus, student.notes, student.trainerFeedback,
    student.project, student.projectStatus, student.reviewDetails, student.extension, student.grade, student.certificateStatus,
    student.certificateDispatchedDate, student.experienceLetterEligibility, student.hrFeedback,
    sessions[0], sessions[1], sessions[2], sessions[3], student.videoFeedback, student.googleReview,
  ].map(csvCell).join(",");
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return errorResponse("Cross-origin export requests are not allowed.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse("Export requests must use JSON.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 200_000) return errorResponse("Export request is too large.", 413);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse("Invalid export request.", 400);
  }

  const rawIds = typeof input === "object" && input !== null && "ids" in input
    ? (input as { ids?: unknown }).ids
    : undefined;
  if (!Array.isArray(rawIds)) return errorResponse("Student IDs are required.", 400);

  const ids = Array.from(new Set(rawIds));
  if (ids.length !== rawIds.length) return errorResponse("Duplicate student IDs are not allowed.", 400);
  if (ids.length === 0 || ids.length > MAX_EXPORT_ROWS || ids.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    return errorResponse(`Choose between 1 and ${MAX_EXPORT_ROWS} valid student records.`, 400);
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return errorResponse("Authentication is required.", 401);

  const { data: canExport, error: permissionError } = await supabase.rpc("has_permission", { required_permission: "reports.export" });
  if (permissionError) return errorResponse("Unable to verify export permission.", 500);
  if (!canExport) return errorResponse("You do not have permission to export student records.", 403);

  let students: Student[];
  try {
    students = await getStudentsByIdsForCurrentUser(ids as string[]);
  } catch {
    return errorResponse("Unable to prepare the requested student records.", 500);
  }

  if (students.length !== ids.length) return errorResponse("One or more requested records are unavailable.", 409);
  const byId = new Map(students.map((student) => [student.id, student]));
  const orderedStudents = (ids as string[]).map((id) => byId.get(id)).filter((student): student is Student => Boolean(student));

  const { error: auditError } = await supabase.rpc("audit_student_export", { p_student_ids: ids });
  if (auditError) return errorResponse("The export could not be recorded in the audit log.", 500);

  const csv = `\uFEFF${[CSV_HEADERS.map(csvCell).join(","), ...orderedStudents.map(studentCsvRow)].join("\r\n")}`;
  const filename = `rasa-students-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
