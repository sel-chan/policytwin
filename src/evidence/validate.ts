export const REQUIRED_EVIDENCE_FILES = [
  "policy-ir.json",
  "compiled-policy.rego",
  "golden-cases.json",
  "generated-cases.json",
  "opa-results.json",
  "app-results-before.json",
  "drift-report-before.json",
  "codex-run-summary.json",
  "integration.diff",
  "app-results-after.json",
  "drift-report-after.json",
  "mutation-report.json",
  "traceability.json",
  "verification-summary.json",
  "summary.md",
  "run-metadata.json",
  "prompt-manifest.json",
  "compiler-manifest.json",
  "codex-cartography.json",
  "codex-review.json",
  "test-command-log.json",
  "security-review.md",
  "impact-report.json",
  "eval-scorecard.json",
  "evidence-manifest.json",
] as const;

export interface EvidenceManifestEntry {
  file: string;
  bytes: number;
  sha256: string;
  includedInEvidenceHash: boolean;
}

export interface EvidenceManifest {
  schemaVersion: "1";
  algorithm: "SHA-256";
  packageStatus: "PASS" | "FAIL";
  evidenceMode: "PARTIAL_OFFLINE" | "LIVE_VERIFIED";
  evidenceHash: string;
  entries: EvidenceManifestEntry[];
}

export type TextHasher = (value: string) => string;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
}

function parseManifest(value: unknown): EvidenceManifest {
  const result = record(value, "evidence manifest");
  exactKeys(
    result,
    ["schemaVersion", "algorithm", "packageStatus", "evidenceMode", "evidenceHash", "entries"],
    "evidence manifest",
  );
  if (
    result.schemaVersion !== "1" ||
    result.algorithm !== "SHA-256" ||
    !["PASS", "FAIL"].includes(result.packageStatus as string) ||
    !["PARTIAL_OFFLINE", "LIVE_VERIFIED"].includes(result.evidenceMode as string) ||
    typeof result.evidenceHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(result.evidenceHash) ||
    !Array.isArray(result.entries)
  ) {
    throw new Error("Evidence manifest metadata is invalid.");
  }
  const entries = result.entries.map((value, index): EvidenceManifestEntry => {
    const entry = record(value, `evidence manifest entry ${index}`);
    exactKeys(entry, ["file", "bytes", "sha256", "includedInEvidenceHash"], `evidence manifest entry ${index}`);
    if (
      typeof entry.file !== "string" ||
      entry.file.length === 0 ||
      entry.file === "evidence-manifest.json" ||
      entry.file.includes("/") ||
      entry.file.includes("\\") ||
      entry.file === "." ||
      entry.file === ".." ||
      typeof entry.bytes !== "number" ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256) ||
      typeof entry.includedInEvidenceHash !== "boolean"
    ) {
      throw new Error(`Evidence manifest entry ${index} is invalid.`);
    }
    return {
      file: entry.file,
      bytes: entry.bytes,
      sha256: entry.sha256,
      includedInEvidenceHash: entry.includedInEvidenceHash,
    };
  });
  if (new Set(entries.map((entry) => entry.file)).size !== entries.length) {
    throw new Error("Evidence manifest contains duplicate files.");
  }
  return {
    schemaVersion: "1",
    algorithm: "SHA-256",
    packageStatus: result.packageStatus as EvidenceManifest["packageStatus"],
    evidenceMode: result.evidenceMode as EvidenceManifest["evidenceMode"],
    evidenceHash: result.evidenceHash,
    entries,
  };
}

function parseJson(files: ReadonlyMap<string, string>, name: string): Record<string, unknown> {
  const content = files.get(name);
  if (content === undefined) {
    throw new Error(`Missing evidence file: ${name}`);
  }
  try {
    return record(JSON.parse(content), name);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateEvidencePackage(
  files: ReadonlyMap<string, string>,
  hashText: TextHasher,
): EvidenceManifest {
  for (const name of REQUIRED_EVIDENCE_FILES) {
    if (!files.has(name)) {
      throw new Error(`Missing evidence file: ${name}`);
    }
  }
  const manifest = parseManifest(JSON.parse(files.get("evidence-manifest.json") as string));
  const manifestedFiles = new Set(manifest.entries.map((entry) => entry.file));
  for (const name of REQUIRED_EVIDENCE_FILES) {
    if (name !== "evidence-manifest.json" && !manifestedFiles.has(name)) {
      throw new Error(`Required evidence file is not hashed by the manifest: ${name}`);
    }
  }
  for (const name of files.keys()) {
    if (name !== "evidence-manifest.json" && !manifestedFiles.has(name)) {
      throw new Error(`Evidence file is not hashed by the manifest: ${name}`);
    }
  }
  const encoder = new TextEncoder();
  for (const entry of manifest.entries) {
    const content = files.get(entry.file);
    if (content === undefined) {
      throw new Error(`Manifest references a missing file: ${entry.file}`);
    }
    if (encoder.encode(content).byteLength !== entry.bytes || hashText(content) !== entry.sha256) {
      throw new Error(`Evidence hash mismatch: ${entry.file}`);
    }
  }
  const included = manifest.entries
    .filter((entry) => entry.includedInEvidenceHash)
    .sort((left, right) => left.file.localeCompare(right.file));
  const aggregate = included.map((entry) => `${entry.file}\0${entry.sha256}\0`).join("");
  if (hashText(aggregate) !== manifest.evidenceHash) {
    throw new Error("Evidence package aggregate hash mismatch.");
  }

  const verification = parseJson(files, "verification-summary.json");
  exactKeys(
    verification,
    [
      "schemaVersion",
      "status",
      "evidenceMode",
      "policyVersion",
      "golden",
      "generated",
      "driftBefore",
      "driftAfter",
      "evaluationOnlyFixedFixtureDrift",
      "mutation",
      "regression",
      "traceability",
      "security",
      "externalGates",
      "evidenceHash",
      "createdAt",
    ],
    "verification summary",
  );
  if (
    verification.schemaVersion !== "1" ||
    !["PASS", "FAIL"].includes(verification.status as string) ||
    verification.evidenceMode !== manifest.evidenceMode
  ) {
    throw new Error("Verification summary metadata is invalid.");
  }
  const externalGates = record(verification.externalGates, "verification externalGates");
  exactKeys(
    externalGates,
    ["gpt56", "opa", "codex", "browser", "container", "deployment"],
    "verification externalGates",
  );
  const gateValues = Object.values(externalGates);
  if (gateValues.some((value) => !["PASS", "FAIL", "NOT_RUN"].includes(value as string))) {
    throw new Error("Verification external gate status is invalid.");
  }
  const allExternalPassed = gateValues.length > 0 && gateValues.every((value) => value === "PASS");
  const security = record(verification.security, "verification security");
  exactKeys(security, ["critical", "high", "status"], "verification security");
  const canPass =
    allExternalPassed &&
    verification.driftAfter === 0 &&
    security.critical === 0 &&
    security.high === 0;
  if (verification.status === "PASS" && !canPass) {
    throw new Error("Verification summary claims PASS without complete external evidence.");
  }
  if (manifest.packageStatus !== verification.status) {
    throw new Error("Manifest and verification summary status disagree.");
  }
  if (manifest.evidenceMode === "PARTIAL_OFFLINE" && manifest.packageStatus !== "FAIL") {
    throw new Error("A partial offline package cannot pass verification.");
  }
  if (verification.evidenceHash !== manifest.evidenceHash) {
    throw new Error("Verification summary evidence hash does not match the manifest.");
  }

  const opa = parseJson(files, "opa-results.json");
  const codex = parseJson(files, "codex-run-summary.json");
  if (manifest.evidenceMode === "PARTIAL_OFFLINE") {
    if (opa.status !== "NOT_RUN" || codex.status !== "NOT_RUN_LIVE") {
      throw new Error("Partial offline evidence must not impersonate OPA or live Codex work.");
    }
    if (verification.driftAfter !== null) {
      throw new Error("Partial offline evidence cannot claim post-Codex repair drift.");
    }
  }
  const humanSummary = files.get("summary.md") as string;
  if (
    !humanSummary.includes(`Status: ${manifest.packageStatus}`) ||
    !humanSummary.includes(manifest.evidenceHash)
  ) {
    throw new Error("Human evidence summary does not match machine status and hash.");
  }
  return manifest;
}
