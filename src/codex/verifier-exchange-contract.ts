import { createHash, createHmac } from "node:crypto";
import type { CommandEvidence, PolicyVerificationEvidence } from "./types.js";
import { parseCommandEvidence, parsePolicyVerificationEvidence } from "./validate.js";
import {
  canonicalWorkerRpcJson,
  workerRpcSha256,
} from "./worker-rpc-contract.js";

export const VERIFIER_EXCHANGE_PROFILE = "policytwin.verifier.exchange.v1" as const;
export const VERIFIER_SNAPSHOT_AUTHORITY =
  "SUPERVISOR_REVALIDATED_LOCAL_SNAPSHOT_NOT_RUNTIME_IMMUTABILITY_PROOF" as const;

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REQUEST_ID = /^[0-9a-f]{32}$/u;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/u;
const TREE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[\\\0\r\n])(?:[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)*$/u;
const MAX_TREE_ENTRIES = 256;
const MAX_TREE_FILE_BYTES = 2 * 1024 * 1024;

export interface VerifierTreeEntry {
  path: string;
  kind: "directory" | "file";
  mode: number;
  bytes: number | null;
  sha256: string | null;
}

export interface VerifierTreeManifest {
  schemaVersion: "1";
  entries: VerifierTreeEntry[];
}

export interface SealedVerifierSnapshot {
  schemaVersion: "1";
  kind: "SEALED_VERIFIER_SNAPSHOT";
  authority: typeof VERIFIER_SNAPSHOT_AUTHORITY;
  requestId: string;
  requestSha256: string;
  inputSha256: string;
  policySha256: string;
  executionBindingSha256: string;
  attempt: 1 | 2;
  repairRunId: string;
  verifierImageDigest: string;
  acceptedCorpusSha256: string;
  policyIrSha256: string;
  sourceTreeManifest: VerifierTreeManifest;
  sourceTreeSha256: string;
  initialBuildTreeManifest: VerifierTreeManifest;
  initialBuildTreeSha256: string;
  initialExecutionTreeSha256: string;
  snapshotSha256: string;
  liveClaim: false;
  passSigningEligible: false;
  externalSettlementEligible: false;
}

export interface VerifierExchangeChallenge {
  schemaVersion: "1";
  kind: "VERIFIER_EXCHANGE_CHALLENGE";
  profile: typeof VERIFIER_EXCHANGE_PROFILE;
  challengeId: string;
  capabilitySha256: string;
  requestId: string;
  requestSha256: string;
  inputSha256: string;
  policySha256: string;
  executionBindingSha256: string;
  snapshotSha256: string;
  verifierImageDigest: string;
  attempt: 1 | 2;
  repairRunId: string;
  acceptedCorpusSha256: string;
  policyIrSha256: string;
  issuedAt: string;
  expiresAt: string;
  requestExpiresAt: string;
  challengeSha256: string;
}

export interface VerifierExchangeReceipt {
  schemaVersion: "1";
  kind: "VERIFIER_EXCHANGE_RECEIPT";
  profile: typeof VERIFIER_EXCHANGE_PROFILE;
  challengeId: string;
  capabilitySha256: string;
  requestId: string;
  requestSha256: string;
  inputSha256: string;
  policySha256: string;
  executionBindingSha256: string;
  snapshotSha256: string;
  verifierImageDigest: string;
  verifierRunId: string;
  attempt: 1 | 2;
  repairRunId: string;
  acceptedCorpusSha256: string;
  policyIrSha256: string;
  sourceTreeSha256: string;
  initialBuildTreeSha256: string;
  finalBuildTreeManifest: VerifierTreeManifest;
  finalBuildTreeSha256: string;
  finalExecutionTreeSha256: string;
  commandEvidence: [CommandEvidence, CommandEvidence];
  policyVerification: PolicyVerificationEvidence;
  status: "PASS" | "FAIL";
  startedAt: string;
  completedAt: string;
  receiptSha256: string;
  hmacSha256: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} contains unknown fields.`);
  }
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function imageDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error("Verifier image must be an immutable SHA-256 image ID.");
  }
  return value;
}

function canonicalIso(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function attempt(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) throw new Error("Verifier attempt is invalid.");
  return value;
}

export function parseVerifierTreeManifest(
  value: unknown,
  label = "verifier tree manifest",
): VerifierTreeManifest {
  const manifest = record(value, label);
  exactKeys(manifest, ["schemaVersion", "entries"], label);
  if (
    manifest.schemaVersion !== "1" ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length < 1 ||
    manifest.entries.length > MAX_TREE_ENTRIES
  ) {
    throw new Error(`${label} is incomplete or too large.`);
  }
  let totalBytes = 0;
  const entries = manifest.entries.map((item, index): VerifierTreeEntry => {
    const entry = record(item, `${label} entry ${index}`);
    exactKeys(entry, ["path", "kind", "mode", "bytes", "sha256"], `${label} entry ${index}`);
    if (typeof entry.path !== "string" || !TREE_PATH.test(entry.path)) {
      throw new Error(`${label} entry ${index} path is invalid.`);
    }
    if (
      (entry.kind !== "directory" && entry.kind !== "file") ||
      typeof entry.mode !== "number" ||
      !Number.isSafeInteger(entry.mode) ||
      entry.mode < 0 ||
      entry.mode > 0o7777
    ) {
      throw new Error(`${label} entry ${index} type or mode is invalid.`);
    }
    if (entry.kind === "directory") {
      if (entry.bytes !== null || entry.sha256 !== null) {
        throw new Error(`${label} directory entry ${index} has file fields.`);
      }
      return { path: entry.path, kind: "directory", mode: entry.mode, bytes: null, sha256: null };
    }
    if (
      typeof entry.bytes !== "number" ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > MAX_TREE_FILE_BYTES
    ) {
      throw new Error(`${label} file entry ${index} byte count is invalid.`);
    }
    totalBytes += entry.bytes;
    if (totalBytes > 8 * 1024 * 1024) throw new Error(`${label} is too large.`);
    return {
      path: entry.path,
      kind: "file",
      mode: entry.mode,
      bytes: entry.bytes,
      sha256: sha256(entry.sha256, `${label} file entry ${index} digest`),
    };
  });
  const paths = entries.map((entry) => entry.path);
  const sorted = [...paths].sort();
  if (paths.some((path, index) => path !== sorted[index]) || new Set(paths).size !== paths.length) {
    throw new Error(`${label} entries must be unique and bytewise sorted.`);
  }
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    const separator = entry.path.lastIndexOf("/");
    if (separator === -1) continue;
    const parent = entry.path.slice(0, separator);
    if (byPath.get(parent)?.kind !== "directory") {
      throw new Error(`${label} entry ${entry.path} lacks a directory parent.`);
    }
  }
  return { schemaVersion: "1", entries };
}

export function verifierTreeSha256(value: unknown): string {
  return workerRpcSha256(parseVerifierTreeManifest(value));
}

export function verifierFileSha256(value: Uint8Array): string {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_TREE_FILE_BYTES) {
    throw new Error("Verifier file content is invalid or too large.");
  }
  return workerRpcSha256({
    domain: "policytwin.verifier.file-bytes.v1",
    bytesBase64: Buffer.from(value).toString("base64"),
  });
}

export function verifierExecutionTreeSha256(
  sourceTreeSha256: string,
  buildTreeSha256: string,
): string {
  return workerRpcSha256({
    domain: "policytwin.verifier.execution-tree.v1",
    sourceTreeSha256: sha256(sourceTreeSha256, "verifier source tree digest"),
    buildTreeSha256: sha256(buildTreeSha256, "verifier build tree digest"),
  });
}

function snapshotPayload(snapshot: Omit<SealedVerifierSnapshot, "snapshotSha256">): unknown {
  return {
    domain: "policytwin.verifier.snapshot.v1",
    ...snapshot,
  };
}

export function sealedVerifierSnapshotSha256(
  snapshot: Omit<SealedVerifierSnapshot, "snapshotSha256">,
): string {
  return workerRpcSha256(snapshotPayload(snapshot));
}

export function parseSealedVerifierSnapshot(value: unknown): SealedVerifierSnapshot {
  const result = record(value, "sealed verifier snapshot");
  exactKeys(
    result,
    [
      "schemaVersion", "kind", "authority", "requestId", "requestSha256", "inputSha256",
      "policySha256", "executionBindingSha256", "attempt", "repairRunId",
      "verifierImageDigest", "acceptedCorpusSha256", "policyIrSha256",
      "sourceTreeManifest", "sourceTreeSha256", "initialBuildTreeManifest",
      "initialBuildTreeSha256", "initialExecutionTreeSha256", "snapshotSha256",
      "liveClaim", "passSigningEligible", "externalSettlementEligible",
    ],
    "sealed verifier snapshot",
  );
  if (
    result.schemaVersion !== "1" ||
    result.kind !== "SEALED_VERIFIER_SNAPSHOT" ||
    result.authority !== VERIFIER_SNAPSHOT_AUTHORITY ||
    typeof result.requestId !== "string" ||
    !REQUEST_ID.test(result.requestId) ||
    result.liveClaim !== false ||
    result.passSigningEligible !== false ||
    result.externalSettlementEligible !== false
  ) {
    throw new Error("Sealed verifier snapshot crosses the non-finalized authority boundary.");
  }
  const sourceTreeManifest = parseVerifierTreeManifest(result.sourceTreeManifest, "source tree");
  const initialBuildTreeManifest = parseVerifierTreeManifest(
    result.initialBuildTreeManifest,
    "initial build tree",
  );
  const sourceTreeSha256 = sha256(result.sourceTreeSha256, "source tree digest");
  const initialBuildTreeSha256 = sha256(
    result.initialBuildTreeSha256,
    "initial build tree digest",
  );
  if (
    sourceTreeSha256 !== verifierTreeSha256(sourceTreeManifest) ||
    initialBuildTreeSha256 !== verifierTreeSha256(initialBuildTreeManifest)
  ) {
    throw new Error("Sealed verifier snapshot tree digest is inconsistent.");
  }
  const initialExecutionTreeSha256 = sha256(
    result.initialExecutionTreeSha256,
    "initial execution tree digest",
  );
  if (
    initialExecutionTreeSha256 !==
    verifierExecutionTreeSha256(sourceTreeSha256, initialBuildTreeSha256)
  ) {
    throw new Error("Sealed verifier snapshot execution tree digest is inconsistent.");
  }
  const parsed: SealedVerifierSnapshot = {
    schemaVersion: "1",
    kind: "SEALED_VERIFIER_SNAPSHOT",
    authority: VERIFIER_SNAPSHOT_AUTHORITY,
    requestId: result.requestId,
    requestSha256: sha256(result.requestSha256, "snapshot request digest"),
    inputSha256: sha256(result.inputSha256, "snapshot input digest"),
    policySha256: sha256(result.policySha256, "snapshot policy digest"),
    executionBindingSha256: sha256(
      result.executionBindingSha256,
      "snapshot execution binding",
    ),
    attempt: attempt(result.attempt),
    repairRunId: safeId(result.repairRunId, "snapshot repair run ID"),
    verifierImageDigest: imageDigest(result.verifierImageDigest),
    acceptedCorpusSha256: sha256(result.acceptedCorpusSha256, "snapshot corpus digest"),
    policyIrSha256: sha256(result.policyIrSha256, "snapshot PolicyIR digest"),
    sourceTreeManifest,
    sourceTreeSha256,
    initialBuildTreeManifest,
    initialBuildTreeSha256,
    initialExecutionTreeSha256,
    snapshotSha256: sha256(result.snapshotSha256, "snapshot digest"),
    liveClaim: false,
    passSigningEligible: false,
    externalSettlementEligible: false,
  };
  const { snapshotSha256: _snapshotSha256, ...unsigned } = parsed;
  if (parsed.snapshotSha256 !== sealedVerifierSnapshotSha256(unsigned)) {
    throw new Error("Sealed verifier snapshot digest is inconsistent.");
  }
  return parsed;
}

function challengePayload(challenge: Omit<VerifierExchangeChallenge, "challengeSha256">): unknown {
  return { domain: "policytwin.verifier.challenge.v1", ...challenge };
}

export function verifierChallengeSha256(
  challenge: Omit<VerifierExchangeChallenge, "challengeSha256">,
): string {
  return workerRpcSha256(challengePayload(challenge));
}

export function parseVerifierExchangeChallenge(value: unknown): VerifierExchangeChallenge {
  const result = record(value, "verifier exchange challenge");
  exactKeys(
    result,
    [
      "schemaVersion", "kind", "profile", "challengeId", "capabilitySha256", "requestId",
      "requestSha256", "inputSha256", "policySha256", "executionBindingSha256",
      "snapshotSha256", "verifierImageDigest", "attempt", "repairRunId",
      "acceptedCorpusSha256", "policyIrSha256", "issuedAt", "expiresAt",
      "requestExpiresAt", "challengeSha256",
    ],
    "verifier exchange challenge",
  );
  if (
    result.schemaVersion !== "1" ||
    result.kind !== "VERIFIER_EXCHANGE_CHALLENGE" ||
    result.profile !== VERIFIER_EXCHANGE_PROFILE ||
    typeof result.challengeId !== "string" ||
    !REQUEST_ID.test(result.challengeId) ||
    typeof result.requestId !== "string" ||
    !REQUEST_ID.test(result.requestId)
  ) {
    throw new Error("Verifier exchange challenge is invalid.");
  }
  const issuedAt = canonicalIso(result.issuedAt, "challenge issued time");
  const expiresAt = canonicalIso(result.expiresAt, "challenge expiry time");
  const requestExpiresAt = canonicalIso(
    result.requestExpiresAt,
    "challenge request expiry time",
  );
  if (
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(requestExpiresAt) < Date.parse(expiresAt)
  ) {
    throw new Error("Verifier exchange challenge expiry is invalid.");
  }
  const parsed: VerifierExchangeChallenge = {
    schemaVersion: "1",
    kind: "VERIFIER_EXCHANGE_CHALLENGE",
    profile: VERIFIER_EXCHANGE_PROFILE,
    challengeId: result.challengeId,
    capabilitySha256: sha256(result.capabilitySha256, "verifier capability digest"),
    requestId: result.requestId,
    requestSha256: sha256(result.requestSha256, "challenge request digest"),
    inputSha256: sha256(result.inputSha256, "challenge input digest"),
    policySha256: sha256(result.policySha256, "challenge policy digest"),
    executionBindingSha256: sha256(
      result.executionBindingSha256,
      "challenge execution binding",
    ),
    snapshotSha256: sha256(result.snapshotSha256, "challenge snapshot digest"),
    verifierImageDigest: imageDigest(result.verifierImageDigest),
    attempt: attempt(result.attempt),
    repairRunId: safeId(result.repairRunId, "challenge repair run ID"),
    acceptedCorpusSha256: sha256(result.acceptedCorpusSha256, "challenge corpus digest"),
    policyIrSha256: sha256(result.policyIrSha256, "challenge PolicyIR digest"),
    issuedAt,
    expiresAt,
    requestExpiresAt,
    challengeSha256: sha256(result.challengeSha256, "challenge digest"),
  };
  const { challengeSha256: _challengeSha256, ...unsigned } = parsed;
  if (parsed.challengeSha256 !== verifierChallengeSha256(unsigned)) {
    throw new Error("Verifier exchange challenge digest is inconsistent.");
  }
  return parsed;
}

export function verifierCapabilitySha256(value: unknown): string {
  if (typeof value !== "string" || !CAPABILITY.test(value)) {
    throw new Error("Verifier capability is invalid.");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    bytes.fill(0);
    throw new Error("Verifier capability is invalid.");
  }
  const digest = createHash("sha256")
    .update("policytwin.verifier.capability.v1", "utf8")
    .update("\0", "utf8")
    .update(bytes)
    .digest("hex");
  bytes.fill(0);
  return digest;
}

function receiptPayload(receipt: Omit<VerifierExchangeReceipt, "receiptSha256" | "hmacSha256">): unknown {
  return { domain: "policytwin.verifier.receipt.v1", ...receipt };
}

export function verifierReceiptSha256(
  value: Omit<VerifierExchangeReceipt, "receiptSha256" | "hmacSha256">,
): string {
  return workerRpcSha256(receiptPayload(value));
}

export function verifierReceiptHmacSha256(
  capability: unknown,
  receiptSha256Value: unknown,
): string {
  if (typeof capability !== "string" || !CAPABILITY.test(capability)) {
    throw new Error("Verifier capability is invalid.");
  }
  const receiptDigest = sha256(receiptSha256Value, "verifier receipt digest");
  const key = Buffer.from(capability, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== capability) {
    key.fill(0);
    throw new Error("Verifier capability is invalid.");
  }
  const digest = createHmac("sha256", key)
    .update("policytwin.verifier.receipt-hmac.v1", "utf8")
    .update("\0", "utf8")
    .update(receiptDigest, "utf8")
    .digest("hex");
  key.fill(0);
  return digest;
}

export function parseVerifierExchangeReceipt(value: unknown): VerifierExchangeReceipt {
  const result = record(value, "verifier exchange receipt");
  exactKeys(
    result,
    [
      "schemaVersion", "kind", "profile", "challengeId", "capabilitySha256", "requestId",
      "requestSha256", "inputSha256", "policySha256", "executionBindingSha256",
      "snapshotSha256", "verifierImageDigest", "verifierRunId", "attempt", "repairRunId",
      "acceptedCorpusSha256", "policyIrSha256", "sourceTreeSha256",
      "initialBuildTreeSha256", "finalBuildTreeManifest", "finalBuildTreeSha256",
      "finalExecutionTreeSha256", "commandEvidence", "policyVerification", "status",
      "startedAt", "completedAt", "receiptSha256", "hmacSha256",
    ],
    "verifier exchange receipt",
  );
  if (
    result.schemaVersion !== "1" ||
    result.kind !== "VERIFIER_EXCHANGE_RECEIPT" ||
    result.profile !== VERIFIER_EXCHANGE_PROFILE ||
    typeof result.challengeId !== "string" ||
    !REQUEST_ID.test(result.challengeId) ||
    typeof result.requestId !== "string" ||
    !REQUEST_ID.test(result.requestId) ||
    (result.status !== "PASS" && result.status !== "FAIL") ||
    !Array.isArray(result.commandEvidence) ||
    result.commandEvidence.length !== 2
  ) {
    throw new Error("Verifier exchange receipt is invalid.");
  }
  const commandEvidence = result.commandEvidence.map((item) => parseCommandEvidence(item)) as [
    CommandEvidence,
    CommandEvidence,
  ];
  const policyVerification = parsePolicyVerificationEvidence(result.policyVerification);
  const finalBuildTreeManifest = parseVerifierTreeManifest(
    result.finalBuildTreeManifest,
    "final verifier build tree",
  );
  const finalBuildTreeSha256 = sha256(result.finalBuildTreeSha256, "final build tree digest");
  if (finalBuildTreeSha256 !== verifierTreeSha256(finalBuildTreeManifest)) {
    throw new Error("Final verifier build tree digest is inconsistent.");
  }
  const sourceTreeSha256 = sha256(result.sourceTreeSha256, "receipt source tree digest");
  const finalExecutionTreeSha256 = sha256(
    result.finalExecutionTreeSha256,
    "receipt final execution tree digest",
  );
  if (
    finalExecutionTreeSha256 !==
    verifierExecutionTreeSha256(sourceTreeSha256, finalBuildTreeSha256)
  ) {
    throw new Error("Final verifier execution tree digest is inconsistent.");
  }
  const startedAt = canonicalIso(result.startedAt, "verifier receipt start time");
  const completedAt = canonicalIso(result.completedAt, "verifier receipt completion time");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("Verifier receipt completion precedes its start.");
  }
  const parsed: VerifierExchangeReceipt = {
    schemaVersion: "1",
    kind: "VERIFIER_EXCHANGE_RECEIPT",
    profile: VERIFIER_EXCHANGE_PROFILE,
    challengeId: result.challengeId,
    capabilitySha256: sha256(result.capabilitySha256, "receipt capability digest"),
    requestId: result.requestId,
    requestSha256: sha256(result.requestSha256, "receipt request digest"),
    inputSha256: sha256(result.inputSha256, "receipt input digest"),
    policySha256: sha256(result.policySha256, "receipt policy digest"),
    executionBindingSha256: sha256(
      result.executionBindingSha256,
      "receipt execution binding",
    ),
    snapshotSha256: sha256(result.snapshotSha256, "receipt snapshot digest"),
    verifierImageDigest: imageDigest(result.verifierImageDigest),
    verifierRunId: safeId(result.verifierRunId, "verifier run ID"),
    attempt: attempt(result.attempt),
    repairRunId: safeId(result.repairRunId, "receipt repair run ID"),
    acceptedCorpusSha256: sha256(result.acceptedCorpusSha256, "receipt corpus digest"),
    policyIrSha256: sha256(result.policyIrSha256, "receipt PolicyIR digest"),
    sourceTreeSha256,
    initialBuildTreeSha256: sha256(
      result.initialBuildTreeSha256,
      "receipt initial build tree digest",
    ),
    finalBuildTreeManifest,
    finalBuildTreeSha256,
    finalExecutionTreeSha256,
    commandEvidence,
    policyVerification,
    status: result.status,
    startedAt,
    completedAt,
    receiptSha256: sha256(result.receiptSha256, "verifier receipt digest"),
    hmacSha256: sha256(result.hmacSha256, "verifier receipt HMAC"),
  };
  const { receiptSha256: _receiptSha256, hmacSha256: _hmacSha256, ...unsigned } = parsed;
  if (parsed.receiptSha256 !== verifierReceiptSha256(unsigned)) {
    throw new Error("Verifier receipt digest is inconsistent.");
  }
  return parsed;
}

export function canonicalVerifierExchangeJson(value: unknown): string {
  return canonicalWorkerRpcJson(value);
}
