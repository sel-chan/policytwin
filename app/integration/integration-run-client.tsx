"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepairRunEvent, RepairRunRecord } from "../../dist/repair-runs/types.js";
import { StatusPill } from "../components/workspace-shell";
import { policyMeaningFingerprint } from "../lib/policy-meaning";
import {
  repairRunErrorMessage,
  seededRepairRunApi,
  type LatestRepairRunResponse,
  type RepairRunResponse,
} from "../lib/repair-run-contract";
import {
  SEEDED_WORKSPACE_API,
  type WorkspaceGetResponse,
  workspaceErrorMessage,
  workspaceResponse,
} from "../lib/workspace-contract";

const TERMINAL_EVENTS = new Set([
  "RUN_BLOCKED",
  "RUN_SUCCEEDED",
  "RUN_FAILED",
  "RUN_POISONED",
]);

function mergeEvents(current: RepairRunEvent[], incoming: RepairRunEvent[]): RepairRunEvent[] {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

function statusTone(status: RepairRunRecord["status"]): "ok" | "warn" | "bad" | "info" {
  if (status === "SUCCEEDED") return "ok";
  if (status === "BLOCKED" || status === "FAILED" || status === "POISONED") return "bad";
  return status === "RUNNING" || status === "CLEANUP_PENDING" ? "info" : "warn";
}

function eventLabel(event: RepairRunEvent): string {
  const labels: Record<RepairRunEvent["type"], string> = {
    RUN_CREATED: "Run created",
    RUN_STARTED: "External worker started",
    PHASE_STARTED: `${event.phase.toLowerCase()} started`,
    PHASE_COMPLETED: `${event.phase.toLowerCase()} completed`,
    RUN_BLOCKED: "Run blocked",
    RUN_CLEANUP_PENDING: "Cleanup pending",
    RUN_SUCCEEDED: "Run verified",
    RUN_FAILED: "Run failed",
    RUN_POISONED: "Run fail-stop blocked",
  };
  return labels[event.type];
}

export function IntegrationRunPanel({
  referencePolicyMeaning,
}: {
  referencePolicyMeaning: string;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceGetResponse | null>(null);
  const [run, setRun] = useState<RepairRunRecord | null>(null);
  const [events, setEvents] = useState<RepairRunEvent[]>([]);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamMessage, setStreamMessage] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);

  const runVersion = workspace?.latestValidatedVersion.version ?? null;
  const loadRun = useCallback(async (version: number) => {
    const response = await fetch(seededRepairRunApi(version), { cache: "no-store" });
    const data = await workspaceResponse<LatestRepairRunResponse>(response);
    setRun(data.run);
    setEvents(data.events);
    return data;
  }, []);

  const loadWorkspaceAndRun = useCallback(async () => {
    const response = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, { cache: "no-store" });
    const data = await workspaceResponse<WorkspaceGetResponse>(response);
    setWorkspace(data);
    await loadRun(data.latestValidatedVersion.version);
    setErrorMessage(null);
  }, [loadRun]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await workspaceResponse<WorkspaceGetResponse>(response);
        if (controller.signal.aborted) return;
        setWorkspace(data);
        const runResponse = await fetch(seededRepairRunApi(data.latestValidatedVersion.version), {
          cache: "no-store",
          signal: controller.signal,
        });
        const restored = await workspaceResponse<LatestRepairRunResponse>(runResponse);
        if (!controller.signal.aborted) {
          setRun(restored.run);
          setEvents(restored.events);
        }
      } catch (error) {
        if (!controller.signal.aborted) setErrorMessage(workspaceErrorMessage(error));
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (
      !run ||
      (run.status !== "QUEUED" &&
        run.status !== "RUNNING" &&
        run.status !== "CLEANUP_PENDING")
    ) return;
    const source = new EventSource(
      `${seededRepairRunApi(run.policyVersion)}/${encodeURIComponent(run.id)}/events`,
    );
    eventSourceRef.current = source;
    source.addEventListener("repair-run", (message) => {
      try {
        const event = JSON.parse((message as MessageEvent<string>).data) as RepairRunEvent;
        if (
          event.schemaVersion !== "1" ||
          event.runId !== run.id ||
          !Number.isSafeInteger(event.sequence) ||
          event.sequence < 1
        ) {
          throw new Error("invalid repair-run event");
        }
        setEvents((current) => mergeEvents(current, [event]));
        setStreamMessage(null);
        if (TERMINAL_EVENTS.has(event.type)) {
          source.close();
          void (async () => {
            for (let attempt = 1; attempt <= 5; attempt += 1) {
              try {
                await loadRun(run.policyVersion);
                return;
              } catch (error) {
                if (attempt === 5) {
                  setStreamMessage(
                    `${workspaceErrorMessage(error)} Refresh the persisted status manually.`,
                  );
                  return;
                }
                await new Promise((resolve) => setTimeout(resolve, attempt * 250));
              }
            }
          })();
        }
      } catch {
        source.close();
        setStreamMessage("The repair timeline received an invalid event and closed safely.");
      }
    });
    source.onerror = () => {
      setStreamMessage("The timeline connection is retrying from its last persisted event.");
    };
    return () => {
      source.close();
      if (eventSourceRef.current === source) eventSourceRef.current = null;
    };
  }, [loadRun, run?.id, run?.policyVersion, run?.status]);

  const referenceMatches = useMemo(() => {
    const policy = workspace?.latestValidatedVersion.policyIR;
    return policy !== null && policy !== undefined && policyMeaningFingerprint(policy) === referencePolicyMeaning;
  }, [referencePolicyMeaning, workspace]);
  const canStart =
    workspace !== null &&
    runVersion !== null &&
    workspace.workspace.project.currentVersion === runVersion &&
    workspace.workspace.currentVersion.policyIR !== null &&
    referenceMatches &&
    !pending;

  async function startRun() {
    if (!workspace || !canStart || runVersion === null) return;
    setPending(true);
    setErrorMessage(null);
    setStreamMessage(null);
    const requestId = pendingRequestIdRef.current ?? crypto.randomUUID();
    pendingRequestIdRef.current = requestId;
    try {
      const response = await fetch(seededRepairRunApi(runVersion), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PolicyTwin-CSRF": workspace.csrfToken,
        },
        body: JSON.stringify({ clientRequestId: requestId }),
      });
      const data = await workspaceResponse<RepairRunResponse>(response);
      setRun(data.run);
      setEvents(data.events);
      pendingRequestIdRef.current = null;
    } catch (error) {
      try {
        const restored = await loadRun(runVersion);
        if (restored.run?.clientRequestId === requestId) {
          pendingRequestIdRef.current = null;
          setErrorMessage(null);
          return;
        }
      } catch {
        // Preserve the original mutation failure and request ID for an idempotent retry.
      }
      setErrorMessage(repairRunErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (!workspace) {
    return (
      <section className="panel repair-run-panel" aria-live="polite">
        <div className="panel-heading">
          <div><span className="kicker">Guarded repair run</span><h2>Restoring run state</h2></div>
          <StatusPill tone={errorMessage ? "bad" : "info"}>
            {errorMessage ? "Unavailable" : "Loading SQLite"}
          </StatusPill>
        </div>
        <div className="repair-run-empty">
          <p>{errorMessage ?? "Reading this session's persisted run and event cursor."}</p>
          {errorMessage ? (
            <button className="primary" type="button" onClick={() => void loadWorkspaceAndRun()}>
              Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const blockedReason =
    workspace.workspace.project.currentVersion !== runVersion
      ? "The current source is a newer draft. Interpret and accept it before repair."
      : !referenceMatches
        ? "This session's accepted policy meaning does not match the trusted seeded repair fixture."
        : workspace.workspace.currentVersion.policyIR === null
          ? "The current policy version has no accepted PolicyIR."
          : null;

  return (
    <section className="panel repair-run-panel" aria-busy={pending || run?.status === "RUNNING"}>
      <div className="panel-heading">
        <div>
          <span className="kicker">Guarded repair run</span>
          <h2>{run ? `Run ${run.id.slice(-8)}` : "Codex repair timeline"}</h2>
        </div>
        <StatusPill tone={run ? statusTone(run.status) : "warn"}>
          {run?.status ?? "Not started"}
        </StatusPill>
      </div>

      {errorMessage ? (
        <div className="inline-alert" role="alert">
          <strong>Repair run not started.</strong><span>{errorMessage}</span>
        </div>
      ) : null}
      {streamMessage ? <p className="repair-stream-state" role="status">{streamMessage}</p> : null}

      {!run ? (
        <div className="repair-run-empty">
          <strong>No repair run has been admitted for this session.</strong>
          <p>
            Starting a run creates a durable audit record first. Live work begins only if the
            external worker, immutable images, and Linux isolation gate are admitted.
          </p>
          {blockedReason ? <p className="field-error">{blockedReason}</p> : null}
          <button className="primary" disabled={!canStart} onClick={() => void startRun()} type="button">
            {pending ? "Creating guarded run…" : "Start guarded Codex repair"}
          </button>
        </div>
      ) : (
        <div className="repair-run-layout">
          <div>
            <ol className="repair-timeline" aria-label="Repair run events">
              {events.map((event) => (
                <li key={event.sequence} className={event.type.includes("FAILED") || event.type.includes("BLOCKED") ? "bad" : undefined}>
                  <span>{String(event.sequence).padStart(2, "0")}</span>
                  <div><strong>{eventLabel(event)}</strong><small>{event.detail.message}</small></div>
                  <code>{event.phase}</code>
                </li>
              ))}
            </ol>
          </div>
          <aside className="repair-run-summary">
            <dl>
              <div><dt>Execution</dt><dd>{run.executionMode}</dd></div>
              <div><dt>Policy version</dt><dd>v{run.policyVersion}</dd></div>
              <div><dt>Input binding</dt><dd><code>{run.inputSha256.slice(0, 12)}</code></dd></div>
              <div><dt>Updated</dt><dd>{new Date(run.updatedAt).toLocaleTimeString()}</dd></div>
            </dl>
            {run.failure ? (
              <div className="repair-blocked" role="status">
                <strong>{run.failure.code.replaceAll("_", " ")}</strong>
                <p>{run.failure.message}</p>
                <small>
                  {run.status === "BLOCKED" && run.executionMode === "NOT_STARTED"
                    ? "No model or Codex call occurred for this blocked run."
                    : "No successful live-execution claim is made without an admitted receipt."}
                </small>
              </div>
            ) : null}
            {run.result ? (
              <div className="repair-result">
                <strong>{run.result.verification.passed}/{run.result.verification.total} accepted cases</strong>
                <p>{run.result.changedFiles.join(", ")}</p>
                <ul>{run.result.commands.map((command) => (
                  <li key={`${command.attempt}-${command.commandId}`}>
                    {command.commandId}: exit {command.exitCode}
                  </li>
                ))}</ul>
                <small>Independent review: {run.result.review?.verdict ?? "unavailable"}</small>
              </div>
            ) : null}
            <div className="repair-run-actions">
              {(run.status === "BLOCKED" || run.status === "FAILED") && canStart ? (
                <button className="primary" disabled={pending} type="button" onClick={() => void startRun()}>
                  {pending ? "Creating guarded run…" : "Create new guarded attempt"}
                </button>
              ) : null}
              {run.status === "BLOCKED" ||
              run.status === "FAILED" ||
              run.status === "POISONED" ||
              streamMessage ? (
                <button className="secondary" type="button" onClick={() => void loadRun(run.policyVersion)}>
                  Refresh persisted status
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
