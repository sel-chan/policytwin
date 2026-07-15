import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
  WORKER_RPC_MAX_RESPONSE_CHUNKS,
  WORKER_RPC_MAX_RESPONSE_BYTES,
  canonicalWorkerRpcJson,
  createExternalWorkerRpcClient,
  createExternalWorkerRpcV2Client,
  createWorkerRpcTrustBundle,
  liveLinuxCgroupDockerBindingSha256,
  liveLinuxCgroupCpuSampleTranscriptSha256,
  parseWorkerRpcRequest,
  parseWorkerRpcV2Request,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
  workerRpcSignaturePayload,
  workerRpcV2SignaturePayload,
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
const acceptedCases = [...goldenCases, ...generatedCases];
const driftCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url),
    "utf8",
  ),
);
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

const BACKEND_ID = "policytwin-external-worker";
const SUPERVISOR_ID = "policytwin-supervisor";
const KEY_ID = "worker-key-v1";
const V2_KEY_ID = "live-cpu-key-v2";
const IMAGE_DIGEST = `sha256:${"d".repeat(64)}`;
const BASELINE_DIGEST = "e".repeat(64);
const BASELINE_TREE_MANIFEST = {
  schemaVersion: "1",
  entries: [
    { path: ".", kind: "directory", mode: 16877, mtimeMs: 1_700_000_000_000, sha256: null },
    { path: "package.json", kind: "file", mode: 33188, mtimeMs: 1_700_000_000_001, sha256: "3".repeat(64) },
    { path: "src", kind: "directory", mode: 16877, mtimeMs: 1_700_000_000_002, sha256: null },
    { path: "src/refund.ts", kind: "file", mode: 33188, mtimeMs: 1_700_000_000_003, sha256: "4".repeat(64) },
    { path: "tests", kind: "directory", mode: 16877, mtimeMs: 1_700_000_000_004, sha256: null },
    { path: "tests/refund.test.mjs", kind: "file", mode: 33188, mtimeMs: 1_700_000_000_005, sha256: "5".repeat(64) },
  ],
};
const FINAL_TREE_MANIFEST = {
  schemaVersion: "1",
  entries: BASELINE_TREE_MANIFEST.entries.map((entry) => ({
    ...entry,
    sha256:
      entry.path === "src/refund.ts"
        ? "6".repeat(64)
        : entry.path === "tests/refund.test.mjs"
          ? "7".repeat(64)
          : entry.sha256,
  })),
};
const BASELINE_TREE_DIGEST = workerRpcExecutionTreeSha256(BASELINE_TREE_MANIFEST);
const FINAL_TREE_DIGEST = workerRpcExecutionTreeSha256(FINAL_TREE_MANIFEST);
const OUT_OF_SCOPE_TREE_MANIFEST = {
  schemaVersion: "1",
  entries: FINAL_TREE_MANIFEST.entries.map((entry) => ({
    ...entry,
    mtimeMs: entry.path === "package.json" ? entry.mtimeMs + 1 : entry.mtimeMs,
  })),
};
const OUT_OF_SCOPE_TREE_DIGEST = workerRpcExecutionTreeSha256(
  OUT_OF_SCOPE_TREE_MANIFEST,
);
const MTIME_ONLY_TREE_MANIFEST = {
  schemaVersion: "1",
  entries: BASELINE_TREE_MANIFEST.entries.map((entry) => ({
    ...entry,
    mtimeMs:
      entry.path === "src/refund.ts" || entry.path === "tests/refund.test.mjs"
        ? entry.mtimeMs + 1
        : entry.mtimeMs,
  })),
};
const MTIME_ONLY_TREE_DIGEST = workerRpcExecutionTreeSha256(MTIME_ONLY_TREE_MANIFEST);
const MODEL = "gpt-codex-test";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const { privateKey: v2PrivateKey, publicKey: v2PublicKey } = generateKeyPairSync("ed25519");
const v2PublicKeyPem = v2PublicKey.export({ type: "spki", format: "pem" });

function metadata(request, runId) {
  const started = new Date(Date.parse(request.issuedAt) + 100).toISOString();
  const completed = new Date(Date.parse(request.issuedAt) + 200).toISOString();
  return {
    executionMode: "LIVE_CODEX_SDK",
    backendId: BACKEND_ID,
    sdkVersion: "0.144.3",
    model: request.model,
    modelReasoningEffort: "high",
    promptTemplateSha256: "a".repeat(64),
    requestSha256: "b".repeat(64),
    outputSchemaSha256: "c".repeat(64),
    runId,
    startedAt: started,
    completedAt: completed,
  };
}

function liveReport(request, overrides = {}) {
  const repairRunId = "repair-run-live-0001";
  const policyIrSha256 = createHash("sha256")
    .update(JSON.stringify(request.input.acceptedPolicyIr), "utf8")
    .digest("hex");
  const results = request.input.acceptedCases.map((policyCase) => ({
    caseId: policyCase.id,
    expectedDecision: policyCase.expectedDecision,
    actualDecision: policyCase.expectedDecision,
    status: "PASS",
    error: null,
  }));
  return {
    schemaVersion: "1",
    executionMode: "LIVE_CODEX_SDK",
    status: "PASS",
    attempts: 1,
    cartography: {
      schemaVersion: "1",
      phase: "CARTOGRAPHY",
      metadata: metadata(request, "cartography-run-live-0001"),
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
          reason: "Contains the refund policy boundaries and precedence.",
        },
      ],
      dataFlow: [
        {
          file: "src/refund.ts",
          lineStart: 12,
          lineEnd: 31,
          symbol: "decideRefund",
          reason: "Validated inputs flow through the policy decision.",
        },
      ],
      testFiles: ["tests/refund.test.mjs"],
      risks: ["Boundary and precedence defects require regression coverage."],
      proposedFilesToChange: ["src/refund.ts", "tests/refund.test.mjs"],
      verificationCommandIds: ["fixture-typecheck", "fixture-test"],
    },
    repairAttempts: [
      {
        schemaVersion: "1",
        phase: "REPAIR",
        metadata: metadata(request, repairRunId),
        changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
        summary: "Corrected inclusive boundaries and final-sale precedence.",
        rationale: ["Match the supplied D01-D03 witnesses."],
        remainingRisks: [],
        verificationCommandIds: ["fixture-typecheck", "fixture-test"],
      },
    ],
    commandEvidence: [
      {
        schemaVersion: "1",
        commandId: "fixture-typecheck",
        exitCode: 0,
        timedOut: false,
        durationMs: 10,
        stdout: "ok",
        stderr: "",
        outputTruncated: false,
        fixtureTreeBeforeSha256: FINAL_TREE_DIGEST,
        fixtureTreeAfterSha256: FINAL_TREE_DIGEST,
        attempt: 1,
        repairRunId,
      },
      {
        schemaVersion: "1",
        commandId: "fixture-test",
        exitCode: 0,
        timedOut: false,
        durationMs: 10,
        stdout: "ok",
        stderr: "",
        outputTruncated: false,
        fixtureTreeBeforeSha256: FINAL_TREE_DIGEST,
        fixtureTreeAfterSha256: FINAL_TREE_DIGEST,
        attempt: 1,
        repairRunId,
      },
    ],
    commandFailures: [],
    policyVerificationAttempts: [
      {
        schemaVersion: "1",
        executionMode: "SERVER_OWNED_CORPUS",
        attempt: 1,
        repairRunId,
        fixtureTreeSha256: FINAL_TREE_DIGEST,
        acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
        policyIrSha256,
        status: "PASS",
        total: results.length,
        passed: results.length,
        results,
      },
    ],
    review: {
      schemaVersion: "1",
      phase: "REVIEW",
      metadata: metadata(request, "review-run-live-0001"),
      verdict: "APPROVE",
      summary: "The focused repair matches the accepted policy corpus.",
      findings: [],
    },
    failure: null,
    ...overrides,
  };
}

function signedResponse(request, options = {}) {
  const report = options.status === "FAIL" ? null : liveReport(request, options.reportOverrides);
  const error = options.status === "FAIL" ? (options.error ?? "worker failed safely") : null;
  const response = {
    schemaVersion: "1",
    protocol: "policytwin.codex.repair.v1",
    action: "RUN_REPAIR_RESULT",
    requestId: request.requestId,
    runNonce: request.runNonce,
    sequence: 1,
    requestSha256: workerRpcSha256(request),
    status: options.status ?? "PASS",
    completedAt: new Date(Date.parse(request.issuedAt) + 1_000).toISOString(),
    resultSha256: workerRpcSha256(report ?? { error }),
    report,
    error,
    receipt: {
      schemaVersion: "1",
      algorithm: "Ed25519",
      keyId: options.keyId ?? KEY_ID,
      supervisorId: SUPERVISOR_ID,
      supervisorRunId: options.supervisorRunId ?? "supervisor-run-0001",
      workerImageDigest: request.policy.workerImageDigest,
      workerPolicySha256: request.policySha256,
      fixtureId: "seeded-refund-demo",
      baselineContentSha256: request.policy.baselineContentSha256,
      baselineExecutionTreeSha256: request.policy.baselineExecutionTreeSha256,
      finalExecutionTreeSha256: FINAL_TREE_DIGEST,
      finalExecutionTreeManifest: FINAL_TREE_MANIFEST,
      acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
      executionMode: "LIVE_CODEX_SDK",
      repairWorkspaceDeleted: true,
      verificationWorkspaceDeleted: true,
      processTreeReaped: true,
      remainingProcessCount: 0,
      signature: Buffer.alloc(64).toString("base64url"),
      ...options.receiptOverrides,
    },
  };
  options.mutateBeforeSign?.(response);
  response.receipt.signature = sign(
    null,
    Buffer.from(workerRpcSignaturePayload(response), "utf8"),
    options.privateKey ?? privateKey,
  ).toString("base64url");
  options.mutateAfterSign?.(response);
  return canonicalWorkerRpcJson(response);
}

function cpuRole(roleName, index, samplesUsec) {
  return {
    role: roleName,
    containerId: index.toString(16).repeat(64),
    pid: 2_000 + index,
    startedAt: `2026-07-15T00:00:0${index}.000000000Z`,
    cgroupIdentitySha256: (index + 8).toString(16).repeat(64),
    baselineUsageUsec: samplesUsec[0],
    finalUsageUsec: samplesUsec.at(-1),
    deltaUsageUsec: String(BigInt(samplesUsec.at(-1)) - BigInt(samplesUsec[0])),
    sampleCount: samplesUsec.length,
    samplesUsec,
    sampleTranscriptSha256: liveLinuxCgroupCpuSampleTranscriptSha256(samplesUsec),
    released: true,
  };
}

function liveCpuProof(request, overrides = {}) {
  const supervisorRunId = overrides.supervisorRunId ?? "live-supervisor-run-0001";
  const roles = [
    cpuRole("egress", 1, ["10", "20", "30"]),
    cpuRole("worker", 2, ["20", "60"]),
    cpuRole("verifier", 3, ["100", "140"]),
  ];
  const dockerBindingSha256 = liveLinuxCgroupDockerBindingSha256({
    requestSha256: workerRpcSha256(request),
    executionBindingSha256: request.executionBindingSha256,
    supervisorRunId,
    workerImageDigest: request.policy.workerImageDigest,
    roles,
  });
  return {
    schemaVersion: "1",
    proofType: "LIVE_LINUX_CGROUP_V2_THREE_ROLE",
    status: "OBSERVED_WITHIN_BUDGET",
    requestId: request.requestId,
    runNonce: request.runNonce,
    requestSha256: workerRpcSha256(request),
    executionBindingSha256: request.executionBindingSha256,
    supervisorRunId,
    dockerBindingSha256,
    workerImageDigest: request.policy.workerImageDigest,
    workerPolicySha256: request.policySha256,
    acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
    budgetUsec: String(BigInt(request.policy.limits.cpuTimeMs) * 1_000n),
    aggregateUsageUsec: "100",
    accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE",
    samplingMode: "LINUX_CGROUP_V2_EMBEDDED_ROLE_SAMPLES",
    cumulativeAccountingVerified: true,
    failStopEnforcementArmed: true,
    hardLimitEnforced: false,
    overshootBounded: false,
    containmentTriggered: false,
    controllerStopped: true,
    allRoleCgroupsReleased: true,
    roles,
    ...overrides,
  };
}

function signedV2Response(request, options = {}) {
  const status = options.status ?? "PASS";
  const report = status === "PASS" ? liveReport(request, options.reportOverrides) : null;
  const error = status === "FAIL" ? (options.error ?? "worker failed safely") : null;
  const supervisorRunId = options.supervisorRunId ?? "live-supervisor-run-0001";
  const cpuProof =
    options.cpuProof === undefined
      ? status === "PASS"
        ? liveCpuProof(request, { supervisorRunId })
        : null
      : options.cpuProof;
  const dockerBindingSha256 =
    options.dockerBindingSha256 ?? cpuProof?.dockerBindingSha256 ?? "8".repeat(64);
  const response = {
    schemaVersion: "2",
    protocol: "policytwin.codex.repair.v2",
    action: "RUN_REPAIR_RESULT",
    requestId: request.requestId,
    runNonce: request.runNonce,
    sequence: 1,
    requestSha256: workerRpcSha256(request),
    executionBindingSha256: request.executionBindingSha256,
    status,
    completedAt: new Date(Date.parse(request.issuedAt) + 1_000).toISOString(),
    resultSha256: workerRpcSha256(report ?? { error }),
    report,
    error,
    receipt: {
      schemaVersion: "2",
      algorithm: "Ed25519",
      keyId: options.keyId ?? V2_KEY_ID,
      supervisorId: SUPERVISOR_ID,
      supervisorRunId,
      workerImageDigest: request.policy.workerImageDigest,
      workerPolicySha256: request.policySha256,
      fixtureId: "seeded-refund-demo",
      baselineContentSha256: request.policy.baselineContentSha256,
      baselineExecutionTreeSha256: request.policy.baselineExecutionTreeSha256,
      finalExecutionTreeSha256: FINAL_TREE_DIGEST,
      finalExecutionTreeManifest: FINAL_TREE_MANIFEST,
      acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
      executionMode: "LIVE_CODEX_SDK",
      executionBindingSha256: request.executionBindingSha256,
      dockerBindingSha256,
      cpuProof,
      repairWorkspaceDeleted: true,
      verificationWorkspaceDeleted: true,
      processTreeReaped: true,
      remainingProcessCount: 0,
      signature: Buffer.alloc(64).toString("base64url"),
      ...options.receiptOverrides,
    },
  };
  options.mutateBeforeSign?.(response);
  response.receipt.signature = sign(
    null,
    Buffer.from(workerRpcV2SignaturePayload(response), "utf8"),
    options.privateKey ?? v2PrivateKey,
  ).toString("base64url");
  options.mutateAfterSign?.(response);
  return canonicalWorkerRpcJson(response);
}

function deterministicRandom() {
  let counter = 0;
  return (size) => Buffer.alloc(size, (counter += 1));
}

function streamedResponse(body, options = {}) {
  const bytes = Buffer.from(body, "utf8");
  const chunkSize = options.chunkSize ?? 4096;
  return {
    declaredLength: options.declaredLength ?? bytes.byteLength,
    chunks:
      options.chunks ??
      (async function* streamBytes() {
        for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
          yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
        }
      })(),
  };
}

function clientOptions(transport, overrides = {}) {
  return {
    transport,
    trustBundle: createWorkerRpcTrustBundle({
      generalWorkerPublicKeys: { [KEY_ID]: publicKeyPem },
      liveSupervisorPublicKeys: {
        [V2_KEY_ID]: {
          publicKeyPem: v2PublicKeyPem,
          supervisorId: SUPERVISOR_ID,
          purpose: "LIVE_LINUX_CGROUP_RPC_V2",
        },
      },
    }),
    expectedSupervisorId: SUPERVISOR_ID,
    expectedBackendId: BACKEND_ID,
    workerImageDigest: IMAGE_DIGEST,
    baselineContentSha256: BASELINE_DIGEST,
    baselineExecutionTreeSha256: BASELINE_TREE_DIGEST,
    baselineExecutionTreeManifest: BASELINE_TREE_MANIFEST,
    model: MODEL,
    limits: {
      wallTimeMs: 120_000,
      cpuTimeMs: 60_000,
      memoryBytes: 512 * 1024 * 1024,
      pids: 32,
      outputBytes: 2 * 1024 * 1024,
    },
    rpcTimeoutMs: 180_000,
    now: () => new Date("2026-07-15T00:00:00.000Z"),
    randomBytes: deterministicRandom(),
    ...overrides,
  };
}

function v2ClientOptions(transport, overrides = {}) {
  return {
    ...clientOptions(transport),
    ...overrides,
  };
}

test("signed external-worker RPC binds one validated repair run without secrets or host paths", async () => {
  let observedRequest;
  let observedOptions;
  const transport = {
    id: "signed-test-transport",
    authenticationMode: "MUTUAL_TLS",
    async call(canonicalRequest, callOptions) {
      observedRequest = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
      observedOptions = callOptions;
      return streamedResponse(signedResponse(observedRequest));
    },
  };
  const result = await createExternalWorkerRpcClient(clientOptions(transport)).runRepair(input);
  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.executionMode, "LIVE_CODEX_SDK");
  assert.equal(result.receipt.processTreeReaped, true);
  assert.equal(result.receipt.repairWorkspaceDeleted, true);
  assert.equal(observedRequest.policy.verificationWorkspace, "IMMUTABLE_RECONSTRUCTED");
  assert.equal(observedRequest.policy.fixtureProcessNetwork, "DISABLED");
  assert.equal(observedRequest.policy.codexApiEgress, "SUPERVISOR_OPENAI_PROXY_ONLY");
  assert.deepEqual(observedRequest.policy.writablePaths, [
    "src/refund.ts",
    "tests/refund.test.mjs",
  ]);
  assert.equal(observedOptions.maxResponseBytes, WORKER_RPC_MAX_RESPONSE_BYTES);
  assert.equal(observedOptions.maxChunkBytes, WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES);
  assert.equal(observedOptions.maxChunks, WORKER_RPC_MAX_RESPONSE_CHUNKS);
  const encoded = canonicalWorkerRpcJson(observedRequest);
  assert.equal(encoded.includes("API_KEY"), false);
  assert.equal(encoded.includes("CODEX_HOME"), false);
  assert.equal(encoded.includes("C:\\"), false);
  assert.equal(encoded.includes(["", "home", ""].join("/")), false);
  assert.equal(Object.hasOwn(observedRequest, "command"), false);
});

test("RPC rejects tampering, untrusted keys, weakened teardown, and phase metadata mismatch", async (t) => {
  const cases = [
    {
      name: "signature tamper",
      responseOptions: {
        mutateAfterSign(response) {
          response.receipt.signature = `${response.receipt.signature[0] === "A" ? "B" : "A"}${response.receipt.signature.slice(1)}`;
        },
      },
      pattern: /signature is invalid/u,
    },
    {
      name: "request binding tamper",
      responseOptions: {
        mutateAfterSign(response) {
          response.requestSha256 = "f".repeat(64);
        },
      },
      pattern: /not bound to the exact request/u,
    },
    {
      name: "teardown weakened",
      responseOptions: { receiptOverrides: { processTreeReaped: false } },
      pattern: /mandatory teardown/u,
    },
    {
      name: "phase model mismatch",
      responseOptions: {
        reportOverrides: {
          review: {
            schemaVersion: "1",
            phase: "REVIEW",
            metadata: null,
            verdict: "APPROVE",
            summary: "review",
            findings: [],
          },
        },
      },
      customizeResponse(request, options) {
        const report = liveReport(request);
        report.review.metadata.model = "different-model";
        return signedResponse(request, { ...options, reportOverrides: { review: report.review } });
      },
      pattern: /phase metadata is not bound/u,
    },
    {
      name: "corpus binding mismatch",
      responseOptions: {},
      customizeResponse(request) {
        const report = liveReport(request);
        report.policyVerificationAttempts[0].acceptedCorpusSha256 = "f".repeat(64);
        return signedResponse(request, {
          reportOverrides: {
            policyVerificationAttempts: report.policyVerificationAttempts,
          },
        });
      },
      pattern: /corpus receipts are not bound/u,
    },
    {
      name: "changed files exceed fixed write set",
      responseOptions: {},
      customizeResponse(request) {
        const report = liveReport(request);
        report.repairAttempts[0].changedFiles = ["README.md"];
        return signedResponse(request, {
          reportOverrides: { repairAttempts: report.repairAttempts },
        });
      },
      pattern: /changed-files receipt exceeds the fixed write set/u,
    },
    {
      name: "verification command mutates tree",
      responseOptions: {},
      customizeResponse(request) {
        const report = liveReport(request);
        report.commandEvidence[0].fixtureTreeBeforeSha256 = request.policy.baselineExecutionTreeSha256;
        return signedResponse(request, {
          reportOverrides: { commandEvidence: report.commandEvidence },
        });
      },
      pattern: /immutable verification tree/u,
    },
    {
      name: "final manifest changes unapproved path",
      responseOptions: {
        receiptOverrides: {
          finalExecutionTreeSha256: OUT_OF_SCOPE_TREE_DIGEST,
          finalExecutionTreeManifest: OUT_OF_SCOPE_TREE_MANIFEST,
        },
      },
      customizeResponse(request, options) {
        const report = liveReport(request);
        for (const command of report.commandEvidence) {
          command.fixtureTreeBeforeSha256 = OUT_OF_SCOPE_TREE_DIGEST;
          command.fixtureTreeAfterSha256 = OUT_OF_SCOPE_TREE_DIGEST;
        }
        report.policyVerificationAttempts[0].fixtureTreeSha256 = OUT_OF_SCOPE_TREE_DIGEST;
        return signedResponse(request, {
          ...options,
          reportOverrides: {
            commandEvidence: report.commandEvidence,
            policyVerificationAttempts: report.policyVerificationAttempts,
          },
        });
      },
      pattern: /delta exceeds the fixed two-file write set/u,
    },
    {
      name: "mtime-only repair cannot impersonate content changes",
      responseOptions: {
        receiptOverrides: {
          finalExecutionTreeSha256: MTIME_ONLY_TREE_DIGEST,
          finalExecutionTreeManifest: MTIME_ONLY_TREE_MANIFEST,
        },
      },
      customizeResponse(request, options) {
        const report = liveReport(request);
        for (const command of report.commandEvidence) {
          command.fixtureTreeBeforeSha256 = MTIME_ONLY_TREE_DIGEST;
          command.fixtureTreeAfterSha256 = MTIME_ONLY_TREE_DIGEST;
        }
        report.policyVerificationAttempts[0].fixtureTreeSha256 = MTIME_ONLY_TREE_DIGEST;
        return signedResponse(request, {
          ...options,
          reportOverrides: {
            commandEvidence: report.commandEvidence,
            policyVerificationAttempts: report.policyVerificationAttempts,
          },
        });
      },
      pattern: /delta exceeds the fixed two-file write set/u,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const transport = {
        id: `negative-${item.name.replaceAll(" ", "-")}`,
        authenticationMode: "MUTUAL_TLS",
        async call(canonicalRequest) {
          const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
          const body = item.customizeResponse?.(request, item.responseOptions) ??
            signedResponse(request, item.responseOptions);
          return streamedResponse(body);
        },
      };
      await assert.rejects(
        createExternalWorkerRpcClient(clientOptions(transport)).runRepair(input),
        item.pattern,
      );
    });
  }

  const otherKeys = generateKeyPairSync("ed25519");
  const untrustedTransport = {
    id: "untrusted-key-transport",
    authenticationMode: "LOCAL_SOCKET_ACL",
    async call(canonicalRequest) {
      const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
      return streamedResponse(signedResponse(request, { privateKey: otherKeys.privateKey }));
    },
  };
  await assert.rejects(
    createExternalWorkerRpcClient(clientOptions(untrustedTransport)).runRepair(input),
    /signature is invalid/u,
  );
});

test("RPC client refuses a transport without mutual authentication", () => {
  const transport = {
    id: "unauthenticated-transport",
    authenticationMode: "NONE",
    async call() {
      throw new Error("must not run");
    },
  };
  assert.throws(
    () => createExternalWorkerRpcClient(clientOptions(transport)),
    /must provide mutual authentication/u,
  );
});

test("RPC rejects unknown fields, noncanonical JSON, oversized frames, and host paths before trust", async (t) => {
  const variants = [
    {
      name: "unknown field",
      build(request) {
        const response = JSON.parse(signedResponse(request));
        response.shell = "forbidden";
        return canonicalWorkerRpcJson(response);
      },
      pattern: /must contain exactly/u,
    },
    {
      name: "noncanonical JSON",
      build(request) {
        return `${signedResponse(request)}\n`;
      },
      pattern: /canonical JSON encoding/u,
    },
    {
      name: "host path",
      build(request) {
        const response = JSON.parse(signedResponse(request));
        response.error = "file:///root/secret";
        response.status = "FAIL";
        response.report = null;
        return canonicalWorkerRpcJson(response);
      },
      pattern: /sensitive or personal-path content|host or privileged absolute path/u,
    },
    {
      name: "oversized frame",
      stream() {
        return {
          declaredLength: WORKER_RPC_MAX_RESPONSE_BYTES + 1,
          get chunks() {
            throw new Error("oversized frame body must not be read");
          },
        };
      },
      pattern: /preallocation limit/u,
    },
    {
      name: "declared length mismatch",
      build(request) {
        return signedResponse(request);
      },
      stream(body) {
        return streamedResponse(body, { declaredLength: Buffer.byteLength(body) + 1 });
      },
      pattern: /did not match its declared byte length/u,
    },
    {
      name: "oversized chunk",
      stream() {
        const chunk = Buffer.alloc(WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES + 1, 1);
        return streamedResponse("x", {
          declaredLength: chunk.byteLength,
          chunks: (async function* chunks() { yield chunk; })(),
        });
      },
      pattern: /invalid or oversized chunk/u,
    },
    {
      name: "non-byte chunk",
      stream() {
        return streamedResponse("x", {
          declaredLength: 1,
          chunks: (async function* chunks() { yield "x"; })(),
        });
      },
      pattern: /invalid or oversized chunk/u,
    },
    {
      name: "too many chunks",
      stream() {
        return streamedResponse("x", {
          declaredLength: WORKER_RPC_MAX_RESPONSE_CHUNKS + 1,
          chunks: (async function* chunks() {
            for (let index = 0; index <= WORKER_RPC_MAX_RESPONSE_CHUNKS; index += 1) {
              yield Buffer.from("x");
            }
          })(),
        });
      },
      pattern: /chunk-count limit/u,
    },
  ];
  for (const item of variants) {
    await t.test(item.name, async () => {
      const transport = {
        id: `frame-${item.name.replaceAll(" ", "-")}`,
        authenticationMode: "LOCAL_SOCKET_ACL",
        async call(canonicalRequest) {
          const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
          const body = item.build?.(request);
          return item.stream?.(body) ?? streamedResponse(body);
        },
      };
      await assert.rejects(
        createExternalWorkerRpcClient(clientOptions(transport)).runRepair(input),
        item.pattern,
      );
    });
  }
});

test("RPC consumes request capabilities once and rejects replayed responses", async () => {
  let firstResponse;
  let calls = 0;
  const transport = {
    id: "replay-test-transport",
    authenticationMode: "LOCAL_SOCKET_ACL",
    async call(canonicalRequest) {
      calls += 1;
      const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
      firstResponse ??= signedResponse(request);
      return streamedResponse(firstResponse);
    },
  };
  const client = createExternalWorkerRpcClient(clientOptions(transport));
  await client.runRepair(input);
  await assert.rejects(client.runRepair(input), /not bound to the exact request/u);
  assert.equal(calls, 2);

  const repeatingRandom = (size) => Buffer.alloc(size, 7);
  const uniqueTransport = {
    id: "capability-reuse-transport",
    authenticationMode: "LOCAL_SOCKET_ACL",
    async call(canonicalRequest) {
      const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
      return streamedResponse(
        signedResponse(request, { supervisorRunId: `supervisor-${request.requestId}` }),
      );
    },
  };
  const reusedClient = createExternalWorkerRpcClient(
    clientOptions(uniqueTransport, { randomBytes: repeatingRandom }),
  );
  await reusedClient.runRepair(input);
  await assert.rejects(
    reusedClient.runRepair(input),
    /reuse a request capability/u,
  );
});

test("signed worker failures remain fail-closed after teardown proof", async () => {
  const transport = {
    id: "signed-failure-transport",
    authenticationMode: "LOCAL_SOCKET_ACL",
    async call(canonicalRequest) {
      const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
      return streamedResponse(
        signedResponse(request, { status: "FAIL", error: "bounded worker failure" }),
      );
    },
  };
  await assert.rejects(
    createExternalWorkerRpcClient(clientOptions(transport)).runRepair(input),
    /bounded worker failure/u,
  );
});

test("RPC permits only one in-flight run and aborts an unresponsive transport", async () => {
  const transport = {
    id: "timeout-transport",
    authenticationMode: "LOCAL_SOCKET_ACL",
    async call(_request, { signal }) {
      return await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  const client = createExternalWorkerRpcClient(
    clientOptions(transport, {
      rpcTimeoutMs: 1_000,
      limits: {
        wallTimeMs: 1_000,
        cpuTimeMs: 10_000,
        memoryBytes: 512 * 1024 * 1024,
        pids: 32,
        outputBytes: 2 * 1024 * 1024,
      },
    }),
  );
  const first = client.runRepair(input);
  await assert.rejects(client.runRepair(input), /only one active run/u);
  await assert.rejects(first, /timed out|aborted/u);
});

test("Worker RPC v2 accepts one signed live-purpose CPU-bound repair result", async () => {
  let observedRequest;
  const transport = {
    id: "signed-v2-test-transport",
    authenticationMode: "MUTUAL_TLS",
    async call(canonicalRequest) {
      observedRequest = parseWorkerRpcV2Request(JSON.parse(canonicalRequest));
      return streamedResponse(signedV2Response(observedRequest));
    },
  };
  const result = await createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(
    input,
  );
  assert.equal(observedRequest.schemaVersion, "2");
  assert.equal(observedRequest.protocol, "policytwin.codex.repair.v2");
  assert.equal(result.executionBindingSha256, observedRequest.executionBindingSha256);
  assert.equal(result.receipt.cpuProof.status, "OBSERVED_WITHIN_BUDGET");
  assert.equal(result.receipt.cpuProof.aggregateUsageUsec, "100");
  assert.equal(result.receipt.cpuProof.hardLimitEnforced, false);
  assert.equal(result.receipt.cpuProof.overshootBounded, false);
});

test("Worker RPC v2 rejects local-socket transport and reused v1 key material at construction", () => {
  const localTransport = {
    id: "v2-local-socket-rejected",
    authenticationMode: "LOCAL_SOCKET_ACL",
    async call() {
      throw new Error("must not run");
    },
  };
  assert.throws(
    () => createExternalWorkerRpcV2Client(v2ClientOptions(localTransport)),
    /must use mutual TLS/u,
  );

  const mtlsTransport = { ...localTransport, authenticationMode: "MUTUAL_TLS" };
  assert.throws(
    () =>
      createWorkerRpcTrustBundle({
        generalWorkerPublicKeys: { [KEY_ID]: publicKeyPem },
        liveSupervisorPublicKeys: {
          [V2_KEY_ID]: {
            publicKeyPem,
            supervisorId: SUPERVISOR_ID,
            purpose: "LIVE_LINUX_CGROUP_RPC_V2",
          },
        },
      }),
    /reuses Ed25519 key material/u,
  );
});

test("Worker RPC v2 rejects v1 downgrade, static proof, and proof-less PASS", async (t) => {
  for (const scenario of [
    {
      name: "v1 downgrade",
      body(request) {
        return signedResponse(request);
      },
      pattern: /v2 response protocol|v2 response must contain exactly|unknown or missing/u,
    },
    {
      name: "static fake proof",
      body(request) {
        return signedV2Response(request, {
          cpuProof: {
            schemaVersion: "1",
            status: "STATIC_FAKE_CONTROLLER_VERIFIED",
            samplingMode: "SERIAL_SUPERVISOR_FAKE",
          },
        });
      },
      pattern: /live Linux cgroup CPU proof|unknown or missing/u,
    },
    {
      name: "proof-less PASS",
      body(request) {
        return signedV2Response(request, { cpuProof: null });
      },
      pattern: /live Linux cgroup CPU proof/u,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const transport = {
        id: `v2-${scenario.name.replaceAll(" ", "-")}`,
        authenticationMode: "MUTUAL_TLS",
        async call(canonicalRequest) {
          const request = parseWorkerRpcV2Request(JSON.parse(canonicalRequest));
          return streamedResponse(scenario.body(request));
        },
      };
      await assert.rejects(
        createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
        scenario.pattern,
      );
    });
  }
});

test("Worker RPC v2 rejects proof replay, request-budget drift, and key-purpose confusion", async (t) => {
  for (const scenario of [
    {
      name: "proof request replay",
      responseOptions: {
        mutateBeforeSign(response) {
          response.receipt.cpuProof.requestId = "f".repeat(32);
        },
      },
      options: {},
      pattern: /request ID binding/u,
    },
    {
      name: "request budget drift",
      responseOptions: {
        mutateBeforeSign(response) {
          response.receipt.cpuProof.budgetUsec = String(
            BigInt(response.receipt.cpuProof.budgetUsec) + 1n,
          );
        },
      },
      options: {},
      pattern: /request budget/u,
    },
    {
      name: "v1 key purpose",
      responseOptions: { keyId: KEY_ID },
      options: {},
      pattern: /lacks the live CPU proof purpose/u,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const transport = {
        id: `v2-${scenario.name.replaceAll(" ", "-")}`,
        authenticationMode: "MUTUAL_TLS",
        async call(canonicalRequest) {
          const request = parseWorkerRpcV2Request(JSON.parse(canonicalRequest));
          return streamedResponse(signedV2Response(request, scenario.responseOptions));
        },
      };
      await assert.rejects(
        async () =>
          createExternalWorkerRpcV2Client(
            v2ClientOptions(transport, scenario.options),
          ).runRepair(input),
        scenario.pattern,
      );
    });
  }
});

test("Worker RPC v2 signature covers Docker and CPU proof bindings", async () => {
  const transport = {
    id: "v2-proof-signature-tamper",
    authenticationMode: "MUTUAL_TLS",
    async call(canonicalRequest) {
      const request = parseWorkerRpcV2Request(JSON.parse(canonicalRequest));
      return streamedResponse(
        signedV2Response(request, {
          mutateAfterSign(response) {
            response.receipt.cpuProof.roles[0].containerId = "a".repeat(64);
            const changed = liveLinuxCgroupDockerBindingSha256({
              requestSha256: response.requestSha256,
              executionBindingSha256: response.executionBindingSha256,
              supervisorRunId: response.receipt.supervisorRunId,
              workerImageDigest: response.receipt.workerImageDigest,
              roles: response.receipt.cpuProof.roles,
            });
            response.receipt.dockerBindingSha256 = changed;
            response.receipt.cpuProof.dockerBindingSha256 = changed;
          },
        }),
      );
    },
  };
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /v2 supervisor signature is invalid/u,
  );
});

test("Worker RPC v2 FAIL cannot carry a success CPU proof", async () => {
  const transport = {
    id: "v2-fail-proof-confusion",
    authenticationMode: "MUTUAL_TLS",
    async call(canonicalRequest) {
      const request = parseWorkerRpcV2Request(JSON.parse(canonicalRequest));
      return streamedResponse(
        signedV2Response(request, {
          status: "FAIL",
          cpuProof: liveCpuProof(request),
        }),
      );
    },
  };
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /FAIL receipt cannot carry a success CPU proof/u,
  );
});
