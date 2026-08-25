"use client";

import { useMemo, useState } from "react";
import type { GraphyChangeAction, GraphySyncChange, GraphySyncRun } from "@/types/graphy";
import { Badge, EmptyState, Modal } from "@/components/ui/primitives";

const ACTION_TONE: Record<GraphyChangeAction, string> = {
  fill: "success",
  update: "blue",
  unchanged: "neutral",
  protected: "warning",
  unmatched: "violet",
  ambiguous: "danger",
};

const ACTION_HELP: Record<GraphyChangeAction, string> = {
  fill: "The field was empty and has been filled from Graphy.",
  update: "A Graphy-owned field was refreshed with a newer value.",
  unchanged: "Graphy agreed with what was already recorded.",
  protected: "An existing value differed and was deliberately left untouched.",
  unmatched: "This learner is not in RASA SLMS. Nothing was created.",
  ambiguous: "The identifier matches several students, so it was skipped rather than guessed.",
};

function formatWhen(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function statusTone(run: GraphySyncRun) {
  if (run.status === "RolledBack") return "neutral";
  if (run.status === "Failed") return "danger";
  return run.mode === "preview" ? "violet" : "success";
}

function statusLabel(run: GraphySyncRun) {
  if (run.status === "RolledBack") return "Rolled back";
  if (run.status === "Failed") return "Failed";
  return run.mode === "preview" ? "Preview only" : "Applied";
}

export function GraphySyncView({ runs: initialRuns }: { runs: GraphySyncRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [detailRun, setDetailRun] = useState<GraphySyncRun | null>(null);
  const [changes, setChanges] = useState<GraphySyncChange[]>([]);
  const [changeFilter, setChangeFilter] = useState<GraphyChangeAction | "all">("all");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirm, setConfirm] = useState<{ run: GraphySyncRun; kind: "rollback" | "delete" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const summary = useMemo(() => ({
    total: runs.length,
    applied: runs.filter((run) => run.mode === "applied" && run.status === "Completed").length,
    rolledBack: runs.filter((run) => run.status === "RolledBack").length,
    fields: runs.filter((run) => run.status === "Completed" && run.mode === "applied")
      .reduce((sum, run) => sum + run.fieldsFilled + run.fieldsUpdated, 0),
  }), [runs]);

  const visibleChanges = useMemo(
    () => changeFilter === "all" ? changes : changes.filter((change) => change.action === changeFilter),
    [changes, changeFilter],
  );

  async function openDetail(run: GraphySyncRun) {
    setDetailRun(run);
    setChanges([]);
    setChangeFilter("all");
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/graphy/runs/${run.id}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The sync detail could not be loaded.");
      setChanges(body.changes as GraphySyncChange[]);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The sync detail could not be loaded." });
      setDetailRun(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function runAction() {
    if (!confirm) return;
    setBusy(true);
    setMessage(null);
    const { run, kind } = confirm;
    try {
      if (kind === "rollback") {
        const response = await fetch(`/api/graphy/runs/${run.id}/rollback`, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "The rollback could not be completed.");
        setRuns((current) => current.map((item) => item.id === run.id
          ? { ...item, status: "RolledBack", rolledBackAt: new Date().toISOString() } : item));
        setMessage({ tone: "ok", text: `Rolled back "${run.filename}". ${body.fieldsRestored} field${body.fieldsRestored === 1 ? "" : "s"} restored to their previous values.` });
      } else {
        const response = await fetch(`/api/graphy/runs/${run.id}`, { method: "DELETE" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "The sync record could not be deleted.");
        setRuns((current) => current.filter((item) => item.id !== run.id));
        setMessage({ tone: "ok", text: `Deleted the history record for "${run.filename}".` });
      }
      setConfirm(null);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "That action could not be completed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view-stack">
      <section className="page-heading-row">
        <div>
          <p className="eyebrow">Learning platform</p>
          <h1>Graphy sync history</h1>
          <p>Every import from Graphy, what it changed, and a one-click undo. Graphy values are kept in their own fields, so workbook history and staff edits are never overwritten.</p>
        </div>
      </section>

      {message ? (
        <p className={message.tone === "ok" ? "security-note" : "auth-error"} role="status">{message.text}</p>
      ) : null}

      <section className="summary-card-grid">
        <article className="summary-card">
          <span>Sync runs</span><strong>{summary.total}</strong><small>Most recent first</small>
        </article>
        <article className="summary-card">
          <span>Currently applied</span><strong>{summary.applied}</strong><small>Each one can be undone</small>
        </article>
        <article className="summary-card">
          <span>Fields written</span><strong>{summary.fields}</strong><small>Across all applied runs</small>
        </article>
        <article className="summary-card">
          <span>Rolled back</span><strong>{summary.rolledBack}</strong><small>Previous values restored</small>
        </article>
      </section>

      <section className="panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2>Past updates</h2>
          </div>
        </header>

        {runs.length === 0 ? (
          <EmptyState
            title="No Graphy syncs yet"
            description="Run a sync from the command line to import a Graphy export. Every run appears here with a full record of what it changed and an undo action."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table full-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">File</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Filled</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Protected</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatWhen(run.startedAt)}</td>
                    <td title={run.filename}>{run.filename}</td>
                    <td>{run.totalRows}</td>
                    <td>{run.fieldsFilled}</td>
                    <td>{run.fieldsUpdated}</td>
                    <td>{run.fieldsProtected}</td>
                    <td><Badge label={statusLabel(run)} tone={statusTone(run)} /></td>
                    <td>
                      <div className="row-action">
                        <button className="small-button" type="button" onClick={() => openDetail(run)}>Details</button>
                        <a className="small-button" href={`/api/graphy/runs/${run.id}/export`}>Download</a>
                        {run.mode === "applied" && run.status === "Completed" ? (
                          <button className="small-button" type="button" onClick={() => setConfirm({ run, kind: "rollback" })}>Roll back</button>
                        ) : null}
                        {run.mode === "preview" || run.status === "RolledBack" ? (
                          <button className="small-button" type="button" onClick={() => setConfirm({ run, kind: "delete" })}>Delete</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(detailRun)}
        onClose={() => setDetailRun(null)}
        eyebrow={detailRun ? formatWhen(detailRun.startedAt) : undefined}
        title={detailRun?.filename ?? "Sync detail"}
        width="wide"
      >
        {loadingDetail ? <p>Loading the change record…</p> : (
          <>
            <div className="home-heading-filters">
              <label className="select-wrap">
                <span className="sr-only">Filter changes</span>
                <select value={changeFilter} onChange={(event) => setChangeFilter(event.target.value as GraphyChangeAction | "all")}>
                  <option value="all">All changes ({changes.length})</option>
                  {(Object.keys(ACTION_TONE) as GraphyChangeAction[]).map((action) => {
                    const count = changes.filter((change) => change.action === action).length;
                    return count ? <option key={action} value={action}>{action} ({count})</option> : null;
                  })}
                </select>
              </label>
              {detailRun ? <a className="secondary-button" href={`/api/graphy/runs/${detailRun.id}/export`}>⇩ Download CSV</a> : null}
            </div>

            {changeFilter !== "all" ? <p className="security-note">{ACTION_HELP[changeFilter]}</p> : null}

            {visibleChanges.length === 0 ? (
              <EmptyState title="Nothing to show" description="No changes of this kind were recorded in this run." />
            ) : (
              <div className="table-scroll">
                <table className="data-table full-table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Field</th>
                      <th scope="col">Previous</th>
                      <th scope="col">New</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleChanges.slice(0, 500).map((change) => (
                      <tr key={change.id}>
                        <td>
                          <strong>{change.studentName ?? change.matchKey ?? "—"}</strong>
                          {change.studentCode ? <small> {change.studentCode}</small> : null}
                        </td>
                        <td>{change.entity}.{change.column}</td>
                        <td>{change.oldValue ?? <em>empty</em>}</td>
                        <td>{change.newValue ?? "—"}</td>
                        <td><Badge label={change.action} tone={ACTION_TONE[change.action]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleChanges.length > 500 ? (
                  <p className="security-note">Showing the first 500 of {visibleChanges.length}. Download the CSV for the complete record.</p>
                ) : null}
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(confirm)}
        onClose={() => (busy ? undefined : setConfirm(null))}
        eyebrow={confirm?.kind === "rollback" ? "Undo this sync" : "Delete history record"}
        title={confirm?.run.filename ?? ""}
      >
        {confirm?.kind === "rollback" ? (
          <p>
            Every field this run wrote will be restored to the value it held beforehand
            — {confirm.run.fieldsFilled + confirm.run.fieldsUpdated} field
            {confirm.run.fieldsFilled + confirm.run.fieldsUpdated === 1 ? "" : "s"} across {confirm.run.matchedRows} student
            {confirm.run.matchedRows === 1 ? "" : "s"}. It runs as a single database transaction, so it either fully
            succeeds or changes nothing. The history record is kept.
          </p>
        ) : (
          <p>
            This removes the history record only. {confirm?.run.status === "RolledBack"
              ? "This run was already rolled back, so no student data is affected."
              : "This run was a preview and never wrote anything."} The record cannot be recovered afterwards.
          </p>
        )}
        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
          <button className="primary-button" type="button" onClick={runAction} disabled={busy}>
            {busy ? "Working…" : confirm?.kind === "rollback" ? "Roll back this sync" : "Delete record"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
