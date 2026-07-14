import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  REQUIRED_EVIDENCE_FILES,
  SEEDED_REFUND_CODE_MAPPINGS,
  analyzePolicyImpact,
  buildTraceabilityReport,
  compilePolicyToRego,
  createDaysThresholdVersion,
  generateAcceptedCaseCorpus,
  resolvePolicyAmbiguity,
  runDifferentialCases,
  runOfflineMutationSuite,
  validateEvidencePackage,
} from "../dist/index.js";
import { ROOT } from "./process.mjs";

await import("./build-evidence-fixtures.mjs");
const baseline = await import("../.tmp/evidence-fixture-build/baseline/src/refund.js");
const fixed = await import("../.tmp/evidence-fixture-build/expected-fixed/src/refund.js");

const GENERATED_AT = "2026-07-14T01:00:00.000Z";
const evidenceDirectory = resolve(ROOT, "artifacts", "evidence");
if (
  evidenceDirectory !== resolve(ROOT, "artifacts", "evidence") ||
  relative(ROOT, evidenceDirectory).startsWith("..")
) {
  throw new Error(`Refusing to replace an unmanaged evidence directory: ${evidenceDirectory}`);
}

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
}

const recorded = readJson("fixtures/interpreter/recorded-policy-ir.v1.json");
const goldenCases = readJson("fixtures/refund-demo/cases/golden-cases.json");
const driftCases = readJson("fixtures/refund-demo/cases/seeded-drift-cases.json");
const offlineM7 = readJson("tests/snapshots/offline-m7-summary.json");
let policy = recorded;
for (const [ambiguityId, optionId] of [
  ["ambiguity-purchase-day-index", "purchase-day-zero"],
  ["ambiguity-usage-measurement-time", "usage-at-request"],
  ["ambiguity-default-decision", "default-deny"],
]) {
  policy = resolvePolicyAmbiguity(policy, ambiguityId, optionId, goldenCases).policy;
}

const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);
const generatedCases = cases.filter((policyCase) => policyCase.source !== "USER_GOLDEN");
const compilation = compilePolicyToRego(policy);
const mutation = runOfflineMutationSuite(policy, cases);
const before = runDifferentialCases(policy, cases, "fixture-baseline", baseline.decideRefund);
const fixedReference = runDifferentialCases(
  policy,
  cases,
  "fixture-expected-fixed-evaluation-only",
  fixed.decideRefund,
);
const traceability = buildTraceabilityReport(policy, cases, SEEDED_REFUND_CODE_MAPPINGS);
const impactPolicy = createDaysThresholdVersion(policy, 30, GENERATED_AT);
const impact = analyzePolicyImpact(
  policy,
  impactPolicy,
  cases,
  goldenCases.map((policyCase) => policyCase.id),
  SEEDED_REFUND_CODE_MAPPINGS,
);

const promptFiles = [
  "prompts/interpreter.v1.md",
  "prompts/cartographer.v1.md",
  "prompts/repair.v1.md",
  "prompts/reviewer.v1.md",
];
const payload = new Map();
payload.set("policy-ir.json", json(policy));
payload.set(
  "compiled-policy.rego",
  compilation.source.endsWith("\n") ? compilation.source : `${compilation.source}\n`,
);
payload.set("golden-cases.json", json(goldenCases));
payload.set("generated-cases.json", json(generatedCases));
payload.set(
  "opa-results.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    executionMode: "NOT_RUN",
    reason: "OPA is not installed; reference evaluation is stored separately and is not OPA evidence.",
    policyVersion: policy.version,
  }),
);
payload.set("app-results-before.json", json(before));
payload.set(
  "drift-report-before.json",
  json({
    schemaVersion: "1",
    executionMode: before.executionMode,
    adapterId: before.adapterId,
    drifts: before.drifts,
    errors: before.errors,
    records: before.records.filter((record) => record.status !== "MATCH"),
    defectClusters: before.defectClusters,
  }),
);
payload.set(
  "codex-run-summary.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_LIVE",
    executionMode: "OFFLINE_TEST_DOUBLE",
    liveCodexClaim: false,
    contractSnapshot: offlineM7,
    reason: "No Codex SDK call or code repair occurred in this partial offline package.",
  }),
);
payload.set(
  "integration.diff",
  "# NOT_RUN_LIVE\n# No Codex repair diff exists in this partial offline evidence package.\n",
);
payload.set(
  "app-results-after.json",
  json({
    ...fixedReference,
    evidenceBasis: "EVALUATION_ONLY_FIXED_FIXTURE_NOT_CODEX_REPAIR",
  }),
);
payload.set(
  "drift-report-after.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_AFTER_CODEX",
    evidenceBasis: "EVALUATION_ONLY_FIXED_FIXTURE_NOT_CODEX_REPAIR",
    evaluationOnlyFixedFixtureDrifts: fixedReference.drifts,
    evaluationOnlyFixedFixtureErrors: fixedReference.errors,
  }),
);
payload.set("mutation-report.json", json(mutation));
payload.set("traceability.json", json(traceability));
payload.set(
  "run-metadata.json",
  json({
    schemaVersion: "1",
    evidenceMode: "PARTIAL_OFFLINE",
    generatedAt: GENERATED_AT,
    policyVersion: policy.version,
    recordedInterpreter: true,
    freshExternalWork: false,
  }),
);
payload.set(
  "prompt-manifest.json",
  json({
    schemaVersion: "1",
    prompts: promptFiles.map((file) => ({
      file,
      sha256: hashText(readFileSync(resolve(ROOT, file), "utf8")),
    })),
  }),
);
payload.set("compiler-manifest.json", json(compilation.manifest));
payload.set(
  "codex-cartography.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_LIVE",
    executionMode: "OFFLINE_TEST_DOUBLE",
    liveCodexClaim: false,
  }),
);
payload.set(
  "codex-review.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_LIVE",
    executionMode: "OFFLINE_TEST_DOUBLE",
    liveCodexClaim: false,
  }),
);
payload.set(
  "test-command-log.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_IN_ARTIFACT_GENERATION",
    commands: [],
    reason: "Repository verification is recorded in PROGRESS.md; no fresh command claim is embedded here.",
  }),
);
payload.set(
  "security-review.md",
  "# Security review\n\nStatus: NOT_RUN\n\nA focused release security review has not occurred. This keeps the package status at FAIL.\n",
);
payload.set("impact-report.json", json(impact));
payload.set(
  "eval-scorecard.json",
  json({
    schemaVersion: "1",
    status: "FAIL",
    evidenceMode: "PARTIAL_OFFLINE",
    metrics: {
      structuredOutputSchemaPass: { value: null, target: 1, status: "NOT_RUN_LIVE" },
      seededDriftBugsDetected: { value: 3, target: 3, status: "PASS_REFERENCE" },
      acceptedCorpusSize: { value: cases.length, target: 30, status: "PASS_REFERENCE" },
      postRepairDrift: { value: null, target: 0, status: "NOT_RUN_LIVE" },
      evaluationOnlyFixedFixtureDrift: { value: fixedReference.drifts, target: 0, status: "PASS_EVALUATION_ONLY" },
      mutationKillRate: { value: mutation.killRate, target: 0.9, status: "PASS_REFERENCE_NOT_OPA" },
      ruleClauseTraceability: { value: traceability.metrics.rulesCovered / traceability.metrics.rulesTotal, target: 1, status: "PASS_OFFLINE" },
      securityFindings: { value: null, target: 0, status: "NOT_RUN" },
      browserHappyPath: { value: null, target: 1, status: "NOT_RUN" }
    }
  }),
);

const includedEntries = [...payload.entries()]
  .map(([file, content]) => ({ file, sha256: hashText(content) }))
  .sort((left, right) => left.file.localeCompare(right.file));
const evidenceHash = hashText(
  includedEntries.map((entry) => `${entry.file}\0${entry.sha256}\0`).join(""),
);
const verificationSummary = {
  schemaVersion: "1",
  status: "FAIL",
  evidenceMode: "PARTIAL_OFFLINE",
  policyVersion: policy.version,
  golden: { passed: goldenCases.length, total: goldenCases.length, executionMode: "REFERENCE_EVALUATOR_NOT_OPA" },
  generated: { passed: generatedCases.length, total: generatedCases.length, executionMode: "REFERENCE_EVALUATOR_NOT_OPA" },
  driftBefore: before.drifts,
  driftAfter: null,
  evaluationOnlyFixedFixtureDrift: fixedReference.drifts,
  mutation: {
    killed: mutation.killed,
    total: mutation.total,
    excludedEquivalent: mutation.excludedEquivalent,
    killRate: mutation.killRate,
    executionMode: mutation.executionMode,
  },
  regression: { passed: null, total: null, status: "NOT_RUN" },
  traceability: {
    clausesCovered: traceability.metrics.clausesCovered,
    clausesTotal: traceability.metrics.clausesTotal,
    rulesCovered: traceability.metrics.rulesCovered,
    rulesTotal: traceability.metrics.rulesTotal,
    unlinkedCodeLocations: traceability.metrics.unlinkedCodeLocations,
  },
  security: { critical: null, high: null, status: "NOT_RUN" },
  externalGates: {
    gpt56: "NOT_RUN",
    opa: "NOT_RUN",
    codex: "NOT_RUN",
    browser: "NOT_RUN",
    container: "NOT_RUN",
    deployment: "NOT_RUN",
  },
  evidenceHash,
  createdAt: GENERATED_AT,
};
const summary = `# PolicyTwin partial evidence summary

Status: FAIL
Evidence mode: PARTIAL_OFFLINE
Evidence hash: ${evidenceHash}

This package proves deterministic offline contracts only. It does not prove a GPT-5.6 call, OPA execution, Codex repair, post-repair drift, browser flow, security release review, container, deployment, or submission.

- Accepted reference corpus: ${cases.length} cases (${goldenCases.length} golden, ${generatedCases.length} generated)
- Buggy fixture reference differential: ${before.drifts} drifts, ${before.errors} execution errors
- Evaluation-only fixed fixture: ${fixedReference.drifts} drifts; this is not Codex repair evidence
- Reference mutation score: ${mutation.killed}/${mutation.total} (${(mutation.killRate * 100).toFixed(2)}%); this is not OPA evidence
- Traceability: ${traceability.metrics.clausesCovered}/${traceability.metrics.clausesTotal} clauses and ${traceability.metrics.rulesCovered}/${traceability.metrics.rulesTotal} rules covered
- 14→30 impact preview: ${impact.changedCases.length} changed case expectations; blocked by golden case ${impact.goldenContradictionCaseIds.join(", ")}
`;

const allFiles = new Map(payload);
allFiles.set("verification-summary.json", json(verificationSummary));
allFiles.set("summary.md", summary);
const manifestEntries = [...allFiles.entries()]
  .map(([file, content]) => ({
    file,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: hashText(content),
    includedInEvidenceHash: payload.has(file),
  }))
  .sort((left, right) => left.file.localeCompare(right.file));
const manifest = {
  schemaVersion: "1",
  algorithm: "SHA-256",
  packageStatus: "FAIL",
  evidenceMode: "PARTIAL_OFFLINE",
  evidenceHash,
  entries: manifestEntries,
};
allFiles.set("evidence-manifest.json", json(manifest));

rmSync(evidenceDirectory, { recursive: true, force: true });
mkdirSync(evidenceDirectory, { recursive: true });
for (const [file, content] of allFiles) {
  writeFileSync(join(evidenceDirectory, file), content, "utf8");
}

const diskFiles = new Map(
  readdirSync(evidenceDirectory)
    .sort()
    .map((file) => [file, readFileSync(join(evidenceDirectory, file), "utf8")]),
);
validateEvidencePackage(diskFiles, hashText);
const missing = REQUIRED_EVIDENCE_FILES.filter((file) => !diskFiles.has(file));
if (missing.length > 0) {
  throw new Error(`Generated package is missing required files: ${missing.join(", ")}`);
}
console.log(`Generated truthful partial evidence package: ${evidenceHash}`);
