import type { PolicyIR } from "./types.js";

export type PolicyLifecycleState =
  | "DRAFT"
  | "INTERPRETING"
  | "NEEDS_DECISION"
  | "READY_TO_COMPILE"
  | "COMPILED"
  | "DRIFT_DETECTED"
  | "REPAIRING"
  | "VERIFYING"
  | "VERIFIED"
  | "INTERPRETATION_FAILED"
  | "COMPILATION_FAILED"
  | "EXECUTION_FAILED"
  | "REPAIR_FAILED"
  | "VERIFICATION_FAILED";

const TRANSITIONS: Record<PolicyLifecycleState, readonly PolicyLifecycleState[]> = {
  DRAFT: ["INTERPRETING"],
  INTERPRETING: ["NEEDS_DECISION", "READY_TO_COMPILE", "INTERPRETATION_FAILED"],
  NEEDS_DECISION: ["READY_TO_COMPILE", "INTERPRETING"],
  READY_TO_COMPILE: ["COMPILED", "NEEDS_DECISION", "COMPILATION_FAILED"],
  COMPILED: ["DRIFT_DETECTED", "VERIFYING", "EXECUTION_FAILED"],
  DRIFT_DETECTED: ["REPAIRING", "VERIFYING"],
  REPAIRING: ["VERIFYING", "REPAIR_FAILED"],
  VERIFYING: ["VERIFIED", "VERIFICATION_FAILED"],
  VERIFIED: [],
  INTERPRETATION_FAILED: ["INTERPRETING"],
  COMPILATION_FAILED: ["READY_TO_COMPILE"],
  EXECUTION_FAILED: ["COMPILED"],
  REPAIR_FAILED: ["REPAIRING"],
  VERIFICATION_FAILED: ["VERIFYING", "NEEDS_DECISION"],
};

export class PolicyStateTransitionError extends Error {
  constructor(
    readonly from: PolicyLifecycleState,
    readonly to: PolicyLifecycleState,
  ) {
    super(`Invalid policy state transition: ${from} -> ${to}`);
    this.name = "PolicyStateTransitionError";
  }
}

export function canTransitionPolicyState(
  from: PolicyLifecycleState,
  to: PolicyLifecycleState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionPolicyState(
  from: PolicyLifecycleState,
  to: PolicyLifecycleState,
): PolicyLifecycleState {
  if (!canTransitionPolicyState(from, to)) {
    throw new PolicyStateTransitionError(from, to);
  }
  return to;
}

export function stateForPolicyCandidate(policy: PolicyIR): "NEEDS_DECISION" | "READY_TO_COMPILE" {
  return policy.ambiguities.some((ambiguity) => ambiguity.status === "OPEN")
    ? "NEEDS_DECISION"
    : "READY_TO_COMPILE";
}

export function assertPolicyReadyToCompile(policy: PolicyIR): void {
  const openAmbiguities = policy.ambiguities
    .filter((ambiguity) => ambiguity.status === "OPEN")
    .map((ambiguity) => ambiguity.id);
  if (openAmbiguities.length > 0) {
    throw new PolicyStateTransitionError("NEEDS_DECISION", "COMPILED");
  }
}
