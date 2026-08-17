"use client";

import { useMemo, useState } from "react";
import type { Student } from "@/types/domain";
import { Avatar, Badge, EmptyState, ProgressBar } from "@/components/ui/primitives";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type StudentsViewProps = {
  students: Student[];
  initialFilter?: string;
  globalSearch: string;
  onOpenStudent: (student: Student) => void;
  onAddStudent: () => void;
  onExport: (students: Student[]) => void;
  readOnly?: boolean;
  canExport?: boolean;
  canAddStudent?: boolean;
};

export function StudentsView({ students, initialFilter, globalSearch, onOpenStudent, onAddStudent, onExport, readOnly = false, canExport = false, canAddStudent = false }: StudentsViewProps) {
  const [status, setStatus] = useState(initialFilter === "active" ? "Active" : "All statuses");
  const [course, setCourse] = useState("All courses");
  const [trainer, setTrainer] = useState("All trainers");
  const [year, setYear] = useState("All years");
  const [health, setHealth] = useState(initialFilter === "on-track" ? "On track" : initialFilter === "watch" ? "Watch closely" : initialFilter === "support" ? "Needs support" : "All health");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const filtered = useMemo(() => {
    const search = (query || globalSearch).trim().toLowerCase();
    return students.filter((student) => {
      const haystack = `${student.name} ${student.code} ${student.email} ${student.phone}`.toLowerCase();
      return (!search || haystack.includes(search))
        && (status === "All statuses" || student.status === status)
        && (course === "All courses" || student.course === course)
        && (trainer === "All trainers" || student.trainer === trainer)
        && (year === "All years" || String(student.sourceYear ?? student.registrationDate?.slice(0, 4) ?? "") === year)
        && (health === "All health" || (student.attendanceRecorded !== false && ((health === "On track" && student.attendance >= 80 && student.status !== "On Hold") || (health === "Watch closely" && student.attendance >= 75 && student.attendance < 80 && student.status !== "On Hold") || (health === "Needs support" && (student.attendance < 75 || student.status === "On Hold")))));
    });
  }, [course, globalSearch, health, query, status, students, trainer, year]);

  const courses = Array.from(new Set(students.map((student) => student.course)));
  const trainers = Array.from(new Set(students.map((student) => student.trainer)));
  const years = Array.from(new Set(students.map((student) => student.sourceYear ?? Number(student.registrationDate?.slice(0, 4))).filter(Boolean))).sort((a, b) => b - a);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const exportRows = selected.size ? filtered.filter((student) => selected.has(student.id)) : filtered;

  function toggleSelected(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = visible.every((student) => next.has(student.id));
      visible.forEach((student) => allSelected ? next.delete(student.id) : next.add(student.id));
      return next;
    });
  }

  return (
    <div className="view-stack">
      <section className="page-heading-row">
        <div>
          <p className="eyebrow">Student directory</p>
          <h1>Students</h1>
          <p>Search, filter and manage every student from registration to placement.</p>
        </div>
        <div className="welcome-actions">
          {canExport ? <button className="secondary-button" type="button" onClick={() => onExport(exportRows)} disabled={!exportRows.length}><span>⇩</span> Export {exportRows.length}</button> : null}
          {canAddStudent && !readOnly ? <button className="primary-button" type="button" onClick={onAddStudent}><span>＋</span> Add student</button> : null}
        </div>
      </section>

      <section className="panel filter-panel">
        <div className="search-field wide-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, student ID, email or phone…" aria-label="Search students" />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button> : null}
        </div>
        <label className="select-wrap">
          <span className="sr-only">Filter by year</span>
          <select value={year} onChange={(event) => { setYear(event.target.value); setPage(1); }}>
            <option>All years</option>
            {years.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="select-wrap">
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>All statuses</option>
            <option>Registered</option><option>Active</option><option>On Hold</option><option>Extended</option><option>Completed</option><option>Archived</option>
          </select>
        </label>
        <label className="select-wrap">
          <span className="sr-only">Filter by course</span>
          <select value={course} onChange={(event) => setCourse(event.target.value)}>
            <option>All courses</option>
            {courses.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="select-wrap">
          <span className="sr-only">Filter by trainer</span>
          <select value={trainer} onChange={(event) => setTrainer(event.target.value)}>
            <option>All trainers</option>
            {trainers.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="select-wrap"><span className="sr-only">Filter by student health</span><select value={health} onChange={(event) => { setHealth(event.target.value); setPage(1); }}><option>All health</option><option>On track</option><option>Watch closely</option><option>Needs support</option></select></label>
        <button className="filter-count" type="button" onClick={() => { setStatus("All statuses"); setCourse("All courses"); setTrainer("All trainers"); setYear("All years"); setHealth("All health"); setQuery(""); setPage(1); setSelected(new Set()); }}>
          {filtered.length} records <span>Reset</span>
        </button>
      </section>

      <section className="panel students-table-panel">
        {filtered.length ? (
          <div className="table-scroll">
            <table className="data-table full-table">
              <thead>
                <tr>
                  {canExport ? <th><input type="checkbox" aria-label="Select all visible students" checked={visible.length > 0 && visible.every((student) => selected.has(student.id))} onChange={toggleVisible} /></th> : null}
                  <th>Student</th><th>Course</th><th>Status</th><th>Attendance</th><th>Fees</th><th>Project</th><th>Trainer</th><th />
                </tr>
              </thead>
              <tbody>
                {visible.map((student) => {
                  const pending = student.feeTotal - student.paid;
                  return (
                    <tr key={student.id} onClick={() => onOpenStudent(student)}>
                      {canExport ? <td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(student.id)} onChange={() => toggleSelected(student.id)} aria-label={`Select ${student.name}`} /></td> : null}
                      <td><div className="student-cell"><Avatar name={student.name} /><div><strong>{student.name}</strong><span>{student.code}</span></div></div></td>
                      <td><strong className="cell-primary">{student.course}</strong><span className="cell-secondary">{student.courseCode}</span></td>
                      <td><Badge label={student.status} /></td>
                      <td>
                        <div className="attendance-cell"><strong>{student.attendanceRecorded === false ? (student.rawAttendance || "Not recorded") : `${student.attendance}%`}</strong>{student.attendanceRecorded === false ? null : <ProgressBar value={student.attendance} tone={student.attendance < 75 ? "orange" : "teal"} />}<small>{student.attendanceSource === "imported" ? "Imported" : "Calculated"}</small></div>
                      </td>
                      <td>
                        {readOnly || student.feeQuantified === false ? <><strong>{student.feesStatus || "Not quantified"}</strong><span className="cell-secondary">No quantified fee account</span></> : <><strong className={pending > 0 ? "money-pending" : "money-paid"}>{pending > 0 ? `${money.format(pending)} due` : "Paid"}</strong><span className="cell-secondary">{student.feeTotal ? Math.round((student.paid / student.feeTotal) * 100) : 0}% collected</span></>}
                      </td>
                      <td><Badge label={student.project === "Not recorded" || student.project === "Not assigned" ? "Not recorded" : student.projectStatus} /></td>
                      <td>{student.trainer}</td>
                      <td><button type="button" className="row-action" aria-label={`Open ${student.name}`} onClick={(event) => { event.stopPropagation(); onOpenStudent(student); }}>›</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No matching students" description="Adjust your search or filters to see more records." />}
        <footer className="table-footer">
          <span>Showing <strong>{visible.length}</strong> of {filtered.length} matching · {students.length} total</span>
          <div className="pagination"><button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>‹</button><span className="active" aria-label={`Page ${safePage} of ${pageCount}`}>{safePage} / {pageCount}</span><button type="button" onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage === pageCount}>›</button></div>
        </footer>
      </section>
    </div>
  );
}
