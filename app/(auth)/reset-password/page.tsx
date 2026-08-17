"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const password = String(data.get("password")); const confirm = String(data.get("confirm")); if (password !== confirm) { setMessage("Passwords do not match."); return; } if (password.length < 10) { setMessage("Use at least 10 characters."); return; } if (!isSupabaseConfigured) { setMessage("Connect Supabase to enable password updates."); return; } const { error } = await createClient().auth.updateUser({ password }); if (error) setMessage(error.message); else { router.replace("/"); router.refresh(); } }
  return <main className="auth-simple-page"><section className="auth-card"><p className="eyebrow">Secure account recovery</p><h2>Choose a new password</h2><p>Use a strong, unique password for your RASA staff account.</p><form className="auth-form" onSubmit={submit}><label className="field"><span>New password</span><input name="password" type="password" autoComplete="new-password" required /></label><label className="field"><span>Confirm password</span><input name="confirm" type="password" autoComplete="new-password" required /></label>{message ? <p className="auth-error" role="alert">{message}</p> : null}<button className="primary-button auth-submit" type="submit">Update password</button></form></section></main>;
}
