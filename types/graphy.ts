export type GraphyChangeAction = "fill" | "update" | "unchanged" | "protected" | "unmatched" | "ambiguous";

export type GraphySyncRun = {
  id: string;
  filename: string;
  mode: "preview" | "applied";
  status: "Completed" | "Failed" | "RolledBack";
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  fieldsFilled: number;
  fieldsUpdated: number;
  fieldsUnchanged: number;
  fieldsProtected: number;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  rolledBackAt: string | null;
};

export type GraphySyncChange = {
  id: number;
  rowNumber: number | null;
  studentId: string | null;
  studentName: string | null;
  studentCode: string | null;
  matchKey: string | null;
  entity: string;
  column: string;
  oldValue: string | null;
  newValue: string | null;
  action: GraphyChangeAction;
  applied: boolean;
  reverted: boolean;
};
