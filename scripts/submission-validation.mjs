export function collectSubmissionFailures(snapshot) {
  const failures = [...snapshot.fileFailures];
  for (const key of ["liveUrl", "repositoryUrl", "videoUrl", "submissionUrl"]) {
    if (typeof snapshot.links[key] !== "string" || !snapshot.links[key].startsWith("https://")) {
      failures.push(`Missing verified HTTPS link: ${key}`);
    }
  }
  if (
    snapshot.state.status !== "SUBMITTED" &&
    snapshot.state.status !== "READY_FOR_OWNER_ACTION"
  ) {
    failures.push("Submission state is not final.");
  }
  if (!snapshot.state.confirmation) {
    failures.push("Submission confirmation evidence is absent.");
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
  if (snapshot.containerStatus !== "PASS") {
    failures.push("Container health evidence is not passing.");
  }
  return [...new Set(failures)].sort();
}
