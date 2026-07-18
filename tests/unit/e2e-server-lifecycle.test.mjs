import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import {
  requestE2eShutdown,
  startE2eShutdownWatcher,
} from "../../scripts/e2e-lifecycle.mjs";

test("E2E server keeps Next standalone in the Playwright-owned process", async () => {
  const [source, config, screenshotConfig, workspaceSpec, teardown] = await Promise.all([
    readFile(resolve("scripts", "e2e-server.mjs"), "utf8"),
    readFile(resolve("playwright.config.ts"), "utf8"),
    readFile(resolve("playwright.screenshots.config.ts"), "utf8"),
    readFile(resolve("tests", "e2e", "workspace.spec.ts"), "utf8"),
    readFile(resolve("scripts", "e2e-global-teardown.mjs"), "utf8"),
  ]);

  assert.doesNotMatch(source, /node:child_process/u);
  assert.doesNotMatch(
    source,
    /runOrExit\(process\.execPath, \[resolve\(standaloneDirectory, "server\.js"\)\]\)/u,
  );
  assert.match(source, /import \{ pathToFileURL \} from "node:url"/u);
  assert.match(source, /await import\(pathToFileURL\(serverPath\)\.href\)/u);
  assert.match(source, /startE2eShutdownWatcher\(\)/u);
  assert.match(config, /globalTeardown: "\.\/scripts\/e2e-global-teardown\.mjs"/u);
  assert.match(config, /POLICYTWIN_E2E_SHUTDOWN_PATH/u);
  assert.match(
    config,
    /policyTwinScreenshotDirectory: "\.tmp\/playwright-screenshots"/u,
  );
  assert.match(
    screenshotConfig,
    /policyTwinScreenshotDirectory: "artifacts\/screenshots"/u,
  );
  assert.match(workspaceSpec, /testInfo\.config\.metadata\.policyTwinScreenshotDirectory/u);
  assert.doesNotMatch(
    workspaceSpec,
    /const screenshotDirectory = resolve\(process\.cwd\(\), "artifacts", "screenshots"\)/u,
  );
  assert.match(teardown, /requestE2eShutdown\(\)/u);
});

test("E2E teardown waits for an acknowledgement and stable health shutdown", async () => {
  const shutdownPath = resolve(".tmp", `e2e-shutdown-${randomUUID()}.signal`);
  const acknowledgementPath = `${shutdownPath}.ack`;
  let acknowledgementObservedByServer = false;
  let healthProbeCount = 0;
  const stopWatching = startE2eShutdownWatcher({
    shutdownPath,
    pollIntervalMs: 2,
    onShutdown() {
      acknowledgementObservedByServer = existsSync(acknowledgementPath);
    },
  });

  try {
    await requestE2eShutdown({
      shutdownPath,
      healthUrl: "http://127.0.0.1:3210/api/health",
      pollIntervalMs: 2,
      settleMs: 2,
      timeoutMs: 2_000,
      requiredConsecutiveFailures: 3,
      async fetchImpl() {
        healthProbeCount += 1;
        if (healthProbeCount === 2) {
          return { arrayBuffer: async () => new ArrayBuffer(0) };
        }
        throw new Error("simulated connection refusal");
      },
    });

    assert.equal(acknowledgementObservedByServer, true);
    assert.equal(healthProbeCount, 6);
    assert.equal(existsSync(shutdownPath), false);
    assert.equal(existsSync(acknowledgementPath), false);
  } finally {
    stopWatching();
    await rm(shutdownPath, { force: true });
    await rm(acknowledgementPath, { force: true });
  }
});

test("E2E teardown rejects shutdown paths outside the managed temporary root", async () => {
  await assert.rejects(
    requestE2eShutdown({
      shutdownPath: resolve("PROGRESS.md"),
      healthUrl: "http://127.0.0.1:3210/api/health",
      fetchImpl: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
    }),
    /must be a UUID-scoped signal directly under/u,
  );
});
