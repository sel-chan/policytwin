import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RULES_MAX_AGE_MILLISECONDS,
  collectSubmissionFailures,
  isFreshOfficialRulesSnapshot,
} from "../../scripts/submission-validation.mjs";
import {
  gitProbeEnvironment,
  isPublicIpAddress,
  probePublicSubmissionLinks,
} from "../../scripts/submission-publication-probe.mjs";

function readySnapshot() {
  return {
    fileFailures: [],
    links: {
      liveUrl: "https://example.com/live",
      repositoryUrl: "https://example.com/repo",
      videoUrl: "https://youtube.com/watch?v=verified",
      submissionUrl: "https://devpost.com/software/policytwin",
      feedbackSessionId: "019c0def-1234-7abc-8def-0123456789ab",
    },
    state: {
      status: "SUBMITTED",
      confirmation: {
        type: "DEVPOST_SUBMISSION_CONFIRMATION",
        file: "submission-confirmation.json",
      },
      staticSecurityStatus: "PASS",
      cleanCopyStatus: "PASS",
      evidenceStatus: "PASS",
      evidenceHash: "evidence-hash",
      rulesStatus: "VERIFIED_OFFICIAL_SOURCES",
      ownerAction: null,
    },
    rulesVerified: true,
    rulesStatus: "VERIFIED_OFFICIAL_SOURCES",
    evidence: {
      status: "PASS",
      evidenceMode: "LIVE_VERIFIED",
      evidenceHash: "evidence-hash",
    },
    licensePresent: true,
    securityStatus: "PASS",
    cleanCopyStatus: "PASS",
    containerStatus: "PASS",
  };
}

test("submission readiness requires every independent proof boundary", () => {
  assert.deepEqual(collectSubmissionFailures(readySnapshot()), []);
  const falseReady = readySnapshot();
  falseReady.state.confirmation = null;
  falseReady.evidence = { status: "FAIL", evidenceMode: "PARTIAL_OFFLINE" };
  falseReady.links.videoUrl = "javascript:fake";
  falseReady.links.feedbackSessionId = "";
  falseReady.rulesVerified = false;
  const failures = collectSubmissionFailures(falseReady);
  assert.equal(failures.includes("Submission confirmation evidence is absent."), true);
  assert.equal(failures.includes("Evidence package is not live verified PASS."), true);
  assert.equal(failures.includes("Missing verified public YouTube link: videoUrl"), true);
  assert.equal(failures.includes("Missing valid /feedback Codex Session ID."), true);
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

test("ready-for-owner-action permits exactly one Devpost action without fake confirmation", () => {
  const snapshot = readySnapshot();
  snapshot.links.submissionUrl = null;
  snapshot.state.status = "READY_FOR_OWNER_ACTION";
  snapshot.state.confirmation = null;
  snapshot.state.ownerAction = { id: "SUBMIT_ON_DEVPOST", remainingActions: 1 };
  assert.deepEqual(collectSubmissionFailures(snapshot), []);

  for (const ownerAction of [
    null,
    { id: "SUBMIT_ON_DEVPOST", remainingActions: 2 },
    { id: "DEPLOY", remainingActions: 1 },
    { id: "SUBMIT_ON_DEVPOST", remainingActions: 1, extra: true },
  ]) {
    snapshot.state.ownerAction = ownerAction;
    assert.equal(
      collectSubmissionFailures(snapshot).includes(
        "Ready-for-owner-action state must identify exactly one Devpost submission action.",
      ),
      true,
    );
  }
  snapshot.state.ownerAction = { id: "SUBMIT_ON_DEVPOST", remainingActions: 1 };
  snapshot.state.confirmation = "fabricated";
  assert.equal(
    collectSubmissionFailures(snapshot).includes(
      "Ready-for-owner-action state must not claim submission confirmation.",
    ),
    true,
  );
});

test("official rules snapshot must be verified, source-complete, recent, and not future-dated", () => {
  const now = Date.parse("2026-07-18T12:00:00.000Z");
  const snapshot = {
    status: "VERIFIED_OFFICIAL_SOURCES",
    checkedAt: new Date(now - RULES_MAX_AGE_MILLISECONDS).toISOString(),
    sources: [
      { url: "https://openai.com/build-week/", result: "VERIFIED" },
      { url: "https://openai.devpost.com/", result: "VERIFIED" },
      { url: "https://openai.devpost.com/rules", result: "VERIFIED" },
    ],
  };
  assert.equal(isFreshOfficialRulesSnapshot(snapshot, now), true);
  snapshot.checkedAt = new Date(now - RULES_MAX_AGE_MILLISECONDS - 1).toISOString();
  assert.equal(isFreshOfficialRulesSnapshot(snapshot, now), false);
  snapshot.checkedAt = new Date(now + 5 * 60 * 1_000 + 1).toISOString();
  assert.equal(isFreshOfficialRulesSnapshot(snapshot, now), false);
  snapshot.checkedAt = new Date(now).toISOString();
  snapshot.sources[0].result = "UNVERIFIED";
  assert.equal(isFreshOfficialRulesSnapshot(snapshot, now), false);
  snapshot.sources[0].result = "VERIFIED";
  snapshot.sources[0].url = "https://example.com/self-declared-rules";
  assert.equal(isFreshOfficialRulesSnapshot(snapshot, now), false);
});

test("submission links reject malformed, credentialed, loopback, and padded values", () => {
  for (const value of [
    "https://",
    "https://user:secret@example.com/path",
    "https://localhost/demo",
    " https://example.com/demo",
  ]) {
    const snapshot = readySnapshot();
    snapshot.links.liveUrl = value;
    assert.equal(
      collectSubmissionFailures(snapshot).includes("Missing verified HTTPS link: liveUrl"),
      true,
      value,
    );
  }
  for (const value of ["UNSET", "fabricated-session", "019c0def-1234-7abc-0def-0123456789ab"]) {
    const snapshot = readySnapshot();
    snapshot.links.feedbackSessionId = value;
    assert.equal(
      collectSubmissionFailures(snapshot).includes("Missing valid /feedback Codex Session ID."),
      true,
      value,
    );
  }
  for (const value of [
    "https://example.com/video",
    "https://youtube.com/watch?v=x",
    "https://youtube.example/watch?v=verified",
  ]) {
    const snapshot = readySnapshot();
    snapshot.links.videoUrl = value;
    assert.equal(
      collectSubmissionFailures(snapshot).includes(
        "Missing verified public YouTube link: videoUrl",
      ),
      true,
      value,
    );
  }
  const wrongSubmissionHost = readySnapshot();
  wrongSubmissionHost.links.submissionUrl = "https://example.com/submission";
  assert.equal(
    collectSubmissionFailures(wrongSubmissionHost).includes(
      "Missing verified HTTPS link: submissionUrl",
    ),
    true,
  );
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

test("public link probe rejects unsupported endpoints before external access", async () => {
  const result = await probePublicSubmissionLinks({
    liveUrl: "https://127.0.0.1",
    repositoryUrl: "https://example.com/not-public",
  });
  assert.equal(result.valid, false);
  assert.equal(result.liveStatusCode, null);
  assert.equal(result.repositoryHead, null);
  assert.equal(result.failures.some((failure) => failure.includes("IP address is not public")), true);
  assert.equal(
    result.failures.some((failure) => failure.includes("supported anonymous Git host")),
    true,
  );
});

test("public link probe classifies public and reserved addresses deterministically", () => {
  for (const address of [
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2001:2::1",
    "2001:20::1",
    "2002::1",
    "3fff::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "192.0.3.1",
    "198.51.101.1",
    "203.0.114.1",
    "2001:4860:4860::8888",
  ]) {
    assert.equal(isPublicIpAddress(address), true, address);
  }
});

test("public repository probe environment cannot discover a parent Git repository", () => {
  const parent = mkdtempSync(join(tmpdir(), "policytwin-parent-git-"));
  try {
    const initialized = spawnSync("git", ["init", "--quiet"], {
      cwd: parent,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    const directory = mkdtempSync(join(parent, "nested-probe-"));
    const emptyConfigPath = join(directory, "empty.gitconfig");
    writeFileSync(emptyConfigPath, "", "utf8");
    const environment = gitProbeEnvironment(directory, emptyConfigPath);
    assert.equal(environment.GIT_CEILING_DIRECTORIES, parent);
    const discovered = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: directory,
      encoding: "utf8",
      env: environment,
      shell: false,
      windowsHide: true,
    });
    assert.notEqual(discovered.status, 0, discovered.stdout);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
