import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "./process.mjs";
import { validateLocalChallengeDirectory } from "./local-challenge-contract.mjs";
import {
  acquireLocalChallengeRunLock,
  releaseLocalChallengeRunLock,
} from "./local-challenge-lock.mjs";
import {
  isAcceptableDevpostSubmissionUrl,
  localGitHeadArguments,
} from "./submission-validation.mjs";

const mode = process.argv[2] ?? "--local";
if (mode !== "--local" && mode !== "--release") {
  throw new Error("Usage: node scripts/challenge-submission-check.mjs --local|--release");
}

const submissionDirectory = resolve(ROOT, "artifacts", "challenge-submission");
const demoDirectory = resolve(ROOT, "artifacts", "demo");
const expectedSubmissionFiles = Object.freeze([
  "final-checklist.md",
  "how-we-built-it.md",
  "links.json",
  "long-description.md",
  "openai-and-codex-usage.md",
  "publication-receipt.json",
  "release-state.json",
  "short-description.txt",
  "tagline.txt",
  "testing-instructions.md",
  "title.txt",
]);
const forbiddenDraftMarkers = /DRAFT_NOT_READY|\bUNSET\b|\bLOREM\b|\bTODO\b/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, expected, label) {
  check(typeof value === "object" && value !== null && !Array.isArray(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  check(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} must contain exactly: ${wanted.join(", ")}.`,
  );
  return value;
}

function readRegular(path, label, maximumBytes = 2 * 1024 * 1024) {
  check(existsSync(path), `${label} is missing.`);
  const stat = lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular file.`);
  check(stat.size > 0 && stat.size <= maximumBytes, `${label} has an invalid size.`);
  return readFileSync(path);
}

function readText(path, label) {
  const text = readRegular(path, label).toString("utf8");
  check(!text.includes("\uFFFD"), `${label} contains a replacement character.`);
  return text;
}

function mediaExecutable(candidates, label) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0 || !existsSync(candidate)) continue;
    const stat = lstatSync(candidate);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0) return resolve(candidate);
  }
  throw new Error(`${label} executable is unavailable; set the documented media-tool path.`);
}

function runMedia(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  check(result.error === undefined && result.status === 0, `${label} failed.`);
  return result.stdout;
}

function parseJson(path, label) {
  return JSON.parse(readText(path, label));
}

function parseSrtTime(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/u.exec(value);
  check(match !== null, `Invalid SRT timestamp: ${value}.`);
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1_000 +
    Number(match[4])
  );
}

function validRepositoryUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "gitlab.com") &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function validYoutubeUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "youtu.be" ||
        url.hostname === "www.youtube.com" ||
        url.hostname === "youtube.com") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

const entries = readdirSync(submissionDirectory, { withFileTypes: true }).sort((left, right) =>
  left.name.localeCompare(right.name),
);
check(
  entries.length === expectedSubmissionFiles.length &&
    entries.every(
      (entry, index) =>
        entry.name === expectedSubmissionFiles[index] && entry.isFile() && !entry.isSymbolicLink(),
    ),
  "Challenge submission directory must contain the exact reviewed regular-file set.",
);

for (const name of expectedSubmissionFiles.filter((item) => !item.endsWith(".json"))) {
  const text = readText(resolve(submissionDirectory, name), `challenge submission ${name}`);
  check(!forbiddenDraftMarkers.test(text), `${name} contains a draft placeholder.`);
}

const title = readText(resolve(submissionDirectory, "title.txt"), "challenge title").trim();
const tagline = readText(resolve(submissionDirectory, "tagline.txt"), "challenge tagline").trim();
const shortDescription = readText(
  resolve(submissionDirectory, "short-description.txt"),
  "challenge short description",
).trim();
check(title === "PolicyTwin", "Challenge title is not the reviewed project name.");
check(tagline.length >= 20 && tagline.length <= 120, "Challenge tagline length is invalid.");
check(
  shortDescription.length >= 200 && shortDescription.length <= 1_000,
  "Challenge short description length is invalid.",
);

const links = exactKeys(
  parseJson(resolve(submissionDirectory, "links.json"), "challenge links"),
  ["feedbackSessionId", "repositoryUrl", "schemaVersion", "status", "submissionUrl", "videoUrl"],
  "challenge links",
);
check(links.schemaVersion === "1", "Challenge links schema version is invalid.");
check(sessionIdPattern.test(links.feedbackSessionId), "Codex /feedback session ID is malformed.");
check(
  links.repositoryUrl === null || validRepositoryUrl(links.repositoryUrl),
  "Repository URL must be null or a canonical HTTPS GitHub/GitLab project URL.",
);
check(
  links.videoUrl === null || validYoutubeUrl(links.videoUrl),
  "Video URL must be null or a public HTTPS YouTube URL.",
);
check(
  links.submissionUrl === null ||
    isAcceptableDevpostSubmissionUrl(links.submissionUrl),
  "Submission URL must be null or a canonical HTTPS Devpost URL.",
);

const manifest = exactKeys(
  parseJson(resolve(demoDirectory, "video-manifest.json"), "challenge video manifest"),
  [
    "audioCodec",
    "captionsFile",
    "captionsSha256",
    "claims",
    "durationMilliseconds",
    "fileName",
    "height",
    "narrationSha256",
    "profile",
    "schemaVersion",
    "sha256",
    "sizeBytes",
    "status",
    "videoCodec",
    "width",
  ],
  "challenge video manifest",
);
check(
  manifest.schemaVersion === "1" &&
    manifest.profile === "LOCAL_CHALLENGE_VIDEO" &&
    manifest.status === "VIDEO_READY",
  "Challenge video identity is invalid.",
);
check(
  manifest.fileName === "policytwin-demo.mp4" &&
    manifest.captionsFile === "captions.srt" &&
    sha256Pattern.test(manifest.sha256) &&
    sha256Pattern.test(manifest.captionsSha256) &&
    sha256Pattern.test(manifest.narrationSha256),
  "Challenge video manifest file binding is invalid.",
);
check(
  Number.isInteger(manifest.durationMilliseconds) &&
    manifest.durationMilliseconds >= 120_000 &&
    manifest.durationMilliseconds < 180_000 &&
    manifest.width === 1920 &&
    manifest.height === 1080 &&
    manifest.videoCodec === "h264" &&
    manifest.audioCodec === "aac",
  "Challenge video duration, dimensions, or codecs are invalid.",
);
const manifestClaims = exactKeys(
  manifest.claims,
  ["directResponsesApi", "productionIsolation", "productionVerifyLive"],
  "challenge video claims",
);
check(Object.values(manifestClaims).every((claim) => claim === false), "Video cannot promote production claims.");

const videoPath = resolve(demoDirectory, manifest.fileName);
const video = readRegular(videoPath, "challenge video", 64 * 1024 * 1024);
check(video.byteLength === manifest.sizeBytes, "Challenge video size does not match its manifest.");
check(
  createHash("sha256").update(video).digest("hex") === manifest.sha256,
  "Challenge video SHA-256 does not match its manifest.",
);
const ffprobe = mediaExecutable(
  [
    process.env.POLICYTWIN_FFPROBE_PATH,
    "C:/Program Files/DownloadHelper CoApp/ffprobe.exe",
    "C:/Program Files/net.downloadhelper.coapp/converter/build/win/64/ffprobe.exe",
  ],
  "ffprobe",
);
const ffmpeg = mediaExecutable(
  [
    process.env.POLICYTWIN_FFMPEG_PATH,
    "C:/Program Files/DownloadHelper CoApp/ffmpeg.exe",
    "C:/Program Files/net.downloadhelper.coapp/converter/build/win/64/ffmpeg.exe",
  ],
  "ffmpeg",
);
const mediaProbe = JSON.parse(
  runMedia(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels",
      "-of",
      "json",
      videoPath,
    ],
    "Challenge video probe",
  ),
);
const probedVideo = mediaProbe.streams?.find((stream) => stream.codec_type === "video");
const probedAudio = mediaProbe.streams?.find((stream) => stream.codec_type === "audio");
check(
  Number(mediaProbe.format?.duration) * 1_000 === manifest.durationMilliseconds &&
    Number(mediaProbe.format?.size) === manifest.sizeBytes &&
    probedVideo?.codec_name === manifest.videoCodec &&
    probedVideo?.width === manifest.width &&
    probedVideo?.height === manifest.height &&
    probedAudio?.codec_name === manifest.audioCodec &&
    probedAudio?.sample_rate === "48000" &&
    probedAudio?.channels === 2,
  "Actual challenge media streams do not match the reviewed manifest.",
);
runMedia(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-f",
    "null",
    process.platform === "win32" ? "NUL" : "/dev/null",
  ],
  "Challenge video decode",
);

const captions = readText(resolve(demoDirectory, manifest.captionsFile), "challenge captions");
check(
  createHash("sha256").update(captions, "utf8").digest("hex") === manifest.captionsSha256,
  "Challenge caption SHA-256 does not match the rendered-video manifest.",
);
const narrationBytes = readRegular(resolve(demoDirectory, "narration.json"), "challenge narration");
check(
  createHash("sha256").update(narrationBytes).digest("hex") === manifest.narrationSha256,
  "Challenge narration SHA-256 does not match the rendered-video manifest.",
);
const narration = exactKeys(
  JSON.parse(narrationBytes.toString("utf8")),
  ["rate", "schemaVersion", "segments", "totalDurationMilliseconds", "voice"],
  "challenge narration",
);
check(
  narration.schemaVersion === "1" &&
    narration.totalDurationMilliseconds === manifest.durationMilliseconds &&
    Array.isArray(narration.segments) &&
    narration.segments.length === 8,
  "Challenge narration timeline is invalid.",
);
const captionBlocks = captions.trim().split(/\r?\n\r?\n/u);
check(captionBlocks.length === 8, "Challenge captions must contain exactly eight blocks.");
const timingRows = [...captions.matchAll(/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/gmu)];
check(timingRows.length === 8, "Challenge captions must contain exactly eight timed cues.");
let expectedCueStart = 0;
for (const [index, row] of timingRows.entries()) {
  const start = parseSrtTime(row[1]);
  const end = parseSrtTime(row[2]);
  check(start === expectedCueStart && end > start, `Challenge caption cue ${index + 1} is not contiguous.`);
  const narrationSegment = exactKeys(
    narration.segments[index],
    ["endMilliseconds", "id", "startMilliseconds", "text"],
    `challenge narration segment ${index + 1}`,
  );
  const captionLines = captionBlocks[index].split(/\r?\n/u);
  check(
    captionLines[0] === String(index + 1) &&
      captionLines.slice(2).join(" ") === narrationSegment.text &&
      narrationSegment.id === index + 1 &&
      narrationSegment.startMilliseconds === start &&
      narrationSegment.endMilliseconds === end,
    `Challenge narration and caption cue ${index + 1} do not match.`,
  );
  expectedCueStart = end;
}
check(expectedCueStart === manifest.durationMilliseconds, "Challenge captions do not cover the full video.");

const releaseState = exactKeys(
  parseJson(resolve(submissionDirectory, "release-state.json"), "challenge release state"),
  [
    "claims",
    "deadline",
    "localVideo",
    "officialRulesCheckedAt",
    "requiredOwnerActions",
    "schemaVersion",
    "status",
  ],
  "challenge release state",
);
check(releaseState.schemaVersion === "1", "Challenge release-state schema is invalid.");
check(Date.parse(releaseState.officialRulesCheckedAt) <= Date.now(), "Official rules timestamp is future-dated.");
check(Date.parse(releaseState.deadline) > Date.parse(releaseState.officialRulesCheckedAt), "Challenge deadline is invalid.");
const localVideo = exactKeys(
  releaseState.localVideo,
  ["audio", "durationMilliseconds", "height", "path", "sha256", "width"],
  "challenge release local video",
);
check(
  localVideo.path === "artifacts/demo/policytwin-demo.mp4" &&
    localVideo.sha256 === manifest.sha256 &&
    localVideo.durationMilliseconds === manifest.durationMilliseconds &&
    localVideo.audio === true &&
    localVideo.width === manifest.width &&
    localVideo.height === manifest.height,
  "Challenge release state is not bound to the reviewed local video.",
);
const releaseClaims = exactKeys(
  releaseState.claims,
  ["deploymentVerified", "directResponsesApi", "productionIsolation", "productionVerifyLive"],
  "challenge release claims",
);
check(Object.values(releaseClaims).every((claim) => claim === false), "Release state cannot promote production claims.");
check(Array.isArray(releaseState.requiredOwnerActions), "Required owner actions must be an array.");

const publicationReceipt = exactKeys(
  parseJson(resolve(submissionDirectory, "publication-receipt.json"), "publication receipt"),
  [
    "audioReviewed",
    "localVideoSha256",
    "repositoryAnonymousRead",
    "repositoryUrl",
    "schemaVersion",
    "status",
    "verifiedAt",
    "videoAnonymousPlayback",
    "videoUrl",
  ],
  "publication receipt",
);
check(
  publicationReceipt.schemaVersion === "1" &&
    publicationReceipt.localVideoSha256 === manifest.sha256,
  "Publication receipt is not bound to the reviewed local video.",
);

const readme = readText(resolve(ROOT, "README.md"), "README");
for (const required of [
  "019f5dcf-0233-7a80-9147-af10c7bbfb28",
  "artifacts/challenge-submission",
  "pnpm challenge:submission:check",
  "pnpm demo:run",
]) {
  check(readme.includes(required), `README is missing the challenge handoff marker: ${required}.`);
}

const releaseErrors = [];
if (!validRepositoryUrl(links.repositoryUrl)) releaseErrors.push("Publish the repository and set repositoryUrl.");
if (!validYoutubeUrl(links.videoUrl)) releaseErrors.push("Upload the exact MP4 to public YouTube and set videoUrl.");
const licensePath = resolve(ROOT, "LICENSE");
if (!existsSync(licensePath) || readRegular(licensePath, "project LICENSE", 128 * 1024).byteLength < 100) {
  releaseErrors.push("Select and add the project LICENSE.");
}
let localChallengeEvidenceValid = false;
const challengeEvidenceLock = acquireLocalChallengeRunLock(ROOT);
try {
  try {
    validateLocalChallengeDirectory(resolve(ROOT, "artifacts", "challenge-evidence"));
    localChallengeEvidenceValid = true;
  } catch {
    localChallengeEvidenceValid = false;
  }
  if (!localChallengeEvidenceValid) {
    releaseErrors.push("Run and validate the approved GPT-5.6 local challenge evidence.");
  }

if (mode === "--release") {
  check(releaseErrors.length === 0, `Challenge release is not ready: ${releaseErrors.join(" ")}`);
  const publicEntryRecorded =
    links.status === "PUBLIC_ENTRY_VERIFIED" &&
    releaseState.status === "PUBLIC_ENTRY_VERIFIED";
  check(
    publicEntryRecorded ||
      (links.status === "READY_FOR_DEVPOST" && releaseState.status === "READY_FOR_DEVPOST"),
    "Release state must be READY_FOR_DEVPOST or PUBLIC_ENTRY_VERIFIED.",
  );
  if (publicEntryRecorded) {
    check(
      JSON.stringify(releaseState.requiredOwnerActions) ===
        JSON.stringify(["CAPTURE_DEVPOST_CONFIRMATION"]),
      "A public-entry release must leave only the strict confirmation-capture action.",
    );
    check(
      isAcceptableDevpostSubmissionUrl(links.submissionUrl),
      "A public-entry release requires its canonical Devpost URL.",
    );
  } else {
    check(
      JSON.stringify(releaseState.requiredOwnerActions) === JSON.stringify(["SUBMIT_ON_DEVPOST"]),
      "A ready release must leave exactly the owner-only Devpost submission action.",
    );
  }
  check(
    publicationReceipt.status === "PUBLISHED_AND_REVIEWED" &&
      publicationReceipt.repositoryUrl === links.repositoryUrl &&
      publicationReceipt.videoUrl === links.videoUrl &&
      publicationReceipt.repositoryAnonymousRead === true &&
      publicationReceipt.videoAnonymousPlayback === true &&
      publicationReceipt.audioReviewed === true &&
      typeof publicationReceipt.verifiedAt === "string" &&
      Number.isFinite(Date.parse(publicationReceipt.verifiedAt)) &&
      Date.now() - Date.parse(publicationReceipt.verifiedAt) >= 0 &&
      Date.now() - Date.parse(publicationReceipt.verifiedAt) <= 48 * 60 * 60_000,
    "Release publication receipt must be fresh, URL-bound, anonymous-access reviewed, and audio reviewed.",
  );
  const repositoryProbeDirectory = mkdtempSync(join(tmpdir(), "policytwin-challenge-probe-"));
  let gitProbe;
  try {
    gitProbe = spawnSync(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.askPass=",
        "ls-remote",
        "--exit-code",
        links.repositoryUrl,
        "HEAD",
      ],
      {
        cwd: repositoryProbeDirectory,
        env: {
          PATH: process.env.PATH ?? "",
          SYSTEMROOT: process.env.SYSTEMROOT ?? "",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
        },
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 20_000,
      },
    );
  } finally {
    rmSync(repositoryProbeDirectory, { recursive: true, force: true });
  }
  check(gitProbe.error === undefined && gitProbe.status === 0, "Public repository HEAD probe failed.");
  const localHead = spawnSync("git", localGitHeadArguments(ROOT), {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  });
  check(
    localHead.error === undefined &&
      localHead.status === 0 &&
      gitProbe.stdout.trim().split(/\s+/u)[0] === localHead.stdout.trim(),
    "Public repository HEAD does not match the reviewed local commit.",
  );
  const oembed = new URL("https://www.youtube.com/oembed");
  oembed.searchParams.set("url", links.videoUrl);
  oembed.searchParams.set("format", "json");
  const videoProbe = await fetch(oembed, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "PolicyTwin challenge release verifier" },
  });
  check(videoProbe.ok, "Public YouTube oEmbed probe failed.");
  if (publicEntryRecorded) {
    const submissionProbe = await fetch(links.submissionUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "PolicyTwin challenge release verifier" },
    });
    check(submissionProbe.ok, "Public Devpost entry probe failed.");
    const submissionBody = await submissionProbe.text();
    check(
      Buffer.byteLength(submissionBody, "utf8") <= 2 * 1024 * 1024 &&
        /PolicyTwin/u.test(submissionBody) &&
        /OpenAI Build Week/u.test(submissionBody),
      "Public Devpost entry does not match PolicyTwin and OpenAI Build Week.",
    );
  }
  console.log(
    `Challenge submission release metadata: ${publicEntryRecorded ? "PUBLIC_ENTRY_VERIFIED" : "READY_FOR_DEVPOST"}.`,
  );
} else {
  const publicEntryRecorded =
    links.status === "PUBLIC_ENTRY_VERIFIED" &&
    releaseState.status === "PUBLIC_ENTRY_VERIFIED" &&
    isAcceptableDevpostSubmissionUrl(links.submissionUrl) &&
    JSON.stringify(releaseState.requiredOwnerActions) ===
      JSON.stringify(["CAPTURE_DEVPOST_CONFIRMATION"]);
  check(
    publicEntryRecorded ||
      (links.status === "PENDING_EXTERNAL_LINKS" &&
        releaseState.status === "LOCAL_PACKAGE_READY_EXTERNAL_ACTIONS"),
    "Local challenge package state is inconsistent.",
  );
  console.log(
    JSON.stringify(
      {
        status: publicEntryRecorded
          ? "PUBLIC_ENTRY_VERIFIED_CONFIRMATION_ARTIFACT_PENDING"
          : "LOCAL_PACKAGE_READY_EXTERNAL_ACTIONS",
        feedbackSessionId: links.feedbackSessionId,
        videoSha256: manifest.sha256,
        durationMilliseconds: manifest.durationMilliseconds,
        remaining: publicEntryRecorded
          ? ["Capture the strict Devpost confirmation artifact for the production submission ledger."]
          : releaseErrors,
      },
      null,
      2,
    ),
  );
  }
} finally {
  releaseLocalChallengeRunLock(challengeEvidenceLock);
}
