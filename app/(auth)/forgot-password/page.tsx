"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const email = String(new FormData(event.currentTarget).get("email")); if (!isSupabaseConfigured) { setMessage("Connect Supabase to enable password reset emails."); return; } const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` }); setMessage(error ? error.message : "Check your email for the secure reset link."); }
  return <main className="auth-simple-page"><section className="auth-card"><p className="eyebrow">Account recovery</p><h2>Reset your password</h2><p>Enter your work email and we’ll send a secure reset link.</p><form className="auth-form" onSubmit={submit}><label className="field"><span>Work email</span><input name="email" type="email" required /></label>{message ? <p className="auth-message-inline" role="status">{message}</p> : null}<button className="primary-button auth-submit" type="submit">Send reset link</button><a className="auth-back" href="/login">← Back to sign in</a></form></section></main>;
}

