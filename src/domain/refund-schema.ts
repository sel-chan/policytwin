export const REFUND_INPUT_SCHEMA_V1 = {
  type: "object",
  additionalProperties: false,
  required: [
    "daysSincePurchase",
    "usageBasisPoints",
    "promotionalPurchase",
    "finalSale",
    "managerApproved",
    "planType",
  ],
  properties: {
    daysSincePurchase: { type: "integer", minimum: 0 },
    usageBasisPoints: { type: "integer", minimum: 0 },
    promotionalPurchase: { type: "boolean" },
    finalSale: { type: "boolean" },
    managerApproved: { type: "boolean" },
    planType: { enum: ["MONTHLY", "ANNUAL", "ENTERPRISE"] },
  },
} as const;
