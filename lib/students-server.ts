import "server-only";

import type { CourseStatus, HrSessionStatus, Student, StudentEditorOptions } from "@/types/domain";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type StudentRow = {
  id: string;
  student_code: string | null;
  full_name: string;
  email: string | null;
  contact_number: string | null;
  registration_date: string | null;
  lifecycle_status: Student["status"];
  notes: string | null;
  owner_user_id: string | null;
  legacy_owner_name: string | null;
  updated_at: string;
  owner_profile?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
  legacy_student_records?: { source_year: number | null; source_sheet: string; source_row: number; raw_data: Record<string, unknown> }[];
  enrollments?: EnrollmentRow[];
  timeline_events?: { title: string; detail: string | null; occurred_at: string }[];
};

type EnrollmentRow = {
  id: string;
  joining_date: string | null;
  tentative_completion_date: string | null;
  actual_completion_date: string | null;
  course_status: CourseStatus;
  time_requirement: string | null;
  course_remarks: string | null;
  course_name_snapshot: string;
  course_code_snapshot: string;
  standard_fee_snapshot: number;
  legacy_attendance_percentage: number | null;
  legacy_fee_status: string | null;
  legacy_fee_percent: number | null;
  attendance_records?: { attendance_date: string; status: "Present" | "Absent" | "Leave" | "Late"; session_name: string; remarks: string | null }[];
  learning_platform_accounts?: { status: string; study_material_assigned: boolean }[];
  fee_accounts?: { total_course_fee: number; payments?: { amount: number; status: string }[]; payment_schedules?: { due_date: string; amount_due: number; status: string }[] }[];
  student_projects?: { project_name: string; project_details: string | null; deadline: string | null; project_status: Student["projectStatus"]; grade: string | null; remarks: string | null; project_reviews?: { feedback: string; outcome: "Approved" | "Revision Required" | "Rejected"; reviewed_at: string }[] }[];
  certificates?: { status: Student["certificateStatus"]; dispatched_at: string | null }[];
  experience_letters?: { status: Student["experienceLetterStatus"] }[];
  hr_sessions?: { sequence_number: number | null; status: HrSessionStatus; completed_at: string | null; notes: string | null }[];
};

const STUDENT_SELECT = `
  id, student_code, full_name, email, contact_number, registration_date, lifecycle_status, notes, owner_user_id, legacy_owner_name, updated_at,
  owner_profile:profiles!students_owner_user_id_fkey(id, full_name),
  legacy_student_records (source_year, source_sheet, source_row, raw_data),
  timeline_events (title, detail, occurred_at),
  enrollments (
    id, joining_date, tentative_completion_date, actual_completion_date, course_status, time_requirement, course_remarks,
    course_name_snapshot, course_code_snapshot, standard_fee_snapshot, legacy_attendance_percentage,
    legacy_fee_status, legacy_fee_percent,
    attendance_records (attendance_date, status, session_name, remarks),
    learning_platform_accounts (status, study_material_assigned),
    fee_accounts (total_course_fee, payments (amount, status), payment_schedules (due_date, amount_due, status)),
    student_projects (project_name, project_details, deadline, project_status, grade, remarks, project_reviews (feedback, outcome, reviewed_at)),
    certificates (status, dispatched_at), experience_letters (status), hr_sessions (sequence_number, status, completed_at, notes)
  )
`;

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function requireLaunchAdministrator(supabase: ServerSupabaseClient) {
  const { data, error } = await supabase.rpc("is_launch_administrator");
  if (error || data !== true) throw new Error("Administrator access is required.");
}

export function mapStudentRow(row: StudentRow): Student {
  const enrollment = row.enrollments?.[0];
  const feeAccount = enrollment?.fee_accounts?.[0];
  const project = enrollment?.student_projects?.[0];
  const latestReview = [...(project?.project_reviews ?? [])].sort((left, right) => Date.parse(right.reviewed_at) - Date.parse(left.reviewed_at))[0];
  const schedule = feeAccount?.payment_schedules?.find((item) => item.status === "Pending");
  const paid = feeAccount?.payments?.filter((item) => item.status === "Posted").reduce((sum, item) => sum + Number(item.amount), 0) ?? 0;
  const certificate = enrollment?.certificates?.[0];
  const experienceLetter = enrollment?.experience_letters?.[0];
  const legacyRecord = row.legacy_student_records?.[0];
  const platformAccount = enrollment?.learning_platform_accounts?.[0];
  const ownerProfile = Array.isArray(row.owner_profile) ? row.owner_profile[0] : row.owner_profile;
  const attendanceRecords = enrollment?.attendance_records ?? [];
  const markedAttendance = attendanceRecords.filter((item) => item.status !== "Leave");
  const systemAttendance = markedAttendance.length
    ? Math.round((markedAttendance.filter((item) => item.status === "Present" || item.status === "Late").length / markedAttendance.length) * 1000) / 10
    : 0;
  const hrSessionRows = [...(enrollment?.hr_sessions ?? [])].sort((left, right) => (left.sequence_number ?? 999) - (right.sequence_number ?? 999));
  const completedHr = hrSessionRows.filter((item) => item.status === "Completed").length;
  const hrSessions = Array.from({ length: 4 }, (_, index) => hrSessionRows.find((item) => item.sequence_number === index + 1)?.status ?? "");
  const hrSessionNotes = Array.from({ length: 4 }, (_, index) => hrSessionRows.find((item) => item.sequence_number === index + 1)?.notes ?? "");
  const registrationYear = row.registration_date ? Number(row.registration_date.slice(0, 4)) : legacyRecord?.source_year ?? undefined;
  return {
    id: row.id,
    code: row.student_code ?? (registrationYear ? `RASA-${registrationYear}` : "RASA-UNASSIGNED"),
    name: row.full_name,
    email: row.email ?? "",
    phone: row.contact_number ?? "",
    course: enrollment?.course_name_snapshot ?? "Course not recorded",
    courseCode: enrollment?.course_code_snapshot ?? "COURSE",
    status: row.lifecycle_status,
    trainer: "Unassigned",
    owner: ownerProfile?.full_name ?? row.legacy_owner_name ?? "Unassigned",
    ownerId: row.owner_user_id,
    updatedAt: row.updated_at,
    joiningDate: enrollment?.joining_date ?? null,
    completionDate: enrollment?.actual_completion_date ?? enrollment?.tentative_completion_date ?? null,
    tentativeCompletionDate: enrollment?.tentative_completion_date ?? null,
    actualCompletionDate: enrollment?.actual_completion_date ?? null,
    courseStatus: enrollment?.course_status,
    feeTotal: Number(feeAccount?.total_course_fee ?? 0),
    feeQuantified: Boolean(feeAccount),
    paid,
    nextPaymentDate: schedule?.due_date ?? null,
    nextPaymentAmount: Number(schedule?.amount_due ?? 0),
    attendance: Number(enrollment?.legacy_attendance_percentage ?? systemAttendance),
    attendanceSource: attendanceRecords.length ? "system" : "imported",
    project: project?.project_name ?? "Not recorded",
    projectStatus: project?.project_status ?? "Assigned",
    projectDetails: project?.project_details ?? "",
    projectDeadline: project?.deadline ?? null,
    certificateStatus: certificate?.status ?? "Not Eligible",
    certificateRecorded: Boolean(certificate),
    experienceLetterStatus: experienceLetter?.status ?? "Not Eligible",
    experienceLetterRecorded: Boolean(experienceLetter),
    hrPending: Math.max(0, 4 - completedHr),
    platformStatus: platformAccount?.status as Student["platformStatus"] ?? "Not Created",
    platformRecorded: Boolean(platformAccount),
    grade: project?.grade ?? null,
    notes: row.notes ?? enrollment?.course_remarks ?? "",
    sourceYear: legacyRecord?.source_year ?? registrationYear,
    sourceSheet: legacyRecord?.source_sheet ?? "Production database",
    sourceRow: legacyRecord?.source_row ?? 0,
    registrationDate: row.registration_date,
    certificates: "",
    timeRequirement: enrollment?.time_requirement ?? "",
    syllabusCustomized: "",
    feesStatus: feeAccount
      ? `${Math.round((paid / Math.max(1, Number(feeAccount.total_course_fee))) * 100)}% paid`
      : enrollment?.legacy_fee_status ?? "Not recorded",
    nextPayment: schedule ? `${schedule.due_date} · ${schedule.amount_due}` : "",
    rawAttendance: enrollment?.legacy_attendance_percentage == null ? "" : `${enrollment.legacy_attendance_percentage}%`,
    attendanceRecorded: enrollment?.legacy_attendance_percentage != null || attendanceRecords.length > 0,
    trainerFeedback: "",
    // Imported workbook rows carry review text without a formal outcome, so it
    // is stored as project remarks rather than a fabricated review decision.
    reviewDetails: latestReview?.feedback ?? project?.remarks ?? "",
    reviewOutcome: latestReview?.outcome,
    extension: "",
    experienceLetterEligibility: experienceLetter?.status ?? "",
    certificateDispatchedDate: certificate?.dispatched_at ?? null,
    videoFeedback: "",
    hrFeedback: "",
    hrSessions,
    hrSessionNotes,
    googleReview: "",
    attendanceRecords: attendanceRecords.map((item) => ({ date: item.attendance_date, status: item.status, session: item.session_name, remarks: item.remarks ?? undefined })),
    timelineEvents: (row.timeline_events ?? []).map((item) => ({ when: item.occurred_at, action: item.title, detail: item.detail ?? "" })),
    original: legacyRecord?.raw_data ?? {},
  };
}

export async function getStudentsForCurrentUser(): Promise<Student[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  await requireLaunchAdministrator(supabase);
  const { data, error } = await supabase.from("students").select(STUDENT_SELECT).is("archived_at", null).order("registration_date", { ascending: false }).limit(2000);
  if (error) throw new Error(`Unable to load students: ${error.message}`);
  return (data as unknown as StudentRow[]).map(mapStudentRow);
}

export async function getStudentsByIdsForCurrentUser(ids: string[]): Promise<Student[]> {
  if (!isSupabaseConfigured || ids.length === 0) return [];
  const supabase = await createClient();
  await requireLaunchAdministrator(supabase);
  const { data, error } = await supabase
    .from("students")
    .select(STUDENT_SELECT)
    .in("id", ids)
    .is("archived_at", null)
    .limit(ids.length);
  if (error) throw new Error(`Unable to load students for export: ${error.message}`);
  return (data as unknown as StudentRow[]).map(mapStudentRow);
}

export async function getStudentEditorOptions(): Promise<StudentEditorOptions> {
  if (!isSupabaseConfigured) return { courses: [], owners: [] };
  const supabase = await createClient();
  await requireLaunchAdministrator(supabase);
  const [{ data: courses, error: courseError }, { data: owners, error: ownerError }] = await Promise.all([
    supabase.from("courses").select("course_code, name, is_active").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  if (courseError) throw new Error(`Unable to load course choices: ${courseError.message}`);
  if (ownerError) throw new Error(`Unable to load owner choices: ${ownerError.message}`);
  return {
    courses: (courses ?? []).map((course) => ({ code: course.course_code, name: course.name, active: course.is_active })),
    owners: (owners ?? []).map((owner) => ({ id: owner.id, name: owner.full_name })),
  };
}
