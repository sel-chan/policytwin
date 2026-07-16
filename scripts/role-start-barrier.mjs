import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const ROLES = new Set(["egress", "worker", "verifier"]);
const MAX_PROTOCOL_BYTES = 4_096;
const HOST_OWNED_RECEIPT_SLOT_MODE = 0o622;
const BARRIER_ENVIRONMENT_KEYS = [
  "POLICYTWIN_START_BARRIER_MODE",
  "POLICYTWIN_START_BARRIER_ROLE",
  "POLICYTWIN_START_BARRIER_ID",
  "POLICYTWIN_START_BARRIER_RUN_BINDING_SHA256",
  "POLICYTWIN_START_BARRIER_RECEIPT_DIRECTORY",
  "POLICYTWIN_START_BARRIER_CONTROL_DIRECTORY",
  "POLICYTWIN_START_BARRIER_HOLD_TIMEOUT_MS",
  "POLICYTWIN_START_BARRIER_POLL_INTERVAL_MS",
];

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

async function assertDirectory(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    throw new Error(`${label} is invalid.`);
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(path)) !== path) {
    throw new Error(`${label} is unsafe.`);
  }
  return stat;
}

async function writeExistingHostOwnedSlot(path, bytes, label) {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size !== 0n ||
    (process.platform === "linux" &&
      (Number(before.mode) & 0o777) !== HOST_OWNED_RECEIPT_SLOT_MODE)
  ) {
    throw new Error(`${label} is unsafe.`);
  }
  const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_WRONLY | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.uid !== before.uid ||
      opened.size !== 0n
    ) {
      throw new Error(`${label} changed identity.`);
    }
    const written = await handle.write(bytes, 0, bytes.byteLength, 0);
    if (written.bytesWritten !== bytes.byteLength) {
      throw new Error(`${label} was not written atomically.`);
    }
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.uid !== before.uid ||
      after.size !== BigInt(bytes.byteLength)
    ) {
      throw new Error(`${label} changed identity after write.`);
    }
  } finally {
    await handle.close();
  }
}

async function writeHeldReceipt(receiptPath, commitPath, receipt) {
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
  if (receiptBytes.byteLength > MAX_PROTOCOL_BYTES) {
    throw new Error("The barrier receipt is too large.");
  }
  const receiptSha256 = createHash("sha256").update(receiptBytes).digest("hex");
  const commitBytes = Buffer.from(
    `${JSON.stringify({
      schemaVersion: "1",
      status: "HELD_RECEIPT_COMMITTED",
      receiptSha256,
    })}\n`,
    "utf8",
  );
  try {
    await writeExistingHostOwnedSlot(
      receiptPath,
      receiptBytes,
      "The host-owned barrier receipt slot",
    );
    await writeExistingHostOwnedSlot(
      commitPath,
      commitBytes,
      "The host-owned barrier commit slot",
    );
  } finally {
    receiptBytes.fill(0);
    commitBytes.fill(0);
  }
}

async function readRelease(path) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || before.size > 4_096n) {
    throw new Error("The host release frame is unsafe.");
  }
  const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.size > BigInt(MAX_PROTOCOL_BYTES)
    ) {
      throw new Error("The host release frame changed identity.");
    }
    const bytes = await handle.readFile();
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
    }
  } finally {
    await handle.close();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function awaitPolicyTwinRoleStartBarrier(options) {
  const role = options.role;
  const barrierId = options.barrierId;
  const runBindingSha256 = options.runBindingSha256;
  const receiptDirectory = options.receiptDirectory;
  const controlDirectory = options.controlDirectory;
  const holdTimeoutMs = integerInRange(
    options.holdTimeoutMs,
    100,
    60_000,
    "The role start-barrier hold timeout",
  );
  const pollIntervalMs = integerInRange(
    options.pollIntervalMs,
    1,
    1_000,
    "The role start-barrier poll interval",
  );
  if (
    !ROLES.has(role) ||
    !TOKEN.test(barrierId) ||
    !SHA256.test(runBindingSha256) ||
    pollIntervalMs >= holdTimeoutMs
  ) {
    throw new Error("The role start-barrier protocol is invalid.");
  }
  const receiptDirectoryStat = await assertDirectory(
    receiptDirectory,
    "The role receipt directory",
  );
  if (process.platform === "linux" && (receiptDirectoryStat.mode & 0o222) !== 0) {
    throw new Error("The role receipt directory permits path replacement.");
  }
  await assertDirectory(controlDirectory, "The host control directory");
  const heldPath = join(receiptDirectory, "held.json");
  const heldCommitPath = join(receiptDirectory, "held.commit.json");
  const releasePath = join(controlDirectory, "release.json");
  await writeHeldReceipt(
    heldPath,
    heldCommitPath,
    {
      schemaVersion: "1",
      status: "HELD_BEFORE_ROLE_EXECUTION",
      role,
      barrierId,
      runBindingSha256,
      namespacePid: process.pid,
    },
  );

  const deadline = process.hrtime.bigint() + BigInt(holdTimeoutMs) * 1_000_000n;
  let release;
  for (;;) {
    try {
      release = await readRelease(releasePath);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (process.hrtime.bigint() >= deadline) {
      throw new Error("The role start barrier timed out waiting for host release.");
    }
    await delay(pollIntervalMs);
  }
  if (
    typeof release !== "object" ||
    release === null ||
    !exactKeys(release, [
      "barrierId",
      "releaseNonce",
      "role",
      "runBindingSha256",
      "schemaVersion",
      "status",
    ]) ||
    release.schemaVersion !== "1" ||
    release.status !== "RELEASED_BY_HOST_SUPERVISOR" ||
    release.role !== role ||
    release.barrierId !== barrierId ||
    release.runBindingSha256 !== runBindingSha256 ||
    !TOKEN.test(release.releaseNonce)
  ) {
    throw new Error("The host release frame is invalid.");
  }
  return Object.freeze({
    schemaVersion: "1",
    status: "ROLE_START_BARRIER_RELEASED",
    role,
    barrierId,
    runBindingSha256,
    releaseNonce: release.releaseNonce,
    evidenceClockClaim: false,
    dynamicRuntimeVerified: false,
  });
}

function requiredEnvironment() {
  const role = process.env.POLICYTWIN_START_BARRIER_ROLE;
  if (
    !ROLES.has(role) ||
    process.env.POLICYTWIN_START_BARRIER_MODE !== "REQUIRED_V1" ||
    process.env.NODE_OPTIONS !== ""
  ) {
    throw new Error("The role start barrier is not enabled with an exact mode and role.");
  }
  const expectedRoot = `/run/policytwin-start-barrier/${role}`;
  if (
    process.env.POLICYTWIN_START_BARRIER_RECEIPT_DIRECTORY !== `${expectedRoot}/receipt` ||
    process.env.POLICYTWIN_START_BARRIER_CONTROL_DIRECTORY !== `${expectedRoot}/control`
  ) {
    throw new Error("The role start-barrier mount paths are not exact.");
  }
  return {
    role,
    barrierId: process.env.POLICYTWIN_START_BARRIER_ID,
    runBindingSha256: process.env.POLICYTWIN_START_BARRIER_RUN_BINDING_SHA256,
    receiptDirectory: process.env.POLICYTWIN_START_BARRIER_RECEIPT_DIRECTORY,
    controlDirectory: process.env.POLICYTWIN_START_BARRIER_CONTROL_DIRECTORY,
    holdTimeoutMs: Number(process.env.POLICYTWIN_START_BARRIER_HOLD_TIMEOUT_MS),
    pollIntervalMs: Number(process.env.POLICYTWIN_START_BARRIER_POLL_INTERVAL_MS),
  };
}

function exactTarget(role, target) {
  const hold = "--observation-hold-ms=5000";
  const allowlist = {
    egress: [["node", "scripts/openai-egress-proxy.mjs"]],
    worker: [
      ["node", "scripts/worker-preflight.mjs", "--static-preflight"],
      ["node", "scripts/worker-preflight.mjs", "--static-preflight", hold],
      ["node", "scripts/worker-preflight.mjs", "--egress-tls-probe"],
      ["node", "scripts/worker-preflight.mjs", "--egress-tls-probe", hold],
      ["node", "scripts/worker-entrypoint.mjs", "--validate-only"],
    ],
    verifier: [
      ["node", "scripts/verifier-preflight.mjs", "--static-preflight"],
      ["node", "scripts/verifier-preflight.mjs", "--static-preflight", hold],
      ["node", "scripts/verifier-preflight.mjs", "--verify"],
      ["node", "scripts/verifier-preflight.mjs", "--verify", hold],
    ],
  }[role];
  return allowlist.some(
    (allowed) =>
      allowed.length === target.length && allowed.every((value, index) => value === target[index]),
  );
}

async function main() {
  if (
    process.platform !== "linux" ||
    typeof process.getuid !== "function" ||
    process.getuid() === 0
  ) {
    throw new Error("The role start barrier requires a non-root Linux container process.");
  }
  const separator = process.argv.indexOf("--", 2);
  const target = separator === -1 ? [] : process.argv.slice(separator + 1);
  const options = requiredEnvironment();
  if (separator !== 2 || !exactTarget(options.role, target)) {
    throw new Error("The role start-barrier target is not allowlisted.");
  }
  await awaitPolicyTwinRoleStartBarrier(options);
  const childEnvironment = { ...process.env };
  for (const key of BARRIER_ENVIRONMENT_KEYS) delete childEnvironment[key];
  for (const key of Object.keys(childEnvironment)) {
    if (key.startsWith("NODE_") && key !== "NODE_ENV") delete childEnvironment[key];
  }
  childEnvironment.NODE_OPTIONS = "";
  const child = spawn(process.execPath, target.slice(1), {
    env: childEnvironment,
    stdio: "inherit",
    shell: false,
  });
  const forwardInterrupt = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
  };
  const forwardTerminate = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  process.once("SIGINT", forwardInterrupt);
  process.once("SIGTERM", forwardTerminate);
  const outcome = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  process.removeListener("SIGINT", forwardInterrupt);
  process.removeListener("SIGTERM", forwardTerminate);
  if (outcome.signal !== null) process.exitCode = 1;
  else process.exitCode = outcome.code ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("PolicyTwin role start barrier failed closed.");
    process.exitCode = 1;
  });
}
