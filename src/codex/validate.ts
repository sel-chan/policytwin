import { assertSafeRelativePath, isRepairCommandId } from "./safety.js";
import {
  REVIEW_SEVERITIES,
  WORKER_EXECUTION_MODES,
  type CartographyResult,
  type CodeLocation,
  type CommandEvidence,
  type RepairResult,
  type RepairWorkerInput,
  type ReviewFinding,
  type ReviewResult,
  type WorkerExecutionMode,
  type WorkerRunMetadata,
} from "./types.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

function pathArray(value: unknown, label: string): string[] {
  const paths = stringArray(value, label).map((item, index) =>
    assertSafeRelativePath(item, `${label}[${index}]`),
  );
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return paths;
}

function parseMetadata(value: unknown, expectedMode?: WorkerExecutionMode): WorkerRunMetadata {
  const result = record(value, "metadata");
  exactKeys(
    result,
    ["executionMode", "backendId", "runId", "startedAt", "completedAt"],
    "metadata",
  );
  if (!WORKER_EXECUTION_MODES.includes(result.executionMode as WorkerExecutionMode)) {
    throw new Error("metadata.executionMode is invalid.");
  }
  const executionMode = result.executionMode as WorkerExecutionMode;
  if (expectedMode !== undefined && executionMode !== expectedMode) {
    throw new Error(`Worker result mode ${executionMode} does not match backend mode ${expectedMode}.`);
  }
  const startedAt = string(result.startedAt, "metadata.startedAt");
  const completedAt = string(result.completedAt, "metadata.completedAt");
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(completedAt))) {
    throw new Error("Worker metadata timestamps must be ISO-compatible dates.");
  }
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("Worker metadata completion cannot precede its start.");
  }
  return {
    executionMode,
    backendId: string(result.backendId, "metadata.backendId"),
    runId: string(result.runId, "metadata.runId"),
    startedAt,
    completedAt,
  };
}

function parseLocation(value: unknown, label: string): CodeLocation {
  const result = record(value, label);
  exactKeys(result, ["file", "lineStart", "lineEnd", "symbol", "reason"], label);
  const lineStart = integer(result.lineStart, `${label}.lineStart`, 1);
  const lineEnd = integer(result.lineEnd, `${label}.lineEnd`, 1);
  if (lineEnd < lineStart) {
    throw new Error(`${label}.lineEnd must not precede lineStart.`);
  }
  return {
    file: assertSafeRelativePath(result.file, `${label}.file`),
    lineStart,
    lineEnd,
    symbol: string(result.symbol, `${label}.symbol`),
    reason: string(result.reason, `${label}.reason`),
  };
}

function parseLocations(value: unknown, label: string): CodeLocation[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((item, index) => parseLocation(item, `${label}[${index}]`));
}

function parseCommandIds(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const commands = value.map((item, index) => {
    if (!isRepairCommandId(item)) {
      throw new Error(`${label}[${index}] is not allowed.`);
    }
    return item;
  });
  if (new Set(commands).size !== commands.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return commands;
}

export function parseRepairWorkerInput(value: unknown): RepairWorkerInput {
  const result = record(value, "repair input");
  exactKeys(
    result,
    [
      "policyId",
      "policyVersion",
      "fixtureId",
      "policySummary",
      "failingCaseIds",
      "allowedCommandIds",
      "maxRepairAttempts",
    ],
    "repair input",
  );
  if (result.fixtureId !== "seeded-refund-demo") {
    throw new Error("Only the bundled trusted fixture is supported.");
  }
  const failingCaseIds = stringArray(result.failingCaseIds, "repair input.failingCaseIds");
  if (failingCaseIds.length === 0 || new Set(failingCaseIds).size !== failingCaseIds.length) {
    throw new Error("Repair input must contain unique failing case IDs.");
  }
  const allowedCommandIds = parseCommandIds(
    result.allowedCommandIds,
    "repair input.allowedCommandIds",
  );
  if (
    !allowedCommandIds.includes("fixture-typecheck") ||
    !allowedCommandIds.includes("fixture-test")
  ) {
    throw new Error("Repair input must allow both fixture verification commands.");
  }
  if (result.maxRepairAttempts !== 1 && result.maxRepairAttempts !== 2) {
    throw new Error("Repair attempts must be bounded to one or two.");
  }
  return {
    policyId: string(result.policyId, "repair input.policyId"),
    policyVersion: integer(result.policyVersion, "repair input.policyVersion", 1),
    fixtureId: "seeded-refund-demo",
    policySummary: string(result.policySummary, "repair input.policySummary"),
    failingCaseIds,
    allowedCommandIds,
    maxRepairAttempts: result.maxRepairAttempts,
  };
}

export function parseCartographyResult(
  value: unknown,
  expectedMode?: WorkerExecutionMode,
): CartographyResult {
  const result = record(value, "cartography");
  exactKeys(
    result,
    [
      "schemaVersion",
      "phase",
      "metadata",
      "relevantFiles",
      "entryPoints",
      "policyLogicLocations",
      "testFiles",
      "risks",
      "proposedFilesToChange",
      "verificationCommandIds",
    ],
    "cartography",
  );
  if (result.schemaVersion !== "1" || result.phase !== "CARTOGRAPHY") {
    throw new Error("Cartography contract version or phase is invalid.");
  }
  const relevantFiles = pathArray(result.relevantFiles, "cartography.relevantFiles");
  const policyLogicLocations = parseLocations(
    result.policyLogicLocations,
    "cartography.policyLogicLocations",
  );
  const testFiles = pathArray(result.testFiles, "cartography.testFiles");
  const entryPoints = parseLocations(result.entryPoints, "cartography.entryPoints");
  if (entryPoints.length === 0 || policyLogicLocations.length === 0 || testFiles.length === 0) {
    throw new Error("Cartography must identify entry points, policy logic, and tests.");
  }
  const knownFiles = new Set(relevantFiles);
  for (const path of [
    ...policyLogicLocations.map((item) => item.file),
    ...testFiles,
    ...pathArray(result.proposedFilesToChange, "cartography.proposedFilesToChange"),
  ]) {
    if (!knownFiles.has(path)) {
      throw new Error(`Cartography references a file outside relevantFiles: ${path}`);
    }
  }
  return {
    schemaVersion: "1",
    phase: "CARTOGRAPHY",
    metadata: parseMetadata(result.metadata, expectedMode),
    relevantFiles,
    entryPoints,
    policyLogicLocations,
    testFiles,
    risks: stringArray(result.risks, "cartography.risks"),
    proposedFilesToChange: pathArray(
      result.proposedFilesToChange,
      "cartography.proposedFilesToChange",
    ),
    verificationCommandIds: parseCommandIds(
      result.verificationCommandIds,
      "cartography.verificationCommandIds",
    ),
  };
}

export function parseRepairResult(value: unknown, expectedMode?: WorkerExecutionMode): RepairResult {
  const result = record(value, "repair");
  exactKeys(
    result,
    [
      "schemaVersion",
      "phase",
      "metadata",
      "changedFiles",
      "summary",
      "rationale",
      "addedTests",
      "remainingRisks",
      "verificationCommandIds",
    ],
    "repair",
  );
  if (result.schemaVersion !== "1" || result.phase !== "REPAIR") {
    throw new Error("Repair contract version or phase is invalid.");
  }
  const changedFiles = pathArray(result.changedFiles, "repair.changedFiles");
  if (changedFiles.length === 0) {
    throw new Error("Repair must report at least one changed file.");
  }
  const addedTests = pathArray(result.addedTests, "repair.addedTests");
  if (addedTests.length === 0) {
    throw new Error("Repair must report a regression test file.");
  }
  const changed = new Set(changedFiles);
  if (addedTests.some((path) => !changed.has(path))) {
    throw new Error("Every reported regression test must also be a changed file.");
  }
  return {
    schemaVersion: "1",
    phase: "REPAIR",
    metadata: parseMetadata(result.metadata, expectedMode),
    changedFiles,
    summary: string(result.summary, "repair.summary"),
    rationale: stringArray(result.rationale, "repair.rationale"),
    addedTests,
    remainingRisks: stringArray(result.remainingRisks, "repair.remainingRisks"),
    verificationCommandIds: parseCommandIds(
      result.verificationCommandIds,
      "repair.verificationCommandIds",
    ),
  };
}

export function parseCommandEvidence(value: unknown): CommandEvidence {
  const result = record(value, "command evidence");
  exactKeys(
    result,
    [
      "schemaVersion",
      "commandId",
      "exitCode",
      "timedOut",
      "durationMs",
      "stdout",
      "stderr",
      "outputTruncated",
    ],
    "command evidence",
  );
  if (result.schemaVersion !== "1" || !isRepairCommandId(result.commandId)) {
    throw new Error("Command evidence version or command ID is invalid.");
  }
  if (typeof result.timedOut !== "boolean" || typeof result.outputTruncated !== "boolean") {
    throw new Error("Command evidence flags must be boolean.");
  }
  return {
    schemaVersion: "1",
    commandId: result.commandId,
    exitCode: integer(result.exitCode, "command evidence.exitCode"),
    timedOut: result.timedOut,
    durationMs: integer(result.durationMs, "command evidence.durationMs"),
    stdout: text(result.stdout, "command evidence.stdout"),
    stderr: text(result.stderr, "command evidence.stderr"),
    outputTruncated: result.outputTruncated,
  };
}

function parseFinding(value: unknown, index: number): ReviewFinding {
  const label = `review.findings[${index}]`;
  const result = record(value, label);
  exactKeys(result, ["id", "severity", "title", "description", "relatedFiles"], label);
  if (!REVIEW_SEVERITIES.includes(result.severity as ReviewFinding["severity"])) {
    throw new Error(`${label}.severity is invalid.`);
  }
  return {
    id: string(result.id, `${label}.id`),
    severity: result.severity as ReviewFinding["severity"],
    title: string(result.title, `${label}.title`),
    description: string(result.description, `${label}.description`),
    relatedFiles: pathArray(result.relatedFiles, `${label}.relatedFiles`),
  };
}

export function parseReviewResult(value: unknown, expectedMode?: WorkerExecutionMode): ReviewResult {
  const result = record(value, "review");
  exactKeys(result, ["schemaVersion", "phase", "metadata", "verdict", "summary", "findings"], "review");
  if (result.schemaVersion !== "1" || result.phase !== "REVIEW") {
    throw new Error("Review contract version or phase is invalid.");
  }
  if (result.verdict !== "APPROVE" && result.verdict !== "BLOCK") {
    throw new Error("Review verdict is invalid.");
  }
  if (!Array.isArray(result.findings)) {
    throw new Error("review.findings must be an array.");
  }
  const findings = result.findings.map(parseFinding);
  const hasBlockingFinding = findings.some(
    (finding) => finding.severity === "HIGH" || finding.severity === "CRITICAL",
  );
  if ((result.verdict === "BLOCK") !== hasBlockingFinding) {
    throw new Error("Review verdict must agree with high or critical findings.");
  }
  return {
    schemaVersion: "1",
    phase: "REVIEW",
    metadata: parseMetadata(result.metadata, expectedMode),
    verdict: result.verdict,
    summary: string(result.summary, "review.summary"),
    findings,
  };
}
