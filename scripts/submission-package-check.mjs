import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { collectOfflineVerifyReceiptFailures } from "./offline-verify-receipt.mjs";
import { ROOT } from "./process.mjs";
import { collectSubmissionClaimFailures } from "./submission-claim-validation.mjs";
import { inspectCaptionTimeline } from "./submission-draft-check.mjs";
import {
  MAX_MP4_BYTES,
  MAX_PNG_BYTES,
  inspectMp4,
  inspectPng,
} from "./submission-media-validation.mjs";
import {
  collectSubmissionFailures,
  isFreshOfficialRulesSnapshot,
} from "./submission-validation.mjs";
import { probeMp4WithChrome } from "./submission-video-probe.mjs";
import { probePublicSubmissionLinks } from "./submission-publication-probe.mjs";
import { validateSubmissionEvidence } from "./submission-evidence-validation.mjs";

export const REQUIRED_SUBMISSION_FILES = Object.freeze([
  "title.txt",
  "tagline.txt",
  "short-description.txt",
  "long-description.md",
  "inspiration.md",
  "what-it-does.md",
  "how-we-built-it.md",
  "challenges.md",
  "accomplishments.md",
  "learnings.md",
  "whats-next.md",
  "technologies.txt",
  "openai-and-codex-usage.md",
  "judging-evidence-map.md",
  "links.json",
  "screenshots.md",
  "rules-check.md",
  "claim-audit.md",
  "final-checklist.md",
  "submission-state.json",
]);
export const REQUIRED_DEMO_TEXT_FILES = Object.freeze([
  "demo-script.md",
  "shot-list.md",
  "captions.srt",
  "demo-data.json",
  "video-publication-receipt.json",
]);
export const REQUIRED_SCREENSHOTS = Object.freeze([
  "01-policy-studio.png",
  "02-decision-queue.png",
  "03-case-lab-drift.png",
  "04-codex-repair.png",
  "05-proof.png",
  "06-change-impact.png",
  "07-mobile-or-responsive.png",
  "08-architecture.png",
]);
const ALLOWED_SUBMISSION_FILES = new Set([
  ...REQUIRED_SUBMISSION_FILES,
  "submission-check-report.json",
  "submission-confirmation.png",
  "submission-confirmation.json",
]);
const ALLOWED_DEMO_FILES = new Set([...REQUIRED_DEMO_TEXT_FILES, "policytwin-demo.mp4"]);
const ALLOWED_SCREENSHOT_FILES = new Set([
  ...REQUIRED_SCREENSHOTS,
  "04-integration-drift.png",
]);
const MINIMUM_DEMO_DURATION_MILLISECONDS = 120_000;
const MAXIMUM_CAPTION_TAIL_GAP_MILLISECONDS = 15_000;
const MAXIMUM_INTER_CAPTION_GAP_MILLISECONDS = 20_000;
const SECRET_OR_PERSONAL_PATH =
  /(?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET)[ \t]*[=:][ \t]*[^\r\n\s]+|[A-Za-z]:\\Users\\|\/(?:home|Users)\//iu;

function isPlainFile(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function requireExactDirectory(directory, allowed, label, failures) {
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      failures.push(`${label} staging path must be a plain directory.`);
      return false;
    }
    for (const entry of readdirSync(directory)) {
      if (!allowed.has(entry)) failures.push(`Unexpected ${label} staging entry: ${entry}`);
      if (!isPlainFile(resolve(directory, entry))) {
        failures.push(`${label} staging entry must be a plain regular file: ${entry}`);
      }
    }
    return true;
  } catch {
    failures.push(`${label} staging directory is absent.`);
    return false;
  }
}

function requireTextFile(directory, name, label, failures) {
  const path = resolve(directory, name);
  if (!isPlainFile(path)) {
    failures.push(`Missing or non-regular ${label} file: ${name}`);
    return null;
  }
  try {
    const text = readFileSync(path, "utf8");
    if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
      failures.push(`${label} text file exceeds the size limit: ${name}`);
      return null;
    }
    return text;
  } catch {
    failures.push(`Unable to read ${label} file: ${name}`);
    return null;
  }
}

function parseJsonText(text, name, failures) {
  if (text === null) return {};
  try {
    return JSON.parse(text);
  } catch {
    failures.push(`Invalid JSON: ${name}`);
    return {};
  }
}

function readJsonArtifact(root, relativePath, failures) {
  const path = resolve(root, relativePath);
  if (!isPlainFile(path)) {
    failures.push(`Missing proof input: ${relativePath}`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    failures.push(`Invalid proof JSON: ${relativePath}`);
    return {};
  }
}

function hasEvidenceMetrics(evidence) {
  return (
    Number.isInteger(evidence?.golden?.passed) &&
    Number.isInteger(evidence?.golden?.total) &&
    Number.isInteger(evidence?.generated?.passed) &&
    Number.isInteger(evidence?.generated?.total) &&
    Number.isInteger(evidence?.driftBefore) &&
    Number.isInteger(evidence?.mutation?.killed) &&
    Number.isInteger(evidence?.mutation?.total) &&
    Number.isFinite(evidence?.mutation?.killRate)
  );
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function isFreshReceiptTime(value, now) {
  const nowMilliseconds = now instanceof Date ? now.getTime() : now;
  const timestamp = Date.parse(value ?? "");
  return (
    Number.isFinite(nowMilliseconds) &&
    Number.isFinite(timestamp) &&
    timestamp <= nowMilliseconds + 5 * 60 * 1_000 &&
    nowMilliseconds - timestamp <= 48 * 60 * 60 * 1_000
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function scanText(name, text, label, failures) {
  if (text === null) return;
  if (
    /\bDRAFT_(?:NOT_RECORDED|NOT_READY)\b/iu.test(text) ||
    /^\s*(?:#\s*)?\[?DRAFT\s*(?:—|-|:)\s*(?:not recorded|not ready)\]?/imu.test(text)
  ) {
    failures.push(`Draft marker remains in ${label}: ${name}`);
  }
  if (/\bUNSET\b/u.test(text)) failures.push(`UNSET placeholder remains in ${label}: ${name}`);
  if (SECRET_OR_PERSONAL_PATH.test(text)) {
    failures.push(`Sensitive value or personal path appears in ${label}: ${name}`);
  }
}

function inspectReadmeImages(root, failures) {
  const readmePath = resolve(root, "README.md");
  if (!isPlainFile(readmePath)) {
    failures.push("README.md is absent.");
    return "";
  }
  const readme = readFileSync(readmePath, "utf8");
  for (const match of readme.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))/gu)) {
    const target = match[1] ?? match[2] ?? "";
    if (/^(?:https?:|data:)/iu.test(target) || target.startsWith("#")) continue;
    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(target);
    } catch {
      failures.push(`README image target is not valid URI text: ${target}`);
      continue;
    }
    const imagePath = resolve(root, decodedTarget);
    const imageRelativePath = relative(root, imagePath);
    if (
      imageRelativePath.length === 0 ||
      isAbsolute(imageRelativePath) ||
      imageRelativePath.startsWith("..") ||
      !isPlainFile(imagePath)
    ) {
      failures.push(`README references a missing or unmanaged image: ${target}`);
    }
  }
  return readme;
}

export async function inspectSubmissionPackage(
  root = ROOT,
  now = Date.now(),
  {
    probeVideo = probeMp4WithChrome,
    probePublicLinks = probePublicSubmissionLinks,
    validateEvidence = validateSubmissionEvidence,
    validateVerifyReceipt = collectOfflineVerifyReceiptFailures,
  } = {},
) {
  const fileFailures = [];
  const submissionDirectory = resolve(root, "artifacts", "submission");
  const demoDirectory = resolve(root, "artifacts", "demo");
  const screenshotDirectory = resolve(root, "artifacts", "screenshots");
  requireExactDirectory(submissionDirectory, ALLOWED_SUBMISSION_FILES, "submission", fileFailures);
  requireExactDirectory(demoDirectory, ALLOWED_DEMO_FILES, "demo", fileFailures);
  requireExactDirectory(
    screenshotDirectory,
    ALLOWED_SCREENSHOT_FILES,
    "screenshot",
    fileFailures,
  );

  const submissionTexts = new Map(
    REQUIRED_SUBMISSION_FILES.map((name) => [
      name,
      requireTextFile(submissionDirectory, name, "submission", fileFailures),
    ]),
  );
  const demoTexts = new Map(
    REQUIRED_DEMO_TEXT_FILES.map((name) => [
      name,
      requireTextFile(demoDirectory, name, "demo", fileFailures),
    ]),
  );
  for (const [name, text] of submissionTexts) scanText(name, text, "submission artifact", fileFailures);
  for (const [name, text] of demoTexts) scanText(name, text, "final demo artifact", fileFailures);

  const requiredScreenshotHashes = new Set();
  const reviewedScreenshotHashes = new Set();
  for (const name of ALLOWED_SCREENSHOT_FILES) {
    const path = resolve(screenshotDirectory, name);
    if (!isPlainFile(path)) {
      if (REQUIRED_SCREENSHOTS.includes(name)) fileFailures.push(`Missing screenshot: ${name}`);
      continue;
    }
    const screenshotStat = lstatSync(path);
    const result =
      screenshotStat.size <= MAX_PNG_BYTES
        ? inspectPng(readFileSync(path))
        : { valid: false, failures: ["PNG byte length is outside the allowed range."] };
    if (!result.valid) {
      fileFailures.push(`Invalid submission PNG ${name}: ${result.failures.join(" ")}`);
    } else {
      const screenshotHash = sha256(readFileSync(path));
      reviewedScreenshotHashes.add(screenshotHash);
      if (REQUIRED_SCREENSHOTS.includes(name)) {
        if (result.width < 320 || result.height < 320) {
          fileFailures.push(`Submission screenshot dimensions are too small: ${name}`);
        }
        requiredScreenshotHashes.add(screenshotHash);
      }
    }
  }
  if (requiredScreenshotHashes.size !== REQUIRED_SCREENSHOTS.length) {
    fileFailures.push("Required submission screenshots must be distinct reviewed captures.");
  }

  const demoVideoPath = resolve(demoDirectory, "policytwin-demo.mp4");
  let videoInspection = null;
  let videoBytes = null;
  if (!isPlainFile(demoVideoPath)) {
    fileFailures.push("Missing final demo video file.");
  } else {
    const videoStat = lstatSync(demoVideoPath);
    if (videoStat.size <= MAX_MP4_BYTES) videoBytes = readFileSync(demoVideoPath);
    videoInspection =
      videoBytes !== null
        ? inspectMp4(videoBytes)
        : { valid: false, failures: ["MP4 byte length is outside the allowed range."] };
    if (!videoInspection.valid) {
      fileFailures.push(`Invalid final demo MP4: ${videoInspection.failures.join(" ")}`);
    } else if (
      videoInspection.durationMilliseconds === null ||
      videoInspection.durationMilliseconds < MINIMUM_DEMO_DURATION_MILLISECONDS
    ) {
      fileFailures.push("Final demo video is too short to be the required substantive walkthrough.");
    } else {
      const decodedVideo = await probeVideo(demoVideoPath);
      if (!decodedVideo.valid) {
        fileFailures.push(`Undecodable final demo MP4: ${decodedVideo.failures.join(" ")}`);
      } else if (
        !Number.isInteger(decodedVideo.audioTrackCount) ||
        !Number.isInteger(decodedVideo.sampledFrameCount) ||
        !Number.isInteger(decodedVideo.distinctFrameCount) ||
        decodedVideo.audioTrackCount < 1 ||
        decodedVideo.sampledFrameCount < 3 ||
        decodedVideo.distinctFrameCount < 2
      ) {
        fileFailures.push(
          "Final demo must expose decoded audio and visually distinct frames across its timeline.",
        );
      } else if (decodedVideo.durationMilliseconds < MINIMUM_DEMO_DURATION_MILLISECONDS) {
        fileFailures.push("Chrome-observed final demo duration is shorter than two minutes.");
      } else if (
        videoInspection.durationMilliseconds !== null &&
        Math.abs(
          videoInspection.durationMilliseconds - decodedVideo.durationMilliseconds,
        ) > 1_000
      ) {
        fileFailures.push("MP4 declared duration and Chrome-observed duration differ by more than one second.");
      } else {
        videoInspection = { ...videoInspection, decodedVideo };
      }
    }
  }
  const captionTimeline = inspectCaptionTimeline(demoTexts.get("captions.srt") ?? "");
  const finalCaptionEnd = captionTimeline?.endMilliseconds ?? null;
  if (finalCaptionEnd === null || finalCaptionEnd <= 0 || finalCaptionEnd >= 180_000) {
    fileFailures.push("Final demo captions must be structurally valid and end strictly before three minutes.");
  } else if (
    videoInspection?.durationMilliseconds !== null &&
    videoInspection?.durationMilliseconds !== undefined &&
    (finalCaptionEnd > videoInspection.durationMilliseconds + 1_000 ||
      videoInspection.durationMilliseconds - finalCaptionEnd >
        MAXIMUM_CAPTION_TAIL_GAP_MILLISECONDS)
  ) {
    fileFailures.push("Final demo captions are not synchronized with the local video duration.");
  }
  if (
    captionTimeline === null ||
    captionTimeline.cueCount < 8 ||
    captionTimeline.firstStartMilliseconds > 5_000 ||
    captionTimeline.maximumGapMilliseconds > MAXIMUM_INTER_CAPTION_GAP_MILLISECONDS ||
    (videoInspection?.durationMilliseconds !== null &&
      videoInspection?.durationMilliseconds !== undefined &&
      captionTimeline.coveredMilliseconds < videoInspection.durationMilliseconds * 0.6)
  ) {
    fileFailures.push("Final demo captions do not provide substantive timeline coverage.");
  }

  const links = parseJsonText(submissionTexts.get("links.json"), "links.json", fileFailures);
  const state = parseJsonText(
    submissionTexts.get("submission-state.json"),
    "submission-state.json",
    fileFailures,
  );
  const demoData = parseJsonText(demoTexts.get("demo-data.json"), "demo-data.json", fileFailures);
  const videoReceipt = parseJsonText(
    demoTexts.get("video-publication-receipt.json"),
    "video-publication-receipt.json",
    fileFailures,
  );
  if (
    links.schemaVersion !== "1" ||
    !exactKeys(links, [
      "schemaVersion",
      "status",
      "liveUrl",
      "repositoryUrl",
      "videoUrl",
      "submissionUrl",
      "feedbackSessionId",
    ])
  ) {
    fileFailures.push("Submission links schema is invalid or open.");
  }
  if (
    state.schemaVersion !== "1" ||
    !exactKeys(state, [
      "schemaVersion",
      "status",
      "evidenceHash",
      "evidenceStatus",
      "staticSecurityStatus",
      "cleanCopyStatus",
      "rulesStatus",
      "confirmation",
      "ownerAction",
    ])
  ) {
    fileFailures.push("Submission state schema is invalid or open.");
  }
  if (links.status !== state.status) {
    fileFailures.push("Submission links and state statuses disagree.");
  }

  let checkedPublicLinks = false;
  if (
    ["SUBMITTED", "READY_FOR_OWNER_ACTION"].includes(state.status) &&
    typeof links.liveUrl === "string" &&
    typeof links.repositoryUrl === "string"
  ) {
    try {
      const observation = await probePublicLinks({
        liveUrl: links.liveUrl,
        repositoryUrl: links.repositoryUrl,
      });
      const liveOrigin = new URL(links.liveUrl).origin;
      checkedPublicLinks =
        observation?.valid === true &&
        observation.liveUrl === links.liveUrl &&
        typeof observation.liveFinalUrl === "string" &&
        new URL(observation.liveFinalUrl).origin === liveOrigin &&
        Number.isInteger(observation.liveStatusCode) &&
        observation.liveStatusCode >= 200 &&
        observation.liveStatusCode < 300 &&
        observation.repositoryUrl === links.repositoryUrl &&
        typeof observation.repositoryHead === "string" &&
        /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(observation.repositoryHead) &&
        observation.anonymousAccess === true &&
        Array.isArray(observation.failures) &&
        observation.failures.length === 0;
      if (!checkedPublicLinks) {
        fileFailures.push("Live and repository URLs are not anonymously reachable and verified.");
      }
    } catch (error) {
      fileFailures.push(
        `Public URL verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const rules = submissionTexts.get("rules-check.md") ?? "";
  let evidence = readJsonArtifact(
    root,
    "artifacts/evidence/verification-summary.json",
    fileFailures,
  );
  let validatedManifest = null;
  let validatedEvidenceFiles = null;
  try {
    const validatedEvidence = await validateEvidence(
      root,
      now instanceof Date ? now : new Date(now),
    );
    evidence = validatedEvidence.verification;
    validatedManifest = validatedEvidence.manifest;
    validatedEvidenceFiles = validatedEvidence.files;
  } catch (error) {
    fileFailures.push(
      `Authoritative evidence package validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const challengeRules = readJsonArtifact(root, "config/build-week-rules.v1.json", fileFailures);
  const security = readJsonArtifact(root, "artifacts/security/security-report.json", fileFailures);
  const clean = readJsonArtifact(
    root,
    "artifacts/security/clean-checkout-report.json",
    fileFailures,
  );
  const container = readJsonArtifact(root, "artifacts/security/container-report.json", fileFailures);
  const verifyReceipt = readJsonArtifact(
    root,
    "artifacts/security/offline-verify-report.json",
    fileFailures,
  );
  fileFailures.push(...validateVerifyReceipt(root, verifyReceipt, now));
  const readme = inspectReadmeImages(root, fileFailures);

  if (
    validatedManifest !== null &&
    (validatedManifest.packageStatus !== evidence.status ||
      validatedManifest.evidenceMode !== evidence.evidenceMode ||
      validatedManifest.evidenceHash !== evidence.evidenceHash)
  ) {
    fileFailures.push("Validated evidence manifest and verification summary disagree.");
  }
  if (evidence.status === "PASS" && evidence.evidenceMode === "LIVE_VERIFIED") {
    try {
      const deployment = JSON.parse(
        validatedEvidenceFiles?.get("deployment-run-summary.json") ?? "null",
      );
      if (deployment?.status !== "PASS" || deployment.url !== links.liveUrl) {
        fileFailures.push("Submission live URL does not match validated deployment evidence.");
      }
    } catch {
      fileFailures.push("Validated deployment evidence cannot be bound to the submission live URL.");
    }
  }

  const expectedCaseCount =
    Number.isInteger(evidence?.golden?.total) && Number.isInteger(evidence?.generated?.total)
      ? evidence.golden.total + evidence.generated.total
      : null;
  if (
    !exactKeys(demoData, [
      "schemaVersion",
      "status",
      "evidenceHash",
      "caseCount",
      "driftBefore",
      "postRepairDrift",
      "mutation",
    ]) ||
    demoData.schemaVersion !== "1" ||
    demoData.status !== "LIVE_VERIFIED" ||
    demoData.evidenceHash !== evidence.evidenceHash ||
    demoData.caseCount !== expectedCaseCount ||
    demoData.driftBefore !== evidence.driftBefore ||
    demoData.postRepairDrift !== evidence.driftAfter ||
    evidence.driftAfter !== 0 ||
    JSON.stringify(demoData.mutation) !== JSON.stringify(evidence.mutation)
  ) {
    fileFailures.push("Final demo data does not match the live verified evidence summary.");
  }

  const videoReceiptValid =
    exactKeys(videoReceipt, [
      "schemaVersion",
      "status",
      "platform",
      "videoUrl",
      "localFile",
      "localSha256",
      "durationMilliseconds",
      "checkedAt",
      "signedOutPlayback",
      "audioReviewed",
    ]) &&
    videoReceipt.schemaVersion === "1" &&
    videoReceipt.status === "VERIFIED_OWNER_REVIEWED" &&
    videoReceipt.platform === "YOUTUBE" &&
    videoReceipt.videoUrl === links.videoUrl &&
    videoReceipt.localFile === "policytwin-demo.mp4" &&
    videoBytes !== null &&
    videoReceipt.localSha256 === sha256(videoBytes) &&
    videoInspection?.decodedVideo?.valid === true &&
    videoInspection.decodedVideo.audioTrackCount >= 1 &&
    videoInspection.decodedVideo.sampledFrameCount >= 3 &&
    videoInspection.decodedVideo.distinctFrameCount >= 2 &&
    Number.isInteger(videoReceipt.durationMilliseconds) &&
    Math.abs(
      videoReceipt.durationMilliseconds -
        videoInspection.decodedVideo.durationMilliseconds,
    ) <= 1_000 &&
    isFreshReceiptTime(videoReceipt.checkedAt, now) &&
    videoReceipt.signedOutPlayback === true &&
    videoReceipt.audioReviewed === true;
  if (!videoReceiptValid) {
    fileFailures.push("YouTube publication receipt is missing, stale, unreviewed, or not bound to the local demo.");
  }

  const confirmationPngPath = resolve(submissionDirectory, "submission-confirmation.png");
  const confirmationManifestPath = resolve(
    submissionDirectory,
    "submission-confirmation.json",
  );
  let confirmationEvidenceValid = false;
  if (state.status === "SUBMITTED") {
    const confirmationManifest = isPlainFile(confirmationManifestPath)
      ? parseJsonText(
          readFileSync(confirmationManifestPath, "utf8"),
          "submission-confirmation.json",
          fileFailures,
        )
      : {};
    let confirmationPng = null;
    let confirmationPngValid = false;
    if (!isPlainFile(confirmationPngPath)) {
      fileFailures.push("Submitted state is missing submission-confirmation.png.");
    } else {
      const confirmationStat = lstatSync(confirmationPngPath);
      if (confirmationStat.size <= MAX_PNG_BYTES) {
        confirmationPng = readFileSync(confirmationPngPath);
        const confirmationInspection = inspectPng(confirmationPng);
        confirmationPngValid =
          confirmationInspection.valid &&
          confirmationInspection.width >= 640 &&
          confirmationInspection.height >= 360 &&
          !reviewedScreenshotHashes.has(sha256(confirmationPng));
        if (!confirmationInspection.valid) {
          fileFailures.push(
            `Invalid submission confirmation PNG: ${confirmationInspection.failures.join(" ")}`,
          );
        } else if (!confirmationPngValid) {
          fileFailures.push(
            "Submission confirmation PNG must be a distinct reviewed capture at least 640x360.",
          );
        }
      }
    }
    confirmationEvidenceValid =
      confirmationPngValid &&
      exactKeys(confirmationManifest, [
        "schemaVersion",
        "status",
        "submissionUrl",
        "confirmationId",
        "capturedAt",
        "screenshotFile",
        "screenshotSha256",
        "ownerReviewed",
      ]) &&
      confirmationManifest.schemaVersion === "1" &&
      confirmationManifest.status === "VERIFIED_OWNER_REVIEWED" &&
      confirmationManifest.submissionUrl === links.submissionUrl &&
      typeof confirmationManifest.confirmationId === "string" &&
      /^[A-Za-z0-9._-]{6,128}$/u.test(confirmationManifest.confirmationId) &&
      isFreshReceiptTime(confirmationManifest.capturedAt, now) &&
      confirmationManifest.screenshotFile === "submission-confirmation.png" &&
      confirmationPng !== null &&
      confirmationManifest.screenshotSha256 === sha256(confirmationPng) &&
      confirmationManifest.ownerReviewed === true;
    if (!confirmationEvidenceValid) {
      fileFailures.push("Submission confirmation manifest is missing, stale, unreviewed, or unbound.");
    }
  } else if (existsSync(confirmationPngPath) || existsSync(confirmationManifestPath)) {
    fileFailures.push("Non-submitted staging must not retain submission confirmation files.");
  }

  const allTexts = new Map([...submissionTexts, ...demoTexts, ["README.md", readme]]);
  if (hasEvidenceMetrics(evidence)) {
    fileFailures.push(...collectSubmissionClaimFailures(allTexts, evidence));
  } else {
    fileFailures.push("Verification summary lacks the metrics required for claim validation.");
  }
  const rulesVerified =
    isFreshOfficialRulesSnapshot(challengeRules, now) &&
    rules.includes(`Status: ${challengeRules.status}`) &&
    rules.includes(`Checked at: ${challengeRules.checkedAt}`) &&
    challengeRules.sources?.every((source) => rules.includes(source.url)) === true &&
    !rules.includes("UNVERIFIED") &&
    !rules.includes("NOT_RUN");
  const uniqueFailures = collectSubmissionFailures({
    fileFailures,
    links,
    state,
    rulesVerified,
    rulesStatus: challengeRules.status,
    evidence,
    licensePresent: isPlainFile(resolve(root, "LICENSE")),
    securityStatus: security.status,
    cleanCopyStatus: clean.status,
    containerStatus: container.status,
  });
  return {
    schemaVersion: "1",
    status: uniqueFailures.length === 0 ? "PASS" : "FAIL",
    checkedSubmissionFiles: REQUIRED_SUBMISSION_FILES.length,
    checkedDemoTextFiles: REQUIRED_DEMO_TEXT_FILES.length,
    checkedDemoVideo:
      videoInspection?.valid === true && videoInspection.decodedVideo?.valid === true,
    checkedConfirmationEvidence: confirmationEvidenceValid,
    checkedPublicLinks,
    requiredScreenshots: REQUIRED_SCREENSHOTS.length,
    failures: uniqueFailures,
  };
}
