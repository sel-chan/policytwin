import { defineConfig } from "@playwright/test";
import verificationConfig from "./playwright.config";

export default defineConfig(verificationConfig, {
  metadata: {
    ...verificationConfig.metadata,
    policyTwinScreenshotDirectory: "artifacts/screenshots",
  },
});
