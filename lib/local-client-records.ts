import type { CertificateStatus, LifecycleStatus, ProjectStatus, Student } from "@/types/domain";

type LocalRecord = Record<string, unknown> & {
  original?: Record<string, unknown>;
  importWarnings?: unknown[];
};

type LocalOutput = {
  records?: unknown;
  archivedRecords?: unknown;
};

const lifecycleStatuses = new Set<LifecycleStatus>(["Registered", "Active", "On Hold", "Extended", "Completed", "Dropped", "Cancelled", "Archived"]);
const projectStatuses = new Set<ProjectStatus>(["Assigned", "In Progress", "Submitted", "Under Review", "Revision Required", "Completed"]);
const certificateStatuses = new Set<CertificateStatus>(["Not Eligible", "Eligible", "Requested", "Generated", "Dispatched", "Delivered"]);

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableDate(value: unknown) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function lifecycle(value: unknown): LifecycleStatus {
  const candidate = text(value) as LifecycleStatus;
  return lifecycleStatuses.has(candidate) ? candidate : "Registered";
}

function projectStatus(record: LocalRecord): ProjectStatus {
  if (!text(record.project) || text(record.project) === "Not recorded") return "Assigned";
  const candidate = text(record.projectStatus) as ProjectStatus;
  return projectStatuses.has(candidate) ? candidate : "In Progress";
}

function certificateStatus(value: unknown): CertificateStatus {
  const candidate = text(value) as CertificateStatus;
  return certificateStatuses.has(candidate) ? candidate : "Not Eligible";
}

function experienceLetterStatus(value: unknown): Student["experienceLetterStatus"] {
  const raw = text(value).toLowerCase();
  if (/\b(issued|dispatched|sent)\b/.test(raw)) return "Issued";
  if (/\b(eligible|yes)\b/.test(raw) && !/\b(not|no)\b/.test(raw)) return "Eligible";
  return "Not Eligible";
}

function mapRecord(record: LocalRecord, index: number): Student {
  const original = record.original && typeof record.original === "object" && !Array.isArray(record.original) ? record.original : {};
  const rawRegistrationDate = text(original.registrationDate);
  const normalizedRegistrationDate = nullableDate(record.registrationDate);
  const registrationDate = rawRegistrationDate ? normalizedRegistrationDate : "";
  const attendanceRecorded = record.attendanceRecorded === true;
  const rawHrSessions = Array.isArray(record.hrSessions) ? record.hrSessions.map(text) : [];
  const recordedHrSessions = rawHrSessions.slice(0, 4).filter(Boolean).length;
  const sourceYear = record.sourceYear != null && Number.isFinite(Number(record.sourceYear)) ? Number(record.sourceYear) : undefined;
  const rawCertificateStatus = text(original.certificateStatus);
  const originalWithMetadata = {
    ...original,
    importWarnings: Array.isArray(record.importWarnings) ? record.importWarnings : [],
    attendanceRecorded,
    normalizedCertificateStatus: text(record.certificateStatus),
  };

  return {
    id: text(record.id) || `local-${index + 1}`,
    code: text(record.code) || `LOCAL-${String(index + 1).padStart(6, "0")}`,
    recordCategory: text(record.recordCategory) === "archive" ? "archive" : "operational",
    name: text(record.name) || "Missing student name",
    email: text(record.email),
    phone: text(record.phone),
    course: text(record.course) || "Course not recorded",
    courseCode: text(record.courseCode) || "COURSE",
    status: lifecycle(record.status),
    trainer: text(record.trainer) || "Not recorded",
    owner: text(record.owner) || "Not recorded",
    joiningDate: nullableDate(record.joiningDate) || null,
    completionDate: nullableDate(record.completionDate) || null,
    feeTotal: 0,
    paid: 0,
    nextPaymentDate: null,
    nextPaymentAmount: 0,
    attendance: attendanceRecorded ? Math.max(0, Math.min(100, number(record.attendance))) : 0,
    attendanceSource: "imported",
    project: text(record.project) || "Not recorded",
    projectStatus: projectStatus(record),
    projectDeadline: nullableDate(record.projectDeadline) || null,
    certificateStatus: rawCertificateStatus ? certificateStatus(rawCertificateStatus) : "Not Eligible",
    experienceLetterStatus: experienceLetterStatus(record.experienceLetterEligibility),
    // Blank workbook cells mean HR progress is unknown, not four confirmed
    // pending sessions. Keep the compatibility count at zero until at least
    // one source session has actually been recorded.
    hrPending: recordedHrSessions ? Math.max(0, 4 - recordedHrSessions) : 0,
    platformStatus: ["Not Created", "Created", "Material Assigned"].includes(text(record.platformStatus)) ? text(record.platformStatus) as Student["platformStatus"] : "Not Created",
    grade: text(record.grade) || null,
    notes: text(record.notes) || text(record.comment),
    sourceYear,
    sourceSheet: text(record.sourceSheet),
    sourceRow: number(record.sourceRow) || undefined,
    registrationDate,
    certificates: text(record.certificates),
    timeRequirement: text(record.timeRequirement),
    syllabusCustomized: text(record.syllabusCustomized),
    feesStatus: text(record.feesStatus) || "Not quantified",
    nextPayment: text(record.nextPayment),
    rawAttendance: text(record.rawAttendance),
    attendanceRecorded,
    trainerFeedback: text(record.trainerFeedback),
    reviewDetails: text(record.reviewDetails),
    extension: text(record.extension),
    experienceLetterEligibility: text(record.experienceLetterEligibility),
    certificateDispatchedDate: nullableDate(record.certificateDispatchedDate) || null,
    videoFeedback: text(record.videoFeedback),
    hrFeedback: text(record.hrFeedback),
    hrSessions: rawHrSessions,
    googleReview: text(record.googleReview),
    original: originalWithMetadata,
  };
}

export function mapLocalClientOutput(input: unknown): Student[] {
  const output = input && typeof input === "object" && !Array.isArray(input) ? input as LocalOutput : {};
  if (!Array.isArray(output.records)) throw new Error("Local client data JSON must contain an output.records array.");
  const archives = Array.isArray(output.archivedRecords) ? output.archivedRecords : [];
  return [...output.records, ...archives].map((record, index) => mapRecord(record && typeof record === "object" && !Array.isArray(record) ? record as LocalRecord : {}, index));
}
