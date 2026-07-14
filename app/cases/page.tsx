import { WorkspaceShell, StatusPill } from "../components/workspace-shell";
import { demoData } from "../lib/demo-data";

export const metadata = { title: "Case Lab" };
export const dynamic = "force-dynamic";

export default function CasesPage() {
  const { opa, verification } = demoData();
  const visible = opa.results.filter(item => ["G01", "G02", "G03", "D01", "D02", "D03"].includes(item.caseId));
  return <WorkspaceShell active="cases" eyebrow="Policy test corpus / OPA 1.18.2" title="Case Lab" summary="Boundary, conflict, contrast, and mutation evidence make the contract falsifiable." actions={<StatusPill tone="ok">OPA 41 / 41</StatusPill>}>
    <section className="metric-strip"><div><span>Golden</span><strong>{verification.golden.passed}/{verification.golden.total}</strong><small>Authoritative</small></div><div><span>Generated</span><strong>{verification.generated.passed}/{verification.generated.total}</strong><small>Traceable cases</small></div><div><span>Mutation</span><strong>{(verification.mutation.killRate * 100).toFixed(1)}%</strong><small>{verification.mutation.killed}/{verification.mutation.total} killed</small></div><div><span>Engine</span><strong>OPA</strong><small>v{opa.opaVersion}</small></div></section>
    <section className="panel"><div className="panel-heading"><div><span className="kicker">Representative 6 / full corpus 41</span><h2>Accepted policy decisions</h2></div><p className="corpus-summary">boundaries · conflicts · golden cases</p></div><div className="table-wrap"><table><caption className="sr-only">Selected golden and seeded policy evaluation witnesses</caption><thead><tr><th>Case</th><th>Source</th><th>Expected</th><th>Matched rule</th><th>OPA</th></tr></thead><tbody>{visible.map(item => <tr key={item.caseId}><td><strong>{item.caseId}</strong></td><td>{item.caseId.startsWith("G") ? "Golden" : "Seeded defect"}</td><td><span className={`decision ${item.result.decision.toLowerCase()}`}>{item.result.decision}</span></td><td className="mono">{item.result.matchedRuleId ?? "default"}</td><td><StatusPill tone="ok">Pass</StatusPill></td></tr>)}</tbody></table></div><footer className="evidence-footer"><span>Binary SHA-256</span><code>{opa.executableSha256.slice(0, 20)}…</code></footer></section>
  </WorkspaceShell>;
}
