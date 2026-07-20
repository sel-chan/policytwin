"use client";

import { useEffect, useState } from "react";
import { WorkspaceShell, StatusPill } from "./components/workspace-shell";
import {
  SEEDED_WORKSPACE_API,
  type WorkspaceGetResponse,
  workspaceErrorMessage,
  workspaceResponse,
} from "./lib/workspace-contract";

export function PolicyStudioClient() {
  const [data, setData] = useState<WorkspaceGetResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadWorkspace() {
    setErrorMessage(null);
    try {
      const response = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, { cache: "no-store" });
      setData(await workspaceResponse<WorkspaceGetResponse>(response));
    } catch (error) {
      setErrorMessage(workspaceErrorMessage(error));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const next = await workspaceResponse<WorkspaceGetResponse>(response);
        if (!controller.signal.aborted) {
          setData(next);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(workspaceErrorMessage(error));
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const policy = data?.workspace.currentVersion.policyIR ?? data?.latestValidatedVersion.policyIR;
  if (!data || !policy) {
    return (
      <WorkspaceShell
        active="studio"
        eyebrow="Workspace / anonymous isolated session"
        title="Policy Studio"
        summary="Restoring this browser's isolated SQLite policy workspace."
        actions={<StatusPill tone={errorMessage ? "bad" : "info"}>{errorMessage ? "Unavailable" : "Loading SQLite"}</StatusPill>}
      >
        <section className="panel state-panel" aria-live="polite">
          <span className="kicker">Workspace state</span>
          <h2>{errorMessage ? "Workspace unavailable" : "Loading policy…"}</h2>
          <p>{errorMessage ?? "A private anonymous demo project is being restored for this browser session."}</p>
          {errorMessage ? <button className="primary" onClick={() => void loadWorkspace()} type="button">Retry</button> : null}
        </section>
      </WorkspaceShell>
    );
  }

  const workspace = data.workspace;
  const latestValidatedVersion = data.latestValidatedVersion;
  const currentVersion = workspace.currentVersion;
  const unresolved = policy.ambiguities.filter((ambiguity) => ambiguity.status === "OPEN").length;
  const isDraft = currentVersion.policyIR === null;
  const stateLabel = isDraft ? "Draft needs review" : unresolved > 0 ? "Needs decision" : "Ready to compile";
  return (
    <WorkspaceShell active="studio" eyebrow={`Workspace / isolated v${currentVersion.version}`} title="Policy Studio" summary="Source language, structured meaning, and executable rules stay in one review surface." actions={<><StatusPill tone={isDraft || unresolved > 0 ? "warn" : "ok"}>SQLite v{currentVersion.version}</StatusPill><StatusPill tone="info">Recorded interpretation</StatusPill></>}>
      <section className="metric-strip" aria-label="Policy status">
        <div><span>Version</span><strong>v{currentVersion.version}</strong><small>{workspace.decisionRecords.length} decisions recorded</small></div>
        <div><span>Clauses</span><strong>{policy.clauses.length}</strong><small>100% traced</small></div>
        <div><span>Rules</span><strong>{policy.rules.length}</strong><small>Deterministic priority</small></div>
        <div><span>State</span><strong>{stateLabel}</strong><small>{isDraft ? "Golden conflict unresolved" : unresolved > 0 ? `${unresolved} explicit choices remain` : "All decisions are explicit"}</small></div>
      </section>
      <div className="two-column studio-grid">
        <section className="panel policy-source"><div className="panel-heading"><div><span className="kicker">Natural language contract</span><h2>Seeded SaaS refund policy</h2></div><span className="mono">{currentVersion.sourceText.length} chars</span></div><div className="policy-paper">{currentVersion.sourceText}</div><div className="notice"><strong>Reproducible demo input</strong><span>{isDraft ? `The v${currentVersion.version} source is saved for review because it conflicts with golden case G02. Validated v${latestValidatedVersion.version} remains the reference.` : "This demo starts from a recorded, schema-validated PolicyIR. Direct Responses API interpretation is the next integration step."}</span></div></section>
        <section className="panel"><div className="panel-heading"><div><span className="kicker">Validated PolicyIR</span><h2>Clause map</h2></div><StatusPill tone={isDraft ? "warn" : "ok"}>{isDraft ? `Prior v${latestValidatedVersion.version}` : "Schema valid"}</StatusPill></div><div className="clause-list">{policy.clauses.map((clause, index) => <article key={clause.id}><span className="clause-index">C{String(index + 1).padStart(2, "0")}</span><div><p>{clause.text}</p><small>{clause.id} · offsets {clause.startOffset}–{clause.endOffset}</small></div></article>)}</div></section>
      </div>
      <section className="panel"><div className="panel-heading"><div><span className="kicker">Executable meaning</span><h2>Priority rule stack</h2></div><span className="mono">first match wins</span></div><div className="rule-grid">{[...policy.rules].sort((a,b) => b.priority-a.priority).map(rule => <article className="rule-card" key={rule.id}><div><span className={`decision ${rule.decision.toLowerCase()}`}>{rule.decision}</span><span className="priority">P{rule.priority}</span></div><h3>{rule.title}</h3><p>{rule.description}</p><small>{rule.id} · {rule.sourceClauseIds.join(", ")}</small></article>)}</div></section>
    </WorkspaceShell>
  );
}
