import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getRepairCommandDefinition,
  orchestrateRepair,
  parseCartographyResult,
  parseCommandResult,
  parsePolicyVerificationEvidence,
  parseReviewResult,
  parseRepairWorkerInput,
  redactWorkerOutput,
  validateCommandEvidenceHistory,
  validatePolicyVerificationAttemptsAgainstEvidence,
} from "../../dist/index.js";

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
const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
const defectsByCase = {
  D01: ["DAY_14_INCLUSIVE"],
  D02: ["USAGE_2000_INCLUSIVE"],
  D03: ["FINAL_SALE_PRECEDENCE"],
};
const failingDriftWitnesses = driftCases.map((policyCase) => ({
  caseId: policyCase.id,
  input: policyCase.input,
  expectedDecision: policyCase.expectedDecision,
  actualDecision: actualByCase[policyCase.id],
  defectIds: defectsByCase[policyCase.id],
  relatedClauseIds: policyCase.relatedClauseIds,
  relatedRuleIds: policyCase.relatedRuleIds,
}));

const input = {
  policyId: acceptedPolicyIr.policyId,
  policyVersion: 4,
  fixtureId: "seeded-refund-demo",
  sourcePolicy,
  policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
  acceptedPolicyIr,
  acceptedCases,
  failingCaseIds: ["D01", "D02", "D03"],
  failingDriftWitnesses,
  allowedCommandIds: ["fixture-typecheck", "fixture-test"],
  maxRepairAttempts: 2,
};

function metadata(runId, executionMode = "OFFLINE_TEST_DOUBLE", backendId = "offline-worker-double") {
  return {
    executionMode,
    backendId,
    sdkVersion: "not-applicable-offline-double",
    model: "offline-test-double",
    modelReasoningEffort: "high",
    promptTemplateSha256: "a".repeat(64),
    requestSha256: "b".repeat(64),
    outputSchemaSha256: "c".repeat(64),
    runId,
    startedAt: "2026-07-14T00:00:00.000Z",
    completedAt: "2026-07-14T00:00:01.000Z",
  };
}

function cartography(overrides = {}) {
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
        reason: "Contains thresholds and exception precedence.",
      },
    ],
    dataFlow: [
      {
        file: "src/refund.ts",
        lineStart: 12,
        lineEnd: 31,
        symbol: "decideRefund",
        reason: "Validated input fields flow directly through threshold and precedence checks.",
      },
    ],
    testFiles: ["tests/refund.test.mjs"],
    risks: ["Boundary and precedence defects are under-tested."],
    proposedFilesToChange: ["src/refund.ts", "tests/refund.test.mjs"],
    verificationCommandIds: ["fixture-typecheck", "fixture-test"],
    ...overrides,
  };
}

function repair(attempt, overrides = {}) {
  return {
    schemaVersion: "1",
    phase: "REPAIR",
    metadata: metadata(`repair-run-${attempt}`),
    changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
    summary: "Corrected inclusive boundaries and final-sale precedence.",
    rationale: ["Match all three supplied drift witnesses."],
    remainingRisks: [],
    verificationCommandIds: ["fixture-typecheck", "fixture-test"],
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    schemaVersion: "1",
    phase: "REVIEW",
    metadata: metadata("independent-review-run"),
    verdict: "APPROVE",
    summary: "The focused repair and regressions cover the supplied policy drift.",
    findings: [],
    ...overrides,
  };
}

function evidence(commandId, exitCode = 0) {
  const before = commandId === "fixture-typecheck" ? "1".repeat(64) : "2".repeat(64);
  const after = "2".repeat(64);
  return {
    schemaVersion: "1",
    commandId,
    exitCode,
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
    repairRunId: binding.repairRunId ?? "repair-run-1",
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

function failedPolicyEvidence(binding = {}, caseId = "D01") {
  const passing = policyEvidence(binding);
  const results = passing.results.map((result) =>
    result.caseId === caseId
      ? { ...result, actualDecision: result.expectedDecision === "ALLOW" ? "DENY" : "ALLOW", status: "FAIL" }
      : result,
  );
  return {
    ...passing,
    status: "FAIL",
    passed: results.length - 1,
    results,
  };
}

test("strict cartography contract rejects unknown fields, traversal, and fake live mode", () => {
  assert.deepEqual(parseRepairWorkerInput(input), input);
  assert.throws(() => parseRepairWorkerInput({ ...input, shell: "powershell" }), /must contain exactly/u);
  assert.equal(parseCartographyResult(cartography()).policyLogicLocations.length, 1);
  assert.throws(
    () => parseCartographyResult({ ...cartography(), unexpected: true }),
    /must contain exactly/u,
  );
  assert.throws(
    () => parseCartographyResult(cartography({ relevantFiles: ["../expected-fixed/src/refund.ts"] })),
    /trusted fixture/u,
  );
  assert.throws(
    () =>
      parseCartographyResult(
        cartography({ metadata: metadata("fake-live", "LIVE_CODEX_SDK") }),
        "OFFLINE_TEST_DOUBLE",
      ),
    /does not match backend mode/u,
  );
  assert.throws(
    () =>
      parseCartographyResult(
        cartography({
          entryPoints: [
            {
              file: "src/missing.ts",
              lineStart: 1,
              lineEnd: 1,
              symbol: "missing",
              reason: "Not listed as relevant.",
            },
          ],
        }),
      ),
    /outside relevantFiles/u,
  );
  assert.throws(
    () =>
      parseCartographyResult(
        cartography({
          relevantFiles: ["src/refund.ts", "tests/refund.test.mjs", "tsconfig.json"],
          proposedFilesToChange: ["src/refund.ts", "tsconfig.json"],
        }),
      ),
    /server-owned seeded fixture allowlist/u,
  );
  assert.throws(
    () => parseCartographyResult(cartography({ risks: ["OPENAI_API_KEY=must-not-pass"] })),
    /sensitive or personal-path content/u,
  );
  assert.throws(
    () =>
      parseCartographyResult(
        cartography({
          relevantFiles: ["src/refund.ts", "src/refund.ts", "tests/refund.test.mjs"],
        }),
      ),
    /must not contain duplicates/u,
  );
});

test("repair input binds source, accepted PolicyIR, and complete drift witnesses", () => {
  assert.throws(
    () => parseRepairWorkerInput({ ...input, policyVersion: 5 }),
    /identity does not match/u,
  );
  assert.throws(
    () => parseRepairWorkerInput({ ...input, sourcePolicy: sourcePolicy.replace("14", "30") }),
    /does not match the accepted PolicyIR clauses/u,
  );
  assert.throws(
    () =>
      parseRepairWorkerInput({
        ...input,
        failingDriftWitnesses: failingDriftWitnesses.slice(0, 2),
      }),
    /must exactly match/u,
  );
  assert.throws(
    () =>
      parseRepairWorkerInput({
        ...input,
        failingDriftWitnesses: failingDriftWitnesses.map((witness, index) =>
          index === 0 ? { ...witness, actualDecision: witness.expectedDecision } : witness,
        ),
      }),
    /actual policy drift/u,
  );
  assert.throws(
    () => parseRepairWorkerInput({ ...input, acceptedCases: acceptedCases.slice(0, 40) }),
    /exact 41-case corpus/u,
  );
  assert.throws(
    () =>
      parseRepairWorkerInput({
        ...input,
        acceptedCases: acceptedCases.map((policyCase, index) =>
          index === 0 ? { ...policyCase, title: `${policyCase.title} altered` } : policyCase,
        ),
      }),
    /do not match the server-owned seeded corpus/u,
  );
  assert.throws(
    () =>
      parseRepairWorkerInput({
        ...input,
        acceptedCases: acceptedCases.map((policyCase, index) =>
          index === 0 ? { ...policyCase, expectedDecision: "DENY" } : policyCase,
        ),
      }),
    /do not match the server-owned seeded corpus/u,
  );
  assert.throws(
    () =>
      parseRepairWorkerInput({
        ...input,
        failingDriftWitnesses: failingDriftWitnesses.map((witness, index) =>
          index === 0
            ? { ...witness, input: { ...witness.input, daysSincePurchase: 13 } }
            : witness,
        ),
      }),
    /must exactly match its accepted case/u,
  );
});

test("server-owned policy verification evidence is closed and internally consistent", () => {
  assert.equal(parsePolicyVerificationEvidence(policyEvidence()).total, 41);
  assert.equal(parsePolicyVerificationEvidence(failedPolicyEvidence()).status, "FAIL");
  assert.throws(
    () => parsePolicyVerificationEvidence({ ...policyEvidence(), claimedByModel: true }),
    /must contain exactly/u,
  );
  const inconsistent = policyEvidence();
  inconsistent.results[0] = { ...inconsistent.results[0], actualDecision: "DENY" };
  assert.throws(
    () => parsePolicyVerificationEvidence(inconsistent),
    /status must agree/u,
  );
});

test("evidence receipts bind the final repair to all accepted application decisions", () => {
  const applicationDecisions = new Map(
    acceptedCases.map((policyCase) => [policyCase.id, policyCase.expectedDecision]),
  );
  const receipt = policyEvidence();
  const receiptBindings = {
    fixtureTreeSha256: receipt.fixtureTreeSha256,
    acceptedCorpusSha256: receipt.acceptedCorpusSha256,
    policyIrSha256: receipt.policyIrSha256,
  };
  assert.equal(
    validatePolicyVerificationAttemptsAgainstEvidence(
      [receipt],
      acceptedCases,
      applicationDecisions,
      ["repair-run-1"],
      1,
      receiptBindings,
    ).length,
    1,
  );

  const missingResults = receipt.results.slice(0, -1);
  assert.throws(
    () =>
      validatePolicyVerificationAttemptsAgainstEvidence(
        [{ ...receipt, total: 40, passed: 40, results: missingResults }],
        acceptedCases,
        applicationDecisions,
        ["repair-run-1"],
        1,
        receiptBindings,
      ),
    /exact 41-case corpus/u,
  );

  const changedExpectationResults = receipt.results.map((result, index) =>
    index === 0
      ? { ...result, expectedDecision: "DENY", actualDecision: "DENY" }
      : result,
  );
  assert.throws(
    () =>
      validatePolicyVerificationAttemptsAgainstEvidence(
        [{ ...receipt, results: changedExpectationResults }],
        acceptedCases,
        applicationDecisions,
        ["repair-run-1"],
        1,
        receiptBindings,
      ),
    /changed an accepted case expectation/u,
  );

  const mismatchedApplication = new Map(applicationDecisions);
  mismatchedApplication.set("D01", "DENY");
  assert.throws(
    () =>
      validatePolicyVerificationAttemptsAgainstEvidence(
        [receipt],
        acceptedCases,
        mismatchedApplication,
        ["repair-run-1"],
        1,
        receiptBindings,
      ),
    /does not match post-repair application evidence/u,
  );
});

test("command evidence preserves every repair attempt and its immutable test tree", () => {
  const command = (commandId, attempt, repairRunId, exitCode = 0) => ({
    ...evidence(commandId, exitCode),
    attempt,
    repairRunId,
  });
  const finalReceipt = policyEvidence({
    attempt: 2,
    repairRunId: "repair-run-2",
    fixtureTreeSha256: "2".repeat(64),
  });
  const history = [
    command("fixture-typecheck", 1, "repair-run-1", 1),
    command("fixture-test", 1, "repair-run-1"),
    command("fixture-typecheck", 2, "repair-run-2"),
    command("fixture-test", 2, "repair-run-2"),
  ];
  assert.equal(
    validateCommandEvidenceHistory(
      history,
      ["repair-run-1", "repair-run-2"],
      2,
      [finalReceipt],
      "2".repeat(64),
    ).length,
    4,
  );
  assert.throws(
    () =>
      validateCommandEvidenceHistory(
        history.slice(2),
        ["repair-run-1", "repair-run-2"],
        2,
        [finalReceipt],
        "2".repeat(64),
      ),
    /does not preserve every repair attempt/u,
  );
  const mutatingTestHistory = history.map((item, index) =>
    index === 3 ? { ...item, fixtureTreeAfterSha256: "4".repeat(64) } : item,
  );
  assert.throws(
    () =>
      validateCommandEvidenceHistory(
        mutatingTestHistory,
        ["repair-run-1", "repair-run-2"],
        2,
        [finalReceipt],
        "4".repeat(64),
      ),
    /breaks the ordered build\/test tree boundary/u,
  );
});

test("command policy is closed and redacts credentials, home paths, and oversized output", () => {
  assert.deepEqual(getRepairCommandDefinition("fixture-typecheck").args, ["-p", "tsconfig.json"]);
  assert.throws(() => getRepairCommandDefinition("powershell"), /Unsupported repair command/u);
  const rawOpenAiToken = ["sk", "a".repeat(24)].join("-");
  const rawGitHubToken = ["ghp", "A".repeat(24)].join("_");
  const slashHomePath = ["C:", "Users", "alice", "repo"].join("/");
  const privateKeyBlock = [
    "-----BEGIN",
    "PRIVATE",
    "KEY-----",
    "sensitive-key-material",
    "-----END",
    "PRIVATE",
    "KEY-----",
  ].join(" ");
  const result = redactWorkerOutput(
    `OPENAI_API_KEY=secret-value-123456789 {"AUTH_TOKEN":"json-secret"} Bearer bearer-secret C:\\Users\\alice\\repo ${slashHomePath} ${rawOpenAiToken} ${rawGitHubToken} ${privateKeyBlock}\n${"x".repeat(20)}`,
    16,
  );
  assert.equal(result.text.includes("secret-value"), false);
  assert.equal(result.text.includes("json-secret"), false);
  assert.equal(result.text.includes("bearer-secret"), false);
  assert.equal(result.text.includes("alice"), false);
  assert.equal(result.truncated, true);
  const camelKey = ["api", "Key"].join("");
  const camelSecret = "camel-secret-value";
  const camelResult = redactWorkerOutput(`${camelKey}=${camelSecret}`);
  assert.equal(camelResult.text.includes(camelSecret), false);
  const databaseKey = ["database", "Url"].join("");
  const databaseSecret = ["postgres", "://reviewer:must-not-pass@db/policy"].join("");
  const databaseResult = redactWorkerOutput(`${databaseKey}=${databaseSecret}`);
  assert.equal(databaseResult.text.includes("must-not-pass"), false);
  assert.equal(redactWorkerOutput(databaseSecret).text.includes("must-not-pass"), false);
  const databaseUriKey = ["database", "Uri"].join("");
  assert.equal(
    redactWorkerOutput(`${databaseUriKey}=opaque-secret`).text.includes("opaque-secret"),
    false,
  );
  assert.throws(
    () =>
      parseCommandResult({
        ...evidence("fixture-typecheck"),
        stdout: `${camelKey}=${camelSecret}`,
      }),
    /sensitive or personal-path content/u,
  );
  assert.throws(
    () =>
      parseReviewResult(
        review({
          findings: [
            {
              id: rawGitHubToken,
              severity: "LOW",
              title: "Credential-shaped identifier",
              description: "Must not be retained.",
              relatedFiles: ["src/refund.ts"],
            },
          ],
        }),
      ),
    /sensitive or personal-path content/u,
  );
});

test("command runner errors retain a redacted attempted-command receipt", async () => {
  const rawGitHubToken = ["ghp", "A".repeat(24)].join("_");
  const backend = {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      return cartography();
    },
    async repair() {
      return repair(1);
    },
    async review() {
      return review();
    },
  };
  const report = await orchestrateRepair(
    { ...input, maxRepairAttempts: 1 },
    backend,
    async (commandId) => {
      if (commandId === "fixture-test") throw new Error(rawGitHubToken);
      return evidence(commandId);
    },
    async (_input, context) => policyEvidence(context),
  );
  assert.equal(report.status, "FAIL");
  assert.equal(report.failure.code, "COMMAND_FAILED");
  assert.equal(report.commandEvidence.length, 1);
  assert.equal(report.commandFailures.length, 1);
  assert.equal(report.commandFailures[0].commandId, "fixture-test");
  assert.match(report.commandFailures[0].error, /\[REDACTED_CREDENTIAL\]/u);
  assert.equal(report.failure.message.includes("AAAAAAAA"), false);
});

test("orchestration retries one failed verification batch and then requires independent review", async () => {
  let repairCalls = 0;
  let commandCalls = 0;
  const backend = {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      return cartography();
    },
    async repair(context) {
      repairCalls += 1;
      assert.equal(context.attempt, repairCalls);
      return repair(repairCalls);
    },
    async review(context) {
      assert.equal(context.commandEvidence.every((item) => item.exitCode === 0), true);
      return review();
    },
  };
  const report = await orchestrateRepair(input, backend, async (commandId) => {
    commandCalls += 1;
    return evidence(commandId, commandCalls === 1 ? 1 : 0);
  }, async (_input, context) => policyEvidence(context));
  assert.equal(report.executionMode, "OFFLINE_TEST_DOUBLE");
  assert.equal(report.status, "PASS");
  assert.equal(report.attempts, 2);
  assert.equal(report.repairAttempts.length, 2);
  assert.equal(report.commandEvidence.length, 4);
  assert.deepEqual(
    report.commandEvidence.map((item) => item.attempt),
    [1, 1, 2, 2],
  );
  assert.equal(report.commandEvidence[0].exitCode, 1);
  assert.equal(
    report.commandEvidence
      .filter((item) => item.attempt === 2)
      .every((item) => item.exitCode === 0),
    true,
  );
  assert.equal(report.review.verdict, "APPROVE");
  assert.equal(report.failure, null);
});

test("repair cannot expand its write set beyond read-only cartography", async () => {
  const backend = {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      return cartography();
    },
    async repair() {
      return repair(1, {
        changedFiles: ["src/refund.ts", "tests/refund.test.mjs", "tsconfig.json"],
      });
    },
    async review() {
      return review();
    },
  };
  const report = await orchestrateRepair(
    input,
    backend,
    async (commandId) => evidence(commandId),
    async (_input, context) => policyEvidence(context),
  );
  assert.equal(report.status, "FAIL");
  assert.equal(report.failure.code, "REPAIR_INVALID");
  assert.match(report.failure.message, /do not exactly match the cartography plan/u);
});

test("full accepted-corpus verification retries once and blocks incomplete receipts", async () => {
  const repairContexts = [];
  let verificationCalls = 0;
  const retryingBackend = {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      return cartography();
    },
    async repair(context) {
      repairContexts.push(context);
      return repair(context.attempt);
    },
    async review(context) {
      assert.equal(context.policyVerification.status, "PASS");
      assert.equal(context.policyVerification.total, 41);
      return review();
    },
  };
  const retried = await orchestrateRepair(
    input,
    retryingBackend,
    async (commandId) => evidence(commandId),
    async (_input, context) => {
      verificationCalls += 1;
      return verificationCalls === 1
        ? failedPolicyEvidence(context)
        : policyEvidence(context);
    },
  );
  assert.equal(retried.status, "PASS", retried.failure?.message);
  assert.equal(retried.attempts, 2);
  assert.equal(repairContexts[0].previousPolicyVerification, null);
  assert.equal(repairContexts[1].previousPolicyVerification.status, "FAIL");
  assert.equal(retried.policyVerificationAttempts.length, 2);
  assert.equal(retried.policyVerificationAttempts[0].status, "FAIL");
  assert.equal(retried.policyVerificationAttempts[1].status, "PASS");

  let incompleteVerificationCalls = 0;
  const incomplete = await orchestrateRepair(
    input,
    retryingBackend,
    async (commandId) => evidence(commandId),
    async (_input, context) => {
      incompleteVerificationCalls += 1;
      const complete = policyEvidence(context);
      const results = complete.results.slice(0, -1);
      return {
        ...complete,
        total: results.length,
        passed: results.length,
        results,
      };
    },
  );
  assert.equal(incomplete.status, "FAIL");
  assert.equal(incomplete.attempts, 1);
  assert.equal(incompleteVerificationCalls, 1);
  assert.equal(incomplete.failure.code, "POLICY_VERIFICATION_FAILED");
  assert.match(incomplete.failure.message, /exact 41-case corpus/u);

  const unbound = await orchestrateRepair(
    { ...input, maxRepairAttempts: 1 },
    retryingBackend,
    async (commandId) => evidence(commandId),
    async (_input, context) =>
      policyEvidence({ ...context, repairRunId: "forged-repair-run" }),
  );
  assert.equal(unbound.status, "FAIL");
  assert.equal(unbound.failure.code, "POLICY_VERIFICATION_FAILED");
  assert.match(unbound.failure.message, /not bound to the current repair attempt/u);
});

test("high-severity independent review blocks proof", async () => {
  const backend = {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      return cartography();
    },
    async repair() {
      return repair(1);
    },
    async review() {
      return review({
        verdict: "BLOCK",
        findings: [
          {
            id: "review-001",
            severity: "HIGH",
            title: "Final-sale bypass remains",
            description: "A bypass path still allows a final-sale purchase.",
            relatedFiles: ["src/refund.ts"],
          },
        ],
      });
    },
  };
  const report = await orchestrateRepair(
    input,
    backend,
    async (commandId) => evidence(commandId),
    async (_input, context) => policyEvidence(context),
  );
  assert.equal(report.status, "FAIL");
  assert.equal(report.failure.code, "REVIEW_BLOCKED");
});
