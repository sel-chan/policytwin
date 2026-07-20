import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import * as rootExports from "../../dist/index.js";
import { createLocalChallengeCodexSdkBackend } from "../../dist/codex/sdk-adapter.js";
import {
  validateLocalChallengeDirectory,
  validateLocalChallengeRun,
  validateLocalChallengeSchemaContract,
  renderLocalChallengeSummary,
} from "../../scripts/local-challenge-contract.mjs";
import {
  assertSafeLocalChallengeRepair,
  buildLocalChallengeEnvironment,
} from "../../scripts/local-challenge.mjs";
import {
  acquireLocalChallengeRunLock,
  releaseLocalChallengeRunLock,
  retireLocalChallengeRunLockAfterOperatorReview,
  withLocalChallengeRunLock,
  withLocalChallengeRunLockSync,
} from "../../scripts/local-challenge-lock.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonicalSourcePolicy = readFileSync(
  resolve(process.cwd(), "fixtures", "interpreter", "seeded-refund-policy.txt"),
  "utf8",
);
const canonicalPolicyIr = JSON.parse(
  readFileSync(resolve(process.cwd(), "artifacts", "evidence", "policy-ir.json"), "utf8"),
);
const canonicalAcceptedCases = [
  ...JSON.parse(
    readFileSync(resolve(process.cwd(), "artifacts", "evidence", "golden-cases.json"), "utf8"),
  ),
  ...JSON.parse(
    readFileSync(resolve(process.cwd(), "artifacts", "evidence", "generated-cases.json"), "utf8"),
  ),
];
const diff = [
  "diff --git a/src/refund.ts b/src/refund.ts",
  "--- a/src/refund.ts",
  "+++ b/src/refund.ts",
  "@@ -1,1 +1,1 @@",
  "-before",
  "+after",
  "diff --git a/tests/refund.test.mjs b/tests/refund.test.mjs",
  "--- a/tests/refund.test.mjs",
  "+++ b/tests/refund.test.mjs",
  "@@ -1,1 +1,1 @@",
  "-skip",
  "+test",
  "",
].join("\n");

function validRun() {
  const repairRunId = "thread-repair-000000001";
  const preCommandTreeSha256 = "5".repeat(64);
  const postCommandTreeSha256 = "6".repeat(64);
  const receipts = [
    {
      schemaVersion: "1",
      commandId: "fixture-typecheck",
      exitCode: 0,
      timedOut: false,
      durationMs: 10,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      fixtureTreeBeforeSha256: preCommandTreeSha256,
      fixtureTreeAfterSha256: postCommandTreeSha256,
      attempt: 1,
      repairRunId,
    },
    {
      schemaVersion: "1",
      commandId: "fixture-test",
      exitCode: 0,
      timedOut: false,
      durationMs: 20,
      stdout: "seven tests passed",
      stderr: "",
      outputTruncated: false,
      fixtureTreeBeforeSha256: postCommandTreeSha256,
      fixtureTreeAfterSha256: postCommandTreeSha256,
      attempt: 1,
      repairRunId,
    },
  ];
  const results = canonicalAcceptedCases.map((policyCase) => ({
    caseId: policyCase.id,
    expectedDecision: policyCase.expectedDecision,
    actualDecision: policyCase.expectedDecision,
    status: "PASS",
    error: null,
  }));
  return {
    schemaVersion: "1",
    profile: "LOCAL_CHALLENGE",
    status: "LOCAL_CHALLENGE_PASS",
    model: "gpt-5.6-sol",
    surface: "CODEX_CLI_OUTPUT_SCHEMA",
    authentication: {
      mode: "EXISTING_CODEX_LOGIN_TEMPORARY_AUTH_COPY",
      explicitApiKeyProvided: false,
      credentialMaterialCaptured: false,
      temporaryAuthCopyCreated: true,
      temporaryAuthCopyRemovedBeforeEvidence: true,
      temporaryAuthDirectoryRestricted: true,
    },
    tooling: {
      sdkVersion: "0.144.6",
      bundledCliVersion: "0.144.6",
      externalCliVersion: "0.144.0",
      modelMetadataFallbackPhases: ["cartography", "repair", "review"],
    },
    provenance: {
      runId: "lc_0123456789abcdef",
      repositoryCommit: "a".repeat(40),
      sourceInputSha256: digest(canonicalSourcePolicy),
      acceptedPolicyIrSha256: digest(JSON.stringify(canonicalPolicyIr)),
      acceptedCorpusSha256: digest(JSON.stringify(canonicalAcceptedCases)),
      promptSha256s: {
        cartography: "e".repeat(64),
        repair: "f".repeat(64),
        review: "1".repeat(64),
      },
      outputSchemaSha256s: {
        cartography: "2".repeat(64),
        repair: "3".repeat(64),
        review: "4".repeat(64),
      },
    },
    repair: {
      status: "PASS",
      cartographyThreadId: "thread-cartography-0001",
      repairThreadIds: [repairRunId],
      changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
      preCommandTreeSha256,
      postCommandTreeSha256,
      diffSha256: digest(diff),
    },
    commands: {
      status: "PASS",
      orderedIds: ["fixture-typecheck", "fixture-test"],
      receipts,
      receiptsSha256: digest(JSON.stringify(receipts)),
    },
    policyVerification: {
      status: "PASS",
      total: 41,
      passed: 41,
      drift: 0,
      results,
      resultsSha256: digest(JSON.stringify(results)),
    },
    review: {
      status: "PASS",
      threadId: "thread-review-000000001",
      verdict: "APPROVE",
      blockingFindings: 0,
    },
    claims: {
      productionIsolationVerified: false,
      authoritativeVerifyLive: false,
      releaseEvidenceEligible: false,
      responsesApiDirectlyVerified: false,
      cgroupV2Verified: false,
      liveAttestationPresent: false,
    },
    startedAt: "2026-07-20T00:00:00.000Z",
    completedAt: "2026-07-20T00:01:00.000Z",
  };
}

test("local challenge factory is explicit, non-root-exported, and leaves host live construction separate", () => {
  assert.equal("createLocalChallengeCodexSdkBackend" in rootExports, false);
  assert.throws(
    () =>
      createLocalChallengeCodexSdkBackend({
        acknowledgedNonProduction: false,
        client: { startThread() { throw new Error("not called"); } },
        fixtureRoot: process.cwd(),
        model: "gpt-5.6-sol",
        prompts: { cartographer: "a", repair: "b", repairReport: "c", reviewer: "d" },
        timeouts: { cartographyMs: 1, repairMs: 1, reviewMs: 1 },
      }),
    /explicit non-production acknowledgement/u,
  );
  const backend = createLocalChallengeCodexSdkBackend({
    acknowledgedNonProduction: true,
    client: { startThread() { throw new Error("not called"); } },
    fixtureRoot: process.cwd(),
    model: "gpt-5.6-sol",
    prompts: { cartographer: "a", repair: "b", repairReport: "c", reviewer: "d" },
    timeouts: { cartographyMs: 1, repairMs: 1, reviewMs: 1 },
  });
  assert.equal(backend.executionMode, "LIVE_CODEX_SDK");
});

test("local challenge SDK environment preserves login locations and excludes provider secrets", () => {
  const result = buildLocalChallengeEnvironment({
    USERPROFILE: "C:\\Users\\builder",
    PATH: "C:\\tools",
    OPENAI_API_KEY: "must-not-pass",
    CODEX_API_KEY: "must-not-pass",
    POLICYTWIN_RUN_TOKEN: "should-not-pass",
  });
  assert.equal(result.USERPROFILE, "C:\\Users\\builder");
  assert.equal(result.PATH, "C:\\tools");
  assert.equal(result.CODEX_HOME, "C:\\Users\\builder\\.codex");
  assert.equal("OPENAI_API_KEY" in result, false);
  assert.equal("CODEX_API_KEY" in result, false);
  assert.equal("POLICYTWIN_RUN_TOKEN" in result, false);
  const isolated = buildLocalChallengeEnvironment(
    { USERPROFILE: "C:\\Users\\builder", PATH: "C:\\tools" },
    "C:\\Temp\\policytwin-codex-home-test",
  );
  assert.equal(isolated.CODEX_HOME, "C:\\Temp\\policytwin-codex-home-test");
});

test("local challenge run lock is exclusive, owner-bound, and held for the full operation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-local-challenge-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockDirectory = join(root, ".tmp", "local-challenge-lock", "active");

  const first = acquireLocalChallengeRunLock(root);
  assert.equal(existsSync(lockDirectory), true);
  assert.throws(
    () => acquireLocalChallengeRunLock(root),
    /operation is active/u,
  );
  releaseLocalChallengeRunLock(first);
  assert.equal(existsSync(lockDirectory), false);

  const result = await withLocalChallengeRunLock(root, async () => {
    assert.equal(existsSync(lockDirectory), true);
    return "LOCK_HELD";
  });
  assert.equal(result, "LOCK_HELD");
  assert.equal(existsSync(lockDirectory), false);

  await assert.rejects(
    withLocalChallengeRunLock(root, async () => {
      throw new Error("bounded operation failed");
    }),
    /bounded operation failed/u,
  );
  assert.equal(existsSync(lockDirectory), false);

  const syncResult = withLocalChallengeRunLockSync(root, () => {
    assert.equal(existsSync(lockDirectory), true);
    return "SYNC_LOCK_HELD";
  });
  assert.equal(syncResult, "SYNC_LOCK_HELD");
  assert.equal(existsSync(lockDirectory), false);

  await assert.rejects(
    withLocalChallengeRunLock(root, async () => {
      await writeFile(join(lockDirectory, "unexpected.txt"), "preserve\n", "utf8");
      throw new Error("operation failed before a changed lock release");
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 2 &&
      /operation failed/u.test(error.errors[0].message) &&
      /must contain only its regular owner record/u.test(error.errors[1].message),
  );
  assert.equal(
    await readFile(join(lockDirectory, "unexpected.txt"), "utf8"),
    "preserve\n",
  );
});

test("a dead owner requires explicit reviewed retirement and preserves tombstones", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-local-challenge-dead-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "local-challenge-lock.mjs"),
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { acquireLocalChallengeRunLock } from ${JSON.stringify(moduleUrl)}; acquireLocalChallengeRunLock(process.argv[1]);`,
      root,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      },
      shell: false,
      windowsHide: true,
      timeout: 10_000,
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);

  const lockRoot = join(root, ".tmp", "local-challenge-lock");
  assert.equal(existsSync(join(lockRoot, "active")), true);
  assert.throws(
    () => acquireLocalChallengeRunLock(root),
    /explicit operator-reviewed retirement is required/u,
  );
  const staleOwner = JSON.parse(
    await readFile(join(lockRoot, "active", "owner.json"), "utf8"),
  );
  assert.throws(
    () =>
      retireLocalChallengeRunLockAfterOperatorReview(root, {
        expectedNonce: staleOwner.nonce,
        confirmedNoDescendantProcesses: false,
      }),
    /explicit confirmation that no descendant process remains/u,
  );
  const retirement = retireLocalChallengeRunLockAfterOperatorReview(root, {
    expectedNonce: staleOwner.nonce,
    confirmedNoDescendantProcesses: true,
  });
  assert.equal(retirement.status, "RETIRED_AFTER_OPERATOR_REVIEW");
  assert.equal(retirement.automatedDescendantProof, false);
  const recovered = acquireLocalChallengeRunLock(root);
  releaseLocalChallengeRunLock(recovered);
  assert.equal(existsSync(join(lockRoot, "active")), false);
  const retired = (await readdir(lockRoot)).filter((name) => name.startsWith("retired-"));
  assert.equal(retired.length, 2);
});

test("a live child process owns the local challenge run lock exclusively", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-local-challenge-live-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "local-challenge-lock.mjs"),
  ).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { acquireLocalChallengeRunLock, releaseLocalChallengeRunLock } from ${JSON.stringify(moduleUrl)}; const handle=acquireLocalChallengeRunLock(process.argv[1]); process.stdout.write("LOCKED\\n"); process.stdin.once("data",()=>{ releaseLocalChallengeRunLock(handle); }); process.stdin.resume();`,
      root,
    ],
    {
      env: {
        PATH: process.env.PATH ?? "",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const ready = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error("lock child readiness timed out")), 10_000);
    child.once("error", rejectReady);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      resolveReady(chunk.toString("utf8"));
    });
  });
  assert.equal(ready, "LOCKED\n");
  assert.throws(
    () => acquireLocalChallengeRunLock(root),
    /operation is active/u,
  );
  child.stdin.end("release\n");
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  assert.equal(exitCode, 0);
  assert.equal(existsSync(join(root, ".tmp", "local-challenge-lock", "active")), false);
});

test("local challenge executes only the reviewed pure source subset and exact test enablement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-local-trusted-repair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  const expectedSource = await readFile(
    join(process.cwd(), "fixtures", "refund-demo", "expected-fixed", "src", "refund.ts"),
    "utf8",
  );
  const baselineTest = await readFile(
    join(process.cwd(), "fixtures", "refund-demo", "baseline", "tests", "refund.test.mjs"),
    "utf8",
  );
  await writeFile(join(root, "src", "refund.ts"), expectedSource, "utf8");
  await writeFile(
    join(root, "tests", "refund.test.mjs"),
    baselineTest.replaceAll("test.skip(", "test("),
    "utf8",
  );
  assert.doesNotThrow(() => assertSafeLocalChallengeRepair(root));
  await writeFile(
    join(root, "src", "refund.ts"),
    expectedSource.replace(
      '  return "ALLOW";\n}',
      '  process.exit(0);\n  return "ALLOW";\n}',
    ),
    "utf8",
  );
  assert.throws(() => assertSafeLocalChallengeRepair(root), /statement kind is forbidden/u);
  await writeFile(
    join(root, "src", "refund.ts"),
    expectedSource.replace(
      "input: RefundPolicyInput",
      'input: RefundPolicyInput = process.exit(0) as never',
    ),
    "utf8",
  );
  assert.throws(() => assertSafeLocalChallengeRepair(root), /signature is outside/u);
  await writeFile(join(root, "src", "refund.ts"), `// @ts-nocheck\n${expectedSource}`, "utf8");
  assert.throws(() => assertSafeLocalChallengeRepair(root), /cannot suppress/u);
});

test("local challenge evidence is exact, hash-bound, and never production-eligible", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-local-challenge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = validRun();
  assert.equal(validateLocalChallengeSchemaContract(), true);
  await writeFile(join(root, "integration.diff"), diff, "utf8");
  await writeFile(join(root, "local-challenge-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await writeFile(
    join(root, "summary.md"),
    renderLocalChallengeSummary(run),
    "utf8",
  );
  assert.equal(validateLocalChallengeDirectory(root).status, "LOCAL_CHALLENGE_PASS");
  assert.match(renderLocalChallengeSummary(run), /MODEL_METADATA_FALLBACK in cartography, repair, review/u);

  assert.throws(
    () =>
      validateLocalChallengeRun({
        ...run,
        claims: { ...run.claims, releaseEvidenceEligible: true },
      }),
    /cannot promote/u,
  );
  for (const modelMetadataFallbackPhases of [
    ["cartography", "cartography"],
    ["review", "cartography"],
    ["unknown"],
  ]) {
    assert.throws(
      () =>
        validateLocalChallengeRun({
          ...run,
          tooling: { ...run.tooling, modelMetadataFallbackPhases },
        }),
      /tooling versions/u,
    );
  }
  assert.throws(
    () =>
      validateLocalChallengeRun({
        ...run,
        review: { ...run.review, threadId: run.repair.cartographyThreadId },
      }),
    /distinct Codex thread IDs/u,
  );
  assert.throws(
    () =>
      validateLocalChallengeRun({
        ...run,
        commands: {
          ...run.commands,
          receipts: [
            { ...run.commands.receipts[0], stdout: "tampered" },
            run.commands.receipts[1],
          ],
        },
      }),
    /receipt digest/u,
  );
  const mixedAttempts = run.commands.receipts.map((receipt, index) => ({
    ...receipt,
    attempt: index === 0 ? 1 : 2,
  }));
  assert.throws(
    () =>
      validateLocalChallengeRun({
        ...run,
        commands: {
          ...run.commands,
          receipts: mixedAttempts,
          receiptsSha256: digest(JSON.stringify(mixedAttempts)),
        },
      }),
    /command receipt 2 is invalid/u,
  );
  const reorderedResults = [
    run.policyVerification.results[1],
    run.policyVerification.results[0],
    ...run.policyVerification.results.slice(2),
  ];
  assert.throws(
    () =>
      validateLocalChallengeRun({
        ...run,
        policyVerification: {
          ...run.policyVerification,
          results: reorderedResults,
          resultsSha256: digest(JSON.stringify(reorderedResults)),
        },
      }),
    /canonical ordered case/u,
  );
  await writeFile(join(root, "integration.diff"), `${diff}tampered\n`, "utf8");
  assert.throws(() => validateLocalChallengeDirectory(root), /does not match/u);
});
