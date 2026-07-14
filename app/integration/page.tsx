import { WorkspaceShell, StatusPill } from "../components/workspace-shell";
import { demoData } from "../lib/demo-data";

export const metadata = { title: "Integration & Drift" };
export const dynamic = "force-dynamic";

export default function IntegrationPage() {
  const { drift, traceability } = demoData();
  const seeded = drift.results.filter(item => ["D01", "D02", "D03"].includes(item.caseId));
  return <WorkspaceShell active="integration" eyebrow="Application comparison / seeded fixture" title="Integration / Drift" summary="Policy-engine decisions and TypeScript behavior are compared case by case before repair." actions={<StatusPill tone="bad">{drift.summary.drifts} drifts</StatusPill>}>
    <section className="drift-hero panel"><div><span className="kicker">Run 2026-07-14 · baseline</span><h2>Three seeded bugs, sixteen counterexamples</h2><p>The fixture fails exact boundaries and lets a promotional approval bypass final-sale precedence.</p></div><div className="donut" aria-label={`${drift.summary.drifts} drift, ${drift.summary.matches} match`}><strong>{drift.summary.drifts}</strong><span>drift</span></div></section>
    <div className="two-column integration-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">Seeded witnesses</span><h2>Counterexample cluster</h2></div></div><div className="drift-list">{seeded.map(item => <article key={item.caseId}><span className="case-id">{item.caseId}</span><div><strong>{item.defectClass?.replaceAll("_", " ") ?? "BEHAVIOR DRIFT"}</strong><small>Expected {item.expectedDecision} · app returned {item.actualDecision}</small></div><StatusPill tone="bad">Drift</StatusPill></article>)}</div></section><section className="panel"><div className="panel-heading"><div><span className="kicker">Rule-to-code map</span><h2>Repair surface</h2></div></div><div className="code-map">{traceability.codeLocations.slice(0, 6).map((item, index) => <article key={`${item.file}-${item.line}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.ruleId}</strong><code>{item.file}:{item.line}</code></div></article>)}</div><div className="notice"><strong>Trusted fixture only</strong><span>Hosted repair cannot execute arbitrary uploaded repositories.</span></div></section></div>
  </WorkspaceShell>;
}
