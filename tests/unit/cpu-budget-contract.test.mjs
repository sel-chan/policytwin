import assert from "node:assert/strict";
import test from "node:test";
import {
  StaticSupervisorCpuBudgetLedger,
  createStaticSupervisorCpuBudgetController,
  createUnavailableSupervisorCpuBudgetController,
  parseStaticSupervisorCpuBudgetProof,
} from "../../dist/codex/cpu-budget-contract.js";

const REQUEST_SHA256 = "a".repeat(64);
const BINDING_SHA256 = "b".repeat(64);
const signal = new AbortController().signal;

function identity(role, index) {
  return {
    role,
    containerId: index.toString(16).repeat(64),
    pid: 1_000 + index,
    startedAt: `2026-07-16T00:00:0${index}.000000000Z`,
    cgroupIdentitySha256: (index + 8).toString(16).repeat(64),
  };
}

function startObservation(role, index) {
  const { cgroupIdentitySha256: _ignored, ...observation } = identity(role, index);
  return observation;
}

function finishSuccessfulLedger(budgetUsec = 100n) {
  const ledger = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec,
  });
  const egress = identity("egress", 1);
  const worker = identity("worker", 2);
  const verifier = identity("verifier", 3);
  ledger.beginRole(egress, 10n);
  ledger.beginRole(worker, 20n);
  ledger.sampleRole(egress, 20n);
  ledger.finishRole(worker, 60n);
  ledger.finishRole(egress, 30n);
  ledger.beginRole(verifier, 100n);
  ledger.finishRole(verifier, 140n);
  return ledger;
}

test("static CPU ledger accepts the exact three-role aggregate budget", () => {
  const proof = finishSuccessfulLedger().finalize();
  assert.equal(proof.aggregateUsageUsec, "100");
  assert.deepEqual(
    proof.roles.map(({ role, deltaUsageUsec }) => ({ role, deltaUsageUsec })),
    [
      { role: "egress", deltaUsageUsec: "20" },
      { role: "worker", deltaUsageUsec: "40" },
      { role: "verifier", deltaUsageUsec: "40" },
    ],
  );
  assert.equal(proof.cumulativeCpuTimeEnforced, false);
  assert.equal(proof.hardLimitEnforced, false);
  assert.equal(proof.overshootBounded, false);
  assert.equal(proof.containmentTriggered, false);
});

test("static CPU ledger poisons on one microsecond over budget", () => {
  assert.throws(() => finishSuccessfulLedger(99n), /exceeded/u);
});

test("static CPU ledger sums concurrent egress and worker usage", () => {
  const ledger = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  const egress = identity("egress", 1);
  const worker = identity("worker", 2);
  ledger.beginRole(egress, 0n);
  ledger.beginRole(worker, 0n);
  ledger.finishRole(worker, 50n);
  assert.throws(() => ledger.finishRole(egress, 60n), /exceeded/u);
  assert.throws(() => ledger.finalize(), /poisoned/u);
});

test("static CPU ledger charges verifier use against the same remaining budget", () => {
  const ledger = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  const egress = identity("egress", 1);
  const worker = identity("worker", 2);
  const verifier = identity("verifier", 3);
  ledger.beginRole(egress, 0n);
  ledger.beginRole(worker, 0n);
  ledger.finishRole(worker, 40n);
  ledger.finishRole(egress, 40n);
  ledger.beginRole(verifier, 0n);
  assert.throws(() => ledger.finishRole(verifier, 21n), /exceeded/u);
});

test("static CPU ledger rejects regression, identity drift, and invalid role order", () => {
  const ledger = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  const egress = identity("egress", 1);
  ledger.beginRole(egress, 10n);
  ledger.sampleRole(egress, 20n);
  assert.throws(() => ledger.sampleRole(egress, 19n), /non-monotonic/u);
  assert.throws(() => ledger.sampleRole(egress, 21n), /poisoned/u);

  const drift = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  drift.beginRole(egress, 0n);
  assert.throws(
    () => drift.sampleRole({ ...egress, pid: egress.pid + 1 }, 1n),
    /identity-drifted/u,
  );

  const order = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  assert.throws(() => order.beginRole(identity("worker", 2), 0n), /out of order/u);
});

test("static CPU ledger rejects incomplete, reused, zero-time, and uint64-overflow identities", () => {
  const incomplete = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  incomplete.beginRole(identity("egress", 1), 0n);
  assert.throws(() => incomplete.finalize(), /incomplete/u);

  const reused = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  const egress = identity("egress", 1);
  reused.beginRole(egress, 0n);
  assert.throws(
    () => reused.beginRole({ ...identity("worker", 2), containerId: egress.containerId }, 0n),
    /reused/u,
  );

  const invalidTime = new StaticSupervisorCpuBudgetLedger({
    requestSha256: REQUEST_SHA256,
    bindingSha256: BINDING_SHA256,
    budgetUsec: 100n,
  });
  assert.throws(
    () => invalidTime.beginRole({ ...egress, startedAt: "0001-01-01T00:00:00Z" }, 0n),
    /timestamp/u,
  );

  assert.throws(
    () =>
      new StaticSupervisorCpuBudgetLedger({
        requestSha256: REQUEST_SHA256,
        bindingSha256: BINDING_SHA256,
        budgetUsec: 1n << 64n,
      }),
    /binding/u,
  );
});

test("static CPU proof parser rejects unbound or forged claims", () => {
  const proof = finishSuccessfulLedger().finalize();
  assert.equal(
    parseStaticSupervisorCpuBudgetProof(proof, {
      requestSha256: REQUEST_SHA256,
      bindingSha256: BINDING_SHA256,
      budgetUsec: 100n,
    }).aggregateUsageUsec,
    "100",
  );

  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value.requestSha256 = "c".repeat(64); },
    (value) => { value.bindingSha256 = "c".repeat(64); },
    (value) => { value.aggregateUsageUsec = "99"; },
    (value) => { value.cumulativeCpuTimeEnforced = true; },
    (value) => { value.hardLimitEnforced = true; },
    (value) => { value.overshootBounded = true; },
    (value) => { value.containmentTriggered = true; },
    (value) => { value.roles.pop(); },
    (value) => { value.roles[1].identity.containerId = value.roles[0].identity.containerId; },
    (value) => { value.roles[2].deltaUsageUsec = "41"; },
  ]) {
    const forged = structuredClone(proof);
    mutate(forged);
    assert.throws(
      () =>
        parseStaticSupervisorCpuBudgetProof(forged, {
          requestSha256: REQUEST_SHA256,
          bindingSha256: BINDING_SHA256,
          budgetUsec: 100n,
        }),
      /CPU|supervisor|budget|proof|usage|identity/u,
    );
  }
});

test("static fake controller preserves role and cleanup order without live claims", async () => {
  const events = [];
  const controller = createStaticSupervisorCpuBudgetController({
    roles: [
      {
        role: "egress",
        cgroupIdentitySha256: "9".repeat(64),
        baselineUsageUsec: 10n,
        sampledUsageUsec: [15n],
        finalUsageUsec: 20n,
      },
      {
        role: "worker",
        cgroupIdentitySha256: "a".repeat(64),
        baselineUsageUsec: 20n,
        sampledUsageUsec: [],
        finalUsageUsec: 50n,
      },
      {
        role: "verifier",
        cgroupIdentitySha256: "b".repeat(64),
        baselineUsageUsec: 100n,
        sampledUsageUsec: [],
        finalUsageUsec: 120n,
      },
    ],
    onEvent(event) {
      events.push(event);
    },
  });
  const session = await controller.begin(
    { requestSha256: REQUEST_SHA256, bindingSha256: BINDING_SHA256, budgetUsec: 60n },
    signal,
  );
  const egress = await session.roleStarted(startObservation("egress", 1), signal);
  const worker = await session.roleStarted(startObservation("worker", 2), signal);
  await session.roleStopped(worker, signal);
  await session.roleStopped(egress, signal);
  const verifier = await session.roleStarted(startObservation("verifier", 3), signal);
  await session.roleStopped(verifier, signal);
  const proof = await session.finalize(signal);
  assert.equal(proof.aggregateUsageUsec, "60");
  await session.beginCleanup("SUCCESS", signal);
  assert.equal(await session.completeCleanup(signal), true);
  assert.deepEqual(events, [
    "cpu:begin",
    "cpu:start:egress",
    "cpu:start:worker",
    "cpu:stop:worker",
    "cpu:stop:egress",
    "cpu:start:verifier",
    "cpu:stop:verifier",
    "cpu:finalize",
    "cpu:cleanup-begin:SUCCESS",
    "cpu:cleanup-complete",
  ]);
});

test("static fake and unavailable controllers fail closed", async () => {
  const unavailable = createUnavailableSupervisorCpuBudgetController();
  await assert.rejects(
    unavailable.begin(
      { requestSha256: REQUEST_SHA256, bindingSha256: BINDING_SHA256, budgetUsec: 1n },
      signal,
    ),
    /unavailable/u,
  );

  assert.throws(
    () =>
      createStaticSupervisorCpuBudgetController({
        roles: [
          {
            role: "worker",
            cgroupIdentitySha256: "9".repeat(64),
            baselineUsageUsec: 0n,
            sampledUsageUsec: [],
            finalUsageUsec: 0n,
          },
          {
            role: "egress",
            cgroupIdentitySha256: "a".repeat(64),
            baselineUsageUsec: 0n,
            sampledUsageUsec: [],
            finalUsageUsec: 0n,
          },
          {
            role: "verifier",
            cgroupIdentitySha256: "b".repeat(64),
            baselineUsageUsec: 0n,
            sampledUsageUsec: [],
            finalUsageUsec: 0n,
          },
        ],
      }),
    /script/u,
  );
});
