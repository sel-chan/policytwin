import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./process.mjs";

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function pinnedAttestationKeys(root) {
  const path = resolve(root, "config", "attestation-trust.v1.json");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new Error("Attestation trust configuration must be a bounded regular file.");
  }
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    !exactKeys(value, ["schemaVersion", "issuer", "keys"]) ||
    value.schemaVersion !== "1" ||
    typeof value.issuer !== "string" ||
    !/^[A-Z0-9._-]{3,128}$/u.test(value.issuer) ||
    value.keys === null ||
    typeof value.keys !== "object" ||
    Array.isArray(value.keys) ||
    Object.entries(value.keys).some(
      ([keyId, fingerprint]) =>
        !/^[A-Za-z0-9._-]{3,128}$/u.test(keyId) ||
        typeof fingerprint !== "string" ||
        !/^[0-9a-f]{64}$/u.test(fingerprint),
    )
  ) {
    throw new Error("Attestation trust configuration is invalid or open.");
  }
  return value.keys;
}

function trustedAttestationKeys(root, environment) {
  const pinnedKeys = pinnedAttestationKeys(root);
  const raw = environment.POLICYTWIN_ATTESTATION_PUBLIC_KEYS_JSON;
  if (!raw) return undefined;
  const value = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Attestation public key configuration must be an object.");
  }
  const entries = Object.entries(value);
  if (
    entries.length === 0 ||
    entries.some(
      ([keyId, key]) =>
        !/^[A-Za-z0-9._-]{3,128}$/u.test(keyId) ||
        typeof key !== "string" ||
        key.length === 0,
    )
  ) {
    throw new Error("Attestation public key configuration contains an invalid entry.");
  }
  return Object.fromEntries(
    entries.map(([keyId, key]) => {
      let publicKey;
      try {
        publicKey = createPublicKey(key);
      } catch {
        throw new Error(`Attestation public key is invalid: ${keyId}`);
      }
      if (publicKey.asymmetricKeyType !== "ed25519") {
        throw new Error(`Attestation public key is not Ed25519: ${keyId}`);
      }
      const fingerprint = createHash("sha256")
        .update(publicKey.export({ type: "spki", format: "der" }))
        .digest("hex");
      if (pinnedKeys[keyId] !== fingerprint) {
        throw new Error(`Attestation public key is not pinned by the release trust policy: ${keyId}`);
      }
      return [keyId, key];
    }),
  );
}

export async function validateSubmissionEvidence(
  root = ROOT,
  now = new Date(),
  environment = process.env,
) {
  const [{ readEvidenceFilesBounded }, { REQUIRED_EVIDENCE_FILES, validateEvidencePackage }] = await Promise.all([
    import("../dist/evidence/files.js"),
    import("../dist/evidence/validate.js"),
  ]);
  const evidenceDirectory = resolve(root, "artifacts", "evidence");
  const actualEntries = readdirSync(evidenceDirectory).sort();
  const expectedEntries = [...REQUIRED_EVIDENCE_FILES].sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error("Evidence directory contains a missing or unexpected entry.");
  }
  for (const entry of actualEntries) {
    const stat = lstatSync(resolve(evidenceDirectory, entry));
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Evidence entry must be a plain regular file: ${entry}`);
    }
  }
  const files = await readEvidenceFilesBounded(evidenceDirectory);
  const manifest = validateEvidencePackage(files, hashText, {
    now: now instanceof Date ? now : new Date(now),
    trustedLiveAttestationKeys: trustedAttestationKeys(root, environment),
  });
  const verification = JSON.parse(files.get("verification-summary.json"));
  return { files, manifest, verification };
}
