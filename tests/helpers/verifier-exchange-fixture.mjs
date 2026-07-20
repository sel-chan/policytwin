import { Buffer } from "node:buffer";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  acceptedCorpusSha256,
  parseWorkerRpcV2Request,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
  workerRpcV2ExecutionBindingSha256,
} from "../../dist/codex/worker-rpc-contract.js";
import {
  verifierExecutionTreeSha256,
  verifierFileSha256,
  verifierReceiptHmacSha256,
  verifierReceiptSha256,
  verifierTreeSha256,
} from "../../dist/codex/verifier-exchange-contract.js";
import { createWorkerRuntimeLayout } from "../../dist/codex/worker-runtime-contract.js";

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
const baselineSource = await readFile(
  new URL("../../fixtures/refund-demo/baseline/src/refund.ts", import.meta.url),
  "utf8",
);
const baselineTest = await readFile(
  new URL("../../fixtures/refund-demo/baseline/tests/refund.test.mjs", import.meta.url),
  "utf8",
);
const baselinePackage = await readFile(
  new URL("../../fixtures/refund-demo/baseline/package.json", import.meta.url),
  "utf8",
);
const baselineTsconfig = await readFile(
  new URL("../../fixtures/refund-demo/baseline/tsconfig.json", import.meta.url),
  "utf8",
);
const fixedSource = await readFile(
  new URL("../../fixtures/refund-demo/expected-fixed/src/refund.ts", import.meta.url),
  "utf8",
);

const acceptedCases = [...goldenCases, ...generatedCases];
const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
const defectsByCase = {
  D01: ["DAY_14_INCLUSIVE"],
  D02: ["USAGE_2000_INCLUSIVE"],
  D03: ["FINAL_SALE_PRECEDENCE"],
};

const repairInput = {
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
  maxRepairAttempts: 2,
};

const baselineTreeManifest = {
  schemaVersion: "1",
  entries: [
    { path: ".", kind: "directory", mode: 16_877, mtimeMs: 1_700_000_000_000, sha256: null },
    { path: "src", kind: "directory", mode: 16_877, mtimeMs: 1_700_000_000_001, sha256: null },
    { path: "src/refund.ts", kind: "file", mode: 33_188, mtimeMs: 1_700_000_000_002, sha256: "1".repeat(64) },
    { path: "tests", kind: "directory", mode: 16_877, mtimeMs: 1_700_000_000_003, sha256: null },
    { path: "tests/refund.test.mjs", kind: "file", mode: 33_188, mtimeMs: 1_700_000_000_004, sha256: "2".repeat(64) },
  ],
};

export function verifierRequest(overrides = {}) {
  const policy = {
    schemaVersion: "1",
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: "3".repeat(64),
    baselineExecutionTreeSha256: workerRpcExecutionTreeSha256(baselineTreeManifest),
    baselineExecutionTreeManifest: baselineTreeManifest,
    acceptedCorpusSha256: acceptedCorpusSha256(repairInput),
    workerImageDigest: `sha256:${"4".repeat(64)}`,
    sdkPackage: "@openai/codex-sdk",
    sdkVersion: "0.144.6",
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
  const requestId = overrides.requestId ?? "5".repeat(32);
  const runNonce = overrides.runNonce ?? Buffer.alloc(32, 6).toString("base64url");
  const model = "gpt-codex-test";
  const inputSha256 = workerRpcSha256(repairInput);
  const policySha256 = workerRpcSha256(policy);
  return parseWorkerRpcV2Request({
    schemaVersion: "2",
    protocol: "policytwin.codex.repair.v2",
    action: "RUN_REPAIR",
    requestId,
    runNonce,
    sequence: 1,
    issuedAt: overrides.issuedAt ?? "2026-07-18T10:00:00.000Z",
    expiresAt: overrides.expiresAt ?? "2026-07-18T10:05:00.000Z",
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
    input: repairInput,
  });
}

export async function createVerifierRuntimeFixture(repositoryRoot) {
  const runId = "verifier-run-12345678";
  const layout = createWorkerRuntimeLayout({ repositoryRoot, runId });
  const baselineRoot = join(repositoryRoot, "fixtures", "refund-demo", "baseline");
  for (const path of [
    join(baselineRoot, "src"),
    join(baselineRoot, "tests"),
    join(layout.repairRoot, "src"),
    join(layout.repairRoot, "tests"),
    join(layout.verificationRoot, "src"),
    join(layout.verificationRoot, "tests"),
    join(layout.verificationRoot, "dist"),
  ]) {
    await mkdir(path, { recursive: true });
  }
  const files = [
    [join(baselineRoot, "package.json"), baselinePackage],
    [join(baselineRoot, "tsconfig.json"), baselineTsconfig],
    [join(baselineRoot, "src", "refund.ts"), baselineSource],
    [join(baselineRoot, "tests", "refund.test.mjs"), baselineTest],
    [join(layout.repairRoot, "src", "refund.ts"), fixedSource],
    [join(layout.repairRoot, "tests", "refund.test.mjs"), baselineTest],
    [join(layout.verificationRoot, "package.json"), baselinePackage],
    [join(layout.verificationRoot, "tsconfig.json"), baselineTsconfig],
    [join(layout.verificationRoot, "src", "refund.ts"), baselineSource],
    [join(layout.verificationRoot, "tests", "refund.test.mjs"), baselineTest],
    [layout.requestPath, "{}\n"],
    [layout.responsePath, "\n"],
    [layout.proxyTokenPath, `${Buffer.alloc(32, 7).toString("base64url")}\n`],
    [layout.proxyCaPath, "test-ca\n"],
  ];
  for (const [path, content] of files) await writeFile(path, content, "utf8");
  return { runId, layout };
}

function command(commandId, attempt, repairRunId, before, after) {
  return {
    schemaVersion: "1",
    commandId,
    exitCode: 0,
    timedOut: false,
    durationMs: 10,
    stdout: "ok",
    stderr: "",
    outputTruncated: false,
    fixtureTreeBeforeSha256: before,
    fixtureTreeAfterSha256: after,
    attempt,
    repairRunId,
  };
}

export async function materializeVerifierBuild(layout) {
  const declaration = Buffer.from(
    'export declare function decideRefund(input: unknown): "ALLOW" | "DENY" | "REVIEW";\n',
    "utf8",
  );
  const javascript = Buffer.from(
    'export function decideRefund(input) { return input.finalSale ? "DENY" : "ALLOW"; }\n',
    "utf8",
  );
  const declarationPath = join(layout.verificationRoot, "dist", "refund.d.ts");
  const javascriptPath = join(layout.verificationRoot, "dist", "refund.js");
  await writeFile(declarationPath, declaration);
  await writeFile(javascriptPath, javascript);
  const [directoryStat, declarationStat, javascriptStat] = await Promise.all([
    stat(join(layout.verificationRoot, "dist")),
    stat(declarationPath),
    stat(javascriptPath),
  ]);
  return {
    schemaVersion: "1",
    entries: [
      {
        path: "dist",
        kind: "directory",
        mode: directoryStat.mode & 0o7777,
        bytes: null,
        sha256: null,
      },
      {
        path: "dist/refund.d.ts",
        kind: "file",
        mode: declarationStat.mode & 0o7777,
        bytes: declaration.byteLength,
        sha256: verifierFileSha256(declaration),
      },
      {
        path: "dist/refund.js",
        kind: "file",
        mode: javascriptStat.mode & 0o7777,
        bytes: javascript.byteLength,
        sha256: verifierFileSha256(javascript),
      },
    ],
  };
}

export function verifierReceipt({
  request,
  snapshot,
  challenge,
  capability,
  finalBuildTreeManifest,
  status = "PASS",
  verifierRunId = "verifier-receipt-run-1",
  startedAt = "2026-07-18T10:01:01.000Z",
  completedAt = "2026-07-18T10:01:02.000Z",
}) {
  if (finalBuildTreeManifest === undefined) {
    throw new Error("Verifier receipt requires the observed final build manifest.");
  }
  const finalBuildTreeSha256 = verifierTreeSha256(finalBuildTreeManifest);
  const finalExecutionTreeSha256 = verifierExecutionTreeSha256(
    snapshot.sourceTreeSha256,
    finalBuildTreeSha256,
  );
  const commandEvidence = [
    command(
      "fixture-typecheck",
      snapshot.attempt,
      snapshot.repairRunId,
      snapshot.initialExecutionTreeSha256,
      finalExecutionTreeSha256,
    ),
    command(
      "fixture-test",
      snapshot.attempt,
      snapshot.repairRunId,
      finalExecutionTreeSha256,
      finalExecutionTreeSha256,
    ),
  ];
  const results = request.input.acceptedCases.map((policyCase, index) => {
    const failed = status === "FAIL" && index === 0;
    const actualDecision = failed
      ? policyCase.expectedDecision === "ALLOW" ? "DENY" : "ALLOW"
      : policyCase.expectedDecision;
    return {
      caseId: policyCase.id,
      expectedDecision: policyCase.expectedDecision,
      actualDecision,
      status: failed ? "FAIL" : "PASS",
      error: null,
    };
  });
  const policyVerification = {
    schemaVersion: "1",
    executionMode: "SERVER_OWNED_CORPUS",
    attempt: snapshot.attempt,
    repairRunId: snapshot.repairRunId,
    fixtureTreeSha256: finalExecutionTreeSha256,
    acceptedCorpusSha256: snapshot.acceptedCorpusSha256,
    policyIrSha256: snapshot.policyIrSha256,
    status,
    total: results.length,
    passed: results.filter((result) => result.status === "PASS").length,
    results,
  };
  const unsigned = {
    schemaVersion: "1",
    kind: "VERIFIER_EXCHANGE_RECEIPT",
    profile: "policytwin.verifier.exchange.v1",
    challengeId: challenge.challengeId,
    capabilitySha256: challenge.capabilitySha256,
    requestId: snapshot.requestId,
    requestSha256: snapshot.requestSha256,
    inputSha256: snapshot.inputSha256,
    policySha256: snapshot.policySha256,
    executionBindingSha256: snapshot.executionBindingSha256,
    snapshotSha256: snapshot.snapshotSha256,
    verifierImageDigest: snapshot.verifierImageDigest,
    verifierRunId,
    attempt: snapshot.attempt,
    repairRunId: snapshot.repairRunId,
    acceptedCorpusSha256: snapshot.acceptedCorpusSha256,
    policyIrSha256: snapshot.policyIrSha256,
    sourceTreeSha256: snapshot.sourceTreeSha256,
    initialBuildTreeSha256: snapshot.initialBuildTreeSha256,
    finalBuildTreeManifest,
    finalBuildTreeSha256,
    finalExecutionTreeSha256,
    commandEvidence,
    policyVerification,
    status,
    startedAt,
    completedAt,
  };
  const receiptSha256 = verifierReceiptSha256(unsigned);
  return {
    ...unsigned,
    receiptSha256,
    hmacSha256: verifierReceiptHmacSha256(capability, receiptSha256),
  };
}

export function fixedVerifierClock() {
  const state = { value: new Date("2026-07-18T10:01:00.000Z") };
  return {
    state,
    now: () => new Date(state.value.getTime()),
  };
}

function workerMetadata(request, runId, phase, overrides = {}) {
  return {
    executionMode: overrides.executionMode ?? "OFFLINE_TEST_DOUBLE",
    backendId: overrides.backendId ?? "verifier-bridge-test-backend",
    sdkVersion: overrides.sdkVersion ?? "0.144.6",
    model: overrides.model ?? request.model,
    modelReasoningEffort: overrides.modelReasoningEffort ?? request.modelReasoningEffort,
    promptTemplateSha256: overrides.promptTemplateSha256 ?? "a".repeat(64),
    requestSha256: overrides.requestSha256 ?? "b".repeat(64),
    outputSchemaSha256: overrides.outputSchemaSha256 ?? "c".repeat(64),
    runId,
    startedAt: overrides.startedAt ?? `2026-07-18T10:00:${phase === "REPAIR" ? "10" : "40"}.000Z`,
    completedAt: overrides.completedAt ?? `2026-07-18T10:00:${phase === "REPAIR" ? "20" : "50"}.000Z`,
  };
}

export function verifierBridgeRepair(request, runId = "repair-run-1", overrides = {}) {
  return {
    schemaVersion: "1",
    phase: "REPAIR",
    metadata: workerMetadata(request, runId, "REPAIR", overrides.metadata),
    changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
    summary: "Corrected the seeded refund policy boundaries and precedence.",
    rationale: ["Bind the application to the accepted policy corpus."],
    remainingRisks: [],
    verificationCommandIds: ["fixture-typecheck", "fixture-test"],
    ...overrides.result,
  };
}

export function verifierBridgeReview(request, overrides = {}) {
  return {
    schemaVersion: "1",
    phase: "REVIEW",
    metadata: workerMetadata(
      request,
      overrides.runId ?? "review-run-1",
      "REVIEW",
      {
        startedAt: overrides.startedAt ?? "2026-07-18T10:01:04.000Z",
        completedAt: overrides.completedAt ?? "2026-07-18T10:01:05.000Z",
        ...overrides.metadata,
      },
    ),
    verdict: overrides.verdict ?? "APPROVE",
    summary: overrides.summary ?? "The receipt-bound repair has no blocking findings.",
    findings: overrides.findings ?? [],
  };
}

export function verifierBridgeReviewSubmission(outcome, review) {
  const boundReview = structuredClone(review);
  boundReview.metadata.requestSha256 = outcome.reviewBindingSha256;
  return {
    schemaVersion: "1",
    kind: "VERIFIER_RECEIPT_BOUND_REVIEW_SUBMISSION",
    reviewBindingSha256: outcome.reviewBindingSha256,
    review: boundReview,
  };
}
