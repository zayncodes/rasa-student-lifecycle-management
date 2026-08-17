"use client";

import { useEffect, useState } from "react";
import type { Student } from "@/types/domain";
import { mapLocalClientOutput } from "@/lib/local-client-records";
import { RasaShell } from "./rasa-shell";

export function LocalRasaShell() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/__local-client-data.json", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Local data request failed (${response.status}).`);
        return response.json();
      })
      .then((output) => setStudents(mapLocalClientOutput(output)))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The local workbook data could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return <main className="workspace-state"><div className="workspace-state__card"><span className="eyebrow">LOCAL REVIEW</span><h1>Workbook data could not be loaded</h1><p>{error}</p><p>Keep the local data service disabled in every online environment.</p></div></main>;
  }

  if (!students) {
    return <main className="workspace-state"><div className="workspace-state__card"><span className="eyebrow">LOCAL REVIEW</span><h1>Preparing the client workspace</h1><p>Loading the extracted workbook records on this computer only…</p></div></main>;
  }

  return <RasaShell initialStudents={students} currentUserName="Local reviewer" workspaceMode="local-read-only" readOnly canExport />;
}
