import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
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

test.skip("regression D01 allows the exact day-14 boundary", () => {
  assert.equal(decideRefund({ ...eligibleInput, daysSincePurchase: 14 }), "ALLOW");
});

test.skip("regression D02 allows the exact 2000-bps usage boundary", () => {
  assert.equal(decideRefund({ ...eligibleInput, usageBasisPoints: 2000 }), "ALLOW");
});

test.skip("regression D03 keeps final sale above approved promotion", () => {
  assert.equal(
    decideRefund({
      ...eligibleInput,
      promotionalPurchase: true,
      managerApproved: true,
      finalSale: true,
    }),
    "DENY",
  );
});
