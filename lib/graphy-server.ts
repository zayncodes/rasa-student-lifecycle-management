import "server-only";

import type { GraphySyncChange, GraphySyncRun } from "@/types/graphy";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type RunRow = {
  id: string;
  filename: string;
  mode: GraphySyncRun["mode"];
  status: GraphySyncRun["status"];
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  ambiguous_rows: number;
  fields_filled: number;
  fields_updated: number;
  fields_unchanged: number;
  fields_protected: number;
  notes: string | null;
  started_at: string;
  completed_at: string | null;
  rolled_back_at: string | null;
};

function mapRun(row: RunRow): GraphySyncRun {
  return {
    id: row.id,
    filename: row.filename,
    mode: row.mode,
    status: row.status,
    totalRows: row.total_rows,
    matchedRows: row.matched_rows,
    unmatchedRows: row.unmatched_rows,
    ambiguousRows: row.ambiguous_rows,
    fieldsFilled: row.fields_filled,
    fieldsUpdated: row.fields_updated,
    fieldsUnchanged: row.fields_unchanged,
    fieldsProtected: row.fields_protected,
    notes: row.notes,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    rolledBackAt: row.rolled_back_at,
  };
}

/** Sync history is gated on imports.manage, matching the RLS policy on the table. */
export async function canManageImports() {
  if (!isSupabaseConfigured) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_permission", { required_permission: "imports.manage" });
  return !error && data === true;
}

export async function getGraphySyncRuns(): Promise<GraphySyncRun[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("graphy_sync_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(200);
  // An absent table or a denied policy simply means there is nothing to show.
  if (error) return [];
  return (data as RunRow[]).map(mapRun);
}

export async function getGraphySyncChanges(runId: string): Promise<GraphySyncChange[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("graphy_sync_changes")
    .select("id, row_number, student_id, match_key, entity, column_name, old_value, new_value, action, applied, reverted, students(full_name, student_code)")
    .eq("run_id", runId)
    .order("id", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`Unable to load sync changes: ${error.message}`);

  type ChangeRow = {
    id: number;
    row_number: number | null;
    student_id: string | null;
    match_key: string | null;
    entity: string;
    column_name: string;
    old_value: string | null;
    new_value: string | null;
    action: GraphySyncChange["action"];
    applied: boolean;
    reverted: boolean;
    students?: { full_name: string; student_code: string | null } | { full_name: string; student_code: string | null }[] | null;
  };

  return (data as unknown as ChangeRow[]).map((row) => {
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    return {
      id: row.id,
      rowNumber: row.row_number,
      studentId: row.student_id,
      studentName: student?.full_name ?? null,
      studentCode: student?.student_code ?? null,
      matchKey: row.match_key,
      entity: row.entity,
      column: row.column_name,
      oldValue: row.old_value,
      newValue: row.new_value,
      action: row.action,
      applied: row.applied,
      reverted: row.reverted,
    };
  });
}
