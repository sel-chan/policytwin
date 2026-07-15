import assert from "node:assert/strict";
import test from "node:test";
import { collectSubmissionFailures } from "../../scripts/submission-validation.mjs";

function readySnapshot() {
  return {
    fileFailures: [],
    links: {
      liveUrl: "https://example.com/live",
      repositoryUrl: "https://example.com/repo",
      videoUrl: "https://example.com/video",
      submissionUrl: "https://example.com/submission",
    },
    state: {
      status: "SUBMITTED",
      confirmation: "confirmed",
      staticSecurityStatus: "PASS",
      cleanCopyStatus: "PASS",
      evidenceStatus: "PASS",
    },
    rulesVerified: true,
    evidence: { status: "PASS", evidenceMode: "LIVE_VERIFIED" },
    licensePresent: true,
    securityStatus: "PASS",
    cleanCopyStatus: "PASS",
    containerStatus: "PASS",
  };
}

test("submission readiness requires every independent proof boundary", () => {
  assert.deepEqual(collectSubmissionFailures(readySnapshot()), []);
  const falseReady = readySnapshot();
  falseReady.state = { status: "SUBMITTED", confirmation: null };
  falseReady.evidence = { status: "FAIL", evidenceMode: "PARTIAL_OFFLINE" };
  falseReady.links.videoUrl = "javascript:fake";
  falseReady.rulesVerified = false;
  const failures = collectSubmissionFailures(falseReady);
  assert.equal(failures.includes("Submission confirmation evidence is absent."), true);
  assert.equal(failures.includes("Evidence package is not live verified PASS."), true);
  assert.equal(failures.includes("Missing verified HTTPS link: videoUrl"), true);
  assert.equal(failures.includes("Official rules have not been verified."), true);

  const stale = readySnapshot();
  stale.state.cleanCopyStatus = "FAIL";
  stale.state.staticSecurityStatus = "FAIL";
  stale.state.evidenceStatus = "FAIL";
  const staleFailures = collectSubmissionFailures(stale);
  assert.equal(staleFailures.includes("Submission state clean-copy status is stale."), true);
  assert.equal(staleFailures.includes("Submission state security status is stale."), true);
  assert.equal(staleFailures.includes("Submission state evidence status is stale."), true);
});

test("draft, license, security, and container failures cannot be hidden by final state text", () => {
  const snapshot = readySnapshot();
  snapshot.fileFailures = ["Draft marker remains: long-description.md"];
  snapshot.licensePresent = false;
  snapshot.securityStatus = "FAIL";
  snapshot.containerStatus = "FAIL";
  assert.deepEqual(collectSubmissionFailures(snapshot), [
    "Container health evidence is not passing.",
    "Draft marker remains: long-description.md",
    "Offline security check is not passing.",
    "Project LICENSE is absent.",
    "Submission state security status is stale.",
  ]);
});
