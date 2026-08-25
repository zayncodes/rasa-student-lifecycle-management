import { getGraphySyncChanges } from "@/lib/graphy-server";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SECURE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: SECURE_HEADERS });
}

async function authorize() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: error("Authentication is required.", 401) };
  const { data, error: permissionError } = await supabase.rpc("has_permission", { required_permission: "imports.manage" });
  if (permissionError) return { error: error("Unable to verify your import permission.", 500) };
  if (data !== true) return { error: error("You do not have permission to manage sync history.", 403) };
  return { supabase };
}

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!UUID.test(runId)) return error("Invalid run id.", 400);
  const auth = await authorize();
  if (auth.error) return auth.error;

  try {
    const changes = await getGraphySyncChanges(runId);
    return Response.json({ changes }, { headers: SECURE_HEADERS });
  } catch {
    return error("The sync detail could not be loaded.", 500);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!UUID.test(runId)) return error("Invalid run id.", 400);
  const auth = await authorize();
  if (auth.error) return auth.error;
  const supabase = auth.supabase!;

  const { data: run, error: readError } = await supabase
    .from("graphy_sync_runs").select("mode, status, filename").eq("id", runId).maybeSingle();
  if (readError) return error("The sync run could not be read.", 500);
  if (!run) return error("That sync run no longer exists.", 404);

  // Deleting an applied run would destroy the only record of its previous
  // values, making it permanently irreversible. Roll it back first.
  if (run.mode === "applied" && run.status !== "RolledBack") {
    return error("This run is still applied. Roll it back first, then delete its record.", 409);
  }

  const { error: deleteError } = await supabase.from("graphy_sync_runs").delete().eq("id", runId);
  if (deleteError) return error("The sync record could not be deleted.", 500);

  return Response.json({ ok: true }, { headers: SECURE_HEADERS });
}
