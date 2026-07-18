import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as policyTwin from "../../dist/index.js";
import {
  createVerifierExchangeAuthority,
  takeVerifierCapability,
} from "../../dist/codex/verifier-exchange-authority.js";
import {
  createRepairVerifierReviewBridge,
} from "../../dist/codex/repair-verifier-review-bridge.js";
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
  verifierBridgeRepair,
  verifierBridgeReview,
  verifierBridgeReviewSubmission,
  verifierReceipt,
  verifierRequest,
} from "../helpers/verifier-exchange-fixture.mjs";

const VERIFIER_IMAGE = `sha256:${"a".repeat(64)}`;

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

async function bridgeFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-review-bridge-"));
  const runtime = await createVerifierRuntimeFixture(root);
  const replayStore = createSqliteVerifierReplayStore({
    databasePath: join(root, "verifier-replay.sqlite"),
  });
  t.after(async () => {
    replayStore.close();
    await rm(root, { recursive: true, force: true });
  });
  const clock = fixedVerifierClock();
  const authority = createVerifierExchangeAuthority({ replayStore, now: clock.now });
  const bridge = createRepairVerifierReviewBridge({
    authority,
    expectedExecutionMode: "OFFLINE_TEST_DOUBLE",
    now: clock.now,
  });
  const request = verifierRequest();
  return { root, runtime, replayStore, clock, authority, bridge, request };
}

async function admitAttempt(fixture, attempt, layout, status = "PASS", times = {}) {
  const capability = takeVerifierCapability(attempt.delivery);
  const finalBuildTreeManifest = await materializeVerifierBuild(layout);
  const receipt = verifierReceipt({
    request: fixture.request,
    snapshot: attempt.snapshot,
    challenge: attempt.delivery.challenge,
    capability,
    finalBuildTreeManifest,
    status,
    verifierRunId: times.verifierRunId,
    startedAt: times.startedAt,
    completedAt: times.completedAt,
  });
  return { capability, receipt, outcome: fixture.bridge.admitVerifierReceipt(attempt, receipt) };
}

async function passOutcome(t) {
  const fixture = await bridgeFixture(t);
  const attempt = fixture.bridge.prepareInitialAttempt({
    layout: fixture.runtime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request),
    verifierImageDigest: VERIFIER_IMAGE,
  });
  fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
  const admitted = await admitAttempt(fixture, attempt, fixture.runtime.layout);
  fixture.clock.state.value = new Date("2026-07-18T10:01:06.000Z");
  return { fixture, attempt, ...admitted };
}

test("PASS receipt permits one later review and remains non-finalized", async (t) => {
  const fixture = await bridgeFixture(t);
  const attempt = fixture.bridge.prepareInitialAttempt({
    layout: fixture.runtime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request),
    verifierImageDigest: VERIFIER_IMAGE,
  });
  fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
  const { receipt, outcome } = await admitAttempt(fixture, attempt, fixture.runtime.layout);
  assert.equal(outcome.kind, "VERIFIER_REVIEW_REQUIRED_NOT_RUNTIME_FINALIZED");
  assert.equal(outcome.verifierReceiptSha256, receipt.receiptSha256);
  assert.throws(() => fixture.bridge.admitVerifierReceipt(attempt, receipt));

  fixture.clock.state.value = new Date("2026-07-18T10:01:06.000Z");
  const result = fixture.bridge.bindReview(
    outcome,
    verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request)),
  );
  assert.equal(result.kind, "REPAIR_VERIFIER_REVIEW_BRIDGE_RESULT");
  assert.equal(result.status, "BOUND_NOT_RUNTIME_FINALIZED");
  assert.equal(result.outcome, "STRUCTURAL_REVIEW_APPROVED");
  assert.equal(result.verifierReceiptSha256, receipt.receiptSha256);
  assert.equal(result.review.verdict, "APPROVE");
  assert.equal(result.finalExecutionTreeSha256, receipt.finalExecutionTreeSha256);
  assert.equal(result.reviewBindingSha256, outcome.reviewBindingSha256);
  assert.equal(
    result.reviewAuthority,
    "CALLER_SUPPLIED_REVIEW_ECHO_BOUND_NOT_RUNTIME_REVIEW_PROOF",
  );
  assert.equal(result.liveClaim, false);
  assert.equal(result.passSigningEligible, false);
  assert.equal(result.externalSettlementEligible, false);
  assertDeepFrozen(result);
  assert.throws(() => fixture.bridge.bindReview(
    outcome,
    verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request)),
  ));
  assert.throws(() => parsePolicyVerificationEvidence(result));
  assert.throws(() => parseWorkerRpcV2Response(result));
  assert.throws(() => consumeValidatedExternalWorkerV2Run(result));
});

test("FAIL attempt one permits only a fresh attempt-two snapshot and terminal verifier failure", async (t) => {
  const fixture = await bridgeFixture(t);
  const firstAttempt = fixture.bridge.prepareInitialAttempt({
    layout: fixture.runtime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request),
    verifierImageDigest: VERIFIER_IMAGE,
  });
  fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
  const first = await admitAttempt(fixture, firstAttempt, fixture.runtime.layout, "FAIL");
  assert.equal(first.outcome.kind, "VERIFIER_RETRY_REQUIRED_NOT_RUNTIME_FINALIZED");
  assert.throws(() => fixture.bridge.bindReview(
    first.outcome,
    verifierBridgeReviewSubmission(first.outcome, verifierBridgeReview(fixture.request)),
  ));

  const retryRuntime = await createVerifierRuntimeFixture(join(fixture.root, "retry"));
  fixture.clock.state.value = new Date("2026-07-18T10:01:10.000Z");
  assert.throws(() => fixture.bridge.prepareRetry(first.outcome, {
    layout: retryRuntime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request, "repair-run-premature", {
      metadata: {
        startedAt: "2026-07-18T10:00:30.000Z",
        completedAt: "2026-07-18T10:00:40.000Z",
      },
    }),
    verifierImageDigest: VERIFIER_IMAGE,
  }));
  const secondAttempt = fixture.bridge.prepareRetry(first.outcome, {
    layout: retryRuntime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request, "repair-run-2", {
      metadata: {
        startedAt: "2026-07-18T10:01:07.000Z",
        completedAt: "2026-07-18T10:01:08.000Z",
      },
    }),
    verifierImageDigest: VERIFIER_IMAGE,
  });
  assert.equal(secondAttempt.attempt, 2);
  assert.notEqual(secondAttempt.snapshot.snapshotSha256, firstAttempt.snapshot.snapshotSha256);
  assert.throws(() => fixture.bridge.prepareRetry(first.outcome, {
    layout: retryRuntime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request, "repair-run-reused"),
    verifierImageDigest: VERIFIER_IMAGE,
  }));

  fixture.clock.state.value = new Date("2026-07-18T10:01:13.000Z");
  const second = await admitAttempt(fixture, secondAttempt, retryRuntime.layout, "FAIL", {
    verifierRunId: "verifier-receipt-run-2",
    startedAt: "2026-07-18T10:01:11.000Z",
    completedAt: "2026-07-18T10:01:12.000Z",
  });
  assert.equal(second.outcome.kind, "REPAIR_VERIFIER_REVIEW_BRIDGE_RESULT");
  assert.equal(second.outcome.status, "BOUND_NOT_RUNTIME_FINALIZED");
  assert.equal(second.outcome.outcome, "VERIFIER_FAILED");
  assert.equal(second.outcome.review, null);
  assert.equal(second.outcome.attempt, 2);
});

test("copied review outcomes and repeated run identities are rejected", async (t) => {
  const fixture = await bridgeFixture(t);
  const attempt = fixture.bridge.prepareInitialAttempt({
    layout: fixture.runtime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request),
    verifierImageDigest: VERIFIER_IMAGE,
  });
  fixture.clock.state.value = new Date("2026-07-18T10:01:03.000Z");
  const { outcome } = await admitAttempt(fixture, attempt, fixture.runtime.layout);
  assert.throws(() => fixture.bridge.bindReview(
    structuredClone(outcome),
    verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request)),
  ));
  fixture.clock.state.value = new Date("2026-07-18T10:01:06.000Z");
  assert.throws(() => fixture.bridge.bindReview(
    outcome,
    verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request, {
      runId: "repair-run-1",
    })),
  ));
});

test("review submission binding and the admitted verifier tree are revalidated", async (t) => {
  await t.test("a changed review binding is fail-stop", async (t) => {
    const { fixture, outcome } = await passOutcome(t);
    const submission = verifierBridgeReviewSubmission(
      outcome,
      verifierBridgeReview(fixture.request),
    );
    submission.reviewBindingSha256 = "0".repeat(64);
    assert.throws(() => fixture.bridge.bindReview(outcome, submission));
    assert.throws(() => fixture.bridge.bindReview(
      outcome,
      verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request)),
    ));
  });

  await t.test("source mutation after receipt admission blocks review", async (t) => {
    const { fixture, outcome } = await passOutcome(t);
    await writeFile(
      join(fixture.runtime.layout.verificationRoot, "src", "refund.ts"),
      "export const changedAfterVerification = true;\n",
      "utf8",
    );
    assert.throws(() => fixture.bridge.bindReview(
      outcome,
      verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request)),
    ));
  });

  await t.test("final build mutation after receipt admission blocks review", async (t) => {
    const { fixture, outcome } = await passOutcome(t);
    await writeFile(
      join(fixture.runtime.layout.verificationRoot, "dist", "refund.js"),
      "export const changedBuildAfterVerification = true;\n",
      "utf8",
    );
    assert.throws(() => fixture.bridge.bindReview(
      outcome,
      verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request)),
    ));
    assert.throws(() => fixture.bridge.bindReview(
      outcome,
      verifierBridgeReviewSubmission(outcome, verifierBridgeReview(fixture.request)),
    ));
  });

  await t.test("review metadata must echo the server-owned review request binding", async (t) => {
    const { fixture, outcome } = await passOutcome(t);
    const submission = verifierBridgeReviewSubmission(
      outcome,
      verifierBridgeReview(fixture.request),
    );
    submission.review.metadata.requestSha256 = "1".repeat(64);
    assert.throws(() => fixture.bridge.bindReview(outcome, submission));
  });
});

test("review model, backend, and post-receipt timestamps are independently enforced", async (t) => {
  const cases = [
    {
      name: "model drift",
      overrides: { metadata: { model: "different-model" } },
    },
    {
      name: "backend drift",
      overrides: { metadata: { backendId: "different-backend" } },
    },
    {
      name: "review started before receipt",
      overrides: { startedAt: "2026-07-18T10:01:01.500Z" },
    },
    {
      name: "review completed at request expiry",
      overrides: { completedAt: "2026-07-18T10:05:00.000Z" },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const { fixture, outcome } = await passOutcome(t);
      assert.throws(() => fixture.bridge.bindReview(
        outcome,
        verifierBridgeReviewSubmission(
          outcome,
          verifierBridgeReview(fixture.request, entry.overrides),
        ),
      ));
    });
  }
});

test("bridge is factory-issued, unexported, and statically isolated from finalization consumers", async () => {
  assert.throws(() => createRepairVerifierReviewBridge({
    authority: {},
    expectedExecutionMode: "OFFLINE_TEST_DOUBLE",
  }));
  for (const name of [
    "createRepairVerifierReviewBridge",
    "createVerifierExchangeAuthority",
    "takeVerifierCapability",
  ]) {
    assert.equal(name in policyTwin, false);
  }
  const source = await readFile(
    new URL("../../src/codex/repair-verifier-review-bridge.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "parseWorkerRpcV2Response",
    "consumeValidatedExternalWorkerV2Run",
    "markSucceeded",
    "finalizedEvidenceCapabilities",
    "buildSignedV2Response",
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
});

test("two bridge instances cannot issue the same durable request attempt", async (t) => {
  const fixture = await bridgeFixture(t);
  const secondBridge = createRepairVerifierReviewBridge({
    authority: fixture.authority,
    expectedExecutionMode: "OFFLINE_TEST_DOUBLE",
    now: fixture.clock.now,
  });
  fixture.bridge.prepareInitialAttempt({
    layout: fixture.runtime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request),
    verifierImageDigest: VERIFIER_IMAGE,
  });
  const secondRuntime = await createVerifierRuntimeFixture(join(fixture.root, "duplicate"));
  assert.throws(() => secondBridge.prepareInitialAttempt({
    layout: secondRuntime.layout,
    request: fixture.request,
    repair: verifierBridgeRepair(fixture.request, "repair-run-duplicate"),
    verifierImageDigest: VERIFIER_IMAGE,
  }));
});
