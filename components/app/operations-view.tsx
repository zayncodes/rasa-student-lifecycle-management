"use client";

import type { Student, ViewId } from "@/types/domain";
import { Avatar, Badge, ProgressBar } from "@/components/ui/primitives";
import { isBeforeCurrentWorkspaceDate } from "@/lib/workspace-date";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function OperationsView({ view, students, filter, onOpenStudent, readOnly = false }: {
  view: Exclude<ViewId, "home" | "dashboard" | "students">;
  students: Student[];
  filter?: string;
  onOpenStudent: (student: Student) => void;
  readOnly?: boolean;
}) {
  if (view === "courses") return <CoursesView students={students} onOpenStudent={onOpenStudent} />;
  if (view === "fees") return <FeesView students={students} filter={filter} onOpenStudent={onOpenStudent} readOnly={readOnly} />;
  if (view === "projects") return <ProjectsView students={students} filter={filter} onOpenStudent={onOpenStudent} />;
  if (view === "certificates") return <CertificatesView students={students} filter={filter} onOpenStudent={onOpenStudent} readOnly={readOnly} />;
  if (view === "hr") return <HRView students={students} onOpenStudent={onOpenStudent} readOnly={readOnly} />;
  return <UtilityView view={view as "imports" | "notifications" | "settings"} />;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <section className="page-heading-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</section>;
}

function CoursesView({ students, onOpenStudent }: { students: Student[]; onOpenStudent: (student: Student) => void }) {
  const courses = Array.from(new Set(students.map((student) => student.course))).map((name) => {
    const enrolled = students.filter((student) => student.course === name);
    return { name, code: enrolled[0]?.courseCode ?? "COURSE", students: enrolled.length, completion: enrolled.length ? Math.round((enrolled.filter((student) => student.status === "Completed").length / enrolled.length) * 100) : 0 };
  }).sort((a, b) => b.students - a.students);
  return <div className="view-stack">
    <PageIntro eyebrow="Academic operations" title="Courses" description="Programmes derived from the imported client enrollment records." />
    <section className="course-grid">
      {courses.map((course, index) => <article className="panel course-card" key={`${course.code}-${course.name}`}>
        <div className={`course-mark course-mark-${index + 1}`} title={course.code}>{course.code.slice(0, 2)}</div>
        <div className="course-card-main"><span className="course-code" title={course.code}>{course.code}</span><h2 title={course.name}>{course.name}</h2><p>Imported enrollment group</p></div>
        <div className="course-stats"><div><strong>{course.students}</strong><span>students</span></div><div><strong>{course.completion}%</strong><span>completion</span></div></div>
        <ProgressBar value={course.completion} tone={index % 2 ? "violet" : "teal"} />
        <button type="button" className="text-button" onClick={() => { const student = students.find((item) => item.course === course.name); if (student) onOpenStudent(student); }}>Open student record <span>›</span></button>
      </article>)}
    </section>
  </div>;
}

function FeesView({ students, filter, onOpenStudent, readOnly }: { students: Student[]; filter?: string; onOpenStudent: (student: Student) => void; readOnly: boolean }) {
  const pending = students.filter((student) => student.paid < student.feeTotal);
  const overdue = pending.filter((student) => isBeforeCurrentWorkspaceDate(student.nextPaymentDate));
  const rawRows = students.filter((student) => student.feesStatus && student.feesStatus !== "Not quantified");
  const rows = readOnly ? rawRows : filter === "overdue" ? overdue : pending;
  const totalBilled = students.reduce((sum, student) => sum + student.feeTotal, 0);
  const totalPaid = students.reduce((sum, student) => sum + student.paid, 0);
  return <div className="view-stack">
    <PageIntro eyebrow="Financial operations" title="Fees & payments" description={readOnly ? "Read-only fee status exactly as recorded in the client workbook; amounts are not inferred." : "A transaction-led view of collections, schedules and overdue installments."} />
    <section className="summary-card-grid">
      {readOnly ? <><article className="summary-card"><span>Student records</span><strong>{students.length}</strong><small>Workbook operational rows</small></article><article className="summary-card"><span>Fee status recorded</span><strong>{rawRows.length}</strong><small>Free-text source values</small></article><article className="summary-card"><span>Not quantified</span><strong>{students.length - rawRows.length}</strong><small>No usable fee status</small></article><article className="summary-card"><span>Amounts</span><strong>Unavailable</strong><small>Not inferred from percentages</small></article></> : <><article className="summary-card"><span>Total billed</span><strong>{money.format(totalBilled)}</strong><small>Across {students.length} enrollments</small></article><article className="summary-card"><span>Collected</span><strong>{money.format(totalPaid)}</strong><small className="positive">{totalBilled ? Math.round((totalPaid / totalBilled) * 100) : 0}% collection rate</small></article><article className="summary-card"><span>Outstanding</span><strong>{money.format(totalBilled - totalPaid)}</strong><small>{pending.length} student accounts</small></article><article className="summary-card danger-summary"><span>Overdue</span><strong>{overdue.length}</strong><small>Require follow-up today</small></article></>}
    </section>
    <section className="panel queue-panel">
      <header className="panel-header"><div><p className="eyebrow">{readOnly ? "Source records" : "Collection queue"}</p><h2>{readOnly ? "Imported fee status" : filter === "overdue" ? "Overdue installments" : "Outstanding student accounts"}</h2></div><Badge label={`${rows.length} records`} tone={readOnly ? "neutral" : "danger"} /></header>
      <div className="queue-list">{rows.map((student) => <button type="button" className="queue-row" key={student.id} onClick={() => onOpenStudent(student)}>
        <div className="student-cell"><Avatar name={student.name} /><div><strong title={student.name}>{student.name}</strong><span title={`${student.code} · ${student.courseCode}`}>{student.code} · {student.courseCode}</span></div></div>
        <div><span className="queue-label">{readOnly ? "Next payment (source)" : "Next installment"}</span><strong title={readOnly ? (student.nextPayment || "Not recorded") : (student.nextPaymentDate ?? "Not scheduled")}>{readOnly ? (student.nextPayment || "Not recorded") : (student.nextPaymentDate ?? "Not scheduled")}</strong></div>
        <div><span className="queue-label">{readOnly ? "Fee status" : "Outstanding"}</span><strong className={readOnly ? "" : "money-pending"} title={readOnly ? student.feesStatus : money.format(student.feeTotal - student.paid)}>{readOnly ? student.feesStatus : money.format(student.feeTotal - student.paid)}</strong></div>
        {readOnly ? <div className="collection-progress"><span>Amounts not quantified</span></div> : <div className="collection-progress"><span>{student.feeTotal ? Math.round((student.paid / student.feeTotal) * 100) : 0}% collected</span><ProgressBar value={student.feeTotal ? (student.paid / student.feeTotal) * 100 : 0} /></div>}
        <span className="row-action">›</span>
      </button>)}</div>
    </section>
  </div>;
}

function ProjectsView({ students, filter, onOpenStudent }: { students: Student[]; filter?: string; onOpenStudent: (student: Student) => void }) {
  const projects = students.filter((student) => student.project !== "Not assigned" && student.project !== "Not recorded");
  const overdue = projects.filter((student) => isBeforeCurrentWorkspaceDate(student.projectDeadline) && student.projectStatus !== "Completed");
  const rows = filter === "overdue" ? overdue : filter === "review" ? projects.filter((student) => ["Submitted", "Under Review", "Revision Required"].includes(student.projectStatus)) : projects;
  return <div className="view-stack">
    <PageIntro eyebrow="Academic delivery" title="Projects & reviews" description="See imported projects, trainer reviews, revisions and grades in one queue." />
    <section className="project-board">
      {["Assigned", "In Progress", "Under Review", "Revision Required", "Completed"].map((status) => {
        const items = rows.filter((student) => student.projectStatus === status || (status === "Under Review" && student.projectStatus === "Submitted"));
        return <div className="project-column" key={status}><header><span title={status}>{status}</span><strong>{items.length}</strong></header><div className="project-column-body">{items.map((student) => <button type="button" className="project-card" key={student.id} onClick={() => onOpenStudent(student)}>
          <div><span className="project-badge-wrap" title={student.courseCode}><Badge label={student.courseCode} tone="neutral" /></span><span className="project-deadline" title={student.projectDeadline ?? "No deadline"}>{student.projectDeadline ?? "No deadline"}</span></div>
          <h3 title={student.project}>{student.project}</h3><p title={student.name}>{student.name}</p>
          <footer><Avatar name={student.trainer} size="sm" /><span title={student.trainer}>{student.trainer}</span>{student.grade ? <span className="project-grade-wrap" title={student.grade}><Badge label={student.grade} tone="success" /></span> : null}</footer>
        </button>)}{!items.length ? <div className="column-empty">No projects</div> : null}</div></div>;
      })}
    </section>
  </div>;
}

function CertificatesView({ students, filter, onOpenStudent, readOnly }: { students: Student[]; filter?: string; onOpenStudent: (student: Student) => void; readOnly: boolean }) {
  const rawStatus = (student: Student) => student.original?.certificateStatus ? String(student.original.certificateStatus).trim() : "";
  const certificateRecords = students.filter((student) => readOnly ? Boolean(rawStatus(student)) : student.certificateStatus !== "Not Eligible");
  const queue = filter === "eligible" && !readOnly ? certificateRecords.filter((student) => student.certificateStatus === "Eligible") : certificateRecords;
  const steps = readOnly
    ? Array.from(new Set(certificateRecords.map(rawStatus))).map((status) => ({ label: status, count: certificateRecords.filter((student) => rawStatus(student) === status).length }))
    : ["Eligible", "Requested", "Generated", "Dispatched", "Delivered"].map((status) => ({ label: status, count: certificateRecords.filter((student) => student.certificateStatus === status).length }));
  return <div className="view-stack">
    <PageIntro eyebrow="Completion documents" title="Certificates" description={readOnly ? "Certificate status exactly as recorded in the client workbook." : "Eligibility, approval, generation and dispatch without a parallel tracker."} />
    <section className="certificate-steps">
      {steps.map((step) => <article key={step.label}><span title={step.label}>{step.label}</span><strong>{step.count}</strong></article>)}
    </section>
    <section className="panel queue-panel"><header className="panel-header"><div><p className="eyebrow">Action queue</p><h2>Certificate workflow</h2></div></header>
      <div className="queue-list">{queue.map((student) => <button type="button" className="queue-row certificate-row" key={student.id} onClick={() => onOpenStudent(student)}>
        <div className="student-cell"><Avatar name={student.name} /><div><strong title={student.name}>{student.name}</strong><span title={student.code}>{student.code}</span></div></div>
        <div><span className="queue-label">Course</span><strong title={student.course}>{student.course}</strong></div><div><span className="queue-label">Attendance</span><strong>{readOnly && student.attendanceRecorded === false ? (student.rawAttendance || "Not recorded") : `${student.attendance}%`}</strong></div><span className="queue-badge-wrap" title={readOnly ? rawStatus(student) : student.certificateStatus}><Badge label={readOnly ? rawStatus(student) : student.certificateStatus} /></span><span className="row-action">›</span>
      </button>)}</div>
    </section>
  </div>;
}

function HRView({ students, onOpenStudent, readOnly }: { students: Student[]; onOpenStudent: (student: Student) => void; readOnly: boolean }) {
  const queue = students.filter((student) => student.hrPending > 0).sort((a, b) => b.hrPending - a.hrPending);
  return <div className="view-stack">
    <PageIntro eyebrow="Career readiness" title="HR & placement" description="Track imported HR sessions, feedback and placement-readiness information." />
    <section className="summary-card-grid"><article className="summary-card"><span>HR records</span><strong>{students.filter((student) => (student.hrSessions ?? []).some(Boolean)).length}</strong><small>Students with session history</small></article><article className="summary-card"><span>Feedback recorded</span><strong>{students.filter((student) => student.hrFeedback).length}</strong><small>Imported HR feedback</small></article><article className="summary-card"><span>Video feedback</span><strong>{students.filter((student) => student.videoFeedback).length}</strong><small>Source workbook entries</small></article><article className="summary-card"><span>{readOnly ? "Experience-letter entries" : "Placement ready"}</span><strong>{students.filter((student) => readOnly ? Boolean(student.experienceLetterEligibility) : student.experienceLetterStatus !== "Not Eligible").length}</strong><small>{readOnly ? "Raw workbook values" : "Eligible or issued"}</small></article></section>
    <section className="panel queue-panel"><header className="panel-header"><div><p className="eyebrow">Pending activities</p><h2>Student readiness queue</h2></div></header><div className="queue-list">{queue.map((student) => <button className="queue-row hr-row" type="button" key={student.id} onClick={() => onOpenStudent(student)}><div className="student-cell"><Avatar name={student.name} /><div><strong title={student.name}>{student.name}</strong><span title={`${student.code} · ${student.courseCode}`}>{student.code} · {student.courseCode}</span></div></div><div className="session-pills">{[1,2,3,4].map((session) => <span className={session <= 4 - student.hrPending ? "done" : ""} key={session}>S{session}</span>)}</div><strong>{student.hrPending} pending</strong><span className="row-action">›</span></button>)}</div></section>
  </div>;
}

function UtilityView({ view }: { view: "imports" | "notifications" | "settings" }) {
  const content = {
    imports: ["Import centre", "Safely map, validate and stage Excel data before committing it.", ["Upload workbook", "Choose sheet", "Map columns", "Validate rows", "Review & import"]],
    notifications: ["Notifications", "Review upcoming and overdue events across the lifecycle.", ["Payments due", "Project deadlines", "Certificate actions", "HR sessions", "Course completion"]],
    settings: ["Settings", "Configure organization defaults and business rules without code changes.", ["Organization", "Eligibility rules", "Notification windows", "Roles & permissions", "Custom fields"]],
  }[view];
  return <div className="view-stack"><PageIntro eyebrow="System workspace" title={content[0] as string} description={content[1] as string} /><section className="utility-grid">{(content[2] as string[]).map((item, index) => <article className="panel utility-card" key={item}><span className={`utility-icon utility-${index + 1}`}>{index + 1}</span><div><h2>{item}</h2><p>{view === "imports" ? "Available after authenticated database setup" : "Planned for the access-controlled release"}</p></div></article>)}</section></div>;
}
