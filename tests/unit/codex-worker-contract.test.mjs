import assert from "node:assert/strict";
import test from "node:test";
import {
  getRepairCommandDefinition,
  orchestrateRepair,
  parseCartographyResult,
  parseRepairWorkerInput,
  redactWorkerOutput,
} from "../../dist/index.js";

const input = {
  policyId: "seeded-refund-policy",
  policyVersion: 4,
  fixtureId: "seeded-refund-demo",
  policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
  failingCaseIds: ["D01", "D02", "D03"],
  allowedCommandIds: ["fixture-typecheck", "fixture-test"],
  maxRepairAttempts: 2,
};

function metadata(runId, executionMode = "OFFLINE_TEST_DOUBLE", backendId = "offline-worker-double") {
  return {
    executionMode,
    backendId,
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
    addedTests: ["tests/refund.test.mjs"],
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
  return {
    schemaVersion: "1",
    commandId,
    exitCode,
    timedOut: false,
    durationMs: 1,
    stdout: "ok",
    stderr: "",
    outputTruncated: false,
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
});

test("command policy is closed and redacts credentials, home paths, and oversized output", () => {
  assert.deepEqual(getRepairCommandDefinition("fixture-typecheck").args, ["-p", "tsconfig.json"]);
  assert.throws(() => getRepairCommandDefinition("powershell"), /Unsupported repair command/u);
  const result = redactWorkerOutput(
    'OPENAI_API_KEY=secret-value-123456789 {"AUTH_TOKEN":"json-secret"} Bearer bearer-secret C:\\Users\\alice\\repo\n' + "x".repeat(20),
    16,
  );
  assert.equal(result.text.includes("secret-value"), false);
  assert.equal(result.text.includes("json-secret"), false);
  assert.equal(result.text.includes("bearer-secret"), false);
  assert.equal(result.text.includes("alice"), false);
  assert.equal(result.truncated, true);
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
  });
  assert.equal(report.executionMode, "OFFLINE_TEST_DOUBLE");
  assert.equal(report.status, "PASS");
  assert.equal(report.attempts, 2);
  assert.equal(report.repairAttempts.length, 2);
  assert.equal(report.commandEvidence.length, 2);
  assert.equal(report.review.verdict, "APPROVE");
  assert.equal(report.failure, null);
});

test("repair cannot expand its write set beyond read-only cartography", async () => {
  const backend = {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      return cartography({ proposedFilesToChange: ["src/refund.ts"] });
    },
    async repair() {
      return repair(1);
    },
    async review() {
      return review();
    },
  };
  const report = await orchestrateRepair(input, backend, async (commandId) => evidence(commandId));
  assert.equal(report.status, "FAIL");
  assert.equal(report.failure.code, "REPAIR_INVALID");
  assert.match(report.failure.message, /outside the cartography plan/u);
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
  const report = await orchestrateRepair(input, backend, async (commandId) => evidence(commandId));
  assert.equal(report.status, "FAIL");
  assert.equal(report.failure.code, "REVIEW_BLOCKED");
});
