import { WorkspaceShell, StatusPill } from "./components/workspace-shell";
import { demoData } from "./lib/demo-data";

export const dynamic = "force-dynamic";

export default function PolicyStudioPage() {
  const { sourceText, policy } = demoData();
  return (
    <WorkspaceShell active="studio" eyebrow="Workspace / policy-seeded-refund" title="Policy Studio" summary="Source language, structured meaning, and executable rules stay in one review surface." actions={<><StatusPill tone="warn">Recorded baseline</StatusPill><button className="primary" type="button" disabled>Interpret with GPT-5.6</button></>}>
      <section className="metric-strip" aria-label="Policy status">
        <div><span>Version</span><strong>v{policy.version}</strong><small>3 decisions recorded</small></div>
        <div><span>Clauses</span><strong>{policy.clauses.length}</strong><small>100% traced</small></div>
        <div><span>Rules</span><strong>{policy.rules.length}</strong><small>Deterministic priority</small></div>
        <div><span>State</span><strong>OPA ready</strong><small>Offline compilation passed</small></div>
      </section>
      <div className="two-column studio-grid">
        <section className="panel policy-source"><div className="panel-heading"><div><span className="kicker">Natural language contract</span><h2>Seeded SaaS refund policy</h2></div><span className="mono">{sourceText.length} chars</span></div><div className="policy-paper">{sourceText}</div><div className="notice"><strong>Evidence boundary</strong><span>This is a recorded interpretation fixture. A fresh model call is required before submission.</span></div></section>
        <section className="panel"><div className="panel-heading"><div><span className="kicker">Validated PolicyIR</span><h2>Clause map</h2></div><StatusPill tone="ok">Schema valid</StatusPill></div><div className="clause-list">{policy.clauses.map((clause, index) => <article key={clause.id}><span className="clause-index">C{String(index + 1).padStart(2, "0")}</span><div><p>{clause.text}</p><small>{clause.id} · offsets {clause.startOffset}–{clause.endOffset}</small></div></article>)}</div></section>
      </div>
      <section className="panel"><div className="panel-heading"><div><span className="kicker">Executable meaning</span><h2>Priority rule stack</h2></div><span className="mono">first match wins</span></div><div className="rule-grid">{[...policy.rules].sort((a,b) => b.priority-a.priority).map(rule => <article className="rule-card" key={rule.id}><div><span className={`decision ${rule.decision.toLowerCase()}`}>{rule.decision}</span><span className="priority">P{rule.priority}</span></div><h3>{rule.title}</h3><p>{rule.description}</p><small>{rule.id} · {rule.sourceClauseIds.join(", ")}</small></article>)}</div></section>
    </WorkspaceShell>
  );
}
