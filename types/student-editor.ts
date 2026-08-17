import type {
  CertificateStatus,
  CourseStatus,
  ExperienceLetterStatus,
  HrSessionStatus,
  LifecycleStatus,
  ProjectStatus,
} from "./domain";

export type StudentLifecycleUpdate = {
  expectedUpdatedAt: string;
  editReason: string;
  name: string;
  email: string;
  phone: string;
  registrationDate: string | null;
  ownerId: string | null;
  lifecycleStatus: LifecycleStatus;
  courseCode: string | null;
  courseStatus: CourseStatus | null;
  joiningDate: string | null;
  tentativeCompletionDate: string | null;
  actualCompletionDate: string | null;
  timeRequirement: string;
  platformStatus: "Not Created" | "Created" | "Material Assigned" | null;
  attendance: number | null;
  feeTotal: number | null;
  nextPaymentDate: string | null;
  nextPaymentAmount: number | null;
  projectName: string | null;
  projectDetails: string;
  projectStatus: ProjectStatus;
  projectDeadline: string | null;
  projectGrade: string | null;
  reviewDetails: string;
  reviewOutcome: "Approved" | "Revision Required" | "Rejected" | null;
  certificateStatus: CertificateStatus | null;
  certificateDispatchedDate: string | null;
  experienceLetterStatus: ExperienceLetterStatus | null;
  hrSessions: (HrSessionStatus | null)[];
  hrSessionNotes: string[];
  notes: string;
};
