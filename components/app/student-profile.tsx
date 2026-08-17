"use client";

import { useState } from "react";
import type { Student } from "@/types/domain";
import { Avatar, Badge, Modal, ProgressBar } from "@/components/ui/primitives";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const displayDate = (value: string | null | undefined) => value ? date.format(new Date(`${value.slice(0, 10)}T00:00:00`)) : "Not recorded";

export function StudentProfile({ student, open, onClose, onEdit, onRecordPayment, readOnly = false, canEdit = false, canRecordPayment = false }: {
  student: Student | null;
  open: boolean;
  onClose: () => void;
  onEdit: (student: Student) => void;
  onRecordPayment: (student: Student) => void;
  readOnly?: boolean;
  canEdit?: boolean;
  canRecordPayment?: boolean;
}) {
  const [tab, setTab] = useState("Overview");
  if (!student) return null;
  const pending = Math.max(0, student.feeTotal - student.paid);
  const tabs = ["Overview", "Course", "Fees", "Attendance", "Project", "HR & Placement", "Timeline"];

  return <Modal open={open} title={student.name} eyebrow={student.code} onClose={onClose} width="wide">
    <div className="profile-hero">
      <Avatar name={student.name} size="lg" />
      <div className="profile-identity"><div><Badge label={student.status} /><Badge label={student.courseCode} tone="neutral" /></div><p>{[student.email, student.phone].filter(Boolean).join(" · ") || "No contact details recorded"}</p></div>
      <div className="profile-actions">{canEdit ? <button className="secondary-button small-button" type="button" onClick={() => onEdit(student)}>Edit student</button> : null}{canRecordPayment && student.feeQuantified !== false && pending > 0 ? <button className="primary-button small-button" type="button" onClick={() => onRecordPayment(student)}>＋ Record payment</button> : null}{readOnly ? <Badge label="Read only" tone="neutral" /> : !canEdit && !canRecordPayment ? <Badge label="View only" tone="neutral" /> : null}</div>
    </div>
    <nav className="profile-tabs" aria-label="Student profile sections">{tabs.map((item) => <button type="button" className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <div className="profile-body">
      {tab === "Overview" ? <OverviewTab student={student} pending={pending} onViewTimeline={() => setTab("Timeline")} readOnly={readOnly} /> : null}
      {tab === "Course" ? <CourseTab student={student} /> : null}
      {tab === "Fees" ? <FeesTab student={student} pending={pending} onRecordPayment={() => onRecordPayment(student)} readOnly={readOnly} canRecordPayment={canRecordPayment} /> : null}
      {tab === "Attendance" ? <AttendanceTab student={student} /> : null}
      {tab === "Project" ? <ProjectTab student={student} readOnly={readOnly} /> : null}
      {tab === "HR & Placement" ? <HRTab student={student} readOnly={readOnly} /> : null}
      {tab === "Timeline" ? <TimelineTab student={student} /> : null}
    </div>
  </Modal>;
}

function OverviewTab({ student, pending, onViewTimeline, readOnly }: { student: Student; pending: number; onViewTimeline: () => void; readOnly: boolean }) {
  const feeUnquantified = readOnly || student.feeQuantified === false;
  return <div className="profile-grid">
    <section className="profile-section profile-span-2"><header><h3>Lifecycle snapshot</h3><button type="button" className="text-button" onClick={onViewTimeline}>View full history</button></header><div className="lifecycle-track">
      {["Registered", "Course active", "Project", "Completion", "Certificate", "Placement"].map((step, index) => <div className={index <= (student.status === "Completed" ? 4 : 1) ? "complete" : ""} key={step}><span>{index < 2 || student.status === "Completed" ? "✓" : index + 1}</span><small>{step}</small></div>)}
    </div></section>
    <section className="profile-section"><header><h3>Course</h3><Badge label={student.status} /></header><strong className="profile-primary-value">{student.course}</strong><dl className="detail-list"><div><dt>Joining date</dt><dd>{displayDate(student.joiningDate)}</dd></div><div><dt>Expected completion</dt><dd>{displayDate(student.completionDate)}</dd></div><div><dt>Trainer</dt><dd>{student.trainer}</dd></div><div><dt>Spayee</dt><dd>{student.platformStatus}</dd></div></dl></section>
    <section className="profile-section"><header><h3>Financial summary</h3><Badge label={feeUnquantified ? (student.feesStatus || "Not quantified") : pending ? "Partial" : "Paid"} /></header>{feeUnquantified ? <p className="notes-box">{student.feesStatus || "No quantified fee data is available."}</p> : <><strong className="profile-primary-value">{money.format(pending)} <small>pending</small></strong><ProgressBar value={student.feeTotal ? (student.paid / student.feeTotal) * 100 : 0} /></>}<dl className="detail-list compact">{feeUnquantified ? <><div><dt>Amounts</dt><dd>Not quantified</dd></div><div><dt>Next payment</dt><dd>{student.nextPayment || "Not recorded"}</dd></div></> : <><div><dt>Course fee</dt><dd>{money.format(student.feeTotal)}</dd></div><div><dt>Paid</dt><dd>{money.format(student.paid)}</dd></div><div><dt>Next payment</dt><dd>{student.nextPaymentDate ?? "—"}</dd></div></>}</dl></section>
    <section className="profile-section"><header><h3>Attendance</h3><span className="source-label">{student.attendanceSource === "system" ? "System-calculated" : "Imported history"}</span></header>{student.attendanceRecorded === false ? <p className="notes-box">{student.rawAttendance || "Not recorded"}</p> : <><div className="attendance-gauge"><strong>{student.attendance}%</strong><ProgressBar value={student.attendance} tone={student.attendance < 75 ? "orange" : "teal"} /></div><p>{student.attendance >= 75 ? "Meets current configured eligibility threshold." : "Below the current 75% eligibility threshold."}</p></>}</section>
    <section className="profile-section"><header><h3>Project & completion</h3>{student.project === "Not recorded" || student.project === "Not assigned" ? <Badge label="Not recorded" tone="neutral" /> : <Badge label={student.projectStatus} />}</header><strong className="profile-primary-value small-value">{student.project}</strong><dl className="detail-list compact"><div><dt>Deadline</dt><dd>{student.projectDeadline ?? "Not recorded"}</dd></div><div><dt>Grade</dt><dd>{student.grade ?? "Not recorded"}</dd></div><div><dt>Certificate</dt><dd>{readOnly ? (student.original?.certificateStatus ? String(student.original.certificateStatus) : "Not recorded") : student.certificateStatus}</dd></div></dl></section>
  </div>;
}

function CourseTab({ student }: { student: Student }) { return <div className="single-tab-grid"><section className="profile-section"><header><h3>Current enrollment</h3><Badge label={student.status} /></header><strong className="profile-primary-value">{student.course}</strong><dl className="detail-list"><div><dt>Course code</dt><dd>{student.courseCode}</dd></div><div><dt>Registered</dt><dd>{student.registrationDate ?? "Not recorded"}</dd></div><div><dt>Joined</dt><dd>{student.joiningDate ?? "Not recorded"}</dd></div><div><dt>Tentative completion</dt><dd>{student.completionDate ?? "Not recorded"}</dd></div><div><dt>Owner</dt><dd>{student.owner}</dd></div><div><dt>Primary trainer</dt><dd>{student.trainer}</dd></div><div><dt>Learning platform</dt><dd>{student.platformStatus}</dd></div><div><dt>Time requirement</dt><dd>{student.timeRequirement || "Not recorded"}</dd></div></dl></section><section className="profile-section"><header><h3>Imported course record</h3></header><dl className="detail-list"><div><dt>Source status / note</dt><dd>{student.original?.status ? String(student.original.status) : "Not recorded"}</dd></div><div><dt>Modules / certificates</dt><dd>{student.certificates || "Not recorded"}</dd></div><div><dt>Custom syllabus</dt><dd>{student.syllabusCustomized || "Not recorded"}</dd></div><div><dt>Source year</dt><dd>{student.sourceYear ?? "Live"}</dd></div><div><dt>Source row</dt><dd>{student.sourceRow || "Database"}</dd></div></dl><p className="notes-box">{student.notes || "No notes recorded."}</p></section></div>; }

function FeesTab({ student, pending, onRecordPayment, readOnly, canRecordPayment }: { student: Student; pending: number; onRecordPayment: () => void; readOnly: boolean; canRecordPayment: boolean }) { const feeUnquantified = readOnly || student.feeQuantified === false; return <div className="single-tab-grid"><section className="profile-section"><header><h3>Fee account</h3><Badge label={feeUnquantified ? (student.feesStatus || "Not quantified") : pending ? "Partial" : "Paid"} /></header>{feeUnquantified ? <><p className="notes-box">{student.feesStatus || "The source record does not provide trustworthy fee amounts for this student."}</p><dl className="detail-list"><div><dt>Next payment (source)</dt><dd>{student.nextPayment || "Not recorded"}</dd></div><div><dt>Quantified total</dt><dd>Not available</dd></div><div><dt>Quantified paid amount</dt><dd>Not available</dd></div></dl></> : <><div className="large-money-row"><div><span>Total fee</span><strong>{money.format(student.feeTotal)}</strong></div><div><span>Paid</span><strong className="money-paid">{money.format(student.paid)}</strong></div><div><span>Pending</span><strong className="money-pending">{money.format(pending)}</strong></div></div><ProgressBar value={student.feeTotal > 0 ? (student.paid / student.feeTotal) * 100 : 0} />{canRecordPayment && pending > 0 ? <button className="primary-button small-button" type="button" onClick={onRecordPayment}>＋ Record payment</button> : null}</>}</section><section className="profile-section"><header><h3>Source fee record</h3></header><dl className="detail-list"><div><dt>Fee status</dt><dd>{student.feesStatus || "Not quantified"}</dd></div><div><dt>Next payment</dt><dd>{student.nextPayment || student.nextPaymentDate || "Not recorded"}</dd></div></dl><p className="security-note">{feeUnquantified ? "Amounts are not inferred from percentages or free-text workbook cells." : "Financial corrections use a controlled void workflow and remain visible in the audit trail."}</p></section></div>; }

function AttendanceTab({ student }: { student: Student }) {
  const records = student.attendanceRecords ?? [];
  const hasRecordedAttendance = student.attendanceRecorded !== false && (Boolean(student.rawAttendance) || student.attendance > 0 || records.length > 0);
  return <section className="profile-section">
    <header><div><h3>Attendance record</h3><p>{student.attendanceSource === "system" ? "System-calculated attendance" : "Imported historical attendance"}</p></div>{hasRecordedAttendance ? <strong className="attendance-large">{student.attendance}%</strong> : null}</header>
    {hasRecordedAttendance ? <>
      <div className="attendance-gauge"><strong>{student.attendance}%</strong><ProgressBar value={student.attendance} tone={student.attendance < 75 ? "orange" : "teal"} /></div>
      <dl className="detail-list"><div><dt>Source value</dt><dd>{student.rawAttendance || `${student.attendance}%`}</dd></div><div><dt>Eligibility threshold</dt><dd>{student.attendance >= 75 ? "Meets 75% threshold" : "Below 75% threshold"}</dd></div><div><dt>Source</dt><dd>{student.sourceSheet || (student.attendanceSource === "system" ? "Production database" : "Imported record")}</dd></div></dl>
      {records.length ? <><div className="attendance-calendar">{records.map((record) => <span className={record.status.toLowerCase()} key={`${record.date}-${record.session}`} title={`${record.session}${record.remarks ? ` · ${record.remarks}` : ""}`}>{record.status.slice(0, 1)}<small>{record.date}</small></span>)}</div><div className="attendance-legend"><span><i className="present" /> Present</span><span><i className="absent" /> Absent</span><span><i className="leave" /> Leave</span><span><i className="late" /> Late</span></div></> : <p className="security-note">Session-by-session dates were not supplied in this record, so no daily attendance entries are shown.</p>}
    </> : <p className="notes-box">No attendance percentage or session-level attendance was recorded for this student.</p>}
  </section>;
}

function ProjectTab({ student, readOnly }: { student: Student; readOnly: boolean }) { const hasProject = student.project && student.project !== "Not recorded" && student.project !== "Not assigned"; return <div className="single-tab-grid"><section className="profile-section"><header><h3>Project record</h3>{hasProject ? <Badge label={student.projectStatus} /> : <Badge label="Not recorded" tone="neutral" />}</header><strong className="profile-primary-value">{hasProject ? student.project : "No project recorded"}</strong><dl className="detail-list"><div><dt>Trainer</dt><dd>{student.trainer}</dd></div><div><dt>Deadline</dt><dd>{student.projectDeadline ?? "Not recorded"}</dd></div><div><dt>Final grade</dt><dd>{student.grade ?? "Not recorded"}</dd></div><div><dt>Extension</dt><dd>{student.extension || "None recorded"}</dd></div></dl>{readOnly && !hasProject ? <p className="security-note">The normalized “Assigned” compatibility value is not treated as a source project assignment.</p> : null}</section><section className="profile-section"><header><h3>Latest review</h3></header><p className="notes-box">{student.reviewDetails || "No review detail recorded in the source workbook."}</p></section></div>; }

function HRTab({ student, readOnly }: { student: Student; readOnly: boolean }) { const sessions = student.hrSessions ?? []; const hasSessionProgress = sessions.some(Boolean); return <section className="profile-section"><header><h3>Career readiness path</h3>{readOnly && !hasSessionProgress ? <Badge label="Not recorded" tone="neutral" /> : <Badge label={`${student.hrPending} pending`} tone={student.hrPending ? "warning" : "success"} />}</header><div className="hr-checklist">{["HR Session 1 · Orientation", "HR Session 2 · Resume", "HR Session 3 · Mock interview", "HR Session 4 · Job assistance"].map((item, index) => <div className={sessions[index] ? "done" : ""} key={item}><span>{sessions[index] ? "✓" : index + 1}</span><div><strong>{item}</strong><small>{sessions[index] || "Not recorded"}</small></div></div>)}</div><dl className="detail-list"><div><dt>HR feedback</dt><dd>{student.hrFeedback || "Not recorded"}</dd></div><div><dt>Video feedback</dt><dd>{student.videoFeedback || "Not recorded"}</dd></div><div><dt>Google review</dt><dd>{student.googleReview || "Not recorded"}</dd></div><div><dt>Experience letter</dt><dd>{student.experienceLetterEligibility || student.experienceLetterStatus}</dd></div></dl></section>; }

function TimelineTab({ student }: { student: Student }) {
  const events: { when: string; action: string; detail: string }[] = [...(student.timelineEvents ?? [])];
  const addIfMissing = (event: { when: string; action: string; detail: string }) => {
    if (!events.some((item) => item.when.slice(0, 10) === event.when.slice(0, 10) && item.action === event.action)) events.push(event);
  };
  if (student.registrationDate) addIfMissing({ when: student.registrationDate, action: "Student registered", detail: student.sourceSheet ? `Recorded in ${student.sourceSheet}` : "Registration recorded" });
  if (student.joiningDate && student.joiningDate !== student.registrationDate) addIfMissing({ when: student.joiningDate, action: "Enrollment started", detail: student.course });
  if (student.status === "Completed" && student.completionDate) addIfMissing({ when: student.completionDate, action: "Training completed", detail: student.course });
  if (student.certificateDispatchedDate) addIfMissing({ when: student.certificateDispatchedDate, action: "Certificate dispatched", detail: student.certificateStatus });
  events.sort((left, right) => Date.parse(right.when) - Date.parse(left.when));
  return <section className="profile-section"><header><h3>Student timeline</h3><span className="source-label">Recorded milestones</span></header>{events.length ? <div className="student-timeline">{events.map(({ when, action, detail }) => <div key={`${when}-${action}`}><span /><div><time>{when.includes("T") ? dateTime.format(new Date(when)) : date.format(new Date(`${when}T00:00:00`))}</time><strong>{action}</strong><p>{detail}</p></div></div>)}</div> : <p className="notes-box">No dated lifecycle milestones are available for this student.</p>}</section>;
}
