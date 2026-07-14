import {
  parseCartographyResult,
  parseCommandEvidence,
  parseRepairResult,
  parseRepairWorkerInput,
  parseReviewResult,
} from "./validate.js";
import type {
  CodexWorkerBackend,
  CommandEvidence,
  RepairCommandId,
  RepairCommandRunner,
  RepairFailure,
  RepairWorkerReport,
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
    failure: { code, message },
  };
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
  return [...new Set([...requested, ...required])];
}

export async function orchestrateRepair(
  inputValue: unknown,
  backend: CodexWorkerBackend,
  runCommand: RepairCommandRunner,
): Promise<RepairWorkerReport> {
  const input = parseRepairWorkerInput(inputValue);
  const state = {
    attempts: 0,
    cartography: null,
    repairAttempts: [],
    commandEvidence: [],
    review: null,
  } as Omit<RepairWorkerReport, "schemaVersion" | "executionMode" | "status" | "failure">;

  try {
    state.cartography = parseCartographyResult(
      await backend.cartograph({ input: structuredClone(input) }),
      backend.executionMode,
    );
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
    let repair;
    try {
      repair = parseRepairResult(
        await backend.repair({
          input: structuredClone(input),
          cartography: structuredClone(state.cartography),
          attempt,
          previousCommandEvidence: structuredClone(state.commandEvidence),
        }),
        backend.executionMode,
      );
      if (repair.metadata.backendId !== state.cartography.metadata.backendId) {
        throw new Error("Repair backend identity does not match cartography.");
      }
      const proposed = new Set(state.cartography.proposedFilesToChange);
      const unexpected = repair.changedFiles.filter((file) => !proposed.has(file));
      if (unexpected.length > 0) {
        throw new Error(`Repair changed files outside the cartography plan: ${unexpected.join(", ")}`);
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
    try {
      commands = allowedCommands(repair.verificationCommandIds, input.allowedCommandIds);
      const evidence: CommandEvidence[] = [];
      for (const commandId of commands) {
        evidence.push(parseCommandEvidence(await runCommand(commandId)));
      }
      state.commandEvidence = evidence;
    } catch (error) {
      return failureReport(
        backend.executionMode,
        "COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
        state,
      );
    }

    const commandsPassed = state.commandEvidence.every(
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

    try {
      state.review = parseReviewResult(
        await backend.review({
          input: structuredClone(input),
          cartography: structuredClone(state.cartography),
          repair: structuredClone(repair),
          commandEvidence: structuredClone(state.commandEvidence),
        }),
        backend.executionMode,
      );
      if (state.review.metadata.backendId !== state.cartography.metadata.backendId) {
        throw new Error("Review backend identity does not match cartography.");
      }
      if (state.review.metadata.runId === repair.metadata.runId) {
        throw new Error("Independent review must use a distinct run identity.");
      }
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
