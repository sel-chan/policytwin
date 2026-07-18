import { randomBytes as secureRandomBytes, timingSafeEqual } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  acceptedCorpusSha256,
  parseWorkerRpcV2Request,
  workerRpcSha256,
  type WorkerRpcV2Request,
} from "./worker-rpc-contract.js";
import {
  reconstructVerificationWorkspace,
  type WorkerRuntimeLayout,
} from "./worker-runtime-contract.js";
import {
  canonicalVerifierExchangeJson,
  parseSealedVerifierSnapshot,
  parseVerifierExchangeReceipt,
  sealedVerifierSnapshotSha256,
  verifierCapabilitySha256,
  verifierChallengeSha256,
  verifierExecutionTreeSha256,
  verifierFileSha256,
  verifierReceiptHmacSha256,
  verifierTreeSha256,
  VERIFIER_EXCHANGE_PROFILE,
  VERIFIER_SNAPSHOT_AUTHORITY,
  type SealedVerifierSnapshot,
  type VerifierExchangeChallenge,
  type VerifierExchangeReceipt,
  type VerifierTreeEntry,
  type VerifierTreeManifest,
} from "./verifier-exchange-contract.js";
import {
  assertDurableVerifierReplayStore,
  type DurableVerifierReplayStore,
} from "./verifier-replay-sqlite.js";

const SOURCE_PATHS = [
  "package.json",
  "src",
  "src/refund.ts",
  "tests",
  "tests/refund.test.mjs",
  "tsconfig.json",
] as const;
const INITIAL_BUILD_PATHS = ["dist"] as const;
const FINAL_BUILD_PATHS = ["dist", "dist/refund.d.ts", "dist/refund.js"] as const;
const SOURCE_TOP_LEVEL_PATHS = ["package.json", "src", "tests", "tsconfig.json"] as const;
const REPAIR_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const IMMUTABLE_IMAGE = /^sha256:[0-9a-f]{64}$/u;

const SEALED_SNAPSHOTS = new WeakSet<object>();
const ISSUED_SNAPSHOTS = new WeakSet<object>();
const SNAPSHOT_OWNERS = new WeakMap<object, object>();
const SNAPSHOT_METADATA = new WeakMap<
  object,
  { verificationRoot: string; request: WorkerRpcV2Request }
>();
const DELIVERIES = new WeakSet<object>();
const DELIVERY_OWNERS = new WeakMap<object, object>();
const DELIVERY_METADATA = new WeakMap<
  object,
  {
    snapshot: SealedVerifierSnapshot;
    challenge: VerifierExchangeChallenge;
    capability: Buffer;
    delivered: boolean;
    settled: boolean;
  }
>();
const ADMITTED_RECEIPTS = new WeakSet<object>();
const ADMITTED_RECEIPT_OWNERS = new WeakMap<object, object>();
const ADMITTED_RECEIPT_SNAPSHOTS = new WeakMap<object, SealedVerifierSnapshot>();
const VERIFIER_EXCHANGE_AUTHORITIES = new WeakSet<object>();
const REVIEW_AUTHORIZATIONS = new WeakSet<object>();
const REVIEW_AUTHORIZATION_OWNERS = new WeakMap<object, object>();
const CONSUMED_REVIEW_AUTHORIZATIONS = new WeakSet<object>();
const REVIEW_AUTHORIZATIONS_ISSUED = new WeakSet<object>();
const RETRY_AUTHORIZATIONS = new WeakSet<object>();
const RETRY_AUTHORIZATION_OWNERS = new WeakMap<object, object>();
const CONSUMED_RETRY_AUTHORIZATIONS = new WeakSet<object>();
const RETRY_AUTHORIZATIONS_ISSUED = new WeakSet<object>();

export interface VerifierCapabilityDelivery {
  readonly schemaVersion: "1";
  readonly kind: "VERIFIER_CAPABILITY_DELIVERY";
  readonly challenge: VerifierExchangeChallenge;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface AdmittedVerifierReceipt {
  readonly schemaVersion: "1";
  readonly kind: "ADMITTED_VERIFIER_RECEIPT_NOT_RUNTIME_FINALIZED";
  readonly receipt: VerifierExchangeReceipt;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface VerifierReviewAuthorization {
  readonly schemaVersion: "1";
  readonly kind: "VERIFIER_RECEIPT_BOUND_REVIEW_AUTHORIZATION";
  readonly requestId: string;
  readonly requestSha256: string;
  readonly inputSha256: string;
  readonly policySha256: string;
  readonly executionBindingSha256: string;
  readonly snapshotSha256: string;
  readonly verifierImageDigest: string;
  readonly verifierRunId: string;
  readonly attempt: 1 | 2;
  readonly repairRunId: string;
  readonly verifierReceiptSha256: string;
  readonly acceptedCorpusSha256: string;
  readonly policyIrSha256: string;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface VerifierRetryAuthorization {
  readonly schemaVersion: "1";
  readonly kind: "FRESH_VERIFIER_SNAPSHOT_RETRY_REQUIRED";
  readonly requestId: string;
  readonly requestSha256: string;
  readonly inputSha256: string;
  readonly policySha256: string;
  readonly executionBindingSha256: string;
  readonly failedAttempt: 1;
  readonly nextAttempt: 2;
  readonly failedRepairRunId: string;
  readonly failedSnapshotSha256: string;
  readonly verifierImageDigest: string;
  readonly failedVerifierReceiptSha256: string;
  readonly acceptedCorpusSha256: string;
  readonly policyIrSha256: string;
  readonly requiresFreshSnapshot: true;
  readonly requiresFreshCapability: true;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface VerifierExchangeAuthority {
  prepareSnapshot(input: {
    layout: WorkerRuntimeLayout;
    request: unknown;
    attempt: 1;
    repairRunId: string;
    verifierImageDigest: string;
  }): SealedVerifierSnapshot;
  prepareRetrySnapshot(input: {
    authorization: VerifierRetryAuthorization;
    layout: WorkerRuntimeLayout;
    request: unknown;
    repairRunId: string;
    verifierImageDigest: string;
  }): SealedVerifierSnapshot;
  issue(snapshot: SealedVerifierSnapshot): VerifierCapabilityDelivery;
  admit(delivery: VerifierCapabilityDelivery, receipt: unknown): AdmittedVerifierReceipt;
  revalidateVerifierReceipt(value: AdmittedVerifierReceipt): void;
}

export interface VerifierExchangeAuthorityOptions {
  replayStore: DurableVerifierReplayStore;
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
  challengeTtlMs?: number;
}

export function assertVerifierExchangeAuthority(
  value: unknown,
): asserts value is VerifierExchangeAuthority {
  if (
    typeof value !== "object" ||
    value === null ||
    !VERIFIER_EXCHANGE_AUTHORITIES.has(value)
  ) {
    throw new Error("Verifier bridge requires the exact verifier exchange authority.");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactCurrentTime(now: () => Date): Date {
  let value: Date;
  try {
    value = now();
  } catch {
    throw new Error("Verifier exchange clock failed.");
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Verifier exchange clock is invalid.");
  }
  return new Date(value.getTime());
}

function randomExact(randomBytes: (size: number) => Uint8Array, size: number): Buffer {
  let value: Uint8Array;
  try {
    value = randomBytes(size);
  } catch {
    throw new Error("Verifier exchange randomness failed.");
  }
  if (!(value instanceof Uint8Array) || value.byteLength !== size) {
    throw new Error("Verifier exchange randomness is invalid.");
  }
  return Buffer.from(value);
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function inspectExactTree(
  rootValue: string,
  expectedPaths: readonly string[],
  label: string,
  ignoredTopLevelPaths: readonly string[],
): VerifierTreeManifest {
  if (!isAbsolute(rootValue)) throw new Error(`${label} root is invalid.`);
  const root = resolve(rootValue);
  const rootStat = lstatSync(root);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !samePath(realpathSync.native(root), root)
  ) {
    throw new Error(`${label} root is not a stable real directory.`);
  }
  const expected = [...expectedPaths].sort();
  const expectedTopLevel = expected.filter((path) => !path.includes("/"));
  const permittedTopLevel = [...expectedTopLevel, ...ignoredTopLevelPaths].sort();
  const actualTopLevel = readdirSync(root).sort();
  if (
    actualTopLevel.length !== permittedTopLevel.length ||
    actualTopLevel.some((path, index) => path !== permittedTopLevel[index])
  ) {
    throw new Error(`${label} contains an unexpected top-level path.`);
  }
  const entries: VerifierTreeEntry[] = [];

  function inspectPath(path: string): void {
    const absolutePath = resolve(root, path);
    const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
    if (relativePath !== path || relativePath.startsWith("..")) {
      throw new Error(`${label} path is outside its root.`);
    }
    const before = lstatSync(absolutePath);
    if (before.isSymbolicLink() || !samePath(realpathSync.native(absolutePath), absolutePath)) {
      throw new Error(`${label} contains a linked path.`);
    }
    if (before.isDirectory()) {
      entries.push({
        path,
        kind: "directory",
        mode: before.mode & 0o7777,
        bytes: null,
        sha256: null,
      });
      const childrenBefore = readdirSync(absolutePath).sort();
      for (const child of childrenBefore) inspectPath(`${path}/${child}`);
      const childrenAfter = readdirSync(absolutePath).sort();
      const after = lstatSync(absolutePath);
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        after.mode !== before.mode ||
        childrenAfter.length !== childrenBefore.length ||
        childrenAfter.some((child, index) => child !== childrenBefore[index])
      ) {
        throw new Error(`${label} changed while it was inspected.`);
      }
      return;
    }
    if (!before.isFile() || before.size > 2 * 1024 * 1024) {
      throw new Error(`${label} contains an unsupported file.`);
    }
    const content = readFileSync(absolutePath);
    const after = lstatSync(absolutePath);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.size !== before.size ||
      after.mode !== before.mode ||
      after.mtimeMs !== before.mtimeMs ||
      !samePath(realpathSync.native(absolutePath), absolutePath)
    ) {
      throw new Error(`${label} changed while it was inspected.`);
    }
    entries.push({
      path,
      kind: "file",
      mode: before.mode & 0o7777,
      bytes: content.byteLength,
      sha256: verifierFileSha256(content),
    });
  }

  for (const path of expectedTopLevel) inspectPath(path);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const actualPaths = entries.map((entry) => entry.path);
  if (
    actualPaths.length !== expected.length ||
    actualPaths.some((path, index) => path !== expected[index])
  ) {
    throw new Error(`${label} contains an unexpected nested path.`);
  }
  return { schemaVersion: "1", entries };
}

function snapshotMetadata(snapshot: SealedVerifierSnapshot): {
  verificationRoot: string;
  request: WorkerRpcV2Request;
} {
  if (!SEALED_SNAPSHOTS.has(snapshot)) {
    throw new Error("Verifier exchange requires the exact supervisor-sealed snapshot.");
  }
  const metadata = SNAPSHOT_METADATA.get(snapshot);
  if (metadata === undefined) throw new Error("Verifier snapshot metadata is unavailable.");
  return metadata;
}

function assertInitialSnapshotCurrent(snapshot: SealedVerifierSnapshot): WorkerRpcV2Request {
  const metadata = snapshotMetadata(snapshot);
  const source = inspectExactTree(
    metadata.verificationRoot,
    SOURCE_PATHS,
    "verifier source tree",
    INITIAL_BUILD_PATHS,
  );
  const build = inspectExactTree(
    metadata.verificationRoot,
    INITIAL_BUILD_PATHS,
    "initial verifier build tree",
    SOURCE_TOP_LEVEL_PATHS,
  );
  if (
    verifierTreeSha256(source) !== snapshot.sourceTreeSha256 ||
    verifierTreeSha256(build) !== snapshot.initialBuildTreeSha256
  ) {
    throw new Error("Verifier snapshot changed after sealing.");
  }
  return metadata.request;
}

function assertFinalSnapshotCurrent(
  snapshot: SealedVerifierSnapshot,
  receipt: VerifierExchangeReceipt,
): WorkerRpcV2Request {
  const metadata = snapshotMetadata(snapshot);
  const source = inspectExactTree(
    metadata.verificationRoot,
    SOURCE_PATHS,
    "verifier source tree",
    INITIAL_BUILD_PATHS,
  );
  const build = inspectExactTree(
    metadata.verificationRoot,
    FINAL_BUILD_PATHS,
    "final verifier build tree",
    SOURCE_TOP_LEVEL_PATHS,
  );
  if (
    verifierTreeSha256(source) !== snapshot.sourceTreeSha256 ||
    verifierTreeSha256(build) !== receipt.finalBuildTreeSha256
  ) {
    throw new Error("Verifier source or build output changed before receipt admission.");
  }
  return metadata.request;
}

function snapshotFor(
  layout: WorkerRuntimeLayout,
  requestValue: unknown,
  attempt: 1 | 2,
  repairRunId: string,
  verifierImageDigest: string,
  now: Date,
): SealedVerifierSnapshot {
  if (!REPAIR_RUN_ID.test(repairRunId) || !IMMUTABLE_IMAGE.test(verifierImageDigest)) {
    throw new Error("Verifier snapshot repair run or image is invalid.");
  }
  const request = deepFreeze(parseWorkerRpcV2Request(requestValue));
  if (
    attempt > request.input.maxRepairAttempts ||
    now.getTime() < Date.parse(request.issuedAt) ||
    now.getTime() >= Date.parse(request.expiresAt)
  ) {
    throw new Error("Verifier snapshot request is inactive or exceeds the repair limit.");
  }
  reconstructVerificationWorkspace(layout);
  const sourceTreeManifest = inspectExactTree(
    layout.verificationRoot,
    SOURCE_PATHS,
    "verifier source tree",
    INITIAL_BUILD_PATHS,
  );
  const initialBuildTreeManifest = inspectExactTree(
    layout.verificationRoot,
    INITIAL_BUILD_PATHS,
    "initial verifier build tree",
    SOURCE_TOP_LEVEL_PATHS,
  );
  const sourceTreeSha256 = verifierTreeSha256(sourceTreeManifest);
  const initialBuildTreeSha256 = verifierTreeSha256(initialBuildTreeManifest);
  const unsigned: Omit<SealedVerifierSnapshot, "snapshotSha256"> = {
    schemaVersion: "1",
    kind: "SEALED_VERIFIER_SNAPSHOT",
    authority: VERIFIER_SNAPSHOT_AUTHORITY,
    requestId: request.requestId,
    requestSha256: workerRpcSha256(request),
    inputSha256: request.inputSha256,
    policySha256: request.policySha256,
    executionBindingSha256: request.executionBindingSha256,
    attempt,
    repairRunId,
    verifierImageDigest,
    acceptedCorpusSha256: acceptedCorpusSha256(request.input),
    policyIrSha256: workerRpcSha256(request.input.acceptedPolicyIr),
    sourceTreeManifest,
    sourceTreeSha256,
    initialBuildTreeManifest,
    initialBuildTreeSha256,
    initialExecutionTreeSha256: verifierExecutionTreeSha256(
      sourceTreeSha256,
      initialBuildTreeSha256,
    ),
    liveClaim: false,
    passSigningEligible: false,
    externalSettlementEligible: false,
  };
  const snapshot = deepFreeze(
    parseSealedVerifierSnapshot({
      ...unsigned,
      snapshotSha256: sealedVerifierSnapshotSha256(unsigned),
    }),
  );
  SEALED_SNAPSHOTS.add(snapshot);
  SNAPSHOT_METADATA.set(snapshot, { verificationRoot: layout.verificationRoot, request });
  return snapshot;
}

function exactReceiptBindings(
  receipt: VerifierExchangeReceipt,
  challenge: VerifierExchangeChallenge,
  snapshot: SealedVerifierSnapshot,
  request: WorkerRpcV2Request,
): void {
  if (
    receipt.challengeId !== challenge.challengeId ||
    receipt.capabilitySha256 !== challenge.capabilitySha256 ||
    receipt.requestId !== snapshot.requestId ||
    receipt.requestSha256 !== snapshot.requestSha256 ||
    receipt.inputSha256 !== snapshot.inputSha256 ||
    receipt.policySha256 !== snapshot.policySha256 ||
    receipt.executionBindingSha256 !== snapshot.executionBindingSha256 ||
    receipt.snapshotSha256 !== snapshot.snapshotSha256 ||
    receipt.verifierImageDigest !== snapshot.verifierImageDigest ||
    receipt.attempt !== snapshot.attempt ||
    receipt.repairRunId !== snapshot.repairRunId ||
    receipt.acceptedCorpusSha256 !== snapshot.acceptedCorpusSha256 ||
    receipt.policyIrSha256 !== snapshot.policyIrSha256 ||
    receipt.sourceTreeSha256 !== snapshot.sourceTreeSha256 ||
    receipt.initialBuildTreeSha256 !== snapshot.initialBuildTreeSha256
  ) {
    throw new Error("Verifier receipt is not bound to its one-use challenge and snapshot.");
  }
  if (receipt.verifierRunId === receipt.repairRunId) {
    throw new Error("Verifier and repair phases require distinct run identities.");
  }
  const finalPaths = receipt.finalBuildTreeManifest.entries.map((entry) => entry.path);
  if (
    finalPaths.length !== FINAL_BUILD_PATHS.length ||
    finalPaths.some((path, index) => path !== FINAL_BUILD_PATHS[index])
  ) {
    throw new Error("Verifier receipt final build tree is incomplete or unexpected.");
  }
  const [typecheck, fixtureTest] = receipt.commandEvidence;
  if (
    typecheck.commandId !== "fixture-typecheck" ||
    fixtureTest.commandId !== "fixture-test" ||
    typecheck.attempt !== snapshot.attempt ||
    fixtureTest.attempt !== snapshot.attempt ||
    typecheck.repairRunId !== snapshot.repairRunId ||
    fixtureTest.repairRunId !== snapshot.repairRunId ||
    typecheck.exitCode !== 0 ||
    fixtureTest.exitCode !== 0 ||
    typecheck.timedOut ||
    fixtureTest.timedOut ||
    typecheck.outputTruncated ||
    fixtureTest.outputTruncated ||
    typecheck.stdout !== "ok" ||
    fixtureTest.stdout !== "ok" ||
    typecheck.stderr !== "" ||
    fixtureTest.stderr !== "" ||
    typecheck.fixtureTreeBeforeSha256 !== snapshot.initialExecutionTreeSha256 ||
    typecheck.fixtureTreeAfterSha256 !== receipt.finalExecutionTreeSha256 ||
    fixtureTest.fixtureTreeBeforeSha256 !== receipt.finalExecutionTreeSha256 ||
    fixtureTest.fixtureTreeAfterSha256 !== receipt.finalExecutionTreeSha256
  ) {
    throw new Error("Verifier receipt command transcript breaks the source/build tree boundary.");
  }
  const verification = receipt.policyVerification;
  if (
    verification.executionMode !== "SERVER_OWNED_CORPUS" ||
    verification.attempt !== snapshot.attempt ||
    verification.repairRunId !== snapshot.repairRunId ||
    verification.fixtureTreeSha256 !== receipt.finalExecutionTreeSha256 ||
    verification.acceptedCorpusSha256 !== snapshot.acceptedCorpusSha256 ||
    verification.policyIrSha256 !== snapshot.policyIrSha256 ||
    verification.total !== request.input.acceptedCases.length ||
    verification.results.length !== request.input.acceptedCases.length ||
    verification.status !== receipt.status
  ) {
    throw new Error("Verifier receipt corpus evidence is not bound to the accepted request.");
  }
  for (let index = 0; index < request.input.acceptedCases.length; index += 1) {
    const policyCase = request.input.acceptedCases[index];
    const result = verification.results[index];
    if (
      policyCase === undefined ||
      result === undefined ||
      result.caseId !== policyCase.id ||
      result.expectedDecision !== policyCase.expectedDecision
    ) {
      throw new Error("Verifier receipt changed or reordered the accepted corpus.");
    }
  }
}

export function takeVerifierCapability(delivery: VerifierCapabilityDelivery): string {
  if (!DELIVERIES.has(delivery)) {
    throw new Error("Verifier capability delivery is not factory issued.");
  }
  const metadata = DELIVERY_METADATA.get(delivery);
  if (metadata === undefined || metadata.delivered || metadata.settled) {
    throw new Error("Verifier capability delivery is no longer available.");
  }
  metadata.delivered = true;
  return metadata.capability.toString("base64url");
}

export function assertAdmittedVerifierReceipt(
  value: unknown,
): asserts value is AdmittedVerifierReceipt {
  if (typeof value !== "object" || value === null || !ADMITTED_RECEIPTS.has(value)) {
    throw new Error("Review requires the exact admitted verifier receipt.");
  }
}

export function admittedVerifierReceipt(value: unknown): VerifierExchangeReceipt {
  assertAdmittedVerifierReceipt(value);
  return value.receipt;
}

export function authorizeVerifierReview(value: unknown): VerifierReviewAuthorization {
  assertAdmittedVerifierReceipt(value);
  const owner = ADMITTED_RECEIPT_OWNERS.get(value);
  if (owner === undefined) throw new Error("Verifier receipt authority is unavailable.");
  if (value.receipt.status !== "PASS") {
    throw new Error("A failed verifier receipt cannot authorize review.");
  }
  if (REVIEW_AUTHORIZATIONS_ISSUED.has(value)) {
    throw new Error("A verifier receipt can authorize review only once.");
  }
  REVIEW_AUTHORIZATIONS_ISSUED.add(value);
  const authorization = deepFreeze({
    schemaVersion: "1" as const,
    kind: "VERIFIER_RECEIPT_BOUND_REVIEW_AUTHORIZATION" as const,
    requestId: value.receipt.requestId,
    requestSha256: value.receipt.requestSha256,
    inputSha256: value.receipt.inputSha256,
    policySha256: value.receipt.policySha256,
    executionBindingSha256: value.receipt.executionBindingSha256,
    snapshotSha256: value.receipt.snapshotSha256,
    verifierImageDigest: value.receipt.verifierImageDigest,
    verifierRunId: value.receipt.verifierRunId,
    attempt: value.receipt.attempt,
    repairRunId: value.receipt.repairRunId,
    verifierReceiptSha256: value.receipt.receiptSha256,
    acceptedCorpusSha256: value.receipt.acceptedCorpusSha256,
    policyIrSha256: value.receipt.policyIrSha256,
    liveClaim: false as const,
    passSigningEligible: false as const,
    externalSettlementEligible: false as const,
  });
  REVIEW_AUTHORIZATIONS.add(authorization);
  REVIEW_AUTHORIZATION_OWNERS.set(authorization, owner);
  return authorization;
}

export function consumeVerifierReviewAuthorization(
  value: unknown,
): asserts value is VerifierReviewAuthorization {
  if (
    typeof value !== "object" ||
    value === null ||
    !REVIEW_AUTHORIZATIONS.has(value) ||
    CONSUMED_REVIEW_AUTHORIZATIONS.has(value)
  ) {
    throw new Error("Review authorization must be one fresh verifier-bound capability.");
  }
  CONSUMED_REVIEW_AUTHORIZATIONS.add(value);
}

export function authorizeVerifierRetry(value: unknown): VerifierRetryAuthorization {
  assertAdmittedVerifierReceipt(value);
  const owner = ADMITTED_RECEIPT_OWNERS.get(value);
  if (owner === undefined) throw new Error("Verifier receipt authority is unavailable.");
  if (value.receipt.status !== "FAIL" || value.receipt.attempt !== 1) {
    throw new Error("Verifier retry requires a first-attempt failed receipt.");
  }
  if (RETRY_AUTHORIZATIONS_ISSUED.has(value)) {
    throw new Error("A failed verifier receipt can authorize retry only once.");
  }
  RETRY_AUTHORIZATIONS_ISSUED.add(value);
  const authorization = deepFreeze({
    schemaVersion: "1" as const,
    kind: "FRESH_VERIFIER_SNAPSHOT_RETRY_REQUIRED" as const,
    requestId: value.receipt.requestId,
    requestSha256: value.receipt.requestSha256,
    inputSha256: value.receipt.inputSha256,
    policySha256: value.receipt.policySha256,
    executionBindingSha256: value.receipt.executionBindingSha256,
    failedAttempt: 1 as const,
    nextAttempt: 2 as const,
    failedRepairRunId: value.receipt.repairRunId,
    failedSnapshotSha256: value.receipt.snapshotSha256,
    verifierImageDigest: value.receipt.verifierImageDigest,
    failedVerifierReceiptSha256: value.receipt.receiptSha256,
    acceptedCorpusSha256: value.receipt.acceptedCorpusSha256,
    policyIrSha256: value.receipt.policyIrSha256,
    requiresFreshSnapshot: true as const,
    requiresFreshCapability: true as const,
    liveClaim: false as const,
    passSigningEligible: false as const,
    externalSettlementEligible: false as const,
  });
  RETRY_AUTHORIZATIONS.add(authorization);
  RETRY_AUTHORIZATION_OWNERS.set(authorization, owner);
  return authorization;
}

export function consumeVerifierRetryAuthorization(
  value: unknown,
): asserts value is VerifierRetryAuthorization {
  if (
    typeof value !== "object" ||
    value === null ||
    !RETRY_AUTHORIZATIONS.has(value) ||
    CONSUMED_RETRY_AUTHORIZATIONS.has(value)
  ) {
    throw new Error("Verifier retry authorization must be fresh and factory issued.");
  }
  CONSUMED_RETRY_AUTHORIZATIONS.add(value);
}

export function createVerifierExchangeAuthority(
  options: VerifierExchangeAuthorityOptions,
): VerifierExchangeAuthority {
  const replayStore = options.replayStore;
  assertDurableVerifierReplayStore(replayStore);
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? secureRandomBytes;
  const challengeTtlMs = options.challengeTtlMs ?? 60_000;
  if (
    !Number.isSafeInteger(challengeTtlMs) ||
    challengeTtlMs < 1_000 ||
    challengeTtlMs > 5 * 60_000
  ) {
    throw new Error("Verifier exchange challenge TTL is invalid.");
  }
  const authority: VerifierExchangeAuthority = {
    prepareSnapshot(input): SealedVerifierSnapshot {
      if (input.attempt !== 1) {
        throw new Error("An initial verifier snapshot must use attempt one.");
      }
      const snapshot = snapshotFor(
        input.layout,
        input.request,
        input.attempt,
        input.repairRunId,
        input.verifierImageDigest,
        exactCurrentTime(now),
      );
      SNAPSHOT_OWNERS.set(snapshot, authority);
      return snapshot;
    },
    prepareRetrySnapshot(input): SealedVerifierSnapshot {
      if (
        typeof input.authorization !== "object" ||
        input.authorization === null ||
        !RETRY_AUTHORIZATIONS.has(input.authorization) ||
        RETRY_AUTHORIZATION_OWNERS.get(input.authorization) !== authority ||
        CONSUMED_RETRY_AUTHORIZATIONS.has(input.authorization)
      ) {
        throw new Error("Attempt two requires one fresh verifier retry authorization.");
      }
      const request = parseWorkerRpcV2Request(input.request);
      const authorization = input.authorization;
      if (
        request.requestId !== authorization.requestId ||
        workerRpcSha256(request) !== authorization.requestSha256 ||
        request.inputSha256 !== authorization.inputSha256 ||
        request.policySha256 !== authorization.policySha256 ||
        request.executionBindingSha256 !== authorization.executionBindingSha256 ||
        acceptedCorpusSha256(request.input) !== authorization.acceptedCorpusSha256 ||
        workerRpcSha256(request.input.acceptedPolicyIr) !== authorization.policyIrSha256 ||
        input.repairRunId === authorization.failedRepairRunId ||
        input.verifierImageDigest !== authorization.verifierImageDigest
      ) {
        throw new Error("Verifier retry is not bound to the failed request and fresh repair run.");
      }
      consumeVerifierRetryAuthorization(authorization);
      const snapshot = snapshotFor(
        input.layout,
        request,
        2,
        input.repairRunId,
        input.verifierImageDigest,
        exactCurrentTime(now),
      );
      SNAPSHOT_OWNERS.set(snapshot, authority);
      return snapshot;
    },
    issue(snapshotValue): VerifierCapabilityDelivery {
      if (SNAPSHOT_OWNERS.get(snapshotValue) !== authority) {
        throw new Error("Verifier snapshot belongs to a different replay authority.");
      }
      const snapshot = parseSealedVerifierSnapshot(snapshotValue);
      const request = assertInitialSnapshotCurrent(snapshotValue);
      if (snapshot.snapshotSha256 !== snapshotValue.snapshotSha256) {
        throw new Error("Verifier snapshot was copied or changed before issuance.");
      }
      if (ISSUED_SNAPSHOTS.has(snapshotValue)) {
        throw new Error("A verifier snapshot can issue only one challenge.");
      }
      const issuedAtDate = exactCurrentTime(now);
      if (
        issuedAtDate.getTime() < Date.parse(request.issuedAt) ||
        issuedAtDate.getTime() >= Date.parse(request.expiresAt)
      ) {
        throw new Error("Verifier request is not active for challenge issuance.");
      }
      const maximumExpiry = Math.min(
        issuedAtDate.getTime() + challengeTtlMs,
        Date.parse(request.expiresAt),
      );
      if (maximumExpiry <= issuedAtDate.getTime()) {
        throw new Error("Verifier challenge has no active lifetime.");
      }
      const challengeIdBytes = randomExact(randomBytes, 16);
      const capability = randomExact(randomBytes, 32);
      const challengeId = challengeIdBytes.toString("hex");
      challengeIdBytes.fill(0);
      const capabilityText = capability.toString("base64url");
      const unsigned: Omit<VerifierExchangeChallenge, "challengeSha256"> = {
        schemaVersion: "1",
        kind: "VERIFIER_EXCHANGE_CHALLENGE",
        profile: VERIFIER_EXCHANGE_PROFILE,
        challengeId,
        capabilitySha256: verifierCapabilitySha256(capabilityText),
        requestId: snapshot.requestId,
        requestSha256: snapshot.requestSha256,
        inputSha256: snapshot.inputSha256,
        policySha256: snapshot.policySha256,
        executionBindingSha256: snapshot.executionBindingSha256,
        snapshotSha256: snapshot.snapshotSha256,
        verifierImageDigest: snapshot.verifierImageDigest,
        attempt: snapshot.attempt,
        repairRunId: snapshot.repairRunId,
        acceptedCorpusSha256: snapshot.acceptedCorpusSha256,
        policyIrSha256: snapshot.policyIrSha256,
        issuedAt: issuedAtDate.toISOString(),
        expiresAt: new Date(maximumExpiry).toISOString(),
        requestExpiresAt: request.expiresAt,
      };
      const challenge = deepFreeze({
        ...unsigned,
        challengeSha256: verifierChallengeSha256(unsigned),
      });
      let issued = false;
      try {
        issued = replayStore.issue(challenge, issuedAtDate);
      } catch (error) {
        capability.fill(0);
        throw error;
      }
      if (!issued) {
        capability.fill(0);
        throw new Error("Verifier challenge replay admission failed.");
      }
      ISSUED_SNAPSHOTS.add(snapshotValue);
      const delivery = deepFreeze({
        schemaVersion: "1" as const,
        kind: "VERIFIER_CAPABILITY_DELIVERY" as const,
        challenge,
        liveClaim: false as const,
        passSigningEligible: false as const,
        externalSettlementEligible: false as const,
      });
      DELIVERIES.add(delivery);
      DELIVERY_OWNERS.set(delivery, authority);
      DELIVERY_METADATA.set(delivery, {
        snapshot: snapshotValue,
        challenge,
        capability,
        delivered: false,
        settled: false,
      });
      return delivery;
    },
    admit(delivery, receiptValue): AdmittedVerifierReceipt {
      if (!DELIVERIES.has(delivery) || DELIVERY_OWNERS.get(delivery) !== authority) {
        throw new Error("Verifier receipt requires the exact capability delivery.");
      }
      const metadata = DELIVERY_METADATA.get(delivery);
      if (metadata === undefined || !metadata.delivered || metadata.settled) {
        throw new Error("Verifier capability was not delivered exactly once.");
      }
      metadata.settled = true;
      const current = exactCurrentTime(now);
      try {
        const receipt = parseVerifierExchangeReceipt(receiptValue);
        const request = assertFinalSnapshotCurrent(metadata.snapshot, receipt);
        exactReceiptBindings(receipt, metadata.challenge, metadata.snapshot, request);
        if (
          Date.parse(receipt.startedAt) < Date.parse(metadata.challenge.issuedAt) ||
          Date.parse(receipt.completedAt) >= Date.parse(metadata.challenge.expiresAt) ||
          Date.parse(receipt.completedAt) > current.getTime()
        ) {
          throw new Error("Verifier receipt is outside its one-use challenge window.");
        }
        const capabilityText = metadata.capability.toString("base64url");
        if (canonicalVerifierExchangeJson(receipt).includes(capabilityText)) {
          throw new Error("Verifier receipt exposed its raw one-use capability.");
        }
        const expectedHmac = verifierReceiptHmacSha256(
          capabilityText,
          receipt.receiptSha256,
        );
        const left = Buffer.from(expectedHmac, "hex");
        const right = Buffer.from(receipt.hmacSha256, "hex");
        const validHmac = left.byteLength === right.byteLength && timingSafeEqual(left, right);
        left.fill(0);
        right.fill(0);
        if (!validHmac) throw new Error("Verifier receipt authentication failed.");
        if (
          !replayStore.consume(
            {
              challengeId: receipt.challengeId,
              capabilitySha256: receipt.capabilitySha256,
              challengeSha256: metadata.challenge.challengeSha256,
              requestSha256: receipt.requestSha256,
              snapshotSha256: receipt.snapshotSha256,
              verifierImageDigest: receipt.verifierImageDigest,
              attempt: receipt.attempt,
              repairRunId: receipt.repairRunId,
              receiptSha256: receipt.receiptSha256,
              verifierRunId: receipt.verifierRunId,
            },
            current,
          )
        ) {
          throw new Error("Verifier receipt was replayed or its durable binding changed.");
        }
        const admitted = deepFreeze({
          schemaVersion: "1" as const,
          kind: "ADMITTED_VERIFIER_RECEIPT_NOT_RUNTIME_FINALIZED" as const,
          receipt: deepFreeze(receipt),
          liveClaim: false as const,
          passSigningEligible: false as const,
          externalSettlementEligible: false as const,
        });
        ADMITTED_RECEIPTS.add(admitted);
        ADMITTED_RECEIPT_OWNERS.set(admitted, authority);
        ADMITTED_RECEIPT_SNAPSHOTS.set(admitted, metadata.snapshot);
        return admitted;
      } catch (error) {
        try {
          replayStore.poison(metadata.challenge.challengeId);
        } catch {
          // The admission still fails closed if durable poisoning cannot be recorded.
        }
        throw new Error("Verifier receipt admission failed.", { cause: error });
      } finally {
        metadata.capability.fill(0);
      }
    },
    revalidateVerifierReceipt(value): void {
      if (
        !ADMITTED_RECEIPTS.has(value) ||
        ADMITTED_RECEIPT_OWNERS.get(value) !== authority
      ) {
        throw new Error("Verifier receipt belongs to a different replay authority.");
      }
      const snapshot = ADMITTED_RECEIPT_SNAPSHOTS.get(value);
      if (snapshot === undefined) {
        throw new Error("Verifier receipt snapshot authority is unavailable.");
      }
      assertFinalSnapshotCurrent(snapshot, value.receipt);
    },
  };
  VERIFIER_EXCHANGE_AUTHORITIES.add(authority);
  return Object.freeze(authority);
}
