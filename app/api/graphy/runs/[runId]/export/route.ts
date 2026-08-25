import { getGraphySyncChanges } from "@/lib/graphy-server";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CSV_HEADERS = [
  "Row", "Student code", "Student name", "Matched on", "Record", "Field",
  "Previous value", "New value", "Action", "Applied", "Rolled back",
];

function error(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Matches the student export: a leading formula character is neutralised. */
function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const neutralized = /^(?:[\t\r\n]|\s*[=+\-@])/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!UUID.test(runId)) return error("Invalid run id.", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error("Authentication is required.", 401);
  const { data: allowed, error: permissionError } = await supabase.rpc("has_permission", { required_permission: "imports.manage" });
  if (permissionError) return error("Unable to verify your import permission.", 500);
  if (allowed !== true) return error("You do not have permission to export sync history.", 403);

  const { data: run } = await supabase.from("graphy_sync_runs").select("filename, started_at").eq("id", runId).maybeSingle();
  if (!run) return error("That sync run no longer exists.", 404);

  let changes;
  try {
    changes = await getGraphySyncChanges(runId);
  } catch {
    return error("The sync detail could not be loaded.", 500);
  }

  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const change of changes) {
    lines.push([
      change.rowNumber, change.studentCode, change.studentName, change.matchKey, change.entity, change.column,
      change.oldValue, change.newValue, change.action, change.applied ? "Yes" : "No", change.reverted ? "Yes" : "No",
    ].map(csvCell).join(","));
  }

  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    action: "graphy.sync_exported",
    entity_type: "graphy_sync_run",
    entity_id: runId,
    new_values: { rows: changes.length },
  });

  const stamp = String(run.started_at).slice(0, 10);
  const filename = `graphy-sync-${stamp}-${runId.slice(0, 8)}.csv`;
  // Excel needs a UTF-8 BOM to read non-ASCII names correctly.
  const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
  return new Response(`${BYTE_ORDER_MARK}${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
