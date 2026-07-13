import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = process.platform === "win32" ? "tsc.cmd" : "tsc";
const build = spawnSync(command, ["-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const moduleUrl = pathToFileURL(resolve(root, "dist", "refund.js"));
moduleUrl.searchParams.set("test", String(Date.now()));
const { decideRefund } = await import(moduleUrl.href);

const eligibleInput = {
  daysSincePurchase: 3,
  usageBasisPoints: 500,
  promotionalPurchase: false,
  finalSale: false,
  managerApproved: false,
  planType: "MONTHLY",
};

test("allows an ordinary eligible request", () => {
  assert.equal(decideRefund(eligibleInput), "ALLOW");
});

test("denies an ordinary request outside the window", () => {
  assert.equal(decideRefund({ ...eligibleInput, daysSincePurchase: 20 }), "DENY");
});

test("reviews an eligible promotion until approval", () => {
  assert.equal(decideRefund({ ...eligibleInput, promotionalPurchase: true }), "REVIEW");
});

test("denies a non-promotional final-sale request", () => {
  assert.equal(decideRefund({ ...eligibleInput, finalSale: true }), "DENY");
});
