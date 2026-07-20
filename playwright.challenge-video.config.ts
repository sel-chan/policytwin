import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const databasePath = resolve(process.cwd(), ".tmp", `challenge-video-${randomUUID()}.sqlite`);
const shutdownPath = resolve(process.cwd(), ".tmp", `e2e-shutdown-${randomUUID()}.signal`);
const healthUrl = "http://127.0.0.1:3210/api/health";
process.env.POLICYTWIN_E2E_SHUTDOWN_PATH = shutdownPath;
process.env.POLICYTWIN_E2E_HEALTH_URL = healthUrl;

export default defineConfig({
  testDir: "./tests/demo",
  testMatch: "challenge-video.spec.ts",
  outputDir: ".tmp/challenge-video/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [["list"]],
  globalTeardown: "./scripts/e2e-global-teardown.mjs",
  use: {
    baseURL: "http://127.0.0.1:3210",
    channel: "chrome",
    viewport: { width: 1600, height: 900 },
    screenshot: "off",
    trace: "off",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: "3210",
      POLICYTWIN_DATABASE_PATH: databasePath,
      POLICYTWIN_E2E_SHUTDOWN_PATH: shutdownPath,
      POLICYTWIN_E2E_HEALTH_URL: healthUrl,
      POLICYTWIN_PUBLIC_ORIGIN: "http://127.0.0.1:3210",
      POLICYTWIN_ALLOW_INSECURE_LOCALHOST: "1",
      POLICYTWIN_MAX_ANONYMOUS_WORKSPACES: "3",
    },
    url: healthUrl,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
