import { createHash } from "node:crypto";
import { isDecision } from "../domain/decision.js";
import { parsePolicyCases } from "../domain/case-validation.js";
import { parseRefundPolicyInput } from "../domain/refund.js";
import { segmentPolicyClauses } from "../policy-ir/clauses.js";
import { findGoldenContradictions } from "../policy-ir/evaluate.js";
import { assertPolicyReadyToCompile } from "../policy-ir/state.js";
import { parsePolicyIR } from "../policy-ir/validate.js";
import {
  assertNoSensitiveWorkerText,
  assertSafeRelativePath,
  isRepairCommandId,
} from "./safety.js";
import {
  REVIEW_SEVERITIES,
  WORKER_EXECUTION_MODES,
  WORKER_REASONING_EFFORTS,
  type CartographyResult,
  type CodeLocation,
  type CommandEvidence,
  type CommandResult,
  type RepairResult,
  type RepairDriftWitness,
  type RepairWorkerInput,
  type PolicyVerificationCaseResult,
  type PolicyVerificationEvidence,
  type ReviewFinding,
  type ReviewResult,
  type WorkerExecutionMode,
  type WorkerRunMetadata,
} from "./types.js";

const MAX_SOURCE_POLICY_LENGTH = 32_768;
const MAX_POLICY_SUMMARY_LENGTH = 4_096;
const MAX_POLICY_IR_JSON_LENGTH = 128 * 1024;
const MAX_ACCEPTED_CASES_JSON_LENGTH = 512 * 1024;
const MAX_DRIFT_WITNESSES_JSON_LENGTH = 128 * 1024;
const SEEDED_ACCEPTED_CASE_COUNT = 41;
const SEEDED_ACCEPTED_CORPUS_SHA256 =
  "2658993bb79e56bf5dfbc1cc762786fdd25b52afe0b63c5ffb1c0b1deb132f57";
const SEEDED_WRITABLE_PATHS = new Set(["src/refund.ts", "tests/refund.test.mjs"]);
const SEEDED_TEST_PATH = "tests/refund.test.mjs";
const SEEDED_DEFECT_IDS = new Set([
  "DAY_14_INCLUSIVE",
  "USAGE_2000_INCLUSIVE",
  "FINAL_SALE_PRECEDENCE",
  "PROMOTION_ELIGIBILITY_BYPASS",
  "UNCLASSIFIED",
]);

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

const MAX_COMMAND_OUTPUT_LENGTH = 20_000;

function workerOutputText(value: unknown, label: string): string {
  const result = text(value, label);
  if (result.length > MAX_COMMAND_OUTPUT_LENGTH) {
    throw new Error(`${label} exceeds the ${MAX_COMMAND_OUTPUT_LENGTH}-character limit.`);
  }
  return assertNoSensitiveWorkerText(result, label, MAX_COMMAND_OUTPUT_LENGTH);
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

function boundedString(value: unknown, label: string, maximum: number): string {
  const result = string(value, label);
  if (result.length > maximum) {
    throw new Error(`${label} exceeds the ${maximum}-character limit.`);
  }
  return result;
}

function modelText(value: unknown, label: string, maximum = 4_096): string {
  const result = boundedString(value, label, maximum);
  return assertNoSensitiveWorkerText(result, label, maximum);
}

function modelTextArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error(`${label} must be an array with at most 64 items.`);
  }
  return value.map((item, index) => modelText(item, `${label}[${index}]`));
}

function pathArray(value: unknown, label: string): string[] {
  const paths = stringArray(value, label).map((item, index) =>
    assertSafeRelativePath(
      assertNoSensitiveWorkerText(item, `${label}[${index}]`, 512),
      `${label}[${index}]`,
    ),
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
    [
      "executionMode",
      "backendId",
      "sdkVersion",
      "model",
      "modelReasoningEffort",
      "promptTemplateSha256",
      "requestSha256",
      "outputSchemaSha256",
      "runId",
      "startedAt",
      "completedAt",
    ],
    "metadata",
  );
  if (!WORKER_EXECUTION_MODES.includes(result.executionMode as WorkerExecutionMode)) {
    throw new Error("metadata.executionMode is invalid.");
  }
  const executionMode = result.executionMode as WorkerExecutionMode;
  if (expectedMode !== undefined && executionMode !== expectedMode) {
    throw new Error(`Worker result mode ${executionMode} does not match backend mode ${expectedMode}.`);
  }
  if (!WORKER_REASONING_EFFORTS.includes(result.modelReasoningEffort as never)) {
    throw new Error("metadata.modelReasoningEffort is invalid.");
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
    sdkVersion: string(result.sdkVersion, "metadata.sdkVersion"),
    model: string(result.model, "metadata.model"),
    modelReasoningEffort: result.modelReasoningEffort as WorkerRunMetadata["modelReasoningEffort"],
    promptTemplateSha256: sha256(
      result.promptTemplateSha256,
      "metadata.promptTemplateSha256",
    ),
    requestSha256: sha256(result.requestSha256, "metadata.requestSha256"),
    outputSchemaSha256: sha256(result.outputSchemaSha256, "metadata.outputSchemaSha256"),
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
    file: assertSafeRelativePath(
      modelText(result.file, `${label}.file`, 512),
      `${label}.file`,
    ),
    lineStart,
    lineEnd,
    symbol: modelText(result.symbol, `${label}.symbol`, 256),
    reason: modelText(result.reason, `${label}.reason`, 2_048),
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

function parseDriftWitness(value: unknown, index: number): RepairDriftWitness {
  const label = `repair input.failingDriftWitnesses[${index}]`;
  const result = record(value, label);
  exactKeys(
    result,
    [
      "caseId",
      "input",
      "expectedDecision",
      "actualDecision",
      "defectIds",
      "relatedClauseIds",
      "relatedRuleIds",
    ],
    label,
  );
  if (!isDecision(result.expectedDecision) || !isDecision(result.actualDecision)) {
    throw new Error(`${label} decisions must be ALLOW, DENY, or REVIEW.`);
  }
  if (result.expectedDecision === result.actualDecision) {
    throw new Error(`${label} must describe an actual policy drift.`);
  }
  const defectIds = stringArray(result.defectIds, `${label}.defectIds`);
  if (
    defectIds.length === 0 ||
    new Set(defectIds).size !== defectIds.length ||
    defectIds.some((defectId) => !SEEDED_DEFECT_IDS.has(defectId))
  ) {
    throw new Error(`${label}.defectIds must be a non-empty unique supported set.`);
  }
  return {
    caseId: string(result.caseId, `${label}.caseId`),
    input: parseRefundPolicyInput(result.input),
    expectedDecision: result.expectedDecision,
    actualDecision: result.actualDecision,
    defectIds: defectIds as RepairDriftWitness["defectIds"],
    relatedClauseIds: stringArray(result.relatedClauseIds, `${label}.relatedClauseIds`),
    relatedRuleIds: stringArray(result.relatedRuleIds, `${label}.relatedRuleIds`),
  };
}

export function parseRepairWorkerInput(value: unknown): RepairWorkerInput {
  const result = record(value, "repair input");
  exactKeys(
    result,
    [
      "policyId",
      "policyVersion",
      "fixtureId",
      "sourcePolicy",
      "policySummary",
      "acceptedPolicyIr",
      "acceptedCases",
      "failingCaseIds",
      "failingDriftWitnesses",
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
  const sourcePolicy = boundedString(
    result.sourcePolicy,
    "repair input.sourcePolicy",
    MAX_SOURCE_POLICY_LENGTH,
  );
  const policySummary = boundedString(
    result.policySummary,
    "repair input.policySummary",
    MAX_POLICY_SUMMARY_LENGTH,
  );
  const acceptedPolicyIrJson = JSON.stringify(result.acceptedPolicyIr);
  if (
    acceptedPolicyIrJson === undefined ||
    acceptedPolicyIrJson.length > MAX_POLICY_IR_JSON_LENGTH
  ) {
    throw new Error("repair input.acceptedPolicyIr exceeds the JSON size limit.");
  }
  const acceptedPolicyIr = parsePolicyIR(result.acceptedPolicyIr);
  const policyId = string(result.policyId, "repair input.policyId");
  const policyVersion = integer(result.policyVersion, "repair input.policyVersion", 1);
  if (acceptedPolicyIr.policyId !== policyId || acceptedPolicyIr.version !== policyVersion) {
    throw new Error("Repair input policy identity does not match the accepted PolicyIR.");
  }
  const sourceClauses = segmentPolicyClauses(sourcePolicy);
  if (
    sourceClauses.length !== acceptedPolicyIr.clauses.length ||
    sourceClauses.some((clause, index) => {
      const accepted = acceptedPolicyIr.clauses[index];
      return (
        accepted === undefined ||
        clause.id !== accepted.id ||
        clause.text !== accepted.text ||
        clause.startOffset !== accepted.startOffset ||
        clause.endOffset !== accepted.endOffset ||
        clause.normalizedText !== accepted.normalizedText
      );
    })
  ) {
    throw new Error("Repair input source policy does not match the accepted PolicyIR clauses.");
  }
  assertPolicyReadyToCompile(acceptedPolicyIr);
  const acceptedCasesJson = JSON.stringify(result.acceptedCases);
  if (
    acceptedCasesJson === undefined ||
    acceptedCasesJson.length > MAX_ACCEPTED_CASES_JSON_LENGTH
  ) {
    throw new Error("repair input.acceptedCases exceeds the JSON size limit.");
  }
  const acceptedCases = parsePolicyCases(result.acceptedCases, "repair input.acceptedCases");
  if (acceptedCases.length !== SEEDED_ACCEPTED_CASE_COUNT) {
    throw new Error(`Repair input must contain the exact ${SEEDED_ACCEPTED_CASE_COUNT}-case corpus.`);
  }
  const acceptedCorpusSha256 = createHash("sha256")
    .update(JSON.stringify(acceptedCases))
    .digest("hex");
  if (acceptedCorpusSha256 !== SEEDED_ACCEPTED_CORPUS_SHA256) {
    throw new Error("Repair input accepted cases do not match the server-owned seeded corpus.");
  }
  const contradictions = findGoldenContradictions(acceptedPolicyIr, acceptedCases);
  if (contradictions.length > 0) {
    throw new Error(
      `Repair input accepted cases contradict the accepted PolicyIR: ${contradictions
        .map((item) => item.caseId)
        .join(", ")}`,
    );
  }
  if (!Array.isArray(result.failingDriftWitnesses)) {
    throw new Error("repair input.failingDriftWitnesses must be an array.");
  }
  if (JSON.stringify(result.failingDriftWitnesses).length > MAX_DRIFT_WITNESSES_JSON_LENGTH) {
    throw new Error("repair input.failingDriftWitnesses exceeds the JSON size limit.");
  }
  const failingDriftWitnesses = result.failingDriftWitnesses.map(parseDriftWitness);
  if (failingDriftWitnesses.length === 0 || failingDriftWitnesses.length > 64) {
    throw new Error("Repair input must contain between 1 and 64 drift witnesses.");
  }
  const witnessIds = failingDriftWitnesses.map((witness) => witness.caseId);
  if (
    new Set(witnessIds).size !== witnessIds.length ||
    [...failingCaseIds].sort().join("\0") !== [...witnessIds].sort().join("\0")
  ) {
    throw new Error("Repair input failing case IDs must exactly match the drift witnesses.");
  }
  const clauseIds = new Set(acceptedPolicyIr.clauses.map((clause) => clause.id));
  const ruleIds = new Set(acceptedPolicyIr.rules.map((rule) => rule.id));
  for (const policyCase of acceptedCases) {
    if (
      policyCase.relatedClauseIds.length === 0 ||
      policyCase.relatedClauseIds.some((clauseId) => !clauseIds.has(clauseId)) ||
      policyCase.relatedRuleIds.some((ruleId) => !ruleIds.has(ruleId))
    ) {
      throw new Error(`Accepted case ${policyCase.id} has invalid policy traceability.`);
    }
  }
  const acceptedCaseById = new Map(acceptedCases.map((policyCase) => [policyCase.id, policyCase]));
  for (const witness of failingDriftWitnesses) {
    if (
      witness.relatedClauseIds.length === 0 ||
      witness.relatedClauseIds.some((clauseId) => !clauseIds.has(clauseId)) ||
      witness.relatedRuleIds.length === 0 ||
      witness.relatedRuleIds.some((ruleId) => !ruleIds.has(ruleId))
    ) {
      throw new Error(`Drift witness ${witness.caseId} has invalid policy traceability.`);
    }
    const acceptedCase = acceptedCaseById.get(witness.caseId);
    if (
      acceptedCase === undefined ||
      JSON.stringify(acceptedCase.input) !== JSON.stringify(witness.input) ||
      acceptedCase.expectedDecision !== witness.expectedDecision ||
      JSON.stringify(acceptedCase.relatedClauseIds) !== JSON.stringify(witness.relatedClauseIds) ||
      JSON.stringify(acceptedCase.relatedRuleIds) !== JSON.stringify(witness.relatedRuleIds)
    ) {
      throw new Error(
        `Drift witness ${witness.caseId} must exactly match its accepted case input, decision, and traceability.`,
      );
    }
  }
  return {
    policyId,
    policyVersion,
    fixtureId: "seeded-refund-demo",
    sourcePolicy,
    policySummary,
    acceptedPolicyIr,
    acceptedCases,
    failingCaseIds,
    failingDriftWitnesses,
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
      "dataFlow",
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
  const dataFlow = parseLocations(result.dataFlow, "cartography.dataFlow");
  const testFiles = pathArray(result.testFiles, "cartography.testFiles");
  const proposedFilesToChange = pathArray(
    result.proposedFilesToChange,
    "cartography.proposedFilesToChange",
  );
  const entryPoints = parseLocations(result.entryPoints, "cartography.entryPoints");
  if (
    entryPoints.length === 0 ||
    policyLogicLocations.length === 0 ||
    dataFlow.length === 0 ||
    testFiles.length === 0
  ) {
    throw new Error("Cartography must identify entry points, policy logic, data flow, and tests.");
  }
  const knownFiles = new Set(relevantFiles);
  for (const path of [
    ...entryPoints.map((item) => item.file),
    ...policyLogicLocations.map((item) => item.file),
    ...dataFlow.map((item) => item.file),
    ...testFiles,
    ...proposedFilesToChange,
  ]) {
    if (!knownFiles.has(path)) {
      throw new Error(`Cartography references a file outside relevantFiles: ${path}`);
    }
  }
  if (
    testFiles.length !== 1 ||
    testFiles[0] !== SEEDED_TEST_PATH ||
    proposedFilesToChange.length !== SEEDED_WRITABLE_PATHS.size ||
    proposedFilesToChange.some((path) => !SEEDED_WRITABLE_PATHS.has(path)) ||
    [...SEEDED_WRITABLE_PATHS].some((path) => !proposedFilesToChange.includes(path))
  ) {
    throw new Error(
      "Cartography write and test paths must stay inside the server-owned seeded fixture allowlist.",
    );
  }
  return {
    schemaVersion: "1",
    phase: "CARTOGRAPHY",
    metadata: parseMetadata(result.metadata, expectedMode),
    relevantFiles,
    entryPoints,
    policyLogicLocations,
    dataFlow,
    testFiles,
    risks: modelTextArray(result.risks, "cartography.risks"),
    proposedFilesToChange,
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
  return {
    schemaVersion: "1",
    phase: "REPAIR",
    metadata: parseMetadata(result.metadata, expectedMode),
    changedFiles,
    summary: modelText(result.summary, "repair.summary"),
    rationale: modelTextArray(result.rationale, "repair.rationale"),
    remainingRisks: modelTextArray(result.remainingRisks, "repair.remainingRisks"),
    verificationCommandIds: parseCommandIds(
      result.verificationCommandIds,
      "repair.verificationCommandIds",
    ),
  };
}

export function parseCommandResult(value: unknown): CommandResult {
  const result = record(value, "command result");
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
      "fixtureTreeBeforeSha256",
      "fixtureTreeAfterSha256",
    ],
    "command result",
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
    stdout: workerOutputText(result.stdout, "command evidence.stdout"),
    stderr: workerOutputText(result.stderr, "command evidence.stderr"),
    outputTruncated: result.outputTruncated,
    fixtureTreeBeforeSha256: sha256(
      result.fixtureTreeBeforeSha256,
      "command result.fixtureTreeBeforeSha256",
    ),
    fixtureTreeAfterSha256: sha256(
      result.fixtureTreeAfterSha256,
      "command result.fixtureTreeAfterSha256",
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
      "fixtureTreeBeforeSha256",
      "fixtureTreeAfterSha256",
      "attempt",
      "repairRunId",
    ],
    "command evidence",
  );
  const commandResult = parseCommandResult({
    schemaVersion: result.schemaVersion,
    commandId: result.commandId,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    outputTruncated: result.outputTruncated,
    fixtureTreeBeforeSha256: result.fixtureTreeBeforeSha256,
    fixtureTreeAfterSha256: result.fixtureTreeAfterSha256,
  });
  const attempt = integer(result.attempt, "command evidence.attempt", 1);
  if (attempt !== 1 && attempt !== 2) {
    throw new Error("Command evidence attempt must be one or two.");
  }
  return {
    ...commandResult,
    attempt,
    repairRunId: string(result.repairRunId, "command evidence.repairRunId"),
  };
}

export function parsePolicyVerificationEvidence(value: unknown): PolicyVerificationEvidence {
  const result = record(value, "policy verification evidence");
  exactKeys(
    result,
    [
      "schemaVersion",
      "executionMode",
      "attempt",
      "repairRunId",
      "fixtureTreeSha256",
      "acceptedCorpusSha256",
      "policyIrSha256",
      "status",
      "total",
      "passed",
      "results",
    ],
    "policy verification evidence",
  );
  if (
    result.schemaVersion !== "1" ||
    result.executionMode !== "SERVER_OWNED_CORPUS" ||
    (result.status !== "PASS" && result.status !== "FAIL")
  ) {
    throw new Error("Policy verification contract version, execution mode, or status is invalid.");
  }
  if (!Array.isArray(result.results) || result.results.length !== SEEDED_ACCEPTED_CASE_COUNT) {
    throw new Error(
      `Policy verification results must contain the exact ${SEEDED_ACCEPTED_CASE_COUNT}-case corpus.`,
    );
  }
  const results = result.results.map((value, index) => {
    const label = `policy verification evidence.results[${index}]`;
    const item = record(value, label);
    exactKeys(
      item,
      ["caseId", "expectedDecision", "actualDecision", "status", "error"],
      label,
    );
    if (!isDecision(item.expectedDecision)) {
      throw new Error(`${label}.expectedDecision is invalid.`);
    }
    if (item.status !== "PASS" && item.status !== "FAIL" && item.status !== "ERROR") {
      throw new Error(`${label}.status is invalid.`);
    }
    let error: string | null;
    if (item.status === "ERROR") {
      if (item.actualDecision !== null || typeof item.error !== "string" || item.error.trim() === "") {
        throw new Error(`${label} ERROR results require a non-empty error and null decision.`);
      }
      error = modelText(item.error, `${label}.error`, 2_048);
    } else {
      if (!isDecision(item.actualDecision) || item.error !== null) {
        throw new Error(`${label} PASS/FAIL results require a decision and null error.`);
      }
      const decisionsMatch = item.actualDecision === item.expectedDecision;
      if ((item.status === "PASS") !== decisionsMatch) {
        throw new Error(`${label}.status must agree with the expected and actual decisions.`);
      }
      error = null;
    }
    return {
      caseId: string(item.caseId, `${label}.caseId`),
      expectedDecision: item.expectedDecision,
      actualDecision: item.actualDecision,
      status: item.status,
      error,
    } satisfies PolicyVerificationCaseResult;
  });
  if (new Set(results.map((item) => item.caseId)).size !== results.length) {
    throw new Error("Policy verification case IDs must be unique.");
  }
  const total = integer(result.total, "policy verification evidence.total", 1);
  const passed = integer(result.passed, "policy verification evidence.passed");
  const actualPassed = results.filter((item) => item.status === "PASS").length;
  if (total !== results.length || passed !== actualPassed || passed > total) {
    throw new Error("Policy verification totals do not match the case results.");
  }
  const allPassed = passed === total;
  if ((result.status === "PASS") !== allPassed) {
    throw new Error("Policy verification status must agree with the aggregate results.");
  }
  const attempt = integer(result.attempt, "policy verification evidence.attempt", 1);
  if (attempt !== 1 && attempt !== 2) {
    throw new Error("Policy verification attempt must be one or two.");
  }
  return {
    schemaVersion: "1",
    executionMode: "SERVER_OWNED_CORPUS",
    attempt,
    repairRunId: string(result.repairRunId, "policy verification evidence.repairRunId"),
    fixtureTreeSha256: sha256(
      result.fixtureTreeSha256,
      "policy verification evidence.fixtureTreeSha256",
    ),
    acceptedCorpusSha256: sha256(
      result.acceptedCorpusSha256,
      "policy verification evidence.acceptedCorpusSha256",
    ),
    policyIrSha256: sha256(
      result.policyIrSha256,
      "policy verification evidence.policyIrSha256",
    ),
    status: result.status,
    total,
    passed,
    results,
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
    id: modelText(result.id, `${label}.id`, 256),
    severity: result.severity as ReviewFinding["severity"],
    title: modelText(result.title, `${label}.title`, 512),
    description: modelText(result.description, `${label}.description`),
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
    summary: modelText(result.summary, "review.summary"),
    findings,
  };
}
