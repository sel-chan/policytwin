import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT } from "./process.mjs";

await import("./build-core.mjs");
const {
  REQUIRED_EVIDENCE_FILES,
  SEEDED_REFUND_CODE_MAPPINGS,
  analyzePolicyImpact,
  buildTraceabilityReport,
  compilePolicyToRego,
  computeEvidencePackageHash,
  createDaysThresholdVersion,
  generateAcceptedCaseCorpus,
  generatePolicyMutants,
  resolvePolicyAmbiguity,
  runDifferentialCases,
  runOfflineMutationSuite,
  runOpaCases,
  validateEvidencePackage,
} = await import("../dist/index.js");

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
const containerContract = readJson("container-contract.json");
const opaPath = resolve(
  process.env.OPA_PATH ??
    resolve(
      ROOT,
      ".tools",
      "opa",
      containerContract.opaVersion,
      process.platform === "win32" ? "opa.exe" : "opa",
    ),
);
if (!existsSync(opaPath)) {
  throw new Error("Verified OPA binary is required; run pnpm opa:install first.");
}
const opa = runOpaCases({
  executablePath: opaPath,
  expectedVersion: containerContract.opaVersion,
  expectedExecutableSha256:
    process.platform === "win32"
      ? containerContract.opaWindowsSha256
      : containerContract.opaLinuxAmd64StaticSha256,
  regoSource: compilation.source,
  query: compilation.manifest.query,
  cases,
});
const opaCasesById = new Map(cases.map((policyCase) => [policyCase.id, policyCase]));
const opaMismatches = opa.results.filter(
  (result) => result.result.decision !== opaCasesById.get(result.caseId)?.expectedDecision,
);
if (opaMismatches.length > 0) {
  throw new Error(`OPA disagrees with ${opaMismatches.length} accepted case(s).`);
}
const mutation = runOfflineMutationSuite(policy, cases);
const mutantPolicies = generatePolicyMutants(policy, cases);
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
  "gpt-run-summary.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    executionMode: "RECORDED_FIXTURE",
    runId: null,
    model: null,
    responseId: null,
    policyIrSha256: hashText(json(policy)),
  }),
);
payload.set(
  "opa-results.json",
  json({
    ...opa,
    status: "PASS",
    policyVersion: policy.version,
    acceptedCaseAgreement: {
      passed: opa.results.length,
      total: cases.length,
    },
  }),
);
payload.set("app-results-before.json", json(before));
payload.set(
  "drift-report-before.json",
  json(before),
);
payload.set(
  "codex-run-summary.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_LIVE",
    executionMode: "OFFLINE_TEST_DOUBLE",
    liveCodexClaim: false,
    policyVerificationAttempts: [],
    contractSnapshot: offlineM7,
    reason: "No Codex SDK call or code repair occurred in this partial offline package.",
  }),
);
payload.set(
  "codex-command-receipts.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_LIVE",
    executionMode: "OFFLINE_TEST_DOUBLE",
    runId: null,
    fixtureTreeSha256: null,
    commands: [],
  }),
);
payload.set(
  "integration.diff",
  "# NOT_RUN_LIVE\n# No Codex repair diff exists in this partial offline evidence package.\n",
);
for (const file of ["fixture-tree-before.json", "fixture-tree-after.json"]) {
  payload.set(
    file,
    json({
      schemaVersion: "1",
      status: "NOT_RUN_LIVE",
      runId: null,
      fixtureId: "seeded-refund-demo",
      treeSha256: null,
      files: [],
    }),
  );
}
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
const mutationReportContent = json(mutation);
payload.set("mutation-report.json", mutationReportContent);
payload.set(
  "mutation-run-summary.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_OPA",
    executionMode: "REFERENCE_EVALUATOR_NOT_OPA",
    runId: null,
    opaVersion: null,
    executableSha256: null,
    reportSha256: hashText(mutationReportContent),
    total: mutation.total,
    mutantPolicyHashes: mutantPolicies.map((mutant) => ({
      mutantId: mutant.id,
      policySha256: hashText(JSON.stringify(mutant.policy)),
    })),
    opaResultHashes: [],
  }),
);
payload.set(
  "mutation-opa-results.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN_OPA",
    executionMode: "REFERENCE_EVALUATOR_NOT_OPA",
    runId: null,
    results: [],
  }),
);
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
    runId: null,
    fixtureBeforeSha256: null,
    fixtureAfterSha256: null,
    integrationDiffSha256: null,
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
    runId: null,
    commands: [],
    reason: "Repository verification is recorded in PROGRESS.md; no fresh command claim is embedded here.",
  }),
);
payload.set(
  "browser-run-summary.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    executionMode: "NOT_RUN",
    runId: null,
    targetUrl: null,
    command: null,
    exitCode: null,
    passed: null,
    total: null,
    reportSha256: null,
    screenshotSha256s: [],
  }),
);
payload.set(
  "browser-run-details.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    runId: null,
    targetUrl: null,
    report: null,
    screenshots: [],
  }),
);
payload.set(
  "container-run-summary.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    executionMode: "NOT_RUN",
    runId: null,
    imageDigest: null,
    buildExitCode: null,
    healthExitCode: null,
    healthStatus: null,
    platform: null,
    opaVersion: null,
    opaExecutableSha256: null,
    buildLogSha256: null,
    healthResponseSha256: null,
  }),
);
payload.set(
  "container-run-details.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    runId: null,
    buildLog: null,
    healthResponse: null,
  }),
);
payload.set(
  "deployment-run-summary.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    executionMode: "NOT_RUN",
    runId: null,
    url: null,
    healthUrl: null,
    checkedAt: null,
    statusCode: null,
    responseSha256: null,
  }),
);
payload.set(
  "deployment-health-response.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    runId: null,
    url: null,
    checkedAt: null,
    statusCode: null,
    anonymousAccess: null,
    headers: null,
    body: null,
  }),
);
payload.set(
  "security-report.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    scope: "NOT_RUN",
    runId: null,
    critical: null,
    high: null,
    findings: [],
    commands: [],
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
    runId: null,
    metrics: {
      structuredOutputSchemaPass: { value: null, target: 1, status: "NOT_RUN_LIVE" },
      seededDriftBugsDetected: { value: 3, target: 3, status: "PASS_REFERENCE" },
      acceptedCorpusSize: { value: cases.length, target: 30, status: "PASS_REFERENCE" },
      postRepairDrift: { value: null, target: 0, status: "NOT_RUN_LIVE" },
      evaluationOnlyFixedFixtureDrift: { value: fixedReference.drifts, target: 0, status: "PASS_EVALUATION_ONLY" },
      opaCaseAgreement: { value: opa.results.length, target: cases.length, status: "PASS_OPA" },
      mutationKillRate: { value: mutation.killRate, target: 0.9, status: "PASS_REFERENCE_NOT_OPA_MUTATION" },
      ruleClauseTraceability: { value: traceability.metrics.rulesCovered / traceability.metrics.rulesTotal, target: 1, status: "PASS_OFFLINE" },
      securityFindings: { value: null, target: 0, status: "NOT_RUN" },
      browserHappyPath: { value: null, target: 1, status: "NOT_RUN" }
    }
  }),
);

const evidenceHashPlaceholder = "0".repeat(64);
const verificationSummary = {
  schemaVersion: "1",
  status: "FAIL",
  evidenceMode: "PARTIAL_OFFLINE",
  policyVersion: policy.version,
  golden: { passed: goldenCases.length, total: goldenCases.length, executionMode: "OPA_CLI" },
  generated: { passed: generatedCases.length, total: generatedCases.length, executionMode: "OPA_CLI" },
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
    opa: "PASS",
    codex: "NOT_RUN",
    browser: "NOT_RUN",
    container: "NOT_RUN",
    deployment: "NOT_RUN",
  },
  evidenceHash: evidenceHashPlaceholder,
  createdAt: GENERATED_AT,
};
const summaryTemplate = `# PolicyTwin partial evidence summary

Status: FAIL
Evidence mode: PARTIAL_OFFLINE
Evidence hash: ${evidenceHashPlaceholder}

This package proves deterministic offline contracts and real OPA v${opa.opaVersion} execution. It does not prove a GPT-5.6 call, Codex repair, post-repair drift, browser flow, security release review, container, deployment, or submission.

- Accepted OPA corpus: ${opa.results.length}/${cases.length} cases (${goldenCases.length} golden, ${generatedCases.length} generated)
- Buggy fixture reference differential: ${before.drifts} drifts, ${before.errors} execution errors
- Evaluation-only fixed fixture: ${fixedReference.drifts} drifts; this is not Codex repair evidence
- Reference mutation score: ${mutation.killed}/${mutation.total} (${(mutation.killRate * 100).toFixed(2)}%); mutation execution is not yet OPA-backed
- Traceability: ${traceability.metrics.clausesCovered}/${traceability.metrics.clausesTotal} clauses and ${traceability.metrics.rulesCovered}/${traceability.metrics.rulesTotal} rules covered
- 14→30 impact preview: ${impact.changedCases.length} changed case expectations; blocked by golden case ${impact.goldenContradictionCaseIds.join(", ")}
`;

const allFiles = new Map(payload);
allFiles.set("verification-summary.json", json(verificationSummary));
allFiles.set("summary.md", summaryTemplate);
const hashEntries = [...allFiles.keys()].map((file) => ({
  file,
  includedInEvidenceHash: true,
}));
const evidenceHash = computeEvidencePackageHash(allFiles, hashEntries, hashText);
verificationSummary.evidenceHash = evidenceHash;
allFiles.set("verification-summary.json", json(verificationSummary));
allFiles.set("summary.md", summaryTemplate.replace(evidenceHashPlaceholder, evidenceHash));
const manifestEntries = [...allFiles.entries()]
  .map(([file, content]) => ({
    file,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: hashText(content),
    includedInEvidenceHash: true,
  }))
  .sort((left, right) => left.file.localeCompare(right.file));
const manifest = {
  schemaVersion: "1",
  algorithm: "SHA-256",
  packageStatus: "FAIL",
  evidenceMode: "PARTIAL_OFFLINE",
  evidenceHash,
  liveAttestation: null,
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
