import { readFile } from "node:fs/promises";
import { orchestrateRepair } from "../dist/index.js";

const sourcePolicy = await readFile(
  new URL("../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const acceptedPolicyIr = JSON.parse(
  await readFile(
    new URL("../artifacts/evidence/policy-ir.json", import.meta.url),
    "utf8",
  ),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../artifacts/evidence/golden-cases.json", import.meta.url), "utf8"),
);
const generatedCases = JSON.parse(
  await readFile(new URL("../artifacts/evidence/generated-cases.json", import.meta.url), "utf8"),
);
const acceptedCases = [...goldenCases, ...generatedCases];
const driftCases = JSON.parse(
  await readFile(
    new URL("../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url),
    "utf8",
  ),
);
const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
const defectsByCase = {
  D01: ["DAY_14_INCLUSIVE"],
  D02: ["USAGE_2000_INCLUSIVE"],
  D03: ["FINAL_SALE_PRECEDENCE"],
};

const metadata = (runId) => ({
  executionMode: "OFFLINE_TEST_DOUBLE",
  backendId: "offline-worker-double",
  sdkVersion: "not-applicable-offline-double",
  model: "offline-test-double",
  modelReasoningEffort: "high",
  promptTemplateSha256: "a".repeat(64),
  requestSha256: "b".repeat(64),
  outputSchemaSha256: "c".repeat(64),
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
        dataFlow: [location],
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
    const fixtureTreeBeforeSha256 =
      commandId === "fixture-typecheck" ? "1".repeat(64) : "2".repeat(64);
    return {
      schemaVersion: "1",
      commandId,
      exitCode: commandCalls === 1 ? 1 : 0,
      timedOut: false,
      durationMs: 1,
      stdout: "offline test double",
      stderr: "",
      outputTruncated: false,
      fixtureTreeBeforeSha256,
      fixtureTreeAfterSha256: "2".repeat(64),
    };
  },
  async (_input, context) => {
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
      attempt: context.attempt,
      repairRunId: context.repairRunId,
      fixtureTreeSha256: context.fixtureTreeSha256,
      acceptedCorpusSha256: context.acceptedCorpusSha256,
      policyIrSha256: context.policyIrSha256,
      status: "PASS",
      total: results.length,
      passed: results.length,
      results,
    };
  },
);

const finalCommandEvidence = report.commandEvidence.filter(
  (item) => item.attempt === report.attempts,
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
      commandEvidenceAttemptCount: new Set(report.commandEvidence.map((item) => item.attempt)).size,
      retainedFailedCommandCount: report.commandEvidence.filter(
        (item) => item.exitCode !== 0 || item.timedOut,
      ).length,
      finalCommandIds: finalCommandEvidence.map((item) => item.commandId),
      finalCommandsPassed: finalCommandEvidence.every(
        (item) => item.exitCode === 0 && !item.timedOut,
      ),
      policyVerificationAttemptCount: report.policyVerificationAttempts.length,
      policyVerificationStatus: report.policyVerificationAttempts.at(-1)?.status ?? null,
      policyVerificationTotal: report.policyVerificationAttempts.at(-1)?.total ?? 0,
      reviewVerdict: report.review?.verdict ?? null,
      failure: report.failure,
    },
    null,
    2,
  ),
);
