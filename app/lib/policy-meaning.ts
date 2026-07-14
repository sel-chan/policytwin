import type { PolicyIR } from "../../dist/policy-ir/types.js";

export function policyMeaningFingerprint(policy: PolicyIR): string {
  return JSON.stringify({
    version: policy.version,
    schemaVersion: policy.schemaVersion,
    domain: policy.domain,
    clauses: policy.clauses,
    rules: policy.rules,
    ambiguities: policy.ambiguities,
    defaultDecision: policy.defaultDecision,
    normalization: policy.normalization,
    inputSchema: policy.inputSchema,
  });
}
