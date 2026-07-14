import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePolicyCases } from "../../dist/domain/case-validation.js";
import { resolvePolicyAmbiguity } from "../../dist/policy-ir/resolve.js";
import { parsePolicyIR } from "../../dist/policy-ir/validate.js";

interface DriftArtifact {
  total: number;
  matches: number;
  drifts: number;
  errors: number;
  records: Array<{
    caseId: string;
    expected: { decision: string };
    actual: { decision: string } | null;
    status: string;
    defectIds: string[];
  }>;
}

interface TraceabilityArtifact {
  codeLocations: Array<{
    file: string;
    lineStart: number;
    ruleIds: string[];
  }>;
}

export interface ImpactArtifact {
  schemaVersion: "1";
  executionMode: "REFERENCE_EVALUATOR_NOT_OPA";
  fromVersion: number;
  toVersion: number;
  change: { field: string; from: number; to: number };
  verificationState: "BLOCKED_BY_GOLDEN_CONTRADICTION";
  changedClauses: Array<{ clauseId: string; beforeText: string; afterText: string }>;
  changedRules: Array<{ ruleId: string }>;
  changedCases: Array<{
    caseId: string;
    beforeDecision: string;
    afterDecision: string;
    beforeRuleId: string | null;
    afterRuleId: string | null;
    source: string;
  }>;
  goldenContradictionCaseIds: string[];
  regeneratedBoundaryValues: number[];
  potentialCodeLocations: Array<{
    id: string;
    file: string;
    lineStart: number;
    lineEnd: number;
    symbol: string;
    ruleIds: string[];
  }>;
}

export function demoData() {
  const sourceText = readFileSync(
    resolve(process.cwd(), "fixtures", "interpreter", "seeded-refund-policy.txt"),
    "utf8",
  );
  const recordedValue = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "fixtures", "interpreter", "recorded-policy-ir.v1.json"),
      "utf8",
    ),
  ) as unknown;
  const goldenValue = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "fixtures", "refund-demo", "cases", "golden-cases.json"),
      "utf8",
    ),
  ) as unknown;
  const verificationValue = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "artifacts", "evidence", "verification-summary.json"),
      "utf8",
    ),
  ) as unknown;
  const opaValue = JSON.parse(
    readFileSync(resolve(process.cwd(), "artifacts", "evidence", "opa-results.json"), "utf8"),
  ) as unknown;
  const driftValue = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "artifacts", "evidence", "drift-report-before.json"),
      "utf8",
    ),
  ) as unknown;
  const traceabilityValue = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "artifacts", "evidence", "traceability.json"),
      "utf8",
    ),
  ) as unknown;
  const impactValue = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "artifacts", "evidence", "impact-report.json"),
      "utf8",
    ),
  ) as unknown;
  const goldenCases = parsePolicyCases(goldenValue);
  let policy = parsePolicyIR(recordedValue);
  for (const [ambiguityId, optionId] of [
    ["ambiguity-purchase-day-index", "purchase-day-zero"],
    ["ambiguity-usage-measurement-time", "usage-at-request"],
    ["ambiguity-default-decision", "default-deny"],
  ] as const) {
    policy = resolvePolicyAmbiguity(policy, ambiguityId, optionId, goldenCases).policy;
  }
  return {
    sourceText,
    goldenCases,
    policy,
    verification: verificationValue as {
      evidenceHash: string;
      golden: { passed: number; total: number };
      generated: { passed: number; total: number };
      driftBefore: number;
      mutation: { killed: number; total: number; killRate: number };
      traceability: { clausesCovered: number; clausesTotal: number; rulesCovered: number; rulesTotal: number };
      externalGates: Record<string, string>;
    },
    opa: opaValue as {
      opaVersion: string;
      executableSha256: string;
      results: Array<{ caseId: string; result: { decision: string; matchedRuleId: string | null } }>;
    },
    drift: (() => {
      const artifact = driftValue as DriftArtifact;
      return {
        summary: {
          total: artifact.total,
          matches: artifact.matches,
          drifts: artifact.drifts,
          errors: artifact.errors,
        },
        results: artifact.records.map((record) => ({
          caseId: record.caseId,
          expectedDecision: record.expected.decision,
          actualDecision: record.actual?.decision ?? null,
          status: record.status,
          defectClass: record.defectIds.join(" + "),
        })),
      };
    })(),
    traceability: {
      codeLocations: (traceabilityValue as TraceabilityArtifact).codeLocations.map(
        (location) => ({
          ruleId: location.ruleIds.join(", "),
          file: location.file,
          line: location.lineStart,
        }),
      ),
    },
    impact: impactValue as ImpactArtifact,
  };
}
