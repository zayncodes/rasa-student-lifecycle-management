import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SECURE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: SECURE_HEADERS });
}

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return error("Cross-origin requests are not allowed.", 403);

  const { runId } = await params;
  if (!UUID.test(runId)) return error("Invalid run id.", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error("Authentication is required.", 401);

  // The database function re-checks the permission and performs the whole
  // restore in one transaction, so a dropped connection cannot half-revert it.
  const { data, error: rpcError } = await supabase.rpc("rollback_graphy_sync_run", { p_run_id: runId });
  if (rpcError) {
    if (rpcError.code === "42501") return error("You do not have permission to roll back a sync run.", 403);
    if (rpcError.code === "P0002") return error("That sync run no longer exists.", 404);
    if (rpcError.code === "23505") return error("That run has already been rolled back.", 409);
    if (rpcError.code === "22023") return error("A preview run wrote nothing, so there is nothing to undo.", 400);
    return error("The rollback could not be completed. Nothing was changed.", 500);
  }

  return Response.json({ ok: true, fieldsRestored: data ?? 0 }, { headers: SECURE_HEADERS });
}
