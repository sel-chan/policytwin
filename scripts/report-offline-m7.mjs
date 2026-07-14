import { orchestrateRepair } from "../dist/index.js";

const metadata = (runId) => ({
  executionMode: "OFFLINE_TEST_DOUBLE",
  backendId: "offline-worker-double",
  runId,
  startedAt: "2026-07-14T00:00:00.000Z",
  completedAt: "2026-07-14T00:00:01.000Z",
});
const location = {
  file: "src/refund.ts",
  lineStart: 12,
  lineEnd: 31,
  symbol: "decideRefund",
  reason: "Seeded refund decision path.",
};
let repairCalls = 0;
let commandCalls = 0;
const report = await orchestrateRepair(
  {
    policyId: "seeded-refund-policy",
    policyVersion: 4,
    fixtureId: "seeded-refund-demo",
    policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
    failingCaseIds: ["D01", "D02", "D03"],
    allowedCommandIds: ["fixture-typecheck", "fixture-test"],
    maxRepairAttempts: 2,
  },
  {
    executionMode: "OFFLINE_TEST_DOUBLE",
    async cartograph() {
      return {
        schemaVersion: "1",
        phase: "CARTOGRAPHY",
        metadata: metadata("offline-cartography"),
        relevantFiles: ["src/refund.ts", "tests/refund.test.mjs"],
        entryPoints: [location],
        policyLogicLocations: [location],
        testFiles: ["tests/refund.test.mjs"],
        risks: ["Seeded boundaries and precedence need regression assertions."],
        proposedFilesToChange: ["src/refund.ts", "tests/refund.test.mjs"],
        verificationCommandIds: ["fixture-typecheck", "fixture-test"],
      };
    },
    async repair() {
      repairCalls += 1;
      return {
        schemaVersion: "1",
        phase: "REPAIR",
        metadata: metadata(`offline-repair-${repairCalls}`),
        changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
        summary: "Offline contract fixture only; no code was repaired by Codex.",
        rationale: ["Exercise bounded orchestration and strict result validation."],
        addedTests: ["tests/refund.test.mjs"],
        remainingRisks: ["A live Codex SDK run remains mandatory."],
        verificationCommandIds: ["fixture-typecheck", "fixture-test"],
      };
    },
    async review() {
      return {
        schemaVersion: "1",
        phase: "REVIEW",
        metadata: metadata("offline-independent-review"),
        verdict: "APPROVE",
        summary: "Offline contract validation approved; this is not a code review by Codex.",
        findings: [],
      };
    },
  },
  async (commandId) => {
    commandCalls += 1;
    return {
      schemaVersion: "1",
      commandId,
      exitCode: commandCalls === 1 ? 1 : 0,
      timedOut: false,
      durationMs: 1,
      stdout: "offline test double",
      stderr: "",
      outputTruncated: false,
    };
  },
);

console.log(
  JSON.stringify(
    {
      executionMode: report.executionMode,
      liveCodexClaim: false,
      status: report.status,
      attempts: report.attempts,
      cartographyFiles: report.cartography?.relevantFiles ?? [],
      repairAttemptCount: report.repairAttempts.length,
      finalCommandIds: report.commandEvidence.map((item) => item.commandId),
      finalCommandsPassed: report.commandEvidence.every(
        (item) => item.exitCode === 0 && !item.timedOut,
      ),
      reviewVerdict: report.review?.verdict ?? null,
      failure: report.failure,
    },
    null,
    2,
  ),
);
