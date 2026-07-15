import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLiveGateReadiness,
  LIVE_DYNAMIC_GATES,
} from "../../scripts/live-gate-contract.mjs";

function passingReport(scope, facts = {}) {
  return {
    schemaVersion: "1",
    status: "PASS",
    scope,
    facts: { dynamicIsolationVerified: true, ...facts },
    releaseReady: false,
    failures: [],
  };
}

const worker = (facts) => passingReport(LIVE_DYNAMIC_GATES[0].scope, facts);
const egress = () => passingReport(LIVE_DYNAMIC_GATES[1].scope);

test("live dynamic prerequisites remain ordered worker before egress", () => {
  assert.deepEqual(
    LIVE_DYNAMIC_GATES.map(({ id, script, report }) => ({ id, script, report })),
    [
      {
        id: "worker",
        script: "scripts/worker-container-verify.mjs",
        report: "artifacts/security/worker-container-report.json",
      },
      {
        id: "egress",
        script: "scripts/egress-container-verify.mjs",
        report: "artifacts/security/egress-container-report.json",
      },
    ],
  );
});

test("live gate checks host configuration before launching dynamic prerequisites", () => {
  const verdict = evaluateLiveGateReadiness({
    missingHostConfiguration: ["OPENAI_API_KEY", "CODEX_MODEL"],
    failedDynamicGate: "scripts/worker-container-verify.mjs",
  });
  assert.equal(verdict.code, "MISSING_HOST_CONFIGURATION");
  assert.match(verdict.message, /OPENAI_API_KEY, CODEX_MODEL/u);
});

test("live gate propagates the first failed dynamic prerequisite", () => {
  const verdict = evaluateLiveGateReadiness({
    missingHostConfiguration: [],
    failedDynamicGate: "scripts/egress-container-verify.mjs",
  });
  assert.equal(verdict.code, "DYNAMIC_GATE_FAILED");
  assert.match(verdict.message, /egress-container-verify/u);
});

test("live gate rejects stale or semantically invalid reports", () => {
  assert.equal(
    evaluateLiveGateReadiness({
      missingHostConfiguration: [],
      workerReport: worker({ cumulativeCpuTimeEnforced: false }),
      egressReport: { ...egress(), scope: "STALE" },
    }).code,
    "EGRESS_REPORT_INVALID",
  );
  assert.equal(
    evaluateLiveGateReadiness({
      missingHostConfiguration: [],
      workerReport: null,
      egressReport: egress(),
    }).code,
    "WORKER_REPORT_INVALID",
  );
});

test("live gate blocks a passing non-live isolation report without cumulative CPU enforcement", () => {
  const verdict = evaluateLiveGateReadiness({
    missingHostConfiguration: [],
    workerReport: worker({ cumulativeCpuTimeEnforced: false }),
    egressReport: egress(),
  });
  assert.equal(verdict.code, "CUMULATIVE_CPU_PROOF_UNAVAILABLE");
  assert.match(verdict.message, /report boolean|static fake-controller/u);
});

test("live gate rejects a forged cumulative CPU boolean instead of advancing", () => {
  const verdict = evaluateLiveGateReadiness({
    missingHostConfiguration: [],
    workerReport: worker({ cumulativeCpuTimeEnforced: true }),
    egressReport: egress(),
  });
  assert.equal(verdict.code, "WORKER_REPORT_INVALID");
  assert.equal(verdict.ready, false);
});

test("live gate does not admit an unverified structured CPU object", () => {
  const verdict = evaluateLiveGateReadiness({
    missingHostConfiguration: [],
    workerReport: worker({
      cumulativeCpuTimeEnforced: false,
      cpuBudgetProof: {
        schemaVersion: "1",
        status: "STATIC_FAKE_CONTROLLER_VERIFIED",
      },
    }),
    egressReport: egress(),
  });
  assert.equal(verdict.code, "CUMULATIVE_CPU_PROOF_UNAVAILABLE");
  assert.equal(verdict.ready, false);
});

test("live gate does not admit an unsigned Worker RPC v2-shaped CPU proof", () => {
  const verdict = evaluateLiveGateReadiness({
    missingHostConfiguration: [],
    workerReport: worker({
      cumulativeCpuTimeEnforced: false,
      signedWorkerRpcV2: {
        protocol: "policytwin.codex.repair.v2",
        proofType: "LIVE_LINUX_CGROUP_V2_THREE_ROLE",
        status: "OBSERVED_WITHIN_BUDGET",
      },
    }),
    egressReport: egress(),
  });
  assert.equal(verdict.code, "CUMULATIVE_CPU_PROOF_UNAVAILABLE");
  assert.equal(verdict.ready, false);
});
