import { spawnSync } from "node:child_process";
import { lstatSync, rmSync, writeFileSync } from "node:fs";

const SAFE_ENVIRONMENT = {
  HOME: "/tmp",
  PATH: "/opt/policytwin/bin:/usr/local/bin:/usr/bin:/bin",
};
const FORBIDDEN_ENVIRONMENT = /^(?:OPENAI_|AZURE_OPENAI_|CODEX_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/iu;
const OBSERVATION_HOLD_ARGUMENT = "--observation-hold-ms=5000";

function fail(message) {
  console.error(`Verifier failed: ${message}`);
  process.exit(1);
}

const observationHoldArgument = process.argv[3];
if (
  process.argv.length > 4 ||
  (observationHoldArgument !== undefined && observationHoldArgument !== OBSERVATION_HOLD_ARGUMENT)
) {
  fail("the observation hold argument is invalid.");
}

async function holdForSupervisorObservation() {
  if (observationHoldArgument === OBSERVATION_HOLD_ARGUMENT) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

function assertReal(path, kind, maximumBytes = Number.POSITIVE_INFINITY) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail(`${kind} mount is absent.`);
  }
  if (
    stat.isSymbolicLink() ||
    (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) ||
    stat.size > maximumBytes
  ) {
    fail(`${kind} mount is invalid.`);
  }
}

function run(executable, args, timeout) {
  const result = spawnSync(executable, args, {
    cwd: "/fixture",
    env: SAFE_ENVIRONMENT,
    encoding: "utf8",
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
  });
  if (result.error !== undefined || result.status !== 0) {
    fail("a fixed verification command failed.");
  }
}

if (process.argv[2] !== "--static-preflight" && process.argv[2] !== "--verify") {
  fail("the verifier mode is invalid.");
}
if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
  fail("the verifier must run as a non-root Linux user.");
}
for (const [key, value] of Object.entries(SAFE_ENVIRONMENT)) {
  if (process.env[key] !== value) fail(`required environment ${key} is not exact.`);
}
for (const key of Object.keys(process.env)) {
  if (FORBIDDEN_ENVIRONMENT.test(key)) fail("a forbidden credential or proxy environment exists.");
}
assertReal("/fixture", "directory");
assertReal("/fixture/package.json", "file", 1024 * 1024);
assertReal("/fixture/tsconfig.json", "file", 1024 * 1024);
assertReal("/fixture/src/refund.ts", "file", 1024 * 1024);
assertReal("/fixture/tests/refund.test.mjs", "file", 1024 * 1024);
assertReal("/fixture/dist", "directory");
const rootProbe = "/opt/policytwin/.readonly-probe";
try {
  writeFileSync(rootProbe, "probe", { flag: "wx" });
  rmSync(rootProbe, { force: true });
  fail("the verifier root filesystem is writable.");
} catch (error) {
  if (error?.code !== "EROFS" && error?.code !== "EACCES" && error?.code !== "EPERM") throw error;
}
if (process.argv[2] === "--verify") {
  run(process.execPath, ["/opt/policytwin/typescript/bin/tsc", "-p", "/fixture/tsconfig.json"], 30_000);
  run(process.execPath, ["/fixture/tests/refund.test.mjs"], 30_000);
}
console.log(
  JSON.stringify({
    schemaVersion: "1",
    status: process.argv[2] === "--verify" ? "FIXTURE_COMMANDS_PASS" : "STATIC_PREFLIGHT_PASS",
    network: "UNVERIFIED_BY_PROCESS",
    credentialsPresent: false,
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
  }),
);
await holdForSupervisorObservation();
