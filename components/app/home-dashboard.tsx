"use client";

import { useId, useMemo, useState, type CSSProperties } from "react";
import type { Student, ViewId } from "@/types/domain";
import { Avatar, Badge, ProgressBar } from "@/components/ui/primitives";
import { currentWorkspaceDateLabel, isBeforeCurrentWorkspaceDate } from "@/lib/workspace-date";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const sourceTones = ["teal", "orange", "violet", "blue"] as const;
const sourceColors = ["#119985", "#f4773c", "#7156d5", "#377fbe"] as const;
const INITIAL_PROGRAMME_REPORT_ROWS = 6;

type HomeDashboardProps = {
  students: Student[];
  onNavigate: (view: ViewId, filter?: string) => void;
  onOpenStudent: (student: Student) => void;
  readOnly?: boolean;
};

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

export function HomeDashboard({ students, onNavigate, onOpenStudent, readOnly = false }: HomeDashboardProps) {
  const [programme, setProgramme] = useState("All programmes");
  const [year, setYear] = useState("All years");
  const [showAllProgrammes, setShowAllProgrammes] = useState(false);
  const programmeReportId = useId();
  const programmeReportHeadingId = `${programmeReportId}-heading`;
  const programmes = useMemo(() => Array.from(new Set(students.map((student) => student.course))).sort(), [students]);
  const years = useMemo(() => Array.from(new Set(students.map((student) => student.sourceYear ?? Number(student.registrationDate?.slice(0, 4))).filter(Boolean))).sort((a, b) => b - a), [students]);
  const filteredStudents = useMemo(
    () => students.filter((student) => (programme === "All programmes" || student.course === programme) && (year === "All years" || String(student.sourceYear ?? student.registrationDate?.slice(0, 4) ?? "") === year)),
    [programme, students, year],
  );

  const total = filteredStudents.length;
  const active = filteredStudents.filter((student) => ["Active", "Extended", "On Hold"].includes(student.status)).length;
  const completed = filteredStudents.filter((student) => student.status === "Completed").length;
  const careerReady = filteredStudents.filter((student) => student.experienceLetterStatus !== "Not Eligible" || ((student.hrSessions ?? []).some(Boolean) && student.hrPending === 0)).length;
  const projectReady = filteredStudents.filter((student) => student.projectStatus !== "Assigned").length;
  const attendanceStudents = filteredStudents.filter((student) => student.attendanceRecorded !== false && (student.rawAttendance || student.attendanceSource === "system" || student.attendance > 0));
  const averageAttendance = attendanceStudents.length ? Math.round(attendanceStudents.reduce((sum, student) => sum + student.attendance, 0) / attendanceStudents.length) : 0;
  const totalFees = filteredStudents.reduce((sum, student) => sum + student.feeTotal, 0);
  const feesPaid = filteredStudents.reduce((sum, student) => sum + student.paid, 0);
  const feeCollection = percentage(feesPaid, totalFees);
  const feeRecords = filteredStudents.filter((student) => student.feesStatus && student.feesStatus !== "Not quantified").length;
  const projectCompletion = percentage(filteredStudents.filter((student) => student.projectStatus === "Completed").length, total);

  const cohortCounts = Array.from(new Set(filteredStudents.map((student) => student.sourceYear ?? Number(student.registrationDate?.slice(0, 4))).filter(Boolean)))
    .sort((left, right) => right - left)
    .map((cohortYear) => ({ label: `${cohortYear} cohort`, count: filteredStudents.filter((student) => (student.sourceYear ?? Number(student.registrationDate?.slice(0, 4))) === cohortYear).length }));
  const sourceGroups = cohortCounts.length <= 4 ? cohortCounts : [...cohortCounts.slice(0, 3), { label: `${cohortCounts.at(-1)?.label.replace(" cohort", "")}–${cohortCounts[3].label.replace(" cohort", "")} cohorts`, count: cohortCounts.slice(3).reduce((sum, cohort) => sum + cohort.count, 0) }];
  const sourceData = sourceGroups.map((source, index) => ({ ...source, tone: sourceTones[index] }));
  const sourcePercentages = sourceData.map((source) => percentage(source.count, total));
  const sourceStops = sourceData.map((_, index) => {
    const start = sourcePercentages.slice(0, index).reduce((sum, value) => sum + value, 0);
    const end = start + sourcePercentages[index];
    return `${sourceColors[index]} ${start}% ${end}%`;
  });
  const sourceStyle = {
    background: sourceStops.length ? `conic-gradient(${sourceStops.join(", ")})` : "#e8eceb",
  } satisfies CSSProperties;

  const lifecycle = [
    { short: "01", label: "Registered", count: total, tone: "teal", view: "students" as ViewId },
    { short: "02", label: "Enrolled", count: Math.max(total - filteredStudents.filter((student) => student.status === "Registered").length, 0), tone: "orange", view: "students" as ViewId },
    { short: "03", label: "Learning", count: active, tone: "teal", view: "students" as ViewId, filter: "active" },
    { short: "04", label: "Project", count: projectReady, tone: "blue", view: "projects" as ViewId },
    { short: "05", label: "Completed", count: completed, tone: "violet", view: "certificates" as ViewId },
    { short: "06", label: "Career ready", count: careerReady, tone: "teal", view: "hr" as ViewId },
  ];

  const courseReport = programmes
    .map((course) => {
      const courseStudents = filteredStudents.filter((student) => student.course === course);
      return { course, code: courseStudents[0]?.courseCode ?? "", count: courseStudents.length, value: percentage(courseStudents.length, total) };
    })
    .filter((course) => course.count > 0)
    .sort((left, right) => right.count - left.count || left.course.localeCompare(right.course, "en", { sensitivity: "base" }));
  const canExpandProgrammeReport = courseReport.length > INITIAL_PROGRAMME_REPORT_ROWS;
  const programmeReportExpanded = canExpandProgrammeReport && showAllProgrammes;
  const visibleCourseReport = programmeReportExpanded ? courseReport : courseReport.slice(0, INITIAL_PROGRAMME_REPORT_ROWS);
  const hiddenProgrammeCount = Math.max(0, courseReport.length - INITIAL_PROGRAMME_REPORT_ROWS);

  const onTrack = attendanceStudents.filter((student) => student.attendance >= 80 && student.status !== "On Hold").length;
  const needsSupport = attendanceStudents.filter((student) => student.attendance < 75 || student.status === "On Hold").length;
  const watch = Math.max(attendanceStudents.length - onTrack - needsSupport, 0);
  const overdueFees = readOnly ? 0 : filteredStudents.filter((student) => student.paid < student.feeTotal && isBeforeCurrentWorkspaceDate(student.nextPaymentDate)).length;
  const reviewDue = filteredStudents.filter((student) => ["Submitted", "Under Review", "Revision Required"].includes(student.projectStatus)).length;
  const certificatesReady = filteredStudents.filter((student) => readOnly ? Boolean(student.original?.certificateStatus) : student.certificateStatus === "Eligible").length;
  const hrActions = filteredStudents.reduce((sum, student) => sum + ((student.hrSessions ?? []).some(Boolean) ? student.hrPending : 0), 0);

  return <div className="view-stack home-dashboard">
    <section className="home-dashboard-heading">
      <div>
        <p className="eyebrow">{currentWorkspaceDateLabel()}</p>
        <h1>Operations dashboard</h1>
        <p>A complete view of every student, from first enquiry to placement.</p>
      </div>
      <div className="home-heading-filters">
        <label className="home-programme-filter home-programme-filter-year"><span>Year</span><select value={year} onChange={(event) => { setYear(event.target.value); setShowAllProgrammes(false); }} aria-label="Filter dashboard by year"><option>All years</option>{years.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="home-programme-filter home-programme-filter-programme"><span>Programme</span><select value={programme} onChange={(event) => { setProgramme(event.target.value); setShowAllProgrammes(false); }} aria-label="Filter dashboard by programme"><option>All programmes</option>{programmes.map((course) => <option key={course}>{course}</option>)}</select></label>
      </div>
    </section>

    <section className="home-hero">
      <div className="home-hero-copy">
        <p>RASA SLMS</p>
        <h2>One student.<br />One complete lifecycle.</h2>
        <span>Student operations without the spreadsheets.</span>
        <button type="button" onClick={() => onNavigate("dashboard")}>Open command center <b aria-hidden="true">→</b></button>
      </div>
      <div className="home-overview-card">
        <header>
          <div><p className="eyebrow">Current workspace</p><h2>Lifecycle overview</h2></div>
          <span>{programme}</span>
        </header>
        <div className="home-metric-grid">
          {[
            { code: "ST", label: "Total students", value: total, note: "Across this view", tone: "teal", action: () => onNavigate("students") },
            { code: "AC", label: "Active learning", value: active, note: `${percentage(active, total)}% of students`, tone: "orange", action: () => onNavigate("students", "active") },
            { code: "CP", label: "Completed", value: completed, note: `${percentage(completed, total)}% completion`, tone: "violet", action: () => onNavigate("certificates") },
            { code: "HR", label: "Career ready", value: careerReady, note: `${percentage(careerReady, total)}% placement-ready`, tone: "blue", action: () => onNavigate("hr") },
          ].map((metric) => <button type="button" className="home-metric" key={metric.label} onClick={metric.action}>
            <span className={`home-metric-mark ${metric.tone}`}>{metric.code}</span>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
            <em>{metric.note}</em>
          </button>)}
        </div>
      </div>
    </section>

    <section className="panel home-lifecycle-panel">
      <header className="home-panel-heading">
        <div><p className="eyebrow">Student journey</p><h2>Lifecycle progress</h2></div>
        <button className="text-button" type="button" onClick={() => onNavigate("students")}>View student register <span>›</span></button>
      </header>
      <div className="home-lifecycle-track">
        {lifecycle.map((stage) => <button type="button" key={stage.label} onClick={() => onNavigate(stage.view, stage.filter)}>
          <span className={`home-stage-mark ${stage.tone}`}>{stage.short}</span>
          <small>{stage.label}</small>
          <strong>{stage.count}</strong>
          <em>{percentage(stage.count, total)}%</em>
          <ProgressBar value={percentage(stage.count, total)} tone={stage.tone === "violet" ? "violet" : stage.tone === "orange" ? "orange" : "teal"} />
        </button>)}
      </div>
    </section>

    <section className="home-insight-grid">
      <article className="panel home-source-panel">
        <header className="home-panel-heading">
          <div><p className="eyebrow">Source workbook</p><h2>Cohort distribution</h2></div>
          <button className="more-button" type="button" aria-label="Open reports" onClick={() => onNavigate("reports")}>•••</button>
        </header>
        <div className="home-source-content">
          <div className="home-source-donut" style={sourceStyle}><span><strong>{total}</strong><small>students</small></span></div>
          <div className="home-source-list">
            {sourceData.map((source) => <div key={source.label}><i className={source.tone} /><span>{source.label}</span><strong>{source.count}</strong><small>{percentage(source.count, total)}%</small></div>)}
          </div>
        </div>
      </article>

      <article className="panel home-report-panel">
        <header className="home-panel-heading">
          <div><p className="eyebrow">Performance</p><h2>Student report</h2></div>
          <button className="text-button" type="button" onClick={() => onNavigate("reports")}>Full report <span>›</span></button>
        </header>
        <div className="home-report-content">
          <div className="home-course-report">
            <p id={programmeReportHeadingId}>Students by programme</p>
            <div
              id={programmeReportId}
              className={`home-course-report-list${programmeReportExpanded ? " is-expanded" : ""}`}
              role="list"
              aria-labelledby={programmeReportHeadingId}
            >
              {visibleCourseReport.map((course) => <div className="home-course-row" role="listitem" key={course.course}>
                <span><strong>{course.code}</strong><small>{course.course}</small></span>
                <div><i style={{ width: `${Math.max(course.value, 5)}%` }} /></div>
                <b>{course.count}</b>
              </div>)}
            </div>
            {canExpandProgrammeReport ? <button
              className="text-button home-report-toggle"
              type="button"
              aria-controls={programmeReportId}
              aria-expanded={programmeReportExpanded}
              aria-label={programmeReportExpanded ? "Show fewer programmes" : `Show ${hiddenProgrammeCount} more programmes`}
              onClick={() => setShowAllProgrammes((current) => !current)}
            >
              {programmeReportExpanded ? "Show less" : `Show more (${hiddenProgrammeCount})`}
            </button> : null}
          </div>
          <div className="home-report-kpis">
            {[
              ["Average attendance", averageAttendance, "teal"],
              [readOnly ? "Fee status recorded" : "Fee collection", readOnly ? percentage(feeRecords, total) : feeCollection, "violet"],
              ["Project completion", projectCompletion, "orange"],
            ].map(([label, value, tone]) => <div key={label}>
              <span>{label}</span><strong>{value}%</strong>
              <ProgressBar value={Number(value)} tone={String(tone)} />
            </div>)}
          </div>
        </div>
      </article>
    </section>

    <section className="home-bottom-grid">
      <article className="panel home-health-panel">
        <header className="home-panel-heading"><div><p className="eyebrow">Early intervention</p><h2>Student health</h2></div></header>
        <div className="home-health-content">
          <div className="home-health-score"><strong>{percentage(onTrack, attendanceStudents.length)}%</strong><span>of recorded</span></div>
          <div className="home-health-list">
            <button type="button" onClick={() => onNavigate("students", "on-track")}><i className="teal" /><span>On track</span><strong>{onTrack}</strong></button>
            <button type="button" onClick={() => onNavigate("students", "watch")}><i className="orange" /><span>Watch closely</span><strong>{watch}</strong></button>
            <button type="button" onClick={() => onNavigate("students", "support")}><i className="danger" /><span>Needs support</span><strong>{needsSupport}</strong></button>
          </div>
        </div>
      </article>

      <article className="panel home-priorities-panel">
        <header className="home-panel-heading"><div><p className="eyebrow">Action centre</p><h2>Today’s priorities</h2></div></header>
        <div className="home-priority-list">
          {[
            { label: readOnly ? "Fee records" : "Overdue fee follow-ups", detail: readOnly ? "Raw workbook status" : "Payment collection", count: readOnly ? feeRecords : overdueFees, tone: "danger", view: "fees" as ViewId, filter: readOnly ? undefined : "overdue" },
            { label: "Project reviews", detail: "Faculty review queue", count: reviewDue, tone: "violet", view: "projects" as ViewId, filter: "review" },
            { label: readOnly ? "Certificate records" : "Certificates ready", detail: readOnly ? "Raw workbook status" : "Generate and dispatch", count: certificatesReady, tone: "teal", view: "certificates" as ViewId, filter: readOnly ? undefined : "eligible" },
            { label: "HR actions pending", detail: "Placement readiness", count: hrActions, tone: "blue", view: "hr" as ViewId, filter: "pending" },
          ].map((task) => <button type="button" key={task.label} onClick={() => onNavigate(task.view, task.filter)}>
            <span className={`home-priority-dot ${task.tone}`} />
            <span><strong>{task.label}</strong><small>{task.detail}</small></span>
            <b>{task.count}</b><em aria-hidden="true">›</em>
          </button>)}
        </div>
      </article>

      <article className="panel home-students-panel">
        <header className="home-panel-heading"><div><p className="eyebrow">Student directory</p><h2>Recent students</h2></div><button className="text-button" type="button" onClick={() => onNavigate("students")}>View all <span>›</span></button></header>
        <div className="home-student-list">
          {filteredStudents.slice(0, 4).map((student) => <button type="button" key={student.id} onClick={() => onOpenStudent(student)}>
            <Avatar name={student.name} size="sm" />
            <span><strong>{student.name}</strong><small>{student.code} · {student.courseCode}</small></span>
            <Badge label={student.status} />
          </button>)}
        </div>
        <footer><span>{readOnly ? "Fee status recorded" : "Fee value in view"}</span><strong>{readOnly ? `${feeRecords} records` : money.format(totalFees)}</strong></footer>
      </article>
    </section>
  </div>;
}
