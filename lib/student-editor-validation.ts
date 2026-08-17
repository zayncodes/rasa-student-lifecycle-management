import { z } from "zod";
import { COURSE_STATUSES, LIFECYCLE_STATUSES } from "@/types/domain";

const dateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date in YYYY-MM-DD format.");
const nullableDate = dateValue.nullable();
const shortText = z.string().trim().max(500);

export const studentLifecycleUpdateSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  editReason: z.string().trim().min(10, "Explain the reason for this change in at least 10 characters.").max(1000),
  name: z.string().trim().min(1, "Student name is required.").max(200),
  email: z.string().trim().max(320).refine((value) => !value || z.string().email().safeParse(value).success, "Enter a valid email address."),
  phone: z.string().trim().max(50),
  registrationDate: nullableDate,
  ownerId: z.string().uuid().nullable(),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES),
  courseCode: z.string().trim().min(1).max(80).nullable(),
  courseStatus: z.enum(COURSE_STATUSES).nullable(),
  joiningDate: nullableDate,
  tentativeCompletionDate: nullableDate,
  actualCompletionDate: nullableDate,
  timeRequirement: shortText,
  platformStatus: z.enum(["Not Created", "Created", "Material Assigned"]).nullable(),
  attendance: z.number().finite().min(0).max(100).nullable(),
  feeTotal: z.number().finite().min(0).max(9_999_999_999.99).nullable(),
  nextPaymentDate: nullableDate,
  nextPaymentAmount: z.number().finite().positive().max(9_999_999_999.99).nullable(),
  projectName: z.string().trim().min(1).max(300).nullable(),
  projectDetails: z.string().trim().max(5000),
  projectStatus: z.enum(["Assigned", "In Progress", "Submitted", "Under Review", "Revision Required", "Completed", "Cancelled"]),
  projectDeadline: nullableDate,
  projectGrade: z.string().trim().max(50).nullable(),
  reviewDetails: z.string().trim().max(5000),
  reviewOutcome: z.enum(["Approved", "Revision Required", "Rejected"]).nullable(),
  certificateStatus: z.enum(["Not Eligible", "Eligible", "Requested", "Generated", "Dispatched", "Delivered", "Cancelled"]).nullable(),
  certificateDispatchedDate: nullableDate,
  experienceLetterStatus: z.enum(["Not Eligible", "Eligible", "Requested", "Issued", "Cancelled"]).nullable(),
  hrSessions: z.array(z.enum(["Pending", "Scheduled", "Completed", "Cancelled", "No Show"]).nullable()).length(4),
  hrSessionNotes: z.array(z.string().trim().max(1000)).length(4),
  notes: z.string().trim().max(10_000),
}).strict().superRefine((value, context) => {
  if (value.tentativeCompletionDate && value.joiningDate && value.tentativeCompletionDate < value.joiningDate) {
    context.addIssue({ code: "custom", path: ["tentativeCompletionDate"], message: "Tentative completion cannot be before joining." });
  }
  if (value.actualCompletionDate && value.joiningDate && value.actualCompletionDate < value.joiningDate) {
    context.addIssue({ code: "custom", path: ["actualCompletionDate"], message: "Actual completion cannot be before joining." });
  }
  if (value.lifecycleStatus === "Completed" && !value.actualCompletionDate) {
    context.addIssue({ code: "custom", path: ["actualCompletionDate"], message: "Actual completion date is required for a completed student." });
  }
  const hasScheduleDate = Boolean(value.nextPaymentDate);
  const hasScheduleAmount = value.nextPaymentAmount !== null;
  if (hasScheduleDate !== hasScheduleAmount) {
    context.addIssue({ code: "custom", path: [hasScheduleDate ? "nextPaymentAmount" : "nextPaymentDate"], message: "Provide both the next payment date and amount, or leave both blank." });
  }
  if (!value.projectName && (value.projectDetails || value.projectDeadline || value.projectGrade || value.reviewDetails || value.reviewOutcome)) {
    context.addIssue({ code: "custom", path: ["projectName"], message: "Add a project name before entering project details, review, deadline or grade." });
  }
  if (Boolean(value.reviewDetails) !== Boolean(value.reviewOutcome)) {
    context.addIssue({ code: "custom", path: [value.reviewDetails ? "reviewOutcome" : "reviewDetails"], message: "Review feedback and outcome must be provided together." });
  }
  if (value.certificateDispatchedDate && !value.certificateStatus) {
    context.addIssue({ code: "custom", path: ["certificateStatus"], message: "Choose a certificate status before adding a dispatch date." });
  }
  if (value.certificateStatus && ["Dispatched", "Delivered"].includes(value.certificateStatus) && !value.certificateDispatchedDate) {
    context.addIssue({ code: "custom", path: ["certificateDispatchedDate"], message: "Dispatch date is required for a dispatched or delivered certificate." });
  }
  if (!value.courseCode && (value.courseStatus || value.joiningDate || value.tentativeCompletionDate || value.actualCompletionDate || value.timeRequirement || value.platformStatus || value.attendance !== null || value.feeTotal !== null || value.projectName || value.certificateStatus || value.experienceLetterStatus || value.hrSessions.some(Boolean))) {
    context.addIssue({ code: "custom", path: ["courseCode"], message: "Choose a course before adding enrollment, fee, project, certificate or HR information." });
  }
  if (value.courseCode && !value.courseStatus) {
    context.addIssue({ code: "custom", path: ["courseStatus"], message: "Choose a course status for the enrollment." });
  }
  if ((value.nextPaymentDate || value.nextPaymentAmount !== null) && value.feeTotal === null) {
    context.addIssue({ code: "custom", path: ["feeTotal"], message: "Enter a quantified total fee before scheduling a payment." });
  }
  value.hrSessionNotes.forEach((note, index) => {
    if (note && !value.hrSessions[index]) {
      context.addIssue({ code: "custom", path: ["hrSessions", index], message: `Choose a status before adding notes to HR session ${index + 1}.` });
    }
  });
});

export type ValidatedStudentLifecycleUpdate = z.infer<typeof studentLifecycleUpdateSchema>;
