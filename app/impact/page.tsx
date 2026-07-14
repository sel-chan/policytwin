import { seededChangeImpactContract } from "../lib/change-impact-contract";
import { ChangeImpactClient } from "./change-impact-client";

export const metadata = { title: "Change Impact" };
export const dynamic = "force-dynamic";

export default function ChangeImpactPage() {
  const { changedSourceText, impact, referencePolicyMeaning } = seededChangeImpactContract();
  return <ChangeImpactClient
    changedSourceText={changedSourceText}
    impact={impact}
    referencePolicyMeaning={referencePolicyMeaning}
  />;
}
