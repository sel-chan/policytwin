import { orchestrateRepair } from "./orchestrate.js";
import { assertNoSensitiveWorkerText } from "./safety.js";
import type {
  CodexWorkerBackend,
  PolicyVerificationRunner,
  RepairCommandRunner,
  RepairWorkerReport,
} from "./types.js";
import {
  canonicalWorkerRpcJson,
  parseWorkerRpcV2Request,
  workerRpcSha256,
  type WorkerRpcV2Request,
} from "./worker-rpc-contract.js";

export interface UnsignedWorkerExecutionPorts {
  backend: CodexWorkerBackend;
  runCommand: RepairCommandRunner;
  verifyPolicyCorpus: PolicyVerificationRunner;
  now?: () => Date;
}

export interface UnsignedWorkerExecutionCandidate {
  schemaVersion: "1";
  kind: "UNSIGNED_WORKER_EXECUTION_CANDIDATE";
  provenance: "UNVERIFIED_INJECTED_BACKEND";
  requestId: string;
  requestSha256: string;
  inputSha256: string;
  policySha256: string;
  executionBindingSha256: string;
  reportSha256: string;
  report: RepairWorkerReport;
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

function validatePorts(value: UnsignedWorkerExecutionPorts): UnsignedWorkerExecutionPorts {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("Unsigned worker execution ports are invalid.");
  }
  const allowed = new Set(["backend", "runCommand", "verifyPolicyCorpus", "now"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Unsigned worker execution ports contain unknown fields.");
  }
  if (
    typeof value.backend !== "object" ||
    value.backend === null ||
    typeof value.backend.cartograph !== "function" ||
    typeof value.backend.repair !== "function" ||
    typeof value.backend.review !== "function" ||
    typeof value.runCommand !== "function" ||
    typeof value.verifyPolicyCorpus !== "function" ||
    (value.now !== undefined && typeof value.now !== "function")
  ) {
    throw new Error("Unsigned worker execution ports are incomplete.");
  }
  if (value.backend.executionMode !== "OFFLINE_TEST_DOUBLE") {
    throw new Error("Unsigned worker execution accepts only an offline test-double backend.");
  }
  return value;
}

function readClock(now: () => Date): number {
  let observed: Date;
  try {
    observed = now();
  } catch {
    throw new Error("Unsigned worker execution clock failed.");
  }
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) {
    throw new Error("Unsigned worker execution clock is invalid.");
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

function assertOfflineBackend(backend: CodexWorkerBackend): void {
  if (backend.executionMode !== "OFFLINE_TEST_DOUBLE") {
    throw new Error("Unsigned worker execution backend changed its offline test-double mode.");
  }
}

function assertSafeReportStrings(
  value: unknown,
  state: { nodes: number; bytes: number },
  depth = 0,
): void {
  state.nodes += 1;
  if (depth > 64 || state.nodes > 50_000) {
    throw new Error("Unsigned worker report exceeds structural limits.");
  }
  if (typeof value === "string") {
    state.bytes += Buffer.byteLength(value, "utf8");
    if (state.bytes > 4 * 1024 * 1024) {
      throw new Error("Unsigned worker report exceeds the text byte limit.");
    }
    assertNoSensitiveWorkerText(value, "unsigned worker report string", 4 * 1024 * 1024);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertSafeReportStrings(child, state, depth + 1);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      assertSafeReportStrings(child, state, depth + 1);
    }
  }
}

export async function executeUnsignedWorkerRepairCandidate(
  value: unknown,
  portsValue: UnsignedWorkerExecutionPorts,
): Promise<UnsignedWorkerExecutionCandidate> {
  const ports = validatePorts(portsValue);
  const backendPort = ports.backend;
  const runCommandPort = ports.runCommand;
  const verifyPolicyCorpusPort = ports.verifyPolicyCorpus;
  const request = deepFreeze(parseWorkerRpcV2Request(value));
  const requestSha256 = workerRpcSha256(request);
  const now = ports.now ?? (() => new Date());

  function assertRequestAuthority(): void {
    let observedSha256: string;
    try {
      observedSha256 = workerRpcSha256(parseWorkerRpcV2Request(value));
    } catch {
      throw new Error("Worker RPC v2 request changed during unsigned execution.");
    }
    if (observedSha256 !== requestSha256) {
      throw new Error("Worker RPC v2 request changed during unsigned execution.");
    }
    assertActive(request, now);
    assertOfflineBackend(backendPort);
  }

  assertRequestAuthority();
  let commandCallCount = 0;
  let corpusCallCount = 0;
  const backend: CodexWorkerBackend = {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph(context) {
      assertRequestAuthority();
      if (workerRpcSha256(context.input) !== request.inputSha256) {
        throw new Error("Cartography input is not bound to the Worker RPC v2 request.");
      }
      const result = await backendPort.cartograph(context);
      assertRequestAuthority();
      return result;
    },
    async repair(context) {
      assertRequestAuthority();
      if (workerRpcSha256(context.input) !== request.inputSha256) {
        throw new Error("Repair input is not bound to the Worker RPC v2 request.");
      }
      const result = await backendPort.repair(context);
      assertRequestAuthority();
      return result;
    },
    async review(context) {
      assertRequestAuthority();
      if (
        workerRpcSha256(context.input) !== request.inputSha256 ||
        corpusCallCount < 1 ||
        commandCallCount !== corpusCallCount * 2
      ) {
        throw new Error("Review is not bound to a completed verifier-owned corpus receipt.");
      }
      const result = await backendPort.review(context);
      assertRequestAuthority();
      return result;
    },
  };

  const runCommand: RepairCommandRunner = async (commandId) => {
    assertRequestAuthority();
    const expected = commandCallCount % 2 === 0 ? "fixture-typecheck" : "fixture-test";
    if (commandId !== expected) {
      throw new Error(`Unsigned verification command order is invalid: expected ${expected}.`);
    }
    commandCallCount += 1;
    const result = await runCommandPort(commandId);
    assertRequestAuthority();
    return result;
  };

  const verifyPolicyCorpus: PolicyVerificationRunner = async (input, context) => {
    assertRequestAuthority();
    if (
      workerRpcSha256(input) !== request.inputSha256 ||
      commandCallCount !== (corpusCallCount + 1) * 2
    ) {
      throw new Error("Policy corpus verification is not bound to one ordered command batch.");
    }
    const result = await verifyPolicyCorpusPort(input, context);
    corpusCallCount += 1;
    assertRequestAuthority();
    return result;
  };

  const report = await orchestrateRepair(request.input, backend, runCommand, verifyPolicyCorpus);
  assertRequestAuthority();
  if (report.executionMode !== "OFFLINE_TEST_DOUBLE") {
    throw new Error("Unsigned worker report crossed the offline execution boundary.");
  }
  try {
    const canonicalReport = canonicalWorkerRpcJson(report);
    if (Buffer.byteLength(canonicalReport, "utf8") > 4 * 1024 * 1024) {
      throw new Error("Unsigned worker report exceeds the canonical byte limit.");
    }
    assertNoSensitiveWorkerText(
      canonicalReport,
      "unsigned worker execution report",
      4 * 1024 * 1024,
    );
    assertSafeReportStrings(report, { nodes: 0, bytes: 0 });
  } catch {
    throw new Error("Unsigned worker report contains prohibited sensitive content.");
  }
  const reportSha256 = workerRpcSha256(report);
  return deepFreeze({
    schemaVersion: "1",
    kind: "UNSIGNED_WORKER_EXECUTION_CANDIDATE",
    provenance: "UNVERIFIED_INJECTED_BACKEND",
    requestId: request.requestId,
    requestSha256,
    inputSha256: request.inputSha256,
    policySha256: request.policySha256,
    executionBindingSha256: request.executionBindingSha256,
    reportSha256,
    report,
    liveClaim: false,
    passSigningEligible: false,
    externalSettlementEligible: false,
  });
}
