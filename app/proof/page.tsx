import Link from "next/link";
import localChallengeRun from "../../artifacts/challenge-evidence/local-challenge-run.json";
import { StatusPill, WorkspaceShell } from "../components/workspace-shell";
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

function capturedResult() {
  const testReceipt = localChallengeRun.commands.receipts.find(
    (receipt) => receipt.commandId === "fixture-test",
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
    throw new Error("The checked-in Build Week repair result is not a passing capture.");
  }

  return {
    cases: `${localChallengeRun.policyVerification.passed}/${localChallengeRun.policyVerification.total}`,
    drift: localChallengeRun.policyVerification.drift,
    tests: `${testPassed}/${testTotal}`,
    review: localChallengeRun.review.verdict,
    changedFiles: localChallengeRun.repair.changedFiles.length,
    diffSha256: localChallengeRun.repair.diffSha256,
  };
}

export default function ProofPage() {
  const { policy } = demoData();
  const result = capturedResult();
  const referencePolicyMeaning = policyMeaningFingerprint(policy);

  return (
    <WorkspaceShell
      active="proof"
      eyebrow="Verified Build Week outcome"
      title="Proof"
      summary="Start with the result, then inspect the rules, cases, diff, commands, and review evidence behind it."
      actions={<StatusPill tone="ok">Verified repair</StatusPill>}
    >
      <ProofSessionBoundary
        referencePolicyMeaning={referencePolicyMeaning}
        referenceVersion={policy.version}
      />

      <section className="proof-banner">
        <div>
          <span className="kicker">GPT-5.6 + Codex repair</span>
          <h2>{result.cases} policy cases. Zero drift. Independent {result.review}.</h2>
          <p>
            Codex changed {result.changedFiles} approved fixture files. PolicyTwin derived the
            filesystem diff, ran {result.tests} regression tests, replayed every accepted case,
            and required a separate read-only review.
          </p>
        </div>
        <div className="hash">
          <span>Captured repair diff</span>
          <code>{result.diffSha256}</code>
        </div>
      </section>

      <div className="two-column proof-grid">
        <section className="panel">
          <div className="panel-heading">
            <div><span className="kicker">Challenge result</span><h2>What passed</h2></div>
          </div>
          <div className="gate-list">
            <div><span>Accepted policy cases</span><StatusPill tone="ok">{result.cases}</StatusPill></div>
            <div><span>Application drift after repair</span><StatusPill tone="ok">{result.drift}</StatusPill></div>
            <div><span>Regression tests</span><StatusPill tone="ok">{result.tests}</StatusPill></div>
            <div><span>Independent review</span><StatusPill tone="ok">{result.review}</StatusPill></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><span className="kicker">Downloadable evidence</span><h2>Reference archive</h2></div>
          </div>
          <div className={styles.archiveDownloadCard}>
            <div>
              <strong>Complete deterministic archive</strong>
              <span>38 manifest-validated files · USTAR</span>
              <small>
                Reference policy evidence with a separate captured-repair receipt shown above.
              </small>
            </div>
            <a href="/api/evidence/archive" download aria-label="Download complete reference evidence archive">
              Download .tar
            </a>
          </div>
          <div className="artifact-list">
            {artifacts.map((name) => (
              <Link href={`/api/evidence/${name}`} key={name}>
                <span className="file-mark">{name.endsWith(".json") ? "{}" : "R"}</span>
                <span><strong>{name}</strong><small>Deterministic reference artifact · v{policy.version}</small></span>
                <span className="download-label">Download</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="notice">
        <strong>Current integration boundary</strong>
        <span>
          Direct Responses API interpretation and a fresh browser-triggered hosted repair are the
          next integration steps. The verified Build Week result above comes from the bounded,
          disposable-fixture capture.
        </span>
      </div>
      <p className="disclaimer">PolicyTwin is not legal advice. Human approval is required before real policy deployment.</p>
    </WorkspaceShell>
  );
}
