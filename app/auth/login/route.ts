import { normalizeLoginIdentifier } from "@/lib/auth/login-identifier";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

const INVALID_LOGIN_EMAIL = "invalid-login@invalid.local";

export const dynamic = "force-dynamic";

function json(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured) return json("Staff sign-in is not configured.", 503);

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json("Sign-in request was rejected.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json("Sign-in requests must use JSON.", 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8_192) return json("Sign-in request is too large.", 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json("Enter a valid email or staff ID and password.", 400);
  }
  const input = body && typeof body === "object" ? body as { identifier?: unknown; password?: unknown } : {};
  const identifier = normalizeLoginIdentifier(input.identifier);
  const password = typeof input.password === "string" ? input.password : "";
  if (!identifier || !password || password.length > 1_024) {
    return json("Enter a valid email or staff ID and password.", 400);
  }

  let email = identifier.kind === "email" ? identifier.value : INVALID_LOGIN_EMAIL;
  if (identifier.kind === "login-id") {
    const admin = createAdminClient();
    if (!admin) return json("Staff ID sign-in is unavailable. Use your work email or contact an administrator.", 503);
    const { data, error } = await admin
      .from("profiles")
      .select("email")
      .ilike("login_id", identifier.value)
      .eq("is_active", true)
      .maybeSingle();
    if (!error && data?.email) email = String(data.email).trim().toLowerCase();
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) return json("Email/staff ID or password is incorrect.", 401);

  const { data: isAdministrator, error: accessError } = await supabase.rpc("is_launch_administrator");
  if (accessError) {
    await supabase.auth.signOut();
    return json("Staff access is not ready. Contact an administrator.", 503);
  }
  if (!isAdministrator) {
    await supabase.auth.signOut();
    return json("This account is not enabled for the administrator-only launch.", 403);
  }

  return Response.json({ ok: true }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
