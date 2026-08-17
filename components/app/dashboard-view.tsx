"use client";

import { APP_CONFIG, type Student, type ViewId } from "@/types/domain";
import type { Activity } from "@/types/domain";
import { Avatar, Badge, ProgressBar } from "@/components/ui/primitives";
import { currentWorkspaceDateLabel, isBeforeCurrentWorkspaceDate } from "@/lib/workspace-date";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type DashboardViewProps = {
  students: Student[];
  activities: Activity[];
  onNavigate: (view: ViewId, filter?: string) => void;
  onOpenStudent: (student: Student) => void;
  onAddStudent: () => void;
  onExport: (students: Student[]) => void;
  currentUserName: string;
  readOnly?: boolean;
  canExport?: boolean;
  canAddStudent?: boolean;
};

export function DashboardView({ students, activities, onNavigate, onOpenStudent, onAddStudent, onExport, currentUserName, readOnly = false, canExport = false, canAddStudent = false }: DashboardViewProps) {
  const active = students.filter((student) => student.status === "Active").length;
  const pendingFeeStudents = students.filter((student) => student.feeQuantified !== false && student.paid < student.feeTotal);
  const pendingFees = pendingFeeStudents.reduce((total, student) => total + student.feeTotal - student.paid, 0);
  const overdueProjects = students.filter(
    (student) => isBeforeCurrentWorkspaceDate(student.projectDeadline) && student.projectStatus !== "Completed",
  );
  const eligibleCertificates = students.filter((student) => readOnly ? Boolean(student.original?.certificateStatus) : student.certificateStatus === "Eligible");
  const hrPending = students.filter((student) => student.hrPending > 0);
  const feeRecords = students.filter((student) => student.feesStatus && student.feesStatus !== "Not quantified").length;

  const attention = [
    {
      label: readOnly ? "Fee records" : "Overdue fees",
      value: readOnly ? feeRecords : pendingFeeStudents.filter((student) => isBeforeCurrentWorkspaceDate(student.nextPaymentDate)).length,
      meta: readOnly ? "Raw workbook status" : money.format(pendingFees),
      tone: "red",
      action: () => onNavigate("fees", readOnly ? undefined : "overdue"),
    },
    {
      label: "Projects overdue",
      value: overdueProjects.length,
      meta: "Need trainer action",
      tone: "orange",
      action: () => onNavigate("projects", "overdue"),
    },
    {
      label: readOnly ? "Certificate status" : "Certificates ready",
      value: eligibleCertificates.length,
      meta: readOnly ? "Raw workbook entries" : "Eligibility passed",
      tone: "violet",
      action: () => onNavigate("certificates", readOnly ? undefined : "eligible"),
    },
    {
      label: "HR tasks pending",
      value: hrPending.length,
      meta: `${hrPending.reduce((sum, student) => sum + student.hrPending, 0)} open activities`,
      tone: "blue",
      action: () => onNavigate("hr", "pending"),
    },
  ];

  const recentStudents = students.slice(0, 5);
  const attendanceStudents = students.filter((student) => student.attendanceRecorded !== false && (student.rawAttendance || student.attendanceSource === "system" || student.attendance > 0));
  const averageAttendance = attendanceStudents.length ? Math.round(attendanceStudents.reduce((sum, student) => sum + student.attendance, 0) / attendanceStudents.length) : 0;
  const quantifiedFeeStudents = students.filter((student) => student.feeQuantified !== false);
  const totalFees = quantifiedFeeStudents.reduce((sum, student) => sum + student.feeTotal, 0);
  const paidFees = quantifiedFeeStudents.reduce((sum, student) => sum + student.paid, 0);
  const feeCollection = totalFees ? Math.round((paidFees / totalFees) * 100) : 0;
  const projectCompletion = students.length ? Math.round((students.filter((student) => student.projectStatus === "Completed").length / students.length) * 100) : 0;

  return (
    <div className="view-stack dashboard-view">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{currentWorkspaceDateLabel()}</p>
          <h1>Welcome, {currentUserName.split(" ")[0] || "RASA staff"}.</h1>
          <p className="welcome-copy">Here’s what needs your attention across the student lifecycle.</p>
        </div>
        <div className="welcome-actions">
          {canExport ? <button className="secondary-button" type="button" onClick={() => onExport(students)} disabled={!students.length}>
            <span aria-hidden="true">⇩</span> Export students
          </button> : null}
          {canAddStudent && !readOnly ? <button className="primary-button" type="button" onClick={onAddStudent}>
            <span aria-hidden="true">＋</span> Add student
          </button> : null}
        </div>
      </section>

      <section className="attention-grid" aria-label="Items requiring attention">
        {attention.map((item) => (
          <button className={`attention-card tone-${item.tone}`} type="button" onClick={item.action} key={item.label}>
            <span className="attention-icon" aria-hidden="true">{item.tone === "red" ? "!" : item.tone === "orange" ? "↗" : item.tone === "violet" ? "✓" : "○"}</span>
            <span className="attention-content">
              <span className="attention-label">{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.meta}</small>
            </span>
            <span className="card-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </section>

      <section className="dashboard-main-grid">
        <article className="panel overview-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Student overview</p>
              <h2>Lifecycle health</h2>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate("students")}>View all students <span>›</span></button>
          </header>

          <div className="overview-content">
            <div className="donut-wrap">
              <div className="donut" style={{ "--active": `${students.length ? Math.round((active / students.length) * 100) : 0}%` } as React.CSSProperties}>
                <div className="donut-center">
                  <strong>{students.length}</strong>
                  <span>Total students</span>
                </div>
              </div>
              <div className="legend-list">
                <div><span className="legend-dot teal" /><span>Active</span><strong>{active}</strong></div>
                <div><span className="legend-dot indigo" /><span>Completed</span><strong>{students.filter((student) => student.status === "Completed").length}</strong></div>
                <div><span className="legend-dot orange" /><span>Extended / hold</span><strong>{students.filter((student) => ["Extended", "On Hold"].includes(student.status)).length}</strong></div>
                <div><span className="legend-dot gray" /><span>Registered</span><strong>{students.filter((student) => student.status === "Registered").length}</strong></div>
              </div>
            </div>

            <div className="mini-stat-grid">
              <div>
                <span>Avg. attendance</span>
                <strong>{averageAttendance}%</strong>
                <ProgressBar value={averageAttendance} />
              </div>
              <div>
                <span>{readOnly ? "Fee status recorded" : "Fee collection"}</span>
                <strong>{readOnly ? `${feeRecords}/${students.length}` : `${feeCollection}%`}</strong>
                <ProgressBar value={readOnly ? (students.length ? (feeRecords / students.length) * 100 : 0) : feeCollection} tone="violet" />
              </div>
              <div>
                <span>Project completion</span>
                <strong>{projectCompletion}%</strong>
                <ProgressBar value={projectCompletion} tone="orange" />
              </div>
            </div>
          </div>
        </article>

        <article className="panel activity-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Live operations</p>
              <h2>Recent activity</h2>
            </div>
            <button className="more-button" type="button" aria-label="Open activity reports" onClick={() => onNavigate("reports")}>•••</button>
          </header>
          <div className="activity-list">
            {activities.length ? activities.map((activity) => (
              <button type="button" className="activity-item" key={activity.id} onClick={() => {
                const student = students.find((item) => item.id === activity.studentId);
                if (student) onOpenStudent(student);
              }}>
                <span className={`activity-dot activity-${activity.tone}`} />
                <span className="activity-body">
                  <strong>{activity.action}</strong>
                  <span>{activity.studentName} · {activity.studentCode}</span>
                  <small>{activity.detail}</small>
                </span>
                <time>{activity.timestamp}</time>
              </button>
            )) : <div className="empty-state compact-activity-empty"><h3>No audited activity yet</h3><p>{readOnly ? "The workbook does not contain dated application activity for this view." : "Database changes will appear here after the production import."}</p></div>}
          </div>
        </article>
      </section>

      <section className="panel compact-table-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Recently updated</p>
            <h2>Student records</h2>
          </div>
          <span className="timezone-note">All dates · {APP_CONFIG.timezone}</span>
        </header>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Student</th><th>Course</th><th>Status</th><th>Fee progress</th><th>Project</th><th>Trainer</th><th /></tr>
            </thead>
            <tbody>
              {recentStudents.map((student) => {
                const percentage = student.feeTotal ? Math.round((student.paid / student.feeTotal) * 100) : 0;
                return (
                  <tr key={student.id} onClick={() => onOpenStudent(student)}>
                    <td>
                      <div className="student-cell"><Avatar name={student.name} /><div><strong>{student.name}</strong><span>{student.code}</span></div></div>
                    </td>
                    <td><strong className="cell-primary">{student.course}</strong><span className="cell-secondary">{student.courseCode}</span></td>
                    <td><Badge label={student.status} /></td>
                    <td>
                      {readOnly || student.feeQuantified === false ? <span className="cell-primary">{student.feesStatus || "Not quantified"}</span> : <div className="fee-cell"><span>{money.format(student.paid)} <small>of {money.format(student.feeTotal)}</small></span><ProgressBar value={percentage} /></div>}
                    </td>
                    <td><Badge label={student.project === "Not recorded" || student.project === "Not assigned" ? "Not recorded" : student.projectStatus} /></td>
                    <td>{student.trainer}</td>
                    <td><button className="row-action" type="button" aria-label={`Open ${student.name}`} onClick={(event) => { event.stopPropagation(); onOpenStudent(student); }}>›</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
