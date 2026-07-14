import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const screenshotDirectory = resolve(process.cwd(), "artifacts", "screenshots");

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
});

test("five evidence-backed views are navigable and truthful", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Policy Studio" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Policy Studio/u })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Recorded baseline", { exact: true })).toBeVisible();
  await expect(page.getByText("v4", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Interpret with GPT-5.6" })).toBeDisabled();
  await page.screenshot({ path: resolve(screenshotDirectory, "01-policy-studio.png"), fullPage: true });

  await page.getByRole("link", { name: /Decision Queue/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Decision Queue" })).toBeVisible();
  await expect(page.getByText("3 / 3 resolved", { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDirectory, "02-decision-queue.png"), fullPage: true });

  await page.getByRole("link", { name: /Case Lab/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Case Lab" })).toBeVisible();
  await expect(page.getByText("OPA 41 / 41", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "D01", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDirectory, "03-case-lab-drift.png"), fullPage: true });

  await page.getByRole("link", { name: /Integration \/ Drift/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Integration / Drift" })).toBeVisible();
  for (const caseId of ["D01", "D02", "D03"]) {
    await expect(page.getByText(caseId, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: resolve(screenshotDirectory, "04-integration-drift.png"), fullPage: true });

  await page.getByRole("link", { name: /Proof/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Proof" })).toBeVisible();
  await expect(page.getByText("OPA proven. Live repair still pending.", { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDirectory, "05-proof.png"), fullPage: true });

  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: "ok", service: "policytwin", schemaVersion: "1" });

  const invalidInterpretation = await request.post("/api/interpret", { data: {} });
  expect(invalidInterpretation.status()).toBe(503);
  expect((await invalidInterpretation.json()).error).toBe("LIVE_RUN_DISABLED");

  const evidence = await request.get("/api/evidence/verification-summary.json");
  expect(evidence.ok()).toBe(true);
  expect(evidence.headers()["content-disposition"]).toContain("verification-summary.json");
  expect(evidence.headers()["cache-control"]).toBe("no-store");
  expect((await evidence.json()).externalGates.opa).toBe("PASS");
});

test("keyboard focus and mobile layout remain usable", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "PolicyTwin home" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /Policy Studio/u })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Policy Studio" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/proof");
  await expect(page.getByRole("navigation", { name: "Workspace views" })).toBeVisible();
  for (const label of ["Policy Studio", "Decision Queue", "Case Lab", "Integration / Drift", "Proof"]) {
    await expect(page.getByRole("link", { name: new RegExp(label, "u") })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Proof" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(screenshotDirectory, "07-mobile-or-responsive.png"), fullPage: true });
});
