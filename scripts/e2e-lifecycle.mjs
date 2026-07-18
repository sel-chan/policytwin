import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const shutdownSignalPattern = /^e2e-shutdown-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.signal$/u;

function requiredEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set for the Playwright E2E lifecycle.`);
  }
  return value;
}

function comparablePath(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function assertRegularFileIfPresent(path, label) {
  if (!existsSync(path)) {
    return;
  }
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
}

function managedShutdownFiles(shutdownPath) {
  const temporaryRoot = resolve(process.cwd(), ".tmp");
  const signalPath = resolve(shutdownPath);
  if (
    comparablePath(dirname(signalPath)) !== comparablePath(temporaryRoot) ||
    !shutdownSignalPattern.test(basename(signalPath))
  ) {
    throw new Error(
      `POLICYTWIN_E2E_SHUTDOWN_PATH must be a UUID-scoped signal directly under ${temporaryRoot}.`,
    );
  }

  mkdirSync(temporaryRoot, { recursive: true });
  const rootStats = lstatSync(temporaryRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`E2E temporary root must be a real directory: ${temporaryRoot}`);
  }

  const acknowledgementPath = `${signalPath}.ack`;
  assertRegularFileIfPresent(signalPath, "E2E shutdown signal");
  assertRegularFileIfPresent(acknowledgementPath, "E2E shutdown acknowledgement");
  return { acknowledgementPath, signalPath };
}

async function healthIsReachable(fetchImpl, healthUrl, deadline) {
  try {
    const response = await fetchImpl(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now()))),
    });
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

export function startE2eShutdownWatcher({
  shutdownPath = requiredEnvironmentValue("POLICYTWIN_E2E_SHUTDOWN_PATH"),
  pollIntervalMs = 100,
  onShutdown = () => process.exit(0),
} = {}) {
  const { acknowledgementPath, signalPath } = managedShutdownFiles(shutdownPath);
  let shutdownStarted = false;
  const timer = setInterval(() => {
    if (shutdownStarted || !existsSync(signalPath)) {
      return;
    }
    assertRegularFileIfPresent(signalPath, "E2E shutdown signal");
    shutdownStarted = true;
    clearInterval(timer);
    writeFileSync(acknowledgementPath, `${new Date().toISOString()}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    onShutdown();
  }, pollIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export async function requestE2eShutdown({
  shutdownPath = requiredEnvironmentValue("POLICYTWIN_E2E_SHUTDOWN_PATH"),
  healthUrl = requiredEnvironmentValue("POLICYTWIN_E2E_HEALTH_URL"),
  fetchImpl = fetch,
  pollIntervalMs = 100,
  timeoutMs = 10_000,
  settleMs = 250,
  requiredConsecutiveFailures = 3,
} = {}) {
  const { acknowledgementPath, signalPath } = managedShutdownFiles(shutdownPath);
  await writeFile(signalPath, `${new Date().toISOString()}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  const deadline = Date.now() + timeoutMs;
  let acknowledged = false;
  let consecutiveFailures = 0;
  try {
    while (Date.now() < deadline) {
      if (!acknowledged && existsSync(acknowledgementPath)) {
        assertRegularFileIfPresent(acknowledgementPath, "E2E shutdown acknowledgement");
        acknowledged = true;
      }

      if (acknowledged) {
        const reachable = await healthIsReachable(fetchImpl, healthUrl, deadline);
        consecutiveFailures = reachable ? 0 : consecutiveFailures + 1;
        if (consecutiveFailures >= requiredConsecutiveFailures) {
          await delay(settleMs);
          if (!(await healthIsReachable(fetchImpl, healthUrl, deadline))) {
            return;
          }
          consecutiveFailures = 0;
        }
      }
      await delay(pollIntervalMs);
    }
    const stage = acknowledged ? "stop after acknowledging shutdown" : "acknowledge shutdown";
    throw new Error(`E2E server did not ${stage} within ${timeoutMs}ms.`);
  } finally {
    await rm(signalPath, { force: true });
    await rm(acknowledgementPath, { force: true });
  }
}
