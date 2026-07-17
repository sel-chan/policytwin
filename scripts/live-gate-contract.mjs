export const LIVE_DYNAMIC_GATES = Object.freeze([
  Object.freeze({
    id: "helper",
    script: "scripts/native-helper-container-verify.mjs",
    report: "artifacts/security/native-helper-container-report.json",
    scope: "IMMUTABLE_NATIVE_HELPER_ARTIFACT_IMAGE",
  }),
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

function workerReportPasses(report) {
  return (
    dynamicReportPasses(report, LIVE_DYNAMIC_GATES[1].scope) &&
    report?.facts?.cumulativeCpuTimeEnforced === false
  );
}

function helperReportPasses(report) {
  return (
    report?.schemaVersion === "1" &&
    report?.status === "PASS" &&
    report?.scope === LIVE_DYNAMIC_GATES[0].scope &&
    report?.dockerInvoked === true &&
    /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/u.test(
      report?.builderImage ?? "",
    ) &&
    report?.builderImagePresent === true &&
    /^[0-9a-f]{64}$/u.test(report?.buildInputSha256 ?? "") &&
    /^[0-9a-f]{64}$/u.test(report?.sourceSha256 ?? "") &&
    /^sha256:[0-9a-f]{64}$/u.test(report?.helperImageId ?? "") &&
    report?.helperImageId === report?.expectedHelperImageId &&
    /^[0-9a-f]{64}$/u.test(report?.binarySha256 ?? "") &&
    report?.binarySha256 === report?.expectedBinarySha256 &&
    report?.binaryMode === "0555" &&
    report?.binaryOwner === "0:0" &&
    report?.elf?.schemaVersion === "1" &&
    report?.elf?.elfClass === "ELF64" &&
    report?.elf?.machine === "AMD64" &&
    report?.elf?.staticPie === true &&
    report?.elf?.interpreterPresent === false &&
    report?.elf?.neededLibraryCount === 0 &&
    report?.elf?.executableStack === false &&
    report?.elf?.sha256 === report?.binarySha256 &&
    Number.isSafeInteger(report?.elf?.bytes) &&
    report.elf.bytes > 0 &&
    report.elf.bytes <= 4 * 1024 * 1024 &&
    report?.imageBuildVerified === true &&
    report?.hostInstallVerified === false &&
    report?.cgroupV2RuntimeVerified === false &&
    report?.passSigningEligible === false &&
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
  if (!helperReportPasses(input?.helperReport)) {
    return result(
      "HELPER_REPORT_INVALID",
      "verify:live is fail-closed: the immutable native-helper artifact report is absent, stale, or invalid.",
    );
  }
  if (!workerReportPasses(input?.workerReport)) {
    return result(
      "WORKER_REPORT_INVALID",
      "verify:live is fail-closed: the worker/verifier dynamic report is absent, stale, or invalid.",
    );
  }
  if (!dynamicReportPasses(input?.egressReport, LIVE_DYNAMIC_GATES[2].scope)) {
    return result(
      "EGRESS_REPORT_INVALID",
      "verify:live is fail-closed: the TLS-only egress dynamic report is absent, stale, or invalid.",
    );
  }
  return result(
    "CUMULATIVE_CPU_PROOF_UNAVAILABLE",
    "verify:live is fail-closed: the non-live Docker gates passed, but no signed, request-bound three-role cumulative CPU proof contract is admitted. A report boolean or static fake-controller proof cannot advance the live gate.",
  );
}
