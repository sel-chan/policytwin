export const DECISIONS = ["ALLOW", "DENY", "REVIEW"] as const;

export type Decision = (typeof DECISIONS)[number];

export function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && DECISIONS.includes(value as Decision);
}
