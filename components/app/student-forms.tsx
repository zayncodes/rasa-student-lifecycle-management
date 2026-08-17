"use client";

import { useState, type FormEvent } from "react";
import type { Student } from "@/types/domain";
import { Modal } from "@/components/ui/primitives";

export type CourseOption = { code: string; name: string };

export type CreateStudentInput = {
  name: string;
  email: string;
  phone: string;
  course: string;
  courseCode: string;
  joiningDate: string;
  completionDate: string;
  feeTotal: number;
  initialPayment: number;
};

export type PaymentInput = {
  amount: number;
  date: string;
  method: string;
  reference: string;
  remarks: string;
};

function localDateInput(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function defaultCompletionDate() {
  const completion = new Date();
  completion.setMonth(completion.getMonth() + 4);
  return localDateInput(completion);
}

export function AddStudentModal({ open, courses, onClose, onSubmit }: {
  open: boolean;
  courses: CourseOption[];
  onClose: () => void;
  onSubmit: (student: CreateStudentInput) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const courseCode = String(data.get("courseCode"));
    const course = courses.find((item) => item.code === courseCode);
    const feeTotal = Number(data.get("fee"));
    const initialPayment = Number(data.get("paid"));
    if (!course) {
      setError("Select an active course before saving the student.");
      setSubmitting(false);
      return;
    }
    if (initialPayment > feeTotal) {
      setError("Initial payment cannot exceed the total course fee.");
      setSubmitting(false);
      return;
    }

    try {
      await onSubmit({
        name: String(data.get("name")).trim(),
        email: String(data.get("email")).trim(),
        phone: String(data.get("phone")).trim(),
        course: course.name,
        courseCode: course.code,
        joiningDate: String(data.get("joiningDate")),
        completionDate: String(data.get("completionDate")),
        feeTotal,
        initialPayment,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create the student.");
    } finally {
      setSubmitting(false);
    }
  }

  return <Modal open={open} title="Add a new student" eyebrow="Registration" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <div className="form-section"><h3>Student information</h3><div className="form-grid"><label className="field span-2"><span>Full name</span><input name="name" required placeholder="Enter student’s full name" /></label><label className="field"><span>Email address</span><input name="email" type="email" required placeholder="student@example.com" /></label><label className="field"><span>Contact number</span><input name="phone" required placeholder="+91 98765 43210" /></label></div></div>
      <div className="form-section"><h3>Enrollment</h3><div className="form-grid"><label className="field span-2"><span>Course</span><select name="courseCode" required defaultValue=""><option value="" disabled>{courses.length ? "Select a course" : "No active courses available"}</option>{courses.map((course) => <option value={course.code} key={course.code}>{course.name} · {course.code}</option>)}</select></label><label className="field"><span>Joining date</span><input name="joiningDate" type="date" required defaultValue={localDateInput()} /></label><label className="field"><span>Tentative completion</span><input name="completionDate" type="date" required defaultValue={defaultCompletionDate()} /></label></div></div>
      <div className="form-section"><h3>Fee account</h3><div className="form-grid"><label className="field"><span>Total course fee</span><input name="fee" type="number" min="0" step="0.01" required defaultValue="0" /></label><label className="field"><span>Initial payment</span><input name="paid" type="number" min="0" step="0.01" required defaultValue="0" /></label></div></div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <footer className="modal-footer"><span>The database generates the unique student ID.</span><div><button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>Cancel</button><button className="primary-button" type="submit" disabled={submitting || !courses.length}>{submitting ? "Creating…" : "Create student"}</button></div></footer>
    </form>
  </Modal>;
}

export function PaymentModal({ student, open, onClose, onSubmit }: {
  student: Student | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (payment: PaymentInput) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!student) return null;
  const pending = Math.max(0, student.feeTotal - student.paid);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        amount: Number(data.get("amount")),
        date: String(data.get("date")),
        method: String(data.get("method")),
        reference: String(data.get("reference")).trim(),
        remarks: String(data.get("remarks")).trim(),
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to record the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return <Modal open={open} title="Record payment" eyebrow={`${student.name} · ${student.code}`} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <div className="payment-balance"><span>Outstanding balance</span><strong>₹{pending.toLocaleString("en-IN")}</strong></div>
      <div className="form-grid"><label className="field"><span>Payment amount</span><input name="amount" type="number" min="0.01" step="0.01" max={pending} required defaultValue={Math.min(pending, student.nextPaymentAmount || pending)} /></label><label className="field"><span>Payment date</span><input name="date" type="date" required defaultValue={localDateInput()} /></label><label className="field"><span>Payment method</span><select name="method"><option>UPI</option><option>Bank Transfer</option><option>Card</option><option>Cash</option><option>Cheque</option></select></label><label className="field"><span>Transaction reference</span><input name="reference" required placeholder="e.g. UPI-824119" /></label><label className="field span-2"><span>Remarks</span><textarea name="remarks" placeholder="Optional internal note" /></label></div>
      <p className="security-note">Posted payments cannot be deleted. Corrections use a reasoned void workflow and are added to the audit trail.</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <footer className="modal-footer"><span>Amounts shown in INR.</span><div><button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>Cancel</button><button className="primary-button" type="submit" disabled={submitting || pending <= 0}>{submitting ? "Posting…" : "Post payment"}</button></div></footer>
    </form>
  </Modal>;
}
