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
  assert.equal(verdict.code, "CUMULATIVE_CPU_TIME_UNAVAILABLE");
});

test("live gate still blocks validate-only worker after all current prerequisites", () => {
  const verdict = evaluateLiveGateReadiness({
    missingHostConfiguration: [],
    workerReport: worker({ cumulativeCpuTimeEnforced: true }),
    egressReport: egress(),
  });
  assert.equal(verdict.code, "LIVE_WORKER_UNAVAILABLE");
  assert.match(verdict.message, /outbound traffic was not measured/u);
  assert.equal(verdict.ready, false);
});
