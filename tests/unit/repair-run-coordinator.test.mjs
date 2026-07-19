import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  RepairRunCoordinator,
  SQLiteRepairRunRepository,
  createUnavailableRepairRunExecutionPort,
  repairRunInputSha256,
  repairRunPolicyIrSha256,
  repairRunSessionSha256,
} from "../../dist/index.js";

const acceptedPolicyIr = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/policy-ir.json", import.meta.url), "utf8"),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/golden-cases.json", import.meta.url), "utf8"),
);
const generatedCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/generated-cases.json", import.meta.url), "utf8"),
);
const driftCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url),
    "utf8",
  ),
);
const sourcePolicy = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);

const SESSION = Buffer.alloc(32, 7).toString("base64url");
const OTHER_SESSION = Buffer.alloc(32, 8).toString("base64url");

function repairInput() {
  const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
  const defectsByCase = {
    D01: ["DAY_14_INCLUSIVE"],
    D02: ["USAGE_2000_INCLUSIVE"],
    D03: ["FINAL_SALE_PRECEDENCE"],
  };
  return {
    policyId: acceptedPolicyIr.policyId,
    policyVersion: acceptedPolicyIr.version,
    fixtureId: "seeded-refund-demo",
    sourcePolicy,
    policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
    acceptedPolicyIr,
    acceptedCases: [...goldenCases, ...generatedCases],
    failingCaseIds: ["D01", "D02", "D03"],
    failingDriftWitnesses: driftCases.map((policyCase) => ({
      caseId: policyCase.id,
      input: policyCase.input,
      expectedDecision: policyCase.expectedDecision,
      actualDecision: actualByCase[policyCase.id],
      defectIds: defectsByCase[policyCase.id],
      relatedClauseIds: policyCase.relatedClauseIds,
      relatedRuleIds: policyCase.relatedRuleIds,
    })),
    allowedCommandIds: ["fixture-typecheck", "fixture-test"],
    maxRepairAttempts: 2,
  };
}

function advancingClock(start = "2026-07-18T07:00:00.000Z") {
  let milliseconds = Date.parse(start);
  return () => {
    const value = new Date(milliseconds);
    milliseconds += 1;
    return value;
  };
}

async function temporaryRepository(t) {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-runs-"));
  const repository = new SQLiteRepairRunRepository(join(root, "runs.sqlite"));
  t.after(async () => {
    repository.close();
    await rm(root, { recursive: true, force: true });
  });
  return { repository, root };
}

async function waitUntil(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the test condition.");
    await delay(5);
  }
}

test("unavailable live execution creates one persistent, session-bound blocked run", async (t) => {
  const { repository } = await temporaryRepository(t);
  let executeCalls = 0;
  const unavailable = createUnavailableRepairRunExecutionPort();
  const coordinator = new RepairRunCoordinator(
    repository,
    {
      readiness: unavailable.readiness,
      async execute() {
        executeCalls += 1;
        return unavailable.execute();
      },
    },
    { now: advancingClock() },
  );
  const input = repairInput();
  const first = coordinator.start({
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    sessionToken: SESSION,
    input,
  });
  assert.equal(first.created, true);
  assert.equal(first.run.status, "BLOCKED");
  assert.equal(first.run.executionMode, "NOT_STARTED");
  assert.equal(first.run.failure?.code, "LIVE_EXECUTOR_NOT_ADMITTED");
  assert.equal(executeCalls, 0);
  assert.equal(first.run.inputSha256, repairRunInputSha256(input));
  assert.equal(first.run.policyIrSha256, repairRunPolicyIrSha256(input));

  const replay = coordinator.start({
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    sessionToken: SESSION,
    input,
  });
  assert.equal(replay.created, false);
  assert.equal(replay.run.id, first.run.id);
  assert.deepEqual(
    repository
      .listEventsForSession(first.run.id, repairRunSessionSha256(SESSION))
      .map((event) => event.type),
    ["RUN_CREATED", "RUN_BLOCKED"],
  );
  assert.equal(repository.getRunForSession(first.run.id, repairRunSessionSha256(OTHER_SESSION)), null);
});

test("an unbranded injected port poisons the session instead of unlocking a shaped success", async (t) => {
  const { repository } = await temporaryRepository(t);
  const coordinator = new RepairRunCoordinator(
    repository,
    {
      readiness: () => ({ ready: true }),
      async execute(input, context) {
        assert.equal(input.fixtureId, "seeded-refund-demo");
        await context.onProgress({
          type: "PHASE_STARTED",
          phase: "CARTOGRAPHY",
          detail: { message: "Read-only code cartography started." },
        });
        await context.onProgress({
          type: "PHASE_COMPLETED",
          phase: "CARTOGRAPHY",
          detail: { message: "Repair surface was mapped." },
        });
        await context.onProgress({
          type: "PHASE_STARTED",
          phase: "REPAIR",
          detail: { message: "Bounded repair attempt started.", attempt: 1 },
        });
        await context.onProgress({
          type: "PHASE_COMPLETED",
          phase: "REPAIR",
          detail: {
            message: "Two approved fixture files changed.",
            attempt: 1,
            changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
          },
        });
        await context.onProgress({
          type: "PHASE_STARTED",
          phase: "VERIFICATION",
          detail: { message: "Server-owned commands and accepted cases started.", attempt: 1 },
        });
        await context.onProgress({
          type: "PHASE_COMPLETED",
          phase: "VERIFICATION",
          detail: { message: "Accepted corpus passed.", attempt: 1, passed: 41, total: 41 },
        });
        await context.onProgress({
          type: "PHASE_STARTED",
          phase: "REVIEW",
          detail: { message: "Independent review started." },
        });
        await context.onProgress({
          type: "PHASE_COMPLETED",
          phase: "REVIEW",
          detail: { message: "Independent review approved.", reviewVerdict: "APPROVE" },
        });
        return {
          executionMode: "LIVE_CODEX_SDK",
          attempts: 1,
          changedFiles: ["src/refund.ts", "tests/refund.test.mjs"],
          commands: [
            {
              commandId: "fixture-typecheck",
              attempt: 1,
              exitCode: 0,
              timedOut: false,
              durationMs: 11,
            },
            {
              commandId: "fixture-test",
              attempt: 1,
              exitCode: 0,
              timedOut: false,
              durationMs: 12,
            },
          ],
          verification: { status: "PASS", passed: 41, total: 41 },
          review: {
            verdict: "APPROVE",
            summary: "The bounded repair covers every admitted witness.",
            blockingFindingCount: 0,
          },
        };
      },
    },
    { now: advancingClock() },
  );
  const started = coordinator.start({
    clientRequestId: "22222222-2222-4222-8222-222222222222",
    sessionToken: SESSION,
    input: repairInput(),
  });
  assert.equal(started.run.status, "RUNNING");
  await coordinator.waitForRun(started.run.id);

  const sessionSha256 = repairRunSessionSha256(SESSION);
  const completed = repository.getRunForSession(started.run.id, sessionSha256);
  assert.equal(completed?.status, "POISONED");
  assert.equal(completed?.phase, "COMPLETE");
  assert.equal(completed?.executionMode, "LIVE_EXECUTION_UNVERIFIED");
  assert.equal(completed?.result, null);
  assert.equal(completed?.failure?.code, "LIVE_EXECUTION_SETTLEMENT_UNVERIFIED");
  const allEvents = repository.listEventsForSession(started.run.id, sessionSha256);
  assert.deepEqual(
    allEvents.map((event) => event.sequence),
    Array.from({ length: 11 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    repository
      .listEventsForSession(started.run.id, sessionSha256, 8)
      .map((event) => event.type),
    ["PHASE_STARTED", "PHASE_COMPLETED", "RUN_POISONED"],
  );
  assert.throws(
    () =>
      coordinator.start({
        clientRequestId: "abababab-abab-4bab-8bab-abababababab",
        sessionToken: SESSION,
        input: repairInput(),
      }),
    /active or fail-stop run/u,
  );
});

test("restart recovery fails interrupted work instead of resuming or overclaiming", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-recovery-"));
  const databasePath = join(root, "runs.sqlite");
  const input = repairInput();
  const sessionSha256 = repairRunSessionSha256(SESSION);
  const first = new SQLiteRepairRunRepository(databasePath);
  const created = first.createOrGetRun({
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    sessionSha256,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    policyIrSha256: repairRunPolicyIrSha256(input),
    inputSha256: repairRunInputSha256(input),
    createdAt: "2020-01-01T00:00:00.000Z",
  }, {
    ownerId: `reo_${"3".repeat(32)}`,
    leaseDurationMs: 100,
  });
  assert.ok(created.lease);
  first.markRunning(created.run.id, "2020-01-01T00:00:00.001Z", created.lease);
  assert.throws(
    () =>
      first.markFailed(
        created.run.id,
        { code: "UNVERIFIED_FAILURE", message: "An unverified failure cannot unlock a running job." },
        "2020-01-01T00:00:00.002Z",
        created.lease,
      ),
    /stale or invalid/u,
  );
  first.close();

  const reopened = new SQLiteRepairRunRepository(databasePath);
  t.after(async () => {
    reopened.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(
    reopened.getRunForSession(created.run.id, sessionSha256)?.status,
    "RUNNING",
  );
  reopened.reconcileExpiredExecutorLease("2020-01-01T00:00:00.101Z");
  const recovered = reopened.getRunForSession(created.run.id, sessionSha256);
  assert.equal(recovered?.status, "POISONED");
  assert.equal(recovered?.failure?.code, "EXECUTOR_LEASE_EXPIRED_WITHOUT_CLEANUP");
  assert.equal(recovered?.executionMode, "LIVE_EXECUTION_UNVERIFIED");
  assert.equal(
    reopened.listEventsForSession(created.run.id, sessionSha256).at(-1)?.type,
    "RUN_POISONED",
  );
});

test("an abort-ignoring executor poisons the session and prevents overlapping work", async (t) => {
  const { repository } = await temporaryRepository(t);
  const originalHeartbeat = repository.heartbeatExecutorLease.bind(repository);
  let heartbeatCalls = 0;
  let heartbeatCallsAtAbort = -1;
  repository.heartbeatExecutorLease = (...args) => {
    heartbeatCalls += 1;
    return originalHeartbeat(...args);
  };
  const coordinator = new RepairRunCoordinator(
    repository,
    {
      readiness: () => ({ ready: true }),
      async execute(_input, context) {
        context.signal.addEventListener(
          "abort",
          () => {
            heartbeatCallsAtAbort = heartbeatCalls;
          },
          { once: true },
        );
        return new Promise(() => {});
      },
    },
    {
      executionTimeoutMs: 20,
      settlementTimeoutMs: 120,
      executorLeaseDurationMs: 100,
      executorHeartbeatIntervalMs: 10,
    },
  );
  const started = coordinator.start({
    clientRequestId: "55555555-5555-4555-8555-555555555555",
    sessionToken: SESSION,
    input: repairInput(),
  });
  await coordinator.waitForRun(started.run.id);
  const sessionSha256 = repairRunSessionSha256(SESSION);
  const poisoned = repository.getRunForSession(started.run.id, sessionSha256);
  assert.equal(poisoned?.status, "POISONED");
  assert.equal(poisoned?.failure?.code, "LIVE_EXECUTION_UNSETTLED");
  assert.ok(heartbeatCallsAtAbort >= 0);
  assert.ok(
    heartbeatCalls > heartbeatCallsAtAbort,
    "the coordinator must retain its lease while awaiting bounded cleanup settlement",
  );
  assert.deepEqual(
    repository.listEventsForSession(started.run.id, sessionSha256).map((event) => event.type),
    ["RUN_CREATED", "RUN_STARTED", "RUN_CLEANUP_PENDING", "RUN_POISONED"],
  );
  assert.throws(
    () =>
      coordinator.start({
        clientRequestId: "66666666-6666-4666-8666-666666666666",
        sessionToken: SESSION,
        input: repairInput(),
      }),
    /active or fail-stop run/u,
  );
});

test("an ordinary execution rejection cannot unlock a run without cleanup proof", async (t) => {
  const { repository } = await temporaryRepository(t);
  const coordinator = new RepairRunCoordinator(
    repository,
    {
      readiness: () => ({ ready: true }),
      async execute(_input, context) {
        assert.match(context.runId, /^rr_[0-9a-f]{32}$/u);
        throw new Error("simulated transport disconnect");
      },
    },
    { now: advancingClock() },
  );
  const started = coordinator.start({
    clientRequestId: "89898989-8989-4989-8989-898989898989",
    sessionToken: SESSION,
    input: repairInput(),
  });
  await coordinator.waitForRun(started.run.id);
  const sessionSha256 = repairRunSessionSha256(SESSION);
  const poisoned = repository.getRunForSession(started.run.id, sessionSha256);
  assert.equal(poisoned?.status, "POISONED");
  assert.equal(poisoned?.failure?.code, "LIVE_EXECUTION_SETTLEMENT_UNVERIFIED");
  assert.deepEqual(repository.pruneTerminalRunsForPolicy(poisoned.policyId), {
    deletedRuns: 0,
    retainedFailStopRuns: 1,
  });
  assert.deepEqual(
    repository.listEventsForSession(started.run.id, sessionSha256).map((event) => event.type),
    ["RUN_CREATED", "RUN_STARTED", "RUN_POISONED"],
  );
  assert.throws(
    () =>
      coordinator.start({
        clientRequestId: "90909090-9090-4090-9090-909090909090",
        sessionToken: OTHER_SESSION,
        input: repairInput(),
      }),
    /active or fail-stop run/u,
  );
});

test("coordinator rejects an unsafe executor heartbeat configuration", async (t) => {
  const { repository } = await temporaryRepository(t);
  const unavailable = createUnavailableRepairRunExecutionPort();
  assert.throws(
    () =>
      new RepairRunCoordinator(repository, unavailable, {
        executorLeaseDurationMs: 99,
        executorHeartbeatIntervalMs: 10,
      }),
    /lease of at least 100ms/u,
  );
  assert.throws(
    () =>
      new RepairRunCoordinator(repository, unavailable, {
        executorLeaseDurationMs: 100,
        executorHeartbeatIntervalMs: 100,
      }),
    /heartbeat interval must be shorter/u,
  );
});

test("coordinator heartbeat extends the live fence and stops after terminal state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-heartbeat-"));
  const databasePath = join(root, "runs.sqlite");
  const repository = new SQLiteRepairRunRepository(databasePath);
  const observer = new SQLiteRepairRunRepository(databasePath);
  t.after(async () => {
    observer.close();
    repository.close();
    await rm(root, { recursive: true, force: true });
  });
  const originalHeartbeat = repository.heartbeatExecutorLease.bind(repository);
  let heartbeatCalls = 0;
  repository.heartbeatExecutorLease = (...args) => {
    heartbeatCalls += 1;
    return originalHeartbeat(...args);
  };
  let nowMs = Date.parse("2026-07-19T01:00:00.000Z");
  let resolveExecution;
  const execution = new Promise((resolve) => {
    resolveExecution = resolve;
  });
  const coordinator = new RepairRunCoordinator(
    repository,
    {
      readiness: () => ({ ready: true }),
      execute: async () => execution,
    },
    {
      executorLeaseDurationMs: 100,
      executorHeartbeatIntervalMs: 10,
      executionTimeoutMs: 1_000,
      now: () => new Date(nowMs),
    },
  );
  const started = coordinator.start({
    clientRequestId: "91919191-9191-4191-8191-919191919191",
    sessionToken: SESSION,
    input: repairInput(),
  });
  nowMs += 80;
  await waitUntil(() => heartbeatCalls >= 1);
  nowMs += 80;
  assert.equal(
    observer.reconcileExpiredExecutorLease(new Date(nowMs).toISOString()),
    0,
    "the heartbeat must extend the original 100ms lease",
  );
  assert.equal(
    observer.getRunForSession(started.run.id, repairRunSessionSha256(SESSION))?.status,
    "RUNNING",
  );

  resolveExecution({ invalid: true });
  await coordinator.waitForRun(started.run.id);
  const callsAtTerminal = heartbeatCalls;
  await delay(35);
  assert.equal(heartbeatCalls, callsAtTerminal, "terminal completion must clear the interval");
  assert.equal(
    repository.getRunForSession(started.run.id, repairRunSessionSha256(SESSION))?.status,
    "POISONED",
  );
});

test("heartbeat failure is classified separately from wall-time timeout", async (t) => {
  const { repository } = await temporaryRepository(t);
  let heartbeatCalls = 0;
  repository.heartbeatExecutorLease = () => {
    heartbeatCalls += 1;
    throw new Error("simulated durable heartbeat failure");
  };
  const coordinator = new RepairRunCoordinator(
    repository,
    {
      readiness: () => ({ ready: true }),
      execute: async (_input, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new Error("simulated external worker cancellation")),
            { once: true },
          );
        }),
    },
    {
      executorLeaseDurationMs: 100,
      executorHeartbeatIntervalMs: 10,
      executionTimeoutMs: 1_000,
      settlementTimeoutMs: 100,
      now: advancingClock("2026-07-19T01:01:00.000Z"),
    },
  );
  const started = coordinator.start({
    clientRequestId: "92929292-9292-4292-8292-929292929292",
    sessionToken: SESSION,
    input: repairInput(),
  });
  await coordinator.waitForRun(started.run.id);
  const sessionSha256 = repairRunSessionSha256(SESSION);
  const completed = repository.getRunForSession(started.run.id, sessionSha256);
  assert.equal(completed?.status, "POISONED");
  assert.equal(completed?.failure?.code, "EXECUTOR_LEASE_HEARTBEAT_FAILED");
  assert.deepEqual(
    repository.listEventsForSession(started.run.id, sessionSha256).map((event) => event.type),
    ["RUN_CREATED", "RUN_STARTED", "RUN_CLEANUP_PENDING", "RUN_POISONED"],
  );
  assert.equal(
    repository.listEventsForSession(started.run.id, sessionSha256)[2]?.detail.message,
    "The repair executor lost its durable lease heartbeat; this session remains closed while external-worker settlement is observed.",
  );
  const callsAtTerminal = heartbeatCalls;
  await delay(35);
  assert.equal(heartbeatCalls, callsAtTerminal, "heartbeat failure must clear the interval once");
});

test("expired and rolled-back heartbeats are storage-reconciled before wait completes", async (t) => {
  const cases = [
    {
      name: "expired exact lease",
      clientRequestId: "93939393-9393-4393-8393-939393939393",
      moveClock(nowMs) {
        return nowMs + 100;
      },
      failureCode: "EXECUTOR_LEASE_LOST_WITHOUT_CLEANUP",
    },
    {
      name: "durable clock rollback",
      clientRequestId: "94949494-9494-4494-8494-949494949494",
      moveClock(nowMs) {
        return nowMs - 1;
      },
      failureCode: "EXECUTOR_CLOCK_ROLLBACK_WITHOUT_CLEANUP",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (nested) => {
      const { repository } = await temporaryRepository(nested);
      let nowMs = Date.parse("2026-07-19T01:02:00.000Z");
      const coordinator = new RepairRunCoordinator(
        repository,
        {
          readiness: () => ({ ready: true }),
          execute: async (_input, context) =>
            new Promise((_resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => reject(new Error("simulated external worker abort")),
                { once: true },
              );
            }),
        },
        {
          executorLeaseDurationMs: 100,
          executorHeartbeatIntervalMs: 10,
          executionTimeoutMs: 1_000,
          now: () => new Date(nowMs),
        },
      );
      const started = coordinator.start({
        clientRequestId: scenario.clientRequestId,
        sessionToken: SESSION,
        input: repairInput(),
      });
      nowMs = scenario.moveClock(nowMs);
      await coordinator.waitForRun(started.run.id);
      const sessionSha256 = repairRunSessionSha256(SESSION);
      const terminal = repository.getRunForSession(started.run.id, sessionSha256);
      assert.equal(terminal?.status, "POISONED");
      assert.equal(terminal?.failure?.code, scenario.failureCode);
      assert.deepEqual(
        repository.listEventsForSession(started.run.id, sessionSha256).map((event) => event.type),
        ["RUN_CREATED", "RUN_STARTED", "RUN_POISONED"],
      );
    });
  }
});
