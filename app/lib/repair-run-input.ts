import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StoredPolicyVersion } from "../../dist/persistence/sqlite.js";
import { parsePolicyCases } from "../../dist/domain/case-validation.js";
import { parsePolicyIR } from "../../dist/policy-ir/validate.js";
import { parseRepairWorkerInput } from "../../dist/codex/validate.js";
import type { PolicyIR } from "../../dist/policy-ir/types.js";
import type { RepairWorkerInput } from "../../dist/codex/types.js";

export class SeededRepairRunInputError extends Error {
  constructor(
    readonly code: "POLICY_NOT_READY" | "REFERENCE_POLICY_MISMATCH" | "EVIDENCE_INPUT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "SeededRepairRunInputError";
  }
}

function meaningFingerprint(policy: PolicyIR): string {
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

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(resolve(/* turbopackIgnore: true */ process.cwd(), relativePath), "utf8"),
  ) as unknown;
}

export function buildSeededRepairWorkerInput(version: StoredPolicyVersion): RepairWorkerInput {
  const policy = version.policyIR;
  if (
    policy === null ||
    policy.version !== version.version ||
    policy.ambiguities.some((ambiguity) => ambiguity.status !== "RESOLVED")
  ) {
    throw new SeededRepairRunInputError(
      "POLICY_NOT_READY",
      "The current policy version must contain a fully resolved PolicyIR before repair.",
    );
  }
  try {
    const referencePolicy = parsePolicyIR(readJson("artifacts/evidence/policy-ir.json"));
    if (meaningFingerprint(policy) !== meaningFingerprint(referencePolicy)) {
      throw new SeededRepairRunInputError(
        "REFERENCE_POLICY_MISMATCH",
        "The trusted repair demo accepts only the exact seeded reference policy meaning.",
      );
    }
    const sourcePolicy = readFileSync(
      resolve(
        /* turbopackIgnore: true */ process.cwd(),
        "fixtures/interpreter/seeded-refund-policy.txt",
      ),
      "utf8",
    );
    if (version.sourceText !== sourcePolicy) {
      throw new SeededRepairRunInputError(
        "REFERENCE_POLICY_MISMATCH",
        "The trusted repair demo accepts only the exact seeded reference source.",
      );
    }
    const goldenCases = parsePolicyCases(
      readJson("artifacts/evidence/golden-cases.json"),
      "$repair.goldenCases",
    );
    const generatedCases = parsePolicyCases(
      readJson("artifacts/evidence/generated-cases.json"),
      "$repair.generatedCases",
    );
    if (JSON.stringify(version.goldenCases) !== JSON.stringify(goldenCases)) {
      throw new SeededRepairRunInputError(
        "REFERENCE_POLICY_MISMATCH",
        "The trusted repair demo requires the authoritative seeded golden cases.",
      );
    }
    const driftCases = parsePolicyCases(
      readJson("fixtures/refund-demo/cases/seeded-drift-cases.json"),
      "$repair.driftCases",
    );
    const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" } as const;
    const defectsByCase = {
      D01: ["DAY_14_INCLUSIVE"],
      D02: ["USAGE_2000_INCLUSIVE"],
      D03: ["FINAL_SALE_PRECEDENCE"],
    } as const;
    return parseRepairWorkerInput({
      policyId: policy.policyId,
      policyVersion: policy.version,
      fixtureId: "seeded-refund-demo",
      sourcePolicy,
      policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
      acceptedPolicyIr: policy,
      acceptedCases: [...goldenCases, ...generatedCases],
      failingCaseIds: ["D01", "D02", "D03"],
      failingDriftWitnesses: driftCases.map((policyCase) => {
        const caseId = policyCase.id as keyof typeof actualByCase;
        if (!(caseId in actualByCase)) {
          throw new SeededRepairRunInputError(
            "EVIDENCE_INPUT_INVALID",
            "The seeded drift witness set contains an unexpected case.",
          );
        }
        return {
          caseId,
          input: policyCase.input,
          expectedDecision: policyCase.expectedDecision,
          actualDecision: actualByCase[caseId],
          defectIds: [...defectsByCase[caseId]],
          relatedClauseIds: policyCase.relatedClauseIds,
          relatedRuleIds: policyCase.relatedRuleIds,
        };
      }),
      allowedCommandIds: ["fixture-typecheck", "fixture-test"],
      maxRepairAttempts: 2,
    });
  } catch (error) {
    if (error instanceof SeededRepairRunInputError) throw error;
    throw new SeededRepairRunInputError(
      "EVIDENCE_INPUT_INVALID",
      "The trusted seeded repair input could not be reconstructed from validated artifacts.",
    );
  }
}
