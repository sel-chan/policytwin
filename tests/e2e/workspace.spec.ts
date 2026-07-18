import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const screenshotDirectory = resolve(process.cwd(), "artifacts", "screenshots");

function tarEntryNames(bytes: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 1024 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      return names;
    }
    const nameEnd = header.indexOf(0);
    const name = header.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString("ascii");
    const sizeText = header.subarray(124, 136).toString("ascii").replaceAll("\0", "").trim();
    const size = Number.parseInt(sizeText, 8);
    expect(Number.isSafeInteger(size)).toBe(true);
    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Downloaded USTAR archive has no termination blocks.");
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
});

test("persisted decisions, evidence views, and blocked change impact remain truthful", async ({
  browser,
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Policy Studio" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Policy Studio/u })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("SQLite v1", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs decision", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Interpret with GPT-5.6" })).toBeDisabled();
  await page.screenshot({ path: resolve(screenshotDirectory, "01-policy-studio.png"), fullPage: true });

  const directWorkspaceCreation = await request.get(
    "/api/policies/policy-seeded-refund/workspace",
  );
  expect(directWorkspaceCreation.status()).toBe(403);

  const untrustedMutation = await request.post(
    "/api/policies/policy-seeded-refund/versions/1/ambiguities/ambiguity-purchase-day-index/resolve",
    { data: { selectedOptionId: "purchase-day-zero" } },
  );
  expect(untrustedMutation.status()).toBe(403);

  await page.getByRole("link", { name: /Decision Queue/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Decision Queue" })).toBeVisible();
  await expect(page.getByText("0 / 3 resolved", { exact: true })).toBeVisible();
  await expect(page.locator(".decision-card")).toHaveCount(1);

  const firstChoice = page.getByRole("button", { name: /Purchase day is day 0/u });
  await firstChoice.focus();
  await expect(firstChoice).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("1 / 3 resolved", { exact: true })).toBeVisible();
  await expect(page.getByText("SQLite current version:")).toContainText("v2");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Is usage measured at request time or decision time?",
    }),
  ).toBeFocused();
  const replayedDecision = await page.evaluate(async () => {
    const workspaceResponse = await fetch(
      "/api/policies/policy-seeded-refund/workspace",
      { cache: "no-store" },
    );
    const workspace = (await workspaceResponse.json()) as { csrfToken: string };
    const response = await fetch(
      "/api/policies/policy-seeded-refund/versions/1/ambiguities/ambiguity-purchase-day-index/resolve",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PolicyTwin-CSRF": workspace.csrfToken,
        },
        body: JSON.stringify({ selectedOptionId: "purchase-day-zero" }),
      },
    );
    return { status: response.status, body: await response.json() };
  });
  expect(replayedDecision.status).toBe(200);
  expect(replayedDecision.body.idempotent).toBe(true);
  expect(replayedDecision.body.workspace.project.currentVersion).toBe(2);

  await page.getByRole("button", { name: /Measure at request time/u }).click();
  await expect(page.getByText("2 / 3 resolved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "What is the result when no eligibility rule matches?",
    }),
  ).toBeFocused();

  await page.getByRole("button", { name: /Review by default/u }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Decision not stored." }),
  ).toContainText("authoritative golden case");
  await expect(page.getByText("2 / 3 resolved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Deny by default/u }).click();
  await expect(page.getByText("3 / 3 resolved", { exact: true })).toBeVisible();
  await expect(page.getByText("SQLite current version:")).toContainText("v4");
  await expect(
    page.getByRole("heading", { level: 2, name: "All required ambiguity decisions are explicit" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("3 / 3 resolved", { exact: true })).toBeVisible();
  await expect(page.getByText("SQLite current version:")).toContainText("v4");
  await page.screenshot({ path: resolve(screenshotDirectory, "02-decision-queue.png"), fullPage: true });
  await page.getByRole("button", { name: "Revisit" }).first().click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Is the purchase day counted as day 0 or day 1?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Purchase day is day 0/u })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Purchase day is day 0/u })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();

  await page.getByRole("link", { name: /Case Lab/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Case Lab" })).toBeVisible();
  await expect(page.getByText("OPA 41 / 41", { exact: true })).toBeVisible();
  await expect(page.getByText("Reference evaluator", { exact: true })).toBeVisible();
  await expect(page.getByText(/44\/47 killed · not OPA/u)).toBeVisible();
  await expect(page.getByRole("cell", { name: "D01", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDirectory, "03-case-lab-drift.png"), fullPage: true });

  await page.getByRole("link", { name: /Integration \/ Drift/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Integration / Drift" })).toBeVisible();
  await expect(page.getByText("REFERENCE_EXPECTATION_NOT_OPA", { exact: false })).toBeVisible();
  await expect(page.getByText(/accepted corpus expectations, not OPA results/u)).toBeVisible();
  for (const caseId of ["D01", "D02", "D03"]) {
    await expect(page.getByText(caseId, { exact: true })).toBeVisible();
  }
  const untrustedRepair = await request.post(
    "/api/policies/policy-seeded-refund/versions/4/repair-runs",
    { data: { clientRequestId: "44444444-4444-4444-8444-444444444444" } },
  );
  expect(untrustedRepair.status()).toBe(403);
  const startRepair = page.getByRole("button", { name: "Start guarded Codex repair" });
  await expect(startRepair).toBeEnabled();
  await startRepair.click();
  await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
  await expect(page.getByText("Run created", { exact: true })).toBeVisible();
  await expect(page.getByText("Run blocked", { exact: true })).toBeVisible();
  await expect(page.getByText("No model or Codex call occurred for this blocked run.")).toBeVisible();
  const replayedTimeline = await page.evaluate(async () => {
    const latestResponse = await fetch(
      "/api/policies/policy-seeded-refund/versions/4/repair-runs",
      { cache: "no-store" },
    );
    const latest = (await latestResponse.json()) as { run: { id: string } };
    const response = await fetch(
      `/api/policies/policy-seeded-refund/versions/4/repair-runs/${latest.run.id}/events`,
      { headers: { "Last-Event-ID": "1" } },
    );
    return { status: response.status, body: await response.text() };
  });
  expect(replayedTimeline.status).toBe(200);
  expect(replayedTimeline.body).not.toContain("id: 1\n");
  expect(replayedTimeline.body).toContain("id: 2\n");
  expect(replayedTimeline.body).toContain('"type":"RUN_BLOCKED"');
  await page.reload();
  await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
  await expect(page.getByText("Run blocked", { exact: true })).toBeVisible();
  const firstRunHeading = await page.locator(".repair-run-panel h2").innerText();
  await page.getByRole("button", { name: "Create new guarded attempt" }).click();
  await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".repair-run-panel h2").innerText()).not.toBe(firstRunHeading);
  const idempotentRepairReplay = await page.evaluate(async () => {
    const workspaceResponse = await fetch(
      "/api/policies/policy-seeded-refund/workspace",
      { cache: "no-store" },
    );
    const workspace = (await workspaceResponse.json()) as { csrfToken: string };
    const latestResponse = await fetch(
      "/api/policies/policy-seeded-refund/versions/4/repair-runs",
      { cache: "no-store" },
    );
    const latest = (await latestResponse.json()) as {
      run: { clientRequestId: string };
    };
    const response = await fetch(
      "/api/policies/policy-seeded-refund/versions/4/repair-runs",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PolicyTwin-CSRF": workspace.csrfToken,
        },
        body: JSON.stringify({ clientRequestId: latest.run.clientRequestId }),
      },
    );
    return { status: response.status, body: await response.json() };
  });
  expect(idempotentRepairReplay.status).toBe(200);
  expect(idempotentRepairReplay.body.created).toBe(false);
  await page.screenshot({ path: resolve(screenshotDirectory, "04-integration-drift.png"), fullPage: true });

  await page.getByRole("link", { name: /Proof/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Proof" })).toBeVisible();
  await expect(
    page.getByText("Reference v4 OPA proof is preserved. Live repair still pending.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This session matches recorded reference v4.", { exact: true }),
  ).toBeVisible();
  const archiveLink = page.getByRole("link", {
    name: "Download complete reference evidence archive",
  });
  await expect(archiveLink).toBeVisible();
  const [archiveDownload] = await Promise.all([
    page.waitForEvent("download"),
    archiveLink.click(),
  ]);
  expect(archiveDownload.suggestedFilename()).toMatch(
    /^policytwin-evidence-v4-partial-offline-fail-[0-9a-f]{12}\.tar$/u,
  );
  const downloadedArchivePath = await archiveDownload.path();
  expect(downloadedArchivePath).not.toBeNull();
  const downloadedArchiveBody = await readFile(downloadedArchivePath as string);
  await expect(page.getByRole("link", { name: /impact-report\.json/u })).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDirectory, "05-proof.png"), fullPage: true });

  await page.getByRole("link", { name: /Change Impact/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Change Impact" })).toBeVisible();
  await expect(page.getByText("G02 blocks verification", { exact: true })).toBeVisible();
  await expect(page.getByText("REFERENCE_EVALUATOR_NOT_OPA", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Candidate policy text")).toHaveValue(/including exactly day 30/u);
  await expect(page.getByLabel("Candidate policy text")).not.toHaveValue(/including exactly day 14/u);
  await page.getByRole("button", { name: "Create draft v5" }).click();
  await expect(page.getByRole("button", { name: "Draft v5 persisted" })).toBeDisabled();
  await expect(page.getByText("No code changed", { exact: true })).toBeVisible();
  const replayedSource = await page.evaluate(async () => {
    const workspaceResponse = await fetch(
      "/api/policies/policy-seeded-refund/workspace",
      { cache: "no-store" },
    );
    const workspace = (await workspaceResponse.json()) as {
      csrfToken: string;
      workspace: { currentVersion: { sourceText: string } };
    };
    const response = await fetch(
      "/api/policies/policy-seeded-refund/versions/4/source",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PolicyTwin-CSRF": workspace.csrfToken,
        },
        body: JSON.stringify({ sourceText: workspace.workspace.currentVersion.sourceText }),
      },
    );
    return { status: response.status, body: await response.json() };
  });
  expect(replayedSource.status).toBe(200);
  expect(replayedSource.body.idempotent).toBe(true);
  expect(replayedSource.body.workspace.project.currentVersion).toBe(5);
  await page.reload();
  await expect(page.getByRole("button", { name: "Draft v5 persisted" })).toBeDisabled();
  await page.screenshot({ path: resolve(screenshotDirectory, "06-change-impact.png"), fullPage: true });

  await page.getByRole("link", { name: /Decision Queue/u }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Interpret v5 before changing decisions" }),
  ).toBeVisible();
  await expect(page.locator(".decision-card")).toHaveCount(0);

  const isolatedContext = await browser.newContext();
  try {
    const isolatedPage = await isolatedContext.newPage();
    await isolatedPage.goto("http://127.0.0.1:3210/decisions");
    await expect(isolatedPage.getByText("0 / 3 resolved", { exact: true })).toBeVisible();
    await expect(isolatedPage.getByText("SQLite current version:")).toContainText("v1");
    await isolatedPage.getByRole("button", { name: /Purchase day is day 1/u }).click();
    await isolatedPage.getByRole("button", { name: /Measure at decision time/u }).click();
    await isolatedPage.getByRole("button", { name: /Deny by default/u }).click();
    await expect(isolatedPage.getByText("3 / 3 resolved", { exact: true })).toBeVisible();
    await isolatedPage.getByRole("link", { name: /Proof/u }).click();
    await expect(
      isolatedPage.getByText("Recorded proof does not match this session.", { exact: true }),
    ).toBeVisible();
    await isolatedPage.getByRole("link", { name: /Change Impact/u }).click();
    await expect(
      isolatedPage.getByText("Reference proof does not match this session.", { exact: true }),
    ).toBeVisible();
    await expect(
      isolatedPage.getByRole("button", { name: "Seeded reference decisions required" }),
    ).toBeDisabled();
    const isolatedWorkspace = await isolatedPage.evaluate(async () => {
      const response = await fetch("/api/policies/policy-seeded-refund/workspace", {
        cache: "no-store",
      });
      return response.json() as Promise<{
        csrfToken: string;
        workspace: {
          project: { id: string };
          currentVersion: { sourceText: string };
        };
      }>;
    });
    const alternateChangedSource = isolatedWorkspace.workspace.currentVersion.sourceText
      .replaceAll("14 calendar days", "30 calendar days")
      .replaceAll("exactly day 14", "exactly day 30");
    const bypassedImpact = await isolatedPage.evaluate(async ({ csrfToken, sourceText }) => {
      const response = await fetch(
        "/api/policies/policy-seeded-refund/versions/4/source",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PolicyTwin-CSRF": csrfToken,
          },
          body: JSON.stringify({ sourceText }),
        },
      );
      return { status: response.status, body: await response.json() };
    }, {
      csrfToken: isolatedWorkspace.csrfToken,
      sourceText: alternateChangedSource,
    });
    expect(bypassedImpact).toEqual({
      status: 409,
      body: { error: "REFERENCE_POLICY_MISMATCH" },
    });
    const databasePath = process.env.POLICYTWIN_E2E_DATABASE_PATH;
    expect(databasePath).toBeTruthy();
    const database = new DatabaseSync(databasePath!);
    database
      .prepare("UPDATE policy_projects SET created_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", isolatedWorkspace.workspace.project.id);
    database.close();
    const expiredMutation = await isolatedPage.evaluate(async ({ csrfToken, sourceText }) => {
      const response = await fetch(
        "/api/policies/policy-seeded-refund/versions/4/source",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PolicyTwin-CSRF": csrfToken,
          },
          body: JSON.stringify({ sourceText }),
        },
      );
      return { status: response.status, body: await response.json() };
    }, {
      csrfToken: isolatedWorkspace.csrfToken,
      sourceText: alternateChangedSource,
    });
    expect(expiredMutation).toEqual({ status: 403, body: { error: "INVALID_SESSION" } });
  } finally {
    await isolatedContext.close();
  }

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
  const verification = await evidence.json();
  expect(verification.externalGates.opa).toBe("PASS");

  const archive = await request.get("/api/evidence/archive");
  expect(archive.ok()).toBe(true);
  expect(archive.headers()["content-type"]).toBe("application/x-tar");
  expect(archive.headers()["content-disposition"]).toMatch(
    /policytwin-evidence-v4-partial-offline-fail-[0-9a-f]{12}\.tar/u,
  );
  expect(archive.headers()["cache-control"]).toBe("no-store");
  expect(archive.headers()["x-policytwin-evidence-hash"]).toBe(verification.evidenceHash);
  expect(archive.headers()["x-policytwin-evidence-mode"]).toBe("PARTIAL_OFFLINE");
  expect(archive.headers()["x-policytwin-package-status"]).toBe("FAIL");
  expect(archive.headers().etag).toMatch(/^"[0-9a-f]{64}"$/u);
  const archiveBody = await archive.body();
  expect(Buffer.compare(downloadedArchiveBody, archiveBody)).toBe(0);
  expect(archiveBody.length % 512).toBe(0);
  expect(archiveBody.subarray(-1024).every((byte) => byte === 0)).toBe(true);
  expect(archiveBody.includes(Buffer.from("evidence-manifest.json", "ascii"))).toBe(true);
  const repeatedArchive = await request.get("/api/evidence/archive");
  expect(repeatedArchive.headers().etag).toBe(archive.headers().etag);
  expect(Buffer.compare(await repeatedArchive.body(), archiveBody)).toBe(0);

  const manifestDownload = await request.get("/api/evidence/evidence-manifest.json");
  expect(manifestDownload.ok()).toBe(true);
  expect((await manifestDownload.json()).evidenceHash).toBe(verification.evidenceHash);
  const summaryDownload = await request.get("/api/evidence/summary.md");
  expect(summaryDownload.ok()).toBe(true);
  expect(await summaryDownload.text()).toContain("Evidence mode: PARTIAL_OFFLINE");
  const archiveNames = tarEntryNames(archiveBody);
  expect(archiveNames).toHaveLength(38);
  for (const name of archiveNames) {
    const individual = await request.get(`/api/evidence/${encodeURIComponent(name)}`);
    expect(individual.ok(), `individual evidence download failed: ${name}`).toBe(true);
  }
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
  await page.goto("/impact");
  await expect(page.getByRole("navigation", { name: "Workspace views" })).toBeVisible();
  for (const label of [
    "Policy Studio",
    "Decision Queue",
    "Case Lab",
    "Integration / Drift",
    "Proof",
    "Change Impact",
  ]) {
    await expect(page.getByRole("link", { name: new RegExp(label, "u") })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Change Impact" })).toBeVisible();
  const mobileG02 = page.getByLabel("Impact for case G02");
  await expect(mobileG02).toBeVisible();
  await expect(mobileG02.getByText("DENY", { exact: true })).toBeVisible();
  await expect(mobileG02.getByText("ALLOW", { exact: true })).toBeVisible();
  await expect(mobileG02.getByText("refund-eligible", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(screenshotDirectory, "07-mobile-or-responsive.png"), fullPage: true });
});

test("anonymous workspace capacity fails closed without creating another project", async ({
  browser,
}) => {
  const finalAllowedContext = await browser.newContext();
  try {
    const finalAllowedPage = await finalAllowedContext.newPage();
    await finalAllowedPage.goto("http://127.0.0.1:3210/");
    await expect(finalAllowedPage.getByText("SQLite v1", { exact: true })).toBeVisible();
  } finally {
    await finalAllowedContext.close();
  }

  const rejectedContext = await browser.newContext();
  try {
    const rejectedPage = await rejectedContext.newPage();
    await rejectedPage.goto("http://127.0.0.1:3210/");
    await expect(
      rejectedPage.getByRole("heading", { level: 2, name: "Workspace unavailable" }),
    ).toBeVisible();
    await expect(rejectedPage.getByText(/temporary capacity/u)).toBeVisible();
  } finally {
    await rejectedContext.close();
  }
});
