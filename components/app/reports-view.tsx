"use client";

import { useMemo, useState } from "react";
import type { Student } from "@/types/domain";
import { ProgressBar } from "@/components/ui/primitives";

export function ReportsView({ students, onExport, canExport = false, readOnly = false }: { students: Student[]; onExport: (students: Student[]) => void; canExport?: boolean; readOnly?: boolean }) {
  const [year, setYear] = useState("All years");
  const years = Array.from(new Set(students.map((student) => student.sourceYear).filter((value): value is number => Boolean(value)))).sort((a, b) => b - a);
  const rows = useMemo(() => year === "All years" ? students : year === "Archive" ? students.filter((student) => student.recordCategory === "archive") : students.filter((student) => String(student.sourceYear) === year), [students, year]);
  const archived = rows.filter((student) => student.recordCategory === "archive").length;
  const completed = rows.filter((student) => student.status === "Completed").length;
  const attendanceRows = rows.filter((student) => student.attendanceRecorded !== false && (student.rawAttendance || student.attendanceSource === "system" || student.attendance > 0));
  const attendance = attendanceRows.length ? Math.round(attendanceRows.reduce((sum, student) => sum + student.attendance, 0) / attendanceRows.length) : 0;
  const projects = rows.filter((student) => student.project !== "Not recorded").length;
  const certificates = rows.filter((student) => readOnly ? Boolean(student.original?.certificateStatus) : student.certificateStatus !== "Not Eligible").length;
  const yearData = years.map((item) => ({ year: item, count: students.filter((student) => student.sourceYear === item).length }));
  return <div className="view-stack">
    <section className="page-heading-row"><div><p className="eyebrow">Operational intelligence</p><h1>Reports</h1><p>{readOnly ? "Read-only reports from the privately extracted client workbook." : "Live reports derived from authenticated student records."}</p></div><div className="welcome-actions"><label className="select-wrap"><span className="sr-only">Report year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option>All years</option>{years.map((item) => <option key={item}>{item}</option>)}{students.some((student) => student.recordCategory === "archive") ? <option>Archive</option> : null}</select></label>{canExport ? <button className="secondary-button" type="button" onClick={() => onExport(rows)} disabled={!rows.length}>⇩ Download {rows.length}</button> : null}</div></section>
    <section className="summary-card-grid"><article className="summary-card"><span>Student records</span><strong>{rows.length}</strong><small>{year}{archived ? ` · ${archived} archived` : ""}</small></article><article className="summary-card"><span>Completed</span><strong>{completed}</strong><small>{rows.length ? Math.round((completed / rows.length) * 100) : 0}% of selected records</small></article><article className="summary-card"><span>Attendance captured</span><strong>{attendanceRows.length}</strong><small>{attendance}% average where recorded</small></article><article className="summary-card"><span>{readOnly ? "Certificate status recorded" : "Certificate actions"}</span><strong>{certificates}</strong><small>{projects} project records</small></article></section>
    <section className="home-insight-grid"><article className="panel"><header className="panel-header"><div><p className="eyebrow">Cohort history</p><h2>Students by source year</h2></div></header><div className="report-bars">{yearData.map((item) => <button type="button" key={item.year} onClick={() => setYear(String(item.year))}><span>{item.year}</span><ProgressBar value={students.length ? (item.count / Math.max(...yearData.map((entry) => entry.count))) * 100 : 0} /><strong>{item.count}</strong></button>)}</div></article><article className="panel"><header className="panel-header"><div><p className="eyebrow">Data readiness</p><h2>Workbook quality</h2></div></header><div className="report-quality"><div><span>Email recorded</span><strong>{rows.filter((student) => student.email).length}</strong></div><div><span>Phone recorded</span><strong>{rows.filter((student) => student.phone).length}</strong></div><div><span>Joining date parsed</span><strong>{rows.filter((student) => student.joiningDate).length}</strong></div><div><span>Attendance recorded</span><strong>{attendanceRows.length}</strong></div></div></article></section>
  </div>;
}
