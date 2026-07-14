import "server-only";
import { demoData } from "./demo-data";
import { policyMeaningFingerprint } from "./policy-meaning";

export function seededChangeImpactContract() {
  const { impact, policy, sourceText } = demoData();
  return {
    impact,
    changedSourceText: sourceText
      .replaceAll("14 calendar days", "30 calendar days")
      .replaceAll("exactly day 14", "exactly day 30"),
    referencePolicyMeaning: policyMeaningFingerprint(policy),
  };
}
