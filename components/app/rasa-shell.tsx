"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Activity, Student, StudentEditorOptions, ViewId, WorkspaceMode } from "@/types/domain";
import type { GraphySyncRun } from "@/types/graphy";
import { Avatar } from "@/components/ui/primitives";
import { DashboardView } from "./dashboard-view";
import { HomeDashboard } from "./home-dashboard";
import { ReportsView } from "./reports-view";
import { GraphySyncView } from "./graphy-sync-view";
import { StudentsView } from "./students-view";
import { OperationsView } from "./operations-view";
import { StudentProfile } from "./student-profile";
import { StudentEditModal } from "./student-edit-form";
import { AddStudentModal, PaymentModal, type CreateStudentInput, type PaymentInput } from "./student-forms";
import type { StudentLifecycleUpdate } from "@/types/student-editor";

const NAV_ITEMS: { id: ViewId; label: string; icon: string; group?: string; count?: number }[] = [
  { id: "dashboard", label: "Command center", icon: "⌂" },
  { id: "students", label: "Students", icon: "◎" },
  { id: "courses", label: "Courses", icon: "▤" },
  { id: "fees", label: "Fees & payments", icon: "₹", group: "Operations" },
  { id: "projects", label: "Projects", icon: "◇" },
  { id: "certificates", label: "Certificates", icon: "✓" },
  { id: "hr", label: "HR & placement", icon: "♧" },
  { id: "reports", label: "Reports", icon: "▥", group: "Workspace" },
  { id: "imports", label: "Graphy sync", icon: "⇄" },
];

const TITLES: Record<ViewId, string> = {
  home: "Home dashboard",
  dashboard: "Command center",
  students: "Students",
  courses: "Courses",
  fees: "Fees & payments",
  projects: "Projects & reviews",
  certificates: "Certificates",
  hr: "HR & placement",
  reports: "Reports",
  imports: "Import centre",
  notifications: "Notifications",
  settings: "Settings",
};

const activityDate = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

function initialActivities(students: Student[]): Activity[] {
  return students.flatMap((student) => (student.timelineEvents ?? []).map((event, index) => {
    const sortTime = Date.parse(event.when);
    return { sortTime: Number.isNaN(sortTime) ? 0 : sortTime, activity: {
      id: `${student.id}-${index}-${event.when}`,
      studentId: student.id,
      studentName: student.name,
      studentCode: student.code,
      action: event.action,
      detail: event.detail,
      timestamp: Number.isNaN(sortTime) ? event.when : activityDate.format(new Date(event.when)),
      tone: (event.action.toLowerCase().includes("payment") ? "teal" : event.action.toLowerCase().includes("certificate") ? "violet" : event.action.toLowerCase().includes("project") ? "orange" : "blue") as Activity["tone"],
    } };
  })).sort((left, right) => right.sortTime - left.sortTime).slice(0, 6).map((item) => item.activity);
}

export function RasaShell({
  initialStudents,
  currentUserName,
  workspaceMode = "production",
  readOnly = false,
  canExport = false,
  canCreateStudent = false,
  canEditStudent = false,
  canManageFees = false,
  editorOptions = { courses: [], owners: [] },
  graphyRuns = [],
}: {
  initialStudents: Student[];
  currentUserName: string;
  workspaceMode?: WorkspaceMode;
  readOnly?: boolean;
  canExport?: boolean;
  canCreateStudent?: boolean;
  canEditStudent?: boolean;
  canManageFees?: boolean;
  editorOptions?: StudentEditorOptions;
  graphyRuns?: GraphySyncRun[];
}) {
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [activities, setActivities] = useState<Activity[]>(() => initialActivities(initialStudents));
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [activeFilter, setActiveFilter] = useState<string>();
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [paymentStudent, setPaymentStudent] = useState<Student | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const notificationAreaRef = useRef<HTMLDivElement>(null);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSidebarCollapsed(window.localStorage.getItem("rasa-sidebar-collapsed") === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (notificationsOpen && !notificationAreaRef.current?.contains(target)) setNotificationsOpen(false);
      if (searchOpen && !searchAreaRef.current?.contains(target)) setSearchOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setSearchOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen, searchOpen]);

  const searchMatches = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    if (!query) return [];
    return students.filter((student) => `${student.name} ${student.code} ${student.email} ${student.phone}`.toLowerCase().includes(query)).slice(0, 5);
  }, [globalSearch, students]);

  const courseOptions = useMemo(() => {
    const configured = editorOptions.courses.filter((course) => course.active).map(({ code, name }) => ({ code, name }));
    if (configured.length) return configured;
    return Array.from(
      new Map(students.filter((student) => student.recordCategory !== "archive" && student.course && student.courseCode).map((student) => [student.courseCode, { code: student.courseCode, name: student.course }])).values(),
    ).sort((left, right) => left.name.localeCompare(right.name));
  }, [editorOptions.courses, students]);
  const operationalStudents = useMemo(() => students.filter((student) => student.recordCategory !== "archive"), [students]);

  function navigate(view: ViewId, filter?: string) {
    setActiveView(view);
    setActiveFilter(filter);
    setMobileNavOpen(false);
    setNotificationsOpen(false);
    setSearchOpen(false);
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("rasa-sidebar-collapsed", String(next));
      return next;
    });
  }

  function openStudent(student: Student) {
    setSelectedStudent(student);
    setProfileOpen(true);
    setGlobalSearch("");
    setSearchOpen(false);
  }

  function openStudentEditor(student: Student) {
    if (readOnly || !canEditStudent) return;
    setEditStudent(student);
    setProfileOpen(false);
    setEditOpen(true);
  }

  function closeStudentEditor() {
    setEditOpen(false);
    setProfileOpen(Boolean(editStudent));
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function addStudent(input: CreateStudentInput) {
    const { data, error } = await createClient().rpc("create_student_record", {
      p_full_name: input.name,
      p_email: input.email,
      p_contact_number: input.phone,
      p_course_code: input.courseCode,
      p_joining_date: input.joiningDate,
      p_tentative_completion_date: input.completionDate,
      p_total_course_fee: input.feeTotal,
      p_initial_payment: input.initialPayment,
    });
    if (error) throw new Error(error.message);
    const persisted = data?.[0] as { created_student_id?: string; created_student_code?: string; created_registration_date?: string } | undefined;
    if (!persisted?.created_student_id || !persisted.created_student_code || !persisted.created_registration_date) throw new Error("The database did not return the created student record.");
    const sourceYear = Number(persisted.created_registration_date.slice(0, 4));
    const student: Student = {
      id: persisted.created_student_id,
      code: persisted.created_student_code,
      name: input.name,
      email: input.email,
      phone: input.phone,
      course: input.course,
      courseCode: input.courseCode,
      status: "Registered",
      trainer: "Unassigned",
      owner: "Unassigned",
      joiningDate: input.joiningDate,
      completionDate: input.completionDate,
      feeTotal: input.feeTotal,
      paid: input.initialPayment,
      nextPaymentDate: null,
      nextPaymentAmount: 0,
      attendance: 0,
      attendanceSource: "system",
      project: "Not recorded",
      projectStatus: "Assigned",
      projectDeadline: null,
      certificateStatus: "Not Eligible",
      experienceLetterStatus: "Not Eligible",
      hrPending: 4,
      platformStatus: "Not Created",
      grade: null,
      notes: "Created from the RASA operations workspace.",
      sourceYear,
      sourceSheet: "Application entry",
      sourceRow: 0,
      registrationDate: persisted.created_registration_date,
      feesStatus: input.feeTotal ? `${Math.round((input.initialPayment / input.feeTotal) * 100)}% paid` : "No fee",
      hrSessions: [],
      timelineEvents: [
        { when: new Date().toISOString(), action: "Student registered", detail: input.course },
        ...(input.initialPayment > 0 ? [{ when: new Date().toISOString(), action: "Initial payment recorded", detail: `₹${input.initialPayment.toLocaleString("en-IN")}` }] : []),
      ],
      original: {},
    };
    setStudents((current) => [student, ...current]);
    setActivities((current) => [{
      id: `a-${Date.now()}`,
      studentId: student.id,
      studentName: student.name,
      studentCode: student.code,
      action: "Student registered",
      detail: `${student.course} · Saved to the production database`,
      timestamp: "just now",
      tone: "teal" as const,
    }, ...current].slice(0, 6));
    notify(`${student.name} was added successfully.`);
    navigate("students");
  }

  async function recordPayment(payment: PaymentInput) {
    if (!paymentStudent) throw new Error("Select a student before recording a payment.");
    const { error } = await createClient().rpc("record_student_payment", {
      p_student_id: paymentStudent.id,
      p_payment_date: payment.date,
      p_amount: payment.amount,
      p_payment_method: payment.method,
      p_transaction_reference: payment.reference,
      p_remarks: payment.remarks,
    });
    if (error) throw new Error(error.message);
    const updated = {
      ...paymentStudent,
      paid: Math.min(paymentStudent.feeTotal, paymentStudent.paid + payment.amount),
      timelineEvents: [{ when: new Date().toISOString(), action: "Payment recorded", detail: `${payment.method} · ₹${payment.amount.toLocaleString("en-IN")} paid on ${payment.date}` }, ...(paymentStudent.timelineEvents ?? [])],
    };
    setStudents((current) => current.map((student) => student.id === updated.id ? updated : student));
    setSelectedStudent((current) => current?.id === updated.id ? updated : current);
    setActivities((current) => [{
      id: `a-${Date.now()}`,
      studentId: updated.id,
      studentName: updated.name,
      studentCode: updated.code,
      action: "Payment recorded",
      detail: `₹${payment.amount.toLocaleString("en-IN")} via ${payment.method} · ${payment.reference}`,
      timestamp: "just now",
      tone: "teal" as const,
    }, ...current].slice(0, 6));
    notify(`Payment of ₹${payment.amount.toLocaleString("en-IN")} posted.`);
  }

  async function updateStudentLifecycle(update: StudentLifecycleUpdate) {
    if (!editStudent) throw new Error("Select a student before editing the lifecycle record.");
    const response = await fetch("/api/students/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: editStudent.id, ...update }),
    });
    const payload = await response.json().catch(() => null) as { student?: Student; error?: string } | null;
    if (!response.ok || !payload?.student) {
      throw new Error(payload?.error || "The student lifecycle could not be saved.");
    }

    const updated = payload.student;
    setStudents((current) => current.map((student) => student.id === updated.id ? updated : student));
    setSelectedStudent(updated);
    setEditStudent(updated);
    setActivities((current) => [{
      id: `a-${Date.now()}`,
      studentId: updated.id,
      studentName: updated.name,
      studentCode: updated.code,
      action: "Student lifecycle updated",
      detail: update.editReason,
      timestamp: "just now",
      tone: "blue" as const,
    }, ...current].slice(0, 6));
    notify(`${updated.name}'s lifecycle record was updated.`);
  }

  function exportLocalStudents(rows: Student[]) {
    const headers = ["Student ID", "Source year", "Source sheet", "Source row", "Name", "Registration date", "Joining date", "Tentative completion", "Email", "Phone", "Course", "Course code", "Lifecycle status (derived)", "Lifecycle status / note (raw)", "Owner", "Trainer", "Certificates / modules", "Time requirement", "Custom syllabus", "Fee status (raw)", "Next payment (raw)", "Total fee", "Paid", "Pending", "Attendance", "Attendance (raw)", "LMS status", "Study material", "Comment", "Trainer feedback", "Project", "Project status", "Review details", "Extension", "Grade", "Certificate status", "Certificate dispatched", "Experience-letter eligibility", "HR feedback", "HR session 1", "HR session 2", "HR session 3", "HR session 4", "Video feedback", "Google review"];
    const safe = (value: unknown) => { const raw = value == null ? "" : String(value); const neutralized = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw; return `"${neutralized.replaceAll('"', '""')}"`; };
    const csvRows = rows.map((student) => [student.code, student.sourceYear, student.sourceSheet, student.sourceRow, student.name, student.registrationDate, student.joiningDate, student.completionDate, student.email, student.phone, student.course, student.courseCode, student.status, student.original?.status ?? "", student.owner, student.trainer, student.certificates, student.timeRequirement, student.syllabusCustomized, student.feesStatus, student.nextPayment, undefined, undefined, undefined, student.attendanceRecorded ? student.attendance : undefined, student.rawAttendance, student.platformStatus, student.original?.studyMaterial, student.original?.comment ?? student.notes, student.trainerFeedback, student.project, student.projectStatus, student.reviewDetails, student.extension, student.grade, student.original?.certificateStatus ?? "", student.certificateDispatchedDate, student.experienceLetterEligibility, student.hrFeedback, ...(student.hrSessions ?? []), student.videoFeedback, student.googleReview].map(safe).join(","));
    const blob = new Blob([`\uFEFF${[headers.join(","), ...csvRows].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rasa-students-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notify(`${rows.length} student records exported.`);
  }

  async function exportStudents(rows: Student[]) {
    if (!canExport) {
      notify("You do not have permission to export student records.");
      return;
    }
    if (!rows.length) {
      notify("There are no student records to export.");
      return;
    }
    if (workspaceMode === "local-read-only") {
      exportLocalStudents(rows);
      return;
    }

    try {
      const response = await fetch("/api/students/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: rows.map((student) => student.id) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "The export could not be prepared.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rasa-students-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      notify(`${rows.length} student records exported and recorded in the audit log.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The export could not be prepared.");
    }
  }

  return <div className={`app-shell ${sidebarCollapsed && !mobileNavOpen ? "sidebar-is-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <div className="brand-block">
        <button type="button" className="brand-home" onClick={() => navigate("home")} aria-label="Go to home dashboard" title="Go to home dashboard">
          <div className="brand-mark"><span>R</span><i /></div>
          <div className="brand-copy"><strong>RASA</strong><small>Student lifecycle</small></div>
        </button>
        <button type="button" className="mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">×</button>
      </div>
      <nav className="main-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => <div key={item.id}>
          {item.group ? <p className="nav-group">{item.group}</p> : null}
          <button className={activeView === item.id ? "active" : ""} type="button" onClick={() => navigate(item.id)} aria-label={item.label} title={sidebarCollapsed ? item.label : undefined}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.count ? <em>{item.count}</em> : null}
          </button>
        </div>)}
      </nav>
      <a className="sidebar-support" href="/operations-guide.html" target="_blank" rel="noreferrer" aria-label="Open operations guide" title={sidebarCollapsed ? "Open operations guide" : undefined}>
        <div className="support-mark">?</div>
        <div className="support-copy"><strong>Need help?</strong><span>Open operations guide</span></div>
        <span className="support-arrow">›</span>
      </a>
      <div className="sidebar-user">
        <Avatar name={currentUserName} />
        <div className="user-copy"><strong>{currentUserName}</strong><span>{workspaceMode === "local-read-only" ? "Private local review" : "Authenticated staff"}</span></div>
        {workspaceMode === "production" ? <form action="/auth/signout" method="post"><button type="submit" aria-label="Sign out" title="Sign out">↪</button></form> : null}
      </div>
    </aside>
    {mobileNavOpen ? <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}

    <main className="workspace">
      <header className="topbar">
        <div className="topbar-title">
          <button className="menu-button" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">☰</button>
          <button className="sidebar-collapse-button" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
            <span className="sidebar-panel-icon" aria-hidden="true"><i /></span>
          </button>
          <button className="breadcrumb breadcrumb-home" type="button" onClick={() => navigate("home")}>RASA SLMS</button>
          <span className="breadcrumb-separator">/</span>
          <strong>{TITLES[activeView]}</strong>
          <span className="env-badge">{workspaceMode === "local-read-only" ? "Local read-only" : "Current workspace"}</span>
        </div>
        <div className="topbar-tools">
          <div className="global-search" ref={searchAreaRef}>
            <span aria-hidden="true">⌕</span>
            <input ref={searchInputRef} value={globalSearch} onChange={(event) => { setGlobalSearch(event.target.value); setSearchOpen(true); }} onFocus={() => { setNotificationsOpen(false); setSearchOpen(true); }} placeholder="Find any student…" aria-label="Find any student" />
            <kbd>⌘ K</kbd>
            {globalSearch && searchOpen ? <div className="search-results">{searchMatches.length ? searchMatches.map((student) => <button type="button" key={student.id} onClick={() => openStudent(student)}><Avatar name={student.name} size="sm" /><span><strong>{student.name}</strong><small>{student.code} · {student.courseCode}</small></span><em>›</em></button>) : <p>No students found</p>}</div> : null}
          </div>
          <div className="notification-area" ref={notificationAreaRef}>
            <button className={`notification-button ${notificationsOpen ? "active" : ""}`} type="button" aria-label="View notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}>○</button>
            {notificationsOpen ? <div className="notification-popover">
              <header><div><p className="eyebrow">Live workspace</p><h3>Notifications</h3></div></header>
              <div className="empty-state compact-activity-empty"><h3>No live notifications</h3><p>{readOnly ? "The local workbook source does not contain application notifications." : "Only authenticated database notifications will appear here."}</p></div>
            </div> : null}
          </div>
          <span className="top-avatar" aria-label={`Signed in as ${currentUserName}`} title={currentUserName}><Avatar name={currentUserName} /></span>
        </div>
      </header>

      <div className="content-area">
        {activeView === "home" ? <HomeDashboard students={operationalStudents} onNavigate={navigate} onOpenStudent={openStudent} readOnly={readOnly} /> : null}
        {activeView === "dashboard" ? <DashboardView students={operationalStudents} activities={activities} onNavigate={navigate} onOpenStudent={openStudent} onAddStudent={() => setAddOpen(true)} onExport={exportStudents} currentUserName={currentUserName} readOnly={readOnly} canExport={canExport} canAddStudent={canCreateStudent && !readOnly} /> : null}
        {activeView === "students" ? <StudentsView students={students} initialFilter={activeFilter} globalSearch={globalSearch} onOpenStudent={openStudent} onAddStudent={() => setAddOpen(true)} onExport={exportStudents} readOnly={readOnly} canExport={canExport} canAddStudent={canCreateStudent && !readOnly} /> : null}
        {activeView === "imports" ? <GraphySyncView runs={graphyRuns} /> : null}
        {activeView === "reports" ? <ReportsView students={students} onExport={exportStudents} canExport={canExport} readOnly={readOnly} /> : null}
        {activeView !== "home" && activeView !== "dashboard" && activeView !== "students" && activeView !== "reports" && activeView !== "imports" ? <OperationsView view={activeView} students={operationalStudents} filter={activeFilter} onOpenStudent={openStudent} readOnly={readOnly} /> : null}
      </div>
    </main>

    <StudentProfile student={selectedStudent} open={profileOpen} onClose={() => setProfileOpen(false)} onEdit={openStudentEditor} onRecordPayment={(student) => { setPaymentStudent(student); setPaymentOpen(true); }} readOnly={readOnly} canEdit={canEditStudent && !readOnly} canRecordPayment={canManageFees && !readOnly} />
    {canCreateStudent && !readOnly ? <AddStudentModal open={addOpen} courses={courseOptions} onClose={() => setAddOpen(false)} onSubmit={addStudent} /> : null}
    {canManageFees && !readOnly ? <PaymentModal student={paymentStudent} open={paymentOpen} onClose={() => setPaymentOpen(false)} onSubmit={recordPayment} /> : null}
    {canEditStudent && !readOnly ? <StudentEditModal student={editStudent} options={editorOptions} open={editOpen} onClose={closeStudentEditor} onSubmit={updateStudentLifecycle} /> : null}
    {toast ? <div className="toast" role="status"><span>✓</span>{toast}</div> : null}
  </div>;
}
