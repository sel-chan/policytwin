export interface CompilerRuleMapping {
  ruleId: string;
  priority: number;
  sourceClauseIds: string[];
  predicateRule: string;
  startLine: number;
  endLine: number;
}

export interface CompilerManifest {
  schemaVersion: "1";
  compilerVersion: "rego-compiler.v1";
  regoSyntaxVersion: "v1";
  policyId: string;
  policyVersion: number;
  packageName: "policytwin.refund";
  query: "data.policytwin.refund.decision";
  inputValidation: {
    mode: "REGO_AND_PREVALIDATED";
    startLine: number;
    endLine: number;
  };
  ruleMappings: CompilerRuleMapping[];
  defaultMapping: {
    decision: "ALLOW" | "DENY" | "REVIEW";
    startLine: number;
    endLine: number;
  };
  sourceBytes: number;
}

export interface RegoCompilationResult {
  source: string;
  manifest: CompilerManifest;
}
