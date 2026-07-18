export const RULES_MAX_AGE_MILLISECONDS = 48 * 60 * 60 * 1_000;
const RULES_FUTURE_SKEW_MILLISECONDS = 5 * 60 * 1_000;
const READY_OWNER_ACTION = Object.freeze({
  id: "SUBMIT_ON_DEVPOST",
  remainingActions: 1,
});
const REQUIRED_OFFICIAL_RULE_URLS = Object.freeze([
  "https://openai.com/build-week/",
  "https://openai.devpost.com/",
  "https://openai.devpost.com/rules",
]);

export function isFreshOfficialRulesSnapshot(snapshot, now = Date.now()) {
  const nowMilliseconds = now instanceof Date ? now.getTime() : now;
  const checkedAtMilliseconds = Date.parse(snapshot?.checkedAt ?? "");
  return (
    Number.isFinite(nowMilliseconds) &&
    snapshot?.status === "VERIFIED_OFFICIAL_SOURCES" &&
    Array.isArray(snapshot.sources) &&
    snapshot.sources.length === REQUIRED_OFFICIAL_RULE_URLS.length &&
    new Set(snapshot.sources.map((source) => source?.url)).size ===
      REQUIRED_OFFICIAL_RULE_URLS.length &&
    REQUIRED_OFFICIAL_RULE_URLS.every((url) =>
      snapshot.sources.some((source) => source?.url === url && source.result === "VERIFIED"),
    ) &&
    Number.isFinite(checkedAtMilliseconds) &&
    checkedAtMilliseconds <= nowMilliseconds + RULES_FUTURE_SKEW_MILLISECONDS &&
    nowMilliseconds - checkedAtMilliseconds <= RULES_MAX_AGE_MILLISECONDS
  );
}

export function collectSubmissionFailures(snapshot) {
  const failures = [...snapshot.fileFailures];
  for (const key of ["liveUrl", "repositoryUrl"]) {
    if (!isAcceptableHttpsUrl(snapshot.links[key])) {
      failures.push(`Missing verified HTTPS link: ${key}`);
    }
  }
  if (!isAcceptableYoutubeUrl(snapshot.links.videoUrl)) {
    failures.push("Missing verified public YouTube link: videoUrl");
  }
  if (!isAcceptableFeedbackSessionId(snapshot.links.feedbackSessionId)) {
    failures.push("Missing valid /feedback Codex Session ID.");
  }
  if (snapshot.state.status === "SUBMITTED") {
    if (!isAcceptableDevpostSubmissionUrl(snapshot.links.submissionUrl)) {
      failures.push("Missing verified HTTPS link: submissionUrl");
    }
    if (!isExactSubmittedConfirmation(snapshot.state.confirmation)) {
      failures.push("Submission confirmation evidence is absent.");
    }
    if (snapshot.state.ownerAction !== null && snapshot.state.ownerAction !== undefined) {
      failures.push("Submitted state must not retain an owner action.");
    }
  } else if (snapshot.state.status === "READY_FOR_OWNER_ACTION") {
    if (
      snapshot.links.submissionUrl !== null &&
      snapshot.links.submissionUrl !== undefined &&
      !isAcceptableDevpostSubmissionUrl(snapshot.links.submissionUrl)
    ) {
      failures.push("Invalid optional HTTPS link: submissionUrl");
    }
    if (snapshot.state.confirmation !== null) {
      failures.push("Ready-for-owner-action state must not claim submission confirmation.");
    }
    if (!isExactReadyOwnerAction(snapshot.state.ownerAction)) {
      failures.push("Ready-for-owner-action state must identify exactly one Devpost submission action.");
    }
  } else {
    if (!isAcceptableDevpostSubmissionUrl(snapshot.links.submissionUrl)) {
      failures.push("Missing verified HTTPS link: submissionUrl");
    }
    failures.push("Submission state is not final.");
    if (!snapshot.state.confirmation) {
      failures.push("Submission confirmation evidence is absent.");
    }
  }
  if (!snapshot.rulesVerified) {
    failures.push("Official rules have not been verified.");
  }
  if (snapshot.evidence.status !== "PASS" || snapshot.evidence.evidenceMode !== "LIVE_VERIFIED") {
    failures.push("Evidence package is not live verified PASS.");
  }
  if (!snapshot.licensePresent) {
    failures.push("Project LICENSE is absent.");
  }
  if (snapshot.securityStatus !== "PASS") {
    failures.push("Offline security check is not passing.");
  }
  if (snapshot.state.staticSecurityStatus !== snapshot.securityStatus) {
    failures.push("Submission state security status is stale.");
  }
  if (snapshot.state.cleanCopyStatus !== snapshot.cleanCopyStatus) {
    failures.push("Submission state clean-copy status is stale.");
  }
  if (snapshot.state.evidenceStatus !== snapshot.evidence.status) {
    failures.push("Submission state evidence status is stale.");
  }
  if (snapshot.state.evidenceHash !== snapshot.evidence.evidenceHash) {
    failures.push("Submission state evidence hash is stale.");
  }
  if (snapshot.state.rulesStatus !== snapshot.rulesStatus) {
    failures.push("Submission state rules status is stale.");
  }
  if (snapshot.containerStatus !== "PASS") {
    failures.push("Container health evidence is not passing.");
  }
  return [...new Set(failures)].sort();
}

function isExactSubmittedConfirmation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "file" &&
    keys[1] === "type" &&
    value.type === "DEVPOST_SUBMISSION_CONFIRMATION" &&
    value.file === "submission-confirmation.json"
  );
}

function isExactReadyOwnerAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "id" &&
    keys[1] === "remainingActions" &&
    value.id === READY_OWNER_ACTION.id &&
    value.remainingActions === READY_OWNER_ACTION.remainingActions
  );
}

function isAcceptableHttpsUrl(value) {
  if (typeof value !== "string" || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hostname.length > 0 &&
      !/^(?:localhost|127(?:\.[0-9]{1,3}){3}|\[?::1\]?)$/iu.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function isAcceptableYoutubeUrl(value) {
  if (!isAcceptableHttpsUrl(value)) return false;
  const url = new URL(value);
  if (url.hostname === "youtu.be") {
    return /^\/[A-Za-z0-9_-]{6,64}$/u.test(url.pathname);
  }
  if (url.hostname !== "youtube.com" && url.hostname !== "www.youtube.com") return false;
  if (url.pathname === "/watch") return /^[A-Za-z0-9_-]{6,64}$/u.test(url.searchParams.get("v") ?? "");
  return /^\/(?:shorts|live)\/[A-Za-z0-9_-]{6,64}$/u.test(url.pathname);
}

function isAcceptableDevpostSubmissionUrl(value) {
  if (!isAcceptableHttpsUrl(value)) return false;
  const url = new URL(value);
  return (
    (url.hostname === "devpost.com" || url.hostname.endsWith(".devpost.com")) &&
    url.pathname.length > 1
  );
}

function isAcceptableFeedbackSessionId(value) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
