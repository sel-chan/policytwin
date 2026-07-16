import {
  liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256,
  liveLinuxCgroupCpuEvidenceV2DockerBindingSha256,
  liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256,
  liveLinuxCgroupCpuEvidenceV2RoleBindingSha256,
  liveLinuxCgroupCpuEvidenceV2Sha256,
  workerRpcSha256,
} from "../../dist/index.js";

const CONTROLLER_IDENTITY_SHA256 = "d".repeat(64);

function roleIdentity(request, supervisorRunId, role, index) {
  const identity = {
    role,
    containerId: index.toString(16).repeat(64),
    pid: 2_000 + index,
    startedAt: `2026-07-16T00:00:0${index}.000000000Z`,
    cgroupIdentitySha256: (index + 8).toString(16).repeat(64),
  };
  return {
    ...identity,
    roleBindingSha256: liveLinuxCgroupCpuEvidenceV2RoleBindingSha256({
      requestId: request.requestId,
      runNonce: request.runNonce,
      executionBindingSha256: request.executionBindingSha256,
      supervisorRunId,
      ...identity,
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

export function createSuccessCpuEvidenceV2(request, options = {}) {
  const supervisorRunId = options.supervisorRunId ?? "live-supervisor-run-0001";
  const outcome = options.outcome ?? "OBSERVED_WITHIN_BUDGET";
  const identities = [
    roleIdentity(request, supervisorRunId, "egress", 1),
    roleIdentity(request, supervisorRunId, "worker", 2),
    roleIdentity(request, supervisorRunId, "verifier", 3),
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
    deltaUsageUsec: index === 0 ? "20" : "40",
    sampleCount: samples[index].values.length,
    samplesUsec: samples[index].values,
    sampleEventSequences: samples[index].sequences,
    cgroupBoundEventSequence: samples[index].lifecycle[0],
    executionStartedEventSequence: samples[index].lifecycle[1],
    executionStoppedEventSequence: samples[index].lifecycle[2],
    cgroupReleasedEventSequence: samples[index].lifecycle[3],
    released: true,
  }));
  const requestSha256 = workerRpcSha256(request);
  const dockerBindingSha256 = liveLinuxCgroupCpuEvidenceV2DockerBindingSha256({
    requestSha256,
    executionBindingSha256: request.executionBindingSha256,
    supervisorRunId,
    workerImageDigest: request.policy.workerImageDigest,
    roles,
  });
  const eventTranscriptSha256 = liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
    requestId: request.requestId,
    runNonce: request.runNonce,
    requestSha256,
    executionBindingSha256: request.executionBindingSha256,
    supervisorRunId,
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    clock: "CLOCK_MONOTONIC_RAW_NS",
    events,
  });
  const evidence = {
    schemaVersion: "2",
    evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2",
    outcome,
    requestId: request.requestId,
    runNonce: request.runNonce,
    requestSha256,
    executionBindingSha256: request.executionBindingSha256,
    supervisorRunId,
    workerImageDigest: request.policy.workerImageDigest,
    workerPolicySha256: request.policySha256,
    acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
    budgetUsec: String(BigInt(request.policy.limits.cpuTimeMs) * 1_000n),
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
    evidence.failurePhase = options.failurePhase ?? "CODEX_EXECUTION";
    evidence.failureCode = options.failureCode ?? "WORKER_REPORTED_FAILURE";
  }
  Object.assign(evidence, options.overrides ?? {});
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}

export function createPreExecutionFailureCpuEvidenceV2(request, options = {}) {
  const evidence = {
    schemaVersion: "2",
    evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2",
    outcome: "PRE_EXECUTION_REJECTED",
    requestId: request.requestId,
    runNonce: request.runNonce,
    requestSha256: workerRpcSha256(request),
    executionBindingSha256: request.executionBindingSha256,
    supervisorRunId: options.supervisorRunId ?? "live-supervisor-run-0001",
    workerImageDigest: request.policy.workerImageDigest,
    workerPolicySha256: request.policySha256,
    acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
    budgetUsec: String(BigInt(request.policy.limits.cpuTimeMs) * 1_000n),
    rejectionStage: options.rejectionStage ?? "SUPERVISOR_ADMISSION",
    rejectionCode: options.rejectionCode ?? "SUPERVISOR_FAIL_CLOSED",
    controllerStarted: false,
    executionStarted: false,
    dockerBindingSha256: null,
    containmentStatus: "NOT_APPLICABLE",
    controllerStopStatus: "NOT_STARTED",
    cgroupReleaseStatus: "NOT_APPLICABLE",
    remainingProcessCount: 0,
  };
  Object.assign(evidence, options.overrides ?? {});
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}

export function createObservedBudgetFailureCpuEvidenceV2(request, options = {}) {
  const supervisorRunId = options.supervisorRunId ?? "live-supervisor-run-0001";
  const incomplete = options.incomplete ?? false;
  const egress = roleIdentity(request, supervisorRunId, "egress", 1);
  const budgetUsec = BigInt(request.policy.limits.cpuTimeMs) * 1_000n;
  const observedUsec = budgetUsec + 50n;
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
    sampleEvent(5, 140, egress, 1, observedUsec.toString()),
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
      lastUsageUsec: observedUsec.toString(),
      observedDeltaUsageUsec: observedUsec.toString(),
      sampleCount: 2,
      released: !incomplete,
    },
  ];
  const requestSha256 = workerRpcSha256(request);
  const evidence = {
    schemaVersion: "2",
    evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2",
    outcome: incomplete ? "CONTAINMENT_INCOMPLETE" : "OBSERVED_OVER_BUDGET_CONTAINED",
    requestId: request.requestId,
    runNonce: request.runNonce,
    requestSha256,
    executionBindingSha256: request.executionBindingSha256,
    supervisorRunId,
    workerImageDigest: request.policy.workerImageDigest,
    workerPolicySha256: request.policySha256,
    acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
    budgetUsec: budgetUsec.toString(),
    failurePhase: "SAMPLING",
    failureCode: "CPU_BUDGET_EXCEEDED",
    controllerStarted: true,
    executionStarted: true,
    controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
    attemptBindingSha256: liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256({
      requestId: request.requestId,
      runNonce: request.runNonce,
      requestSha256,
      executionBindingSha256: request.executionBindingSha256,
      supervisorRunId,
      workerImageDigest: request.policy.workerImageDigest,
      controllerIdentitySha256: CONTROLLER_IDENTITY_SHA256,
      observedRoles,
    }),
    dockerBindingSha256: null,
    observedAggregateUsageUsec: observedUsec.toString(),
    overageUsec: "50",
    clock: "CLOCK_MONOTONIC_RAW_NS",
    eventCount: events.length,
    events,
    eventTranscriptSha256: liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
      requestId: request.requestId,
      runNonce: request.runNonce,
      requestSha256,
      executionBindingSha256: request.executionBindingSha256,
      supervisorRunId,
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
  Object.assign(evidence, options.overrides ?? {});
  evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
  return evidence;
}
