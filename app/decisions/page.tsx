import { WorkspaceShell, StatusPill } from "../components/workspace-shell";
import { demoData } from "../lib/demo-data";

export const metadata = { title: "Decision Queue" };
export const dynamic = "force-dynamic";

export default function DecisionsPage() {
  const { policy } = demoData();
  return <WorkspaceShell active="decisions" eyebrow="Review gate / v1 → v4" title="Decision Queue" summary="Material ambiguity becomes an explicit, versioned product decision—not a hidden model guess." actions={<StatusPill tone="ok">3 / 3 resolved</StatusPill>}>
    <section className="decision-layout"><div className="decision-stack">{policy.ambiguities.map((item, index) => { const selected = item.options.find(option => option.id === item.selectedOptionId); return <article className="panel decision-card" key={item.id}><div className="decision-head"><span className="step-number">0{index + 1}</span><div><span className="kicker">{item.category}</span><h2>{item.question}</h2></div><StatusPill tone="ok">Resolved</StatusPill></div><p className="rationale">{item.rationale}</p><div className="option-list">{item.options.map(option => <div className={option.id === item.selectedOptionId ? "option selected" : "option"} key={option.id}><span className="radio" aria-hidden="true" /><div><strong>{option.label}</strong><small>{option.description}</small></div>{option.id === item.selectedOptionId ? <span className="chosen">Accepted</span> : null}</div>)}</div><footer><span className="mono">{item.id}</span><strong>{selected?.policyPatch.op.replaceAll("_", " ")}</strong></footer></article>; })}</div><aside className="panel audit-rail"><span className="kicker">Version ledger</span><h2>Every choice leaves proof</h2><ol><li><strong>v1</strong><span>Recorded interpretation</span></li><li><strong>v2</strong><span>Purchase day = day 0</span></li><li><strong>v3</strong><span>Usage at request time</span></li><li><strong>v4</strong><span>Default decision = DENY</span></li></ol><div className="notice"><strong>Golden cases are authoritative</strong><span>A conflicting choice blocks the next version.</span></div></aside></section>
  </WorkspaceShell>;
}
