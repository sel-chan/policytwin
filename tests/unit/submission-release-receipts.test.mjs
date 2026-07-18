import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  computeEvidencePackageHash,
  liveEvidenceAttestationMessage,
} from "../../dist/index.js";
import {
  collectOfflineVerifyReceiptFailures,
  createOfflineVerifyReceipt,
  OFFLINE_VERIFY_STEPS,
} from "../../scripts/offline-verify-receipt.mjs";
import {
  computeReleaseTreeFingerprint,
  RELEASE_TREE_EXCLUDED_PATHS,
} from "../../scripts/release-tree-fingerprint.mjs";
import { validateSubmissionEvidence } from "../../scripts/submission-evidence-validation.mjs";

const REPOSITORY_ROOT = resolve(".");
const RECEIPT_TIME = new Date("2026-07-18T00:00:00.000Z");

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function createReceiptRepository() {
  const root = await mkdtemp(join(tmpdir(), "policytwin-release-receipt-"));
  await Promise.all([
    mkdir(join(root, "artifacts", "evidence"), { recursive: true }),
    mkdir(join(root, "artifacts", "security"), { recursive: true }),
    mkdir(join(root, "artifacts", "submission"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "source.txt"), "release input\n", "utf8"),
    writeFile(join(root, "..release-note"), "legal dot-prefixed input\n", "utf8"),
    writeFile(join(root, "PROGRESS.md"), "mutable ledger\n", "utf8"),
    writeFile(
      join(root, "artifacts", "evidence", "evidence-manifest.json"),
      json({ evidenceHash: "a".repeat(64) }),
      "utf8",
    ),
    writeFile(
      join(root, "artifacts", "security", "clean-checkout-report.json"),
      json({ status: "PASS" }),
      "utf8",
    ),
    writeFile(
      join(root, "artifacts", "security", "security-report.json"),
      json({ status: "PASS" }),
      "utf8",
    ),
    writeFile(
      join(root, "artifacts", "security", "offline-verify-report.json"),
      json({ status: "SELF_REPORT" }),
      "utf8",
    ),
    writeFile(
      join(root, "artifacts", "submission", "submission-check-report.json"),
      json({ status: "SELF_REPORT" }),
      "utf8",
    ),
  ]);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "core.filemode", "false"]);
  git(root, ["add", "--all"]);
  return root;
}

function resignEvidence(files) {
  const placeholder = "0".repeat(64);
  const manifest = JSON.parse(files.get("evidence-manifest.json"));
  const verification = JSON.parse(files.get("verification-summary.json"));
  verification.evidenceHash = placeholder;
  files.set("verification-summary.json", json(verification));
  files.set(
    "summary.md",
    files
      .get("summary.md")
      .replace(/Evidence hash: [0-9a-f]{64}/u, `Evidence hash: ${placeholder}`),
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

async function createSignedEvidenceRoot() {
  const root = await mkdtemp(join(tmpdir(), "policytwin-submission-evidence-"));
  const evidenceDirectory = join(root, "artifacts", "evidence");
  await mkdir(join(root, "artifacts"), { recursive: true });
  await cp(resolve(REPOSITORY_ROOT, "artifacts", "evidence"), evidenceDirectory, {
    recursive: true,
  });
  const names = await readdir(evidenceDirectory);
  const files = new Map(
    await Promise.all(
      names.map(async (name) => [name, await readFile(join(evidenceDirectory, name), "utf8")]),
    ),
  );
  const verification = JSON.parse(files.get("verification-summary.json"));
  verification.evidenceMode = "LIVE_VERIFIED";
  files.set("verification-summary.json", json(verification));
  const runMetadata = JSON.parse(files.get("run-metadata.json"));
  runMetadata.evidenceMode = "LIVE_VERIFIED";
  runMetadata.runId = "submission-wrapper-test-0001";
  runMetadata.recordedInterpreter = false;
  runMetadata.freshExternalWork = true;
  files.set("run-metadata.json", json(runMetadata));
  files.set(
    "summary.md",
    files
      .get("summary.md")
      .replace("Evidence mode: PARTIAL_OFFLINE", "Evidence mode: LIVE_VERIFIED"),
  );
  const evidenceHash = resignEvidence(files);
  const manifest = JSON.parse(files.get("evidence-manifest.json"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  manifest.liveAttestation = {
    schemaVersion: "1",
    algorithm: "Ed25519",
    keyId: "submission-wrapper-test-key",
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
  await Promise.all(
    [...files].map(([name, content]) =>
      writeFile(join(evidenceDirectory, name), content, "utf8"),
    ),
  );
  const trustedKeys = {
    "submission-wrapper-test-key": publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
  const keyFingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    join(root, "config", "attestation-trust.v1.json"),
    json({
      schemaVersion: "1",
      issuer: "TEST_ONLY",
      keys: { "submission-wrapper-test-key": keyFingerprint },
    }),
    "utf8",
  );
  return { root, evidenceDirectory, trustedKeys };
}

test("release fingerprint binds bytes, Git modes, tracking state, and explicit exclusions", async () => {
  const root = await createReceiptRepository();
  try {
    const baseline = computeReleaseTreeFingerprint(root);
    assert.equal(
      baseline.scope,
      "GIT_MANAGED_RELEASE_INPUTS_EXCLUDING_MUTABLE_LEDGER_AND_SELF_REPORTS",
    );
    assert.deepEqual(baseline.excludedPaths, [...RELEASE_TREE_EXCLUDED_PATHS].sort());
    assert.equal(baseline.untrackedFileCount, 0);
    assert.equal(baseline.trackedFileCount, 5);

    git(root, [
      "rm",
      "--cached",
      "--quiet",
      "artifacts/security/offline-verify-report.json",
    ]);
    assert.throws(
      () => computeReleaseTreeFingerprint(root),
      /excluded mutable ledger or self-report path must remain tracked/u,
    );
    git(root, ["add", "artifacts/security/offline-verify-report.json"]);

    await writeFile(join(root, "source.txt"), "changed release input\n", "utf8");
    assert.throws(
      () => computeReleaseTreeFingerprint(root),
      /differ between the Git index and working tree|does not match the Git index object/u,
    );
    git(root, ["add", "source.txt"]);
    assert.notEqual(computeReleaseTreeFingerprint(root).sha256, baseline.sha256);
    await writeFile(join(root, "source.txt"), "release input\n", "utf8");
    git(root, ["add", "source.txt"]);
    assert.equal(computeReleaseTreeFingerprint(root).sha256, baseline.sha256);

    git(root, ["update-index", "--chmod=+x", "source.txt"]);
    assert.notEqual(computeReleaseTreeFingerprint(root).sha256, baseline.sha256);
    git(root, ["update-index", "--chmod=-x", "source.txt"]);
    assert.equal(computeReleaseTreeFingerprint(root).sha256, baseline.sha256);

    git(root, ["update-index", "--assume-unchanged", "source.txt"]);
    await writeFile(join(root, "source.txt"), "hidden working content\n", "utf8");
    assert.throws(
      () => computeReleaseTreeFingerprint(root),
      /unsafe Git index flag|does not match the Git index object/u,
    );
    git(root, ["update-index", "--no-assume-unchanged", "source.txt"]);
    await writeFile(join(root, "source.txt"), "release input\n", "utf8");

    git(root, ["update-index", "--skip-worktree", "source.txt"]);
    await writeFile(join(root, "source.txt"), "hidden sparse content\n", "utf8");
    assert.throws(
      () => computeReleaseTreeFingerprint(root),
      /unsafe Git index flag|does not match the Git index object/u,
    );
    git(root, ["update-index", "--no-skip-worktree", "source.txt"]);
    await writeFile(join(root, "source.txt"), "release input\n", "utf8");
    assert.equal(computeReleaseTreeFingerprint(root).sha256, baseline.sha256);

    await writeFile(join(root, ".git", "info", "attributes"), "source.txt filter=evil\n", "utf8");
    git(root, ["config", "filter.evil.clean", "git show :source.txt"]);
    await writeFile(join(root, "source.txt"), "filter-hidden working content\n", "utf8");
    assert.throws(
      () => computeReleaseTreeFingerprint(root),
      /does not match the Git index object/u,
    );
    await writeFile(join(root, "source.txt"), "release input\n", "utf8");
    await rm(join(root, ".git", "info", "attributes"), { force: true });
    git(root, ["config", "--unset", "filter.evil.clean"]);
    assert.equal(computeReleaseTreeFingerprint(root).sha256, baseline.sha256);

    const objectId = git(root, ["hash-object", "-w", "source.txt"]).trim();
    git(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${objectId},symlink-placeholder`,
    ]);
    await writeFile(join(root, "symlink-placeholder"), "source.txt\n", "utf8");
    assert.throws(
      () => computeReleaseTreeFingerprint(root),
      /Unable to parse a tracked release input/u,
    );
    git(root, ["rm", "--cached", "--quiet", "--force", "symlink-placeholder"]);
    await rm(join(root, "symlink-placeholder"), { force: true });

    await writeFile(join(root, "PROGRESS.md"), "changed mutable ledger\n", "utf8");
    await writeFile(
      join(root, "artifacts", "security", "offline-verify-report.json"),
      "changed self report\n",
      "utf8",
    );
    assert.equal(computeReleaseTreeFingerprint(root).sha256, baseline.sha256);

    await writeFile(join(root, "untracked.txt"), "not published\n", "utf8");
    const untracked = computeReleaseTreeFingerprint(root);
    assert.equal(untracked.untrackedFileCount, 1);
    assert.notEqual(untracked.sha256, baseline.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("offline verify receipt rejects stale, malformed, and untracked release state", async () => {
  const root = await createReceiptRepository();
  try {
    const results = OFFLINE_VERIFY_STEPS.map((step) => ({ step, status: 0 }));
    const receipt = createOfflineVerifyReceipt(root, results, RECEIPT_TIME);
    assert.equal(receipt.status, "PASS");
    assert.deepEqual(collectOfflineVerifyReceiptFailures(root, receipt, RECEIPT_TIME), []);

    await writeFile(
      join(root, "artifacts", "submission", "submission-check-report.json"),
      "new self report\n",
      "utf8",
    );
    assert.deepEqual(collectOfflineVerifyReceiptFailures(root, receipt, RECEIPT_TIME), []);

    const tamperedScope = structuredClone(receipt);
    tamperedScope.releaseTree.scope = "ALL_FILES";
    assert.ok(
      collectOfflineVerifyReceiptFailures(root, tamperedScope, RECEIPT_TIME).some((failure) =>
        failure.includes("stale for the current release tree"),
      ),
    );

    const wrongOrder = structuredClone(receipt);
    wrongOrder.steps.reverse();
    assert.ok(
      collectOfflineVerifyReceiptFailures(root, wrongOrder, RECEIPT_TIME).some((failure) =>
        failure.includes("not a complete PASS"),
      ),
    );

    const stale = { ...receipt, completedAt: "2026-07-16T00:00:00.000Z" };
    assert.ok(
      collectOfflineVerifyReceiptFailures(root, stale, RECEIPT_TIME).some((failure) =>
        failure.includes("stale, or future-dated"),
      ),
    );

    await writeFile(
      join(root, "artifacts", "security", "security-report.json"),
      json({ status: "FAIL" }),
      "utf8",
    );
    git(root, ["add", "artifacts/security/security-report.json"]);
    assert.ok(
      collectOfflineVerifyReceiptFailures(root, receipt, RECEIPT_TIME).some((failure) =>
        failure.includes("stale for the current release tree"),
      ),
    );
    await writeFile(
      join(root, "artifacts", "security", "security-report.json"),
      json({ status: "PASS" }),
      "utf8",
    );
    git(root, ["add", "artifacts/security/security-report.json"]);

    await writeFile(join(root, "untracked.txt"), "not committed\n", "utf8");
    const untrackedFailures = collectOfflineVerifyReceiptFailures(root, receipt, RECEIPT_TIME);
    assert.ok(
      untrackedFailures.some((failure) => failure.includes("stale for the current release tree")),
    );
    assert.ok(untrackedFailures.some((failure) => failure.includes("untracked files")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("submission evidence wrapper accepts a trusted 38-file signature and rejects extras", async () => {
  const { root, evidenceDirectory, trustedKeys } = await createSignedEvidenceRoot();
  const environment = {
    POLICYTWIN_ATTESTATION_PUBLIC_KEYS_JSON: JSON.stringify(trustedKeys),
  };
  try {
    const accepted = await validateSubmissionEvidence(
      root,
      new Date("2026-07-15T00:00:00.000Z"),
      environment,
    );
    assert.equal(accepted.files.size, 38);
    assert.equal(accepted.manifest.evidenceMode, "LIVE_VERIFIED");
    assert.equal(accepted.manifest.liveAttestation.keyId, "submission-wrapper-test-key");

    const trustPath = join(root, "config", "attestation-trust.v1.json");
    const trust = JSON.parse(await readFile(trustPath, "utf8"));
    trust.keys["submission-wrapper-test-key"] = "0".repeat(64);
    await writeFile(trustPath, json(trust), "utf8");
    await assert.rejects(
      validateSubmissionEvidence(
        root,
        new Date("2026-07-15T00:00:00.000Z"),
        environment,
      ),
      /not pinned by the release trust policy/u,
    );
    const publicKey = createPublicKey(trustedKeys["submission-wrapper-test-key"]);
    trust.keys["submission-wrapper-test-key"] = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    await writeFile(trustPath, json(trust), "utf8");

    await writeFile(join(evidenceDirectory, "unexpected.txt"), "not manifested\n", "utf8");
    await assert.rejects(
      validateSubmissionEvidence(
        root,
        new Date("2026-07-15T00:00:00.000Z"),
        environment,
      ),
      /missing or unexpected entry/u,
    );
    await rm(join(evidenceDirectory, "unexpected.txt"), { force: true });

    const manifestPath = join(evidenceDirectory, "evidence-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.liveAttestation.signature = `${
      manifest.liveAttestation.signature[0] === "A" ? "B" : "A"
    }${manifest.liveAttestation.signature.slice(1)}`;
    await writeFile(manifestPath, json(manifest), "utf8");
    await assert.rejects(
      validateSubmissionEvidence(
        root,
        new Date("2026-07-15T00:00:00.000Z"),
        environment,
      ),
      /signature is invalid/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
