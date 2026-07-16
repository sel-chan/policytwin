import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256,
  liveLinuxCgroupCpuEvidenceV2DockerBindingSha256,
  liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256,
  liveLinuxCgroupCpuEvidenceV2RoleBindingSha256,
  liveLinuxCgroupCpuEvidenceV2Sha256,
  parseLiveLinuxCgroupCpuEvidenceV2,
} from "../../dist/codex/live-linux-cgroup-cpu-evidence-v2.js";

const REQUEST_ID = "a".repeat(32);
const RUN_NONCE = Buffer.alloc(32, 7).toString("base64url");
const REQUEST_SHA256 = "b".repeat(64);
const EXECUTION_BINDING_SHA256 = "c".repeat(64);
const WORKER_IMAGE_DIGEST = `sha256:${"e".repeat(64)}`;
const WORKER_POLICY_SHA256 = "f".repeat(64);
const ACCEPTED_CORPUS_SHA256 = "1".repeat(64);
const SUPERVISOR_RUN_ID = "live-supervisor-run-0001";
const CONTROLLER_IDENTITY_SHA256 = "d".repeat(64);

const base = {
  schemaVersion: "2",
  evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2",
  requestId: REQUEST_ID,
  runNonce: RUN_NONCE,
  requestSha256: REQUEST_SHA256,
  executionBindingSha256: EXECUTION_BINDING_SHA256,
  supervisorRunId: SUPERVISOR_RUN_ID,
  workerImageDigest: WORKER_IMAGE_DIGEST,
  workerPolicySha256: WORKER_POLICY_SHA256,
  acceptedCorpusSha256: ACCEPTED_CORPUS_SHA256,
  budgetUsec: "200",
};

function roleIdentity(role, index) {
  const value = {
    role,
    containerId: index.toString(16).repeat(64),
    pid: 1_000 + index,
    startedAt: `2026-07-16T00:00:0${index}.000000000Z`,
    cgroupIdentitySha256: (index + 8).toString(16).repeat(64),
  };
  return {
    ...value,
    roleBindingSha256: liveLinuxCgroupCpuEvidenceV2RoleBindingSha256({
      requestId: REQUEST_ID,
      runNonce: RUN_NONCE,
      executionBindingSha256: EXECUTION_BINDING_SHA256,
      supervisorRunId: SUPERVISOR_RUN_ID,
      ...value,
    }),
  };
}

function lifecycleEvent(sequence, monotonicNs, eventType, identity) {
  return {
    sequence,
    monotonicNs: String(monotonicNs),
    eventType,
    role: identity.role,
    roleBindingSha256: identity.roleBindingSha256,
  };
}

function sampleEvent(sequence, monotonicNs, identity, sampleIndex, usageUsec) {
  return {
    ...lifecycleEvent(sequence, monotonicNs, "ROLE_CPU_SAMPLE", identity),
    sampleIndex,
    usageUsec,
  };
}

function observedSuccess(outcome = "OBSERVED_WITHIN_BUDGET") {
  const identities = [
    roleIdentity("egress", 1),
    roleIdentity("worker", 2),
    roleIdentity("verifier", 3),
  ];
  const [egress, worker, verifier] = identities;
  const events = [
    {
      sequence: 1,
      monotonicNs: "100",
      eventType: "CONTROLLER_STARTED",
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    },
    lifecycleEvent(2, 110, "ROLE_CGROUP_BOUND", egress),
    sampleEvent(3, 120, egress, 0, "10"),
    lifecycleEvent(4, 130, "ROLE_EXECUTION_STARTED", egress),
    lifecycleEvent(5, 140, "ROLE_CGROUP_BOUND", worker),
    sampleEvent(6, 150, worker, 0, "20"),
    lifecycleEvent(7, 160, "ROLE_EXECUTION_STARTED", worker),
    sampleEvent(8, 170, egress, 1, "20"),
    sampleEvent(9, 180, worker, 1, "40"),
    lifecycleEvent(10, 190, "ROLE_EXECUTION_STOPPED", worker),
    sampleEvent(11, 200, worker, 2, "60"),
    lifecycleEvent(12, 210, "ROLE_CGROUP_RELEASED", worker),
    lifecycleEvent(13, 220, "ROLE_EXECUTION_STOPPED", egress),
    sampleEvent(14, 230, egress, 2, "30"),
    lifecycleEvent(15, 240, "ROLE_CGROUP_RELEASED", egress),
    lifecycleEvent(16, 250, "ROLE_CGROUP_BOUND", verifier),
    sampleEvent(17, 260, verifier, 0, "100"),
    lifecycleEvent(18, 270, "ROLE_EXECUTION_STARTED", verifier),
    sampleEvent(19, 280, verifier, 1, "120"),
    lifecycleEvent(20, 290, "ROLE_EXECUTION_STOPPED", verifier),
    sampleEvent(21, 300, verifier, 2, "140"),
    lifecycleEvent(22, 310, "ROLE_CGROUP_RELEASED", verifier),
    {
      sequence: 23,
      monotonicNs: "320",
      eventType: "CONTROLLER_STOPPED",
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    },
  ];
  const samples = [
    { values: ["10", "20", "30"], sequences: [3, 8, 14], lifecycle: [2, 4, 13, 15] },
    { values: ["20", "40", "60"], sequences: [6, 9, 11], lifecycle: [5, 7, 10, 12] },
    { values: ["100", "120", "140"], sequences: [17, 19, 21], lifecycle: [16, 18, 20, 22] },
  ];
  const roles = identities.map((identity, index) => ({
    ...identity,
    baselineUsageUsec: samples[index].values[0],
    finalUsageUsec: samples[index].values.at(-1),
    deltaUsageUsec: "40",
    sampleCount: samples[index].values.length,
    samplesUsec: samples[index].values,
    sampleEventSequences: samples[index].sequences,
    cgroupBoundEventSequence: samples[index].lifecycle[0],
    executionStartedEventSequence: samples[index].lifecycle[1],
    executionStoppedEventSequence: samples[index].lifecycle[2],
    cgroupReleasedEventSequence: samples[index].lifecycle[3],
    released: true,
  }));
  roles[0].deltaUsageUsec = "20";
  const dockerBindingSha256 = liveLinuxCgroupCpuEvidenceV2DockerBindingSha256({
    requestSha256: REQUEST_SHA256,
    executionBindingSha256: EXECUTION_BINDING_SHA256,
    supervisorRunId: SUPERVISOR_RUN_ID,
    workerImageDigest: WORKER_IMAGE_DIGEST,
    roles,
  });
  const eventTranscriptSha256 = liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
    requestId: REQUEST_ID,
    runNonce: RUN_NONCE,
    requestSha256: REQUEST_SHA256,
    executionBindingSha256: EXECUTION_BINDING_SHA256,
    supervisorRunId: SUPERVISOR_RUN_ID,
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    clock: "CLOCK_MONOTONIC_RAW_NS",
    events,
  });
  const evidence = {
    ...base,
    outcome,
    dockerBindingSha256,
    aggregateUsageUsec: "100",
    accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE",
    samplingMode: "LINUX_CGROUP_V2_GLOBAL_MONOTONIC_EVENT_TRANSCRIPT",
    clock: "CLOCK_MONOTONIC_RAW_NS",
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    eventCount: events.length,
    events,
    eventTranscriptSha256,
    cumulativeAccountingVerified: true,
    failStopEnforcementArmed: true,
    hardLimitEnforced: false,
    overshootBounded: false,
    containmentTriggered: false,
    controllerStopped: true,
    allRoleCgroupsReleased: true,
    remainingProcessCount: 0,
    roles,
  };
  if (outcome === "EXECUTION_NON_CPU_FAILURE") {
    evidence.failurePhase = "CODEX_EXECUTION";
    evidence.failureCode = "WORKER_REPORTED_FAILURE";
  }
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}

function preExecutionFailure() {
  const evidence = {
    ...base,
    outcome: "PRE_EXECUTION_REJECTED",
    rejectionStage: "SUPERVISOR_ADMISSION",
    rejectionCode: "SUPERVISOR_FAIL_CLOSED",
    controllerStarted: false,
    executionStarted: false,
    dockerBindingSha256: null,
    containmentStatus: "NOT_APPLICABLE",
    controllerStopStatus: "NOT_STARTED",
    cgroupReleaseStatus: "NOT_APPLICABLE",
    remainingProcessCount: 0,
  };
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}

function controllerFailure() {
  const events = [
    {
      sequence: 1,
      monotonicNs: "100",
      eventType: "CONTROLLER_STARTED",
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    },
    {
      sequence: 2,
      monotonicNs: "110",
      eventType: "FAILURE_OBSERVED",
      failurePhase: "ROLE_ADMISSION",
      failureCode: "CGROUP_BIND_FAILED",
    },
    {
      sequence: 3,
      monotonicNs: "120",
      eventType: "CONTROLLER_STOPPED",
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    },
  ];
  const evidence = {
    ...base,
    outcome: "LINUX_CONTROLLER_FAILURE",
    failurePhase: "ROLE_ADMISSION",
    failureCode: "CGROUP_BIND_FAILED",
    controllerStarted: true,
    executionStarted: false,
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    attemptBindingSha256: liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256({
      requestId: REQUEST_ID,
      runNonce: RUN_NONCE,
      requestSha256: REQUEST_SHA256,
      executionBindingSha256: EXECUTION_BINDING_SHA256,
      supervisorRunId: SUPERVISOR_RUN_ID,
      workerImageDigest: WORKER_IMAGE_DIGEST,
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
      observedRoles: [],
    }),
    dockerBindingSha256: null,
    observedAggregateUsageUsec: "0",
    overageUsec: null,
    clock: "CLOCK_MONOTONIC_RAW_NS",
    eventCount: events.length,
    events,
    eventTranscriptSha256: liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
      requestId: REQUEST_ID,
      runNonce: RUN_NONCE,
      requestSha256: REQUEST_SHA256,
      executionBindingSha256: EXECUTION_BINDING_SHA256,
      supervisorRunId: SUPERVISOR_RUN_ID,
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
      clock: "CLOCK_MONOTONIC_RAW_NS",
      events,
    }),
    observedRoles: [],
    containment: {
      status: "NOT_REQUIRED",
      trigger: "CONTROLLER_FAILURE",
      freeze: "NOT_ATTEMPTED",
      kill: "NOT_ATTEMPTED",
      reap: "NOT_ATTEMPTED",
    },
    controllerStopStatus: "STOPPED",
    remainingProcessCount: 0,
  };
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}

function observedBudgetFailure(incomplete = false) {
  const egress = roleIdentity("egress", 1);
  const events = [
    {
      sequence: 1,
      monotonicNs: "100",
      eventType: "CONTROLLER_STARTED",
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    },
    lifecycleEvent(2, 110, "ROLE_CGROUP_BOUND", egress),
    sampleEvent(3, 120, egress, 0, "0"),
    lifecycleEvent(4, 130, "ROLE_EXECUTION_STARTED", egress),
    sampleEvent(5, 140, egress, 1, "250"),
    {
      sequence: 6,
      monotonicNs: "150",
      eventType: "FAILURE_OBSERVED",
      failurePhase: "SAMPLING",
      failureCode: "CPU_BUDGET_EXCEEDED",
    },
    {
      sequence: 7,
      monotonicNs: "160",
      eventType: "CONTAINMENT_ACTION",
      action: "FREEZE",
      result: "SUCCEEDED",
    },
    {
      sequence: 8,
      monotonicNs: "170",
      eventType: "CONTAINMENT_ACTION",
      action: "KILL",
      result: "SUCCEEDED",
    },
    {
      sequence: 9,
      monotonicNs: "180",
      eventType: "CONTAINMENT_ACTION",
      action: "REAP",
      result: incomplete ? "FAILED" : "SUCCEEDED",
    },
    lifecycleEvent(10, 190, "ROLE_EXECUTION_STOPPED", egress),
  ];
  if (!incomplete) {
    events.push(
      lifecycleEvent(11, 200, "ROLE_CGROUP_RELEASED", egress),
      {
        sequence: 12,
        monotonicNs: "210",
        eventType: "CONTROLLER_STOPPED",
        controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
      },
    );
  }
  const observedRoles = [
    {
      ...egress,
      baselineUsageUsec: "0",
      lastUsageUsec: "250",
      observedDeltaUsageUsec: "250",
      sampleCount: 2,
      released: !incomplete,
    },
  ];
  const evidence = {
    ...base,
    outcome: incomplete ? "CONTAINMENT_INCOMPLETE" : "OBSERVED_OVER_BUDGET_CONTAINED",
    failurePhase: "SAMPLING",
    failureCode: "CPU_BUDGET_EXCEEDED",
    controllerStarted: true,
    executionStarted: true,
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    attemptBindingSha256: liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256({
      requestId: REQUEST_ID,
      runNonce: RUN_NONCE,
      requestSha256: REQUEST_SHA256,
      executionBindingSha256: EXECUTION_BINDING_SHA256,
      supervisorRunId: SUPERVISOR_RUN_ID,
      workerImageDigest: WORKER_IMAGE_DIGEST,
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
      observedRoles,
    }),
    dockerBindingSha256: null,
    observedAggregateUsageUsec: "250",
    overageUsec: "50",
    clock: "CLOCK_MONOTONIC_RAW_NS",
    eventCount: events.length,
    events,
    eventTranscriptSha256: liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
      requestId: REQUEST_ID,
      runNonce: RUN_NONCE,
      requestSha256: REQUEST_SHA256,
      executionBindingSha256: EXECUTION_BINDING_SHA256,
      supervisorRunId: SUPERVISOR_RUN_ID,
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
      clock: "CLOCK_MONOTONIC_RAW_NS",
      events,
    }),
    observedRoles,
    containment: {
      status: incomplete ? "INCOMPLETE" : "SUCCEEDED",
      trigger: "CPU_BUDGET_EXCEEDED",
      freeze: "SUCCEEDED",
      kill: "SUCCEEDED",
      reap: incomplete ? "FAILED" : "SUCCEEDED",
    },
    controllerStopStatus: incomplete ? "STOP_FAILED" : "STOPPED",
    remainingProcessCount: incomplete ? 1 : 0,
  };
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}

function rehashObservedEvidence(evidence) {
  evidence.eventCount = evidence.events.length;
  evidence.eventTranscriptSha256 = liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
    requestId: evidence.requestId,
    runNonce: evidence.runNonce,
    requestSha256: evidence.requestSha256,
    executionBindingSha256: evidence.executionBindingSha256,
    supervisorRunId: evidence.supervisorRunId,
    controllerIdentitySha256: evidence.controllerIdentitySha256,
    clock: evidence.clock,
    events: evidence.events,
  });
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}

function reorderSuccessTranscript(evidence, originalSequenceOrder) {
  const bySequence = new Map(evidence.events.map((event) => [event.sequence, event]));
  evidence.events = originalSequenceOrder.map((sequence, index) => ({
    ...structuredClone(bySequence.get(sequence)),
    sequence: index + 1,
    monotonicNs: String(100 + index * 10),
  }));
  for (const role of evidence.roles) {
    const roleEvents = evidence.events.filter((event) => event.role === role.role);
    role.cgroupBoundEventSequence = roleEvents.find(
      (event) => event.eventType === "ROLE_CGROUP_BOUND",
    ).sequence;
    role.executionStartedEventSequence = roleEvents.find(
      (event) => event.eventType === "ROLE_EXECUTION_STARTED",
    ).sequence;
    role.executionStoppedEventSequence = roleEvents.find(
      (event) => event.eventType === "ROLE_EXECUTION_STOPPED",
    ).sequence;
    role.cgroupReleasedEventSequence = roleEvents.find(
      (event) => event.eventType === "ROLE_CGROUP_RELEASED",
    ).sequence;
    role.sampleEventSequences = roleEvents
      .filter((event) => event.eventType === "ROLE_CPU_SAMPLE")
      .map((event) => event.sequence);
  }
  return rehashObservedEvidence(evidence);
}

const expected = {
  requestId: REQUEST_ID,
  runNonce: RUN_NONCE,
  requestSha256: REQUEST_SHA256,
  executionBindingSha256: EXECUTION_BINDING_SHA256,
  supervisorRunId: SUPERVISOR_RUN_ID,
  workerImageDigest: WORKER_IMAGE_DIGEST,
  workerPolicySha256: WORKER_POLICY_SHA256,
  acceptedCorpusSha256: ACCEPTED_CORPUS_SHA256,
  budgetUsec: 200n,
};

test("CPU evidence v2 derives success only from one globally ordered transcript", () => {
  const parsed = parseLiveLinuxCgroupCpuEvidenceV2(observedSuccess(), expected);
  assert.equal(parsed.outcome, "OBSERVED_WITHIN_BUDGET");
  assert.equal(parsed.aggregateUsageUsec, "100");
  assert.equal(parsed.events.length, 23);
  assert.deepEqual(parsed.roles.map((role) => role.deltaUsageUsec), ["20", "40", "40"]);
  assert.equal(parsed.hardLimitEnforced, false);
  assert.equal(parsed.overshootBounded, false);
});

test("CPU evidence v2 rejects legacy, static, and unknown profiles", () => {
  for (const value of [
    { schemaVersion: "1", proofType: "LIVE_LINUX_CGROUP_V2_THREE_ROLE" },
    { schemaVersion: "1", status: "STATIC_FAKE_CONTROLLER_VERIFIED" },
    { ...preExecutionFailure(), extra: true },
  ]) {
    assert.throws(
      () => parseLiveLinuxCgroupCpuEvidenceV2(value),
      /CPU evidence v2|unknown|missing|profile/u,
    );
  }
});

test("CPU evidence v2 rejects extra success and observed-failure roles", () => {
  const success = observedSuccess();
  success.roles.push(structuredClone(success.roles[2]));
  success.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(success);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(success),
    /success profile/u,
  );

  const failure = observedBudgetFailure();
  const extraRole = structuredClone(failure.observedRoles[0]);
  failure.observedRoles.push(
    structuredClone(extraRole),
    structuredClone(extraRole),
    structuredClone(extraRole),
  );
  failure.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(failure);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(failure),
    /too many roles/u,
  );
});

test("CPU evidence v2 rejects non-increasing role sample references", () => {
  const changed = observedSuccess();
  changed.roles[0].sampleEventSequences = [3, 14, 8];
  changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(changed),
    /samples or arithmetic/u,
  );
});

test("CPU evidence v2 rejects transcript hash, sequence, timestamp, and sample-link forgery", () => {
  const mutations = [
    (value) => { value.eventTranscriptSha256 = "0".repeat(64); },
    (value) => { value.events[8].sequence = 8; },
    (value) => { value.events[8].monotonicNs = value.events[7].monotonicNs; },
    (value) => { value.events[8].usageUsec = "41"; },
    (value) => { value.roles[1].sampleEventSequences[1] = 8; },
    (value) => { value.roles[1].roleBindingSha256 = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const changed = observedSuccess();
    mutate(changed);
    changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
    assert.throws(
      () => parseLiveLinuxCgroupCpuEvidenceV2(changed),
      /transcript|sequence|monotonic|sample|binding/u,
    );
  }
});

test("CPU evidence v2 rejects an otherwise well-hashed unlinked success event", () => {
  const changed = observedSuccess();
  changed.events.at(-1).sequence = 24;
  changed.events.at(-1).monotonicNs = "330";
  changed.events.splice(22, 0, {
    sequence: 23,
    monotonicNs: "320",
    eventType: "FAILURE_OBSERVED",
    failurePhase: "SAMPLING",
    failureCode: "CPU_STAT_READ_FAILED",
  });
  changed.eventCount = changed.events.length;
  changed.eventTranscriptSha256 = liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
    requestId: REQUEST_ID,
    runNonce: RUN_NONCE,
    requestSha256: REQUEST_SHA256,
    executionBindingSha256: EXECUTION_BINDING_SHA256,
    supervisorRunId: SUPERVISOR_RUN_ID,
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    clock: "CLOCK_MONOTONIC_RAW_NS",
    events: changed.events,
  });
  changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(changed),
    /unlinked or duplicate event/u,
  );
});

test("CPU evidence v2 rejects non-overlap and verifier-before-egress-stop", () => {
  const nonOverlap = reorderSuccessTranscript(
    observedSuccess(),
    [1, 2, 3, 4, 8, 13, 14, 15, 5, 6, 7, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23],
  );
  assert.throws(() => parseLiveLinuxCgroupCpuEvidenceV2(nonOverlap), /overlap/u);

  const earlyVerifier = reorderSuccessTranscript(
    observedSuccess(),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 13, 14, 15, 23],
  );
  assert.throws(() => parseLiveLinuxCgroupCpuEvidenceV2(earlyVerifier), /verifier ordering/u);
});

test("CPU evidence v2 accepts typed pre-execution and controller failures", () => {
  assert.equal(
    parseLiveLinuxCgroupCpuEvidenceV2(preExecutionFailure(), expected).outcome,
    "PRE_EXECUTION_REJECTED",
  );
  assert.equal(
    parseLiveLinuxCgroupCpuEvidenceV2(controllerFailure(), expected).outcome,
    "LINUX_CONTROLLER_FAILURE",
  );
});

test("pre-execution failure cannot claim Linux or containment observations", () => {
  for (const [key, value] of [
    ["controllerIdentitySha256", CONTROLLER_IDENTITY_SHA256],
    ["observedAggregateUsageUsec", "0"],
    ["containment", { status: "NOT_REQUIRED" }],
    ["observedRoles", []],
  ]) {
    const changed = preExecutionFailure();
    changed[key] = value;
    changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
    assert.throws(() => parseLiveLinuxCgroupCpuEvidenceV2(changed), /unknown|profile/u);
  }
});

test("pre-execution failure stage and code pairs are closed", () => {
  for (const [rejectionStage, rejectionCode] of [
    ["SUPERVISOR_ADMISSION", "EXECUTOR_UNAVAILABLE"],
    ["CONTROLLER_INITIALIZATION", "REQUEST_REJECTED"],
    ["EXECUTOR_START", "CONTROLLER_UNAVAILABLE"],
  ]) {
    const changed = preExecutionFailure();
    changed.rejectionStage = rejectionStage;
    changed.rejectionCode = rejectionCode;
    changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
    assert.throws(
      () => parseLiveLinuxCgroupCpuEvidenceV2(changed),
      /pre-execution failure profile/u,
    );
  }
});

test("controller failure binds request, partial role set, transcript, and containment state", () => {
  for (const mutate of [
    (value) => { value.attemptBindingSha256 = "0".repeat(64); },
    (value) => { value.events[1].failureCode = "CPU_STAT_READ_FAILED"; },
    (value) => { value.controllerStopStatus = "STOP_FAILED"; },
    (value) => { value.containment.status = "INCOMPLETE"; },
  ]) {
    const changed = controllerFailure();
    mutate(changed);
    changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
    assert.throws(
      () => parseLiveLinuxCgroupCpuEvidenceV2(changed),
      /attempt|failure|controller|containment|incomplete/u,
    );
  }
});

test("failure transcript closes controller and role lifecycle ordering", () => {
  const wrongStopIdentity = controllerFailure();
  wrongStopIdentity.events[2].controllerIdentitySha256 = "0".repeat(64);
  rehashObservedEvidence(wrongStopIdentity);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(wrongStopIdentity),
    /controller stop transcript/u,
  );

  const duplicateStart = controllerFailure();
  duplicateStart.events.splice(1, 0, {
    sequence: 2,
    monotonicNs: "105",
    eventType: "CONTROLLER_STARTED",
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
  });
  duplicateStart.events.forEach((event, index) => { event.sequence = index + 1; });
  rehashObservedEvidence(duplicateStart);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(duplicateStart),
    /controller start transcript/u,
  );

  const startBeforeBound = observedBudgetFailure();
  startBeforeBound.events[1].eventType = "ROLE_EXECUTION_STARTED";
  startBeforeBound.events[3].eventType = "ROLE_CGROUP_BOUND";
  rehashObservedEvidence(startBeforeBound);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(startBeforeBound),
    /release linkage/u,
  );

  const startAfterFailure = observedBudgetFailure();
  const start = structuredClone(startAfterFailure.events[3]);
  startAfterFailure.events[3] = {
    ...startAfterFailure.events[5],
    sequence: 4,
    monotonicNs: "130",
  };
  startAfterFailure.events[5] = { ...start, sequence: 6, monotonicNs: "150" };
  rehashObservedEvidence(startAfterFailure);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(startAfterFailure),
    /starts after the observed failure/u,
  );

  const releaseBeforeStop = observedBudgetFailure();
  releaseBeforeStop.events[9].eventType = "ROLE_CGROUP_RELEASED";
  releaseBeforeStop.events[10].eventType = "ROLE_EXECUTION_STOPPED";
  rehashObservedEvidence(releaseBeforeStop);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(releaseBeforeStop),
    /release linkage/u,
  );
});

test("failure phase/code and active fail-stop state are closed", () => {
  const mismatched = controllerFailure();
  mismatched.failureCode = "CONTROLLER_STOP_FAILED";
  mismatched.events[1].failureCode = "CONTROLLER_STOP_FAILED";
  rehashObservedEvidence(mismatched);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(mismatched),
    /phase and code/u,
  );

  const activeWithoutContainment = observedBudgetFailure();
  activeWithoutContainment.outcome = "LINUX_CONTROLLER_FAILURE";
  activeWithoutContainment.failureCode = "CPU_STAT_READ_FAILED";
  activeWithoutContainment.events[4].usageUsec = "100";
  activeWithoutContainment.events[5].failureCode = "CPU_STAT_READ_FAILED";
  activeWithoutContainment.events.splice(6, 3);
  activeWithoutContainment.events.forEach((event, index) => { event.sequence = index + 1; });
  activeWithoutContainment.observedRoles[0].lastUsageUsec = "100";
  activeWithoutContainment.observedRoles[0].observedDeltaUsageUsec = "100";
  activeWithoutContainment.observedAggregateUsageUsec = "100";
  activeWithoutContainment.overageUsec = null;
  activeWithoutContainment.containment = {
    status: "NOT_REQUIRED",
    trigger: "CONTROLLER_FAILURE",
    freeze: "NOT_ATTEMPTED",
    kill: "NOT_ATTEMPTED",
    reap: "NOT_ATTEMPTED",
  };
  rehashObservedEvidence(activeWithoutContainment);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(activeWithoutContainment),
    /fail-stop containment/u,
  );
});

test("non-CPU execution failure retains the complete within-budget CPU observation", () => {
  const parsed = parseLiveLinuxCgroupCpuEvidenceV2(
    observedSuccess("EXECUTION_NON_CPU_FAILURE"),
    expected,
  );
  assert.equal(parsed.outcome, "EXECUTION_NON_CPU_FAILURE");
  assert.equal(parsed.failurePhase, "CODEX_EXECUTION");
  assert.equal(parsed.aggregateUsageUsec, "100");
});

test("CPU evidence v2 distinguishes contained overage from incomplete containment", () => {
  const contained = parseLiveLinuxCgroupCpuEvidenceV2(observedBudgetFailure(), expected);
  assert.equal(contained.outcome, "OBSERVED_OVER_BUDGET_CONTAINED");
  assert.equal(contained.overageUsec, "50");
  assert.equal(contained.remainingProcessCount, 0);

  const incomplete = parseLiveLinuxCgroupCpuEvidenceV2(
    observedBudgetFailure(true),
    expected,
  );
  assert.equal(incomplete.outcome, "CONTAINMENT_INCOMPLETE");
  assert.equal(incomplete.containment.reap, "FAILED");
  assert.equal(incomplete.remainingProcessCount, 1);
});

test("overage and containment outcomes reject contradictory cleanup or arithmetic", () => {
  for (const mutate of [
    (value) => { value.overageUsec = "49"; },
    (value) => { value.remainingProcessCount = 1; },
    (value) => { value.containment.reap = "FAILED"; },
    (value) => { value.containment.trigger = "IDENTITY_DRIFT"; },
    (value) => { value.dockerBindingSha256 = "0".repeat(64); },
  ]) {
    const changed = observedBudgetFailure();
    mutate(changed);
    changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
    assert.throws(
      () => parseLiveLinuxCgroupCpuEvidenceV2(changed),
      /over-budget|containment|Docker binding/u,
    );
  }

  const reordered = observedBudgetFailure();
  reordered.events[6].action = "KILL";
  reordered.events[7].action = "FREEZE";
  reordered.eventTranscriptSha256 = liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
    requestId: REQUEST_ID,
    runNonce: RUN_NONCE,
    requestSha256: REQUEST_SHA256,
    executionBindingSha256: EXECUTION_BINDING_SHA256,
    supervisorRunId: SUPERVISOR_RUN_ID,
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    clock: "CLOCK_MONOTONIC_RAW_NS",
    events: reordered.events,
  });
  reordered.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(reordered);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(reordered),
    /containment action order/u,
  );

  const falselyComplete = observedBudgetFailure(true);
  falselyComplete.remainingProcessCount = 0;
  falselyComplete.observedRoles[0].released = true;
  falselyComplete.controllerStopStatus = "STOPPED";
  falselyComplete.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(falselyComplete);
  assert.throws(
    () => parseLiveLinuxCgroupCpuEvidenceV2(falselyComplete),
    /release linkage|incomplete containment/u,
  );
});

test("CPU evidence v2 hash and JSON Schema keep exact version and uint64 bounds", async () => {
  const evidence = observedSuccess();
  const changed = structuredClone(evidence);
  changed.roles[0].finalUsageUsec = "31";
  assert.notEqual(
    liveLinuxCgroupCpuEvidenceV2Sha256(changed),
    evidence.cpuEvidenceSha256,
  );
  changed.cpuEvidenceSha256 = evidence.cpuEvidenceSha256;
  assert.throws(() => parseLiveLinuxCgroupCpuEvidenceV2(changed), /evidence hash/u);

  const schema = JSON.parse(
    await readFile(
      new URL("../../schemas/live-linux-cgroup-cpu-evidence.v2.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(schema.properties.schemaVersion.const, "2");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.oneOf.length, 6);
  const uint64Pattern = new RegExp(schema.$defs.uint64Decimal.pattern, "u");
  assert.equal(uint64Pattern.test("18446744073709551615"), true);
  assert.equal(uint64Pattern.test("18446744073709551616"), false);
  const noncePattern = new RegExp(schema.properties.runNonce.pattern, "u");
  assert.equal(noncePattern.test(RUN_NONCE), true);
  assert.equal(noncePattern.test(`${"A".repeat(42)}B`), false);
  assert.equal(schema.properties.budgetUsec.$ref, "#/$defs/positiveUint64Decimal");
  assert.equal(schema.$defs.positiveUint64Decimal.allOf[1].not.const, "0");
  assert.equal(schema.oneOf[1].allOf[0].oneOf.length, 2);
  assert.equal(schema.oneOf[2].allOf[0].oneOf.length, 3);
  assert.equal(schema.$defs.failurePair.oneOf.length, 8);
  assert.equal(schema.$defs.observedDockerBindingProfile.oneOf.length, 2);
  for (const branch of schema.oneOf.slice(3)) {
    assert.equal(
      branch.allOf.some(
        (entry) => entry.$ref === "#/$defs/observedDockerBindingProfile",
      ),
      true,
    );
  }
  assert.equal(JSON.stringify(schema).includes("CONTROLLER_START_FAILED"), false);
  assert.equal(schema.$defs.containment.oneOf.length, 3);
  const oversizedString = preExecutionFailure();
  oversizedString.rejectionCode = "x".repeat(1_025);
  assert.throws(
    () => liveLinuxCgroupCpuEvidenceV2Sha256(oversizedString),
    /string exceeds the structural limit/u,
  );
});

test("CPU evidence v2 parser rejects noncanonical nonce, zero/overflow budget, and invalid dates", () => {
  const mutations = [
    {
      mutate(value) { value.runNonce = `${"A".repeat(42)}B`; },
      pattern: /run nonce/u,
    },
    {
      mutate(value) { value.budgetUsec = "0"; },
      pattern: /budget/u,
    },
    {
      mutate(value) { value.budgetUsec = "18446744073709551616"; },
      pattern: /unsigned 64-bit/u,
    },
    {
      mutate(value) { value.roles[0].startedAt = "2026-02-30T00:00:00Z"; },
      pattern: /start timestamp/u,
    },
  ];
  for (const { mutate, pattern } of mutations) {
    const changed = observedSuccess();
    mutate(changed);
    changed.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(changed);
    assert.throws(() => parseLiveLinuxCgroupCpuEvidenceV2(changed), pattern);
  }
});

test("CPU evidence v2 JSON Schema branches exclude every foreign outcome field", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../schemas/live-linux-cgroup-cpu-evidence.v2.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const baseFields = new Set(schema.required);
  const successFields = [
    "dockerBindingSha256",
    "aggregateUsageUsec",
    "accountingScope",
    "samplingMode",
    "clock",
    "controllerIdentitySha256",
    "eventCount",
    "events",
    "eventTranscriptSha256",
    "cumulativeAccountingVerified",
    "failStopEnforcementArmed",
    "hardLimitEnforced",
    "overshootBounded",
    "containmentTriggered",
    "controllerStopped",
    "allRoleCgroupsReleased",
    "remainingProcessCount",
    "roles",
  ];
  const preExecutionFields = [
    "rejectionStage",
    "rejectionCode",
    "controllerStarted",
    "executionStarted",
    "dockerBindingSha256",
    "containmentStatus",
    "controllerStopStatus",
    "cgroupReleaseStatus",
    "remainingProcessCount",
  ];
  const observedFailureFields = [
    "failurePhase",
    "failureCode",
    "controllerStarted",
    "executionStarted",
    "controllerIdentitySha256",
    "attemptBindingSha256",
    "dockerBindingSha256",
    "observedAggregateUsageUsec",
    "overageUsec",
    "clock",
    "eventCount",
    "events",
    "eventTranscriptSha256",
    "observedRoles",
    "containment",
    "controllerStopStatus",
    "remainingProcessCount",
  ];
  const allowedByBranch = [
    successFields,
    [...successFields, "failurePhase", "failureCode"],
    preExecutionFields,
    observedFailureFields,
    observedFailureFields,
    observedFailureFields,
  ];
  const rootFields = Object.keys(schema.properties);
  schema.oneOf.forEach((branch, index) => {
    const allowed = new Set([...baseFields, ...allowedByBranch[index]]);
    const expectedForbidden = rootFields.filter((field) => !allowed.has(field)).sort();
    const actualForbidden = branch.not.anyOf
      .map((entry) => entry.required[0])
      .sort();
    assert.deepEqual(actualForbidden, expectedForbidden, `schema branch ${index} foreign fields`);
  });
});
