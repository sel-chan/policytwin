export const LIVE_DYNAMIC_GATES = Object.freeze([
  Object.freeze({
    id: "worker",
    script: "scripts/worker-container-verify.mjs",
    report: "artifacts/security/worker-container-report.json",
    scope: "DYNAMIC_WORKER_VERIFIER_ISOLATION_SMOKE_CPU_TIME_UNAVAILABLE_NOT_LIVE_CODEX",
  }),
  Object.freeze({
    id: "egress",
    script: "scripts/egress-container-verify.mjs",
    report: "artifacts/security/egress-container-report.json",
    scope: "DYNAMIC_EGRESS_PROXY_TLS_HANDSHAKE_ONLY_OUTBOUND_NOT_MEASURED",
  }),
]);

function result(code, message) {
  return Object.freeze({ ready: false, code, message });
}

function dynamicReportPasses(report, scope) {
  return (
    report?.schemaVersion === "1" &&
    report?.status === "PASS" &&
    report?.scope === scope &&
    report?.facts?.dynamicIsolationVerified === true &&
    report?.releaseReady === false &&
    Array.isArray(report?.failures) &&
    report.failures.length === 0
  );
}

export function evaluateLiveGateReadiness(input) {
  const missing = Array.isArray(input?.missingHostConfiguration)
    ? input.missingHostConfiguration.filter((name) => typeof name === "string" && name.length > 0)
    : [];
  if (missing.length > 0) {
    return result(
      "MISSING_HOST_CONFIGURATION",
      `verify:live is fail-closed: missing host configuration ${missing.join(", ")}.`,
    );
  }
  if (typeof input?.failedDynamicGate === "string" && input.failedDynamicGate.length > 0) {
    return result(
      "DYNAMIC_GATE_FAILED",
      `verify:live is fail-closed: prerequisite dynamic gate ${input.failedDynamicGate} did not pass.`,
    );
  }
  if (!dynamicReportPasses(input?.workerReport, LIVE_DYNAMIC_GATES[0].scope)) {
    return result(
      "WORKER_REPORT_INVALID",
      "verify:live is fail-closed: the worker/verifier dynamic report is absent, stale, or invalid.",
    );
  }
  if (!dynamicReportPasses(input?.egressReport, LIVE_DYNAMIC_GATES[1].scope)) {
    return result(
      "EGRESS_REPORT_INVALID",
      "verify:live is fail-closed: the TLS-only egress dynamic report is absent, stale, or invalid.",
    );
  }
  if (input.workerReport.facts.cumulativeCpuTimeEnforced !== true) {
    return result(
      "CUMULATIVE_CPU_TIME_UNAVAILABLE",
      "verify:live is fail-closed: the non-live Docker isolation gates passed, but cumulative worker CPU-time enforcement is unavailable.",
    );
  }
  return result(
    "LIVE_WORKER_UNAVAILABLE",
    "verify:live is fail-closed: worker/verifier isolation and the TLS-only egress gate passed, but the prepared worker remains validate-only; proxy outbound traffic was not measured and no fresh Codex SDK repair, upstream Responses evidence, signed live result, or evidence promotion exists.",
  );
}
