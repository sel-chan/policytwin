import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const e2eDatabasePath =
  process.env.POLICYTWIN_E2E_DATABASE_PATH ??
  resolve(process.cwd(), ".tmp", `e2e-policytwin-${randomUUID()}.sqlite`);
const e2eShutdownPath = resolve(process.cwd(), ".tmp", `e2e-shutdown-${randomUUID()}.signal`);
const e2eHealthUrl = "http://127.0.0.1:3210/api/health";
process.env.POLICYTWIN_E2E_DATABASE_PATH = e2eDatabasePath;
process.env.POLICYTWIN_E2E_SHUTDOWN_PATH = e2eShutdownPath;
process.env.POLICYTWIN_E2E_HEALTH_URL = e2eHealthUrl;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: ".tmp/playwright-results",
  metadata: {
    policyTwinScreenshotDirectory: ".tmp/playwright-screenshots",
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  globalTeardown: "./scripts/e2e-global-teardown.mjs",
  use: {
    baseURL: "http://127.0.0.1:3210",
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: "3210",
      POLICYTWIN_DATABASE_PATH: e2eDatabasePath,
      POLICYTWIN_E2E_SHUTDOWN_PATH: e2eShutdownPath,
      POLICYTWIN_E2E_HEALTH_URL: e2eHealthUrl,
      POLICYTWIN_PUBLIC_ORIGIN: "http://127.0.0.1:3210",
      POLICYTWIN_ALLOW_INSECURE_LOCALHOST: "1",
      POLICYTWIN_MAX_ANONYMOUS_WORKSPACES: "3",
    },
    url: e2eHealthUrl,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
