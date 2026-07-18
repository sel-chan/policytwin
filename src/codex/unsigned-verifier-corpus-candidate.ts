import { isDecision, type Decision } from "../domain/decision.js";
import type { RefundPolicyInput } from "../domain/refund.js";
import { assertNoSensitiveWorkerText } from "./safety.js";
import type { CommandEvidence } from "./types.js";
import { parseCommandEvidence } from "./validate.js";
import {
  acceptedCorpusSha256,
  canonicalWorkerRpcJson,
  parseWorkerRpcV2Request,
  workerRpcSha256,
  type WorkerRpcV2Request,
} from "./worker-rpc-contract.js";

const CONTRACT_PROFILE = Object.freeze({
  domain: "policytwin.verifier.corpus.candidate.v1",
  schemaVersion: "1",
  provenance: "UNVERIFIED_INJECTED_EVALUATOR",
  commandTranscriptAuthority: "UNVERIFIED_CALLER_SUPPLIED",
  treeObservationAuthority: "UNVERIFIED_CALLER_SUPPLIED",
  attemptRunAuthority: "UNVERIFIED_CALLER_SUPPLIED",
  timeObservationAuthority: "UNVERIFIED_CALLER_SUPPLIED",
  commandIds: Object.freeze(["fixture-typecheck", "fixture-test"]),
  exactAcceptedCaseCount: 41,
  liveClaim: false,
  passSigningEligible: false,
  externalSettlementEligible: false,
});
const CONTRACT_SHA256 = workerRpcSha256(CONTRACT_PROFILE);
const SHA256 = /^[0-9a-f]{64}$/u;
const REPAIR_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_CANDIDATE_BYTES = 4 * 1024 * 1024;

export interface UnsignedVerifierCorpusBinding {
  schemaVersion: "1";
  attempt: 1 | 2;
  repairRunId: string;
  commandEvidence: [CommandEvidence, CommandEvidence];
}

export interface UnsignedVerifierCorpusPorts {
  evaluate(input: RefundPolicyInput): unknown;
  now?: () => Date;
}

export interface UnsignedVerifierCorpusCaseResult {
  caseId: string;
  inputSha256: string;
  expectedDecision: Decision;
  actualDecision: Decision | null;
  status: "MATCH" | "MISMATCH" | "ERROR";
  error: string | null;
}

export interface UnsignedVerifierCorpusCandidate {
  schemaVersion: "1";
  kind: "UNSIGNED_VERIFIER_CORPUS_CANDIDATE";
  provenance: "UNVERIFIED_INJECTED_EVALUATOR";
  commandTranscriptAuthority: "UNVERIFIED_CALLER_SUPPLIED";
  treeObservationAuthority: "UNVERIFIED_CALLER_SUPPLIED";
  attemptRunAuthority: "UNVERIFIED_CALLER_SUPPLIED";
  timeObservationAuthority: "UNVERIFIED_CALLER_SUPPLIED";
  contractSha256: string;
  requestId: string;
  requestSha256: string;
  inputSha256: string;
  policySha256: string;
  executionBindingSha256: string;
  attempt: 1 | 2;
  repairRunId: string;
  preTypecheckTreeSha256: string;
  callerObservedStableTreeSha256: string;
  acceptedCorpusSha256: string;
  policyIrSha256: string;
  commandTranscriptSha256: string;
  unverifiedInputBindingSha256: string;
  resultsSha256: string;
  unverifiedResultBindingSha256: string;
  outcome: "UNVERIFIED_ALL_CASES_MATCH" | "UNVERIFIED_MISMATCH_OR_ERROR";
  total: number;
  matched: number;
  results: UnsignedVerifierCorpusCaseResult[];
  liveClaim: false;
  passSigningEligible: false;
  externalSettlementEligible: false;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} contains unknown fields.`);
  }
}

function parseBinding(value: unknown): UnsignedVerifierCorpusBinding {
  const result = plainRecord(value, "Unsigned verifier corpus binding");
  exactKeys(
    result,
    ["schemaVersion", "attempt", "repairRunId", "commandEvidence"],
    "Unsigned verifier corpus binding",
  );
  if (
    result.schemaVersion !== "1" ||
    (result.attempt !== 1 && result.attempt !== 2) ||
    typeof result.repairRunId !== "string" ||
    !REPAIR_RUN_ID.test(result.repairRunId) ||
    !Array.isArray(result.commandEvidence) ||
    result.commandEvidence.length !== 2
  ) {
    throw new Error("Unsigned verifier corpus binding is incomplete.");
  }
  const commands = result.commandEvidence.map((item) => parseCommandEvidence(item)) as [
    CommandEvidence,
    CommandEvidence,
  ];
  for (const command of commands) {
    if (
      command.attempt !== result.attempt ||
      command.repairRunId !== result.repairRunId ||
      command.exitCode !== 0 ||
      command.timedOut ||
      command.outputTruncated
    ) {
      throw new Error("Unsigned verifier command evidence is not admissible to the candidate.");
    }
    try {
      assertNoSensitiveWorkerText(
        command.stdout,
        "unsigned verifier command stdout",
        2 * 1024 * 1024,
      );
      assertNoSensitiveWorkerText(
        command.stderr,
        "unsigned verifier command stderr",
        2 * 1024 * 1024,
      );
    } catch {
      throw new Error("Unsigned verifier command evidence contains sensitive content.");
    }
  }
  const [typecheck, fixtureTest] = commands;
  if (
    typecheck.commandId !== "fixture-typecheck" ||
    fixtureTest.commandId !== "fixture-test" ||
    typecheck.fixtureTreeBeforeSha256 !== typecheck.fixtureTreeAfterSha256 ||
    typecheck.fixtureTreeAfterSha256 !== fixtureTest.fixtureTreeBeforeSha256 ||
    fixtureTest.fixtureTreeBeforeSha256 !== fixtureTest.fixtureTreeAfterSha256
  ) {
    throw new Error("Unsigned verifier command order or tree transcript is invalid.");
  }
  return {
    schemaVersion: "1",
    attempt: result.attempt,
    repairRunId: result.repairRunId,
    commandEvidence: commands,
  };
}

function parsePorts(value: UnsignedVerifierCorpusPorts): UnsignedVerifierCorpusPorts {
  const result = plainRecord(value, "Unsigned verifier corpus ports");
  const allowed = new Set(["evaluate", "now"]);
  if (Object.keys(result).some((key) => !allowed.has(key))) {
    throw new Error("Unsigned verifier corpus ports contain unknown fields.");
  }
  if (
    typeof result.evaluate !== "function" ||
    (result.now !== undefined && typeof result.now !== "function")
  ) {
    throw new Error("Unsigned verifier corpus ports are incomplete.");
  }
  const evaluate = result.evaluate as UnsignedVerifierCorpusPorts["evaluate"];
  return typeof result.now === "function"
    ? { evaluate, now: result.now as () => Date }
    : { evaluate };
}

function policyIrSha256(request: WorkerRpcV2Request): string {
  return workerRpcSha256(request.input.acceptedPolicyIr);
}

function readClock(now: () => Date): number {
  let observed: Date;
  try {
    observed = now();
  } catch {
    throw new Error("Unsigned verifier clock failed.");
  }
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) {
    throw new Error("Unsigned verifier clock is invalid.");
  }
  return observed.getTime();
}

function assertActive(request: WorkerRpcV2Request, now: () => Date): void {
  const observed = readClock(now);
  if (observed < Date.parse(request.issuedAt)) {
    throw new Error("Worker RPC v2 request is not active yet.");
  }
  if (observed >= Date.parse(request.expiresAt)) {
    throw new Error("Worker RPC v2 request has expired.");
  }
}

function assertSafeStrings(
  value: unknown,
  state: { nodes: number; bytes: number },
  depth = 0,
): void {
  state.nodes += 1;
  if (depth > 64 || state.nodes > 50_000) {
    throw new Error("Unsigned verifier candidate exceeds structural limits.");
  }
  if (typeof value === "string") {
    state.bytes += Buffer.byteLength(value, "utf8");
    if (state.bytes > MAX_CANDIDATE_BYTES) {
      throw new Error("Unsigned verifier candidate exceeds the text byte limit.");
    }
    assertNoSensitiveWorkerText(value, "unsigned verifier candidate string", MAX_CANDIDATE_BYTES);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertSafeStrings(child, state, depth + 1);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) assertSafeStrings(child, state, depth + 1);
  }
}

export async function executeUnsignedVerifierCorpusCandidate(
  requestValue: unknown,
  bindingValue: unknown,
  portsValue: UnsignedVerifierCorpusPorts,
): Promise<UnsignedVerifierCorpusCandidate> {
  const ports = parsePorts(portsValue);
  const evaluate = ports.evaluate;
  const now = ports.now ?? (() => new Date());
  const request = deepFreeze(parseWorkerRpcV2Request(requestValue));
  const binding = deepFreeze(parseBinding(bindingValue));
  const requestSha256 = workerRpcSha256(request);
  const bindingInputSha256 = workerRpcSha256(binding);

  function assertAuthority(): void {
    try {
      const observedRequest = parseWorkerRpcV2Request(requestValue);
      const observedBinding = parseBinding(bindingValue);
      if (
        workerRpcSha256(observedRequest) !== requestSha256 ||
        workerRpcSha256(observedBinding) !== bindingInputSha256
      ) {
        throw new Error("changed");
      }
    } catch {
      throw new Error("Request or binding changed during unsigned verifier evaluation.");
    }
    assertActive(request, now);
  }

  assertAuthority();
  const [typecheck, fixtureTest] = binding.commandEvidence;
  if (binding.attempt > request.input.maxRepairAttempts) {
    throw new Error("Unsigned verifier attempt exceeds the Worker RPC v2 repair limit.");
  }
  const corpusSha256 = acceptedCorpusSha256(request.input);
  if (corpusSha256 !== request.policy.acceptedCorpusSha256) {
    throw new Error("Unsigned verifier corpus is not bound to the Worker RPC v2 request.");
  }
  const policyDigest = policyIrSha256(request);
  const commandTranscriptSha256 = workerRpcSha256(binding.commandEvidence);
  const unverifiedInputBindingSha256 = workerRpcSha256({
    domain: "policytwin.verifier.corpus.unverified-input-binding.v1",
    contractSha256: CONTRACT_SHA256,
    requestId: request.requestId,
    requestSha256,
    inputSha256: request.inputSha256,
    policySha256: request.policySha256,
    executionBindingSha256: request.executionBindingSha256,
    attempt: binding.attempt,
    repairRunId: binding.repairRunId,
    preTypecheckTreeSha256: typecheck.fixtureTreeBeforeSha256,
    callerObservedStableTreeSha256: fixtureTest.fixtureTreeAfterSha256,
    acceptedCorpusSha256: corpusSha256,
    policyIrSha256: policyDigest,
    commandTranscriptSha256,
  });

  const results: UnsignedVerifierCorpusCaseResult[] = [];
  for (const policyCase of request.input.acceptedCases) {
    assertAuthority();
    let result: UnsignedVerifierCorpusCaseResult;
    try {
      const actualDecision = evaluate(structuredClone(policyCase.input));
      if (!isDecision(actualDecision)) {
        throw new Error("invalid decision");
      }
      result = {
        caseId: policyCase.id,
        inputSha256: workerRpcSha256(policyCase.input),
        expectedDecision: policyCase.expectedDecision,
        actualDecision,
        status: actualDecision === policyCase.expectedDecision ? "MATCH" : "MISMATCH",
        error: null,
      };
    } catch {
      result = {
        caseId: policyCase.id,
        inputSha256: workerRpcSha256(policyCase.input),
        expectedDecision: policyCase.expectedDecision,
        actualDecision: null,
        status: "ERROR",
        error: "The injected application evaluator failed for this accepted case.",
      };
    }
    assertAuthority();
    results.push(result);
  }
  assertAuthority();
  const matched = results.filter((result) => result.status === "MATCH").length;
  const outcome =
    matched === results.length
      ? "UNVERIFIED_ALL_CASES_MATCH"
      : "UNVERIFIED_MISMATCH_OR_ERROR";
  const resultsSha256 = workerRpcSha256(results);
  const unverifiedResultBindingSha256 = workerRpcSha256({
    domain: "policytwin.verifier.corpus.unverified-result-binding.v1",
    unverifiedInputBindingSha256,
    resultsSha256,
    outcome,
    total: results.length,
    matched,
  });
  const candidate: UnsignedVerifierCorpusCandidate = {
    schemaVersion: "1",
    kind: "UNSIGNED_VERIFIER_CORPUS_CANDIDATE",
    provenance: "UNVERIFIED_INJECTED_EVALUATOR",
    commandTranscriptAuthority: "UNVERIFIED_CALLER_SUPPLIED",
    treeObservationAuthority: "UNVERIFIED_CALLER_SUPPLIED",
    attemptRunAuthority: "UNVERIFIED_CALLER_SUPPLIED",
    timeObservationAuthority: "UNVERIFIED_CALLER_SUPPLIED",
    contractSha256: CONTRACT_SHA256,
    requestId: request.requestId,
    requestSha256,
    inputSha256: request.inputSha256,
    policySha256: request.policySha256,
    executionBindingSha256: request.executionBindingSha256,
    attempt: binding.attempt,
    repairRunId: binding.repairRunId,
    preTypecheckTreeSha256: typecheck.fixtureTreeBeforeSha256,
    callerObservedStableTreeSha256: fixtureTest.fixtureTreeAfterSha256,
    acceptedCorpusSha256: corpusSha256,
    policyIrSha256: policyDigest,
    commandTranscriptSha256,
    unverifiedInputBindingSha256,
    resultsSha256,
    unverifiedResultBindingSha256,
    outcome,
    total: results.length,
    matched,
    results,
    liveClaim: false,
    passSigningEligible: false,
    externalSettlementEligible: false,
  };
  if (
    !SHA256.test(candidate.contractSha256) ||
    !SHA256.test(candidate.unverifiedInputBindingSha256) ||
    !SHA256.test(candidate.unverifiedResultBindingSha256) ||
    candidate.total !== 41
  ) {
    throw new Error("Unsigned verifier candidate is internally inconsistent.");
  }
  try {
    const canonical = canonicalWorkerRpcJson(candidate);
    if (Buffer.byteLength(canonical, "utf8") > MAX_CANDIDATE_BYTES) {
      throw new Error("oversized");
    }
    assertSafeStrings(candidate, { nodes: 0, bytes: 0 });
  } catch {
    throw new Error("Unsigned verifier candidate contains prohibited sensitive content.");
  }
  assertAuthority();
  return deepFreeze(candidate);
}
