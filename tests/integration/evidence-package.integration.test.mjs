import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { validateEvidencePackage } from "../../dist/index.js";

await import("../../scripts/generate-offline-evidence.mjs");

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
  const verificationText = `${JSON.stringify(verification, null, 2)}\n`;
  unsupported.set("verification-summary.json", verificationText);
  const manifest = JSON.parse(unsupported.get("evidence-manifest.json"));
  manifest.packageStatus = "PASS";
  const entry = manifest.entries.find((candidate) => candidate.file === "verification-summary.json");
  entry.bytes = Buffer.byteLength(verificationText, "utf8");
  entry.sha256 = hashText(verificationText);
  unsupported.set("evidence-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => validateEvidencePackage(unsupported, hashText),
    /claims PASS without complete external evidence/u,
  );
});
