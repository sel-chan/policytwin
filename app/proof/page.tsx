import Link from "next/link";
import { WorkspaceShell, StatusPill } from "../components/workspace-shell";
import { demoData } from "../lib/demo-data";
import { policyMeaningFingerprint } from "../lib/policy-meaning";
import { ProofSessionBoundary } from "./proof-session-boundary";
import styles from "./proof.module.css";

export const metadata = { title: "Proof" };
export const dynamic = "force-dynamic";

const artifacts = [
  "policy-ir.json",
  "compiled-policy.rego",
  "gpt-run-summary.json",
  "opa-results.json",
  "drift-report-before.json",
  "codex-run-summary.json",
  "codex-command-receipts.json",
  "mutation-report.json",
  "mutation-run-summary.json",
  "mutation-opa-results.json",
  "traceability.json",
  "impact-report.json",
  "browser-run-summary.json",
  "browser-run-details.json",
  "container-run-summary.json",
  "container-run-details.json",
  "deployment-run-summary.json",
  "deployment-health-response.json",
  "security-report.json",
  "verification-summary.json",
];
const gateLabels: Record<string, string> = {
  gpt56: "GPT-5.6",
  opa: "OPA",
  codex: "Codex",
  browser: "Browser",
  container: "Container",
  deployment: "Deployment",
};

export default function ProofPage() {
  const { policy, verification } = demoData();
  const referencePolicyMeaning = policyMeaningFingerprint(policy);
  return <WorkspaceShell active="proof" eyebrow={`Recorded reference v${policy.version} / partial offline`} title="Proof" summary="Every metric maps to a machine-readable reference artifact; unavailable live work remains visibly blocked." actions={<StatusPill tone="warn">Partial offline</StatusPill>}>
    <ProofSessionBoundary referencePolicyMeaning={referencePolicyMeaning} referenceVersion={policy.version} />
    <section className="proof-banner"><div><span className="kicker">Recorded reference policy v{policy.version}</span><h2>Reference v{policy.version} OPA proof is preserved. Production live repair remains gated.</h2><p>The downloadable package proves the seeded reference choices only. A separate local challenge receipt proves the bounded two-file GPT-5.6/Codex repair; it does not promote this reference package to production live evidence, container proof, deployment proof, or attestation.</p></div><div className="hash"><span>Reference v{policy.version} evidence hash</span><code>{verification.evidenceHash}</code></div></section>
    <div className="two-column proof-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">Gate matrix</span><h2>Truthful status</h2></div></div><div className="gate-list">{Object.entries(verification.externalGates).map(([gate, status]) => <div key={gate}><span>{gateLabels[gate] ?? gate}</span><StatusPill tone={status === "PASS" ? "ok" : "warn"}>{status}</StatusPill></div>)}</div></section><section className="panel"><div className="panel-heading"><div><span className="kicker">Downloadable evidence</span><h2>Proof package</h2></div></div><div className={styles.archiveDownloadCard}><div><strong>Complete reference archive</strong><span>38 manifest-validated files · USTAR · Partial offline · FAIL</span><small>This is recorded reference v{policy.version} evidence, never proof for a mismatched session.</small></div><a href="/api/evidence/archive" download aria-label="Download complete reference evidence archive">Download .tar</a></div><div className="artifact-list">{artifacts.map(name => <Link href={`/api/evidence/${name}`} key={name}><span className="file-mark">{name.endsWith(".json") ? "{}" : "R"}</span><span><strong>{name}</strong><small>Recorded reference v{policy.version} partial offline artifact</small></span><span className="download-label">Download</span></Link>)}</div></section></div>
    <p className="disclaimer">PolicyTwin is not legal advice. Human approval is required before real policy deployment.</p>
  </WorkspaceShell>;
}
