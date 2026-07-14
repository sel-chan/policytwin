"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceShell, StatusPill } from "../components/workspace-shell";
import {
  SEEDED_WORKSPACE_API,
  type WorkspaceDecisionResponse,
  type WorkspaceGetResponse,
  workspaceErrorCode,
  workspaceErrorMessage,
  workspaceResponse,
} from "../lib/workspace-contract";

function decisionLabel(optionId: string, data: WorkspaceGetResponse): string {
  const policy = data.workspace.currentVersion.policyIR ?? data.latestValidatedVersion.policyIR;
  return (
    policy?.ambiguities
      .flatMap((ambiguity) => ambiguity.options)
      .find((option) => option.id === optionId)?.label ?? optionId
  );
}

export function DecisionQueueClient() {
  const [data, setData] = useState<WorkspaceGetResponse | null>(null);
  const [pendingOption, setPendingOption] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [reviewingAmbiguityId, setReviewingAmbiguityId] = useState<string | null>(null);
  const [focusNextQuestion, setFocusNextQuestion] = useState(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);

  const loadWorkspace = useCallback(async () => {
    const response = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, { cache: "no-store" });
    const next = await workspaceResponse<WorkspaceGetResponse>(response);
    setData(next);
    setErrorMessage(null);
    return next;
  }, []);

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
  const currentVersionIsInterpreted = data?.workspace.currentVersion.policyIR !== null;
  const resolvedCount = useMemo(
    () => policy?.ambiguities.filter((ambiguity) => ambiguity.status === "RESOLVED").length ?? 0,
    [policy],
  );
  const nextOpenAmbiguity = policy?.ambiguities.find((ambiguity) => ambiguity.status === "OPEN");
  const activeAmbiguity = currentVersionIsInterpreted
    ? nextOpenAmbiguity ??
      policy?.ambiguities.find((ambiguity) => ambiguity.id === reviewingAmbiguityId)
    : undefined;
  const activeIndex = activeAmbiguity
    ? policy?.ambiguities.findIndex((ambiguity) => ambiguity.id === activeAmbiguity.id) ?? -1
    : -1;

  useEffect(() => {
    if (focusNextQuestion && activeAmbiguity) {
      questionHeading.current?.focus();
      setFocusNextQuestion(false);
    }
  }, [activeAmbiguity, focusNextQuestion]);

  async function retryWorkspace() {
    setErrorMessage(null);
    try {
      await loadWorkspace();
    } catch (error) {
      setErrorMessage(workspaceErrorMessage(error));
    }
  }

  async function resolveDecision(ambiguityId: string, selectedOptionId: string) {
    if (!data || !policy || pendingOption || data.workspace.currentVersion.policyIR === null) {
      return;
    }
    setPendingOption(selectedOptionId);
    setErrorMessage(null);
    setStatusMessage("");
    try {
      const version = data.workspace.project.currentVersion;
      const response = await fetch(
        `${SEEDED_WORKSPACE_API}/versions/${version}/ambiguities/${ambiguityId}/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PolicyTwin-CSRF": data.csrfToken,
          },
          body: JSON.stringify({ selectedOptionId }),
        },
      );
      const result = await workspaceResponse<WorkspaceDecisionResponse>(response);
      const nextPolicy = result.workspace.currentVersion.policyIR;
      const nextQuestion = nextPolicy?.ambiguities.find((ambiguity) => ambiguity.status === "OPEN");
      setData({
        ...data,
        workspace: result.workspace,
        latestValidatedVersion: result.workspace.currentVersion,
      });
      setReviewingAmbiguityId(null);
      setStatusMessage(
        nextQuestion
          ? `Decision saved as version ${result.workspace.project.currentVersion}. Next question: ${nextQuestion.question}`
          : `Decision saved as version ${result.workspace.project.currentVersion}. All required ambiguities are resolved.`,
      );
      setFocusNextQuestion(nextQuestion !== undefined);
    } catch (error) {
      if (
        ["STALE_VERSION", "GOLDEN_CONTRADICTION", "WORKSPACE_BUSY"].includes(
          workspaceErrorCode(error) ?? "",
        )
      ) {
        try {
          await loadWorkspace();
        } catch {
          // Preserve the original conflict message when the refresh also fails.
        }
      }
      setErrorMessage(workspaceErrorMessage(error));
    } finally {
      setPendingOption(null);
    }
  }

  if (!data || !policy) {
    return (
      <WorkspaceShell
        active="decisions"
        eyebrow="Review gate / isolated workspace"
        title="Decision Queue"
        summary="Loading this browser session's SQLite policy version and immutable decision ledger."
        actions={<StatusPill tone={errorMessage ? "bad" : "info"}>{errorMessage ? "Unavailable" : "Loading SQLite"}</StatusPill>}
      >
        <section className="panel state-panel" aria-live="polite">
          <span className="kicker">Workspace state</span>
          <h2>{errorMessage ? "Workspace unavailable" : "Restoring decisions…"}</h2>
          <p>{errorMessage ?? "Policy versions and decision records are being read from isolated local persistence."}</p>
          {errorMessage ? (
            <button className="primary" type="button" onClick={() => void retryWorkspace()}>
              Retry
            </button>
          ) : null}
        </section>
      </WorkspaceShell>
    );
  }

  const selected = activeAmbiguity?.options.find(
    (option) => option.id === activeAmbiguity.selectedOptionId,
  );
  const sourceQuote = activeAmbiguity
    ? policy.clauses.find((clause) => activeAmbiguity.sourceClauseIds.includes(clause.id))?.text
    : undefined;

  return (
    <WorkspaceShell
      active="decisions"
      eyebrow={`Review gate / isolated v${data.workspace.project.currentVersion}`}
      title="Decision Queue"
      summary="Choose one source-backed option at a time. Each accepted choice creates an immutable SQLite version and decision record."
      actions={
        <StatusPill tone={resolvedCount === policy.ambiguities.length ? "ok" : "warn"}>
          {resolvedCount} / {policy.ambiguities.length} resolved
        </StatusPill>
      }
    >
      <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>
      {errorMessage ? (
        <div className="inline-alert" role="alert">
          <strong>Decision not stored.</strong>
          <span>{errorMessage}</span>
        </div>
      ) : null}
      <section className="decision-layout">
        <div className="decision-stack" aria-busy={pendingOption !== null}>
          {!currentVersionIsInterpreted ? (
            <section className="panel decision-complete">
              <span className="kicker">Draft version active</span>
              <h2>Interpret v{data.workspace.project.currentVersion} before changing decisions</h2>
              <p>The accepted decision ledger belongs to authoritative v{data.latestValidatedVersion.version}. The current text-only draft cannot accept ambiguity patches.</p>
            </section>
          ) : activeAmbiguity ? (
            <article className="panel decision-card">
              <div className="decision-head">
                <span className="step-number">{String(activeIndex + 1).padStart(2, "0")}</span>
                <div>
                  <span className="kicker">{activeAmbiguity.category}</span>
                  <h2 ref={questionHeading} tabIndex={-1}>{activeAmbiguity.question}</h2>
                </div>
                <StatusPill tone="warn">{activeAmbiguity.status === "OPEN" ? "Choose now" : "Revisit"}</StatusPill>
              </div>
              {sourceQuote ? <blockquote className="source-quote">“{sourceQuote}”</blockquote> : null}
              <p className="rationale">{activeAmbiguity.rationale}</p>
              <div className="option-list">
                {activeAmbiguity.options.map((option) => {
                  const isSelected = option.id === activeAmbiguity.selectedOptionId;
                  const isPending = option.id === pendingOption;
                  return (
                    <button
                      aria-pressed={isSelected}
                      className={isSelected ? "option option-button selected" : "option option-button"}
                      disabled={pendingOption !== null || isSelected}
                      key={option.id}
                      onClick={() => void resolveDecision(activeAmbiguity.id, option.id)}
                      type="button"
                    >
                      <span className="radio" aria-hidden="true" />
                      <span><strong>{option.label}</strong><small>{option.description}</small></span>
                      {isSelected ? <span className="chosen">Accepted</span> : null}
                      {isPending ? <span className="chosen">Saving…</span> : null}
                    </button>
                  );
                })}
              </div>
              <footer>
                <span className="mono">{activeAmbiguity.id}</span>
                <strong>{selected?.policyPatch.op.replaceAll("_", " ") ?? "Awaiting explicit choice"}</strong>
              </footer>
            </article>
          ) : (
            <section className="panel decision-complete">
              <span className="kicker">Review gate complete</span>
              <h2>All required ambiguity decisions are explicit</h2>
              <p>Version v{data.workspace.project.currentVersion} is ready for deterministic compilation. Revisit any decision to create another immutable version.</p>
              <div className="completed-decision-list">
                {policy.ambiguities.map((ambiguity) => (
                  <div key={ambiguity.id}>
                    <span>{ambiguity.question}</span>
                    <strong>{ambiguity.options.find((option) => option.id === ambiguity.selectedOptionId)?.label}</strong>
                    <button type="button" onClick={() => setReviewingAmbiguityId(ambiguity.id)}>Revisit</button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="panel audit-rail">
          <span className="kicker">Version ledger</span>
          <h2>Every choice leaves proof</h2>
          <ol>
            <li><strong>v1</strong><span>Recorded interpretation</span></li>
            {data.workspace.decisionRecords.map((record) => (
              <li key={record.id}>
                <strong>v{record.toVersion}</strong>
                <span>{decisionLabel(record.selectedOptionId, data)}</span>
              </li>
            ))}
          </ol>
          <div className="notice">
            <strong>Golden cases are authoritative</strong>
            <span>A conflicting choice returns 409 and creates no version.</span>
          </div>
          <p className="persistence-note">SQLite current version: <strong>v{data.workspace.project.currentVersion}</strong></p>
        </aside>
      </section>
    </WorkspaceShell>
  );
}
