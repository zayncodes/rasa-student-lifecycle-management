"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    if (!isSupabaseConfigured) { setError("Connect a Supabase project to enable staff sign-in."); return; }
    setLoading(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: data.get("identifier"), password: data.get("password") }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) { setError(result?.error || "Sign-in was not successful."); return; }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return <form className="auth-form" onSubmit={submit}>
    <label className="field"><span>Work email or staff ID</span><input name="identifier" type="text" autoComplete="username" required maxLength={254} spellCheck={false} autoCapitalize="none" placeholder="name@rasalsi.com or RASA-ADMIN-001" /></label>
    <label className="field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" /></label>
    <div className="auth-form-row"><span>Secure staff session</span><a href="/forgot-password">Forgot password?</a></div>
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    <button className="primary-button auth-submit" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in securely"}</button>
  </form>;
}
