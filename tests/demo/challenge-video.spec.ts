import { expect, test, type Page } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), ".tmp", "challenge-video");
const sourceVideo = resolve(outputDirectory, "source.webm");

async function showCallout(
  page: Page,
  input: { title: string; lines: string[]; fullScreen?: boolean },
) {
  await page.evaluate(({ title, lines, fullScreen }) => {
    document.querySelector("[data-challenge-callout]")?.remove();
    const callout = document.createElement("section");
    callout.setAttribute("data-challenge-callout", "true");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const list = document.createElement("div");
    for (const line of lines) {
      const item = document.createElement("p");
      item.textContent = line;
      list.append(item);
    }
    callout.append(heading, list);
    Object.assign(callout.style, {
      position: "fixed",
      zIndex: "2147483647",
      color: "#f7f5ed",
      background: fullScreen ? "rgba(10, 35, 26, 0.98)" : "rgba(16, 48, 37, 0.96)",
      border: fullScreen ? "0" : "1px solid rgba(247, 245, 237, 0.3)",
      borderRadius: fullScreen ? "0" : "22px",
      boxShadow: "0 24px 70px rgba(0, 0, 0, 0.28)",
      padding: fullScreen ? "110px" : "30px 36px",
      inset: fullScreen ? "0" : "32px 32px auto auto",
      width: fullScreen ? "auto" : "540px",
      display: fullScreen ? "grid" : "block",
      placeContent: fullScreen ? "center" : "initial",
      textAlign: fullScreen ? "center" : "left",
      fontFamily: "Arial, sans-serif",
    });
    Object.assign(heading.style, {
      margin: "0 0 18px",
      fontSize: fullScreen ? "68px" : "36px",
      lineHeight: "1.05",
    });
    Object.assign(list.style, {
      display: "grid",
      gap: "10px",
      fontSize: fullScreen ? "27px" : "21px",
      lineHeight: "1.35",
    });
    for (const item of list.children) {
      (item as HTMLElement).style.margin = "0";
    }
    document.body.append(callout);
  }, input);
}

test("record the evidence-bound local challenge walkthrough", async ({ browser }) => {
  await mkdir(resolve(outputDirectory, "raw"), { recursive: true });
  await rm(sourceVideo, { force: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: {
      dir: resolve(outputDirectory, "raw"),
      size: { width: 1600, height: 900 },
    },
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await page.goto("/integration");
    await expect(page.getByRole("heading", { level: 1, name: "Integration / Drift" })).toBeVisible();
    const startedAt = Date.now();
    const holdUntil = async (milliseconds: number) => {
      await page.waitForTimeout(Math.max(0, startedAt + milliseconds - Date.now()));
    };

    await holdUntil(16_000);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Policy Studio" })).toBeVisible();
    await showCallout(page, {
      title: "Built with Codex + GPT-5.6",
      lines: [
        "Strict PolicyIR and deterministic Rego",
        "Adversarial cases and independent reviews",
        "Bounded repair on a disposable seeded fixture",
        "/feedback: 019f5dcf-0233-7a80-9147-af10c7bbfb28",
      ],
    });
    await holdUntil(34_000);

    await page.goto("/decisions");
    await expect(page.getByText("0 / 3 resolved", { exact: true })).toBeVisible();
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: /Purchase day is day 0/u }).click();
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: /Measure at request time/u }).click();
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: /Deny by default/u }).click();
    await expect(page.getByText("3 / 3 resolved", { exact: true })).toBeVisible();
    await holdUntil(56_000);

    await page.goto("/cases");
    await expect(page.getByText("OPA 41 / 41", { exact: true })).toBeVisible();
    await holdUntil(78_000);

    await page.goto("/integration");
    const challengeReceipt = page.locator(".challenge-receipt");
    await expect(challengeReceipt.getByText("LOCAL_CHALLENGE_PASS", { exact: true })).toBeVisible();
    await challengeReceipt.scrollIntoViewIfNeeded();
    await holdUntil(97_000);
    const repairButton = page.getByRole("button", { name: "Start guarded Codex repair" });
    await repairButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_000);
    await repairButton.click();
    await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
    await holdUntil(110_000);

    await page.goto("/proof");
    await expect(page.getByRole("heading", { level: 1, name: "Proof" })).toBeVisible();
    await holdUntil(120_000);
    await page.mouse.wheel(0, 650);
    await holdUntil(132_000);

    await page.goto("/impact");
    await expect(page.getByText("G02 blocks verification", { exact: true })).toBeVisible();
    await holdUntil(141_000);
    await page.getByRole("button", { name: "Create draft v5" }).click();
    await expect(page.getByRole("button", { name: "Draft v5 persisted" })).toBeDisabled();
    await holdUntil(151_000);

    await page.goto("/integration");
    await expect(page.getByRole("heading", { level: 1, name: "Integration / Drift" })).toBeVisible();
    await showCallout(page, {
      title: "PolicyTwin · repair proven",
      lines: [
        "2 files changed · 7 / 7 regressions",
        "41 / 41 accepted cases · zero drift",
        "Independent review: APPROVE",
        "github.com/sel-chan/policytwin",
      ],
      fullScreen: true,
    });
    await holdUntil(168_000);
  } finally {
    await context.close();
  }
  if (video === null) throw new Error("Playwright did not create the challenge video stream.");
  await video.saveAs(sourceVideo);
});
