import assert from "node:assert/strict";
import {
  appendFile,
  access,
  chmod,
  mkdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createOfflineCodexSdkBackend } from "../../dist/codex/sdk-adapter.js";
import { orchestrateRepair, validateFixtureTreeReceipt } from "../../dist/index.js";
import {
  assertCanonicalFixtureUnchanged,
  createRepairWorkspace,
  getRepairWorkspacePaths,
  removeRepairWorkspace,
} from "../../scripts/repair-workspace.mjs";
import {
  buildSanitizedEnvironment,
  repairFixtureTreeHash,
  repairFixtureTreeReceipt,
  runRepairCommand,
} from "../../scripts/repair-command.mjs";
import { directoryHash } from "../../scripts/fixture.mjs";

const runId = `offline-contract-${process.pid}`;

const sourcePolicy = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const acceptedPolicyIr = JSON.parse(
  await readFile(
    new URL("../../artifacts/evidence/policy-ir.json", import.meta.url),
    "utf8",
  ),
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
const prompts = {
  cartographer: await readFile(
    new URL("../../prompts/cartographer.v1.md", import.meta.url),
    "utf8",
  ),
  repair: await readFile(new URL("../../prompts/repair.v1.md", import.meta.url), "utf8"),
  reviewer: await readFile(new URL("../../prompts/reviewer.v1.md", import.meta.url), "utf8"),
};

function sdkInput() {
  const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
  const defectsByCase = {
    D01: ["DAY_14_INCLUSIVE"],
    D02: ["USAGE_2000_INCLUSIVE"],
    D03: ["FINAL_SALE_PRECEDENCE"],
  };
  return {
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
}

async function verifyAcceptedCorpus(fixtureRoot, input, context) {
  let decideRefund;
  try {
    const moduleUrl = pathToFileURL(`${fixtureRoot}/dist/refund.js`);
    moduleUrl.searchParams.set("verification", `${process.pid}-${Date.now()}`);
    ({ decideRefund } = await import(moduleUrl.href));
  } catch {
    const results = input.acceptedCases.map((policyCase) => ({
      caseId: policyCase.id,
      expectedDecision: policyCase.expectedDecision,
      actualDecision: null,
      status: "ERROR",
      error: "The repaired fixture evaluator could not be loaded.",
    }));
    return {
      schemaVersion: "1",
      executionMode: "SERVER_OWNED_CORPUS",
      attempt: context.attempt,
      repairRunId: context.repairRunId,
      fixtureTreeSha256: context.fixtureTreeSha256,
      acceptedCorpusSha256: context.acceptedCorpusSha256,
      policyIrSha256: context.policyIrSha256,
      status: "FAIL",
      total: results.length,
      passed: 0,
      results,
    };
  }

  const results = input.acceptedCases.map((policyCase) => {
    try {
      const actualDecision = decideRefund(policyCase.input);
      if (!["ALLOW", "DENY", "REVIEW"].includes(actualDecision)) {
        throw new Error("invalid decision");
      }
      return {
        caseId: policyCase.id,
        expectedDecision: policyCase.expectedDecision,
        actualDecision,
        status: actualDecision === policyCase.expectedDecision ? "PASS" : "FAIL",
        error: null,
      };
    } catch {
      return {
        caseId: policyCase.id,
        expectedDecision: policyCase.expectedDecision,
        actualDecision: null,
        status: "ERROR",
        error: "The repaired fixture evaluator failed for this accepted case.",
      };
    }
  });
  const passed = results.filter((result) => result.status === "PASS").length;
  return {
    schemaVersion: "1",
    executionMode: "SERVER_OWNED_CORPUS",
    attempt: context.attempt,
    repairRunId: context.repairRunId,
    fixtureTreeSha256: context.fixtureTreeSha256,
    acceptedCorpusSha256: context.acceptedCorpusSha256,
    policyIrSha256: context.policyIrSha256,
    status: passed === results.length ? "PASS" : "FAIL",
    total: results.length,
    passed,
    results,
  };
}

function createRepairingSdkDouble(fixtureRoot) {
  const plans = [
    {
      id: "integration-cartography",
      body: {
        relevantFiles: ["package.json", "src/refund.ts", "tests/refund.test.mjs", "tsconfig.json"],
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
            reason: "Contains the three seeded refund defects.",
          },
        ],
        dataFlow: [
          {
            file: "src/refund.ts",
            lineStart: 12,
            lineEnd: 31,
            symbol: "decideRefund",
            reason: "Input fields flow through boundary and precedence checks to a decision.",
          },
        ],
        testFiles: ["tests/refund.test.mjs"],
        risks: ["Boundary and precedence regressions need explicit tests."],
        proposedFilesToChange: ["src/refund.ts", "tests/refund.test.mjs"],
        verificationCommandIds: ["fixture-typecheck", "fixture-test"],
      },
    },
    {
      id: "integration-repair",
      body: {
        summary: "Corrected inclusive boundaries and final-sale precedence.",
        rationale: ["The observed drift witnesses now match the accepted policy."],
        remainingRisks: [],
        verificationCommandIds: ["fixture-typecheck", "fixture-test"],
      },
      fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
      async mutate() {
        const sourcePath = `${fixtureRoot}/src/refund.ts`;
        const original = await readFile(sourcePath, "utf8");
        const fixed = original.replace(
          'export function decideRefund(input: RefundPolicyInput): Decision {\n  const withinWindow = input.daysSincePurchase < 14;\n  const withinUsage = input.usageBasisPoints < 2000;\n\n  if (input.promotionalPurchase && input.managerApproved) {\n    return "ALLOW";\n  }\n\n  if (input.finalSale) {\n    return "DENY";\n  }\n\n  if (!withinWindow || !withinUsage) {\n    return "DENY";\n  }\n\n  if (input.promotionalPurchase) {\n    return "REVIEW";\n  }\n\n  return "ALLOW";\n}',
          'export function decideRefund(input: RefundPolicyInput): Decision {\n  if (input.finalSale) {\n    return "DENY";\n  }\n\n  const withinWindow = input.daysSincePurchase <= 14;\n  const withinUsage = input.usageBasisPoints <= 2000;\n\n  if (!withinWindow || !withinUsage) {\n    return "DENY";\n  }\n\n  if (input.promotionalPurchase) {\n    return input.managerApproved ? "ALLOW" : "REVIEW";\n  }\n\n  return "ALLOW";\n}',
        );
        assert.notEqual(fixed, original);
        await writeFile(sourcePath, fixed, "utf8");
        const testPath = `${fixtureRoot}/tests/refund.test.mjs`;
        const testSource = await readFile(testPath, "utf8");
        const enabledTests = testSource.replaceAll("test.skip(", "test(");
        assert.notEqual(enabledTests, testSource);
        await writeFile(testPath, enabledTests, "utf8");
      },
    },
    {
      id: "integration-review",
      body: {
        verdict: "APPROVE",
        summary: "The focused implementation and regression tests cover all drift witnesses.",
        findings: [],
      },
    },
  ];
  const calls = [];
  return {
    calls,
    startThread(threadOptions) {
      const plan = plans.shift();
      if (plan === undefined) throw new Error("Unexpected SDK thread.");
      let threadId = null;
      return {
        get id() {
          return threadId;
        },
        async runStreamed(prompt, turnOptions) {
          calls.push({ threadOptions, prompt, turnOptions });
          return {
            events: (async function* () {
              threadId = plan.id;
              yield { type: "thread.started", thread_id: plan.id };
              yield { type: "turn.started" };
              if (plan.mutate) await plan.mutate();
              if (plan.fileChanges) {
                yield {
                  type: "item.completed",
                  item: {
                    id: `${plan.id}-files`,
                    type: "file_change",
                    changes: plan.fileChanges.map((path) => ({ path, kind: "update" })),
                    status: "completed",
                  },
                };
              }
              yield {
                type: "item.completed",
                item: {
                  id: `${plan.id}-message`,
                  type: "agent_message",
                  text: JSON.stringify(plan.body),
                },
              };
              yield {
                type: "turn.completed",
                usage: {
                  input_tokens: 1,
                  cached_input_tokens: 0,
                  output_tokens: 1,
                  reasoning_output_tokens: 0,
                },
              };
            })(),
          };
        },
      };
    },
  };
}

test("fresh repair workspace is baseline-identical, isolated, and disposable", async () => {
  const stale = getRepairWorkspacePaths(runId);
  removeRepairWorkspace(runId);
  const workspace = createRepairWorkspace(runId);
  try {
    assert.equal(workspace.baselineHashBefore, workspace.workspaceHashAtCreation);
    await assert.rejects(access(`${workspace.fixtureRoot}/expected-fixed/src/refund.ts`));
    await appendFile(`${workspace.fixtureRoot}/src/refund.ts`, "\n// temporary repair probe\n", "utf8");
    assert.notEqual(directoryHash(workspace.fixtureRoot), workspace.baselineHashBefore);
    assert.equal(assertCanonicalFixtureUnchanged(workspace.baselineHashBefore), workspace.baselineHashBefore);
    assert.throws(() => createRepairWorkspace(runId), /already exists/u);
  } finally {
    removeRepairWorkspace(runId);
  }
  await assert.rejects(access(stale.runRoot));
});

test("workspace IDs and command working directories cannot escape the managed root", () => {
  for (const value of ["../escape", "a/b", "C:\\escape", "", "a".repeat(65)]) {
    assert.throws(() => getRepairWorkspacePaths(value));
  }
  assert.throws(
    () => runRepairCommand(process.cwd(), "fixture-test", "OFFLINE_TEST_DOUBLE"),
    /not a managed fixture/u,
  );
});

test("sanitized command environment excludes model credentials and fixture tests pass", () => {
  const environment = buildSanitizedEnvironment({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    OPENAI_API_KEY: "must-not-pass",
    CODEX_API_KEY: "must-not-pass",
  });
  assert.equal("OPENAI_API_KEY" in environment, false);
  assert.equal("CODEX_API_KEY" in environment, false);

  const commandRunId = `${runId}-command`;
  removeRepairWorkspace(commandRunId);
  const workspace = createRepairWorkspace(commandRunId);
  try {
    assert.throws(
      () => runRepairCommand(workspace.fixtureRoot, "fixture-test", "LIVE_CODEX_SDK"),
      /externally isolated/u,
    );
    const typecheck = runRepairCommand(
      workspace.fixtureRoot,
      "fixture-typecheck",
      "OFFLINE_TEST_DOUBLE",
    );
    assert.equal(typecheck.exitCode, 0, typecheck.stderr);
    const evidence = runRepairCommand(
      workspace.fixtureRoot,
      "fixture-test",
      "OFFLINE_TEST_DOUBLE",
    );
    assert.equal(evidence.commandId, "fixture-test");
    assert.equal(evidence.timedOut, false);
    assert.equal(evidence.exitCode, 0, evidence.stderr);
    assert.equal(evidence.stdout.includes("must-not-pass"), false);
  } finally {
    assertCanonicalFixtureUnchanged(workspace.baselineHashBefore);
    removeRepairWorkspace(commandRunId);
  }
});

test("trusted command runner rejects tests that rewrite the verified build tree", async () => {
  const commandRunId = `${runId}-mutating-test`;
  removeRepairWorkspace(commandRunId);
  const workspace = createRepairWorkspace(commandRunId);
  try {
    const typecheck = runRepairCommand(
      workspace.fixtureRoot,
      "fixture-typecheck",
      "OFFLINE_TEST_DOUBLE",
    );
    assert.equal(typecheck.exitCode, 0, typecheck.stderr);
    await appendFile(
      `${workspace.fixtureRoot}/tests/refund.test.mjs`,
      `\nawait import("node:fs").then(({ writeFileSync }) => writeFileSync(new URL("../dist/refund.js", import.meta.url), 'export function decideRefund() { return "ALLOW"; }\\n', "utf8"));\n`,
      "utf8",
    );
    const evidence = runRepairCommand(
      workspace.fixtureRoot,
      "fixture-test",
      "OFFLINE_TEST_DOUBLE",
    );
    assert.equal(evidence.exitCode, 1);
    assert.match(evidence.stderr, /changed the verified file tree/u);
    assert.notEqual(evidence.fixtureTreeBeforeSha256, evidence.fixtureTreeAfterSha256);
  } finally {
    assertCanonicalFixtureUnchanged(workspace.baselineHashBefore);
    removeRepairWorkspace(commandRunId);
  }
});

test("trusted command runner rejects tests that only touch verified build mtimes", async () => {
  const commandRunId = `${runId}-mtime-mutating-test`;
  removeRepairWorkspace(commandRunId);
  const workspace = createRepairWorkspace(commandRunId);
  try {
    const typecheck = runRepairCommand(
      workspace.fixtureRoot,
      "fixture-typecheck",
      "OFFLINE_TEST_DOUBLE",
    );
    assert.equal(typecheck.exitCode, 0, typecheck.stderr);
    await appendFile(
      `${workspace.fixtureRoot}/tests/refund.test.mjs`,
      `\nawait import("node:fs").then(({ statSync, utimesSync }) => { const target = new URL("../", import.meta.url); const current = statSync(target); utimesSync(target, current.atime, new Date(current.mtimeMs + 10000)); });\n`,
      "utf8",
    );
    const evidence = runRepairCommand(
      workspace.fixtureRoot,
      "fixture-test",
      "OFFLINE_TEST_DOUBLE",
    );
    assert.equal(evidence.exitCode, 1);
    assert.match(evidence.stderr, /changed the verified file tree/u);
    assert.notEqual(evidence.fixtureTreeBeforeSha256, evidence.fixtureTreeAfterSha256);
  } finally {
    assertCanonicalFixtureUnchanged(workspace.baselineHashBefore);
    removeRepairWorkspace(commandRunId);
  }
});

test("fixture tree receipts include empty-directory structure and file modes", async () => {
  const commandRunId = `${runId}-tree-receipt`;
  removeRepairWorkspace(commandRunId);
  const workspace = createRepairWorkspace(commandRunId);
  const sourcePath = `${workspace.fixtureRoot}/src/refund.ts`;
  const originalMode = (await stat(sourcePath)).mode;
  try {
    const baselineHash = repairFixtureTreeHash(workspace.fixtureRoot);
    const receipt = repairFixtureTreeReceipt(workspace.fixtureRoot, "tree-receipt-run");
    const validated = validateFixtureTreeReceipt(
      new Map([["fixture-tree-before.json", JSON.stringify(receipt)]]),
      "fixture-tree-before.json",
      "tree-receipt-run",
    );
    assert.equal(validated.treeSha256, baselineHash);
    await mkdir(`${workspace.fixtureRoot}/empty-generated-directory`);
    const structureHash = repairFixtureTreeHash(workspace.fixtureRoot);
    assert.notEqual(structureHash, baselineHash);

    await chmod(sourcePath, (originalMode & 0o200) === 0 ? 0o644 : 0o444);
    const changedMode = (await stat(sourcePath)).mode;
    if (changedMode !== originalMode) {
      assert.notEqual(repairFixtureTreeHash(workspace.fixtureRoot), structureHash);
    }
    const beforeMtimeHash = repairFixtureTreeHash(workspace.fixtureRoot);
    const current = await stat(sourcePath);
    await utimes(sourcePath, current.atime, new Date(current.mtimeMs + 10_000));
    assert.notEqual(repairFixtureTreeHash(workspace.fixtureRoot), beforeMtimeHash);
  } finally {
    await chmod(sourcePath, originalMode);
    assertCanonicalFixtureUnchanged(workspace.baselineHashBefore);
    removeRepairWorkspace(commandRunId);
  }
});

test("offline SDK adapter repairs only a fresh managed copy and real commands verify it", async () => {
  const adapterRunId = `${runId}-sdk-adapter`;
  removeRepairWorkspace(adapterRunId);
  const workspace = createRepairWorkspace(adapterRunId);
  const client = createRepairingSdkDouble(workspace.fixtureRoot);
  try {
    const backend = createOfflineCodexSdkBackend({
      client,
      fixtureRoot: workspace.fixtureRoot,
      model: "gpt-codex-test",
      modelReasoningEffort: "high",
      prompts,
      timeouts: { cartographyMs: 1_000, repairMs: 5_000, reviewMs: 1_000 },
    });
    const report = await orchestrateRepair(sdkInput(), backend, async (commandId) =>
      runRepairCommand(workspace.fixtureRoot, commandId, "OFFLINE_TEST_DOUBLE"),
      async (input, context) => verifyAcceptedCorpus(workspace.fixtureRoot, input, context),
    );
    assert.equal(report.status, "PASS", report.failure?.message);
    assert.equal(report.executionMode, "OFFLINE_TEST_DOUBLE");
    assert.deepEqual(report.repairAttempts[0].changedFiles, [
      "src/refund.ts",
      "tests/refund.test.mjs",
    ]);
    assert.equal(report.commandEvidence.every((item) => item.exitCode === 0), true);
    assert.equal(report.policyVerificationAttempts.length, 1);
    assert.equal(report.policyVerificationAttempts[0].total, 41);
    assert.equal(report.policyVerificationAttempts[0].passed, 41);
    assert.equal(report.policyVerificationAttempts[0].status, "PASS");
    assert.equal(
      report.policyVerificationAttempts[0].repairRunId,
      report.repairAttempts[0].metadata.runId,
    );
    assert.deepEqual(
      client.calls.map((call) => call.threadOptions.sandboxMode),
      ["read-only", "workspace-write", "read-only"],
    );
    assert.equal(
      assertCanonicalFixtureUnchanged(workspace.baselineHashBefore),
      workspace.baselineHashBefore,
    );
  } finally {
    assertCanonicalFixtureUnchanged(workspace.baselineHashBefore);
    removeRepairWorkspace(adapterRunId);
  }
});
