export const LIFECYCLE_STATUSES = [
  "Registered",
  "Active",
  "On Hold",
  "Extended",
  "Completed",
  "Dropped",
  "Cancelled",
  "Archived",
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const COURSE_STATUSES = [
  "Not Started",
  "Active",
  "On Hold",
  "Extended",
  "Completed",
  "Discontinued",
] as const;

export type CourseStatus = (typeof COURSE_STATUSES)[number];

export type ProjectStatus =
  | "Assigned"
  | "In Progress"
  | "Submitted"
  | "Under Review"
  | "Revision Required"
  | "Completed"
  | "Cancelled";

export type CertificateStatus =
  | "Not Eligible"
  | "Eligible"
  | "Requested"
  | "Generated"
  | "Dispatched"
  | "Delivered"
  | "Cancelled";

export type ExperienceLetterStatus = "Not Eligible" | "Eligible" | "Requested" | "Issued" | "Cancelled";
export type HrSessionStatus = "Pending" | "Scheduled" | "Completed" | "Cancelled" | "No Show";

export type StudentEditorOptions = {
  courses: { code: string; name: string; active: boolean }[];
  owners: { id: string; name: string }[];
};

export type Student = {
  id: string;
  code: string;
  recordCategory?: "operational" | "archive";
  name: string;
  email: string;
  phone: string;
  course: string;
  courseCode: string;
  status: LifecycleStatus;
  trainer: string;
  owner: string;
  ownerId?: string | null;
  updatedAt?: string;
  joiningDate: string | null;
  completionDate: string | null;
  tentativeCompletionDate?: string | null;
  actualCompletionDate?: string | null;
  courseStatus?: CourseStatus;
  feeTotal: number;
  paid: number;
  nextPaymentDate: string | null;
  nextPaymentAmount: number;
  attendance: number;
  attendanceSource: "system" | "imported";
  project: string;
  projectStatus: ProjectStatus;
  projectDetails?: string;
  projectDeadline: string | null;
  certificateStatus: CertificateStatus;
  experienceLetterStatus: ExperienceLetterStatus;
  hrPending: number;
  platformStatus: "Not Created" | "Created" | "Material Assigned";
  platformRecorded?: boolean;
  feeQuantified?: boolean;
  certificateRecorded?: boolean;
  experienceLetterRecorded?: boolean;
  grade: string | null;
  notes: string;
  sourceYear?: number;
  sourceSheet?: string;
  sourceRow?: number;
  registrationDate?: string | null;
  certificates?: string;
  timeRequirement?: string;
  syllabusCustomized?: string;
  feesStatus?: string;
  nextPayment?: string;
  rawAttendance?: string;
  attendanceRecorded?: boolean;
  trainerFeedback?: string;
  reviewDetails?: string;
  reviewOutcome?: "Approved" | "Revision Required" | "Rejected";
  extension?: string;
  experienceLetterEligibility?: string;
  certificateDispatchedDate?: string | null;
  videoFeedback?: string;
  hrFeedback?: string;
  hrSessions?: string[];
  hrSessionNotes?: string[];
  googleReview?: string;
  attendanceRecords?: {
    date: string;
    status: "Present" | "Absent" | "Leave" | "Late";
    session: string;
    remarks?: string;
  }[];
  timelineEvents?: {
    when: string;
    action: string;
    detail: string;
  }[];
  original?: Record<string, unknown>;
};

export type WorkspaceMode = "production" | "local-read-only";

export type Activity = {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  action: string;
  detail: string;
  timestamp: string;
  tone: "teal" | "orange" | "violet" | "blue";
};

export type ViewId =
  | "home"
  | "dashboard"
  | "students"
  | "courses"
  | "fees"
  | "projects"
  | "certificates"
  | "hr"
  | "reports"
  | "imports"
  | "notifications"
  | "settings";

export const APP_CONFIG = {
  organizationName: "RASA Life Science Informatics LLP",
  shortName: "RASA SLMS",
  timezone: "Asia/Kolkata",
  currency: "INR",
  upcomingPaymentDays: 7,
  attendanceEligibilityPercent: 75,
} as const;
