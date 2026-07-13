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
  const withinWindow = input.daysSincePurchase < 14;
  const withinUsage = input.usageBasisPoints < 2000;

  if (input.promotionalPurchase && input.managerApproved) {
    return "ALLOW";
  }

  if (input.finalSale) {
    return "DENY";
  }

  if (!withinWindow || !withinUsage) {
    return "DENY";
  }

  if (input.promotionalPurchase) {
    return "REVIEW";
  }

  return "ALLOW";
}
