import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in · RASA SLMS" };

export default function LoginPage() {
  return <main className="auth-page"><section className="auth-brand-panel"><div className="auth-brand"><div className="brand-mark"><span>R</span><i /></div><div><strong>RASA</strong><small>Student lifecycle management</small></div></div><div className="auth-message"><p className="eyebrow">One student · one complete profile</p><h1>Training operations,<br />finally in one place.</h1><p>Manage registrations, fees, projects, certificates and placement without parallel spreadsheets.</p></div><div className="auth-proof"><span>Protected by row-level security</span><span>Asia/Kolkata · INR</span></div></section><section className="auth-form-panel"><div className="auth-card"><p className="eyebrow">Internal staff access</p><h2>Welcome back</h2><p>Sign in with the account provided by your RASA administrator.</p><LoginForm /><small className="auth-help">No public registration. Need access? Contact your Super Admin.</small></div></section></main>;
}

