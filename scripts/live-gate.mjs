import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateLiveGateReadiness, LIVE_DYNAMIC_GATES } from "./live-gate-contract.mjs";
import { ROOT } from "./process.mjs";

const missingHostConfiguration = ["OPENAI_API_KEY", "CODEX_MODEL"].filter(
  (name) => !process.env[name],
);

let failedDynamicGate = null;
const reports = { helper: null, worker: null, egress: null };
if (missingHostConfiguration.length === 0) {
  for (const gate of LIVE_DYNAMIC_GATES) {
    const result = spawnSync(process.execPath, [gate.script], {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 30 * 60_000,
      shell: false,
      windowsHide: true,
    });
    if (result.error !== undefined || result.status !== 0) {
      failedDynamicGate = gate.script;
      break;
    }
  }
  if (failedDynamicGate === null) {
    for (const gate of LIVE_DYNAMIC_GATES) {
      try {
        reports[gate.id] = JSON.parse(readFileSync(resolve(ROOT, gate.report), "utf8"));
      } catch {
        reports[gate.id] = null;
      }
    }
  }
}

const verdict = evaluateLiveGateReadiness({
  missingHostConfiguration,
  failedDynamicGate,
  helperReport: reports.helper,
  workerReport: reports.worker,
  egressReport: reports.egress,
});
console.error(verdict.message);

process.exit(1);
