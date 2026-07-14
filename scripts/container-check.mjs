import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./process.mjs";

const contract = JSON.parse(readFileSync(resolve(ROOT, "container-contract.json"), "utf8"));
const failures = [];
if (contract.schemaVersion !== "1" || contract.status !== "READY") {
  failures.push("Container contract is not ready.");
}
if (contract.opaVersion === "UNVERIFIED") {
  failures.push("Container OPA version is unverified.");
}
if (!existsSync(resolve(ROOT, "Dockerfile"))) {
  failures.push("Dockerfile is absent.");
}
if (!existsSync(resolve(ROOT, "app", "api", "health", "route.ts"))) {
  failures.push("Production health endpoint is absent.");
}
const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
});
const daemonAvailable = docker.status === 0 && docker.stdout.trim().length > 0;
if (!daemonAvailable) {
  failures.push("Docker daemon is unavailable.");
}
const report = {
  schemaVersion: "1",
  status: failures.length === 0 ? "READY_FOR_BUILD" : "FAIL",
  daemonAvailable,
  dockerServerVersion: daemonAvailable ? docker.stdout.trim() : null,
  contractStatus: contract.status,
  opaVersion: contract.opaVersion,
  failures,
};
const directory = resolve(ROOT, "artifacts", "security");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "container-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (failures.length > 0) {
  console.error(`Container check is fail-closed: ${failures.join(" ")}`);
  process.exit(1);
}
console.log("Container prerequisites are ready for a real build and health check.");
