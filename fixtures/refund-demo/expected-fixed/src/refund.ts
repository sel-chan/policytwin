export type Decision = "ALLOW" | "DENY" | "REVIEW";

export interface RefundPolicyInput {
  daysSincePurchase: number;
  usageBasisPoints: number;
  promotionalPurchase: boolean;
  finalSale: boolean;
  managerApproved: boolean;
  planType: "MONTHLY" | "ANNUAL" | "ENTERPRISE";
}

export function decideRefund(input: RefundPolicyInput): Decision {
  if (input.finalSale) {
    return "DENY";
  }

  const withinWindow = input.daysSincePurchase <= 14;
  const withinUsage = input.usageBasisPoints <= 2000;

  if (!withinWindow || !withinUsage) {
    return "DENY";
  }

  if (input.promotionalPurchase) {
    return input.managerApproved ? "ALLOW" : "REVIEW";
  }

  return "ALLOW";
}
