import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildCodexSdkEnvironment,
  createIsolatedWorkerCodexSdkBackend,
  createLocalChallengeCodexSdkBackend,
  createOfflineCodexSdkBackend,
} from "../../dist/codex/sdk-adapter.js";
import { orchestrateRepair } from "../../dist/index.js";

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
const modelMetadataFallbackWarning =
  "Model metadata for `gpt-5.6-sol` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.";
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

function cartographyBody(overrides = {}) {
  return {
    relevantFiles: ["src/refund.ts", "tests/refund.test.mjs", "package.json", "tsconfig.json"],
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
        reason: "Contains refund thresholds and precedence.",
      },
    ],
    dataFlow: [
      {
        file: "src/refund.ts",
        lineStart: 12,
        lineEnd: 31,
        symbol: "decideRefund",
        reason: "Validated fields flow through thresholds and exception precedence to a decision.",
      },
    ],
    testFiles: ["tests/refund.test.mjs"],
    risks: ["Boundary and precedence defects are under-tested."],
    proposedFilesToChange: ["src/refund.ts", "tests/refund.test.mjs"],
    verificationCommandIds: ["fixture-typecheck", "fixture-test"],
    ...overrides,
  };
}

function repairBody(overrides = {}) {
  return {
    summary: "Corrected inclusive boundaries and final-sale precedence.",
    rationale: ["Match the three supplied drift witnesses."],
    remainingRisks: [],
    verificationCommandIds: ["fixture-typecheck", "fixture-test"],
    ...overrides,
  };
}

function reviewBody(overrides = {}) {
  return {
    verdict: "APPROVE",
    summary: "The focused repair and regression coverage match the accepted policy.",
    findings: [],
    ...overrides,
  };
}

function commandEvidence(commandId) {
  const before = commandId === "fixture-typecheck" ? "1".repeat(64) : "2".repeat(64);
  const after = "2".repeat(64);
  return {
    schemaVersion: "1",
    commandId,
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    stdout: "ok",
    stderr: "",
    outputTruncated: false,
    fixtureTreeBeforeSha256: before,
    fixtureTreeAfterSha256: after,
  };
}

function policyEvidence(binding = {}) {
  const results = acceptedCases.map((policyCase) => ({
    caseId: policyCase.id,
    expectedDecision: policyCase.expectedDecision,
    actualDecision: policyCase.expectedDecision,
    status: "PASS",
    error: null,
  }));
  return {
    schemaVersion: "1",
    executionMode: "SERVER_OWNED_CORPUS",
    attempt: binding.attempt ?? 1,
    repairRunId: binding.repairRunId ?? "thread-repair",
    fixtureTreeSha256: binding.fixtureTreeSha256 ?? "2".repeat(64),
    acceptedCorpusSha256:
      binding.acceptedCorpusSha256 ??
      "2658993bb79e56bf5dfbc1cc762786fdd25b52afe0b63c5ffb1c0b1deb132f57",
    policyIrSha256: binding.policyIrSha256 ?? "3".repeat(64),
    status: "PASS",
    total: results.length,
    passed: results.length,
    results,
  };
}

function createFakeClient(plans) {
  const calls = [];
  return {
    calls,
    startThread(threadOptions) {
      const plan = plans.shift();
      if (plan === undefined) throw new Error("Unexpected SDK thread.");
      let observedId = null;
      return {
        get id() {
          return observedId;
        },
        async runStreamed(prompt, turnOptions) {
          calls.push({ threadOptions, prompt, turnOptions });
          return {
            events: (async function* () {
              if (plan.waitForAbort) {
                await new Promise((resolvePromise, rejectPromise) => {
                  if (turnOptions.signal.aborted) {
                    rejectPromise(new Error("aborted"));
                    return;
                  }
                  turnOptions.signal.addEventListener(
                    "abort",
                    () => rejectPromise(new Error("aborted")),
                    { once: true },
                  );
                });
                return;
              }
              observedId = plan.id;
              yield { type: "thread.started", thread_id: plan.id };
              yield { type: "turn.started" };
              if (plan.topLevelError) {
                yield { type: "error", message: plan.topLevelError };
                return;
              }
              if (plan.mutate) await plan.mutate();
              if (plan.errorItemMessage) {
                const errorEvent = {
                  type: plan.errorItemEventType ?? "item.completed",
                  item: {
                    id: `${plan.id}-error`,
                    type: "error",
                    message: plan.errorItemMessage,
                  },
                };
                yield errorEvent;
                if (plan.duplicateErrorItem) yield errorEvent;
              }
              if (plan.rawEvent) yield plan.rawEvent;
              if (plan.commandExecution) {
                yield {
                  type: plan.commandEventType ?? "item.completed",
                  item: {
                    id: `${plan.id}-command`,
                    type: "command_execution",
                    command: "forbidden-command",
                    aggregated_output: "",
                    exit_code: 0,
                    status: "completed",
                  },
                };
              }
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
                  text: plan.rawResponse ?? JSON.stringify(plan.body),
                },
              };
              yield {
                type: "turn.completed",
                usage: {
                  input_tokens: 10,
                  cached_input_tokens: 0,
                  output_tokens: 10,
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

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "policytwin-sdk-adapter-"));
  const fixtureRoot = resolve(root, "fixture");
  await cp(new URL("../../fixtures/refund-demo/baseline/", import.meta.url), fixtureRoot, {
    recursive: true,
  });
  return { root, fixtureRoot };
}

function backendOptions(fixtureRoot, client, overrides = {}) {
  return {
    fixtureRoot,
    client,
    model: "gpt-codex-test",
    modelReasoningEffort: "high",
    prompts,
    timeouts: { cartographyMs: 1_000, repairMs: 1_000, reviewMs: 1_000 },
    ...overrides,
  };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function enableSeededRegressionTests(fixtureRoot) {
  const testPath = join(fixtureRoot, "tests", "refund.test.mjs");
  const original = await readFile(testPath, "utf8");
  const enabled = original.replaceAll("test.skip(", "test(");
  assert.notEqual(enabled, original);
  await writeFile(testPath, enabled, "utf8");
}

test("SDK adapter uses isolated phase threads and server-owned filesystem evidence", async () => {
  const fixture = await createFixture();
  try {
    const client = createFakeClient([
      { id: "thread-cartography", body: cartographyBody() },
      {
        id: "thread-repair",
        body: repairBody(),
        fileChanges: [
          resolve(fixture.fixtureRoot, "src", "refund.ts"),
          "tests/refund.test.mjs",
        ],
        async mutate() {
          const sourcePath = join(fixture.fixtureRoot, "src", "refund.ts");
          const original = await readFile(sourcePath, "utf8");
          const fixed = original.replace(
            'export function decideRefund(input: RefundPolicyInput): Decision {\n  const withinWindow = input.daysSincePurchase < 14;\n  const withinUsage = input.usageBasisPoints < 2000;\n\n  if (input.promotionalPurchase && input.managerApproved) {\n    return "ALLOW";\n  }\n\n  if (input.finalSale) {\n    return "DENY";\n  }\n\n  if (!withinWindow || !withinUsage) {\n    return "DENY";\n  }\n\n  if (input.promotionalPurchase) {\n    return "REVIEW";\n  }\n\n  return "ALLOW";\n}',
            'export function decideRefund(input: RefundPolicyInput): Decision {\n  if (input.finalSale) {\n    return "DENY";\n  }\n\n  const withinWindow = input.daysSincePurchase <= 14;\n  const withinUsage = input.usageBasisPoints <= 2000;\n\n  if (!withinWindow || !withinUsage) {\n    return "DENY";\n  }\n\n  if (input.promotionalPurchase) {\n    return input.managerApproved ? "ALLOW" : "REVIEW";\n  }\n\n  return "ALLOW";\n}',
          );
          assert.notEqual(fixed, original);
          await writeFile(sourcePath, fixed, "utf8");
          await enableSeededRegressionTests(fixture.fixtureRoot);
        },
      },
      { id: "thread-review", body: reviewBody() },
    ]);
    const backend = createOfflineCodexSdkBackend(backendOptions(fixture.fixtureRoot, client));
    const report = await orchestrateRepair(input, backend, async (commandId) =>
      commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );

    assert.equal(report.status, "PASS");
    assert.equal(report.executionMode, "OFFLINE_TEST_DOUBLE");
    assert.deepEqual(report.repairAttempts[0].changedFiles, [
      "src/refund.ts",
      "tests/refund.test.mjs",
    ]);
    assert.equal(report.cartography.metadata.runId, "thread-cartography");
    assert.equal(report.cartography.metadata.sdkVersion, "0.144.6");
    assert.equal(report.cartography.metadata.model, "gpt-codex-test");
    assert.equal(report.cartography.metadata.modelReasoningEffort, "high");
    assert.equal(report.cartography.metadata.promptTemplateSha256, sha256(prompts.cartographer));
    assert.equal(report.cartography.metadata.requestSha256, sha256(client.calls[0].prompt));
    assert.equal(
      report.cartography.metadata.outputSchemaSha256,
      sha256(JSON.stringify(client.calls[0].turnOptions.outputSchema)),
    );
    assert.equal(report.repairAttempts[0].metadata.runId, "thread-repair");
    assert.equal(report.policyVerificationAttempts.length, 1);
    assert.equal(report.policyVerificationAttempts[0].repairRunId, "thread-repair");
    assert.equal(report.policyVerificationAttempts[0].total, 41);
    assert.equal(report.review.metadata.runId, "thread-review");
    assert.equal(report.cartography.metadata.backendId, "offline-codex-sdk-double");
    assert.deepEqual(
      client.calls.map((call) => call.threadOptions.sandboxMode),
      ["read-only", "workspace-write", "read-only"],
    );
    for (const call of client.calls) {
      assert.equal(call.threadOptions.workingDirectory, fixture.fixtureRoot);
      assert.equal(call.threadOptions.skipGitRepoCheck, true);
      assert.equal(call.threadOptions.networkAccessEnabled, false);
      assert.equal(call.threadOptions.webSearchMode, "disabled");
      assert.equal(call.threadOptions.approvalPolicy, "never");
      assert.deepEqual(call.threadOptions.additionalDirectories, []);
      assert.equal(call.prompt.includes(fixture.fixtureRoot), false);
      assert.equal(call.prompt.includes("must-not-leak"), false);
      assert.equal(call.turnOptions.outputSchema.additionalProperties, false);
      assert.equal(call.turnOptions.outputSchema.required.includes("metadata"), false);
      assert.equal(
        JSON.stringify(call.turnOptions.outputSchema).includes('"uniqueItems"'),
        false,
        "Codex Structured Outputs must omit the provider-unsupported uniqueItems keyword",
      );
    }
    assert.match(client.calls[2].prompt, /--- a\/src\/refund\.ts/u);
    assert.match(client.calls[2].prompt, /\+\+\+ b\/tests\/refund\.test\.mjs/u);
    assert.match(client.calls[2].prompt, /SERVER_OWNED_CORPUS/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("read-only mutation and repair changes outside cartography fail closed", async () => {
  const readOnlyFixture = await createFixture();
  try {
    const mutatingCartographer = createFakeClient([
      {
        id: "mutating-cartographer",
        body: cartographyBody(),
        async mutate() {
          await mkdir(join(readOnlyFixture.fixtureRoot, "forbidden-empty-directory"));
        },
      },
    ]);
    const backend = createOfflineCodexSdkBackend(
      backendOptions(readOnlyFixture.fixtureRoot, mutatingCartographer),
    );
    const report = await orchestrateRepair(
      input,
      backend,
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "CARTOGRAPHY_INVALID");
    assert.match(report.failure.message, /read-only contract/u);
    await assert.rejects(
      () => backend.cartograph({ input }),
      /workspace is poisoned/u,
    );
  } finally {
    await rm(readOnlyFixture.root, { recursive: true, force: true });
  }

  const outsidePlanFixture = await createFixture();
  try {
    const outsidePlan = createFakeClient([
      {
        id: "limited-cartography",
        body: cartographyBody(),
      },
      {
        id: "outside-plan-repair",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs", "package.json"],
        async mutate() {
          await appendFile(
            join(outsidePlanFixture.fixtureRoot, "src", "refund.ts"),
            "\n// repaired\n",
            "utf8",
          );
          await enableSeededRegressionTests(outsidePlanFixture.fixtureRoot);
          await appendFile(
            join(outsidePlanFixture.fixtureRoot, "package.json"),
            "\n",
            "utf8",
          );
        },
      },
    ]);
    const report = await orchestrateRepair(
      input,
      createOfflineCodexSdkBackend(backendOptions(outsidePlanFixture.fixtureRoot, outsidePlan)),
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /outside approved cartography/u);
  } finally {
    await rm(outsidePlanFixture.root, { recursive: true, force: true });
  }

  const retryOutsidePlanFixture = await createFixture();
  try {
    const retryOutsidePlan = createFakeClient([
      { id: "retry-cartography", body: cartographyBody() },
      {
        id: "retry-repair-one",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
        async mutate() {
          await appendFile(
            join(retryOutsidePlanFixture.fixtureRoot, "src", "refund.ts"),
            "\n// first repair\n",
            "utf8",
          );
          await enableSeededRegressionTests(retryOutsidePlanFixture.fixtureRoot);
        },
      },
      {
        id: "retry-repair-two",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "dist/refund.js"],
        async mutate() {
          await appendFile(
            join(retryOutsidePlanFixture.fixtureRoot, "src", "refund.ts"),
            "\n// second repair\n",
            "utf8",
          );
          await appendFile(
            join(retryOutsidePlanFixture.fixtureRoot, "dist", "refund.js"),
            "\n// unapproved generated-file repair\n",
            "utf8",
          );
        },
      },
    ]);
    let commandCalls = 0;
    const report = await orchestrateRepair(
      { ...input, maxRepairAttempts: 2 },
      createOfflineCodexSdkBackend(
        backendOptions(retryOutsidePlanFixture.fixtureRoot, retryOutsidePlan),
      ),
      async (commandId) => {
        commandCalls += 1;
        if (commandCalls === 1) {
          await mkdir(join(retryOutsidePlanFixture.fixtureRoot, "dist"));
          await writeFile(
            join(retryOutsidePlanFixture.fixtureRoot, "dist", "refund.js"),
            "export const generated = true;\n",
            "utf8",
          );
        }
        return {
          ...commandEvidence(commandId),
          exitCode: commandCalls <= 2 && commandId === "fixture-typecheck" ? 1 : 0,
        };
      },
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /outside approved cartography/u);
    assert.match(report.failure.message, /dist\/refund\.js/u);
  } finally {
    await rm(retryOutsidePlanFixture.root, { recursive: true, force: true });
  }

  const sensitivePathFixture = await createFixture();
  try {
    const rawGitHubToken = ["ghp", "A".repeat(24)].join("_");
    const camelSecretPath = `${["api", "Key"].join("")}=must-not-pass`;
    const sensitivePath = createFakeClient([
      { id: "sensitive-path-cartography", body: cartographyBody() },
      {
        id: "sensitive-path-repair",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
        async mutate() {
          await appendFile(
            join(sensitivePathFixture.fixtureRoot, "src", "refund.ts"),
            "\n// repaired\n",
            "utf8",
          );
          await enableSeededRegressionTests(sensitivePathFixture.fixtureRoot);
          await writeFile(
            join(sensitivePathFixture.fixtureRoot, rawGitHubToken),
            "must not be retained\n",
            "utf8",
          );
          await writeFile(
            join(sensitivePathFixture.fixtureRoot, camelSecretPath),
            "must not be retained\n",
            "utf8",
          );
        },
      },
    ]);
    const report = await orchestrateRepair(
      input,
      createOfflineCodexSdkBackend(
        backendOptions(sensitivePathFixture.fixtureRoot, sensitivePath),
      ),
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /sensitive or personal-path content/u);
    assert.equal(report.failure.message.includes("AAAAAAAA"), false);
    assert.equal(report.failure.message.includes("must-not-pass"), false);
  } finally {
    await rm(sensitivePathFixture.root, { recursive: true, force: true });
  }

  const metadataOnlyFixture = await createFixture();
  try {
    const metadataOnly = createFakeClient([
      { id: "metadata-cartography", body: cartographyBody() },
      {
        id: "metadata-only-repair",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
        async mutate() {
          for (const path of ["src/refund.ts", "tests/refund.test.mjs"]) {
            const absolute = join(metadataOnlyFixture.fixtureRoot, ...path.split("/"));
            const current = await stat(absolute);
            const touched = new Date(current.mtimeMs + 10_000);
            await utimes(absolute, current.atime, touched);
          }
        },
      },
    ]);
    const report = await orchestrateRepair(
      input,
      createOfflineCodexSdkBackend(
        backendOptions(metadataOnlyFixture.fixtureRoot, metadataOnly),
      ),
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /metadata-only file changes/u);
  } finally {
    await rm(metadataOnlyFixture.root, { recursive: true, force: true });
  }
});

test("local challenge continues only past the exact GPT-5.6 metadata fallback warning", async () => {
  const fixture = await createFixture();
  try {
    const diagnostics = [];
    const compatibleClient = createFakeClient([
      {
        id: "metadata-fallback-cartography",
        body: cartographyBody(),
        errorItemMessage: modelMetadataFallbackWarning,
      },
    ]);
    const compatibleBackend = createLocalChallengeCodexSdkBackend({
      ...backendOptions(fixture.fixtureRoot, compatibleClient, { model: "gpt-5.6-sol" }),
      acknowledgedNonProduction: true,
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
      },
    });
    const result = await compatibleBackend.cartograph({ input });
    assert.equal(result.metadata.model, "gpt-5.6-sol");
    assert.equal(result.metadata.backendId, "local-challenge-host-sdk");
    assert.deepEqual(diagnostics, [
      { phase: "CARTOGRAPHY", code: "MODEL_METADATA_FALLBACK" },
    ]);
    assert.equal(Object.isFrozen(diagnostics[0]), true);

    const wrongModelClient = createFakeClient([
      {
        id: "wrong-model-warning",
        body: cartographyBody(),
        errorItemMessage: modelMetadataFallbackWarning,
      },
    ]);
    const wrongModelBackend = createLocalChallengeCodexSdkBackend({
      ...backendOptions(fixture.fixtureRoot, wrongModelClient, { model: "gpt-5.6-terra" }),
      acknowledgedNonProduction: true,
    });
    await assert.rejects(
      () => wrongModelBackend.cartograph({ input }),
      /CARTOGRAPHY item failed/u,
    );

    const alteredWarningClient = createFakeClient([
      {
        id: "altered-warning",
        body: cartographyBody(),
        errorItemMessage: `${modelMetadataFallbackWarning} altered`,
      },
    ]);
    const alteredWarningBackend = createLocalChallengeCodexSdkBackend({
      ...backendOptions(fixture.fixtureRoot, alteredWarningClient, { model: "gpt-5.6-sol" }),
      acknowledgedNonProduction: true,
    });
    await assert.rejects(
      () => alteredWarningBackend.cartograph({ input }),
      /CARTOGRAPHY item failed/u,
    );

    const updatedWarningClient = createFakeClient([
      {
        id: "updated-warning",
        body: cartographyBody(),
        errorItemMessage: modelMetadataFallbackWarning,
        errorItemEventType: "item.updated",
      },
    ]);
    const updatedWarningBackend = createLocalChallengeCodexSdkBackend({
      ...backendOptions(fixture.fixtureRoot, updatedWarningClient, { model: "gpt-5.6-sol" }),
      acknowledgedNonProduction: true,
    });
    await assert.rejects(
      () => updatedWarningBackend.cartograph({ input }),
      /invalid model metadata fallback diagnostic/u,
    );

    const duplicateWarningClient = createFakeClient([
      {
        id: "duplicate-warning",
        body: cartographyBody(),
        errorItemMessage: modelMetadataFallbackWarning,
        duplicateErrorItem: true,
      },
    ]);
    const duplicateWarningBackend = createLocalChallengeCodexSdkBackend({
      ...backendOptions(fixture.fixtureRoot, duplicateWarningClient, { model: "gpt-5.6-sol" }),
      acknowledgedNonProduction: true,
    });
    await assert.rejects(
      () => duplicateWarningBackend.cartograph({ input }),
      /invalid model metadata fallback diagnostic/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("read-only phases detect fixture-root metadata changes", async () => {
  const fixture = await createFixture();
  try {
    const client = createFakeClient([
      {
        id: "root-metadata-cartography",
        body: cartographyBody(),
        async mutate() {
          const current = await stat(fixture.fixtureRoot);
          await utimes(
            fixture.fixtureRoot,
            current.atime,
            new Date(current.mtimeMs + 10_000),
          );
        },
      },
    ]);
    const report = await orchestrateRepair(
      input,
      createOfflineCodexSdkBackend(backendOptions(fixture.fixtureRoot, client)),
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "CARTOGRAPHY_INVALID");
    assert.match(report.failure.message, /read-only contract/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("repair requires exact seeded regressions and bidirectional file events", async () => {
  const weakenedFixture = await createFixture();
  try {
    const weakened = createFakeClient([
      { id: "weakened-cartography", body: cartographyBody() },
      {
        id: "weakened-repair",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
        async mutate() {
          await appendFile(
            join(weakenedFixture.fixtureRoot, "src", "refund.ts"),
            "\n// repaired\n",
            "utf8",
          );
          await appendFile(
            join(weakenedFixture.fixtureRoot, "tests", "refund.test.mjs"),
            "\n// claimed regression only\n",
            "utf8",
          );
        },
      },
    ]);
    const report = await orchestrateRepair(
      input,
      createOfflineCodexSdkBackend(backendOptions(weakenedFixture.fixtureRoot, weakened)),
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /exact server-owned D01-D03 regression assertions/u);
  } finally {
    await rm(weakenedFixture.root, { recursive: true, force: true });
  }

  const unreportedFixture = await createFixture();
  try {
    const unreported = createFakeClient([
      { id: "unreported-cartography", body: cartographyBody() },
      {
        id: "unreported-repair",
        body: repairBody(),
        async mutate() {
          await appendFile(
            join(unreportedFixture.fixtureRoot, "src", "refund.ts"),
            "\n// repaired\n",
            "utf8",
          );
          await enableSeededRegressionTests(unreportedFixture.fixtureRoot);
        },
      },
    ]);
    const report = await orchestrateRepair(
      input,
      createOfflineCodexSdkBackend(backendOptions(unreportedFixture.fixtureRoot, unreported)),
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /lacked SDK file-change events/u);
  } finally {
    await rm(unreportedFixture.root, { recursive: true, force: true });
  }
});

test("retry rejects unexpected files retained by a failed verification command", async () => {
  const fixture = await createFixture();
  try {
    const client = createFakeClient([
      { id: "retained-cartography", body: cartographyBody() },
      {
        id: "retained-repair-one",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
        async mutate() {
          await appendFile(join(fixture.fixtureRoot, "src", "refund.ts"), "\n// first\n", "utf8");
          await enableSeededRegressionTests(fixture.fixtureRoot);
        },
      },
      {
        id: "retained-repair-two",
        body: repairBody(),
        fileChanges: ["src/refund.ts"],
        async mutate() {
          await appendFile(join(fixture.fixtureRoot, "src", "refund.ts"), "\n// second\n", "utf8");
        },
      },
    ]);
    let commandCalls = 0;
    const report = await orchestrateRepair(
      { ...input, maxRepairAttempts: 2 },
      createOfflineCodexSdkBackend(backendOptions(fixture.fixtureRoot, client)),
      async (commandId) => {
        commandCalls += 1;
        if (commandCalls === 1) {
          await mkdir(join(fixture.fixtureRoot, "dist"));
          await writeFile(join(fixture.fixtureRoot, "dist", "refund.js"), "export {};\n", "utf8");
          await writeFile(join(fixture.fixtureRoot, "dist", "refund.d.ts"), "export {};\n", "utf8");
        }
        if (commandCalls === 2) {
          await writeFile(join(fixture.fixtureRoot, "dist", "extra.js"), "export {};\n", "utf8");
        }
        return {
          ...commandEvidence(commandId),
          exitCode: commandCalls === 2 ? 1 : 0,
        };
      },
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /retained entries outside the trusted generated set/u);
    assert.match(report.failure.message, /dist\/extra\.js/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("sensitive context and fixture content are rejected before an SDK turn", async () => {
  const contextFixture = await createFixture();
  try {
    const client = createFakeClient([{ id: "unused-context-thread", body: cartographyBody() }]);
    const backend = createOfflineCodexSdkBackend(
      backendOptions(contextFixture.fixtureRoot, client),
    );
    const secretName = ["api", "Key"].join("");
    await assert.rejects(
      () =>
        backend.cartograph({
          input: {
            ...input,
            policySummary: `${secretName}=must-not-reach-codex`,
          },
        }),
      /sensitive or personal-path content/u,
    );
    assert.equal(client.calls.length, 0);
  } finally {
    await rm(contextFixture.root, { recursive: true, force: true });
  }

  const contentFixture = await createFixture();
  try {
    const secretName = ["client", "Secret"].join("");
    await appendFile(
      join(contentFixture.fixtureRoot, "src", "refund.ts"),
      `\n// ${secretName}=must-not-reach-codex\n`,
      "utf8",
    );
    const client = createFakeClient([{ id: "unused-content-thread", body: cartographyBody() }]);
    const backend = createOfflineCodexSdkBackend(
      backendOptions(contentFixture.fixtureRoot, client),
    );
    await assert.rejects(
      () => backend.cartograph({ input }),
      /sensitive or personal-path content/u,
    );
    assert.equal(client.calls.length, 0);
  } finally {
    await rm(contentFixture.root, { recursive: true, force: true });
  }

  const nonCanonicalFixture = await createFixture();
  try {
    const sourcePath = join(nonCanonicalFixture.fixtureRoot, "src", "refund.ts");
    const original = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, `\uFEFF${original}`, "utf8");
    const client = createFakeClient([{ id: "unused-bom-thread", body: cartographyBody() }]);
    const backend = createOfflineCodexSdkBackend(
      backendOptions(nonCanonicalFixture.fixtureRoot, client),
    );
    await assert.rejects(
      () => backend.cartograph({ input }),
      /canonical NUL-free UTF-8/u,
    );
    assert.equal(client.calls.length, 0);
  } finally {
    await rm(nonCanonicalFixture.root, { recursive: true, force: true });
  }
});

test("a failed write stream poisons the repair workspace and records its observed delta", async () => {
  const fixture = await createFixture();
  try {
    const client = createFakeClient([
      { id: "poison-cartography", body: cartographyBody() },
      {
        id: "poison-repair",
        body: repairBody(),
        commandExecution: true,
        commandEventType: "item.updated",
        async mutate() {
          await appendFile(join(fixture.fixtureRoot, "src", "refund.ts"), "\n// changed\n", "utf8");
          await enableSeededRegressionTests(fixture.fixtureRoot);
        },
      },
    ]);
    const backend = createOfflineCodexSdkBackend(backendOptions(fixture.fixtureRoot, client));
    const report = await orchestrateRepair(
      input,
      backend,
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /discard the poisoned workspace/u);
    assert.match(report.failure.message, /src\/refund\.ts/u);
    await assert.rejects(
      () => backend.cartograph({ input }),
      /workspace is poisoned/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a failed read-only review also poisons the disposable workspace", async () => {
  const fixture = await createFixture();
  try {
    const client = createFakeClient([
      { id: "review-poison-cartography", body: cartographyBody() },
      {
        id: "review-poison-repair",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
        async mutate() {
          await appendFile(join(fixture.fixtureRoot, "src", "refund.ts"), "\n// repaired\n", "utf8");
          await enableSeededRegressionTests(fixture.fixtureRoot);
        },
      },
      {
        id: "review-poison-review",
        body: reviewBody(),
        async mutate() {
          await mkdir(join(fixture.fixtureRoot, "forbidden-review-directory"));
        },
      },
    ]);
    const backend = createOfflineCodexSdkBackend(backendOptions(fixture.fixtureRoot, client));
    const report = await orchestrateRepair(
      input,
      backend,
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REVIEW_INVALID");
    assert.match(report.failure.message, /read-only contract/u);
    await assert.rejects(
      () => backend.cartograph({ input }),
      /workspace is poisoned/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("stream errors, forged fields, repeated identities, and timeouts fail closed", async () => {
  const rawGitHubToken = ["ghp", "A".repeat(24)].join("_");
  const scenarios = [
    {
      name: "top-level error",
      plans: [{ id: "error-thread", topLevelError: "transport failed" }],
      timeout: 1_000,
      pattern: /SDK stream failed/u,
    },
    {
      name: "redacted top-level error",
      plans: [{ id: "secret-error-thread", topLevelError: "OPENAI_API_KEY=must-not-pass" }],
      timeout: 1_000,
      pattern: /\[REDACTED\]/u,
      absent: /must-not-pass/u,
    },
    {
      name: "redacted unlabeled token error",
      plans: [{ id: "raw-token-error-thread", topLevelError: rawGitHubToken }],
      timeout: 1_000,
      pattern: /\[REDACTED_CREDENTIAL\]/u,
      absent: /AAAAAAAA/u,
    },
    {
      name: "forged metadata",
      plans: [
        {
          id: "forged-thread",
          body: { ...cartographyBody(), metadata: { executionMode: "LIVE_CODEX_SDK" } },
        },
      ],
      timeout: 1_000,
      pattern: /must contain exactly/u,
    },
    {
      name: "forbidden SDK command execution",
      plans: [
        {
          id: "command-thread",
          body: cartographyBody(),
          commandExecution: true,
          commandEventType: "item.started",
        },
      ],
      timeout: 1_000,
      pattern: /forbidden SDK command execution/u,
    },
    {
      name: "unknown SDK event",
      plans: [
        {
          id: "unknown-event-thread",
          body: cartographyBody(),
          rawEvent: { type: "future.tool.started" },
        },
      ],
      timeout: 1_000,
      pattern: /unsupported SDK event type/u,
    },
    {
      name: "unknown SDK item",
      plans: [
        {
          id: "unknown-item-thread",
          body: cartographyBody(),
          rawEvent: {
            type: "item.updated",
            item: { id: "future-tool", type: "future_execution_tool" },
          },
        },
      ],
      timeout: 1_000,
      pattern: /unsupported SDK item type/u,
    },
    {
      name: "invalid cartography line range",
      plans: [
        {
          id: "invalid-line-thread",
          body: cartographyBody({
            entryPoints: [
              {
                file: "src/refund.ts",
                lineStart: 1,
                lineEnd: 9_999,
                symbol: "decideRefund",
                reason: "Outside the actual file.",
              },
            ],
          }),
        },
      ],
      timeout: 1_000,
      pattern: /location exceeds/u,
    },
    {
      name: "timeout",
      plans: [{ id: "waiting-thread", waitForAbort: true }],
      timeout: 10,
      pattern: /timed out/u,
    },
  ];

  for (const scenario of scenarios) {
    const fixture = await createFixture();
    try {
      const client = createFakeClient([...scenario.plans]);
      const report = await orchestrateRepair(
        input,
        createOfflineCodexSdkBackend(
          backendOptions(fixture.fixtureRoot, client, {
            timeouts: {
              cartographyMs: scenario.timeout,
              repairMs: 1_000,
              reviewMs: 1_000,
            },
          }),
        ),
        async (commandId) => commandEvidence(commandId),
        async (_input, context) => policyEvidence(context),
      );
      assert.equal(report.status, "FAIL", scenario.name);
      assert.equal(report.failure.code, "CARTOGRAPHY_INVALID", scenario.name);
      assert.match(report.failure.message, scenario.pattern, scenario.name);
      if (scenario.absent) assert.doesNotMatch(report.failure.message, scenario.absent);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }

  const repeatedFixture = await createFixture();
  try {
    const repeated = createFakeClient([
      { id: "same-thread", body: cartographyBody() },
      {
        id: "same-thread",
        body: repairBody(),
        fileChanges: ["src/refund.ts", "tests/refund.test.mjs"],
        async mutate() {
          await appendFile(
            join(repeatedFixture.fixtureRoot, "src", "refund.ts"),
            "\n// repaired\n",
            "utf8",
          );
          await enableSeededRegressionTests(repeatedFixture.fixtureRoot);
        },
      },
    ]);
    const report = await orchestrateRepair(
      input,
      createOfflineCodexSdkBackend(backendOptions(repeatedFixture.fixtureRoot, repeated)),
      async (commandId) => commandEvidence(commandId),
      async (_input, context) => policyEvidence(context),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(report.failure.code, "REPAIR_INVALID");
    assert.match(report.failure.message, /reused a prior SDK thread identity/u);
  } finally {
    await rm(repeatedFixture.root, { recursive: true, force: true });
  }
});

test("SDK subprocess environment is allowlisted and never forwards credentials", () => {
  const environment = buildCodexSdkEnvironment(
    {
      Path: "C:\\safe-bin",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      OPENAI_API_KEY: "must-not-pass",
      CODEX_API_KEY: "must-not-pass",
      GITHUB_TOKEN: "must-not-pass",
      USERPROFILE: "C:\\Users\\private",
    },
    "C:\\policytwin\\codex-home",
  );
  assert.deepEqual(environment, {
    CODEX_HOME: "C:\\policytwin\\codex-home",
    PATH: "C:\\safe-bin",
    SYSTEMROOT: "C:\\Windows",
    TEMP: "C:\\Temp",
  });
  assert.equal(Object.keys(environment).some((key) => /KEY|TOKEN|SECRET|PASSWORD/iu.test(key)), false);
  assert.equal(JSON.stringify(environment).includes("must-not-pass"), false);
  assert.equal(JSON.stringify(environment).includes("private"), false);
});

test("host process cannot construct a live SDK backend from an isolation claim", async () => {
  const fixture = await createFixture();
  const codexHome = resolve(fixture.root, "codex-home");
  await mkdir(codexHome);
  try {
    await assert.rejects(
      createIsolatedWorkerCodexSdkBackend({
        isolationBoundary: "EXTERNAL_OS_SANDBOX",
        apiKey: "must-not-pass",
        codexHome,
        fixtureRoot: fixture.fixtureRoot,
        model: "gpt-codex-test",
        prompts,
        timeouts: { cartographyMs: 1_000, repairMs: 1_000, reviewMs: 1_000 },
        sourceEnvironment: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          OPENAI_API_KEY: "must-not-pass",
        },
      }),
      /disabled in the host process/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
