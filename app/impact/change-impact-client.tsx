"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkspaceShell, StatusPill } from "../components/workspace-shell";
import type { ImpactArtifact } from "../lib/demo-data";
import { policyMeaningFingerprint } from "../lib/policy-meaning";
import {
  SEEDED_WORKSPACE_API,
  type WorkspaceGetResponse,
  type WorkspaceSourceResponse,
  workspaceErrorCode,
  workspaceErrorMessage,
  workspaceResponse,
} from "../lib/workspace-contract";

export function ChangeImpactClient({
  impact,
  changedSourceText,
  referencePolicyMeaning,
}: {
  impact: ImpactArtifact;
  changedSourceText: string;
  referencePolicyMeaning: string;
}) {
  const [data, setData] = useState<WorkspaceGetResponse | null>(null);
  const [draftText, setDraftText] = useState(changedSourceText);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadWorkspace() {
    setErrorMessage(null);
    try {
      const response = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, { cache: "no-store" });
      const next = await workspaceResponse<WorkspaceGetResponse>(response);
      setData(next);
      if (
        next.workspace.project.currentVersion === impact.toVersion &&
        next.workspace.currentVersion.state === "DRAFT"
      ) {
        setDraftText(next.workspace.currentVersion.sourceText);
      }
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
          if (
            next.workspace.project.currentVersion === impact.toVersion &&
            next.workspace.currentVersion.state === "DRAFT"
          ) {
            setDraftText(next.workspace.currentVersion.sourceText);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(workspaceErrorMessage(error));
        }
      }
    })();
    return () => controller.abort();
  }, [impact.toVersion]);

  const currentVersion = data?.workspace.project.currentVersion ?? 0;
  const exactPreview = draftText === changedSourceText;
  const latestValidatedPolicy = data?.latestValidatedVersion.policyIR;
  const referencePolicyMatches =
    latestValidatedPolicy !== null &&
    latestValidatedPolicy !== undefined &&
    policyMeaningFingerprint(latestValidatedPolicy) === referencePolicyMeaning;
  const persistedDraft =
    data?.workspace.currentVersion.state === "DRAFT" &&
    currentVersion === impact.toVersion &&
    data.workspace.currentVersion.sourceText === changedSourceText &&
    referencePolicyMatches;
  const canPersist =
    currentVersion === impact.fromVersion && exactPreview && referencePolicyMatches && !pending;

  async function persistDraft() {
    if (!data || !canPersist) {
      return;
    }
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`${SEEDED_WORKSPACE_API}/versions/${currentVersion}/source`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PolicyTwin-CSRF": data.csrfToken,
        },
        body: JSON.stringify({ sourceText: draftText }),
      });
      const result = await workspaceResponse<WorkspaceSourceResponse>(response);
      setData({ ...data, workspace: result.workspace });
    } catch (error) {
      if (["STALE_VERSION", "WORKSPACE_BUSY"].includes(workspaceErrorCode(error) ?? "")) {
        try {
          const refreshed = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, { cache: "no-store" });
          setData(await workspaceResponse<WorkspaceGetResponse>(refreshed));
        } catch {
          // The original mutation error remains the actionable result.
        }
      }
      setErrorMessage(workspaceErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const actionLabel = persistedDraft
    ? `Draft v${impact.toVersion} persisted`
    : data === null
      ? "Loading workspace…"
      : currentVersion < impact.fromVersion
      ? "Resolve decisions first"
      : currentVersion === impact.fromVersion && !referencePolicyMatches
        ? "Seeded reference decisions required"
      : pending
        ? "Persisting draft…"
        : currentVersion > impact.fromVersion
          ? "Fresh interpretation required"
          : !exactPreview
            ? "Restore exact 30-day edit"
            : `Create draft v${impact.toVersion}`;

  return (
    <WorkspaceShell
      active="impact"
      eyebrow={`Policy change / v${impact.fromVersion} → v${impact.toVersion}`}
      title="Change Impact"
      summary="Preview how one policy sentence changes rules, cases, and potential code locations before any repair begins."
      actions={<StatusPill tone="warn">Needs review</StatusPill>}
    >
      <section className="impact-hero panel">
        <div>
          <span className="kicker">Deterministic preview</span>
          <h2>14 days becomes 30 days</h2>
          <p>
            This reference-evaluator preview is not a new OPA, GPT-5.6, or Codex run. It predicts impact while the accepted v{impact.fromVersion} proof remains unchanged.
          </p>
        </div>
        <div className="impact-arrow" aria-label="Threshold changes from 14 to 30 days">
          <span>14</span><b aria-hidden="true">→</b><strong>30</strong><small>calendar days</small>
        </div>
      </section>

      {errorMessage ? (
        <div className="inline-alert" role="alert">
          <strong>Draft not stored.</strong>
          <span>{errorMessage}</span>
          <button type="button" onClick={() => void loadWorkspace()}>Retry</button>
        </div>
      ) : null}

      {data && currentVersion >= impact.fromVersion && !referencePolicyMatches ? (
        <div className="inline-alert" role="alert">
          <strong>Reference proof does not match this session.</strong>
          <span>
            This preview requires purchase day 0, request-time usage, and default denial. No v5
            draft can be created from different accepted decisions.
          </span>
        </div>
      ) : null}

      <section className="metric-strip" aria-label="Change impact totals">
        <div><span>Rules changed</span><strong>{impact.changedRules.length}</strong><small>Threshold predicates</small></div>
        <div><span>Cases changed</span><strong>{impact.changedCases.length}</strong><small>Expected decisions</small></div>
        <div><span>Golden conflicts</span><strong>{impact.goldenContradictionCaseIds.length}</strong><small>{impact.goldenContradictionCaseIds.join(", ")}</small></div>
        <div><span>Code locations</span><strong>{impact.potentialCodeLocations.length}</strong><small>Requires repair review</small></div>
      </section>

      <div className="two-column impact-editor-grid">
        <section className="panel impact-editor">
          <div className="panel-heading"><div><span className="kicker">Persisted source version</span><h2>Edit the policy sentence</h2></div><StatusPill tone={persistedDraft ? "warn" : "info"}>{persistedDraft ? `DRAFT v${impact.toVersion}` : `Current v${currentVersion || "…"}`}</StatusPill></div>
          <label htmlFor="impact-policy-text">Candidate policy text</label>
          <textarea
            aria-describedby="impact-policy-help"
            id="impact-policy-text"
            onChange={(event) => setDraftText(event.target.value)}
            readOnly={persistedDraft}
            value={draftText}
          />
          <p id="impact-policy-help">
            The deterministic preview is valid only for the exact seeded 14→30 edit. Other text requires a fresh interpretation.
          </p>
          {!exactPreview ? <p className="field-error">Restore the exact 30-day candidate to use this preview.</p> : null}
          <button className="primary" disabled={!canPersist} onClick={() => void persistDraft()} type="button">
            {actionLabel}
          </button>
        </section>
        <section className="panel golden-block">
          <div className="panel-heading"><div><span className="kicker">Authoritative evidence</span><h2>G02 requires a decision</h2></div><StatusPill tone="warn">DENY → ALLOW</StatusPill></div>
          <div className="golden-explanation">
            <p>Golden case G02 says a day-20 request must be denied. The 30-day candidate would allow it under <code>refund-eligible</code>.</p>
            <ul>
              <li>No golden expectation was rewritten.</li>
              <li>No candidate PolicyIR was accepted.</li>
              <li>No application code or repair was started.</li>
              <li>Original v{impact.fromVersion} proof remains downloadable.</li>
            </ul>
            <div className="evidence-links">
              <Link className="evidence-link" href="/api/evidence/verification-summary.json">Download recorded reference v4 proof summary</Link>
              <Link className="evidence-link" href="/api/evidence/impact-report.json">Download impact-report.json</Link>
            </div>
          </div>
        </section>
      </div>

      <section className="panel impact-diff">
        <div className="panel-heading"><div><span className="kicker">Clause diff</span><h2>One sentence, traceable consequences</h2></div><span className="mono">{impact.executionMode}</span></div>
        {impact.changedClauses.map((clause) => (
          <article key={clause.clauseId}>
            <span className="mono">{clause.clauseId}</span>
            <div><del>{clause.beforeText}</del><ins>{clause.afterText}</ins></div>
          </article>
        ))}
        <div className="boundary-row"><strong>Regenerated boundaries</strong>{impact.regeneratedBoundaryValues.map((value) => <span key={value}>day {value}</span>)}</div>
      </section>

      <div className="two-column impact-results-grid">
        <section className="panel">
          <div className="panel-heading"><div><span className="kicker">Changed expectations</span><h2>{impact.changedCases.length} affected cases</h2></div><StatusPill tone="warn">Preview only</StatusPill></div>
          <p className="table-scroll-hint" id="impact-table-help">Desktop table. On narrow screens, each case is shown as a complete card.</p>
          <div className="table-wrap impact-case-table" aria-describedby="impact-table-help" aria-label="Affected policy cases" tabIndex={0}><table><thead><tr><th>Case</th><th>Source</th><th>Before</th><th>After</th><th>Matched rule</th></tr></thead><tbody>{impact.changedCases.map((item) => <tr className={item.source === "USER_GOLDEN" ? "golden-row" : undefined} key={item.caseId}><td className="mono">{item.caseId}</td><td>{item.source}</td><td><span className="decision deny">{item.beforeDecision}</span></td><td><span className={`decision ${item.afterDecision.toLowerCase()}`}>{item.afterDecision}</span></td><td className="mono">{item.afterRuleId ?? "default"}</td></tr>)}</tbody></table></div>
          <div className="impact-case-cards">{impact.changedCases.map((item) => <article aria-label={`Impact for case ${item.caseId}`} className={item.source === "USER_GOLDEN" ? "golden-row" : undefined} key={item.caseId}><strong className="mono">{item.caseId}</strong><dl><div><dt>Source</dt><dd>{item.source}</dd></div><div><dt>Decision</dt><dd><span className="decision deny">{item.beforeDecision}</span><span aria-hidden="true"> → </span><span className={`decision ${item.afterDecision.toLowerCase()}`}>{item.afterDecision}</span></dd></div><div><dt>Matched rule</dt><dd className="mono">{item.afterRuleId ?? "default"}</dd></div></dl></article>)}</div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="kicker">Potential code impact</span><h2>Review, not repair</h2></div><StatusPill tone="info">No code changed</StatusPill></div>
          <div className="code-map impact-code-map">{impact.potentialCodeLocations.map((location, index) => <article key={location.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{location.symbol}</strong><code>{location.file}:{location.lineStart}{location.lineEnd === location.lineStart ? "" : `–${location.lineEnd}`}</code><small>{location.ruleIds.join(", ")}</small></div></article>)}</div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
