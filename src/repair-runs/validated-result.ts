import type { ValidatedExternalWorkerV2Run } from "../codex/worker-rpc-client.js";
import type { RepairRunResultSummary } from "./types.js";

export function repairRunSummaryFromValidatedExternalRun(
  value: ValidatedExternalWorkerV2Run,
): RepairRunResultSummary {
  const report = value.report;
  const finalRepair = report.repairAttempts.at(-1);
  const verification = report.policyVerificationAttempts.at(-1);
  if (
    report.executionMode !== "LIVE_CODEX_SDK" ||
    report.status !== "PASS" ||
    (report.attempts !== 1 && report.attempts !== 2) ||
    !finalRepair ||
    !verification ||
    !report.review
  ) {
    throw new Error("Authenticated external worker result is not a complete passing repair report.");
  }
  const commands = report.commandEvidence
    .filter((command) => command.attempt === report.attempts)
    .map((command) => ({
      commandId: command.commandId,
      attempt: command.attempt,
      exitCode: command.exitCode,
      timedOut: command.timedOut,
      durationMs: command.durationMs,
    }));
  return {
    executionMode: "LIVE_CODEX_SDK",
    externalRequestId: value.requestId,
    executionBindingSha256: value.executionBindingSha256,
    completedAt: value.completedAt,
    attempts: report.attempts,
    changedFiles: [...finalRepair.changedFiles].sort(),
    commands,
    verification: {
      status: verification.status,
      passed: verification.passed,
      total: verification.total,
    },
    review: {
      verdict: report.review.verdict,
      summary: report.review.summary,
      blockingFindingCount: report.review.findings.filter(
        (finding) => finding.severity === "HIGH" || finding.severity === "CRITICAL",
      ).length,
    },
  };
}
