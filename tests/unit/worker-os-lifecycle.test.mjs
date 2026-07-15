import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acceptedCorpusSha256,
  parseWorkerRpcRequest,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
} from "../../dist/codex/worker-rpc-contract.js";
import { createPreparedSupervisorWorkerLifecycle } from "../../dist/codex/worker-os-lifecycle.js";
import { prepareWorkerEntrypointContract } from "../../dist/codex/worker-entrypoint-contract.js";

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

const baselineTree = {
  schemaVersion: "1",
  entries: [
    { path: ".", kind: "directory", mode: 16877, mtimeMs: 1_700_000_000_000, sha256: null },
    { path: "package.json", kind: "file", mode: 33188, mtimeMs: 1_700_000_000_001, sha256: "1".repeat(64) },
    { path: "src", kind: "directory", mode: 16877, mtimeMs: 1_700_000_000_002, sha256: null },
    { path: "src/refund.ts", kind: "file", mode: 33188, mtimeMs: 1_700_000_000_003, sha256: "2".repeat(64) },
    { path: "tests", kind: "directory", mode: 16877, mtimeMs: 1_700_000_000_004, sha256: null },
    { path: "tests/refund.test.mjs", kind: "file", mode: 33188, mtimeMs: 1_700_000_000_005, sha256: "3".repeat(64) },
  ],
};

function validRequest() {
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
    acceptedCases: [...goldenCases, ...generatedCases],
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
  const policy = {
    schemaVersion: "1",
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: "4".repeat(64),
    baselineExecutionTreeSha256: workerRpcExecutionTreeSha256(baselineTree),
    baselineExecutionTreeManifest: baselineTree,
    acceptedCorpusSha256: acceptedCorpusSha256(input),
    workerImageDigest: `sha256:${"5".repeat(64)}`,
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
      wallTimeMs: 120_000,
      cpuTimeMs: 60_000,
      memoryBytes: 512 * 1024 * 1024,
      pids: 32,
      outputBytes: 2 * 1024 * 1024,
    },
  };
  return parseWorkerRpcRequest({
    schemaVersion: "1",
    protocol: "policytwin.codex.repair.v1",
    action: "RUN_REPAIR",
    requestId: "6".repeat(32),
    runNonce: Buffer.alloc(32, 7).toString("base64url"),
    sequence: 1,
    issuedAt: "2026-07-15T00:00:00.000Z",
    expiresAt: "2026-07-15T00:05:00.000Z",
    model: "gpt-5.6",
    modelReasoningEffort: "high",
    inputSha256: workerRpcSha256(input),
    policySha256: workerRpcSha256(policy),
    policy,
    input,
  });
}

const completeCleanup = {
  schemaVersion: "1",
  workerContainerRemoved: true,
  verifierContainerRemoved: true,
  repairWorkspaceDeleted: true,
  verificationWorkspaceDeleted: true,
  processTreeReaped: true,
  remainingProcessCount: 0,
};

function createDriver(events, overrides = {}) {
  return {
    createHandle(request) {
      events.push("create");
      return { requestId: request.requestId };
    },
    async prepare() {
      events.push("prepare");
    },
    async runWorker() {
      events.push("worker");
      return { status: "UNTRUSTED_WORKER_OUTPUT" };
    },
    validateWorkerOutput() {
      events.push("validate-worker");
    },
    async runVerifier() {
      events.push("verifier");
      return { status: "SUPERVISOR_VERIFIED_OUTPUT" };
    },
    validateVerifierOutput() {
      events.push("validate-verifier");
    },
    async cleanup(_handle, reason) {
      events.push(`cleanup:${reason}`);
      return completeCleanup;
    },
    ...overrides,
  };
}

test("prepared OS lifecycle validates every boundary and returns only an explicit non-live result", async () => {
  const events = [];
  const lifecycle = createPreparedSupervisorWorkerLifecycle(createDriver(events));
  const result = await lifecycle.execute(validRequest(), { signal: new AbortController().signal });
  assert.deepEqual(events, [
    "create",
    "prepare",
    "worker",
    "validate-worker",
    "verifier",
    "validate-verifier",
    "cleanup:SUCCESS",
  ]);
  assert.equal(result.status, "STATIC_DRIVER_TEST_ONLY");
  assert.equal(result.dynamicIsolationVerified, false);
  assert.equal(result.liveCodexExecuted, false);
  assert.deepEqual(result.stages, [
    "REQUEST_VALIDATED",
    "HANDLE_CREATED",
    "LAYOUT_PREPARED",
    "WORKER_RESULT_VALIDATED",
    "VERIFIER_RESULT_VALIDATED",
    "SUPERVISOR_CLEANUP_VALIDATED",
  ]);
});

test("prepared worker entrypoint validates the request but cannot claim a live SDK run", () => {
  const result = prepareWorkerEntrypointContract(validRequest(), { codexHomeEntries: [] });
  assert.equal(result.status, "VALIDATED_REQUEST_LIVE_DISABLED");
  assert.equal(result.codexHomeEmpty, true);
  assert.equal(result.providerCredentialPresent, false);
  assert.equal(result.dynamicIsolationVerified, false);
  assert.equal(result.liveCodexExecuted, false);
  assert.throws(
    () => prepareWorkerEntrypointContract(validRequest(), { codexHomeEntries: ["config.toml"] }),
    /must be empty/u,
  );
});

test("prepared OS lifecycle propagates abort and still performs supervisor cleanup", async () => {
  const events = [];
  const controller = new AbortController();
  const driver = createDriver(events, {
    async runWorker() {
      events.push("worker");
      controller.abort(new Error("client disconnected"));
      return {};
    },
  });
  await assert.rejects(
    createPreparedSupervisorWorkerLifecycle(driver).execute(validRequest(), {
      signal: controller.signal,
    }),
    /client disconnected/u,
  );
  assert.deepEqual(events, ["create", "prepare", "worker", "cleanup:ABORT"]);
});

test("prepared OS lifecycle fails closed when teardown is incomplete", async () => {
  const events = [];
  const driver = createDriver(events, {
    async cleanup(_handle, reason) {
      events.push(`cleanup:${reason}`);
      return { ...completeCleanup, processTreeReaped: false, remainingProcessCount: 1 };
    },
  });
  const lifecycle = createPreparedSupervisorWorkerLifecycle(driver);
  await assert.rejects(
    lifecycle.execute(validRequest(), {
      signal: new AbortController().signal,
    }),
    /cleanup failed/u,
  );
  assert.equal(events.at(-1), "cleanup:SUCCESS");
  await assert.rejects(
    lifecycle.execute(validRequest(), { signal: new AbortController().signal }),
    /poisoned/u,
  );
});

test("prepared OS lifecycle rejects request mutation before verification and cleans the run", async () => {
  const events = [];
  const driver = createDriver(events, {
    async runWorker(_handle, request) {
      events.push("worker");
      request.model = "tampered-model";
      return {};
    },
  });
  await assert.rejects(
    createPreparedSupervisorWorkerLifecycle(driver).execute(validRequest(), {
      signal: new AbortController().signal,
    }),
    /read only|Cannot assign|changed during execution/u,
  );
  assert.equal(events.includes("verifier"), false);
  assert.equal(events.at(-1), "cleanup:FAILURE");
});

test("prepared OS lifecycle enforces a cleanup deadline even when the driver ignores abort", async () => {
  const events = [];
  const driver = createDriver(events, {
    async cleanup(_handle, reason) {
      events.push(`cleanup:${reason}`);
      return await new Promise(() => undefined);
    },
  });
  const started = Date.now();
  const lifecycle = createPreparedSupervisorWorkerLifecycle(driver, { cleanupTimeoutMs: 1_000 });
  await assert.rejects(
    lifecycle.execute(
      validRequest(),
      { signal: new AbortController().signal },
    ),
    /cleanup failed/u,
  );
  assert.ok(Date.now() - started >= 900);
  assert.ok(Date.now() - started < 2_500);
  await assert.rejects(
    lifecycle.execute(validRequest(), { signal: new AbortController().signal }),
    /poisoned/u,
  );
});

test("prepared OS lifecycle rejects a concurrent run before creating another handle", async () => {
  const events = [];
  let releaseWorker;
  const workerReleased = new Promise((resolve) => {
    releaseWorker = resolve;
  });
  const driver = createDriver(events, {
    async runWorker() {
      events.push("worker");
      await workerReleased;
      return {};
    },
  });
  const lifecycle = createPreparedSupervisorWorkerLifecycle(driver);
  const first = lifecycle.execute(validRequest(), { signal: new AbortController().signal });
  while (!events.includes("worker")) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    lifecycle.execute(validRequest(), { signal: new AbortController().signal }),
    /active run/u,
  );
  assert.equal(events.filter((event) => event === "create").length, 1);
  releaseWorker();
  await first;
});
