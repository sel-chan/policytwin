import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  computeEvidencePackageHash,
  liveEvidenceAttestationMessage,
  validateEvidencePackage,
} from "../../dist/index.js";

await import("../../scripts/generate-offline-evidence.mjs");

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resignEvidence(files) {
  const placeholder = "0".repeat(64);
  const manifest = JSON.parse(files.get("evidence-manifest.json"));
  const verification = JSON.parse(files.get("verification-summary.json"));
  verification.evidenceHash = placeholder;
  files.set("verification-summary.json", json(verification));
  files.set(
    "summary.md",
    files.get("summary.md").replace(/Evidence hash: [0-9a-f]{64}/u, `Evidence hash: ${placeholder}`),
  );
  const hashEntries = manifest.entries.map((entry) => ({
    file: entry.file,
    includedInEvidenceHash: true,
  }));
  const evidenceHash = computeEvidencePackageHash(files, hashEntries, hashText);
  verification.evidenceHash = evidenceHash;
  files.set("verification-summary.json", json(verification));
  files.set("summary.md", files.get("summary.md").replace(placeholder, evidenceHash));
  manifest.packageStatus = verification.status;
  manifest.evidenceMode = verification.evidenceMode;
  manifest.evidenceHash = evidenceHash;
  manifest.entries = manifest.entries.map((entry) => {
    const content = files.get(entry.file);
    return {
      ...entry,
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: hashText(content),
      includedInEvidenceHash: true,
    };
  });
  files.set("evidence-manifest.json", json(manifest));
  return evidenceHash;
}

async function loadEvidence() {
  const directory = new URL("../../artifacts/evidence/", import.meta.url);
  const names = await readdir(directory);
  return new Map(
    await Promise.all(
      names.map(async (name) => [name, await readFile(new URL(name, directory), "utf8")]),
    ),
  );
}

test("generated partial package is complete, deterministic, redacted, and fail-closed", async () => {
  const files = await loadEvidence();
  const manifest = validateEvidencePackage(files, hashText);
  assert.equal(manifest.packageStatus, "FAIL");
  assert.equal(manifest.evidenceMode, "PARTIAL_OFFLINE");
  const verification = JSON.parse(files.get("verification-summary.json"));
  assert.equal(verification.driftAfter, null);
  assert.equal(verification.evaluationOnlyFixedFixtureDrift, 0);
  assert.equal(verification.externalGates.opa, "PASS");
  const drift = JSON.parse(files.get("drift-report-before.json"));
  assert.equal(drift.total, 41);
  assert.equal(drift.matches, 25);
  assert.equal(drift.drifts, 16);
  assert.equal(drift.errors, 0);
  assert.equal(drift.records.length, drift.total);
  assert.equal(
    drift.records.filter((record) => record.status === "MATCH").length,
    drift.matches,
  );
  assert.equal(
    Object.entries(verification.externalGates)
      .filter(([name]) => name !== "opa")
      .every(([, status]) => status === "NOT_RUN"),
    true,
  );
  const allContent = [...files.values()].join("\n");
  assert.equal(allContent.includes("F:\\oaibuild"), false);
  assert.equal(allContent.includes("C:\\Users"), false);
});

test("missing, tampered, and unsupported-pass evidence is rejected", async () => {
  const original = await loadEvidence();
  const missing = new Map(original);
  missing.delete("opa-results.json");
  assert.throws(() => validateEvidencePackage(missing, hashText), /Missing evidence file/u);

  const tampered = new Map(original);
  tampered.set("policy-ir.json", `${tampered.get("policy-ir.json")} `);
  assert.throws(() => validateEvidencePackage(tampered, hashText), /hash mismatch/u);

  const unsupported = new Map(original);
  const verification = JSON.parse(unsupported.get("verification-summary.json"));
  verification.status = "PASS";
  verification.evidenceMode = "LIVE_VERIFIED";
  verification.driftAfter = 0;
  verification.security = { critical: 0, high: 0, status: "PASS" };
  verification.externalGates = Object.fromEntries(
    Object.keys(verification.externalGates).map((key) => [key, "PASS"]),
  );
  unsupported.set("verification-summary.json", json(verification));
  unsupported.set(
    "summary.md",
    unsupported
      .get("summary.md")
      .replace("Status: FAIL", "Status: PASS")
      .replace("Evidence mode: PARTIAL_OFFLINE", "Evidence mode: LIVE_VERIFIED"),
  );
  resignEvidence(unsupported);
  assert.throws(
    () => validateEvidencePackage(unsupported, hashText),
    /attestation|Run metadata|Post-repair drift report|claims PASS without complete external evidence/iu,
  );

  const incompleteDrift = new Map(original);
  const drift = JSON.parse(incompleteDrift.get("drift-report-before.json"));
  drift.records = drift.records.filter((record) => record.status !== "MATCH");
  incompleteDrift.set("drift-report-before.json", json(drift));
  resignEvidence(incompleteDrift);
  assert.throws(
    () => validateEvidencePackage(incompleteDrift, hashText),
    /drift report counts are incomplete or inconsistent/u,
  );

  const falseMetric = new Map(original);
  const falseVerification = JSON.parse(falseMetric.get("verification-summary.json"));
  falseVerification.golden.passed = 0;
  falseMetric.set("verification-summary.json", json(falseVerification));
  resignEvidence(falseMetric);
  assert.throws(
    () => validateEvidencePackage(falseMetric, hashText),
    /Verification golden metric is inconsistent with OPA evidence|OPA PASS evidence is incomplete or inconsistent/u,
  );
});

test("every evidence payload contributes to the aggregate evidence hash", async () => {
  const original = await loadEvidence();
  const originalHash = JSON.parse(original.get("evidence-manifest.json")).evidenceHash;
  const changedSummary = new Map(original);
  changedSummary.set("summary.md", `${changedSummary.get("summary.md")}\nReview note: local only.\n`);
  const changedHash = resignEvidence(changedSummary);
  assert.notEqual(changedHash, originalHash);
  assert.equal(validateEvidencePackage(changedSummary, hashText).evidenceHash, changedHash);
});

test("re-signed semantic OPA, mutation, traceability, and differential forgeries are rejected", async () => {
  const fakeOpa = await loadEvidence();
  const opa = JSON.parse(fakeOpa.get("opa-results.json"));
  opa.opaVersion = "0.0.0";
  opa.executableSha256 = "0".repeat(64);
  fakeOpa.set("opa-results.json", json(opa));
  resignEvidence(fakeOpa);
  assert.throws(
    () => validateEvidencePackage(fakeOpa, hashText),
    /trusted engine and compiler contract/u,
  );

  const fakeMutation = await loadEvidence();
  const mutation = JSON.parse(fakeMutation.get("mutation-report.json"));
  mutation.killed = 2;
  mutation.total = 1;
  mutation.killRate = 2;
  fakeMutation.set("mutation-report.json", json(mutation));
  const mutationVerification = JSON.parse(fakeMutation.get("verification-summary.json"));
  mutationVerification.mutation = {
    killed: mutation.killed,
    total: mutation.total,
    excludedEquivalent: mutation.excludedEquivalent,
    killRate: mutation.killRate,
    executionMode: mutation.executionMode,
  };
  fakeMutation.set("verification-summary.json", json(mutationVerification));
  resignEvidence(fakeMutation);
  assert.throws(
    () => validateEvidencePackage(fakeMutation, hashText),
    /mutation metrics are invalid|Mutation result details/u,
  );

  const fakeMutantCorpus = await loadEvidence();
  const fakeMutants = JSON.parse(fakeMutantCorpus.get("mutation-report.json"));
  fakeMutants.results[0].mutantId = "M999-FABRICATED";
  fakeMutantCorpus.set("mutation-report.json", json(fakeMutants));
  resignEvidence(fakeMutantCorpus);
  assert.throws(
    () => validateEvidencePackage(fakeMutantCorpus, hashText),
    /deterministic mutant corpus/u,
  );

  const linklessCase = await loadEvidence();
  const linklessGolden = JSON.parse(linklessCase.get("golden-cases.json"));
  linklessGolden[0].relatedClauseIds = [];
  linklessCase.set("golden-cases.json", json(linklessGolden));
  resignEvidence(linklessCase);
  assert.throws(
    () => validateEvidencePackage(linklessCase, hashText),
    /unknown policy rule or clause/u,
  );

  const fakeTraceability = await loadEvidence();
  const traceability = JSON.parse(fakeTraceability.get("traceability.json"));
  traceability.clauses = [];
  traceability.rules = [];
  traceability.cases = [];
  traceability.codeLocations = [];
  traceability.metrics = {
    clausesCovered: 0,
    clausesTotal: 0,
    rulesCovered: 0,
    rulesTotal: 0,
    casesLinked: 0,
    casesTotal: 0,
    unlinkedCodeLocations: 0,
  };
  traceability.gaps = {
    uncoveredClauseIds: [],
    uncoveredRuleIds: [],
    invalidCaseLinks: [],
    unlinkedCodeLocationIds: [],
  };
  fakeTraceability.set("traceability.json", json(traceability));
  const traceVerification = JSON.parse(fakeTraceability.get("verification-summary.json"));
  traceVerification.traceability = {
    clausesCovered: 0,
    clausesTotal: 0,
    rulesCovered: 0,
    rulesTotal: 0,
    unlinkedCodeLocations: 0,
  };
  fakeTraceability.set("verification-summary.json", json(traceVerification));
  resignEvidence(fakeTraceability);
  assert.throws(
    () => validateEvidencePackage(fakeTraceability, hashText),
    /Traceability report is not derivable|bundled trusted fixture mapping/u,
  );

  const conflictingDifferential = await loadEvidence();
  const appBefore = JSON.parse(conflictingDifferential.get("app-results-before.json"));
  appBefore.adapterId = "forged-adapter";
  conflictingDifferential.set("app-results-before.json", json(appBefore));
  resignEvidence(conflictingDifferential);
  assert.throws(
    () => validateEvidencePackage(conflictingDifferential, hashText),
    /Pre-repair differential artifacts disagree/u,
  );

  const forgedCompiler = await loadEvidence();
  forgedCompiler.set("compiled-policy.rego", `${forgedCompiler.get("compiled-policy.rego")}\n# forged\n`);
  resignEvidence(forgedCompiler);
  assert.throws(
    () => validateEvidencePackage(forgedCompiler, hashText),
    /not the deterministic output of PolicyIR/u,
  );

  const relabeledMutation = await loadEvidence();
  const relabeledReport = JSON.parse(relabeledMutation.get("mutation-report.json"));
  relabeledReport.executionMode = "OPA_CLI";
  relabeledMutation.set("mutation-report.json", json(relabeledReport));
  const relabeledVerification = JSON.parse(relabeledMutation.get("verification-summary.json"));
  relabeledVerification.mutation.executionMode = "OPA_CLI";
  relabeledMutation.set("verification-summary.json", json(relabeledVerification));
  const relabeledRun = JSON.parse(relabeledMutation.get("mutation-run-summary.json"));
  relabeledRun.reportSha256 = hashText(relabeledMutation.get("mutation-report.json"));
  relabeledMutation.set("mutation-run-summary.json", json(relabeledRun));
  resignEvidence(relabeledMutation);
  assert.throws(
    () => validateEvidencePackage(relabeledMutation, hashText),
    /Partial offline evidence must not impersonate live external work/u,
  );

  const fakeCodeMapping = await loadEvidence();
  const fakeTrace = JSON.parse(fakeCodeMapping.get("traceability.json"));
  fakeTrace.codeLocations[0].file = "src/does-not-exist.ts";
  fakeCodeMapping.set("traceability.json", json(fakeTrace));
  resignEvidence(fakeCodeMapping);
  assert.throws(
    () => validateEvidencePackage(fakeCodeMapping, hashText),
    /bundled trusted fixture mapping/u,
  );

  const falsePartialCodex = await loadEvidence();
  const falseCodex = JSON.parse(falsePartialCodex.get("codex-run-summary.json"));
  falseCodex.executionMode = "LIVE_CODEX_SDK";
  falseCodex.liveCodexClaim = true;
  falsePartialCodex.set("codex-run-summary.json", json(falseCodex));
  resignEvidence(falsePartialCodex);
  assert.throws(
    () => validateEvidencePackage(falsePartialCodex, hashText),
    /explicit test double/u,
  );
});

test("self-resigned fabricated live evidence is rejected", async () => {
  const forged = await loadEvidence();
  const verification = JSON.parse(forged.get("verification-summary.json"));
  verification.status = "PASS";
  verification.evidenceMode = "LIVE_VERIFIED";
  verification.driftAfter = 0;
  verification.mutation = {
    killed: 2,
    total: 1,
    excludedEquivalent: 0,
    killRate: 2,
    executionMode: "FAKE",
  };
  verification.regression = { passed: 1, total: 1, status: "PASS" };
  verification.traceability = {
    clausesCovered: 0,
    clausesTotal: 0,
    rulesCovered: 0,
    rulesTotal: 0,
    unlinkedCodeLocations: 0,
  };
  verification.security = { critical: 0, high: 0, status: "PASS" };
  verification.externalGates = Object.fromEntries(
    Object.keys(verification.externalGates).map((gate) => [gate, "PASS"]),
  );
  forged.set("verification-summary.json", json(verification));
  const runMetadata = JSON.parse(forged.get("run-metadata.json"));
  runMetadata.evidenceMode = "LIVE_VERIFIED";
  runMetadata.freshExternalWork = true;
  runMetadata.recordedInterpreter = false;
  runMetadata.runId = "forged-live-run-0001";
  forged.set("run-metadata.json", json(runMetadata));
  for (const name of ["codex-run-summary.json", "codex-cartography.json", "codex-review.json"]) {
    forged.set(
      name,
      json({ status: "PASS", executionMode: "LIVE_CODEX_SDK", liveCodexClaim: true }),
    );
  }
  const emptyDrift = { total: 0, matches: 0, drifts: 0, errors: 0, records: [] };
  forged.set("drift-report-after.json", json(emptyDrift));
  forged.set("app-results-after.json", json(emptyDrift));
  forged.set("test-command-log.json", json({ status: "PASS" }));
  forged.set("eval-scorecard.json", json({ status: "PASS", evidenceMode: "LIVE_VERIFIED" }));
  forged.set("integration.diff", "fabricated non-empty diff\n");
  forged.set("security-review.md", "# Security review\n\nPASS\n");
  forged.set("mutation-report.json", json(verification.mutation));
  forged.set(
    "traceability.json",
    json({
      metrics: {
        ...verification.traceability,
        casesLinked: verification.golden.total + verification.generated.total,
        casesTotal: verification.golden.total + verification.generated.total,
      },
    }),
  );
  forged.set(
    "opa-results.json",
    json({
      status: "PASS",
      executionMode: "OPA_CLI",
      opaVersion: "0.0.0",
      executableSha256: "0".repeat(64),
      acceptedCaseAgreement: {
        passed: verification.golden.total + verification.generated.total,
        total: verification.golden.total + verification.generated.total,
      },
      results: Array.from(
        { length: verification.golden.total + verification.generated.total },
        () => ({ fabricated: true }),
      ),
    }),
  );
  forged.set(
    "summary.md",
    forged
      .get("summary.md")
      .replace("Status: FAIL", "Status: PASS")
      .replace("Evidence mode: PARTIAL_OFFLINE", "Evidence mode: LIVE_VERIFIED"),
  );
  resignEvidence(forged);

  assert.throws(
    () => validateEvidencePackage(forged, hashText),
    /attestation|mutation|OPA|post-repair|traceability|command evidence/iu,
  );
});

test("LIVE_VERIFIED evidence requires a valid trusted Ed25519 attestation", async () => {
  const files = await loadEvidence();
  const verification = JSON.parse(files.get("verification-summary.json"));
  verification.evidenceMode = "LIVE_VERIFIED";
  files.set("verification-summary.json", json(verification));
  const runMetadata = JSON.parse(files.get("run-metadata.json"));
  runMetadata.evidenceMode = "LIVE_VERIFIED";
  runMetadata.runId = "live-attestation-test-0001";
  runMetadata.recordedInterpreter = false;
  runMetadata.freshExternalWork = true;
  files.set("run-metadata.json", json(runMetadata));
  files.set(
    "summary.md",
    files.get("summary.md").replace("Evidence mode: PARTIAL_OFFLINE", "Evidence mode: LIVE_VERIFIED"),
  );
  const evidenceHash = resignEvidence(files);
  const manifest = JSON.parse(files.get("evidence-manifest.json"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  manifest.liveAttestation = {
    schemaVersion: "1",
    algorithm: "Ed25519",
    keyId: "integration-test-key",
    runId: runMetadata.runId,
    issuedAt: verification.createdAt,
    evidenceHash,
    signature: sign(
      null,
      Buffer.from(
        liveEvidenceAttestationMessage(evidenceHash, runMetadata.runId, verification.createdAt),
        "utf8",
      ),
      privateKey,
    ).toString("base64url"),
  };
  files.set("evidence-manifest.json", json(manifest));
  const options = {
    now: new Date("2026-07-15T00:00:00.000Z"),
    trustedLiveAttestationKeys: {
      "integration-test-key": publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
  };
  const accepted = validateEvidencePackage(files, hashText, options);
  assert.equal(accepted.evidenceMode, "LIVE_VERIFIED");
  assert.equal(accepted.packageStatus, "FAIL");

  assert.throws(
    () => validateEvidencePackage(files, hashText, { ...options, now: new Date("2030-07-14T00:00:00.000Z") }),
    /stale and must be refreshed/u,
  );

  assert.throws(
    () => validateEvidencePackage(files, hashText),
    /not trusted/u,
  );
  const invalidSignature = new Map(files);
  const invalidManifest = JSON.parse(invalidSignature.get("evidence-manifest.json"));
  invalidManifest.liveAttestation.signature = `${invalidManifest.liveAttestation.signature[0] === "A" ? "B" : "A"}${invalidManifest.liveAttestation.signature.slice(1)}`;
  invalidSignature.set("evidence-manifest.json", json(invalidManifest));
  assert.throws(
    () => validateEvidencePackage(invalidSignature, hashText, options),
    /signature is invalid/u,
  );
});
