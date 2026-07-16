import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrivateLiveLinuxCgroupCpuAdapterScaffold,
  createPrivateLiveLinuxCgroupCpuDedicatedLifecycleContract,
} from "../../dist/codex/live-linux-cgroup-cpu-adapter.js";
import { runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness } from "../../dist/codex/live-linux-cgroup-cpu-dedicated-lifecycle.js";

const EXPECTED_NON_FINAL_STAGES = [
  "REQUEST_VALIDATED",
  "PRIVATE_ADAPTER_ADMITTED",
  "OWNED_CONTAINERS_CREATED",
  "EGRESS_START_BARRIER_HELD",
  "EGRESS_CGROUP_BOUND",
  "EGRESS_BASELINE_RECORDED",
  "EGRESS_START_BARRIER_RELEASED",
  "WORKER_START_BARRIER_HELD",
  "WORKER_CGROUP_BOUND",
  "WORKER_BASELINE_RECORDED",
  "WORKER_START_BARRIER_RELEASED",
  "WORKER_EXECUTION_OBSERVED",
  "WORKER_STOPPED_OR_CONTAINED",
  "WORKER_DOCKER_RELEASED",
  "WORKER_CGROUP_RELEASED",
  "EGRESS_STOPPED_OR_CONTAINED",
  "EGRESS_DOCKER_RELEASED",
  "EGRESS_CGROUP_RELEASED",
  "VERIFIER_START_BARRIER_HELD",
  "VERIFIER_CGROUP_BOUND",
  "VERIFIER_BASELINE_RECORDED",
  "VERIFIER_START_BARRIER_RELEASED",
  "VERIFIER_EXECUTION_OBSERVED",
  "VERIFIER_STOPPED_OR_CONTAINED",
  "VERIFIER_DOCKER_RELEASED",
  "VERIFIER_CGROUP_RELEASED",
  "CONTROLLER_STOPPED",
];

function createFakeSystem(options = {}) {
  const log = [];
  const baselines = { egress: 10n, worker: 20n, verifier: 30n };
  const samples = { ...baselines };
  let rawNs = 1_000n;
  let activeOperations = 0;
  let maximumActiveOperations = 0;
  let settleTimedOutCleanup;

  async function serial(label, callback = () => undefined) {
    activeOperations += 1;
    maximumActiveOperations = Math.max(maximumActiveOperations, activeOperations);
    log.push(label);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      return callback();
    } finally {
      activeOperations -= 1;
    }
  }

  const system = {
    provenance: "NON_PRIVILEGED_TEST_PORT",
    async createOwnedContainers(signal) {
      assert.equal(signal.aborted, false);
      log.push("create");
    },
    async startRoleHeld(role, signal) {
      assert.equal(signal.aborted, false);
      log.push(`start:${role}`);
    },
    async waitRoleBarrierHeld(role, signal) {
      assert.equal(signal.aborted, false);
      log.push(`held:${role}`);
    },
    async bindRoleIdentityAndCgroup(role, signal) {
      assert.equal(signal.aborted, false);
      log.push(`bind:${role}`);
    },
    async readRoleBaselineCpuUsageUsec(role, signal) {
      assert.equal(signal.aborted, false);
      log.push(`baseline:${role}`);
      if (options.abortOnBaselineRole === role) {
        options.executionController.abort(new Error("test baseline abort"));
      }
      return baselines[role];
    },
    async releaseRoleBarrier(role, signal) {
      assert.equal(signal.aborted, false);
      log.push(`release-barrier:${role}`);
      options.onBarrierReleased?.(role);
    },
    async revalidateAndReadRoleCpuSample(role, signal) {
      return serial(`sample:${role}`, () => {
        assert.equal(signal.aborted, false);
        if (options.identityDriftRole === role) throw new Error("identity drift");
        rawNs += 10n;
        samples[role] += options.sampleIncrementUsec ?? 1n;
        return {
          monotonicRawNs: rawNs,
          usageUsec: samples[role],
          populated: true,
          directProcessCount: 1,
        };
      });
    },
    async waitRoleExit(role, signal) {
      log.push(`wait:${role}`);
      if (options.abortOnWorkerWait && role === "worker") {
        options.executionController.abort(new Error("test execution abort"));
      }
      if (signal.aborted) throw signal.reason;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
    async stopOrContainRole(role, reason, signal) {
      assert.equal(signal.aborted, false, "cleanup must use an independent live signal");
      log.push(`stop:${role}:${reason}`);
      if (options.cleanupFailureRole === role) throw new Error(`cleanup failed for ${role}`);
      if (options.hangingCleanupRole === role) {
        await new Promise((resolve) => {
          settleTimedOutCleanup = resolve;
          signal.addEventListener("abort", () => log.push(`cleanup-aborted:${role}`), {
            once: true,
          });
        });
      }
    },
    async readQuiescentRoleCpuSample(role, signal) {
      return serial(`final-sample:${role}`, () => {
        assert.equal(signal.aborted, false);
        rawNs += 10n;
        samples[role] += options.finalSampleIncrementUsec?.[role] ?? 1n;
        return {
          monotonicRawNs: rawNs,
          usageUsec: samples[role],
          populated: false,
          directProcessCount: 0,
        };
      });
    },
    async releaseRoleDocker(role, signal) {
      assert.equal(signal.aborted, false);
      log.push(`docker-release:${role}`);
    },
    async releaseRoleCgroup(role, signal) {
      assert.equal(signal.aborted, false);
      log.push(`cgroup-release:${role}`);
    },
    async stopController(signal) {
      assert.equal(signal.aborted, false);
      log.push("controller-stop");
    },
    async terminateControllerAfterCleanupTimeout() {
      log.push("controller-force-terminate");
      if (options.lateCleanupSettlementMs !== undefined) {
        setTimeout(() => {
          log.push("late-cleanup-settlement");
          settleTimedOutCleanup?.();
        }, options.lateCleanupSettlementMs);
      } else if (!options.unsettledCleanup) {
        settleTimedOutCleanup?.();
      }
    },
  };

  return {
    system,
    log,
    maximumActiveOperations: () => maximumActiveOperations,
  };
}

function lifecycleContract(cleanupTimeoutMs = 5_000) {
  return createPrivateLiveLinuxCgroupCpuDedicatedLifecycleContract(
    createPrivateLiveLinuxCgroupCpuAdapterScaffold({ cleanupTimeoutMs }),
  );
}

test("dedicated lifecycle enforces barrier/baseline order, serial samples, and cleanup-before-finalization", async () => {
  const fake = createFakeSystem();
  const result = await runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
    lifecycleContract: lifecycleContract(),
    system: fake.system,
    maximumCumulativeCpuUsec: 1_000n,
    pollIntervalMs: 1,
  });

  assert.equal(result.status, "COMPLETED_NOT_FINALIZED");
  assert.deepEqual(result.completedSuccessStages, EXPECTED_NON_FINAL_STAGES);
  assert.equal(result.dynamicRuntimeVerified, false);
  assert.equal(result.finalizedEvidenceIssued, false);
  assert.equal(result.passSigningEligible, false);
  assert.equal(result.finalizationBlockedReason, "FINALIZED_EVIDENCE_ISSUER_NOT_IMPLEMENTED");
  assert.equal(fake.maximumActiveOperations(), 1);
  assert.ok(fake.log.indexOf("held:worker") < fake.log.indexOf("baseline:worker"));
  assert.ok(fake.log.indexOf("baseline:worker") < fake.log.indexOf("release-barrier:worker"));
  assert.ok(fake.log.indexOf("cgroup-release:egress") < fake.log.indexOf("start:verifier"));
  assert.ok(fake.log.indexOf("cgroup-release:verifier") < fake.log.indexOf("controller-stop"));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.completedSuccessStages), true);
  assert.equal(Object.isFrozen(result.samples), true);
});

test("over-budget execution contains active roles and cannot produce finalized evidence", async () => {
  const fake = createFakeSystem({ sampleIncrementUsec: 100n });
  const result = await runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
    lifecycleContract: lifecycleContract(),
    system: fake.system,
    maximumCumulativeCpuUsec: 50n,
    pollIntervalMs: 1,
  });

  assert.equal(result.status, "FAILED_NOT_FINALIZED");
  assert.equal(result.failureCode, "CPU_BUDGET_EXCEEDED");
  assert.equal(result.cleanupFailureSticky, false);
  assert.equal(result.finalizedEvidenceIssued, false);
  assert.ok(fake.log.includes("stop:worker:OVER_BUDGET"));
  assert.ok(fake.log.includes("stop:egress:OVER_BUDGET"));
  assert.ok(fake.log.includes("controller-stop"));
});

test("CPU consumed during quiescent teardown is included before verifier admission", async () => {
  const fake = createFakeSystem({
    finalSampleIncrementUsec: { egress: 100n, worker: 1n, verifier: 1n },
  });
  const result = await runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
    lifecycleContract: lifecycleContract(),
    system: fake.system,
    maximumCumulativeCpuUsec: 50n,
    pollIntervalMs: 1,
  });

  assert.equal(result.status, "FAILED_NOT_FINALIZED");
  assert.equal(result.failureCode, "CPU_BUDGET_EXCEEDED");
  assert.ok(fake.log.includes("final-sample:egress"));
  assert.equal(fake.log.includes("start:verifier"), false);
  assert.equal(result.finalizedEvidenceIssued, false);
});

test("execution abort uses an independent cleanup signal and cleanup failure remains sticky", async () => {
  const executionController = new AbortController();
  const fake = createFakeSystem({
    abortOnWorkerWait: true,
    cleanupFailureRole: "worker",
    executionController,
  });
  const result = await runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
    lifecycleContract: lifecycleContract(),
    system: fake.system,
    maximumCumulativeCpuUsec: 1_000n,
    pollIntervalMs: 1,
    executionSignal: executionController.signal,
  });

  assert.equal(result.status, "FAILED_NOT_FINALIZED");
  assert.equal(result.failureCode, "EXECUTION_ABORTED");
  assert.equal(result.cleanupFailureSticky, true);
  assert.match(result.cleanupFailures.join("\n"), /cleanup failed for worker/u);
  assert.ok(fake.log.includes("controller-stop"));
  assert.equal(result.finalizedEvidenceIssued, false);
});

test("identity revalidation failure is fail-stop and copied adapter authority is rejected", async () => {
  const fake = createFakeSystem({ identityDriftRole: "egress" });
  const result = await runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
    lifecycleContract: lifecycleContract(),
    system: fake.system,
    maximumCumulativeCpuUsec: 1_000n,
    pollIntervalMs: 1,
  });
  assert.equal(result.status, "FAILED_NOT_FINALIZED");
  assert.equal(result.failureCode, "ROLE_IDENTITY_REVALIDATION_FAILED");
  assert.ok(fake.log.includes("stop:worker:FAILURE"));
  assert.ok(fake.log.includes("stop:egress:FAILURE"));

  const realAdapter = createPrivateLiveLinuxCgroupCpuAdapterScaffold({ cleanupTimeoutMs: 5_000 });
  assert.throws(
    () => createPrivateLiveLinuxCgroupCpuDedicatedLifecycleContract({ ...realAdapter }),
    /private real-Linux adapter factory/u,
  );
});

test("abort during baseline forbids barrier release and enters independent cleanup", async () => {
  const executionController = new AbortController();
  const fake = createFakeSystem({
    abortOnBaselineRole: "worker",
    executionController,
  });
  const result = await runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
    lifecycleContract: lifecycleContract(),
    system: fake.system,
    maximumCumulativeCpuUsec: 1_000n,
    pollIntervalMs: 1,
    executionSignal: executionController.signal,
  });
  assert.equal(result.status, "FAILED_NOT_FINALIZED");
  assert.equal(result.failureCode, "EXECUTION_ABORTED");
  assert.equal(fake.log.includes("release-barrier:worker"), false);
  assert.ok(fake.log.includes("stop:worker:FAILURE"));
});

test("cleanup timeout force-terminates the controller and settles before terminal result", async () => {
  const fake = createFakeSystem({ hangingCleanupRole: "worker" });
  const started = Date.now();
  const result = await runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
    lifecycleContract: lifecycleContract(1_000),
    system: fake.system,
    maximumCumulativeCpuUsec: 1_000n,
    pollIntervalMs: 1,
  });
  assert.equal(result.status, "FAILED_NOT_FINALIZED");
  assert.equal(result.cleanupFailureSticky, true);
  assert.ok(Date.now() - started >= 900);
  assert.ok(fake.log.includes("cleanup-aborted:worker"));
  assert.ok(fake.log.includes("controller-force-terminate"));
  const frozenFailures = [...result.cleanupFailures];
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(result.cleanupFailures, frozenFailures);
  assert.equal(Object.isFrozen(result.cleanupFailures), true);
});

test("uncooperative cleanup is bounded and blocks every terminal lifecycle result", async () => {
  const fake = createFakeSystem({
    hangingCleanupRole: "worker",
    unsettledCleanup: true,
    lateCleanupSettlementMs: 500,
  });
  await assert.rejects(
    runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness({
      lifecycleContract: lifecycleContract(1_000),
      system: fake.system,
      maximumCumulativeCpuUsec: 1_000n,
      pollIntervalMs: 1,
    }),
    /no lifecycle result may be returned/u,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok(fake.log.includes("late-cleanup-settlement"));
});
