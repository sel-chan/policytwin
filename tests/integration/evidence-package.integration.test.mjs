import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeEvidencePackageHash,
  createCanonicalFixtureDiff,
  createEvidenceArchive,
  DEFAULT_EVIDENCE_MAX_ATTESTATION_AGE_MS,
  liveEvidenceAttestationMessage,
  MAX_EVIDENCE_DOWNLOAD_FILE_BYTES,
  REQUIRED_EVIDENCE_FILES,
  readEvidenceFilesBounded,
  validateEvidenceDownloadPackage,
  validateEvidencePackage,
  validateCanonicalIntegrationDiff,
  validateFixtureTreeReceipt,
} from "../../dist/index.js";
import {
  deriveSeededAmbiguityFacts,
  validateLiveScorecard,
} from "../../dist/evidence/validate.js";
import { generatePolicyMutants } from "../../dist/mutation/mutate.js";
import { canonicalizeKnownRefundAmbiguities } from "../../dist/policy-ir/canonicalize-ambiguities.js";

await import("../../scripts/generate-offline-evidence.mjs");
const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../artifacts/evidence/", import.meta.url));
const SEEDED_SOURCE_TEXT = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fixtureTreeReceipt(entries, runId) {
  const treeHash = createHash("sha256");
  const files = entries.map((entry) => {
    treeHash.update(entry.kind === "directory" ? "directory\0" : "file\0", "utf8");
    treeHash.update(entry.path, "utf8");
    treeHash.update("\0", "utf8");
    treeHash.update(String(entry.mode), "utf8");
    treeHash.update("\0", "utf8");
    treeHash.update(String(entry.mtimeMs), "utf8");
    treeHash.update("\0", "utf8");
    if (entry.kind === "directory") return entry;
    const content = Buffer.from(entry.content, "utf8");
    treeHash.update(content);
    treeHash.update("\0", "utf8");
    return {
      path: entry.path,
      kind: "file",
      mode: entry.mode,
      mtimeMs: entry.mtimeMs,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      contentBase64: content.toString("base64"),
    };
  });
  return json({
    schemaVersion: "1",
    status: "PASS",
    runId,
    fixtureId: "seeded-refund-demo",
    treeSha256: treeHash.digest("hex"),
    files,
  });
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
  const names = await readdir(EVIDENCE_DIRECTORY);
  return new Map(
    await Promise.all(
      names.map(async (name) => [name, await readFile(join(EVIDENCE_DIRECTORY, name), "utf8")]),
    ),
  );
}

async function withEvidenceCopy(callback) {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-evidence-read-"));
  try {
    await cp(EVIDENCE_DIRECTORY, directory, { recursive: true });
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function tarString(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("ascii");
}

function tarOctal(header, offset, length) {
  const value = tarString(header, offset, length).trim();
  assert.match(value, /^[0-7]+$/u);
  return Number.parseInt(value, 8);
}

function parseTar(archive) {
  const bytes = Buffer.from(archive);
  const files = new Map();
  const headers = [];
  let offset = 0;
  while (offset + 1024 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      assert.equal(bytes.subarray(offset).every((byte) => byte === 0), true);
      assert.equal(bytes.length - offset >= 1024, true);
      return { files, headers };
    }
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    assert.equal(
      checksumHeader.reduce((sum, byte) => sum + byte, 0),
      tarOctal(header, 148, 8),
    );
    assert.equal(tarString(header, 257, 6), "ustar");
    assert.equal(tarString(header, 263, 2), "00");
    assert.equal(tarString(header, 156, 1), "0");
    assert.equal(tarOctal(header, 100, 8), 0o644);
    assert.equal(tarOctal(header, 108, 8), 0);
    assert.equal(tarOctal(header, 116, 8), 0);
    assert.equal(tarOctal(header, 136, 12), 0);
    const name = tarString(header, 0, 100);
    const size = tarOctal(header, 124, 12);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    assert.equal(dataEnd <= bytes.length, true);
    assert.equal(files.has(name), false);
    files.set(name, Buffer.from(bytes.subarray(dataStart, dataEnd)));
    headers.push(Buffer.from(header));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  assert.fail("USTAR archive lacks its two zero termination blocks.");
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
  const scorecard = JSON.parse(files.get("eval-scorecard.json"));
  assert.deepEqual(Object.keys(scorecard.metrics), [
    "structuredOutputSchemaPass",
    "requiredAmbiguityLabelsFound",
    "explicitSeededSemanticsMislabeledAsAmbiguity",
    "goldenCaseAgreement",
    "boundaryCaseAgreement",
    "seededDriftBugsDetected",
    "acceptedCorpusSize",
    "postRepairDrift",
    "evaluationOnlyFixedFixtureDrift",
    "opaCaseAgreement",
    "mutationKillRate",
    "ruleClauseTraceability",
    "ruleCaseTraceability",
    "securityFindings",
    "browserHappyPath",
  ]);
  assert.deepEqual(scorecard.metrics.requiredAmbiguityLabelsFound, {
    value: 3,
    target: 3,
    status: "PASS_RECORDED_FIXTURE",
  });
  assert.deepEqual(scorecard.metrics.explicitSeededSemanticsMislabeledAsAmbiguity, {
    value: 0,
    target: 0,
    status: "PASS_RECORDED_FIXTURE",
  });
  assert.deepEqual(scorecard.metrics.goldenCaseAgreement, {
    value: 6,
    target: 6,
    status: "PASS_OPA",
  });
  assert.deepEqual(scorecard.metrics.boundaryCaseAgreement, {
    value: 11,
    target: 11,
    status: "PASS_OPA",
  });
  assert.deepEqual(scorecard.metrics.ruleCaseTraceability, {
    value: 1,
    target: 1,
    status: "PASS_OFFLINE",
  });
  const allContent = [...files.values()].join("\n");
  assert.equal(allContent.includes("F:\\oaibuild"), false);
  assert.equal(allContent.includes("C:\\Users"), false);
});

test("partial eval scorecard metrics are recomputed instead of trusting a self-resigned claim", async () => {
  const files = await loadEvidence();
  const scorecard = JSON.parse(files.get("eval-scorecard.json"));
  scorecard.metrics.seededDriftBugsDetected.value = 2;
  files.set("eval-scorecard.json", json(scorecard));
  resignEvidence(files);

  assert.throws(
    () => validateEvidencePackage(files, hashText),
    /Eval scorecard metric seededDriftBugsDetected/u,
  );
});

test("explicit seeded semantics cannot impersonate a required ambiguity", async () => {
  const files = await loadEvidence();
  const policy = JSON.parse(files.get("policy-ir.json"));
  const ambiguity = policy.ambiguities.find(
    ({ id }) => id === "ambiguity-purchase-day-index",
  );
  ambiguity.question = "Is exactly day 14 eligible for a refund?";
  ambiguity.rationale = "The source clause explicitly states that day 14 is included.";
  files.set("policy-ir.json", json(policy));

  const cases = [
    ...JSON.parse(files.get("golden-cases.json")),
    ...JSON.parse(files.get("generated-cases.json")),
  ];
  const mutationSummary = JSON.parse(files.get("mutation-run-summary.json"));
  mutationSummary.mutantPolicyHashes = generatePolicyMutants(policy, cases).map(
    (mutant) => ({
      mutantId: mutant.id,
      policySha256: hashText(JSON.stringify(mutant.policy)),
    }),
  );
  files.set("mutation-run-summary.json", json(mutationSummary));
  resignEvidence(files);

  assert.throws(
    () => validateEvidencePackage(files, hashText),
    /Eval scorecard metric requiredAmbiguityLabelsFound/u,
  );
});

test("live seeded ambiguity presentation is canonical before scorecard admission", async () => {
  const files = await loadEvidence();
  const policy = JSON.parse(files.get("policy-ir.json"));
  policy.metadata.source = "LIVE_RESPONSE";
  for (const [index, ambiguity] of policy.ambiguities.entries()) {
    ambiguity.id = `live-ambiguity-${index}`;
    ambiguity.question = `Equivalent live question ${index}`;
    ambiguity.rationale = `Equivalent live rationale ${index}`;
    for (const [optionIndex, option] of ambiguity.options.entries()) {
      const selected = option.id === ambiguity.selectedOptionId;
      option.id = `live-option-${index}-${optionIndex}`;
      option.label = `Equivalent option ${optionIndex}`;
      option.description = `Equivalent description ${optionIndex}`;
      if (selected) {
        ambiguity.selectedOptionId = option.id;
      }
    }
  }

  const canonicalPolicy = canonicalizeKnownRefundAmbiguities(policy, {
    policyId: policy.policyId,
    version: policy.version,
    sourceText: SEEDED_SOURCE_TEXT,
  });
  assert.deepEqual(deriveSeededAmbiguityFacts(canonicalPolicy, hashText), {
    requiredAmbiguityLabelsFound: 3,
    explicitSeededSemanticsMislabeledAsAmbiguity: 0,
  });

  const presentationTamper = structuredClone(canonicalPolicy);
  presentationTamper.ambiguities[0].question = "Is exactly day 14 eligible for a refund?";
  assert.deepEqual(deriveSeededAmbiguityFacts(presentationTamper, hashText), {
    requiredAmbiguityLabelsFound: 2,
    explicitSeededSemanticsMislabeledAsAmbiguity: 1,
  });

  const patchTamper = structuredClone(canonicalPolicy);
  patchTamper.ambiguities[0].options[1].policyPatch.value = 0;
  assert.deepEqual(deriveSeededAmbiguityFacts(patchTamper, hashText), {
    requiredAmbiguityLabelsFound: 2,
    explicitSeededSemanticsMislabeledAsAmbiguity: 1,
  });
});

test("live eval scorecard requires exact derived statuses", () => {
  const runId = "live-scorecard-test-0001";
  const facts = {
    requiredAmbiguityLabelsFound: 3,
    explicitSeededSemanticsMislabeledAsAmbiguity: 0,
    goldenCaseAgreement: 6,
    boundaryCaseAgreement: 11,
    seededDriftBugsDetected: 3,
    acceptedCorpusSize: 41,
    evaluationOnlyFixedFixtureDrift: 0,
    opaCaseAgreement: 41,
    mutationKillRate: 0.95,
    ruleClauseTraceability: 1,
    ruleCaseTraceability: 1,
  };
  const metrics = {
    structuredOutputSchemaPass: { value: 1, target: 1, status: "PASS_LIVE_STRUCTURED_OUTPUT" },
    requiredAmbiguityLabelsFound: { value: 3, target: 3, status: "PASS_LIVE_INTERPRETATION" },
    explicitSeededSemanticsMislabeledAsAmbiguity: { value: 0, target: 0, status: "PASS_LIVE_INTERPRETATION" },
    goldenCaseAgreement: { value: 6, target: 6, status: "PASS_OPA" },
    boundaryCaseAgreement: { value: 11, target: 11, status: "PASS_OPA" },
    seededDriftBugsDetected: { value: 3, target: 3, status: "PASS_PRE_REPAIR_DIFFERENTIAL" },
    acceptedCorpusSize: { value: 41, target: 30, status: "PASS_ACCEPTED_CORPUS" },
    postRepairDrift: { value: 0, target: 0, status: "PASS_POST_REPAIR_DIFFERENTIAL" },
    opaCaseAgreement: { value: 41, target: 41, status: "PASS_OPA" },
    mutationKillRate: { value: 0.95, target: 0.9, status: "PASS_OPA_MUTATION" },
    ruleClauseTraceability: { value: 1, target: 1, status: "PASS_TRACEABILITY" },
    ruleCaseTraceability: { value: 1, target: 1, status: "PASS_TRACEABILITY" },
    securityFindings: { value: 0, target: 0, status: "PASS_RELEASE_SECURITY" },
    browserHappyPath: { value: 1, target: 1, status: "PASS_PLAYWRIGHT" },
  };
  const scorecard = {
    schemaVersion: "1",
    status: "PASS",
    evidenceMode: "LIVE_VERIFIED",
    runId,
    metrics,
  };

  assert.doesNotThrow(() => validateLiveScorecard(scorecard, runId, facts));
  for (const name of Object.keys(metrics)) {
    const forged = structuredClone(scorecard);
    forged.metrics[name].status = "PASS_FABRICATED";
    assert.throws(
      () => validateLiveScorecard(forged, runId, facts),
      new RegExp(`Eval scorecard metric ${name}`, "u"),
    );
  }
  assert.throws(
    () => validateLiveScorecard(scorecard, runId, { ...facts, acceptedCorpusSize: 29, opaCaseAgreement: 29 }),
    /cannot pass when a derived metric misses its target/u,
  );
});

test("complete evidence archive is byte-deterministic USTAR with exactly 38 verified files", async () => {
  const files = await loadEvidence();
  const reversed = new Map([...files.entries()].reverse());
  const first = createEvidenceArchive(files, hashText);
  const second = createEvidenceArchive(reversed, hashText);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.archiveSha256, second.archiveSha256);
  assert.equal(first.evidenceHash, "70c8b1ba26073e2b0272ff365170fa4fa18e407a70e2692a7fc3885b739d5d72");
  assert.equal(first.evidenceMode, "PARTIAL_OFFLINE");
  assert.equal(first.packageStatus, "FAIL");
  assert.equal(first.policyVersion, 4);
  assert.equal(first.liveAttestationExpiresAtMs, null);
  assert.match(
    first.fileName,
    /^policytwin-evidence-v4-partial-offline-fail-[0-9a-f]{12}\.tar$/u,
  );
  assert.equal(first.bytes.length % 512, 0);

  const parsed = parseTar(first.bytes);
  const expectedNames = [...REQUIRED_EVIDENCE_FILES].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  assert.deepEqual([...parsed.files.keys()], expectedNames);
  assert.deepEqual(first.entryNames, expectedNames);
  assert.equal(parsed.files.size, 38);
  assert.equal(parsed.headers.length, 38);
  for (const name of expectedNames) {
    assert.deepEqual(parsed.files.get(name), Buffer.from(files.get(name), "utf8"));
  }
  const extracted = new Map(
    [...parsed.files].map(([name, content]) => [name, content.toString("utf8")]),
  );
  assert.equal(validateEvidencePackage(extracted, hashText).evidenceHash, first.evidenceHash);
});

test("live fixture receipts bind directory structure, modes, mtimes, and file content", () => {
  const runId = "live-tree-contract";
  const entries = [
    { path: "src", kind: "directory", mode: 16_877, mtimeMs: 1_000 },
    {
      path: "src/refund.ts",
      kind: "file",
      mode: 33_188,
      mtimeMs: 2_000,
      content: "export const decision = 'ALLOW';\n",
    },
  ];
  const receipt = fixtureTreeReceipt(entries, runId);
  const files = new Map([["fixture-tree-before.json", receipt]]);
  const validated = validateFixtureTreeReceipt(files, "fixture-tree-before.json", runId);
  assert.equal(validated.entries.size, 2);
  assert.equal(validated.files.size, 1);

  const tampered = JSON.parse(receipt);
  tampered.files[1].mtimeMs += 1;
  assert.throws(
    () =>
      validateFixtureTreeReceipt(
        new Map([["fixture-tree-before.json", json(tampered)]]),
        "fixture-tree-before.json",
        runId,
      ),
    /tree hash does not match/u,
  );

  for (const content of ["\uFEFFexport {};\n", "export const value = '\0';\n"]) {
    const nonCanonical = fixtureTreeReceipt(
      [
        { path: "src", kind: "directory", mode: 16_877, mtimeMs: 1_000 },
        {
          path: "src/refund.ts",
          kind: "file",
          mode: 33_188,
          mtimeMs: 2_000,
          content,
        },
      ],
      runId,
    );
    assert.throws(
      () =>
        validateFixtureTreeReceipt(
          new Map([["fixture-tree-before.json", nonCanonical]]),
          "fixture-tree-before.json",
          runId,
        ),
      /canonical NUL-free UTF-8/u,
    );
  }
});

test("integration diff is the canonical byte-for-byte change between attested trees", () => {
  const runId = "live-diff-contract";
  const beforeFiles = new Map([
    [
      "fixture-tree-before.json",
      fixtureTreeReceipt(
        [
          { path: "src", kind: "directory", mode: 16_877, mtimeMs: 1_000 },
          {
            path: "src/refund.ts",
            kind: "file",
            mode: 33_188,
            mtimeMs: 2_000,
            content: "export const decision = 'DENY';\n",
          },
        ],
        runId,
      ),
    ],
  ]);
  const afterFiles = new Map([
    [
      "fixture-tree-after.json",
      fixtureTreeReceipt(
        [
          { path: "src", kind: "directory", mode: 16_877, mtimeMs: 1_000 },
          {
            path: "src/refund.ts",
            kind: "file",
            mode: 33_188,
            mtimeMs: 3_000,
            content: "export const decision = 'ALLOW';\n",
          },
        ],
        runId,
      ),
    ],
  ]);
  const beforeTree = validateFixtureTreeReceipt(
    beforeFiles,
    "fixture-tree-before.json",
    runId,
  );
  const afterTree = validateFixtureTreeReceipt(
    afterFiles,
    "fixture-tree-after.json",
    runId,
  );
  const diff = createCanonicalFixtureDiff([
    {
      path: "src/refund.ts",
      before: beforeTree.contents.get("src/refund.ts"),
      after: afterTree.contents.get("src/refund.ts"),
    },
  ]);
  assert.equal(
    diff,
    [
      "diff --git a/src/refund.ts b/src/refund.ts",
      "--- a/src/refund.ts",
      "+++ b/src/refund.ts",
      "@@ -1,1 +1,1 @@",
      "-export const decision = 'DENY';",
      "+export const decision = 'ALLOW';",
      "",
    ].join("\n"),
  );
  assert.doesNotThrow(() =>
    validateCanonicalIntegrationDiff(diff, beforeTree, afterTree, ["src/refund.ts"]),
  );
  const fabricated = [
    "diff --git a/src/refund.ts b/src/refund.ts",
    "--- a/src/refund.ts",
    "+++ b/src/refund.ts",
    "@@ -1,1 +1,1 @@",
    "-fabricated before",
    "+fabricated after",
    "",
  ].join("\n");
  assert.throws(
    () =>
      validateCanonicalIntegrationDiff(fabricated, beforeTree, afterTree, [
        "src/refund.ts",
      ]),
    /does not exactly reconstruct/u,
  );
  assert.equal(
    createCanonicalFixtureDiff([
      { path: "src/empty.ts", before: "", after: "export {};" },
    ]),
    [
      "diff --git a/src/empty.ts b/src/empty.ts",
      "--- a/src/empty.ts",
      "+++ b/src/empty.ts",
      "@@ -0,0 +1,1 @@",
      "+export {};",
      "\\ No newline at end of file",
      "",
    ].join("\n"),
  );
  assert.equal(
    createCanonicalFixtureDiff([
      { path: "src/no-final-newline.ts", before: "DENY", after: "ALLOW" },
    ]),
    [
      "diff --git a/src/no-final-newline.ts b/src/no-final-newline.ts",
      "--- a/src/no-final-newline.ts",
      "+++ b/src/no-final-newline.ts",
      "@@ -1,1 +1,1 @@",
      "-DENY",
      "\\ No newline at end of file",
      "+ALLOW",
      "\\ No newline at end of file",
      "",
    ].join("\n"),
  );
  assert.match(
    createCanonicalFixtureDiff([
      { path: "src/crlf.ts", before: "DENY\r\n", after: "ALLOW\r\n" },
    ]),
    /@@ -1,1 \+1,1 @@\n-DENY\r\n\+ALLOW\r\n$/u,
  );
});

test("bounded evidence reader rejects oversized, aggregate, non-regular, and invalid UTF-8 files", async (t) => {
  const original = await loadEvidence();
  const loaded = await readEvidenceFilesBounded(EVIDENCE_DIRECTORY);
  assert.deepEqual(loaded, original);

  await withEvidenceCopy(async (directory) => {
    await writeFile(
      join(directory, "summary.md"),
      Buffer.alloc(MAX_EVIDENCE_DOWNLOAD_FILE_BYTES + 1, 0x78),
    );
    await assert.rejects(
      readEvidenceFilesBounded(directory),
      /bounded regular-file contract/u,
    );
  });

  await withEvidenceCopy(async (directory) => {
    for (const name of [
      "summary.md",
      "security-review.md",
      "integration.diff",
      "compiled-policy.rego",
    ]) {
      await writeFile(
        join(directory, name),
        Buffer.alloc(MAX_EVIDENCE_DOWNLOAD_FILE_BYTES, 0x78),
      );
    }
    await writeFile(join(directory, "test-command-log.json"), Buffer.alloc(1024, 0x78));
    await assert.rejects(
      readEvidenceFilesBounded(directory),
      /bounded regular-file contract/u,
    );
  });

  await withEvidenceCopy(async (directory) => {
    await writeFile(join(directory, "summary.md"), Buffer.from([0xc3, 0x28]));
    await assert.rejects(readEvidenceFilesBounded(directory), TypeError);
  });

  await withEvidenceCopy(async (directory) => {
    const target = join(directory, "summary.md");
    await rm(target, { force: true });
    try {
      await symlink(directory, target, "junction");
    } catch (error) {
      if (error?.code !== "EPERM") {
        throw error;
      }
      t.diagnostic("Symlink creation is unavailable; non-regular fallback exercised.");
      await mkdir(target);
    }
    await assert.rejects(
      readEvidenceFilesBounded(directory),
      /bounded regular-file contract/u,
    );
  });
});

test("archive changes with evidence and rejects extra, missing, or sensitive content", async () => {
  const original = await loadEvidence();
  const originalArchive = createEvidenceArchive(original, hashText);

  const changed = new Map(original);
  changed.set("summary.md", `${changed.get("summary.md")}\nReview note: archive variation.\n`);
  resignEvidence(changed);
  const changedArchive = createEvidenceArchive(changed, hashText);
  assert.notEqual(changedArchive.archiveSha256, originalArchive.archiveSha256);
  assert.notDeepEqual(changedArchive.bytes, originalArchive.bytes);

  const missing = new Map(original);
  missing.delete("summary.md");
  assert.throws(() => createEvidenceArchive(missing, hashText), /exactly the required files/u);

  const extra = new Map(original);
  extra.set("transient.log", "must never enter the archive\n");
  assert.throws(() => createEvidenceArchive(extra, hashText), /not hashed|exactly the required/u);

  const sensitive = new Map(original);
  const secretName = "API" + "_KEY";
  const secretValue = "must" + "-not-pass";
  sensitive.set(
    "summary.md",
    `${sensitive.get("summary.md")}\n${secretName}=${secretValue}\n`,
  );
  resignEvidence(sensitive);
  assert.throws(
    () => validateEvidenceDownloadPackage(sensitive, hashText),
    /credential-shaped assignment/u,
  );
  assert.throws(
    () => createEvidenceArchive(sensitive, hashText),
    (error) => {
      assert.match(error.message, /credential-shaped assignment/u);
      assert.equal(error.message.includes(secretValue), false);
      return true;
    },
  );

  const bearer = new Map(original);
  const bearerValue = ["Bearer", "abc123"].join(" ");
  bearer.set("summary.md", `${bearer.get("summary.md")}\nAuthorization: ${bearerValue}\n`);
  resignEvidence(bearer);
  assert.throws(() => createEvidenceArchive(bearer, hashText), /credential-shaped content/u);

  const genericSecret = ["generic", "secret", "value"].join("-");
  for (const [key, whitespace] of [
    ["apiKey", " "],
    ["clientSecret", "\n  "],
    ["GITHUB_TOKEN", " "],
    ["AWS_SECRET_ACCESS_KEY", " "],
    ["MONGODB_URI", " "],
  ]) {
    const variant = new Map(original);
    variant.set(
      "summary.md",
      `${variant.get("summary.md")}\n"${key}":${whitespace}"${genericSecret}"\n`,
    );
    resignEvidence(variant);
    assert.throws(
      () => validateEvidenceDownloadPackage(variant, hashText),
      /credential-shaped assignment/u,
    );
  }

  const databaseCredentialUrl = [
    "postgres",
    "://reviewer:",
    genericSecret,
    "@db/policy",
  ].join("");
  for (const content of [
    `"databaseUrl": "${databaseCredentialUrl}"`,
    `Connection: ${databaseCredentialUrl}`,
  ]) {
    const variant = new Map(original);
    variant.set("summary.md", `${variant.get("summary.md")}\n${content}\n`);
    resignEvidence(variant);
    assert.throws(
      () => createEvidenceArchive(variant, hashText),
      /credential-shaped (?:assignment|content)/u,
    );
  }

  const safeSentinels = new Map(original);
  safeSentinels.set(
    "summary.md",
    `${safeSentinels.get("summary.md")}\n"apiKey": null\nAuthorization: Bearer UNSET\n`,
  );
  resignEvidence(safeSentinels);
  assert.equal(createEvidenceArchive(safeSentinels, hashText).entryNames.length, 38);

  const openaiCredential = new Map(original);
  const openaiValue = ["sk", "archive-fake-value-123456789"].join("-");
  openaiCredential.set(
    "summary.md",
    `${openaiCredential.get("summary.md")}\nProvider: ${openaiValue}\n`,
  );
  resignEvidence(openaiCredential);
  assert.throws(
    () => createEvidenceArchive(openaiCredential, hashText),
    /credential-shaped content/u,
  );

  const privateKey = new Map(original);
  const privateKeyBlock = [
    "-----BEGIN ",
    "ENCRYPTED PRIVATE KEY",
    "-----\nZmFrZQ==\n-----END ",
    "ENCRYPTED PRIVATE KEY",
    "-----",
  ].join("");
  privateKey.set("summary.md", `${privateKey.get("summary.md")}\n${privateKeyBlock}\n`);
  resignEvidence(privateKey);
  assert.throws(() => createEvidenceArchive(privateKey, hashText), /private-key material/u);

  const pathVariants = [
    ["C:", "Users", "archive-user", "proof.txt"].join("\\"),
    ["c:", "users", "archive-user", "proof.txt"].join("\\"),
    ["", "", "server", "share", "archive-user", "proof.txt"].join("\\"),
    ["", "", "server", "share", "archive-user", "proof.txt"].join("/"),
    ["file:", "", "server", "share", "archive-user", "proof.txt"].join("/"),
    ["", "users", "archive-user", "proof.txt"].join("/"),
    ["", "root", "proof.txt"].join("/"),
  ];
  for (const path of pathVariants) {
    const personalPath = new Map(original);
    personalPath.set("summary.md", `${personalPath.get("summary.md")}\nLocal: ${path}\n`);
    resignEvidence(personalPath);
    assert.throws(
      () => createEvidenceArchive(personalPath, hashText),
      /personal or absolute filesystem path/u,
    );
  }

  const safeUrl = new Map(original);
  safeUrl.set(
    "summary.md",
    `${safeUrl.get("summary.md")}\nReview URL: https://example.com/proof\n`,
  );
  resignEvidence(safeUrl);
  assert.equal(createEvidenceArchive(safeUrl, hashText).entryNames.length, 38);

  const oversized = new Map(original);
  oversized.set("summary.md", `${oversized.get("summary.md")}\n${"x".repeat(4 * 1024 * 1024)}\n`);
  assert.throws(() => createEvidenceArchive(oversized, hashText), /entry exceeds the byte limit/u);

  const aggregate = new Map(original);
  for (const name of [
    "summary.md",
    "security-review.md",
    "integration.diff",
    "compiled-policy.rego",
  ]) {
    aggregate.set(name, "x".repeat(4 * 1024 * 1024));
  }
  aggregate.set("test-command-log.json", "x".repeat(1024));
  assert.throws(() => createEvidenceArchive(aggregate, hashText), /aggregate byte limit/u);
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

  const relabeledAcceptedCorpus = await loadEvidence();
  const relabeledGeneratedCases = JSON.parse(
    relabeledAcceptedCorpus.get("generated-cases.json"),
  );
  relabeledGeneratedCases[0].title = "Self-consistent but not server-owned";
  relabeledAcceptedCorpus.set("generated-cases.json", json(relabeledGeneratedCases));
  resignEvidence(relabeledAcceptedCorpus);
  assert.throws(
    () => validateEvidencePackage(relabeledAcceptedCorpus, hashText),
    /exact server-owned accepted corpus/u,
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

  const falsePartialReceipt = await loadEvidence();
  const partialCodex = JSON.parse(falsePartialReceipt.get("codex-run-summary.json"));
  partialCodex.policyVerificationAttempts = [{ fabricated: true }];
  falsePartialReceipt.set("codex-run-summary.json", json(partialCodex));
  resignEvidence(falsePartialReceipt);
  assert.throws(
    () => validateEvidencePackage(falsePartialReceipt, hashText),
    /no live verification receipt/u,
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
  const liveArchive = createEvidenceArchive(files, hashText, options);
  assert.equal(liveArchive.evidenceMode, "LIVE_VERIFIED");
  assert.equal(liveArchive.packageStatus, "FAIL");
  assert.equal(
    liveArchive.liveAttestationExpiresAtMs,
    Date.parse(verification.createdAt) + DEFAULT_EVIDENCE_MAX_ATTESTATION_AGE_MS,
  );
  assert.match(
    liveArchive.fileName,
    /^policytwin-evidence-v4-live-verified-fail-[0-9a-f]{12}\.tar$/u,
  );

  assert.throws(
    () => validateEvidencePackage(files, hashText, { ...options, now: new Date("2030-07-14T00:00:00.000Z") }),
    /stale and must be refreshed/u,
  );

  assert.throws(
    () => validateEvidencePackage(files, hashText, { now: options.now }),
    /not trusted/u,
  );
  assert.throws(
    () => createEvidenceArchive(files, hashText, { now: options.now }),
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
  assert.throws(
    () => createEvidenceArchive(invalidSignature, hashText, options),
    /signature is invalid/u,
  );
});
