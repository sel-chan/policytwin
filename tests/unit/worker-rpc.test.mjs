import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { createServer as createTlsServer } from "node:tls";
import * as policyTwin from "../../dist/index.js";
import {
  WORKER_RPC_MAX_REQUEST_BYTES,
  WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
  WORKER_RPC_MAX_RESPONSE_CHUNKS,
  WORKER_RPC_MAX_RESPONSE_BYTES,
  WORKER_RPC_V2_MTLS_ALPN,
  WORKER_RPC_V2_MTLS_REQUEST_MAGIC,
  WORKER_RPC_V2_MTLS_RESPONSE_MAGIC,
  canonicalWorkerRpcJson,
  createExternalWorkerRpcClient,
  createExternalWorkerRpcV2Client,
  consumeValidatedExternalWorkerV2Run,
  createMutualTlsWorkerRpcTransport,
  createMutualTlsWorkerRpcV2Transport,
  createWorkerRpcTrustBundle,
  liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256,
  liveLinuxCgroupCpuEvidenceV2Sha256,
  parseWorkerRpcRequest,
  parseWorkerRpcV2Request,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
  workerRpcSignaturePayload,
  workerRpcV2SignaturePayload,
} from "../../dist/index.js";
import { createEphemeralWorkerRpcTlsCertificates } from "../helpers/worker-rpc-tls-certificates.mjs";
import {
  createObservedBudgetFailureCpuEvidenceV2,
  createPreExecutionFailureCpuEvidenceV2,
  createSuccessCpuEvidenceV2,
} from "../helpers/live-cpu-evidence-v2.mjs";

const tlsCertificates = await createEphemeralWorkerRpcTlsCertificates();
after(async () => tlsCertificates.cleanup());

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
    sdkVersion: "0.144.6",
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

function signedV2Response(request, options = {}) {
  const status = options.status ?? "PASS";
  const report = status === "PASS" ? liveReport(request, options.reportOverrides) : null;
  const error = status === "FAIL" ? (options.error ?? "worker failed safely") : null;
  const supervisorRunId = options.supervisorRunId ?? "live-supervisor-run-0001";
  const cpuEvidence =
    options.cpuEvidence === undefined
      ? status === "PASS"
        ? createSuccessCpuEvidenceV2(request, { supervisorRunId })
        : createPreExecutionFailureCpuEvidenceV2(request, { supervisorRunId })
      : options.cpuEvidence;
  const dockerBindingSha256 =
    options.dockerBindingSha256 === undefined
      ? (cpuEvidence?.dockerBindingSha256 ?? null)
      : options.dockerBindingSha256;
  const executionNotStarted =
    cpuEvidence?.outcome === "PRE_EXECUTION_REJECTED" || cpuEvidence === null;
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
    resultSha256: workerRpcSha256({
      report,
      error,
      cpuEvidenceSha256: cpuEvidence?.cpuEvidenceSha256 ?? "0".repeat(64),
    }),
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
      finalExecutionTreeSha256: executionNotStarted
        ? request.policy.baselineExecutionTreeSha256
        : FINAL_TREE_DIGEST,
      finalExecutionTreeManifest: executionNotStarted
        ? request.policy.baselineExecutionTreeManifest
        : FINAL_TREE_MANIFEST,
      acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
      executionMode:
        executionNotStarted
          ? "NOT_STARTED"
          : "LIVE_CODEX_SDK",
      executionBindingSha256: request.executionBindingSha256,
      dockerBindingSha256,
      cpuEvidence,
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

function testFrameHeader(magic, length) {
  const header = Buffer.alloc(8);
  header.write(magic, 0, 4, "ascii");
  header.writeUInt32BE(length, 4);
  return header;
}

function readScriptedV2Request(socket) {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    let declaredLength = null;
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const onError = () => fail(new Error("Scripted v2 TLS peer read failed."));
    const onClose = () => fail(new Error("Scripted v2 TLS peer closed before one request."));
    const onData = (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.byteLength > WORKER_RPC_MAX_REQUEST_BYTES + 8) {
        fail(new Error("Scripted v2 TLS request exceeded its byte limit."));
        return;
      }
      if (declaredLength === null && bytes.byteLength >= 8) {
        if (bytes.toString("ascii", 0, 4) !== WORKER_RPC_V2_MTLS_REQUEST_MAGIC) {
          fail(new Error("Scripted v2 TLS request used the wrong magic."));
          return;
        }
        declaredLength = bytes.readUInt32BE(4);
        if (declaredLength < 1 || declaredLength > WORKER_RPC_MAX_REQUEST_BYTES) {
          fail(new Error("Scripted v2 TLS request declared an invalid length."));
          return;
        }
      }
      if (declaredLength !== null && bytes.byteLength >= declaredLength + 8) {
        if (bytes.byteLength !== declaredLength + 8) {
          fail(new Error("Scripted v2 TLS request contained trailing bytes."));
          return;
        }
        cleanup();
        try {
          const text = bytes.subarray(8).toString("utf8");
          resolve(parseWorkerRpcV2Request(JSON.parse(text)));
        } catch (error) {
          reject(error);
        }
      }
    };
    const timer = setTimeout(
      () => fail(new Error("Scripted v2 TLS request timed out.")),
      2_000,
    );
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function createScriptedV2Transport(t, responder, id) {
  const sockets = new Set();
  const server = createTlsServer(
    {
      ca: tlsCertificates.ca,
      cert: tlsCertificates.server.cert,
      key: tlsCertificates.server.key,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ALPNProtocols: [WORKER_RPC_V2_MTLS_ALPN],
    },
    (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      void (async () => {
        try {
          assert.equal(socket.authorized, true);
          assert.equal(socket.alpnProtocol, WORKER_RPC_V2_MTLS_ALPN);
          const request = await readScriptedV2Request(socket);
          const response = Buffer.from(await responder(request), "utf8");
          if (response.byteLength < 1 || response.byteLength > WORKER_RPC_MAX_RESPONSE_BYTES) {
            throw new Error("Scripted v2 TLS response exceeded its byte limit.");
          }
          socket.end(
            Buffer.concat([
              testFrameHeader(WORKER_RPC_V2_MTLS_RESPONSE_MAGIC, response.byteLength),
              response,
            ]),
          );
        } catch {
          socket.destroy();
        }
      })();
    },
  );
  server.on("tlsClientError", () => undefined);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return createMutualTlsWorkerRpcV2Transport({
    id,
    host: address.address,
    port: address.port,
    servername: "worker.policytwin.test",
    ca: tlsCertificates.ca,
    cert: tlsCertificates.client.cert,
    key: tlsCertificates.client.key,
    expectedServerCertificateSha256: tlsCertificates.server.fingerprintSha256,
    handshakeTimeoutMs: 2_000,
  });
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

test("RPC secret scanning separates opaque nonce bytes from semantic request and response text", async () => {
  const opaqueNonce = `sk-${"A".repeat(40)}`;
  const opaqueNonceBytes = Buffer.from(opaqueNonce, "base64url");
  const transport = {
    id: "opaque-nonce-secret-shape",
    authenticationMode: "MUTUAL_TLS",
    async call(canonicalRequest) {
      const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
      assert.equal(request.runNonce, opaqueNonce);
      return streamedResponse(signedResponse(request));
    },
  };
  const result = await createExternalWorkerRpcClient(
    clientOptions(transport, {
      randomBytes(size) {
        if (size === 16) return Buffer.alloc(16, 1);
        if (size === 32) return opaqueNonceBytes;
        throw new Error("Unexpected random-byte request.");
      },
    }),
  ).runRepair(input);
  assert.equal(result.runNonce, opaqueNonce);

  let outboundCalls = 0;
  const semanticOutboundTransport = {
    id: "semantic-outbound-secret-rejected",
    authenticationMode: "MUTUAL_TLS",
    async call() {
      outboundCalls += 1;
      throw new Error("Semantic secrets must be rejected before transport.");
    },
  };
  const outboundClient = createExternalWorkerRpcClient(clientOptions(semanticOutboundTransport));
  const credentialAssignmentName = ["OPENAI", "API", "KEY"].join("_");
  await assert.rejects(
    outboundClient.runRepair({
      ...input,
      policySummary: `${credentialAssignmentName}=sk-${"S".repeat(24)}`,
    }),
    /sensitive or personal-path content/u,
  );
  await assert.rejects(
    outboundClient.runRepair({
      ...input,
      sourcePolicy: `${input.sourcePolicy}\nBearer ${"T".repeat(24)}`,
    }),
    /sensitive or personal-path content/u,
  );
  assert.equal(outboundCalls, 0);

  const semanticSecretTransport = {
    id: "semantic-secret-rejected",
    authenticationMode: "MUTUAL_TLS",
    async call(canonicalRequest) {
      const request = parseWorkerRpcRequest(JSON.parse(canonicalRequest));
      const report = liveReport(request);
      report.review.summary = `sk-${"Z".repeat(24)}`;
      return streamedResponse(
        signedResponse(request, { reportOverrides: { review: report.review } }),
      );
    },
  };
  await assert.rejects(
    createExternalWorkerRpcClient(clientOptions(semanticSecretTransport)).runRepair(input),
    /sensitive or personal-path content/u,
  );
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

test("Worker RPC v2 accepts one signed live result and binds a coordinator run identity", async (t) => {
  const observedRequests = [];
  const transport = await createScriptedV2Transport(
    t,
    async (request) => {
      observedRequests.push(request);
      return signedV2Response(request, {
        supervisorRunId: `live-${request.requestId}`,
      });
    },
    "signed-v2-test-transport",
  );
  const client = createExternalWorkerRpcV2Client(
    v2ClientOptions(transport, { now: () => new Date("2026-07-18T08:00:00.000Z") }),
  );
  const result = await client.runRepair(input);
  const observedRequest = observedRequests[0];
  assert.equal(observedRequest.schemaVersion, "2");
  assert.equal(observedRequest.protocol, "policytwin.codex.repair.v2");
  assert.equal(result.executionBindingSha256, observedRequest.executionBindingSha256);
  assert.equal(result.inputSha256, workerRpcSha256(input));
  assert.equal(result.receipt.cpuEvidence.outcome, "OBSERVED_WITHIN_BUDGET");
  assert.equal(result.receipt.cpuEvidence.aggregateUsageUsec, "100");
  assert.equal(result.receipt.cpuEvidence.hardLimitEnforced, false);
  assert.equal(result.receipt.cpuEvidence.overshootBounded, false);
  assert.throws(
    () => consumeValidatedExternalWorkerV2Run(structuredClone(result)),
    /fresh result issued by the authenticated external worker/u,
  );
  consumeValidatedExternalWorkerV2Run(result);
  assert.throws(
    () => consumeValidatedExternalWorkerV2Run(result),
    /fresh result issued by the authenticated external worker/u,
  );
  assert.throws(
    () =>
      policyTwin.createAuthenticatedExternalWorkerRepairRunExecutionPort({
        async runRepair() {
          return result;
        },
      }),
    /exact external worker v2 client/u,
  );
  const repository = new policyTwin.SQLiteRepairRunRepository(":memory:");
  const authenticatedPort = policyTwin.createAuthenticatedExternalWorkerRepairRunExecutionPort(client);
  const clock = (() => {
    let milliseconds = Date.parse("2026-07-18T08:00:00.000Z");
    return () => new Date(milliseconds++);
  })();
  const coordinator = new policyTwin.RepairRunCoordinator(
    repository,
    authenticatedPort,
    { now: clock },
  );
  const started = coordinator.start({
    clientRequestId: "77777777-7777-4777-8777-777777777777",
    sessionToken: Buffer.alloc(32, 9).toString("base64url"),
    input,
  });
  await coordinator.waitForRun(started.run.id);
  const completed = repository.getRunForSession(
    started.run.id,
    policyTwin.repairRunSessionSha256(Buffer.alloc(32, 9).toString("base64url")),
  );
  assert.equal(
    completed.status,
    "SUCCEEDED",
    JSON.stringify({
      completed,
      observedRequestIds: observedRequests.map((request) => request.requestId),
      events: repository.listEventsForSession(
        started.run.id,
        policyTwin.repairRunSessionSha256(Buffer.alloc(32, 9).toString("base64url")),
      ),
    }),
  );
  assert.equal(completed.executionMode, "LIVE_CODEX_SDK");
  assert.equal(observedRequests[1].requestId, started.run.id.slice(3));
  assert.equal(completed.result.externalRequestId, started.run.id.slice(3));
  assert.equal(
    completed.result.executionBindingSha256,
    observedRequests[1].executionBindingSha256,
  );
  assert.equal(completed.result.verification.total, 41);
  assert.equal(completed.result.review.verdict, "APPROVE");
  const replayCoordinator = new policyTwin.RepairRunCoordinator(
    repository,
    {
      readiness: () => ({ ready: true }),
      async execute() {
        return result;
      },
    },
    { now: clock },
  );
  const replay = replayCoordinator.start({
    clientRequestId: "78787878-7878-4787-8787-787878787878",
    sessionToken: Buffer.alloc(32, 9).toString("base64url"),
    input,
  });
  await replayCoordinator.waitForRun(replay.run.id);
  assert.equal(
    repository.getRunForSession(
      replay.run.id,
      policyTwin.repairRunSessionSha256(Buffer.alloc(32, 9).toString("base64url")),
    ).status,
    "POISONED",
  );
  repository.close();
});

test("Worker RPC v2 rejects local-socket transport and reused v1 key material at construction", async () => {
  const selfDeclaredTransport = {
    id: "v2-self-declared-mtls-rejected",
    authenticationMode: "MUTUAL_TLS",
    async call() {
      throw new Error("must not run");
    },
  };
  assert.throws(
    () => createExternalWorkerRpcV2Client(v2ClientOptions(selfDeclaredTransport)),
    /must be created by the concrete mutual TLS v2 transport factory/u,
  );

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

  const transportOptions = {
    id: "factory-capability-test",
    host: "127.0.0.1",
    port: 1,
    servername: "worker.policytwin.test",
    ca: "test-ca",
    cert: "test-client-cert",
    key: "test-client-key",
    expectedServerCertificateSha256: "0".repeat(64),
  };
  const v1Transport = createMutualTlsWorkerRpcTransport(transportOptions);
  assert.throws(
    () => createExternalWorkerRpcV2Client(v2ClientOptions(v1Transport)),
    /must be created by the concrete mutual TLS v2 transport factory/u,
  );

  const v2Transport = createMutualTlsWorkerRpcV2Transport({
    ...transportOptions,
    id: "factory-capability-test-v2",
  });
  assert.doesNotThrow(() => createExternalWorkerRpcV2Client(v2ClientOptions(v2Transport)));
  assert.equal(Object.isFrozen(v2Transport), true);
  for (const forged of [
    { ...v2Transport },
    {
      id: v2Transport.id,
      authenticationMode: v2Transport.authenticationMode,
      call: (...args) => v2Transport.call(...args),
    },
  ]) {
    assert.throws(
      () => createExternalWorkerRpcV2Client(v2ClientOptions(forged)),
      /must be created by the concrete mutual TLS v2 transport factory/u,
    );
  }
  assert.equal("registerMutualTlsWorkerRpcV2TransportInternal" in policyTwin, false);
  assert.equal("assertMutualTlsWorkerRpcV2Transport" in policyTwin, false);
  await assert.rejects(
    import("policytwin/dist/codex/worker-rpc-transport-capability.js"),
    /Package subpath .* is not defined by "exports"/u,
  );

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

test("Worker RPC v2 rejects v1 downgrade, static evidence, and evidence-less PASS", async (t) => {
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
          cpuEvidence: {
            schemaVersion: "1",
            status: "STATIC_FAKE_CONTROLLER_VERIFIED",
            samplingMode: "SERIAL_SUPERVISOR_FAKE",
          },
        });
      },
      pattern: /CPU evidence v2|unknown or missing/u,
    },
    {
      name: "evidence-less PASS",
      body(request) {
        return signedV2Response(request, { cpuEvidence: null });
      },
      pattern: /CPU evidence v2/u,
    },
  ]) {
    await t.test(scenario.name, async (scenarioTest) => {
      const transport = await createScriptedV2Transport(
        scenarioTest,
        async (request) => scenario.body(request),
        `v2-${scenario.name.replaceAll(" ", "-")}`,
      );
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
          response.receipt.cpuEvidence.requestId = "f".repeat(32);
          response.receipt.cpuEvidence.cpuEvidenceSha256 =
            liveLinuxCgroupCpuEvidenceV2Sha256(response.receipt.cpuEvidence);
          response.resultSha256 = workerRpcSha256({
            report: response.report,
            error: response.error,
            cpuEvidenceSha256: response.receipt.cpuEvidence.cpuEvidenceSha256,
          });
        },
      },
      options: {},
      pattern: /request ID binding/u,
    },
    {
      name: "request budget drift",
      responseOptions: {
        mutateBeforeSign(response) {
          response.receipt.cpuEvidence.budgetUsec = String(
            BigInt(response.receipt.cpuEvidence.budgetUsec) + 1n,
          );
          response.receipt.cpuEvidence.cpuEvidenceSha256 =
            liveLinuxCgroupCpuEvidenceV2Sha256(response.receipt.cpuEvidence);
          response.resultSha256 = workerRpcSha256({
            report: response.report,
            error: response.error,
            cpuEvidenceSha256: response.receipt.cpuEvidence.cpuEvidenceSha256,
          });
        },
      },
      options: {},
      pattern: /request budget/u,
    },
    {
      name: "signed failure request budget drift",
      responseOptions: {
        status: "FAIL",
        mutateBeforeSign(response) {
          response.receipt.cpuEvidence.budgetUsec = String(
            BigInt(response.receipt.cpuEvidence.budgetUsec) + 1n,
          );
          response.receipt.cpuEvidence.cpuEvidenceSha256 =
            liveLinuxCgroupCpuEvidenceV2Sha256(response.receipt.cpuEvidence);
          response.resultSha256 = workerRpcSha256({
            report: response.report,
            error: response.error,
            cpuEvidenceSha256: response.receipt.cpuEvidence.cpuEvidenceSha256,
          });
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
    await t.test(scenario.name, async (scenarioTest) => {
      const transport = await createScriptedV2Transport(
        scenarioTest,
        async (request) => signedV2Response(request, scenario.responseOptions),
        `v2-${scenario.name.replaceAll(" ", "-")}`,
      );
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

test("Worker RPC v2 signature covers the global CPU event transcript", async (t) => {
  const transport = await createScriptedV2Transport(
    t,
    async (request) =>
      signedV2Response(request, {
        mutateAfterSign(response) {
          response.receipt.cpuEvidence.events[7].monotonicNs = "171";
          response.receipt.cpuEvidence.eventTranscriptSha256 =
            liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
              requestId: response.requestId,
              runNonce: response.runNonce,
              requestSha256: response.requestSha256,
              executionBindingSha256: response.executionBindingSha256,
              supervisorRunId: response.receipt.supervisorRunId,
              controllerIdentitySha256:
                response.receipt.cpuEvidence.controllerIdentitySha256,
              clock: response.receipt.cpuEvidence.clock,
              events: response.receipt.cpuEvidence.events,
            });
          response.receipt.cpuEvidence.cpuEvidenceSha256 =
            liveLinuxCgroupCpuEvidenceV2Sha256(response.receipt.cpuEvidence);
          response.resultSha256 = workerRpcSha256({
            report: response.report,
            error: response.error,
            cpuEvidenceSha256: response.receipt.cpuEvidence.cpuEvidenceSha256,
          });
        },
      }),
    "v2-proof-signature-tamper",
  );
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /v2 supervisor signature is invalid/u,
  );
});

test("Worker RPC v2 FAIL cannot carry within-budget success CPU evidence", async (t) => {
  const transport = await createScriptedV2Transport(
    t,
    async (request) =>
      signedV2Response(request, {
        status: "FAIL",
        cpuEvidence: createSuccessCpuEvidenceV2(request),
      }),
    "v2-fail-proof-confusion",
  );
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /status is inconsistent with its CPU evidence outcome/u,
  );
});

test("Worker RPC v2 signs typed pre-execution failure evidence and rejects it fail-closed", async (t) => {
  const transport = await createScriptedV2Transport(
    t,
    async (request) => signedV2Response(request, { status: "FAIL" }),
    "v2-typed-pre-execution-failure",
  );
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /worker failed safely/u,
  );
});

test("Worker RPC v2 validates signed execution and containment failures before failing closed", async (t) => {
  const scenarios = [
    {
      name: "non-CPU execution failure",
      evidence(request) {
        return createSuccessCpuEvidenceV2(request, {
          outcome: "EXECUTION_NON_CPU_FAILURE",
        });
      },
      receiptOverrides: {},
    },
    {
      name: "contained CPU overage",
      evidence: (request) => createObservedBudgetFailureCpuEvidenceV2(request),
      receiptOverrides: {},
    },
    {
      name: "incomplete containment",
      evidence: (request) =>
        createObservedBudgetFailureCpuEvidenceV2(request, { incomplete: true }),
      receiptOverrides: {
        processTreeReaped: false,
        remainingProcessCount: 1,
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (scenarioTest) => {
      const transport = await createScriptedV2Transport(
        scenarioTest,
        async (request) =>
          signedV2Response(request, {
            status: "FAIL",
            cpuEvidence: scenario.evidence(request),
            receiptOverrides: scenario.receiptOverrides,
          }),
        `v2-${scenario.name.replaceAll(" ", "-")}`,
      );
      await assert.rejects(
        createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
        /worker failed safely/u,
      );
    });
  }
});

test("Worker RPC v2 signature covers typed failure evidence and its result hash", async (t) => {
  const transport = await createScriptedV2Transport(
    t,
    async (request) =>
      signedV2Response(request, {
        status: "FAIL",
        mutateAfterSign(response) {
          response.receipt.cpuEvidence.rejectionStage = "CONTROLLER_INITIALIZATION";
          response.receipt.cpuEvidence.rejectionCode = "CONTROLLER_UNAVAILABLE";
          response.receipt.cpuEvidence.cpuEvidenceSha256 =
            liveLinuxCgroupCpuEvidenceV2Sha256(response.receipt.cpuEvidence);
          response.resultSha256 = workerRpcSha256({
            report: response.report,
            error: response.error,
            cpuEvidenceSha256: response.receipt.cpuEvidence.cpuEvidenceSha256,
          });
        },
      }),
    "v2-failure-evidence-signature-tamper",
  );
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /v2 supervisor signature is invalid/u,
  );
});

test("Worker RPC v2 rejects freshly signed failure evidence with a stale result hash", async (t) => {
  const transport = await createScriptedV2Transport(
    t,
    async (request) =>
      signedV2Response(request, {
        status: "FAIL",
        mutateBeforeSign(response) {
          response.receipt.cpuEvidence.rejectionStage = "CONTROLLER_INITIALIZATION";
          response.receipt.cpuEvidence.rejectionCode = "CONTROLLER_UNAVAILABLE";
          response.receipt.cpuEvidence.cpuEvidenceSha256 =
            liveLinuxCgroupCpuEvidenceV2Sha256(response.receipt.cpuEvidence);
        },
      }),
    "v2-failure-evidence-stale-result-hash",
  );
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /result digest does not match its body and CPU evidence/u,
  );
});

test("Worker RPC v2 rejects the legacy nullable cpuProof receipt field", async (t) => {
  const transport = await createScriptedV2Transport(
    t,
    async (request) =>
      signedV2Response(request, {
        status: "FAIL",
        receiptOverrides: { cpuProof: null },
      }),
    "v2-legacy-nullable-cpu-proof",
  );
  await assert.rejects(
    createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
    /supervisor receipt must contain exactly|unknown or missing/u,
  );
});

test("Worker RPC v2 rejects execution-mode and final-tree contradictions on signed FAIL", async (t) => {
  for (const scenario of [
    {
      name: "pre-execution changed tree",
      responseOptions: {
        status: "FAIL",
        receiptOverrides: {
          finalExecutionTreeSha256: FINAL_TREE_DIGEST,
          finalExecutionTreeManifest: FINAL_TREE_MANIFEST,
        },
      },
    },
    {
      name: "non-CPU failure marked not started",
      responseOptions(request) {
        return {
          status: "FAIL",
          cpuEvidence: createSuccessCpuEvidenceV2(request, {
            outcome: "EXECUTION_NON_CPU_FAILURE",
          }),
          receiptOverrides: { executionMode: "NOT_STARTED" },
        };
      },
    },
    {
      name: "started over-budget failure marked not started",
      responseOptions(request) {
        return {
          status: "FAIL",
          cpuEvidence: createObservedBudgetFailureCpuEvidenceV2(request),
          receiptOverrides: {
            executionMode: "NOT_STARTED",
            finalExecutionTreeSha256: request.policy.baselineExecutionTreeSha256,
            finalExecutionTreeManifest: request.policy.baselineExecutionTreeManifest,
          },
        };
      },
    },
  ]) {
    await t.test(scenario.name, async (scenarioTest) => {
      const transport = await createScriptedV2Transport(
        scenarioTest,
        async (request) =>
          signedV2Response(
            request,
            typeof scenario.responseOptions === "function"
              ? scenario.responseOptions(request)
              : scenario.responseOptions,
          ),
        `v2-${scenario.name.replaceAll(" ", "-")}`,
      );
      await assert.rejects(
        createExternalWorkerRpcV2Client(v2ClientOptions(transport)).runRepair(input),
        /teardown state contradicts its CPU evidence|execution mode contradicts its signed tree or CPU evidence/u,
      );
    });
  }
});
