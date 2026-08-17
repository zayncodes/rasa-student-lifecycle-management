"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/primitives";
import { studentLifecycleUpdateSchema } from "@/lib/student-editor-validation";
import {
  COURSE_STATUSES,
  LIFECYCLE_STATUSES,
  type Student,
  type StudentEditorOptions,
} from "@/types/domain";
import type { StudentLifecycleUpdate } from "@/types/student-editor";

const PROJECT_STATUSES = ["Assigned", "In Progress", "Submitted", "Under Review", "Revision Required", "Completed", "Cancelled"] as const;
const CERTIFICATE_STATUSES = ["Not Eligible", "Eligible", "Requested", "Generated", "Dispatched", "Delivered", "Cancelled"] as const;
const EXPERIENCE_STATUSES = ["Not Eligible", "Eligible", "Requested", "Issued", "Cancelled"] as const;
const HR_STATUSES = ["Pending", "Scheduled", "Completed", "Cancelled", "No Show"] as const;
const PLATFORM_STATUSES = ["Not Created", "Created", "Material Assigned"] as const;

const dateValue = (value: string | null | undefined) => value?.slice(0, 10) ?? "";
const nullableText = (value: FormDataEntryValue | null) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};
const nullableNumber = (value: FormDataEntryValue | null) => {
  const normalized = String(value ?? "").trim();
  return normalized ? Number(normalized) : null;
};

export function StudentEditModal({ student, options, open, onClose, onSubmit }: {
  student: Student | null;
  options: StudentEditorOptions;
  open: boolean;
  onClose: () => void;
  onSubmit: (update: StudentLifecycleUpdate) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!student) return null;
  const currentStudent = student;

  const hasCurrentOwner = Boolean(student.ownerId && options.owners.some((owner) => owner.id === student.ownerId));
  const hasCurrentCourse = options.courses.some((course) => course.code === student.courseCode);
  const hasEnrollment = student.course !== "Course not recorded" && student.courseCode !== "COURSE";
  const projectRecorded = student.project !== "Not recorded" && student.project !== "Not assigned";
  const feeQuantified = student.feeQuantified ?? (student.feeTotal > 0 || student.paid > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    const hrSessions = Array.from({ length: 4 }, (_, index) => nullableText(data.get(`hrSession${index + 1}`)));
    const hrSessionNotes = Array.from({ length: 4 }, (_, index) => String(data.get(`hrSessionNote${index + 1}`) ?? "").trim());
    const update = {
      expectedUpdatedAt: currentStudent.updatedAt ?? "",
      editReason: String(data.get("editReason") ?? "").trim(),
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      registrationDate: nullableText(data.get("registrationDate")),
      ownerId: nullableText(data.get("ownerId")),
      lifecycleStatus: String(data.get("lifecycleStatus") ?? ""),
      courseCode: nullableText(data.get("courseCode")),
      courseStatus: nullableText(data.get("courseStatus")),
      joiningDate: nullableText(data.get("joiningDate")),
      tentativeCompletionDate: nullableText(data.get("tentativeCompletionDate")),
      actualCompletionDate: nullableText(data.get("actualCompletionDate")),
      timeRequirement: String(data.get("timeRequirement") ?? "").trim(),
      platformStatus: nullableText(data.get("platformStatus")),
      attendance: nullableNumber(data.get("attendance")),
      feeTotal: nullableNumber(data.get("feeTotal")),
      nextPaymentDate: nullableText(data.get("nextPaymentDate")),
      nextPaymentAmount: nullableNumber(data.get("nextPaymentAmount")),
      projectName: nullableText(data.get("projectName")),
      projectDetails: String(data.get("projectDetails") ?? "").trim(),
      projectStatus: String(data.get("projectStatus") ?? ""),
      projectDeadline: nullableText(data.get("projectDeadline")),
      projectGrade: nullableText(data.get("projectGrade")),
      reviewDetails: String(data.get("reviewDetails") ?? "").trim(),
      reviewOutcome: nullableText(data.get("reviewOutcome")),
      certificateStatus: nullableText(data.get("certificateStatus")),
      certificateDispatchedDate: nullableText(data.get("certificateDispatchedDate")),
      experienceLetterStatus: nullableText(data.get("experienceLetterStatus")),
      hrSessions,
      hrSessionNotes,
      notes: String(data.get("notes") ?? "").trim(),
    };

    const parsed = studentLifecycleUpdateSchema.safeParse(update);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Check the highlighted lifecycle information and try again.");
      setSubmitting(false);
      return;
    }
    if (parsed.data.feeTotal !== null && parsed.data.feeTotal < currentStudent.paid) {
      setError("Total course fee cannot be lower than posted payments.");
      setSubmitting(false);
      return;
    }

    try {
      await onSubmit(parsed.data);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save the student lifecycle.");
    } finally {
      setSubmitting(false);
    }
  }

  return <Modal open={open} title={`Edit ${student.name}`} eyebrow={`${student.code} · Administrator lifecycle editor`} onClose={onClose} width="wide">
    <form className="form-stack" key={`${student.id}-${student.updatedAt ?? "unversioned"}`} onSubmit={submit} aria-describedby={error ? "student-edit-error" : undefined}>
      <div className="form-section">
        <h3>Identity and contact</h3>
        <div className="form-grid">
          <label className="field span-2"><span>Full name</span><input name="name" required maxLength={200} defaultValue={student.name} /></label>
          <label className="field"><span>Email address</span><input name="email" type="email" maxLength={320} defaultValue={student.email} /></label>
          <label className="field"><span>Contact number</span><input name="phone" type="tel" maxLength={50} defaultValue={student.phone} /></label>
          <label className="field"><span>Registration date</span><input name="registrationDate" type="date" defaultValue={dateValue(student.registrationDate)} /></label>
          <label className="field"><span>Lifecycle owner</span><select name="ownerId" defaultValue={student.ownerId ?? ""}><option value="">Unassigned</option>{student.ownerId && !hasCurrentOwner ? <option value={student.ownerId}>{student.owner} (current)</option> : null}{options.owners.map((owner) => <option value={owner.id} key={owner.id}>{owner.name}</option>)}</select></label>
          <label className="field span-2"><span>Lifecycle status</span><select name="lifecycleStatus" defaultValue={student.status}>{LIFECYCLE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
      </div>

      <div className="form-section">
        <h3>Enrollment and course delivery</h3>
        <div className="form-grid">
          <label className="field span-2"><span>Course</span><select name="courseCode" defaultValue={hasEnrollment ? student.courseCode : ""}><option value="">No enrollment recorded</option>{hasEnrollment && !hasCurrentCourse ? <option value={student.courseCode}>{student.course} · {student.courseCode} (current)</option> : null}{options.courses.map((course) => <option value={course.code} key={course.code}>{course.name} · {course.code}{course.active ? "" : " (inactive)"}</option>)}</select></label>
          <label className="field"><span>Course status</span><select name="courseStatus" defaultValue={hasEnrollment ? student.courseStatus ?? "Not Started" : ""}><option value="">Not recorded</option>{COURSE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field"><span>Learning platform</span><select name="platformStatus" defaultValue={student.platformRecorded === false ? "" : student.platformStatus}><option value="">Not recorded</option>{PLATFORM_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field"><span>Joining date</span><input name="joiningDate" type="date" defaultValue={dateValue(student.joiningDate)} /></label>
          <label className="field"><span>Tentative completion</span><input name="tentativeCompletionDate" type="date" defaultValue={dateValue(student.tentativeCompletionDate ?? student.completionDate)} /></label>
          <label className="field"><span>Actual completion</span><input name="actualCompletionDate" type="date" defaultValue={dateValue(student.actualCompletionDate)} /></label>
          <label className="field"><span>Attendance percentage</span><input name="attendance" type="number" min="0" max="100" step="0.01" defaultValue={student.attendanceRecorded === false ? "" : student.attendance} placeholder="Not recorded" /></label>
          <label className="field span-2"><span>Time requirement / delivery note</span><input name="timeRequirement" maxLength={500} defaultValue={student.timeRequirement ?? ""} placeholder="Not recorded" /></label>
        </div>
      </div>

      <div className="form-section">
        <h3>Fees and payment schedule</h3>
        <div className="form-grid">
          <label className="field"><span>Total course fee (INR)</span><input name="feeTotal" type="number" min={student.paid} max="9999999999.99" step="0.01" defaultValue={feeQuantified ? student.feeTotal : ""} placeholder="Not quantified" /></label>
          <label className="field"><span>Posted payments (read only)</span><input value={student.paid.toFixed(2)} readOnly aria-readonly="true" /></label>
          <label className="field"><span>Next payment date</span><input name="nextPaymentDate" type="date" defaultValue={dateValue(student.nextPaymentDate)} /></label>
          <label className="field"><span>Next payment amount (INR)</span><input name="nextPaymentAmount" type="number" min="0.01" max="9999999999.99" step="0.01" defaultValue={student.nextPaymentDate && student.nextPaymentAmount ? student.nextPaymentAmount : ""} placeholder="No pending schedule" /></label>
        </div>
        <p className="security-note">This editor changes the fee account and one pending schedule. Posted payments are immutable here; use Record payment for a new receipt.</p>
      </div>

      <div className="form-section">
        <h3>Project and latest review</h3>
        <div className="form-grid">
          <label className="field span-2"><span>Project name</span><input name="projectName" maxLength={300} defaultValue={projectRecorded ? student.project : ""} placeholder="Not assigned" /></label>
          <label className="field span-2"><span>Project details</span><textarea name="projectDetails" maxLength={5000} defaultValue={student.projectDetails ?? ""} placeholder="Scope, deliverables or internal notes" /></label>
          <label className="field"><span>Project status</span><select name="projectStatus" defaultValue={student.projectStatus}>{PROJECT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field"><span>Deadline</span><input name="projectDeadline" type="date" defaultValue={dateValue(student.projectDeadline)} /></label>
          <label className="field"><span>Grade</span><input name="projectGrade" maxLength={50} defaultValue={student.grade ?? ""} placeholder="Not graded" /></label>
          <label className="field"><span>Latest review outcome</span><select name="reviewOutcome" defaultValue={student.reviewOutcome ?? ""}><option value="">Not reviewed</option><option>Approved</option><option>Revision Required</option><option>Rejected</option></select></label>
          <label className="field span-2"><span>Latest review feedback</span><textarea name="reviewDetails" maxLength={5000} defaultValue={student.reviewDetails ?? ""} placeholder="Leave blank when no review is recorded" /></label>
        </div>
      </div>

      <div className="form-section">
        <h3>Certificate and experience letter</h3>
        <div className="form-grid">
          <label className="field"><span>Certificate status</span><select name="certificateStatus" defaultValue={student.certificateRecorded === false ? "" : student.certificateStatus}><option value="">Not recorded (preserve)</option>{CERTIFICATE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field"><span>Certificate dispatch date</span><input name="certificateDispatchedDate" type="date" defaultValue={dateValue(student.certificateDispatchedDate)} /></label>
          <label className="field span-2"><span>Experience letter status</span><select name="experienceLetterStatus" defaultValue={student.experienceLetterRecorded === false ? "" : student.experienceLetterStatus}><option value="">Not recorded (preserve)</option>{EXPERIENCE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
      </div>

      <div className="form-section">
        <h3>HR sessions</h3>
        <div className="form-grid">
          {Array.from({ length: 4 }, (_, index) => <div className="field span-2" key={index}>
            <span>HR session {index + 1}</span>
            <div className="form-grid">
              <label className="field"><span className="sr-only">HR session {index + 1} status</span><select name={`hrSession${index + 1}`} defaultValue={student.hrSessions?.[index] ?? ""}><option value="">Not recorded</option>{HR_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
              <label className="field"><span className="sr-only">HR session {index + 1} notes</span><input name={`hrSessionNote${index + 1}`} maxLength={1000} defaultValue={student.hrSessionNotes?.[index] ?? ""} placeholder="Session notes" /></label>
            </div>
          </div>)}
        </div>
      </div>

      <div className="form-section">
        <h3>Internal notes and audit</h3>
        <div className="form-grid">
          <label className="field span-2"><span>Student notes</span><textarea name="notes" maxLength={10000} defaultValue={student.notes} placeholder="No internal notes recorded" /></label>
          <label className="field span-2"><span>Reason for this change</span><textarea name="editReason" minLength={10} maxLength={1000} required placeholder="Explain what changed and why (minimum 10 characters)." /></label>
        </div>
        <p className="security-note">Source lineage remains unchanged: {student.sourceSheet || "Production database"}{student.sourceYear ? ` · ${student.sourceYear}` : ""}{student.sourceRow ? ` · row ${student.sourceRow}` : ""}. Saving creates a timeline entry and a permanent audit record.</p>
      </div>

      {error ? <p className="auth-error" id="student-edit-error" role="alert">{error}</p> : null}
      <footer className="modal-footer"><span>All sections save together as one transaction.</span><div><button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>Cancel</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save lifecycle"}</button></div></footer>
    </form>
  </Modal>;
}
