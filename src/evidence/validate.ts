import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { assertSafeRelativePath } from "../codex/safety.js";
import {
  parseCartographyResult,
  parseCommandEvidence,
  parseRepairResult,
  parseReviewResult,
} from "../codex/validate.js";
import { compilePolicyToRego } from "../compiler/rego.js";
import { isDecision } from "../domain/decision.js";
import type { PolicyCase } from "../domain/cases.js";
import { parseRefundPolicyInput } from "../domain/refund.js";
import type { CodeMapping } from "../impact/types.js";
import { generatePolicyMutants } from "../mutation/mutate.js";
import { runOfflineMutationSuite } from "../mutation/report.js";
import { parsePolicyIR } from "../policy-ir/validate.js";
import {
  buildTraceabilityReport,
  SEEDED_REFUND_CODE_MAPPINGS,
} from "../traceability/report.js";

export const REQUIRED_EVIDENCE_FILES = [
  "policy-ir.json",
  "compiled-policy.rego",
  "golden-cases.json",
  "generated-cases.json",
  "gpt-run-summary.json",
  "opa-results.json",
  "app-results-before.json",
  "drift-report-before.json",
  "codex-run-summary.json",
  "codex-command-receipts.json",
  "integration.diff",
  "fixture-tree-before.json",
  "fixture-tree-after.json",
  "app-results-after.json",
  "drift-report-after.json",
  "mutation-report.json",
  "mutation-run-summary.json",
  "mutation-opa-results.json",
  "traceability.json",
  "verification-summary.json",
  "summary.md",
  "run-metadata.json",
  "prompt-manifest.json",
  "compiler-manifest.json",
  "codex-cartography.json",
  "codex-review.json",
  "test-command-log.json",
  "browser-run-summary.json",
  "browser-run-details.json",
  "container-run-summary.json",
  "container-run-details.json",
  "deployment-run-summary.json",
  "deployment-health-response.json",
  "security-report.json",
  "security-review.md",
  "impact-report.json",
  "eval-scorecard.json",
  "evidence-manifest.json",
] as const;

export interface LiveEvidenceAttestation {
  schemaVersion: "1";
  algorithm: "Ed25519";
  keyId: string;
  runId: string;
  issuedAt: string;
  evidenceHash: string;
  signature: string;
}

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
  liveAttestation: LiveEvidenceAttestation | null;
  entries: EvidenceManifestEntry[];
}

export interface TrustedOpaExecutable {
  version: string;
  sha256: string;
}

export interface EvidenceValidationOptions {
  trustedLiveAttestationKeys?: Readonly<Record<string, string>>;
  trustedOpaExecutables?: readonly TrustedOpaExecutable[];
  now?: Date;
  maxFutureSkewMs?: number;
  maxAttestationAgeMs?: number;
}

export type TextHasher = (value: string) => string;

const EVIDENCE_HASH_PLACEHOLDER = "0".repeat(64);
const ACCEPTED_CASE_MINIMUM = 30;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_ATTESTATION_AGE_MS = 24 * 60 * 60 * 1_000;
const CASE_SOURCES = new Set([
  "USER_GOLDEN",
  "BOUNDARY",
  "CONFLICT",
  "MINIMAL_CONTRAST",
  "GENERATED",
  "REGRESSION",
  "MUTATION_WITNESS",
]);
const MUTATION_OPERATORS = [
  "LTE_TO_LT",
  "GTE_TO_GT",
  "AND_TO_OR",
  "PREDICATE_DELETE",
  "BOOLEAN_INVERT",
  "THRESHOLD_MINUS_ONE",
  "THRESHOLD_PLUS_ONE",
  "PRIORITY_SWAP",
  "RULE_DELETE",
  "DEFAULT_CHANGE",
] as const;
const DEFAULT_TRUSTED_OPA_EXECUTABLES: readonly TrustedOpaExecutable[] = [
  {
    version: "1.18.2",
    sha256: "b9022224ee660c87cc35ce957c21c352fa57b267d71fb4e1ce779a38e107c9df",
  },
  {
    version: "1.18.2",
    sha256: "9903e5125ac281104f2c4b7371d10cc3b74a98933743fcbfc174f9bf0ab20de8",
  },
];
const TRUSTED_CONTAINER_OPA = {
  platform: "linux/amd64",
  version: "1.18.2",
  sha256: "9903e5125ac281104f2c4b7371d10cc3b74a98933743fcbfc174f9bf0ab20de8",
} as const;
const TRUSTED_FIXTURE_BASELINE_SHA256 =
  "108d66bc8dbcad753e0cf92ac74aacf7a616a5b301df62b411e391e5fad7e89a";
const REQUIRED_LIVE_COMMANDS = [
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "pnpm test:integration",
  "pnpm security:check",
  "pnpm license:check",
  "pnpm container:check",
  "pnpm submission:draft",
  "pnpm submission:check",
  "pnpm clean:check",
  "pnpm eval",
  "pnpm demo:reset",
  "pnpm demo:run",
  "pnpm test:e2e",
  "pnpm build",
] as const;

export interface EvidenceHashEntry {
  file: string;
  includedInEvidenceHash: boolean;
}

function evidenceContribution(file: string, content: string): string {
  if (file === "verification-summary.json") {
    if (!/"evidenceHash"\s*:\s*"[0-9a-f]{64}"/u.test(content)) {
      throw new Error("Verification summary lacks a normalizable evidence hash.");
    }
    return content.replace(
      /("evidenceHash"\s*:\s*")[0-9a-f]{64}(")/u,
      `$1${EVIDENCE_HASH_PLACEHOLDER}$2`,
    );
  }
  if (file === "summary.md") {
    if (!/Evidence hash: [0-9a-f]{64}/u.test(content)) {
      throw new Error("Human summary lacks a normalizable evidence hash.");
    }
    return content.replace(
      /Evidence hash: [0-9a-f]{64}/u,
      `Evidence hash: ${EVIDENCE_HASH_PLACEHOLDER}`,
    );
  }
  return content;
}

export function computeEvidencePackageHash(
  files: ReadonlyMap<string, string>,
  entries: readonly EvidenceHashEntry[],
  hashText: TextHasher,
): string {
  const included = entries
    .filter((entry) => entry.includedInEvidenceHash)
    .sort((left, right) => left.file.localeCompare(right.file));
  const aggregate = included
    .map((entry) => {
      const content = files.get(entry.file);
      if (content === undefined) {
        throw new Error(`Missing evidence hash contribution: ${entry.file}`);
      }
      return `${entry.file}\0${hashText(evidenceContribution(entry.file, content))}\0`;
    })
    .join("");
  return hashText(aggregate);
}

export function liveEvidenceAttestationMessage(
  evidenceHash: string,
  runId: string,
  issuedAt: string,
): string {
  return `PolicyTwin-Live-Evidence-v1\n${evidenceHash}\n${runId}\n${issuedAt}\n`;
}

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

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function uniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const items = value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return items;
}

function canonicalIso(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return text;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function parseAttestation(value: unknown): LiveEvidenceAttestation | null {
  if (value === null) {
    return null;
  }
  const result = record(value, "live attestation");
  exactKeys(
    result,
    ["schemaVersion", "algorithm", "keyId", "runId", "issuedAt", "evidenceHash", "signature"],
    "live attestation",
  );
  const signature = nonEmptyString(result.signature, "live attestation signature");
  if (
    result.schemaVersion !== "1" ||
    result.algorithm !== "Ed25519" ||
    !/^[A-Za-z0-9._-]{3,128}$/u.test(nonEmptyString(result.keyId, "live attestation keyId")) ||
    !/^[A-Za-z0-9._-]{16,128}$/u.test(nonEmptyString(result.runId, "live attestation runId")) ||
    !/^[0-9a-f]{64}$/u.test(nonEmptyString(result.evidenceHash, "live attestation evidenceHash")) ||
    !/^[A-Za-z0-9_-]{86}$/u.test(signature) ||
    Buffer.from(signature, "base64url").byteLength !== 64
  ) {
    throw new Error("Live attestation metadata is invalid.");
  }
  return {
    schemaVersion: "1",
    algorithm: "Ed25519",
    keyId: result.keyId as string,
    runId: result.runId as string,
    issuedAt: canonicalIso(result.issuedAt, "live attestation issuedAt"),
    evidenceHash: result.evidenceHash as string,
    signature,
  };
}

function parseManifest(value: unknown): EvidenceManifest {
  const result = record(value, "evidence manifest");
  exactKeys(
    result,
    [
      "schemaVersion",
      "algorithm",
      "packageStatus",
      "evidenceMode",
      "evidenceHash",
      "liveAttestation",
      "entries",
    ],
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
    liveAttestation: parseAttestation(result.liveAttestation),
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

function parseJsonArray(files: ReadonlyMap<string, string>, name: string): unknown[] {
  const content = files.get(name);
  if (content === undefined) {
    throw new Error(`Missing evidence file: ${name}`);
  }
  try {
    const value = JSON.parse(content) as unknown;
    if (!Array.isArray(value)) {
      throw new Error(`${name} must be an array.`);
    }
    return value;
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseEvidenceCases(
  values: readonly unknown[],
  label: string,
  expectedKind: "GOLDEN" | "GENERATED",
  policy: ReturnType<typeof parsePolicyIR>,
): PolicyCase[] {
  const clauseIds = new Set(policy.clauses.map((clause) => clause.id));
  const ruleIds = new Set(policy.rules.map((rule) => rule.id));
  const cases = values.map((value, index): PolicyCase => {
    const item = record(value, `${label}[${index}]`);
    exactKeys(
      item,
      ["id", "title", "input", "expectedDecision", "source", "relatedRuleIds", "relatedClauseIds", "rationale"],
      `${label}[${index}]`,
    );
    const id = nonEmptyString(item.id, `${label}[${index}].id`);
    if (!/^[A-Za-z0-9._-]{1,128}$/u.test(id)) {
      throw new Error(`${label}[${index}].id is invalid.`);
    }
    if (!isDecision(item.expectedDecision) || !CASE_SOURCES.has(item.source as string)) {
      throw new Error(`${label}[${index}] has an invalid decision or source.`);
    }
    if (
      (expectedKind === "GOLDEN" && item.source !== "USER_GOLDEN") ||
      (expectedKind === "GENERATED" && item.source === "USER_GOLDEN")
    ) {
      throw new Error(`${label}[${index}] is stored in the wrong corpus.`);
    }
    const relatedRuleIds = uniqueStrings(item.relatedRuleIds, `${label}[${index}].relatedRuleIds`);
    const relatedClauseIds = uniqueStrings(item.relatedClauseIds, `${label}[${index}].relatedClauseIds`);
    if (
      relatedClauseIds.length === 0 ||
      relatedRuleIds.some((ruleId) => !ruleIds.has(ruleId)) ||
      relatedClauseIds.some((clauseId) => !clauseIds.has(clauseId))
    ) {
      throw new Error(`${label}[${index}] references an unknown policy rule or clause.`);
    }
    return {
      id,
      title: nonEmptyString(item.title, `${label}[${index}].title`),
      input: parseRefundPolicyInput(item.input),
      expectedDecision: item.expectedDecision,
      source: item.source as PolicyCase["source"],
      relatedRuleIds,
      relatedClauseIds,
      rationale: nonEmptyString(item.rationale, `${label}[${index}].rationale`),
    };
  });
  if (new Set(cases.map((policyCase) => policyCase.id)).size !== cases.length) {
    throw new Error(`${label} contains duplicate case IDs.`);
  }
  return cases;
}

function validateMutationReport(
  artifact: Record<string, unknown>,
  summary: Record<string, unknown>,
  acceptedCaseIds: ReadonlySet<string>,
  policy: ReturnType<typeof parsePolicyIR>,
  cases: readonly PolicyCase[],
): void {
  exactKeys(summary, ["killed", "total", "excludedEquivalent", "killRate", "executionMode"], "verification mutation");
  for (const field of ["killed", "total", "excludedEquivalent", "killRate", "executionMode"] as const) {
    if (summary[field] !== artifact[field]) {
      throw new Error(`Verification mutation ${field} does not match mutation-report.json.`);
    }
  }
  const total = nonNegativeInteger(artifact.total, "mutation total");
  const killed = nonNegativeInteger(artifact.killed, "mutation killed");
  const excludedEquivalent = nonNegativeInteger(artifact.excludedEquivalent, "mutation excludedEquivalent");
  const denominator = total - excludedEquivalent;
  if (
    total <= 0 ||
    excludedEquivalent >= total ||
    killed > denominator ||
    typeof artifact.killRate !== "number" ||
    !Number.isFinite(artifact.killRate) ||
    artifact.killRate < 0 ||
    artifact.killRate > 1 ||
    Math.abs(artifact.killRate - killed / denominator) > 1e-12 ||
    !["REFERENCE_EVALUATOR_NOT_OPA", "OPA_CLI"].includes(artifact.executionMode as string)
  ) {
    throw new Error("Verification mutation metrics are invalid.");
  }
  if (!Array.isArray(artifact.results) || artifact.results.length !== total) {
    throw new Error("Mutation result details do not match the total.");
  }
  const results = artifact.results.map((value, index) => {
    const result = record(value, `mutation result ${index}`);
    exactKeys(result, ["mutantId", "operator", "description", "killed", "witnessCaseIds"], `mutation result ${index}`);
    const mutantId = nonEmptyString(result.mutantId, `mutation result ${index}.mutantId`);
    if (!MUTATION_OPERATORS.includes(result.operator as (typeof MUTATION_OPERATORS)[number]) || typeof result.killed !== "boolean") {
      throw new Error(`Mutation result ${index} is invalid.`);
    }
    const witnessCaseIds = uniqueStrings(result.witnessCaseIds, `mutation result ${index}.witnessCaseIds`);
    if (witnessCaseIds.some((caseId) => !acceptedCaseIds.has(caseId)) || result.killed !== (witnessCaseIds.length > 0)) {
      throw new Error(`Mutation result ${mutantId} has invalid witness evidence.`);
    }
    nonEmptyString(result.description, `mutation result ${index}.description`);
    return { mutantId, operator: result.operator as string, killed: result.killed, witnessCaseIds };
  });
  if (new Set(results.map((result) => result.mutantId)).size !== results.length) {
    throw new Error("Mutation result IDs must be unique.");
  }
  const equivalentExclusions = artifact.equivalentExclusions;
  let excludedIds = new Set<string>();
  if (excludedEquivalent > 0) {
    if (!Array.isArray(equivalentExclusions) || equivalentExclusions.length !== excludedEquivalent) {
      throw new Error("Equivalent mutation exclusions require deterministic evidence.");
    }
    const ids = equivalentExclusions.map((value, index) => {
      const exclusion = record(value, `equivalent exclusion ${index}`);
      exactKeys(exclusion, ["mutantId", "justification"], `equivalent exclusion ${index}`);
      nonEmptyString(exclusion.justification, `equivalent exclusion ${index}.justification`);
      return nonEmptyString(exclusion.mutantId, `equivalent exclusion ${index}.mutantId`);
    });
    excludedIds = new Set(ids);
    if (excludedIds.size !== ids.length || ids.some((id) => !results.some((result) => result.mutantId === id && !result.killed))) {
      throw new Error("Equivalent mutation exclusions are invalid or duplicated.");
    }
  } else if (equivalentExclusions !== undefined && (!Array.isArray(equivalentExclusions) || equivalentExclusions.length > 0)) {
    throw new Error("Unexpected equivalent mutation exclusions were reported.");
  }
  if (results.filter((result) => result.killed).length !== killed) {
    throw new Error("Mutation killed count does not match detailed results.");
  }
  if (!Array.isArray(artifact.survivors)) {
    throw new Error("Mutation survivors must be an array.");
  }
  const expectedSurvivors = results
    .filter((result) => !result.killed && !excludedIds.has(result.mutantId))
    .map((result) => result.mutantId);
  const survivorIds = artifact.survivors.map((value, index) =>
    nonEmptyString(record(value, `mutation survivor ${index}`).mutantId, `mutation survivor ${index}.mutantId`),
  );
  if (!sameStringSet(expectedSurvivors, survivorIds) || new Set(survivorIds).size !== survivorIds.length) {
    throw new Error("Mutation survivor details are inconsistent.");
  }
  const operatorCounts = record(artifact.operatorCounts, "mutation operatorCounts");
  exactKeys(operatorCounts, MUTATION_OPERATORS, "mutation operatorCounts");
  for (const operator of MUTATION_OPERATORS) {
    if (operatorCounts[operator] !== results.filter((result) => result.operator === operator).length) {
      throw new Error(`Mutation operator count is inconsistent for ${operator}.`);
    }
  }
  const deterministic = runOfflineMutationSuite(policy, cases);
  if (
    excludedEquivalent !== 0 ||
    killed !== deterministic.killed ||
    total !== deterministic.total ||
    Math.abs((artifact.killRate as number) - deterministic.killRate) > 1e-12 ||
    !sameJson(artifact.results, deterministic.results) ||
    !sameJson(artifact.survivors, deterministic.survivors) ||
    !sameJson(artifact.operatorCounts, deterministic.operatorCounts)
  ) {
    throw new Error("Mutation evidence is not the deterministic mutant corpus and witness result set.");
  }
}

function validateMutationRunSummary(
  files: ReadonlyMap<string, string>,
  policy: ReturnType<typeof parsePolicyIR>,
  cases: readonly PolicyCase[],
  mutationArtifact: Record<string, unknown>,
  hashText: TextHasher,
): Record<string, unknown> {
  const summary = parseJson(files, "mutation-run-summary.json");
  exactKeys(
    summary,
    [
      "schemaVersion",
      "status",
      "executionMode",
      "runId",
      "opaVersion",
      "executableSha256",
      "reportSha256",
      "total",
      "mutantPolicyHashes",
      "opaResultHashes",
    ],
    "mutation run summary",
  );
  if (
    summary.schemaVersion !== "1" ||
    summary.total !== mutationArtifact.total ||
    summary.reportSha256 !== hashText(files.get("mutation-report.json") as string) ||
    !Array.isArray(summary.mutantPolicyHashes) ||
    !Array.isArray(summary.opaResultHashes)
  ) {
    throw new Error("Mutation run summary metadata is inconsistent.");
  }
  const expectedPolicyHashes = generatePolicyMutants(policy, cases).map((mutant) => ({
    mutantId: mutant.id,
    policySha256: hashText(JSON.stringify(mutant.policy)),
  }));
  const policyHashes = summary.mutantPolicyHashes.map((value, index) => {
    const item = record(value, `mutation policy hash ${index}`);
    exactKeys(item, ["mutantId", "policySha256"], `mutation policy hash ${index}`);
    if (
      typeof item.mutantId !== "string" ||
      typeof item.policySha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(item.policySha256)
    ) {
      throw new Error(`Mutation policy hash ${index} is invalid.`);
    }
    return { mutantId: item.mutantId, policySha256: item.policySha256 };
  });
  if (!sameJson(policyHashes, expectedPolicyHashes)) {
    throw new Error("Mutation policy hashes do not match the deterministic mutant set.");
  }
  const resultHashes = summary.opaResultHashes.map((value, index) => {
    const item = record(value, `mutation OPA result hash ${index}`);
    exactKeys(item, ["mutantId", "resultsSha256"], `mutation OPA result hash ${index}`);
    if (
      typeof item.mutantId !== "string" ||
      typeof item.resultsSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(item.resultsSha256)
    ) {
      throw new Error(`Mutation OPA result hash ${index} is invalid.`);
    }
    return { mutantId: item.mutantId, resultsSha256: item.resultsSha256 };
  });
  if (
    new Set(resultHashes.map((item) => item.mutantId)).size !== resultHashes.length ||
    resultHashes.some((item) => !expectedPolicyHashes.some((expected) => expected.mutantId === item.mutantId))
  ) {
    throw new Error("Mutation OPA result hashes contain duplicate or unknown mutants.");
  }
  return summary;
}

function validateMutationOpaResults(
  files: ReadonlyMap<string, string>,
  runId: string,
  policy: ReturnType<typeof parsePolicyIR>,
  cases: readonly PolicyCase[],
  mutationArtifact: Record<string, unknown>,
  mutationRunSummary: Record<string, unknown>,
  hashText: TextHasher,
): void {
  const receipt = parseJson(files, "mutation-opa-results.json");
  exactKeys(
    receipt,
    ["schemaVersion", "status", "executionMode", "runId", "results"],
    "mutation OPA results",
  );
  if (
    receipt.schemaVersion !== "1" ||
    receipt.status !== "PASS" ||
    receipt.executionMode !== "OPA_CLI" ||
    receipt.runId !== runId ||
    !Array.isArray(receipt.results)
  ) {
    throw new Error("Mutation OPA result receipt metadata is invalid.");
  }
  const casesById = new Map(cases.map((policyCase) => [policyCase.id, policyCase]));
  const policyHashes = new Map(
    (mutationRunSummary.mutantPolicyHashes as Array<Record<string, unknown>>)
      .map((item) => [item.mutantId as string, item.policySha256 as string]),
  );
  const summaryHashes = new Map(
    (mutationRunSummary.opaResultHashes as Array<Record<string, unknown>>)
      .map((item) => [item.mutantId as string, item.resultsSha256 as string]),
  );
  const mutationResults = new Map(
    (mutationArtifact.results as Array<Record<string, unknown>>)
      .map((item) => [item.mutantId as string, item]),
  );
  const seenMutants = new Set<string>();
  for (const [index, value] of receipt.results.entries()) {
    const item = record(value, `mutation OPA receipt ${index}`);
    exactKeys(item, ["mutantId", "policySha256", "results"], `mutation OPA receipt ${index}`);
    const mutantId = nonEmptyString(item.mutantId, `mutation OPA receipt ${index}.mutantId`);
    if (
      seenMutants.has(mutantId) ||
      item.policySha256 !== policyHashes.get(mutantId) ||
      !Array.isArray(item.results) ||
      item.results.length !== cases.length
    ) {
      throw new Error(`Mutation OPA receipt ${mutantId} has invalid identity or policy evidence.`);
    }
    const seenCases = new Set<string>();
    const witnessCaseIds: string[] = [];
    for (const [caseIndex, rawCase] of item.results.entries()) {
      const caseResult = record(rawCase, `mutation ${mutantId} case result ${caseIndex}`);
      exactKeys(caseResult, ["caseId", "inputHash", "result"], `mutation ${mutantId} case result ${caseIndex}`);
      const caseId = nonEmptyString(caseResult.caseId, `mutation ${mutantId} case result ${caseIndex}.caseId`);
      const policyCase = casesById.get(caseId);
      const result = record(caseResult.result, `mutation ${mutantId} case result ${caseIndex}.result`);
      exactKeys(result, ["decision", "matchedRuleId", "explanation", "policyVersion"], `mutation ${mutantId} case result ${caseIndex}.result`);
      if (
        !policyCase ||
        seenCases.has(caseId) ||
        !isDecision(result.decision) ||
        !(result.matchedRuleId === null || typeof result.matchedRuleId === "string") ||
        typeof result.explanation !== "string" ||
        result.explanation.trim().length === 0 ||
        result.policyVersion !== policy.version ||
        caseResult.inputHash !== hashText(JSON.stringify(parseRefundPolicyInput(policyCase.input)))
      ) {
        throw new Error(`Mutation ${mutantId} case result ${caseId} is invalid.`);
      }
      if (result.decision !== policyCase.expectedDecision) {
        witnessCaseIds.push(caseId);
      }
      seenCases.add(caseId);
    }
    const mutationResult = mutationResults.get(mutantId);
    if (
      seenCases.size !== cases.length ||
      !mutationResult ||
      mutationResult.killed !== (witnessCaseIds.length > 0) ||
      !sameStringSet(mutationResult.witnessCaseIds as string[], witnessCaseIds) ||
      summaryHashes.get(mutantId) !== hashText(JSON.stringify(canonicalValue(item)))
    ) {
      throw new Error(`Mutation OPA receipt ${mutantId} does not derive its reported witnesses and hash.`);
    }
    seenMutants.add(mutantId);
  }
  if (
    seenMutants.size !== mutationResults.size ||
    [...mutationResults.keys()].some((mutantId) => !seenMutants.has(mutantId))
  ) {
    throw new Error("Mutation OPA receipts do not cover the deterministic mutant corpus.");
  }
}

interface OpaResultView {
  decision: string;
  matchedRuleId: string | null;
  explanation: string;
  policyVersion: number;
}

function validateOpaEvidence(
  opa: Record<string, unknown>,
  policy: ReturnType<typeof parsePolicyIR>,
  cases: readonly PolicyCase[],
  compiledPolicy: string,
  compilerManifest: Record<string, unknown>,
  hashText: TextHasher,
  trustedExecutables: readonly TrustedOpaExecutable[],
): Map<string, OpaResultView> {
  exactKeys(
    opa,
    [
      "schemaVersion",
      "executionMode",
      "opaVersion",
      "executableSha256",
      "policyHash",
      "query",
      "compileCommand",
      "evalCommand",
      "results",
      "status",
      "policyVersion",
      "acceptedCaseAgreement",
    ],
    "OPA evidence",
  );
  if (
    opa.schemaVersion !== "1" ||
    opa.status !== "PASS" ||
    opa.executionMode !== "OPA_CLI" ||
    opa.policyHash !== hashText(compiledPolicy) ||
    opa.query !== compilerManifest.query ||
    opa.query !== "data.policytwin.refund.decision" ||
    opa.compileCommand !== "opa check --strict <policy.rego>" ||
    opa.evalCommand !== "opa eval --format json --stdin-input --data <policy.rego> <query>" ||
    opa.policyVersion !== policy.version ||
    !trustedExecutables.some(
      (candidate) => candidate.version === opa.opaVersion && candidate.sha256 === opa.executableSha256,
    ) ||
    !Array.isArray(opa.results)
  ) {
    throw new Error("OPA PASS evidence does not match the trusted engine and compiler contract.");
  }
  const casesById = new Map(cases.map((policyCase) => [policyCase.id, policyCase]));
  const ruleIds = new Set(policy.rules.map((rule) => rule.id));
  const resultMap = new Map<string, OpaResultView>();
  for (const [index, value] of opa.results.entries()) {
    const item = record(value, `OPA result ${index}`);
    exactKeys(item, ["caseId", "inputHash", "result"], `OPA result ${index}`);
    const caseId = nonEmptyString(item.caseId, `OPA result ${index}.caseId`);
    const policyCase = casesById.get(caseId);
    const result = record(item.result, `OPA result ${index}.result`);
    exactKeys(result, ["decision", "matchedRuleId", "explanation", "policyVersion"], `OPA result ${index}.result`);
    if (
      !policyCase ||
      resultMap.has(caseId) ||
      !isDecision(result.decision) ||
      result.decision !== policyCase.expectedDecision ||
      !(result.matchedRuleId === null || (typeof result.matchedRuleId === "string" && ruleIds.has(result.matchedRuleId))) ||
      (result.matchedRuleId === null
        ? policyCase.relatedRuleIds.length !== 0
        : !policyCase.relatedRuleIds.includes(result.matchedRuleId as string)) ||
      typeof result.explanation !== "string" ||
      result.explanation.trim().length === 0 ||
      result.policyVersion !== policy.version ||
      item.inputHash !== hashText(JSON.stringify(parseRefundPolicyInput(policyCase.input)))
    ) {
      throw new Error(`OPA result ${index} is incomplete or inconsistent with its accepted case.`);
    }
    resultMap.set(caseId, {
      decision: result.decision,
      matchedRuleId: result.matchedRuleId as string | null,
      explanation: result.explanation,
      policyVersion: result.policyVersion as number,
    });
  }
  const agreement = record(opa.acceptedCaseAgreement, "OPA acceptedCaseAgreement");
  exactKeys(agreement, ["passed", "total"], "OPA acceptedCaseAgreement");
  if (
    resultMap.size !== cases.length ||
    agreement.passed !== cases.length ||
    agreement.total !== cases.length ||
    [...casesById.keys()].some((caseId) => !resultMap.has(caseId))
  ) {
    throw new Error("OPA accepted-case agreement is incomplete.");
  }
  return resultMap;
}

function validateDriftCounts(value: Record<string, unknown>, label: string): void {
  const records = Array.isArray(value.records) ? value.records : [];
  const counts = {
    MATCH: records.filter((item) => record(item, `${label} record`).status === "MATCH").length,
    DRIFT: records.filter((item) => record(item, `${label} record`).status === "DRIFT").length,
    ERROR: records.filter((item) => record(item, `${label} record`).status === "ERROR").length,
  };
  if (
    !Number.isSafeInteger(value.total) ||
    !Number.isSafeInteger(value.matches) ||
    !Number.isSafeInteger(value.drifts) ||
    !Number.isSafeInteger(value.errors) ||
    value.total !== records.length ||
    value.matches !== counts.MATCH ||
    value.drifts !== counts.DRIFT ||
    value.errors !== counts.ERROR ||
    value.matches + value.drifts + value.errors !== value.total
  ) {
    throw new Error(`${label} counts are incomplete or inconsistent.`);
  }
}

function validateDifferentialReport(
  value: Record<string, unknown>,
  label: string,
  cases: readonly PolicyCase[],
  opaResults: ReadonlyMap<string, OpaResultView>,
): Map<string, Record<string, unknown>> {
  validateDriftCounts(value, label);
  if (value.schemaVersion !== "1" || typeof value.executionMode !== "string" || typeof value.adapterId !== "string") {
    throw new Error(`${label} metadata is invalid.`);
  }
  const casesById = new Map(cases.map((policyCase) => [policyCase.id, policyCase]));
  const records = value.records as unknown[];
  const recordMap = new Map<string, Record<string, unknown>>();
  const defectWitnesses = new Map<string, string[]>();
  for (const [index, raw] of records.entries()) {
    const item = record(raw, `${label} record ${index}`);
    const caseId = nonEmptyString(item.caseId, `${label} record ${index}.caseId`);
    const policyCase = casesById.get(caseId);
    const opaResult = opaResults.get(caseId);
    const expected = record(item.expected, `${label} record ${index}.expected`);
    const actual = item.actual === null ? null : record(item.actual, `${label} record ${index}.actual`);
    if (
      !policyCase ||
      !opaResult ||
      recordMap.has(caseId) ||
      !sameJson(parseRefundPolicyInput(item.input), policyCase.input) ||
      expected.decision !== opaResult.decision ||
      expected.matchedRuleId !== opaResult.matchedRuleId ||
      expected.policyVersion !== opaResult.policyVersion ||
      !sameStringSet(uniqueStrings(item.relatedClauseIds, `${label} record ${index}.relatedClauseIds`), policyCase.relatedClauseIds) ||
      !sameStringSet(uniqueStrings(item.relatedRuleIds, `${label} record ${index}.relatedRuleIds`), policyCase.relatedRuleIds)
    ) {
      throw new Error(`${label} record ${caseId} does not match its case and OPA evidence.`);
    }
    if (
      actual !== null &&
      (
        !isDecision(actual.decision) ||
        !(actual.matchedRuleId === null || typeof actual.matchedRuleId === "string") ||
        typeof actual.explanation !== "string" ||
        actual.explanation.trim().length === 0
      )
    ) {
      throw new Error(`${label} record ${caseId} has an invalid application result.`);
    }
    const expectedStatus = actual === null ? "ERROR" : actual.decision === expected.decision ? "MATCH" : "DRIFT";
    if (item.status !== expectedStatus || (expectedStatus === "ERROR" && typeof item.error !== "string")) {
      throw new Error(`${label} record ${caseId} has an invalid derived status.`);
    }
    const defectIds = uniqueStrings(item.defectIds, `${label} record ${index}.defectIds`);
    if (expectedStatus === "MATCH" && defectIds.length > 0) {
      throw new Error(`${label} record ${caseId} reports a defect for a matching result.`);
    }
    for (const defectId of defectIds) {
      defectWitnesses.set(defectId, [...(defectWitnesses.get(defectId) ?? []), caseId]);
    }
    recordMap.set(caseId, item);
  }
  if (recordMap.size !== cases.length || [...casesById.keys()].some((caseId) => !recordMap.has(caseId))) {
    throw new Error(`${label} does not cover the complete accepted corpus.`);
  }
  if (!Array.isArray(value.defectClusters)) {
    throw new Error(`${label} defectClusters must be an array.`);
  }
  const clusterIds = new Set<string>();
  for (const [index, raw] of value.defectClusters.entries()) {
    const cluster = record(raw, `${label} defect cluster ${index}`);
    exactKeys(cluster, ["defectId", "recordCount", "witnessCaseIds"], `${label} defect cluster ${index}`);
    const defectId = nonEmptyString(cluster.defectId, `${label} defect cluster ${index}.defectId`);
    const witnesses = uniqueStrings(cluster.witnessCaseIds, `${label} defect cluster ${index}.witnessCaseIds`);
    if (
      clusterIds.has(defectId) ||
      cluster.recordCount !== witnesses.length ||
      !sameStringSet(witnesses, defectWitnesses.get(defectId) ?? [])
    ) {
      throw new Error(`${label} defect cluster ${defectId} is inconsistent.`);
    }
    clusterIds.add(defectId);
  }
  if (clusterIds.size !== defectWitnesses.size || [...defectWitnesses.keys()].some((id) => !clusterIds.has(id))) {
    throw new Error(`${label} omits one or more derived defect clusters.`);
  }
  return recordMap;
}

function validateLiveAttestation(
  manifest: EvidenceManifest,
  runMetadata: Record<string, unknown>,
  verificationCreatedAt: string,
  options: EvidenceValidationOptions,
): void {
  const attestation = manifest.liveAttestation;
  if (attestation === null) {
    throw new Error("LIVE_VERIFIED evidence requires a trusted live attestation.");
  }
  if (
    attestation.evidenceHash !== manifest.evidenceHash ||
    attestation.runId !== runMetadata.runId ||
    attestation.issuedAt !== verificationCreatedAt
  ) {
    throw new Error("Live attestation is not bound to this evidence run and hash.");
  }
  const now = options.now ?? new Date();
  const issuedAt = Date.parse(attestation.issuedAt);
  const maxFutureSkewMs = options.maxFutureSkewMs ?? MAX_FUTURE_SKEW_MS;
  const maxAttestationAgeMs = options.maxAttestationAgeMs ?? MAX_ATTESTATION_AGE_MS;
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(maxFutureSkewMs) ||
    maxFutureSkewMs < 0 ||
    !Number.isSafeInteger(maxAttestationAgeMs) ||
    maxAttestationAgeMs <= 0
  ) {
    throw new Error("Live attestation time policy is invalid.");
  }
  if (issuedAt > now.getTime() + maxFutureSkewMs) {
    throw new Error("Live attestation timestamp is in the future.");
  }
  if (now.getTime() - issuedAt > maxAttestationAgeMs) {
    throw new Error("Live attestation is stale and must be refreshed.");
  }
  const keys = options.trustedLiveAttestationKeys;
  const publicKeyPem =
    keys && Object.hasOwn(keys, attestation.keyId) ? keys[attestation.keyId] : undefined;
  if (typeof publicKeyPem !== "string" || publicKeyPem.length === 0) {
    throw new Error("Live attestation key is not trusted by this verifier.");
  }
  let verified = false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw new Error("Trusted live attestation key must be Ed25519.");
    }
    verified = verifySignature(
      null,
      Buffer.from(liveEvidenceAttestationMessage(attestation.evidenceHash, attestation.runId, attestation.issuedAt), "utf8"),
      publicKey,
      Buffer.from(attestation.signature, "base64url"),
    );
  } catch (error) {
    throw new Error(`Live attestation verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!verified) {
    throw new Error("Live attestation signature is invalid.");
  }
}

interface ValidatedFixtureTree {
  treeSha256: string;
  files: ReadonlyMap<string, string>;
}

function validateFixtureTreeReceipt(
  files: ReadonlyMap<string, string>,
  name: "fixture-tree-before.json" | "fixture-tree-after.json",
  runId: string,
): ValidatedFixtureTree {
  const receipt = parseJson(files, name);
  exactKeys(
    receipt,
    ["schemaVersion", "status", "runId", "fixtureId", "treeSha256", "files"],
    name,
  );
  if (
    receipt.schemaVersion !== "1" ||
    receipt.status !== "PASS" ||
    receipt.runId !== runId ||
    receipt.fixtureId !== "seeded-refund-demo" ||
    typeof receipt.treeSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(receipt.treeSha256) ||
    !Array.isArray(receipt.files) ||
    receipt.files.length === 0
  ) {
    throw new Error(`${name} metadata is invalid.`);
  }
  const treeHash = createHash("sha256");
  const fileHashes = new Map<string, string>();
  let previousPath = "";
  for (const [index, value] of receipt.files.entries()) {
    const item = record(value, `${name} file ${index}`);
    exactKeys(item, ["path", "bytes", "sha256", "contentBase64"], `${name} file ${index}`);
    const path = assertSafeRelativePath(item.path, `${name} file ${index}.path`);
    const contentBase64 = nonEmptyString(item.contentBase64, `${name} file ${index}.contentBase64`);
    const content = Buffer.from(contentBase64, "base64");
    if (
      path.localeCompare(previousPath) <= 0 ||
      fileHashes.has(path) ||
      content.toString("base64") !== contentBase64 ||
      item.bytes !== content.byteLength ||
      item.sha256 !== createHash("sha256").update(content).digest("hex")
    ) {
      throw new Error(`${name} file ${path} is not a canonical content receipt.`);
    }
    previousPath = path;
    fileHashes.set(path, item.sha256 as string);
    treeHash.update(path, "utf8");
    treeHash.update("\0", "utf8");
    treeHash.update(content);
    treeHash.update("\0", "utf8");
  }
  const treeSha256 = treeHash.digest("hex");
  if (treeSha256 !== receipt.treeSha256) {
    throw new Error(`${name} tree hash does not match its file contents.`);
  }
  return { treeSha256, files: fileHashes };
}

function validateCodexCommandReceipts(
  files: ReadonlyMap<string, string>,
  commands: readonly ReturnType<typeof parseCommandEvidence>[],
  runId: string,
  fixtureTreeSha256: string,
  hashText: TextHasher,
): void {
  const receipt = parseJson(files, "codex-command-receipts.json");
  exactKeys(
    receipt,
    ["schemaVersion", "status", "executionMode", "runId", "fixtureTreeSha256", "commands"],
    "Codex command receipts",
  );
  if (
    receipt.schemaVersion !== "1" ||
    receipt.status !== "PASS" ||
    receipt.executionMode !== "LIVE_CODEX_SDK" ||
    receipt.runId !== runId ||
    receipt.fixtureTreeSha256 !== fixtureTreeSha256 ||
    !Array.isArray(receipt.commands)
  ) {
    throw new Error("Codex command receipt metadata is invalid.");
  }
  const expected = commands.map((command) => ({
    commandId: command.commandId,
    evidenceSha256: hashText(JSON.stringify(canonicalValue(command))),
  }));
  if (!sameJson(receipt.commands, expected)) {
    throw new Error("Codex command receipts do not hash the embedded command output evidence.");
  }
}

function validateExternalProofs(
  files: ReadonlyMap<string, string>,
  externalGates: Record<string, unknown>,
  runId: string,
  policy: ReturnType<typeof parsePolicyIR>,
  policyIrContent: string,
  opa: Record<string, unknown>,
  hashText: TextHasher,
): void {
  const gpt = parseJson(files, "gpt-run-summary.json");
  exactKeys(gpt, ["schemaVersion", "status", "executionMode", "runId", "model", "responseId", "policyIrSha256"], "GPT run summary");
  const policyMetadata = record(policy.metadata, "PolicyIR metadata");
  if (
    externalGates.gpt56 !== "PASS" ||
    gpt.schemaVersion !== "1" ||
    gpt.status !== "PASS" ||
    gpt.executionMode !== "RESPONSES_API" ||
    gpt.runId !== runId ||
    gpt.model !== policyMetadata.model ||
    gpt.responseId !== policyMetadata.requestId ||
    gpt.policyIrSha256 !== hashText(policyIrContent) ||
    policyMetadata.source !== "LIVE_RESPONSE" ||
    typeof policyMetadata.requestId !== "string" ||
    !/^resp_[A-Za-z0-9_-]+$/u.test(policyMetadata.requestId) ||
    typeof policyMetadata.model !== "string" ||
    !/^gpt-5\.6(?:$|[-.])/u.test(policyMetadata.model)
  ) {
    throw new Error("GPT-5.6 PASS lacks a matching live Responses API proof.");
  }

  const browser = parseJson(files, "browser-run-summary.json");
  exactKeys(browser, ["schemaVersion", "status", "executionMode", "runId", "targetUrl", "command", "exitCode", "passed", "total", "reportSha256", "screenshotSha256s"], "browser run summary");
  const screenshotHashes = uniqueStrings(browser.screenshotSha256s, "browser screenshotSha256s");
  if (
    externalGates.browser !== "PASS" ||
    browser.schemaVersion !== "1" ||
    browser.status !== "PASS" ||
    browser.executionMode !== "PLAYWRIGHT" ||
    browser.runId !== runId ||
    typeof browser.targetUrl !== "string" ||
    !/^https?:\/\//u.test(browser.targetUrl) ||
    browser.command !== "pnpm test:e2e" ||
    browser.exitCode !== 0 ||
    !Number.isSafeInteger(browser.total) ||
    (browser.total as number) <= 0 ||
    browser.passed !== browser.total ||
    typeof browser.reportSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(browser.reportSha256) ||
    screenshotHashes.length === 0 ||
    screenshotHashes.some((digest) => !/^[0-9a-f]{64}$/u.test(digest))
  ) {
    throw new Error("Browser PASS lacks complete Playwright evidence.");
  }
  const browserDetails = parseJson(files, "browser-run-details.json");
  exactKeys(
    browserDetails,
    ["schemaVersion", "status", "runId", "targetUrl", "report", "screenshots"],
    "browser run details",
  );
  const browserReport = record(browserDetails.report, "browser report payload");
  exactKeys(browserReport, ["schemaVersion", "tests"], "browser report payload");
  if (!Array.isArray(browserReport.tests) || !Array.isArray(browserDetails.screenshots)) {
    throw new Error("Browser report payload is incomplete.");
  }
  const browserTestTitles = new Set<string>();
  for (const [index, value] of browserReport.tests.entries()) {
    const browserTest = record(value, `browser test ${index}`);
    exactKeys(browserTest, ["title", "status", "durationMs"], `browser test ${index}`);
    const title = nonEmptyString(browserTest.title, `browser test ${index}.title`);
    if (
      browserTestTitles.has(title) ||
      browserTest.status !== "PASSED" ||
      !Number.isSafeInteger(browserTest.durationMs) ||
      (browserTest.durationMs as number) < 0
    ) {
      throw new Error(`Browser test ${index} is duplicated or unsuccessful.`);
    }
    browserTestTitles.add(title);
  }
  const derivedScreenshotHashes: string[] = [];
  const screenshotNames = new Set<string>();
  for (const [index, value] of browserDetails.screenshots.entries()) {
    const screenshot = record(value, `browser screenshot ${index}`);
    exactKeys(screenshot, ["name", "pngBase64"], `browser screenshot ${index}`);
    const name = assertSafeRelativePath(screenshot.name, `browser screenshot ${index}.name`);
    const pngBase64 = nonEmptyString(screenshot.pngBase64, `browser screenshot ${index}.pngBase64`);
    const png = Buffer.from(pngBase64, "base64");
    if (
      screenshotNames.has(name) ||
      png.toString("base64") !== pngBase64 ||
      png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    ) {
      throw new Error(`Browser screenshot ${name} is not a canonical PNG receipt.`);
    }
    screenshotNames.add(name);
    derivedScreenshotHashes.push(createHash("sha256").update(png).digest("hex"));
  }
  if (
    browserDetails.schemaVersion !== "1" ||
    browserDetails.status !== "PASS" ||
    browserDetails.runId !== runId ||
    browserDetails.targetUrl !== browser.targetUrl ||
    browserReport.schemaVersion !== "1" ||
    browserReport.tests.length !== browser.total ||
    browser.reportSha256 !== hashText(JSON.stringify(canonicalValue(browserReport))) ||
    !sameStringSet(derivedScreenshotHashes, screenshotHashes)
  ) {
    throw new Error("Browser summary hashes are not derived from its report and PNG payloads.");
  }

  const container = parseJson(files, "container-run-summary.json");
  exactKeys(container, ["schemaVersion", "status", "executionMode", "runId", "imageDigest", "buildExitCode", "healthExitCode", "healthStatus", "platform", "opaVersion", "opaExecutableSha256", "buildLogSha256", "healthResponseSha256"], "container run summary");
  if (
    externalGates.container !== "PASS" ||
    container.schemaVersion !== "1" ||
    container.status !== "PASS" ||
    container.executionMode !== "DOCKER" ||
    container.runId !== runId ||
    typeof container.imageDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(container.imageDigest) ||
    container.buildExitCode !== 0 ||
    container.healthExitCode !== 0 ||
    container.healthStatus !== "PASS" ||
    container.platform !== TRUSTED_CONTAINER_OPA.platform ||
    container.opaVersion !== TRUSTED_CONTAINER_OPA.version ||
    container.opaVersion !== opa.opaVersion ||
    container.opaExecutableSha256 !== TRUSTED_CONTAINER_OPA.sha256 ||
    typeof container.buildLogSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(container.buildLogSha256) ||
    typeof container.healthResponseSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(container.healthResponseSha256)
  ) {
    throw new Error("Container PASS lacks an image digest and successful health evidence.");
  }
  const containerDetails = parseJson(files, "container-run-details.json");
  exactKeys(
    containerDetails,
    ["schemaVersion", "status", "runId", "buildLog", "healthResponse"],
    "container run details",
  );
  const buildLog = nonEmptyString(containerDetails.buildLog, "container build log");
  const healthResponse = nonEmptyString(containerDetails.healthResponse, "container health response");
  let healthPayload: Record<string, unknown>;
  try {
    healthPayload = record(JSON.parse(healthResponse), "container health response payload");
  } catch (error) {
    throw new Error(`Container health response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    containerDetails.schemaVersion !== "1" ||
    containerDetails.status !== "PASS" ||
    containerDetails.runId !== runId ||
    container.buildLogSha256 !== hashText(buildLog) ||
    container.healthResponseSha256 !== hashText(healthResponse) ||
    healthPayload.status !== "ok" ||
    healthPayload.service !== "policytwin" ||
    healthPayload.schemaVersion !== "1"
  ) {
    throw new Error("Container summary hashes are not derived from build and health payloads.");
  }

  const deployment = parseJson(files, "deployment-run-summary.json");
  exactKeys(deployment, ["schemaVersion", "status", "executionMode", "runId", "url", "healthUrl", "checkedAt", "statusCode", "responseSha256"], "deployment run summary");
  if (
    externalGates.deployment !== "PASS" ||
    deployment.schemaVersion !== "1" ||
    deployment.status !== "PASS" ||
    deployment.executionMode !== "HTTPS_HEALTH_CHECK" ||
    deployment.runId !== runId ||
    typeof deployment.url !== "string" ||
    typeof deployment.healthUrl !== "string" ||
    !/^https:\/\//u.test(deployment.url) ||
    !deployment.healthUrl.startsWith(`${deployment.url.replace(/\/$/u, "")}/`) ||
    deployment.statusCode !== 200 ||
    typeof deployment.responseSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(deployment.responseSha256) ||
    browser.targetUrl !== deployment.url
  ) {
    throw new Error("Deployment PASS lacks matching HTTPS health and browser evidence.");
  }
  canonicalIso(deployment.checkedAt, "deployment checkedAt");
  const deploymentDetails = parseJson(files, "deployment-health-response.json");
  exactKeys(
    deploymentDetails,
    ["schemaVersion", "status", "runId", "url", "checkedAt", "statusCode", "anonymousAccess", "headers", "body"],
    "deployment health response",
  );
  const deploymentHeaders = record(deploymentDetails.headers, "deployment health headers");
  if (Object.values(deploymentHeaders).some((value) => typeof value !== "string")) {
    throw new Error("Deployment health headers must contain only string values.");
  }
  const deploymentBody = nonEmptyString(deploymentDetails.body, "deployment health body");
  let deploymentPayload: Record<string, unknown>;
  try {
    deploymentPayload = record(JSON.parse(deploymentBody), "deployment health body payload");
  } catch (error) {
    throw new Error(`Deployment health body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    deploymentDetails.schemaVersion !== "1" ||
    deploymentDetails.status !== "PASS" ||
    deploymentDetails.runId !== runId ||
    deploymentDetails.url !== deployment.healthUrl ||
    deploymentDetails.checkedAt !== deployment.checkedAt ||
    deploymentDetails.statusCode !== 200 ||
    deploymentDetails.anonymousAccess !== true ||
    deployment.responseSha256 !== hashText(deploymentBody) ||
    deploymentPayload.status !== "ok" ||
    deploymentPayload.service !== "policytwin" ||
    deploymentPayload.schemaVersion !== "1"
  ) {
    throw new Error("Deployment summary hash is not derived from an anonymous health response.");
  }
}

function validateCommandLog(commandLog: Record<string, unknown>, runId: string): void {
  exactKeys(commandLog, ["schemaVersion", "status", "runId", "commands", "reason"], "test command log");
  if (commandLog.schemaVersion !== "1" || commandLog.status !== "PASS" || commandLog.runId !== runId || !Array.isArray(commandLog.commands)) {
    throw new Error("Test command log metadata is invalid.");
  }
  const commands = new Set<string>();
  for (const [index, value] of commandLog.commands.entries()) {
    const item = record(value, `test command ${index}`);
    exactKeys(item, ["command", "exitCode", "startedAt", "completedAt", "outputSha256"], `test command ${index}`);
    const command = nonEmptyString(item.command, `test command ${index}.command`);
    if (
      commands.has(command) ||
      item.exitCode !== 0 ||
      typeof item.outputSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(item.outputSha256)
    ) {
      throw new Error(`Test command ${command} is invalid or unsuccessful.`);
    }
    const startedAt = canonicalIso(item.startedAt, `test command ${index}.startedAt`);
    const completedAt = canonicalIso(item.completedAt, `test command ${index}.completedAt`);
    if (Date.parse(completedAt) < Date.parse(startedAt)) {
      throw new Error(`Test command ${command} completed before it started.`);
    }
    commands.add(command);
  }
  const missing = REQUIRED_LIVE_COMMANDS.filter((command) => !commands.has(command));
  if (missing.length > 0) {
    throw new Error(`Test command log is missing required commands: ${missing.join(", ")}`);
  }
}

function validateSecurityProof(
  files: ReadonlyMap<string, string>,
  securitySummary: Record<string, unknown>,
  runId: string,
): void {
  const security = parseJson(files, "security-report.json");
  exactKeys(security, ["schemaVersion", "status", "scope", "runId", "critical", "high", "findings", "commands"], "security report");
  if (
    security.schemaVersion !== "1" ||
    security.status !== "PASS" ||
    security.scope !== "RELEASE_REVIEW" ||
    security.runId !== runId ||
    security.critical !== 0 ||
    security.high !== 0 ||
    securitySummary.critical !== 0 ||
    securitySummary.high !== 0 ||
    securitySummary.status !== "PASS" ||
    !Array.isArray(security.findings) ||
    !Array.isArray(security.commands)
  ) {
    throw new Error("Security PASS lacks a matching structured release review.");
  }
  for (const [index, value] of security.findings.entries()) {
    const finding = record(value, `security finding ${index}`);
    exactKeys(finding, ["id", "severity", "title", "artifact"], `security finding ${index}`);
    if (!["LOW", "MEDIUM"].includes(finding.severity as string)) {
      throw new Error("Security report contains an unresolved high or critical finding.");
    }
    nonEmptyString(finding.id, `security finding ${index}.id`);
    nonEmptyString(finding.title, `security finding ${index}.title`);
    nonEmptyString(finding.artifact, `security finding ${index}.artifact`);
  }
  const securityCommands = uniqueStrings(security.commands, "security commands");
  if (!securityCommands.includes("pnpm security:check") || !securityCommands.includes("pnpm license:check")) {
    throw new Error("Security report omits required security and license checks.");
  }
  const review = files.get("security-review.md") as string;
  if (!review.includes("Status: PASS") || !review.includes(`Run ID: ${runId}`) || review.includes("NOT_RUN")) {
    throw new Error("Human security review does not match the structured release review.");
  }
}

function validateScorecard(
  scorecard: Record<string, unknown>,
  runId: string,
  caseCount: number,
  beforeDrifts: number,
  mutationKillRate: number,
): void {
  exactKeys(scorecard, ["schemaVersion", "status", "evidenceMode", "runId", "metrics"], "eval scorecard");
  if (scorecard.schemaVersion !== "1" || scorecard.status !== "PASS" || scorecard.evidenceMode !== "LIVE_VERIFIED" || scorecard.runId !== runId) {
    throw new Error("Live eval scorecard metadata is invalid.");
  }
  const metrics = record(scorecard.metrics, "eval scorecard metrics");
  const expected = {
    structuredOutputSchemaPass: 1,
    seededDriftBugsDetected: Math.min(beforeDrifts, 3),
    acceptedCorpusSize: caseCount,
    postRepairDrift: 0,
    opaCaseAgreement: caseCount,
    mutationKillRate,
    ruleClauseTraceability: 1,
    securityFindings: 0,
    browserHappyPath: 1,
  } as const;
  for (const [name, expectedValue] of Object.entries(expected)) {
    const metric = record(metrics[name], `eval scorecard metric ${name}`);
    if (metric.value !== expectedValue || typeof metric.status !== "string" || !metric.status.startsWith("PASS")) {
      throw new Error(`Eval scorecard metric ${name} does not match its source evidence.`);
    }
  }
}

export function validateEvidencePackage(
  files: ReadonlyMap<string, string>,
  hashText: TextHasher,
  options: EvidenceValidationOptions = {},
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
  if (manifest.entries.some((entry) => !entry.includedInEvidenceHash)) {
    throw new Error("Every evidence payload must contribute to the aggregate hash.");
  }
  if (computeEvidencePackageHash(files, manifest.entries, hashText) !== manifest.evidenceHash) {
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
    verification.evidenceMode !== manifest.evidenceMode ||
    verification.evidenceHash !== manifest.evidenceHash
  ) {
    throw new Error("Verification summary metadata is invalid.");
  }
  const createdAt = canonicalIso(verification.createdAt, "verification createdAt");
  const runMetadata = parseJson(files, "run-metadata.json");
  exactKeys(
    runMetadata,
    [
      "schemaVersion",
      "evidenceMode",
      "generatedAt",
      "policyVersion",
      "recordedInterpreter",
      "freshExternalWork",
      "runId",
      "fixtureBeforeSha256",
      "fixtureAfterSha256",
      "integrationDiffSha256",
    ],
    "run metadata",
  );
  if (
    runMetadata.schemaVersion !== "1" ||
    runMetadata.evidenceMode !== manifest.evidenceMode ||
    runMetadata.generatedAt !== createdAt ||
    typeof runMetadata.recordedInterpreter !== "boolean" ||
    typeof runMetadata.freshExternalWork !== "boolean"
  ) {
    throw new Error("Run metadata is inconsistent with the verification summary.");
  }

  const policyIrContent = files.get("policy-ir.json") as string;
  const policy = parsePolicyIR(JSON.parse(policyIrContent));
  if (verification.policyVersion !== policy.version || runMetadata.policyVersion !== policy.version) {
    throw new Error("Policy version is inconsistent across the evidence package.");
  }
  const promptManifest = parseJson(files, "prompt-manifest.json");
  exactKeys(promptManifest, ["schemaVersion", "prompts"], "prompt manifest");
  if (promptManifest.schemaVersion !== "1" || !Array.isArray(promptManifest.prompts)) {
    throw new Error("Prompt manifest metadata is invalid.");
  }
  const promptFiles = new Set<string>();
  for (const [index, value] of promptManifest.prompts.entries()) {
    const entry = record(value, `prompt manifest entry ${index}`);
    exactKeys(entry, ["file", "sha256"], `prompt manifest entry ${index}`);
    const file = nonEmptyString(entry.file, `prompt manifest entry ${index}.file`);
    if (
      promptFiles.has(file) ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`Prompt manifest entry ${index} is invalid or duplicated.`);
    }
    promptFiles.add(file);
  }
  for (const file of [
    `prompts/${policy.metadata.promptVersion}.md`,
    "prompts/cartographer.v1.md",
    "prompts/repair.v1.md",
    "prompts/reviewer.v1.md",
  ]) {
    if (!promptFiles.has(file)) {
      throw new Error(`Prompt manifest is missing the required prompt: ${file}`);
    }
  }
  const goldenCases = parseEvidenceCases(parseJsonArray(files, "golden-cases.json"), "golden cases", "GOLDEN", policy);
  const generatedCases = parseEvidenceCases(parseJsonArray(files, "generated-cases.json"), "generated cases", "GENERATED", policy);
  const cases = [...goldenCases, ...generatedCases];
  if (
    goldenCases.length === 0 ||
    generatedCases.length === 0 ||
    cases.length < ACCEPTED_CASE_MINIMUM ||
    new Set(cases.map((policyCase) => policyCase.id)).size !== cases.length
  ) {
    throw new Error("Accepted evidence corpus is empty, undersized, or contains duplicate IDs.");
  }
  const acceptedCaseIds = new Set(cases.map((policyCase) => policyCase.id));

  const compiledPolicy = files.get("compiled-policy.rego") as string;
  const compilerManifest = parseJson(files, "compiler-manifest.json");
  const expectedCompilation = compilePolicyToRego(policy);
  if (compiledPolicy !== expectedCompilation.source || !sameJson(compilerManifest, expectedCompilation.manifest)) {
    throw new Error("Compiled Rego or compiler manifest is not the deterministic output of PolicyIR.");
  }
  const opa = parseJson(files, "opa-results.json");
  const opaResults = validateOpaEvidence(
    opa,
    policy,
    cases,
    compiledPolicy,
    compilerManifest,
    hashText,
    options.trustedOpaExecutables ?? DEFAULT_TRUSTED_OPA_EXECUTABLES,
  );

  const golden = record(verification.golden, "verification golden");
  const generated = record(verification.generated, "verification generated");
  for (const [label, metric, expectedTotal] of [
    ["golden", golden, goldenCases.length],
    ["generated", generated, generatedCases.length],
  ] as const) {
    exactKeys(metric, ["passed", "total", "executionMode"], `verification ${label}`);
    if (metric.passed !== expectedTotal || metric.total !== expectedTotal || metric.executionMode !== "OPA_CLI") {
      throw new Error(`Verification ${label} metric is inconsistent with OPA evidence.`);
    }
  }

  const externalGates = record(verification.externalGates, "verification externalGates");
  exactKeys(externalGates, ["gpt56", "opa", "codex", "browser", "container", "deployment"], "verification externalGates");
  if (Object.values(externalGates).some((value) => !["PASS", "FAIL", "NOT_RUN"].includes(value as string)) || externalGates.opa !== "PASS") {
    throw new Error("Verification external gate status is invalid or contradicts OPA evidence.");
  }

  const before = parseJson(files, "drift-report-before.json");
  const appBefore = parseJson(files, "app-results-before.json");
  const beforeRecords = validateDifferentialReport(before, "Pre-repair drift report", cases, opaResults);
  validateDifferentialReport(appBefore, "Pre-repair application results", cases, opaResults);
  if (!sameJson(before, appBefore) || verification.driftBefore !== before.drifts) {
    throw new Error("Pre-repair differential artifacts disagree.");
  }
  for (const [caseId, defectId] of [
    ["D01", "DAY_14_INCLUSIVE"],
    ["D02", "USAGE_2000_INCLUSIVE"],
    ["D03", "FINAL_SALE_PRECEDENCE"],
  ] as const) {
    const witness = beforeRecords.get(caseId);
    if (witness?.status !== "DRIFT" || !Array.isArray(witness.defectIds) || !witness.defectIds.includes(defectId)) {
      throw new Error(`Seeded defect witness ${caseId}/${defectId} is missing.`);
    }
  }

  const mutation = record(verification.mutation, "verification mutation");
  const mutationArtifact = parseJson(files, "mutation-report.json");
  validateMutationReport(mutationArtifact, mutation, acceptedCaseIds, policy, cases);
  const mutationRunSummary = validateMutationRunSummary(
    files,
    policy,
    cases,
    mutationArtifact,
    hashText,
  );

  const traceability = record(verification.traceability, "verification traceability");
  exactKeys(traceability, ["clausesCovered", "clausesTotal", "rulesCovered", "rulesTotal", "unlinkedCodeLocations"], "verification traceability");
  const traceabilityArtifact = parseJson(files, "traceability.json");
  if (!Array.isArray(traceabilityArtifact.codeLocations)) {
    throw new Error("Traceability codeLocations must be an array.");
  }
  if (!sameJson(traceabilityArtifact.codeLocations, SEEDED_REFUND_CODE_MAPPINGS)) {
    throw new Error("Traceability code locations do not match the bundled trusted fixture mapping.");
  }
  const expectedTraceability = buildTraceabilityReport(
    policy,
    cases,
    traceabilityArtifact.codeLocations as unknown as readonly CodeMapping[],
  );
  if (!sameJson(traceabilityArtifact, expectedTraceability)) {
    throw new Error("Traceability report is not derivable from PolicyIR, cases, and code mappings.");
  }
  for (const field of ["clausesCovered", "clausesTotal", "rulesCovered", "rulesTotal", "unlinkedCodeLocations"] as const) {
    if (traceability[field] !== expectedTraceability.metrics[field]) {
      throw new Error(`Verification traceability ${field} does not match traceability.json.`);
    }
  }
  const traceabilityComplete =
    expectedTraceability.metrics.clausesTotal > 0 &&
    expectedTraceability.metrics.rulesTotal > 0 &&
    expectedTraceability.metrics.casesTotal === cases.length &&
    expectedTraceability.metrics.clausesCovered === expectedTraceability.metrics.clausesTotal &&
    expectedTraceability.metrics.rulesCovered === expectedTraceability.metrics.rulesTotal &&
    expectedTraceability.metrics.casesLinked === expectedTraceability.metrics.casesTotal &&
    expectedTraceability.metrics.unlinkedCodeLocations === 0 &&
    expectedTraceability.codeLocations.length > 0 &&
    Object.values(expectedTraceability.gaps).every((items) => items.length === 0);

  const regression = record(verification.regression, "verification regression");
  exactKeys(regression, ["passed", "total", "status"], "verification regression");
  const securitySummary = record(verification.security, "verification security");
  exactKeys(securitySummary, ["critical", "high", "status"], "verification security");

  if (manifest.evidenceMode === "LIVE_VERIFIED") {
    validateLiveAttestation(manifest, runMetadata, createdAt, options);
  } else if (manifest.liveAttestation !== null) {
    throw new Error("Partial offline evidence must not carry a live attestation.");
  }

  let liveArtifactsComplete = false;
  if (verification.status === "PASS") {
    if (manifest.evidenceMode !== "LIVE_VERIFIED" || runMetadata.recordedInterpreter !== false || runMetadata.freshExternalWork !== true) {
      throw new Error("PASS requires fresh live run metadata.");
    }
    const runId = nonEmptyString(runMetadata.runId, "live run ID");
    if (!/^[A-Za-z0-9._-]{16,128}$/u.test(runId)) {
      throw new Error("Live run ID is invalid.");
    }
    if (Object.values(externalGates).some((value) => value !== "PASS")) {
      throw new Error("PASS requires every external gate to pass.");
    }
    validateExternalProofs(files, externalGates, runId, policy, policyIrContent, opa, hashText);
    const mutationOpaResultIds = (mutationRunSummary.opaResultHashes as Array<Record<string, unknown>>)
      .map((item) => item.mutantId as string);
    const mutationResultIds = (mutationArtifact.results as Array<Record<string, unknown>>)
      .map((item) => item.mutantId as string);
    if (
      mutation.executionMode !== "OPA_CLI" ||
      mutationRunSummary.status !== "PASS" ||
      mutationRunSummary.executionMode !== "OPA_CLI" ||
      mutationRunSummary.runId !== runId ||
      mutationRunSummary.opaVersion !== opa.opaVersion ||
      mutationRunSummary.executableSha256 !== opa.executableSha256 ||
      !sameStringSet(mutationOpaResultIds, mutationResultIds)
    ) {
      throw new Error("Mutation PASS lacks complete OPA CLI execution receipts.");
    }
    validateMutationOpaResults(
      files,
      runId,
      policy,
      cases,
      mutationArtifact,
      mutationRunSummary,
      hashText,
    );

    const after = parseJson(files, "drift-report-after.json");
    const appAfter = parseJson(files, "app-results-after.json");
    validateDifferentialReport(after, "Post-repair drift report", cases, opaResults);
    validateDifferentialReport(appAfter, "Post-repair application results", cases, opaResults);
    if (
      !sameJson(after, appAfter) ||
      after.executionMode !== "OPA_EXPECTATION" ||
      after.total !== cases.length ||
      after.matches !== cases.length ||
      after.drifts !== 0 ||
      after.errors !== 0 ||
      verification.driftAfter !== 0
    ) {
      throw new Error("Post-repair evidence does not prove zero drift across the accepted corpus.");
    }

    const codex = parseJson(files, "codex-run-summary.json");
    exactKeys(codex, ["schemaVersion", "executionMode", "status", "attempts", "cartography", "repairAttempts", "commandEvidence", "review", "failure"], "Codex run summary");
    if (
      codex.schemaVersion !== "1" ||
      codex.executionMode !== "LIVE_CODEX_SDK" ||
      codex.status !== "PASS" ||
      !Number.isSafeInteger(codex.attempts) ||
      (codex.attempts as number) < 1 ||
      (codex.attempts as number) > 2 ||
      codex.failure !== null ||
      !Array.isArray(codex.repairAttempts) ||
      !Array.isArray(codex.commandEvidence)
    ) {
      throw new Error("Codex PASS summary is incomplete.");
    }
    const cartography = parseCartographyResult(codex.cartography, "LIVE_CODEX_SDK");
    const repairs = codex.repairAttempts.map((value) => parseRepairResult(value, "LIVE_CODEX_SDK"));
    const commands = codex.commandEvidence.map((value) => parseCommandEvidence(value));
    const review = parseReviewResult(codex.review, "LIVE_CODEX_SDK");
    const commandIds = commands.map((command) => command.commandId);
    const workerRunIds = [
      cartography.metadata.runId,
      ...repairs.map((repair) => repair.metadata.runId),
      review.metadata.runId,
    ];
    const proposedFiles = new Set(cartography.proposedFilesToChange);
    if (
      repairs.length !== codex.attempts ||
      commands.length !== 2 ||
      new Set(commandIds).size !== 2 ||
      !commandIds.includes("fixture-typecheck") ||
      !commandIds.includes("fixture-test") ||
      commands.some((command) => command.exitCode !== 0 || command.timedOut) ||
      review.verdict !== "APPROVE" ||
      review.metadata.backendId !== cartography.metadata.backendId ||
      repairs.some((repair) => repair.metadata.backendId !== cartography.metadata.backendId) ||
      new Set(workerRunIds).size !== workerRunIds.length ||
      repairs.some((repair) => repair.changedFiles.some((file) => !proposedFiles.has(file))) ||
      !sameJson(parseJson(files, "codex-cartography.json"), cartography) ||
      !sameJson(parseJson(files, "codex-review.json"), review) ||
      externalGates.codex !== "PASS"
    ) {
      throw new Error("Codex phase, command, and independent review evidence is inconsistent.");
    }
    const diff = files.get("integration.diff") as string;
    const diffHeaders = [...diff.matchAll(/^diff --git a\/([^\r\n]+) b\/([^\r\n]+)$/gmu)];
    const diffFiles = diffHeaders.map((match) => match[2] as string);
    const changedFiles = [...new Set(repairs.flatMap((repair) => repair.changedFiles))];
    if (
      diffHeaders.length === 0 ||
      diffHeaders.some((match) => match[1] !== match[2]) ||
      new Set(diffFiles).size !== diffFiles.length ||
      !sameStringSet(diffFiles, changedFiles) ||
      !diff.includes("@@") ||
      diff.includes("NOT_RUN") ||
      /[A-Za-z]:\\Users\\|\/(?:home|Users)\//u.test(diff)
    ) {
      throw new Error("Codex integration diff is missing, unsafe, or inconsistent with changed files.");
    }
    const beforeTree = validateFixtureTreeReceipt(files, "fixture-tree-before.json", runId);
    const afterTree = validateFixtureTreeReceipt(files, "fixture-tree-after.json", runId);
    const treePaths = new Set([...beforeTree.files.keys(), ...afterTree.files.keys()]);
    const changedTreeFiles = [...treePaths].filter(
      (path) => beforeTree.files.get(path) !== afterTree.files.get(path),
    );
    if (
      beforeTree.treeSha256 !== TRUSTED_FIXTURE_BASELINE_SHA256 ||
      runMetadata.fixtureBeforeSha256 !== beforeTree.treeSha256 ||
      runMetadata.fixtureAfterSha256 !== afterTree.treeSha256 ||
      beforeTree.treeSha256 === afterTree.treeSha256 ||
      !sameStringSet(changedTreeFiles, diffFiles) ||
      runMetadata.integrationDiffSha256 !== hashText(diff) ||
      after.adapterId !== `seeded-refund-demo@${afterTree.treeSha256}`
    ) {
      throw new Error("Codex fixture and integration diff hashes are missing or inconsistent.");
    }
    validateCodexCommandReceipts(files, commands, runId, afterTree.treeSha256, hashText);
    const passedRegressionCommands = commands.filter((command) => command.exitCode === 0 && !command.timedOut).length;
    if (
      regression.status !== "PASS" ||
      regression.total !== commands.length ||
      regression.passed !== passedRegressionCommands ||
      commands.length <= 0
    ) {
      throw new Error("Regression summary does not match Codex command evidence.");
    }
    validateCommandLog(parseJson(files, "test-command-log.json"), runId);
    validateSecurityProof(files, securitySummary, runId);
    validateScorecard(parseJson(files, "eval-scorecard.json"), runId, cases.length, before.drifts as number, mutation.killRate as number);
    liveArtifactsComplete = true;
  }

  const canPass =
    liveArtifactsComplete &&
    mutation.executionMode === "OPA_CLI" &&
    typeof mutation.killRate === "number" &&
    mutation.killRate >= 0.9 &&
    traceabilityComplete;
  if (verification.status === "PASS" && !canPass) {
    throw new Error("Verification summary claims PASS without complete external evidence.");
  }
  if (manifest.packageStatus !== verification.status) {
    throw new Error("Manifest and verification summary status disagree.");
  }
  if (manifest.evidenceMode === "PARTIAL_OFFLINE" && manifest.packageStatus !== "FAIL") {
    throw new Error("A partial offline package cannot pass verification.");
  }
  if (manifest.evidenceMode === "PARTIAL_OFFLINE") {
    const codex = parseJson(files, "codex-run-summary.json");
    const evaluationApp = parseJson(files, "app-results-after.json");
    validateDifferentialReport(
      evaluationApp,
      "Evaluation-only fixed fixture results",
      cases,
      opaResults,
    );
    const evaluationDrift = parseJson(files, "drift-report-after.json");
    const mutationOpaResults = parseJson(files, "mutation-opa-results.json");
    exactKeys(
      evaluationDrift,
      [
        "schemaVersion",
        "status",
        "evidenceBasis",
        "evaluationOnlyFixedFixtureDrifts",
        "evaluationOnlyFixedFixtureErrors",
      ],
      "evaluation-only drift summary",
    );
    if (
      codex.status !== "NOT_RUN_LIVE" ||
      mutation.executionMode !== "REFERENCE_EVALUATOR_NOT_OPA" ||
      mutationRunSummary.status !== "NOT_RUN_OPA" ||
      mutationRunSummary.executionMode !== "REFERENCE_EVALUATOR_NOT_OPA" ||
      mutationRunSummary.runId !== null ||
      mutationRunSummary.opaVersion !== null ||
      mutationRunSummary.executableSha256 !== null ||
      (mutationRunSummary.opaResultHashes as unknown[]).length !== 0 ||
      mutationOpaResults.schemaVersion !== "1" ||
      mutationOpaResults.status !== "NOT_RUN_OPA" ||
      mutationOpaResults.executionMode !== "REFERENCE_EVALUATOR_NOT_OPA" ||
      mutationOpaResults.runId !== null ||
      !Array.isArray(mutationOpaResults.results) ||
      mutationOpaResults.results.length !== 0 ||
      verification.driftAfter !== null ||
      evaluationApp.executionMode !== "REFERENCE_EXPECTATION_NOT_OPA" ||
      evaluationApp.evidenceBasis !== "EVALUATION_ONLY_FIXED_FIXTURE_NOT_CODEX_REPAIR" ||
      evaluationApp.total !== cases.length ||
      verification.evaluationOnlyFixedFixtureDrift !== evaluationApp.drifts ||
      evaluationDrift.schemaVersion !== "1" ||
      evaluationDrift.status !== "NOT_RUN_AFTER_CODEX" ||
      evaluationDrift.evidenceBasis !== "EVALUATION_ONLY_FIXED_FIXTURE_NOT_CODEX_REPAIR" ||
      evaluationDrift.evaluationOnlyFixedFixtureDrifts !== evaluationApp.drifts ||
      evaluationDrift.evaluationOnlyFixedFixtureErrors !== evaluationApp.errors ||
      runMetadata.runId !== null ||
      runMetadata.fixtureBeforeSha256 !== null ||
      runMetadata.fixtureAfterSha256 !== null ||
      runMetadata.integrationDiffSha256 !== null ||
      runMetadata.recordedInterpreter !== true ||
      runMetadata.freshExternalWork !== false
    ) {
      throw new Error("Partial offline evidence must not impersonate live external work.");
    }
    for (const [file, gate] of [
      ["gpt-run-summary.json", "gpt56"],
      ["browser-run-summary.json", "browser"],
      ["container-run-summary.json", "container"],
      ["deployment-run-summary.json", "deployment"],
    ] as const) {
      if (parseJson(files, file).status !== "NOT_RUN" || externalGates[gate] !== "NOT_RUN") {
        throw new Error(`Partial offline ${gate} evidence must remain NOT_RUN.`);
      }
    }
    for (const file of [
      "browser-run-details.json",
      "container-run-details.json",
      "deployment-health-response.json",
    ]) {
      if (parseJson(files, file).status !== "NOT_RUN") {
        throw new Error(`Partial offline ${file} must remain NOT_RUN.`);
      }
    }
    if (parseJson(files, "security-report.json").status !== "NOT_RUN" || securitySummary.status !== "NOT_RUN") {
      throw new Error("Partial offline security evidence must remain NOT_RUN.");
    }
    for (const file of ["codex-cartography.json", "codex-review.json"]) {
      const phase = parseJson(files, file);
      if (
        phase.status !== "NOT_RUN_LIVE" ||
        phase.executionMode !== "OFFLINE_TEST_DOUBLE" ||
        phase.liveCodexClaim !== false
      ) {
        throw new Error(`Partial offline ${file} must not claim live Codex execution.`);
      }
    }
    const commandReceipts = parseJson(files, "codex-command-receipts.json");
    if (
      commandReceipts.status !== "NOT_RUN_LIVE" ||
      commandReceipts.executionMode !== "OFFLINE_TEST_DOUBLE" ||
      commandReceipts.runId !== null ||
      commandReceipts.fixtureTreeSha256 !== null ||
      !Array.isArray(commandReceipts.commands) ||
      commandReceipts.commands.length !== 0
    ) {
      throw new Error("Partial offline Codex command receipts must remain NOT_RUN_LIVE.");
    }
    for (const file of ["fixture-tree-before.json", "fixture-tree-after.json"]) {
      const tree = parseJson(files, file);
      if (
        tree.status !== "NOT_RUN_LIVE" ||
        tree.runId !== null ||
        tree.fixtureId !== "seeded-refund-demo" ||
        tree.treeSha256 !== null ||
        !Array.isArray(tree.files) ||
        tree.files.length !== 0
      ) {
        throw new Error(`Partial offline ${file} must remain NOT_RUN_LIVE.`);
      }
    }
    if (
      codex.executionMode !== "OFFLINE_TEST_DOUBLE" ||
      codex.liveCodexClaim !== false ||
      !(files.get("integration.diff") as string).startsWith("# NOT_RUN_LIVE")
    ) {
      throw new Error("Partial offline Codex evidence must remain an explicit test double.");
    }
    if (!(files.get("security-review.md") as string).includes("Status: NOT_RUN")) {
      throw new Error("Partial offline human security review must remain NOT_RUN.");
    }
  }

  const humanSummary = files.get("summary.md") as string;
  if (
    !humanSummary.includes(`Status: ${manifest.packageStatus}`) ||
    !humanSummary.includes(`Evidence mode: ${manifest.evidenceMode}`) ||
    !humanSummary.includes(manifest.evidenceHash)
  ) {
    throw new Error("Human evidence summary does not match machine status and hash.");
  }
  return manifest;
}
