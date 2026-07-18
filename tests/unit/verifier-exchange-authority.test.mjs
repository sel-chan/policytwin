import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as policyTwin from "../../dist/index.js";
import {
  admittedVerifierReceipt,
  assertVerifierExchangeAuthority,
  authorizeVerifierRetry,
  authorizeVerifierReview,
  consumeVerifierRetryAuthorization,
  consumeVerifierReviewAuthorization,
  createVerifierExchangeAuthority,
  takeVerifierCapability,
} from "../../dist/codex/verifier-exchange-authority.js";
import {
  verifierReceiptHmacSha256,
  verifierReceiptSha256,
} from "../../dist/codex/verifier-exchange-contract.js";
import { createSqliteVerifierReplayStore } from "../../dist/codex/verifier-replay-sqlite.js";
import {
  consumeValidatedExternalWorkerV2Run,
  parsePolicyVerificationEvidence,
  parseWorkerRpcV2Response,
} from "../../dist/index.js";
import {
  createVerifierRuntimeFixture,
  fixedVerifierClock,
  materializeVerifierBuild,
  verifierReceipt,
  verifierRequest,
} from "../helpers/verifier-exchange-fixture.mjs";

const VERIFIER_IMAGE = `sha256:${"a".repeat(64)}`;

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

async function authorityFixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-authority-"));
  const runtime = await createVerifierRuntimeFixture(root);
  const replayStore = createSqliteVerifierReplayStore({
    databasePath: join(root, "verifier-replay.sqlite"),
  });
  t.after(async () => {
    replayStore.close();
    await rm(root, { recursive: true, force: true });
  });
  const clock = fixedVerifierClock();
  const authority = createVerifierExchangeAuthority({
    replayStore,
    now: clock.now,
    ...overrides,
  });
  const request = verifierRequest();
  const snapshot = authority.prepareSnapshot({
    layout: runtime.layout,
    request,
    attempt: 1,
    repairRunId: "repair-run-1",
    verifierImageDigest: VERIFIER_IMAGE,
  });
  return { root, runtime, replayStore, clock, authority, request, snapshot };
}

test("one-use HMAC receipt admits only a non-finalized deeply frozen verifier result", async (t) => {
  const fixture = await authorityFixture(t);
  const delivery = fixture.authority.issue(fixture.snapshot);
  assert.equal(Object.isFrozen(fixture.authority), true);
  assertVerifierExchangeAuthority(fixture.authority);
  assert.throws(() => assertVerifierExchangeAuthority({ ...fixture.authority }));
  assert.throws(() => fixture.authority.issue(fixture.snapshot));
  const capability = takeVerifierCapability(delivery);
  const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
  const receipt = verifierReceipt({
    request: fixture.request,
    snapshot: fixture.snapshot,
    challenge: delivery.challenge,
    capability,
    finalBuildTreeManifest,
  });
  fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
  const admitted = fixture.authority.admit(delivery, receipt);

  assert.equal(admitted.kind, "ADMITTED_VERIFIER_RECEIPT_NOT_RUNTIME_FINALIZED");
  assert.equal(admitted.liveClaim, false);
  assert.equal(admitted.passSigningEligible, false);
  assert.equal(admitted.externalSettlementEligible, false);
  assert.equal(admittedVerifierReceipt(admitted).status, "PASS");
  assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "CONSUMED");
  assertDeepFrozen(fixture.snapshot);
  assertDeepFrozen(delivery);
  assertDeepFrozen(admitted);
  assert.throws(() => takeVerifierCapability(delivery));
  assert.throws(() => fixture.authority.admit(delivery, receipt));
  assert.throws(() => parsePolicyVerificationEvidence(admitted));
  assert.throws(() => parseWorkerRpcV2Response(admitted));
  assert.throws(() => consumeValidatedExternalWorkerV2Run(admitted));

  const reviewAuthorization = authorizeVerifierReview(admitted);
  assert.throws(() => authorizeVerifierReview(admitted));
  consumeVerifierReviewAuthorization(reviewAuthorization);
  assert.throws(() => consumeVerifierReviewAuthorization(reviewAuthorization));
  assert.equal(reviewAuthorization.verifierReceiptSha256, receipt.receiptSha256);
  assert.equal(reviewAuthorization.liveClaim, false);
});

test("snapshot mutation, delivery copies, HMAC tamper, and candidate-shaped input poison or reject", async (t) => {
  await t.test("a copied delivery has no authority", async (t) => {
    const fixture = await authorityFixture(t);
    assert.throws(() => fixture.authority.issue(structuredClone(fixture.snapshot)));
    const delivery = fixture.authority.issue(fixture.snapshot);
    assert.throws(() => takeVerifierCapability(structuredClone(delivery)));
  });

  await t.test("source mutation after issuance poisons the durable challenge", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
    });
    await writeFile(
      join(fixture.runtime.layout.verificationRoot, "src", "refund.ts"),
      "export const changed = true;\n",
      "utf8",
    );
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("HMAC tamper fails closed", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
    });
    fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
    receipt.hmacSha256 = "0".repeat(64);
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("an authenticated reordered corpus still fails exact binding", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
    });
    receipt.policyVerification.results.reverse();
    const { receiptSha256: _receiptSha256, hmacSha256: _hmacSha256, ...unsigned } = receipt;
    receipt.receiptSha256 = verifierReceiptSha256(unsigned);
    receipt.hmacSha256 = verifierReceiptHmacSha256(capability, receipt.receiptSha256);
    fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("verifier and repair run identities cannot be reused", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
      verifierRunId: "repair-run-1",
    });
    fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("host build output must match the authenticated receipt manifest", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
    });
    await writeFile(
      join(fixture.runtime.layout.verificationRoot, "dist", "refund.js"),
      "export const tampered = true;\n",
      "utf8",
    );
    fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("unexpected nested source paths poison admission", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
    });
    await writeFile(
      join(fixture.runtime.layout.verificationRoot, "src", "extra.ts"),
      "export const unexpected = true;\n",
      "utf8",
    );
    fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("raw capability text cannot be reflected into an authenticated receipt", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
    });
    receipt.verifierRunId = capability;
    const { receiptSha256: _receiptSha256, hmacSha256: _hmacSha256, ...unsigned } = receipt;
    receipt.receiptSha256 = verifierReceiptSha256(unsigned);
    receipt.hmacSha256 = verifierReceiptHmacSha256(capability, receipt.receiptSha256);
    fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("command output cannot split and reflect a verifier capability", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    const capability = takeVerifierCapability(delivery);
    const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
    const receipt = verifierReceipt({
      request: fixture.request,
      snapshot: fixture.snapshot,
      challenge: delivery.challenge,
      capability,
      finalBuildTreeManifest,
    });
    receipt.commandEvidence[0].stdout = capability.slice(0, 21);
    receipt.commandEvidence[0].stderr = capability.slice(21);
    const { receiptSha256: _receiptSha256, hmacSha256: _hmacSha256, ...unsigned } = receipt;
    receipt.receiptSha256 = verifierReceiptSha256(unsigned);
    receipt.hmacSha256 = verifierReceiptHmacSha256(capability, receipt.receiptSha256);
    fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
    assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
    assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
  });

  await t.test("pre-authority candidate cannot enter receipt admission", async (t) => {
    const fixture = await authorityFixture(t);
    const delivery = fixture.authority.issue(fixture.snapshot);
    takeVerifierCapability(delivery);
    assert.throws(
      () => fixture.authority.admit(delivery, {
        schemaVersion: "1",
        kind: "UNSIGNED_VERIFIER_CORPUS_CANDIDATE",
        liveClaim: false,
      }),
      /admission failed/u,
    );
  });
});

test("failed receipt permits only one fresh-snapshot retry and never review", async (t) => {
  const fixture = await authorityFixture(t);
  const delivery = fixture.authority.issue(fixture.snapshot);
  const capability = takeVerifierCapability(delivery);
  const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
  const receipt = verifierReceipt({
    request: fixture.request,
    snapshot: fixture.snapshot,
    challenge: delivery.challenge,
    capability,
    finalBuildTreeManifest,
    status: "FAIL",
  });
  fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
  const admitted = fixture.authority.admit(delivery, receipt);
  assert.throws(() => authorizeVerifierReview(admitted));
  const retry = authorizeVerifierRetry(admitted);
  assert.throws(() => authorizeVerifierRetry(admitted));
  assert.equal(retry.kind, "FRESH_VERIFIER_SNAPSHOT_RETRY_REQUIRED");
  assert.equal(retry.nextAttempt, 2);
  assert.equal(retry.requiresFreshSnapshot, true);
  assert.equal(retry.requiresFreshCapability, true);
  assert.throws(() => fixture.authority.prepareSnapshot({
    layout: fixture.runtime.layout,
    request: fixture.request,
    attempt: 2,
    repairRunId: "repair-run-2",
    verifierImageDigest: VERIFIER_IMAGE,
  }));
  const retryRuntime = await createVerifierRuntimeFixture(join(fixture.root, "retry"));
  const retrySnapshot = fixture.authority.prepareRetrySnapshot({
    authorization: retry,
    layout: retryRuntime.layout,
    request: fixture.request,
    repairRunId: "repair-run-2",
    verifierImageDigest: VERIFIER_IMAGE,
  });
  assert.equal(retrySnapshot.attempt, 2);
  assert.notEqual(retrySnapshot.snapshotSha256, fixture.snapshot.snapshotSha256);
  const retryDelivery = fixture.authority.issue(retrySnapshot);
  const retryCapability = takeVerifierCapability(retryDelivery);
  assert.notEqual(retryCapability, capability);
  assert.throws(() => consumeVerifierRetryAuthorization(retry));
});

test("snapshots, deliveries, and retry rights remain owned by one replay authority", async (t) => {
  const rootA = await mkdtemp(join(tmpdir(), "policytwin-verifier-owner-a-"));
  const rootB = await mkdtemp(join(tmpdir(), "policytwin-verifier-owner-b-"));
  const runtimeA = await createVerifierRuntimeFixture(rootA);
  const storeA = createSqliteVerifierReplayStore({ databasePath: join(rootA, "replay.sqlite") });
  const storeB = createSqliteVerifierReplayStore({ databasePath: join(rootB, "replay.sqlite") });
  t.after(async () => {
    storeA.close();
    storeB.close();
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });
  const clock = fixedVerifierClock();
  const authorityA = createVerifierExchangeAuthority({ replayStore: storeA, now: clock.now });
  const authorityB = createVerifierExchangeAuthority({ replayStore: storeB, now: clock.now });
  const request = verifierRequest();
  const snapshot = authorityA.prepareSnapshot({
    layout: runtimeA.layout,
    request,
    attempt: 1,
    repairRunId: "repair-run-owner-1",
    verifierImageDigest: VERIFIER_IMAGE,
  });
  assert.throws(() => authorityB.issue(snapshot), /different replay authority/u);
  const delivery = authorityA.issue(snapshot);
  const capability = takeVerifierCapability(delivery);
  const finalBuildTreeManifest = await materializeVerifierBuild(runtimeA.layout);
  const receipt = verifierReceipt({
    request,
    snapshot,
    challenge: delivery.challenge,
    capability,
    finalBuildTreeManifest,
    status: "FAIL",
  });
  assert.throws(() => authorityB.admit(delivery, receipt));
  clock.state.value = new Date("2026-07-18T10:01:03.000Z");
  const admitted = authorityA.admit(delivery, receipt);
  const retry = authorizeVerifierRetry(admitted);
  const retryRuntime = await createVerifierRuntimeFixture(join(rootA, "retry"));
  const retryInput = {
    authorization: retry,
    layout: retryRuntime.layout,
    request,
    repairRunId: "repair-run-owner-2",
    verifierImageDigest: VERIFIER_IMAGE,
  };
  assert.throws(() => authorityB.prepareRetrySnapshot(retryInput));
  assert.equal(authorityA.prepareRetrySnapshot(retryInput).attempt, 2);
});

test("durable time high-water rejects a receipt after system clock rollback", async (t) => {
  const fixture = await authorityFixture(t, { challengeTtlMs: 1_000 });
  const delivery = fixture.authority.issue(fixture.snapshot);
  const capability = takeVerifierCapability(delivery);
  const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
  const receipt = verifierReceipt({
    request: fixture.request,
    snapshot: fixture.snapshot,
    challenge: delivery.challenge,
    capability,
    finalBuildTreeManifest,
    startedAt: "2026-07-18T10:01:00.100Z",
    completedAt: "2026-07-18T10:01:00.500Z",
  });

  const laterRuntime = await createVerifierRuntimeFixture(join(fixture.root, "later"));
  const laterSnapshot = fixture.authority.prepareSnapshot({
    layout: laterRuntime.layout,
    request: verifierRequest({ requestId: "6".repeat(32) }),
    attempt: 1,
    repairRunId: "repair-run-later",
    verifierImageDigest: VERIFIER_IMAGE,
  });
  const laterDelivery = fixture.authority.issue(laterSnapshot);

  fixture.clock.state.value = new Date("2026-07-18T10:01:02.000Z");
  assert.equal(fixture.replayStore.consume({
    challengeId: laterDelivery.challenge.challengeId,
    capabilitySha256: laterDelivery.challenge.capabilitySha256,
    challengeSha256: laterDelivery.challenge.challengeSha256,
    requestSha256: laterDelivery.challenge.requestSha256,
    snapshotSha256: laterDelivery.challenge.snapshotSha256,
    verifierImageDigest: laterDelivery.challenge.verifierImageDigest,
    attempt: laterDelivery.challenge.attempt,
    repairRunId: laterDelivery.challenge.repairRunId,
    receiptSha256: "d".repeat(64),
    verifierRunId: "expired-high-water-run",
  }, fixture.clock.state.value), false);

  fixture.clock.state.value = new Date("2026-07-18T10:01:00.600Z");
  assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);
  assert.equal(fixture.replayStore.inspect(delivery.challenge.challengeId)?.state, "POISONED");
});

test("challenge TTL expiry cannot reopen the same active request attempt", async (t) => {
  const fixture = await authorityFixture(t, { challengeTtlMs: 1_000 });
  const firstDelivery = fixture.authority.issue(fixture.snapshot);
  fixture.clock.state.value = new Date("2026-07-18T10:01:02.000Z");
  const repeatedRuntime = await createVerifierRuntimeFixture(join(fixture.root, "repeated"));
  const repeatedSnapshot = fixture.authority.prepareSnapshot({
    layout: repeatedRuntime.layout,
    request: fixture.request,
    attempt: 1,
    repairRunId: "repair-run-repeated",
    verifierImageDigest: VERIFIER_IMAGE,
  });
  assert.throws(() => fixture.authority.issue(repeatedSnapshot));
  assert.equal(
    fixture.replayStore.inspect(firstDelivery.challenge.challengeId)?.state,
    "ISSUED",
  );
});

test("challenge expiry and inactive Worker RPC request fail before authority promotion", async (t) => {
  const fixture = await authorityFixture(t, { challengeTtlMs: 1_000 });
  const delivery = fixture.authority.issue(fixture.snapshot);
  const capability = takeVerifierCapability(delivery);
  const finalBuildTreeManifest = await materializeVerifierBuild(fixture.runtime.layout);
  const receipt = verifierReceipt({
    request: fixture.request,
    snapshot: fixture.snapshot,
    challenge: delivery.challenge,
    capability,
    finalBuildTreeManifest,
    completedAt: delivery.challenge.expiresAt,
  });
  fixture.clock.state.value = new Date(delivery.challenge.expiresAt);
  assert.throws(() => fixture.authority.admit(delivery, receipt), /admission failed/u);

  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-inactive-"));
  const runtime = await createVerifierRuntimeFixture(root);
  const replayStore = createSqliteVerifierReplayStore({ databasePath: join(root, "replay.sqlite") });
  t.after(async () => {
    replayStore.close();
    await rm(root, { recursive: true, force: true });
  });
  const authority = createVerifierExchangeAuthority({
    replayStore,
    now: () => new Date("2026-07-18T09:59:59.000Z"),
  });
  assert.throws(() => authority.prepareSnapshot({
    layout: runtime.layout,
    request: verifierRequest(),
    attempt: 1,
    repairRunId: "repair-run-1",
    verifierImageDigest: VERIFIER_IMAGE,
  }), /inactive/u);
});

test("verifier authority modules and capabilities are absent from the package root", () => {
  for (const name of [
    "createVerifierExchangeAuthority",
    "createSqliteVerifierReplayStore",
    "takeVerifierCapability",
    "authorizeVerifierReview",
  ]) {
    assert.equal(name in policyTwin, false);
  }
});
