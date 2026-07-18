import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeReleaseTreeFingerprint } from "./release-tree-fingerprint.mjs";

export const OFFLINE_VERIFY_STEPS = Object.freeze([
  "lint",
  "typecheck",
  "test",
  "test:integration",
  "evidence:offline",
  "license:check",
  "container:check",
  "clean:check",
  "submission:draft",
  "submission:draft:check",
  "eval",
  "demo:reset",
  "demo:run",
  "test:e2e",
  "build",
  "security:check",
]);
const MAX_RECEIPT_AGE_MILLISECONDS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MILLISECONDS = 5 * 60 * 1_000;

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function createOfflineVerifyReceipt(root, results, completedAt = new Date()) {
  const evidenceManifest = JSON.parse(
    readFileSync(resolve(root, "artifacts/evidence/evidence-manifest.json"), "utf8"),
  );
  return {
    schemaVersion: "1",
    status:
      results.length === OFFLINE_VERIFY_STEPS.length &&
      results.every((result) => result.status === 0)
        ? "PASS"
        : "FAIL",
    completedAt: completedAt.toISOString(),
    steps: results,
    evidenceHash: evidenceManifest.evidenceHash,
    cleanReportSha256: fileSha256(
      resolve(root, "artifacts/security/clean-checkout-report.json"),
    ),
    securityReportSha256: fileSha256(resolve(root, "artifacts/security/security-report.json")),
    releaseTree: computeReleaseTreeFingerprint(root),
  };
}

export function collectOfflineVerifyReceiptFailures(root, receipt, now = Date.now()) {
  const failures = [];
  const nowMilliseconds = now instanceof Date ? now.getTime() : now;
  const completedAt = Date.parse(receipt?.completedAt ?? "");
  const exactSteps =
    Array.isArray(receipt?.steps) &&
    receipt.steps.length === OFFLINE_VERIFY_STEPS.length &&
    receipt.steps.every(
      (result, index) =>
        result &&
        Object.keys(result).sort().join(",") === "status,step" &&
        result.step === OFFLINE_VERIFY_STEPS[index] &&
        result.status === 0,
    );
  if (receipt?.schemaVersion !== "1" || receipt.status !== "PASS" || !exactSteps) {
    failures.push("Offline verify receipt is not a complete PASS.");
  }
  if (
    !Number.isFinite(nowMilliseconds) ||
    !Number.isFinite(completedAt) ||
    completedAt > nowMilliseconds + MAX_FUTURE_SKEW_MILLISECONDS ||
    nowMilliseconds - completedAt > MAX_RECEIPT_AGE_MILLISECONDS
  ) {
    failures.push("Offline verify receipt is absent, stale, or future-dated.");
  }
  try {
    const evidenceManifest = JSON.parse(
      readFileSync(resolve(root, "artifacts/evidence/evidence-manifest.json"), "utf8"),
    );
    const cleanHash = fileSha256(resolve(root, "artifacts/security/clean-checkout-report.json"));
    const securityHash = fileSha256(resolve(root, "artifacts/security/security-report.json"));
    const tree = computeReleaseTreeFingerprint(root);
    if (
      receipt.evidenceHash !== evidenceManifest.evidenceHash ||
      receipt.cleanReportSha256 !== cleanHash ||
      receipt.securityReportSha256 !== securityHash ||
      JSON.stringify(receipt.releaseTree) !== JSON.stringify(tree)
    ) {
      failures.push("Offline verify receipt is stale for the current release tree or reports.");
    }
    if (tree.untrackedFileCount !== 0) {
      failures.push("Offline verify receipt release tree still contains untracked files.");
    }
  } catch {
    failures.push("Offline verify receipt inputs cannot be recomputed.");
  }
  return [...new Set(failures)].sort();
}
