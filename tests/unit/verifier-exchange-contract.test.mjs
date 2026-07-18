import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVerifierTreeManifest,
  verifierCapabilitySha256,
  verifierExecutionTreeSha256,
  verifierFileSha256,
  verifierReceiptHmacSha256,
  verifierTreeSha256,
} from "../../dist/codex/verifier-exchange-contract.js";

function manifest() {
  const bytes = Buffer.from("export const value = 1;\n", "utf8");
  return {
    schemaVersion: "1",
    entries: [
      { path: "src", kind: "directory", mode: 0o755, bytes: null, sha256: null },
      {
        path: "src/value.ts",
        kind: "file",
        mode: 0o644,
        bytes: bytes.byteLength,
        sha256: verifierFileSha256(bytes),
      },
    ],
  };
}

test("verifier tree manifests require sorted unique paths and explicit directory parents", () => {
  const value = manifest();
  const parsed = parseVerifierTreeManifest(value);
  assert.deepEqual(parsed, value);
  assert.equal(verifierTreeSha256(parsed), verifierTreeSha256(value));

  const reordered = structuredClone(value);
  reordered.entries.reverse();
  assert.throws(() => parseVerifierTreeManifest(reordered), /sorted/u);

  const missingParent = structuredClone(value);
  missingParent.entries.shift();
  assert.throws(() => parseVerifierTreeManifest(missingParent), /directory parent/u);

  const extraField = structuredClone(value);
  extraField.entries[0].unexpected = true;
  assert.throws(() => parseVerifierTreeManifest(extraField), /unknown fields/u);
});

test("source and build digests remain separate in the composite execution binding", () => {
  const source = verifierTreeSha256(manifest());
  const buildA = verifierTreeSha256({
    schemaVersion: "1",
    entries: [
      { path: "dist", kind: "directory", mode: 0o755, bytes: null, sha256: null },
    ],
  });
  const buildB = verifierTreeSha256({
    schemaVersion: "1",
    entries: [
      { path: "dist", kind: "directory", mode: 0o700, bytes: null, sha256: null },
    ],
  });
  assert.notEqual(buildA, buildB);
  assert.notEqual(
    verifierExecutionTreeSha256(source, buildA),
    verifierExecutionTreeSha256(source, buildB),
  );
});

test("verifier capabilities are canonical 256-bit values with domain-separated HMACs", () => {
  const capability = Buffer.alloc(32, 7).toString("base64url");
  const otherCapability = Buffer.alloc(32, 8).toString("base64url");
  const receiptSha256 = "a".repeat(64);
  assert.match(verifierCapabilitySha256(capability), /^[0-9a-f]{64}$/u);
  assert.notEqual(
    verifierCapabilitySha256(capability),
    verifierCapabilitySha256(otherCapability),
  );
  assert.notEqual(
    verifierReceiptHmacSha256(capability, receiptSha256),
    verifierReceiptHmacSha256(otherCapability, receiptSha256),
  );
  assert.throws(() => verifierCapabilitySha256(`${capability}=`));
  assert.throws(() => verifierReceiptHmacSha256("short", receiptSha256));
});
