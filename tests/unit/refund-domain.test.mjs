import assert from "node:assert/strict";
import test from "node:test";
import {
  RefundInputValidationError,
  parseRefundPolicyInput,
  validateRefundPolicyInput,
} from "../../dist/index.js";

const validInput = {
  daysSincePurchase: 14,
  usageBasisPoints: 2000,
  promotionalPurchase: false,
  finalSale: false,
  managerApproved: false,
  planType: "MONTHLY",
};

test("accepts exact integer boundaries without changing their meaning", () => {
  assert.deepEqual(parseRefundPolicyInput(validInput), validInput);
});

test("rejects non-finite, fractional, negative, enum, boolean, and extra-field input", () => {
  const invalidInputs = [
    { ...validInput, daysSincePurchase: Number.NaN },
    { ...validInput, daysSincePurchase: Number.POSITIVE_INFINITY },
    { ...validInput, usageBasisPoints: 1.5 },
    { ...validInput, usageBasisPoints: -1 },
    { ...validInput, planType: "WEEKLY" },
    { ...validInput, finalSale: "false" },
    { ...validInput, unexpected: true },
  ];

  for (const input of invalidInputs) {
    assert.equal(validateRefundPolicyInput(input).success, false);
    assert.throws(() => parseRefundPolicyInput(input), RefundInputValidationError);
  }
});

test("rejects null, arrays, and primitive values", () => {
  for (const input of [null, [], "refund", 14, true]) {
    assert.equal(validateRefundPolicyInput(input).success, false);
  }
});
