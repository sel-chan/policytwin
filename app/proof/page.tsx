import Link from "next/link";
import { WorkspaceShell, StatusPill } from "../components/workspace-shell";
import { demoData } from "../lib/demo-data";

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
  const { verification } = demoData();
  return <WorkspaceShell active="proof" eyebrow="Evidence package / partial offline" title="Proof" summary="Every metric maps to a machine-readable artifact; unavailable live work remains visibly blocked." actions={<StatusPill tone="warn">Partial offline</StatusPill>}>
    <section className="proof-banner"><div><span className="kicker">Current verification</span><h2>OPA proven. Live repair still pending.</h2><p>Policy execution is real and reproducible. GPT-5.6, Codex repair, browser, container, and deployment gates cannot be claimed yet.</p></div><div className="hash"><span>Evidence hash</span><code>{verification.evidenceHash}</code></div></section>
    <div className="two-column proof-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">Gate matrix</span><h2>Truthful status</h2></div></div><div className="gate-list">{Object.entries(verification.externalGates).map(([gate, status]) => <div key={gate}><span>{gateLabels[gate] ?? gate}</span><StatusPill tone={status === "PASS" ? "ok" : "warn"}>{status}</StatusPill></div>)}</div></section><section className="panel"><div className="panel-heading"><div><span className="kicker">Downloadable evidence</span><h2>Proof files</h2></div></div><div className="artifact-list">{artifacts.map(name => <Link href={`/api/evidence/${name}`} key={name}><span className="file-mark">{name.endsWith(".json") ? "{}" : "R"}</span><span><strong>{name}</strong><small>Partial offline artifact</small></span><span className="download-label">Download</span></Link>)}</div></section></div>
    <p className="disclaimer">PolicyTwin is not legal advice. Human approval is required before real policy deployment.</p>
  </WorkspaceShell>;
}
