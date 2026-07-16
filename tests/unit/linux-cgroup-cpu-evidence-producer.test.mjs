import assert from "node:assert/strict";
import test from "node:test";
import {
  createLinuxCgroupCpuEvidenceV2Producer,
} from "../../dist/codex/linux-cgroup-cpu-evidence-producer.js";
import {
  parseLiveLinuxCgroupCpuEvidenceV2,
} from "../../dist/codex/live-linux-cgroup-cpu-evidence-v2.js";

const BASE = Object.freeze({
  requestId: "a".repeat(32),
  runNonce: Buffer.alloc(32, 0xbb).toString("base64url"),
  requestSha256: "c".repeat(64),
  executionBindingSha256: "d".repeat(64),
  supervisorRunId: "linux-supervisor-run-0001",
  workerImageDigest: `sha256:${"e".repeat(64)}`,
  workerPolicySha256: "f".repeat(64),
  acceptedCorpusSha256: "1".repeat(64),
  budgetUsec: 100n,
});

const ROLE_INDEX = Object.freeze({ egress: 1, worker: 2, verifier: 3 });

function dockerObservation(role) {
  const index = ROLE_INDEX[role];
  return {
    role,
    containerId: String(index).repeat(64),
    pid: 10_000 + index,
    startedAt: `2026-07-16T01:00:0${index}.000000000Z`,
  };
}

function expectedBinding() {
  return {
    requestId: BASE.requestId,
    runNonce: BASE.runNonce,
    requestSha256: BASE.requestSha256,
    executionBindingSha256: BASE.executionBindingSha256,
    supervisorRunId: BASE.supervisorRunId,
    workerImageDigest: BASE.workerImageDigest,
    workerPolicySha256: BASE.workerPolicySha256,
    acceptedCorpusSha256: BASE.acceptedCorpusSha256,
    budgetUsec: BASE.budgetUsec,
  };
}

function createSystem(options = {}) {
  const usage = new Map(
    Object.entries(
      options.usage ?? {
        egress: [0n, 5n, 10n],
        worker: [0n, 20n],
        verifier: [0n, 30n],
      },
    ).map(([role, values]) => [role, [...values]]),
  );
  const released = options.released ?? { egress: true, worker: true, verifier: true };
  const releaseSequence = new Map(
    Object.entries(options.releaseSequence ?? {}).map(([role, values]) => [role, [...values]]),
  );
  const stopSequence = [...(options.stopSequence ?? [])];
  const events = [];
  let clock = 100n;
  const nextClock = () => {
    if (options.sameTimestamp === true) return 100n;
    const value = clock;
    clock += 10n;
    return value;
  };
  return {
    system: Object.freeze({
      provenance: options.provenance ?? "SYNTHETIC_CONTRACT",
      controllerIdentitySha256: "9".repeat(64),
      async monotonicRawNs(signal) {
        if (signal.aborted) throw signal.reason;
        return nextClock();
      },
      async bindRole(observation, signal) {
        if (signal.aborted) throw signal.reason;
        events.push(`bind:${observation.role}`);
        if (options.bindGate !== undefined) await options.bindGate;
        const values = usage.get(observation.role);
        if (values === undefined || values.length === 0) throw new Error("missing baseline");
        return {
          cgroupIdentitySha256:
            options.duplicateIdentity === true
              ? "8".repeat(64)
              : String(ROLE_INDEX[observation.role] + 5).repeat(64),
          usageUsec: values.shift(),
        };
      },
      async readUsageUsec(identity, signal) {
        options.beforeRead?.(identity);
        if (signal.aborted) throw signal.reason;
        events.push(`sample:${identity.role}`);
        const values = usage.get(identity.role);
        if (values === undefined || values.length === 0) throw new Error("missing sample");
        return {
          cgroupIdentitySha256:
            options.identityDrift === identity.role
              ? "7".repeat(64)
              : identity.cgroupIdentitySha256,
          usageUsec: values.shift(),
        };
      },
      async freezeRoles(roles, signal) {
        if (signal.aborted) throw signal.reason;
        events.push(`freeze:${roles.map((role) => role.role).join(",")}`);
        return options.freeze !== false;
      },
      async killRoles(roles, signal) {
        if (signal.aborted) throw signal.reason;
        events.push(`kill:${roles.map((role) => role.role).join(",")}`);
        return options.kill !== false;
      },
      async reapRoles(roles, signal) {
        if (signal.aborted) throw signal.reason;
        events.push(`reap:${roles.map((role) => role.role).join(",")}`);
        return {
          succeeded: options.reap !== false,
          remainingProcessCount: options.remainingProcessCount ?? 0,
        };
      },
      async roleReleased(identity, signal) {
        if (signal.aborted) throw signal.reason;
        events.push(`release:${identity.role}`);
        const values = releaseSequence.get(identity.role);
        if (values !== undefined && values.length > 0) return values.shift();
        return released[identity.role] === true;
      },
      async stopController(signal) {
        if (signal.aborted) throw signal.reason;
        events.push("controller:stop");
        if (stopSequence.length > 0) return stopSequence.shift();
        return options.stop !== false;
      },
    }),
    events,
  };
}

async function runSuccessfulProducer(system, options = {}) {
  const signal = new AbortController().signal;
  const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
  await session.bindRole(dockerObservation("egress"), signal);
  await session.markExecutionStarted("egress", signal);
  await session.bindRole(dockerObservation("worker"), signal);
  await session.markExecutionStarted("worker", signal);
  if (options.skipEgressOverlapSample !== true) {
    await session.sampleRole("egress", signal);
  }
  await session.markExecutionStopped("worker", signal);
  await session.markRoleReleased("worker", signal);
  await session.markExecutionStopped("egress", signal);
  await session.markRoleReleased("egress", signal);
  await session.bindRole(dockerObservation("verifier"), signal);
  await session.markExecutionStarted("verifier", signal);
  await session.markExecutionStopped("verifier", signal);
  await session.markRoleReleased("verifier", signal);
  return options.nonCpuFailure === true
    ? await session.finalizeNonCpuFailure(
        "VERIFICATION",
        "VERIFICATION_FAILED",
        signal,
      )
    : await session.finalizeSuccess(signal);
}

test("producer derives one unsigned within-budget candidate from the exact global transcript", async () => {
  const { system } = createSystem();
  const candidate = await runSuccessfulProducer(system);
  assert.equal(candidate.schemaVersion, "1");
  assert.equal(candidate.status, "UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE");
  assert.equal(candidate.sourceProvenance, "SYNTHETIC_CONTRACT");
  assert.equal(candidate.liveClaim, false);
  assert.equal(candidate.passSigningEligible, false);

  const evidence = parseLiveLinuxCgroupCpuEvidenceV2(candidate.evidence, expectedBinding());
  assert.equal(evidence.outcome, "OBSERVED_WITHIN_BUDGET");
  assert.equal(evidence.aggregateUsageUsec, "60");
  assert.deepEqual(
    evidence.roles.map(({ role, deltaUsageUsec }) => ({ role, deltaUsageUsec })),
    [
      { role: "egress", deltaUsageUsec: "10" },
      { role: "worker", deltaUsageUsec: "20" },
      { role: "verifier", deltaUsageUsec: "30" },
    ],
  );
  assert.equal(evidence.events[0].eventType, "CONTROLLER_STARTED");
  assert.equal(evidence.events.at(-1).eventType, "CONTROLLER_STOPPED");
  assert.equal(
    evidence.events.every((event, index) => event.sequence === index + 1),
    true,
  );
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.evidence.events), true);
  assert.throws(() => {
    candidate.evidence.outcome = "PRE_EXECUTION_REJECTED";
  }, TypeError);
});

test("producer retains a complete CPU observation for a non-CPU verification failure", async () => {
  const { system } = createSystem();
  const candidate = await runSuccessfulProducer(system, { nonCpuFailure: true });
  const evidence = parseLiveLinuxCgroupCpuEvidenceV2(candidate.evidence, expectedBinding());
  assert.equal(evidence.outcome, "EXECUTION_NON_CPU_FAILURE");
  assert.equal(evidence.failurePhase, "VERIFICATION");
  assert.equal(evidence.failureCode, "VERIFICATION_FAILED");
  assert.equal(candidate.passSigningEligible, false);
});

test("producer fails closed before controller stop when the overlap sample is missing", async () => {
  const { system } = createSystem();
  const candidate = await runSuccessfulProducer(system, {
    skipEgressOverlapSample: true,
  });
  const evidence = parseLiveLinuxCgroupCpuEvidenceV2(candidate.evidence, expectedBinding());
  assert.equal(evidence.outcome, "LINUX_CONTROLLER_FAILURE");
  assert.equal(evidence.failurePhase, "SAMPLING");
  assert.equal(evidence.failureCode, "CPU_STAT_READ_FAILED");
  assert.equal(evidence.controllerStopStatus, "STOPPED");
  assert.equal(candidate.passSigningEligible, false);
});

test("producer contains the first aggregate overage and forbids later role admission", async () => {
  const { system, events } = createSystem({
    usage: {
      egress: [0n, 80n],
      worker: [0n, 30n],
      verifier: [0n, 0n],
    },
  });
  const signal = new AbortController().signal;
  const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
  await session.bindRole(dockerObservation("egress"), signal);
  await session.markExecutionStarted("egress", signal);
  await session.bindRole(dockerObservation("worker"), signal);
  await session.markExecutionStarted("worker", signal);
  const candidate = await session.sampleRole("egress", signal);
  assert.equal(candidate, null);
  const failed = await session.sampleRole("worker", signal);
  assert.notEqual(failed, null);
  const evidence = parseLiveLinuxCgroupCpuEvidenceV2(failed.evidence, expectedBinding());
  assert.equal(evidence.outcome, "OBSERVED_OVER_BUDGET_CONTAINED");
  assert.equal(evidence.observedAggregateUsageUsec, "110");
  assert.equal(evidence.overageUsec, "10");
  assert.deepEqual(
    evidence.events
      .filter((event) => event.eventType === "CONTAINMENT_ACTION")
      .map((event) => `${event.action}:${event.result}`),
    ["FREEZE:SUCCEEDED", "KILL:SUCCEEDED", "REAP:SUCCEEDED"],
  );
  assert.deepEqual(events.slice(-3), [
    "release:egress",
    "release:worker",
    "controller:stop",
  ]);
  await assert.rejects(
    session.bindRole(dockerObservation("verifier"), signal),
    /finalized|terminal|failure/u,
  );
});

test("producer reports incomplete containment when reap, release, or controller stop is unproved", async () => {
  for (const scenario of [
    { freeze: false },
    { reap: false, remainingProcessCount: 2 },
    { released: { egress: false, worker: true, verifier: true } },
    { stop: false },
  ]) {
    const { system } = createSystem({
      ...scenario,
      usage: {
        egress: [0n, 80n],
        worker: [0n, 30n],
        verifier: [0n, 0n],
      },
    });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    await session.bindRole(dockerObservation("egress"), signal);
    await session.markExecutionStarted("egress", signal);
    await session.bindRole(dockerObservation("worker"), signal);
    await session.markExecutionStarted("worker", signal);
    await session.sampleRole("egress", signal);
    const failed = await session.sampleRole("worker", signal);
    const evidence = parseLiveLinuxCgroupCpuEvidenceV2(failed.evidence, expectedBinding());
    assert.equal(evidence.outcome, "CONTAINMENT_INCOMPLETE");
    assert.equal(evidence.containment.status, "INCOMPLETE");
    assert.equal(candidateIsNonLive(failed), true);
  }
});

test("transient release and controller-stop failures remain incomplete after cleanup recovery", async () => {
  {
    const { system } = createSystem({ stopSequence: [false, true] });
    const candidate = await runSuccessfulProducer(system);
    const evidence = parseLiveLinuxCgroupCpuEvidenceV2(candidate.evidence, expectedBinding());
    assert.equal(evidence.outcome, "CONTAINMENT_INCOMPLETE");
    assert.equal(evidence.failureCode, "CONTROLLER_STOP_FAILED");
    assert.equal(evidence.controllerStopStatus, "STOPPED");
    assert.equal(evidence.containment.status, "INCOMPLETE");
  }
  {
    const { system } = createSystem({ releaseSequence: { worker: [false, true] } });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    await session.bindRole(dockerObservation("egress"), signal);
    await session.markExecutionStarted("egress", signal);
    await session.bindRole(dockerObservation("worker"), signal);
    await session.markExecutionStarted("worker", signal);
    await session.markExecutionStopped("worker", signal);
    const candidate = await session.markRoleReleased("worker", signal);
    const evidence = parseLiveLinuxCgroupCpuEvidenceV2(candidate.evidence, expectedBinding());
    assert.equal(evidence.outcome, "CONTAINMENT_INCOMPLETE");
    assert.equal(evidence.failureCode, "CGROUP_RELEASE_FAILED");
    assert.equal(evidence.observedRoles.every((role) => role.released), true);
    assert.equal(evidence.controllerStopStatus, "STOPPED");
  }
});

function candidateIsNonLive(candidate) {
  return candidate.liveClaim === false && candidate.passSigningEligible === false;
}

test("producer converts counter regression into typed controller failure evidence", async () => {
  const { system } = createSystem({
    usage: {
      egress: [10n, 9n],
      worker: [0n, 0n],
      verifier: [0n, 0n],
    },
  });
  const signal = new AbortController().signal;
  const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
  await session.bindRole(dockerObservation("egress"), signal);
  await session.markExecutionStarted("egress", signal);
  const failed = await session.sampleRole("egress", signal);
  const evidence = parseLiveLinuxCgroupCpuEvidenceV2(failed.evidence, expectedBinding());
  assert.equal(evidence.outcome, "LINUX_CONTROLLER_FAILURE");
  assert.equal(evidence.failurePhase, "SAMPLING");
  assert.equal(evidence.failureCode, "CPU_COUNTER_REGRESSION");
  assert.equal(evidence.observedAggregateUsageUsec, "0");
});

test("producer converts a reobserved cgroup identity change into typed drift evidence", async () => {
  const { system } = createSystem({ identityDrift: "egress" });
  const signal = new AbortController().signal;
  const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
  await session.bindRole(dockerObservation("egress"), signal);
  await session.markExecutionStarted("egress", signal);
  const failed = await session.sampleRole("egress", signal);
  const evidence = parseLiveLinuxCgroupCpuEvidenceV2(failed.evidence, expectedBinding());
  assert.equal(evidence.outcome, "LINUX_CONTROLLER_FAILURE");
  assert.equal(evidence.failureCode, "ROLE_IDENTITY_DRIFT");
  assert.equal(evidence.containment.trigger, "IDENTITY_DRIFT");
});

test("producer rejects duplicate role identity, wrong role order, and non-raw monotonic progress", async () => {
  {
    const { system } = createSystem({ duplicateIdentity: true });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    await session.bindRole(dockerObservation("egress"), signal);
    await session.markExecutionStarted("egress", signal);
    await assert.rejects(
      session.bindRole(dockerObservation("worker"), signal),
      /identity|reused|duplicate/u,
    );
    await assert.rejects(session.finalizeSuccess(signal), /poisoned/u);
  }
  {
    const { system } = createSystem();
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    await assert.rejects(
      session.bindRole(dockerObservation("worker"), signal),
      /order|egress/u,
    );
  }
  {
    const { system } = createSystem({ sameTimestamp: true });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    await assert.rejects(
      session.bindRole(dockerObservation("egress"), signal),
      /monotonic|clock/u,
    );
  }
});

test("producer snapshots Docker identity before an asynchronous bind", async () => {
  let releaseBind;
  const bindGate = new Promise((resolve) => {
    releaseBind = resolve;
  });
  const { system } = createSystem({ bindGate });
  const signal = new AbortController().signal;
  const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
  const observation = dockerObservation("egress");
  const pending = session.bindRole(observation, signal);
  observation.role = "worker";
  observation.containerId = "4".repeat(64);
  observation.pid = 40_004;
  releaseBind();
  const identity = await pending;
  assert.equal(identity.role, "egress");
  assert.equal(identity.containerId, "1".repeat(64));
  assert.equal(identity.pid, 10_001);
});

test("an in-flight abort and uint64 aggregate overflow poison the contract session", async () => {
  {
    const controller = new AbortController();
    const { system } = createSystem({
      beforeRead() {
        controller.abort(new Error("sampling cancelled"));
      },
    });
    const session = await createLinuxCgroupCpuEvidenceV2Producer(
      BASE,
      system,
      controller.signal,
    );
    await session.bindRole(dockerObservation("egress"), controller.signal);
    await session.markExecutionStarted("egress", controller.signal);
    await assert.rejects(
      session.sampleRole("egress", controller.signal),
      /sampling cancelled/u,
    );
    await assert.rejects(session.finalizeSuccess(new AbortController().signal), /poisoned/u);
  }
  {
    const max = (1n << 64n) - 1n;
    const { system } = createSystem({
      usage: {
        egress: [0n, max],
        worker: [0n, 1n],
        verifier: [0n, 0n],
      },
    });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(
      { ...BASE, budgetUsec: max },
      system,
      signal,
    );
    await session.bindRole(dockerObservation("egress"), signal);
    await session.markExecutionStarted("egress", signal);
    await session.bindRole(dockerObservation("worker"), signal);
    await session.markExecutionStarted("worker", signal);
    assert.equal(await session.sampleRole("egress", signal), null);
    await assert.rejects(session.sampleRole("worker", signal), /overflowed uint64/u);
    await assert.rejects(session.finalizeSuccess(signal), /poisoned/u);
  }
});

test("producer validates binding and stops on an already-aborted signal", async () => {
  const { system } = createSystem();
  await assert.rejects(
    createLinuxCgroupCpuEvidenceV2Producer(
      { ...BASE, budgetUsec: 0n },
      system,
      new AbortController().signal,
    ),
    /binding|budget/u,
  );

  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    createLinuxCgroupCpuEvidenceV2Producer(BASE, system, controller.signal),
    /cancelled/u,
  );

  await assert.rejects(
    createLinuxCgroupCpuEvidenceV2Producer(
      BASE,
      { ...system },
      new AbortController().signal,
    ),
    /system port/u,
  );
});

test("producer reads binding and frozen system accessors exactly once", async () => {
  let requestIdReads = 0;
  const binding = Object.freeze(
    Object.defineProperty(
      { ...BASE, requestId: undefined },
      "requestId",
      {
        enumerable: true,
        get() {
          requestIdReads += 1;
          return requestIdReads === 1 ? BASE.requestId : "0".repeat(32);
        },
      },
    ),
  );
  let provenanceReads = 0;
  const { system: baseSystem } = createSystem();
  const system = Object.freeze(
    Object.defineProperty(
      { ...baseSystem, provenance: undefined },
      "provenance",
      {
        enumerable: true,
        get() {
          provenanceReads += 1;
          return provenanceReads === 1 ? "SYNTHETIC_CONTRACT" : "LINUX_CGROUP_V2";
        },
      },
    ),
  );
  const session = await createLinuxCgroupCpuEvidenceV2Producer(
    binding,
    system,
    new AbortController().signal,
  );
  assert.equal(requestIdReads, 1);
  assert.equal(provenanceReads, 1);
  assert.equal(typeof session.bindRole, "function");
});

test("producer snapshots bind, usage, and reap observations exactly once", async () => {
  {
    const reads = { identity: 0, usage: 0 };
    const { system: baseSystem } = createSystem();
    const system = Object.freeze({
      ...baseSystem,
      async bindRole(observation, signal) {
        if (signal.aborted) throw signal.reason;
        return Object.defineProperties({}, {
          cgroupIdentitySha256: {
            enumerable: true,
            get() {
              reads.identity += 1;
              return reads.identity === 1 ? "6".repeat(64) : "7".repeat(64);
            },
          },
          usageUsec: {
            enumerable: true,
            get() {
              reads.usage += 1;
              return reads.usage === 1 ? 0n : -1n;
            },
          },
        });
      },
    });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    const identity = await session.bindRole(dockerObservation("egress"), signal);
    assert.equal(identity.cgroupIdentitySha256, "6".repeat(64));
    assert.deepEqual(reads, { identity: 1, usage: 1 });
  }
  {
    const reads = { identity: 0, usage: 0 };
    const { system: baseSystem } = createSystem();
    const system = Object.freeze({
      ...baseSystem,
      async readUsageUsec(identity, signal) {
        if (signal.aborted) throw signal.reason;
        return Object.defineProperties({}, {
          cgroupIdentitySha256: {
            enumerable: true,
            get() {
              reads.identity += 1;
              return reads.identity === 1
                ? identity.cgroupIdentitySha256
                : "7".repeat(64);
            },
          },
          usageUsec: {
            enumerable: true,
            get() {
              reads.usage += 1;
              return reads.usage === 1 ? 5n : -1n;
            },
          },
        });
      },
    });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    await session.bindRole(dockerObservation("egress"), signal);
    await session.markExecutionStarted("egress", signal);
    assert.equal(await session.sampleRole("egress", signal), null);
    assert.deepEqual(reads, { identity: 1, usage: 1 });
  }
  {
    const reads = { succeeded: 0, remaining: 0 };
    const { system: baseSystem } = createSystem({
      usage: {
        egress: [0n, 80n],
        worker: [0n, 30n],
        verifier: [0n, 0n],
      },
    });
    const system = Object.freeze({
      ...baseSystem,
      async reapRoles(_roles, signal) {
        if (signal.aborted) throw signal.reason;
        return Object.defineProperties({}, {
          succeeded: {
            enumerable: true,
            get() {
              reads.succeeded += 1;
              return reads.succeeded === 1;
            },
          },
          remainingProcessCount: {
            enumerable: true,
            get() {
              reads.remaining += 1;
              return reads.remaining === 1 ? 0 : 1;
            },
          },
        });
      },
    });
    const signal = new AbortController().signal;
    const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
    await session.bindRole(dockerObservation("egress"), signal);
    await session.markExecutionStarted("egress", signal);
    await session.bindRole(dockerObservation("worker"), signal);
    await session.markExecutionStarted("worker", signal);
    await session.sampleRole("egress", signal);
    const candidate = await session.sampleRole("worker", signal);
    assert.equal(candidate.evidence.outcome, "OBSERVED_OVER_BUDGET_CONTAINED");
    assert.deepEqual(reads, { succeeded: 1, remaining: 1 });
  }
});

test("a final evidence parser failure poisons the session after controller side effects", async () => {
  const { system, events } = createSystem();
  const signal = new AbortController().signal;
  const session = await createLinuxCgroupCpuEvidenceV2Producer(BASE, system, signal);
  await assert.rejects(
    session.recordControllerFailure(
      "SAMPLING",
      "CPU_BUDGET_EXCEEDED",
      signal,
    ),
    /unsigned 64-bit|overage|decimal/u,
  );
  assert.equal(events.includes("controller:stop"), true);
  await assert.rejects(
    session.bindRole(dockerObservation("egress"), signal),
    /poisoned/u,
  );
});

test("the contract producer rejects self-declared Linux provenance", async () => {
  const { system } = createSystem({ provenance: "LINUX_CGROUP_V2" });
  await assert.rejects(
    createLinuxCgroupCpuEvidenceV2Producer(
      BASE,
      system,
      new AbortController().signal,
    ),
    /system port/u,
  );
});
