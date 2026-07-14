import { createHash } from "node:crypto";
import { redactWorkerOutput } from "./safety.js";
import {
  parseCartographyResult,
  parseCommandResult,
  parsePolicyVerificationEvidence,
  parseRepairResult,
  parseRepairWorkerInput,
  parseReviewResult,
} from "./validate.js";
import type {
  CodexWorkerBackend,
  CommandEvidence,
  CommandFailureEvidence,
  RepairCommandId,
  RepairCommandRunner,
  RepairFailure,
  RepairResult,
  RepairWorkerInput,
  RepairWorkerReport,
  PolicyVerificationEvidence,
  PolicyVerificationRunner,
} from "./types.js";

function failureReport(
  executionMode: RepairWorkerReport["executionMode"],
  code: RepairFailure["code"],
  message: string,
  report: Omit<RepairWorkerReport, "schemaVersion" | "executionMode" | "status" | "failure">,
): RepairWorkerReport {
  return {
    schemaVersion: "1",
    executionMode,
    status: "FAIL",
    ...report,
    failure: { code, message: safeFailureMessage(message) },
  };
}

function safeFailureMessage(value: unknown): string {
  return redactWorkerOutput(value instanceof Error ? value.message : String(value), 4_096).text;
}

function allowedCommands(
  requested: readonly RepairCommandId[],
  allowed: readonly RepairCommandId[],
): RepairCommandId[] {
  for (const commandId of requested) {
    if (!allowed.includes(commandId)) {
      throw new Error(`Worker requested a command outside the allowlist: ${commandId}`);
    }
  }
  const required: RepairCommandId[] = ["fixture-typecheck", "fixture-test"];
  return required;
}

function assertAcceptedCorpusReceipt(
  evidence: PolicyVerificationEvidence,
  input: RepairWorkerInput,
): void {
  if (evidence.total !== input.acceptedCases.length) {
    throw new Error(
      `Policy verification covered ${evidence.total} of ${input.acceptedCases.length} accepted cases.`,
    );
  }
  const resultById = new Map(evidence.results.map((result) => [result.caseId, result]));
  for (const policyCase of input.acceptedCases) {
    const result = resultById.get(policyCase.id);
    if (result === undefined) {
      throw new Error(`Policy verification omitted accepted case ${policyCase.id}.`);
    }
    if (result.expectedDecision !== policyCase.expectedDecision) {
      throw new Error(`Policy verification changed the expected decision for ${policyCase.id}.`);
    }
  }
}

export async function orchestrateRepair(
  inputValue: unknown,
  backend: CodexWorkerBackend,
  runCommand: RepairCommandRunner,
  verifyPolicyCorpus: PolicyVerificationRunner,
): Promise<RepairWorkerReport> {
  const input = parseRepairWorkerInput(inputValue);
  const acceptedCorpusSha256 = createHash("sha256")
    .update(JSON.stringify(input.acceptedCases))
    .digest("hex");
  const policyIrSha256 = createHash("sha256")
    .update(JSON.stringify(input.acceptedPolicyIr))
    .digest("hex");
  const state = {
    attempts: 0,
    cartography: null,
    repairAttempts: [],
    commandEvidence: [],
    commandFailures: [],
    policyVerificationAttempts: [],
    review: null,
  } as Omit<RepairWorkerReport, "schemaVersion" | "executionMode" | "status" | "failure">;
  const seenRunIds = new Set<string>();

  try {
    state.cartography = parseCartographyResult(
      await backend.cartograph({ input: structuredClone(input) }),
      backend.executionMode,
    );
    seenRunIds.add(state.cartography.metadata.runId);
  } catch (error) {
    return failureReport(
      backend.executionMode,
      "CARTOGRAPHY_INVALID",
      error instanceof Error ? error.message : String(error),
      state,
    );
  }

  for (let attempt = 1; attempt <= input.maxRepairAttempts; attempt += 1) {
    state.attempts = attempt;
    let repair: RepairResult;
    try {
      repair = parseRepairResult(
        await backend.repair({
          input: structuredClone(input),
          cartography: structuredClone(state.cartography),
          attempt,
          previousCommandEvidence: structuredClone(state.commandEvidence),
          previousPolicyVerification: structuredClone(
            state.policyVerificationAttempts.at(-1) ?? null,
          ),
        }),
        backend.executionMode,
      );
      if (repair.metadata.backendId !== state.cartography.metadata.backendId) {
        throw new Error("Repair backend identity does not match cartography.");
      }
      if (seenRunIds.has(repair.metadata.runId)) {
        throw new Error("Every cartography and repair attempt must use a distinct run identity.");
      }
      seenRunIds.add(repair.metadata.runId);
      const proposed = new Set(state.cartography.proposedFilesToChange);
      const unexpected = repair.changedFiles.filter((file) => !proposed.has(file));
      const missing = [...proposed].filter((file) => !repair.changedFiles.includes(file));
      if (unexpected.length > 0 || missing.length > 0) {
        throw new Error(
          `Repair changed files do not exactly match the cartography plan: unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}.`,
        );
      }
      state.repairAttempts.push(repair);
    } catch (error) {
      return failureReport(
        backend.executionMode,
        "REPAIR_INVALID",
        error instanceof Error ? error.message : String(error),
        state,
      );
    }

    let commands;
    const currentCommandEvidence: CommandEvidence[] = [];
    try {
      commands = allowedCommands(repair.verificationCommandIds, input.allowedCommandIds);
      for (const commandId of commands) {
        try {
          const result = parseCommandResult(await runCommand(commandId));
          const evidence: CommandEvidence = {
            ...result,
            attempt: attempt as 1 | 2,
            repairRunId: repair.metadata.runId,
          };
          currentCommandEvidence.push(evidence);
          state.commandEvidence.push(evidence);
        } catch (error) {
          const failure: CommandFailureEvidence = {
            schemaVersion: "1",
            commandId,
            attempt: attempt as 1 | 2,
            repairRunId: repair.metadata.runId,
            failureKind: "COMMAND_RUNNER_OR_EVIDENCE_ERROR",
            error: safeFailureMessage(error),
          };
          state.commandFailures.push(failure);
          throw error;
        }
      }
    } catch (error) {
      return failureReport(
        backend.executionMode,
        "COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
        state,
      );
    }

    const [typecheckEvidence, testEvidence] = currentCommandEvidence;
    if (
      typecheckEvidence === undefined ||
      testEvidence === undefined ||
      typecheckEvidence.commandId !== "fixture-typecheck" ||
      testEvidence.commandId !== "fixture-test" ||
      typecheckEvidence.fixtureTreeAfterSha256 !== testEvidence.fixtureTreeBeforeSha256 ||
      testEvidence.fixtureTreeBeforeSha256 !== testEvidence.fixtureTreeAfterSha256
    ) {
      return failureReport(
        backend.executionMode,
        "COMMAND_FAILED",
        "Repair verification commands did not preserve the trusted build and test tree boundary.",
        state,
      );
    }
    const commandsPassed = currentCommandEvidence.every(
      (item) => item.exitCode === 0 && !item.timedOut,
    );
    if (!commandsPassed) {
      if (attempt < input.maxRepairAttempts) {
        continue;
      }
      return failureReport(
        backend.executionMode,
        "COMMAND_FAILED",
        "Repair verification commands did not pass within the bounded attempts.",
        state,
      );
    }

    let policyVerification;
    try {
      policyVerification = parsePolicyVerificationEvidence(
        await verifyPolicyCorpus(structuredClone(input), {
          attempt: attempt as 1 | 2,
          repairRunId: repair.metadata.runId,
          fixtureTreeSha256: testEvidence.fixtureTreeAfterSha256,
          acceptedCorpusSha256,
          policyIrSha256,
        }),
      );
      assertAcceptedCorpusReceipt(policyVerification, input);
      if (
        policyVerification.attempt !== attempt ||
        policyVerification.repairRunId !== repair.metadata.runId ||
        policyVerification.fixtureTreeSha256 !== testEvidence.fixtureTreeAfterSha256 ||
        policyVerification.acceptedCorpusSha256 !== acceptedCorpusSha256 ||
        policyVerification.policyIrSha256 !== policyIrSha256
      ) {
        throw new Error("Policy verification receipt is not bound to the current repair attempt.");
      }
      state.policyVerificationAttempts.push(policyVerification);
    } catch (error) {
      return failureReport(
        backend.executionMode,
        "POLICY_VERIFICATION_FAILED",
        error instanceof Error ? error.message : String(error),
        state,
      );
    }
    if (policyVerification.status !== "PASS") {
      if (attempt < input.maxRepairAttempts) {
        continue;
      }
      const failures = policyVerification.results
        .filter((result) => result.status !== "PASS")
        .map((result) => result.caseId);
      return failureReport(
        backend.executionMode,
        "POLICY_VERIFICATION_FAILED",
        `Policy verification did not pass the accepted corpus: ${failures.join(", ")}.`,
        state,
      );
    }

    try {
      state.review = parseReviewResult(
        await backend.review({
          input: structuredClone(input),
          cartography: structuredClone(state.cartography),
          repair: structuredClone(repair),
          commandEvidence: structuredClone(currentCommandEvidence),
          policyVerification: structuredClone(policyVerification),
        }),
        backend.executionMode,
      );
      if (state.review.metadata.backendId !== state.cartography.metadata.backendId) {
        throw new Error("Review backend identity does not match cartography.");
      }
      if (seenRunIds.has(state.review.metadata.runId)) {
        throw new Error("Independent review must use a distinct run identity from every prior phase.");
      }
      seenRunIds.add(state.review.metadata.runId);
    } catch (error) {
      return failureReport(
        backend.executionMode,
        "REVIEW_INVALID",
        error instanceof Error ? error.message : String(error),
        state,
      );
    }

    if (state.review.verdict === "BLOCK") {
      return failureReport(
        backend.executionMode,
        "REVIEW_BLOCKED",
        "Independent review contains a high or critical finding.",
        state,
      );
    }

    return {
      schemaVersion: "1",
      executionMode: backend.executionMode,
      status: "PASS",
      ...state,
      failure: null,
    };
  }

  return failureReport(
    backend.executionMode,
    "COMMAND_FAILED",
    "Repair loop ended without a verified result.",
    state,
  );
}
