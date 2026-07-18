import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as policyTwin from "../../dist/index.js";
import {
  executeUnsignedWorkerRepairCandidate,
} from "../../dist/codex/unsigned-worker-execution-core.js";
import {
  acceptedCorpusSha256,
  parseWorkerRpcV2Request,
  parseWorkerRpcV2Response,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
  workerRpcV2ExecutionBindingSha256,
} from "../../dist/index.js";

const sourcePolicy = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const acceptedPolicyIr = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/policy-ir.json", import.meta.url), "utf8"),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/golden-cases.json", import.meta.url), "utf8"),
);
const generatedCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/generated-cases.json", import.meta.url), "utf8"),
);
const driftCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url),
    "utf8",
  ),
);

const acceptedCases = [...goldenCases, ...generatedCases];
const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
const defectsByCase = {
  D01: ["DAY_14_INCLUSIVE"],
  D02: ["USAGE_2000_INCLUSIVE"],
  D03: ["FINAL_SALE_PRECEDENCE"],
};
const input = {
  policyId: acceptedPolicyIr.policyId,
  policyVersion: 4,
  fixtureId: "seeded-refund-demo",
  sourcePolicy,
  policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
  acceptedPolicyIr,
  acceptedCases,
  failingCaseIds: ["D01", "D02", "D03"],
  failingDriftWitnesses: driftCases.map((policyCase) => ({
    caseId: policyCase.id,
    input: policyCase.input,
    expectedDecision: policyCase.expectedDecision,
    actualDecision: actualByCase[policyCase.id],
    defectIds: defectsByCase[policyCase.id],
    relatedClauseIds: policyCase.relatedClauseIds,
    relatedRuleIds: policyCase.relatedRuleIds,
  })),
  allowedCommandIds: ["fixture-typecheck", "fixture-test"],
  maxRepairAttempts: 1,
};

const baselineTreeManifest = {
  schemaVersion: "1",
  entries: [
    {
      path: ".",
      kind: "directory",
      mode: 16_877,
      mtimeMs: 1_700_000_000_000,
      sha256: null,
    },
    {
      path: "src",
      kind: "directory",
      mode: 16_877,
      mtimeMs: 1_700_000_000_001,
      sha256: null,
    },
    {
      path: "src/refund.ts",
      kind: "file",
      mode: 33_188,
      mtimeMs: 1_700_000_000_002,
      sha256: "1".repeat(64),
    },
    {
      path: "tests",
      kind: "directory",
      mode: 16_877,
      mtimeMs: 1_700_000_000_003,
      sha256: null,
    },
    {
      path: "tests/refund.test.mjs",
      kind: "file",
      mode: 33_188,
      mtimeMs: 1_700_000_000_004,
      sha256: "2".repeat(64),
    },
  ],
};
const model = "gpt-codex-test";
const finalTreeSha256 = "9".repeat(64);

function requestAt(issuedAt = "2026-07-18T10:00:00.000Z", expiresAt = "2026-07-18T10:05:00.000Z") {
  const policy = {
    schemaVersion: "1",
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: "3".repeat(64),
    baselineExecutionTreeSha256: workerRpcExecutionTreeSha256(baselineTreeManifest),
    baselineExecutionTreeManifest: baselineTreeManifest,
    acceptedCorpusSha256: acceptedCorpusSha256(input),
    workerImageDigest: `sha256:${"4".repeat(64)}`,
    sdkPackage: "@openai/codex-sdk",
    sdkVersion: "0.144.3",
    writablePaths: ["src/refund.ts", "tests/refund.test.mjs"],
    commandIds: ["fixture-typecheck", "fixture-test"],
    repairWorkspace: "DISPOSABLE_TWO_FILE_WRITESET",
    verificationWorkspace: "IMMUTABLE_RECONSTRUCTED",
    rootFilesystem: "READ_ONLY",
    codexApiEgress: "SUPERVISOR_OPENAI_PROXY_ONLY",
    fixtureProcessNetwork: "DISABLED",
    nonPrivileged: true,
    limits: {
      wallTimeMs: 300_000,
      cpuTimeMs: 120_000,
      memoryBytes: 1_073_741_824,
      pids: 64,
      outputBytes: 4_194_304,
    },
  };
  const requestId = "5".repeat(32);
  const runNonce = Buffer.alloc(32, 6).toString("base64url");
  const inputSha256 = workerRpcSha256(input);
  const policySha256 = workerRpcSha256(policy);
  return parseWorkerRpcV2Request({
    schemaVersion: "2",
    protocol: "policytwin.codex.repair.v2",
    action: "RUN_REPAIR",
    requestId,
    runNonce,
    sequence: 1,
    issuedAt,
    expiresAt,
    model,
    modelReasoningEffort: "high",
    inputSha256,
    policySha256,
    executionBindingSha256: workerRpcV2ExecutionBindingSha256({
      requestId,
      runNonce,
      model,
      inputSha256,
      policySha256,
    }),
    policy,
    input,
  });
}

function metadata(runId) {
  return {
    executionMode: "OFFLINE_TEST_DOUBLE",
    backendId: "unsigned-core-offline-double",
    sdkVersion: "not-applicable-offline-double",
    model: "offline-test-double",
    modelReasoningEffort: "high",
    promptTemplateSha256: "a".repeat(64),
    requestSha256: "b".repeat(64),
    outputSchemaSha256: "c".repeat(64),
    runId,
    startedAt: "2026-07-18T10:00:01.000Z",
    completedAt: "2026-07-18T10:00:02.000Z",
  };
}

function cartography() {
  return {
    schemaVersion: "1",
    phase: "CARTOGRAPHY",
    metadata: metadata("cartography-run"),
    relevantFiles: ["src/refund.ts", "tests/refund.test.mjs"],
    entryPoints: [
      {
        file: "src/refund.ts",
        lineStart: 12,
        lineEnd: 31,
        symbol: "decideRefund",
        reason: "Public refund decision entry point.",
      },
    ],
    policyLogicLocations: [
      {
        file: "src/refund.ts",
        lineStart: 13,
        lineEnd: 22,
        symbol: "decideRefund",
        reason: "Contains the policy boundaries and precedence.",
      },
    ],
    dataFlow: [
      {
        file: "src/refund.ts",
        lineStart: 12,
        lineEnd: 31,
        symbol: "decideRefund",
        reason: "Validated fields flow directly through the decision function.",
      },
    ],
    testFiles: ["tests/refund.test.mjs"],
    risks: ["Boundary and precedence defects need regression coverage."],
    proposedFilesToChange: ["src/refund.ts", "tests/refund.test.mjs"],
    verificationCommandIds: ["fixture-typecheck", "fixture-test"],
  };
}

function repair() {
  return {
    schemaVersion: "1",
    phase: "REPAIR",
    metadata: metadata("repair-run"),
    changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
    summary: "Corrected inclusive boundaries and final-sale precedence.",
    rationale: ["Match all supplied drift witnesses."],
    remainingRisks: [],
    verificationCommandIds: ["fixture-typecheck", "fixture-test"],
  };
}

function review() {
  return {
    schemaVersion: "1",
    phase: "REVIEW",
    metadata: metadata("review-run"),
    verdict: "APPROVE",
    summary: "The focused repair matches the accepted policy corpus.",
    findings: [],
  };
}

function commandEvidence(commandId) {
  return {
    schemaVersion: "1",
    commandId,
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    stdout: "ok",
    stderr: "",
    outputTruncated: false,
    fixtureTreeBeforeSha256:
      commandId === "fixture-typecheck" ? "8".repeat(64) : finalTreeSha256,
    fixtureTreeAfterSha256: finalTreeSha256,
  };
}

function policyEvidence(request, binding) {
  const results = request.input.acceptedCases.map((policyCase) => ({
    caseId: policyCase.id,
    expectedDecision: policyCase.expectedDecision,
    actualDecision: policyCase.expectedDecision,
    status: "PASS",
    error: null,
  }));
  return {
    schemaVersion: "1",
    executionMode: "SERVER_OWNED_CORPUS",
    attempt: binding.attempt,
    repairRunId: binding.repairRunId,
    fixtureTreeSha256: binding.fixtureTreeSha256,
    acceptedCorpusSha256: binding.acceptedCorpusSha256,
    policyIrSha256: binding.policyIrSha256,
    status: "PASS",
    total: results.length,
    passed: results.length,
    results,
  };
}

function offlineBackend(events, hook = undefined) {
  return {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      events.push("cartography");
      hook?.();
      return cartography();
    },
    async repair() {
      events.push("repair");
      return repair();
    },
    async review() {
      events.push("review");
      return review();
    },
  };
}

function portsFor(request, events, overrides = {}) {
  return {
    backend: overrides.backend ?? offlineBackend(events),
    async runCommand(commandId) {
      events.push(`command:${commandId}`);
      return commandEvidence(commandId);
    },
    async verifyPolicyCorpus(_input, binding) {
      events.push("policy-corpus");
      return policyEvidence(request, binding);
    },
    now: overrides.now ?? (() => new Date("2026-07-18T10:01:00.000Z")),
  };
}

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("v2 request produces only a deeply frozen unsigned offline candidate", async () => {
  const request = requestAt();
  const events = [];
  const candidate = await executeUnsignedWorkerRepairCandidate(
    request,
    portsFor(request, events),
  );

  assert.deepEqual(events, [
    "cartography",
    "repair",
    "command:fixture-typecheck",
    "command:fixture-test",
    "policy-corpus",
    "review",
  ]);
  assert.equal(candidate.schemaVersion, "1");
  assert.equal(candidate.kind, "UNSIGNED_WORKER_EXECUTION_CANDIDATE");
  assert.equal(candidate.provenance, "UNVERIFIED_INJECTED_BACKEND");
  assert.equal(candidate.requestId, request.requestId);
  assert.equal(candidate.requestSha256, workerRpcSha256(request));
  assert.equal(candidate.inputSha256, request.inputSha256);
  assert.equal(candidate.policySha256, request.policySha256);
  assert.equal(candidate.executionBindingSha256, request.executionBindingSha256);
  assert.equal(candidate.reportSha256, workerRpcSha256(candidate.report));
  assert.equal(candidate.report.status, "PASS");
  assert.equal(candidate.report.executionMode, "OFFLINE_TEST_DOUBLE");
  assert.equal(candidate.liveClaim, false);
  assert.equal(candidate.passSigningEligible, false);
  assert.equal(candidate.externalSettlementEligible, false);
  assertDeepFrozen(candidate);
  assert.throws(() => parseWorkerRpcV2Response(candidate), /must contain exactly/u);
  assert.equal("executeUnsignedWorkerRepairCandidate" in policyTwin, false);
});

test("v1, altered bindings, and inactive time windows reject before any port call", async () => {
  const valid = requestAt();
  const expired = requestAt(
    "2026-07-18T09:00:00.000Z",
    "2026-07-18T09:05:00.000Z",
  );
  const future = requestAt(
    "2026-07-18T10:02:00.000Z",
    "2026-07-18T10:07:00.000Z",
  );
  const scenarios = [
    {
      value: { ...valid, schemaVersion: "1", protocol: "policytwin.codex.repair.v1" },
      pattern: /v2 request/u,
    },
    { value: { ...valid, inputSha256: "f".repeat(64) }, pattern: /hashes/u },
    {
      value: { ...valid, executionBindingSha256: "e".repeat(64) },
      pattern: /execution binding/u,
    },
    { value: expired, pattern: /expired/u },
    { value: future, pattern: /not active/u },
  ];

  for (const scenario of scenarios) {
    const events = [];
    await assert.rejects(
      executeUnsignedWorkerRepairCandidate(
        scenario.value,
        portsFor(valid, events),
      ),
      scenario.pattern,
    );
    assert.deepEqual(events, []);
  }
});

test("live-shaped backends, extra authority, and request mutation fail closed", async () => {
  const request = requestAt();
  const liveEvents = [];
  await assert.rejects(
    executeUnsignedWorkerRepairCandidate(request, {
      ...portsFor(request, liveEvents),
      backend: {
        ...offlineBackend(liveEvents),
        executionMode: "LIVE_CODEX_SDK",
      },
    }),
    /offline test-double/u,
  );
  assert.deepEqual(liveEvents, []);

  const authorityEvents = [];
  await assert.rejects(
    executeUnsignedWorkerRepairCandidate(request, {
      ...portsFor(request, authorityEvents),
      signer: {},
    }),
    /unknown fields/u,
  );
  assert.deepEqual(authorityEvents, []);

  const mutableRequest = structuredClone(request);
  const mutationEvents = [];
  const mutationPorts = portsFor(mutableRequest, mutationEvents, {
    backend: offlineBackend(mutationEvents, () => {
      mutableRequest.model = "changed-model";
    }),
  });
  await assert.rejects(
    executeUnsignedWorkerRepairCandidate(mutableRequest, mutationPorts),
    /changed during unsigned execution/u,
  );
  assert.deepEqual(mutationEvents, ["cartography"]);
});

test("verification failures remain redacted non-admissible candidates", async () => {
  const request = requestAt();
  const events = [];
  const rawToken = ["ghp", "A".repeat(24)].join("_");
  const ports = portsFor(request, events);
  ports.runCommand = async (commandId) => {
    events.push(`command:${commandId}`);
    throw new Error(rawToken);
  };

  const candidate = await executeUnsignedWorkerRepairCandidate(request, ports);
  assert.equal(candidate.report.status, "FAIL");
  assert.equal(candidate.report.failure.code, "COMMAND_FAILED");
  assert.equal(JSON.stringify(candidate).includes("AAAAAAAA"), false);
  assert.match(candidate.report.failure.message, /REDACTED/u);
  assert.equal(candidate.liveClaim, false);
  assert.equal(candidate.passSigningEligible, false);
  assert.equal(candidate.externalSettlementEligible, false);
  assert.throws(() => parseWorkerRpcV2Response(candidate), /must contain exactly/u);
});

test("successful report metadata cannot retain credential-shaped content", async () => {
  const request = requestAt();
  const events = [];
  const rawToken = ["ghp", "A".repeat(24)].join("_");
  const backend = offlineBackend(events);
  backend.cartograph = async () => {
    events.push("cartography");
    return {
      ...cartography(),
      metadata: { ...metadata("cartography-run"), backendId: rawToken },
    };
  };

  await assert.rejects(
    executeUnsignedWorkerRepairCandidate(
      request,
      portsFor(request, events, { backend }),
    ),
    (error) => {
      assert.match(error.message, /prohibited sensitive content/u);
      assert.equal(error.message.includes("AAAAAAAA"), false);
      return true;
    },
  );
});

test("report scanning checks original Windows paths before JSON escaping", async () => {
  const request = requestAt();
  const events = [];
  const privatePath = ["C:", "Users", "Alice", "secret"].join("\\");
  const backend = offlineBackend(events);
  backend.cartograph = async () => {
    events.push("cartography");
    return {
      ...cartography(),
      metadata: { ...metadata("cartography-run"), backendId: privatePath },
    };
  };

  await assert.rejects(
    executeUnsignedWorkerRepairCandidate(
      request,
      portsFor(request, events, { backend }),
    ),
    (error) => {
      assert.match(error.message, /prohibited sensitive content/u);
      assert.equal(error.message.includes("Alice"), false);
      return true;
    },
  );
});

test("unsigned core has no Docker, credential, signer, or live-SDK dependency", async () => {
  const source = await readFile(
    new URL("../../src/codex/unsigned-worker-execution-core.ts", import.meta.url),
    "utf8",
  );
  const imports = [...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]).sort();
  assert.deepEqual(imports, [
    "./orchestrate.js",
    "./safety.js",
    "./types.js",
    "./worker-rpc-contract.js",
  ]);
  assert.doesNotMatch(source, /LIVE_CODEX_SDK|OPENAI_API_KEY|Docker|WorkerRpcV2Response/u);
  assert.match(source, /passSigningEligible: false/u);
  assert.match(source, /externalSettlementEligible: false/u);
  assert.equal(
    createHash("sha256").update(source, "utf8").digest("hex").length,
    64,
  );
});
