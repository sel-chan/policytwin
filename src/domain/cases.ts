import type { Decision } from "./decision.js";
import type { RefundPolicyInput } from "./refund.js";

export type CaseSource =
  | "USER_GOLDEN"
  | "BOUNDARY"
  | "CONFLICT"
  | "MINIMAL_CONTRAST"
  | "GENERATED"
  | "REGRESSION"
  | "MUTATION_WITNESS";

export interface PolicyCase {
  id: string;
  title: string;
  input: RefundPolicyInput;
  expectedDecision: Decision;
  source: CaseSource;
  relatedRuleIds: string[];
  relatedClauseIds: string[];
  rationale: string;
}
