import localChallengeRun from "../../artifacts/challenge-evidence/local-challenge-run.json";
import { StatusPill, WorkspaceShell } from "../components/workspace-shell";
import { demoData } from "../lib/demo-data";
import { policyMeaningFingerprint } from "../lib/policy-meaning";
import { IntegrationRunPanel } from "./integration-run-client";

export const metadata = { title: "Integration & Drift" };
export const dynamic = "force-dynamic";

function localChallengeReceipt() {
  const testReceipt = localChallengeRun.commands.receipts.find(
    receipt => receipt.commandId === "fixture-test",
  );
  const testTotal = /# tests (\d+)/u.exec(testReceipt?.stdout ?? "")?.[1];
  const testPassed = /# pass (\d+)/u.exec(testReceipt?.stdout ?? "")?.[1];
  if (
    localChallengeRun.status !== "LOCAL_CHALLENGE_PASS" ||
    localChallengeRun.repair.status !== "PASS" ||
    localChallengeRun.commands.status !== "PASS" ||
    localChallengeRun.policyVerification.status !== "PASS" ||
    localChallengeRun.review.status !== "PASS" ||
    localChallengeRun.review.verdict !== "APPROVE" ||
    localChallengeRun.review.blockingFindings !== 0 ||
    Object.values(localChallengeRun.claims).some(Boolean) ||
    testTotal === undefined ||
    testPassed === undefined
  ) {
    throw new Error("The checked-in local challenge receipt is not an admitted passing capture.");
  }
  return {
    runId: localChallengeRun.provenance.runId,
    model: localChallengeRun.model,
    changedFiles: localChallengeRun.repair.changedFiles,
    tests: `${testPassed} / ${testTotal}`,
    corpus: `${localChallengeRun.policyVerification.passed} / ${localChallengeRun.policyVerification.total}`,
    drift: localChallengeRun.policyVerification.drift,
    review: localChallengeRun.review.verdict,
    diffSha256: localChallengeRun.repair.diffSha256,
  };
}

export default function IntegrationPage() {
  const { drift, traceability, policy } = demoData();
  const seeded = drift.results.filter(item => ["D01", "D02", "D03"].includes(item.caseId));
  const challenge = localChallengeReceipt();

  return (
    <WorkspaceShell
      active="integration"
      eyebrow="Before / repair / proof"
      title="Integration / Drift"
      summary="Accepted policy expectations are compared with the seeded TypeScript application before and after a bounded Codex repair."
      actions={
        <>
          <StatusPill tone="bad">{drift.summary.drifts} before</StatusPill>
          <StatusPill tone="ok">{challenge.drift} after</StatusPill>
        </>
      }
    >
      <section className="drift-hero panel">
        <div>
          <span className="kicker">Run 2026-07-14 · REFERENCE_EXPECTATION_NOT_OPA</span>
          <h2>Three seeded bugs, sixteen counterexamples</h2>
          <p>
            This comparison uses the accepted corpus expectations, not OPA results. The fixture
            fails exact boundaries and lets a promotional approval bypass final-sale precedence.
          </p>
        </div>
        <div
          className="donut"
          aria-label={`${drift.summary.drifts} drift, ${drift.summary.matches} match`}
        >
          <strong>{drift.summary.drifts}</strong>
          <span>drift</span>
        </div>
      </section>

      <section className="panel challenge-receipt" aria-labelledby="challenge-receipt-title">
        <div className="challenge-receipt-heading">
          <div>
            <span className="kicker">Validated Build Week capture · {challenge.model}</span>
            <h2 id="challenge-receipt-title">
              Codex repaired the seeded fixture. PolicyTwin proved the result.
            </h2>
            <p>
              A disposable copy produced a filesystem-derived two-file diff, passed the fixed
              regression commands, replayed every accepted policy case, and cleared a separate
              read-only review.
            </p>
          </div>
          <StatusPill tone="ok">LOCAL_CHALLENGE_PASS</StatusPill>
        </div>

        <div className="challenge-metrics" aria-label="Validated local challenge metrics">
          <article>
            <span>Regression tests</span><strong>{challenge.tests}</strong><small>fixed command receipt</small>
          </article>
          <article>
            <span>Accepted corpus</span><strong>{challenge.corpus}</strong><small>case-by-case replay</small>
          </article>
          <article>
            <span>Application drift</span><strong>{challenge.drift}</strong><small>after repair</small>
          </article>
          <article>
            <span>Independent review</span><strong>{challenge.review}</strong><small>0 blocking findings</small>
          </article>
        </div>

        <div className="challenge-repair-detail">
          <div>
            <span>Codex-authored write set</span>
            {challenge.changedFiles.map(file => <code key={file}>{file}</code>)}
          </div>
          <div>
            <span>Admitted semantic repair</span>
            <ul>
              <li>Day 14 and 2,000 bps are inclusive.</li>
              <li><code>final_sale</code> is evaluated before promotional approval.</li>
              <li>All three seeded regression tests are enabled.</li>
            </ul>
          </div>
        </div>

        <div className="challenge-receipt-foot">
          <code>run {challenge.runId} · diff {challenge.diffSha256.slice(0, 12)}…</code>
          <span>Local challenge evidence · not production <code>verify:live</code> or cgroup-v2 attestation</span>
        </div>
      </section>

      <div className="two-column integration-grid">
        <section className="panel">
          <div className="panel-heading"><div><span className="kicker">Seeded witnesses</span><h2>Counterexample cluster</h2></div></div>
          <div className="drift-list">
            {seeded.map(item => (
              <article key={item.caseId}>
                <span className="case-id">{item.caseId}</span>
                <div><strong>{item.defectClass?.replaceAll("_", " ") ?? "BEHAVIOR DRIFT"}</strong><small>Expected {item.expectedDecision} · app returned {item.actualDecision}</small></div>
                <StatusPill tone="bad">Drift</StatusPill>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="kicker">Rule-to-code map</span><h2>Repair surface</h2></div></div>
          <div className="code-map">
            {traceability.codeLocations.slice(0, 6).map((item, index) => (
              <article key={`${item.file}-${item.line}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{item.ruleId}</strong><code>{item.file}:{item.line}</code></div>
              </article>
            ))}
          </div>
          <div className="notice"><strong>Trusted fixture only</strong><span>Hosted repair cannot execute arbitrary uploaded repositories.</span></div>
        </section>
      </div>

      <IntegrationRunPanel referencePolicyMeaning={policyMeaningFingerprint(policy)} />
    </WorkspaceShell>
  );
}
