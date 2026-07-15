import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  liveLinuxCgroupDockerBindingSha256,
  liveLinuxCgroupCpuSampleTranscriptSha256,
  parseLiveLinuxCgroupCpuProof,
} from "../../dist/codex/live-linux-cgroup-cpu-proof.js";

const REQUEST_ID = "a".repeat(32);
const RUN_NONCE = Buffer.alloc(32, 7).toString("base64url");
const REQUEST_SHA256 = "b".repeat(64);
const EXECUTION_BINDING_SHA256 = "c".repeat(64);
const WORKER_IMAGE_DIGEST = `sha256:${"e".repeat(64)}`;
const WORKER_POLICY_SHA256 = "f".repeat(64);
const ACCEPTED_CORPUS_SHA256 = "1".repeat(64);
const SUPERVISOR_RUN_ID = "live-supervisor-run-0001";

function role(roleName, index, samplesUsec) {
  return {
    role: roleName,
    containerId: index.toString(16).repeat(64),
    pid: 1_000 + index,
    startedAt: `2026-07-16T00:00:0${index}.000000000Z`,
    cgroupIdentitySha256: (index + 8).toString(16).repeat(64),
    baselineUsageUsec: samplesUsec[0],
    finalUsageUsec: samplesUsec.at(-1),
    deltaUsageUsec: String(BigInt(samplesUsec.at(-1)) - BigInt(samplesUsec[0])),
    sampleCount: samplesUsec.length,
    samplesUsec,
    sampleTranscriptSha256: liveLinuxCgroupCpuSampleTranscriptSha256(samplesUsec),
    released: true,
  };
}

function proof() {
  const roles = [
    role("egress", 1, ["10", "20", "30"]),
    role("worker", 2, ["20", "60"]),
    role("verifier", 3, ["100", "140"]),
  ];
  const dockerBindingSha256 = liveLinuxCgroupDockerBindingSha256({
    requestSha256: REQUEST_SHA256,
    executionBindingSha256: EXECUTION_BINDING_SHA256,
    supervisorRunId: SUPERVISOR_RUN_ID,
    workerImageDigest: WORKER_IMAGE_DIGEST,
    roles,
  });
  return {
    schemaVersion: "1",
    proofType: "LIVE_LINUX_CGROUP_V2_THREE_ROLE",
    status: "OBSERVED_WITHIN_BUDGET",
    requestId: REQUEST_ID,
    runNonce: RUN_NONCE,
    requestSha256: REQUEST_SHA256,
    executionBindingSha256: EXECUTION_BINDING_SHA256,
    supervisorRunId: SUPERVISOR_RUN_ID,
    dockerBindingSha256,
    workerImageDigest: WORKER_IMAGE_DIGEST,
    workerPolicySha256: WORKER_POLICY_SHA256,
    acceptedCorpusSha256: ACCEPTED_CORPUS_SHA256,
    budgetUsec: "100",
    aggregateUsageUsec: "100",
    accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE",
    samplingMode: "LINUX_CGROUP_V2_EMBEDDED_ROLE_SAMPLES",
    cumulativeAccountingVerified: true,
    failStopEnforcementArmed: true,
    hardLimitEnforced: false,
    overshootBounded: false,
    containmentTriggered: false,
    controllerStopped: true,
    allRoleCgroupsReleased: true,
    roles,
  };
}

const DOCKER_BINDING_SHA256 = proof().dockerBindingSha256;
const expected = {
  requestId: REQUEST_ID,
  runNonce: RUN_NONCE,
  requestSha256: REQUEST_SHA256,
  executionBindingSha256: EXECUTION_BINDING_SHA256,
  supervisorRunId: SUPERVISOR_RUN_ID,
  dockerBindingSha256: DOCKER_BINDING_SHA256,
  workerImageDigest: WORKER_IMAGE_DIGEST,
  workerPolicySha256: WORKER_POLICY_SHA256,
  acceptedCorpusSha256: ACCEPTED_CORPUS_SHA256,
  budgetUsec: 100n,
};

test("live Linux CPU proof binds exact three-role accounting without hard-cap claims", () => {
  const parsed = parseLiveLinuxCgroupCpuProof(proof(), expected);
  assert.equal(parsed.aggregateUsageUsec, "100");
  assert.deepEqual(parsed.roles.map(({ role, deltaUsageUsec }) => ({ role, deltaUsageUsec })), [
    { role: "egress", deltaUsageUsec: "20" },
    { role: "worker", deltaUsageUsec: "40" },
    { role: "verifier", deltaUsageUsec: "40" },
  ]);
  assert.equal(parsed.cumulativeAccountingVerified, true);
  assert.equal(parsed.failStopEnforcementArmed, true);
  assert.equal(parsed.hardLimitEnforced, false);
  assert.equal(parsed.overshootBounded, false);
  assert.equal(parsed.containmentTriggered, false);
});

test("live Linux CPU proof rejects the static fake proof profile", () => {
  assert.throws(
    () =>
      parseLiveLinuxCgroupCpuProof({
        schemaVersion: "1",
        status: "STATIC_FAKE_CONTROLLER_VERIFIED",
        samplingMode: "SERIAL_SUPERVISOR_FAKE",
        cumulativeCpuTimeEnforced: false,
      }),
    /unknown or missing|not an admitted/u,
  );
});

test("live Linux CPU proof rejects non-monotonic or transcript-forged samples", () => {
  const regressed = proof();
  regressed.roles[0].samplesUsec = ["10", "30", "20"];
  regressed.roles[0].finalUsageUsec = "20";
  regressed.roles[0].deltaUsageUsec = "10";
  regressed.roles[0].sampleTranscriptSha256 = liveLinuxCgroupCpuSampleTranscriptSha256(
    regressed.roles[0].samplesUsec,
  );
  assert.throws(() => parseLiveLinuxCgroupCpuProof(regressed), /non-monotonic/u);

  const forged = proof();
  forged.roles[1].sampleTranscriptSha256 = "0".repeat(64);
  assert.throws(() => parseLiveLinuxCgroupCpuProof(forged), /inconsistent/u);
});

test("live Linux CPU proof rejects aggregate, budget, and identity forgery", () => {
  const aggregate = proof();
  aggregate.aggregateUsageUsec = "99";
  assert.throws(() => parseLiveLinuxCgroupCpuProof(aggregate), /aggregate/u);

  const over = proof();
  over.budgetUsec = "99";
  assert.throws(() => parseLiveLinuxCgroupCpuProof(over), /exceeds/u);

  const reused = proof();
  reused.roles[2].containerId = reused.roles[1].containerId;
  assert.throws(() => parseLiveLinuxCgroupCpuProof(reused), /unique/u);
});

test("live Linux CPU proof rejects request, execution, Docker, and corpus replay", () => {
  for (const [key, value] of [
    ["requestSha256", "0".repeat(64)],
    ["executionBindingSha256", "0".repeat(64)],
    ["dockerBindingSha256", "0".repeat(64)],
    ["acceptedCorpusSha256", "0".repeat(64)],
  ]) {
    const replayed = proof();
    replayed[key] = value;
    assert.throws(() => parseLiveLinuxCgroupCpuProof(replayed, expected), /binding/u);
  }
});

test("live Linux CPU proof rejects unknown fields and false cleanup or enforcement claims", () => {
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value.controllerStopped = false; },
    (value) => { value.allRoleCgroupsReleased = false; },
    (value) => { value.hardLimitEnforced = true; },
    (value) => { value.overshootBounded = true; },
    (value) => { value.containmentTriggered = true; },
    (value) => { value.roles.pop(); },
    (value) => { value.roles[0].released = false; },
    (value) => { value.roles[0].samplesUsec[0] = "18446744073709551616"; },
  ]) {
    const changed = proof();
    mutate(changed);
    assert.throws(
      () => parseLiveLinuxCgroupCpuProof(changed),
      /CPU|cgroup|proof|role|range|released|admitted/u,
    );
  }
});

test("live Linux CPU proof and JSON Schema share the exact uint64 boundary", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../schemas/live-linux-cgroup-cpu-proof.v1.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const uint64Pattern = new RegExp(schema.$defs.uint64Decimal.pattern, "u");
  assert.equal(uint64Pattern.test("18446744073709551615"), true);
  assert.equal(uint64Pattern.test("18446744073709551616"), false);
  assert.equal(uint64Pattern.test("99999999999999999999"), false);

  const maximum = proof();
  maximum.roles[0].baselineUsageUsec = "0";
  maximum.roles[0].finalUsageUsec = "18446744073709551615";
  maximum.roles[0].deltaUsageUsec = "18446744073709551615";
  maximum.roles[0].sampleCount = 2;
  maximum.roles[0].samplesUsec = ["0", "18446744073709551615"];
  maximum.roles[0].sampleTranscriptSha256 = liveLinuxCgroupCpuSampleTranscriptSha256(
    maximum.roles[0].samplesUsec,
  );
  for (const index of [1, 2]) {
    maximum.roles[index].baselineUsageUsec = "0";
    maximum.roles[index].finalUsageUsec = "0";
    maximum.roles[index].deltaUsageUsec = "0";
    maximum.roles[index].sampleCount = 2;
    maximum.roles[index].samplesUsec = ["0", "0"];
    maximum.roles[index].sampleTranscriptSha256 = liveLinuxCgroupCpuSampleTranscriptSha256(
      maximum.roles[index].samplesUsec,
    );
  }
  maximum.budgetUsec = "18446744073709551615";
  maximum.aggregateUsageUsec = "18446744073709551615";
  assert.equal(parseLiveLinuxCgroupCpuProof(maximum).aggregateUsageUsec, maximum.budgetUsec);

  const overflow = structuredClone(maximum);
  overflow.roles[1].finalUsageUsec = "1";
  overflow.roles[1].deltaUsageUsec = "1";
  overflow.roles[1].samplesUsec = ["0", "1"];
  overflow.roles[1].sampleTranscriptSha256 = liveLinuxCgroupCpuSampleTranscriptSha256(
    overflow.roles[1].samplesUsec,
  );
  assert.throws(() => parseLiveLinuxCgroupCpuProof(overflow), /aggregate/u);
});

test("live Linux CPU proof rejects independently altered sample summary fields", () => {
  for (const mutate of [
    (value) => { value.roles[0].baselineUsageUsec = "11"; },
    (value) => { value.roles[0].finalUsageUsec = "31"; },
    (value) => { value.roles[0].deltaUsageUsec = "21"; },
    (value) => { value.roles[0].sampleCount = 4; },
  ]) {
    const changed = proof();
    mutate(changed);
    assert.throws(() => parseLiveLinuxCgroupCpuProof(changed), /samples or arithmetic/u);
  }
});
