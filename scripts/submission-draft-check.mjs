import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./process.mjs";

const REQUIRED_SUBMISSION_FILES = [
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
  "submission-check-report.json",
];
const REQUIRED_DEMO_FILES = ["demo-script.md", "shot-list.md", "captions.srt", "demo-data.json"];
const JSON_SUBMISSION_FILES = new Set([
  "links.json",
  "submission-state.json",
  "submission-check-report.json",
]);
const SECRET_OR_PERSONAL_PATH =
  /(?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET)[ \t]*[=:][ \t]*[^\r\n\s]+|[A-Za-z]:\\Users\\|\/(?:home|Users)\//iu;

function readManagedFile(directory, name, failures) {
  const path = resolve(directory, name);
  const managedRelativePath = relative(directory, path);
  if (
    managedRelativePath.length === 0 ||
    isAbsolute(managedRelativePath) ||
    managedRelativePath.startsWith("..")
  ) {
    failures.push(`Draft path escapes its managed directory: ${name}`);
    return null;
  }
  if (!existsSync(path)) {
    failures.push(`Missing draft file: ${name}`);
    return null;
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    failures.push(`Draft entry must be a regular file: ${name}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

function parseJson(text, name, failures) {
  if (text === null) return {};
  try {
    return JSON.parse(text);
  } catch {
    failures.push(`Invalid draft JSON: ${name}`);
    return {};
  }
}

function requireExactFileSet(directory, expected, label, failures) {
  if (!existsSync(directory)) {
    failures.push(`${label} draft directory is absent.`);
    return false;
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    failures.push(`${label} draft directory must be a plain managed directory.`);
    return false;
  }
  const actual = readdirSync(directory).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    failures.push(`${label} draft directory contains a missing or unexpected entry.`);
  }
  return true;
}

export function inspectCaptionTimeline(captions) {
  if (typeof captions !== "string" || captions.length === 0 || captions.length > 1_048_576) {
    return null;
  }
  const normalized = captions.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) return null;
  const trimmed = normalized.trim();
  if (trimmed.length === 0) return null;
  const blocks = trimmed.split(/\n{2,}/u);
  const timestampPattern =
    /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/u;

  function milliseconds(parts) {
    const [hours, minutes, seconds, millisecondsPart] = parts.map(Number);
    if (minutes > 59 || seconds > 59 || millisecondsPart > 999) return null;
    return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + millisecondsPart;
  }

  let previousEnd = 0;
  let maximumEnd = 0;
  let firstStart = null;
  let coveredMilliseconds = 0;
  let maximumGapMilliseconds = 0;
  for (const [index, block] of blocks.entries()) {
    const lines = block.split("\n");
    if (lines.length < 3 || lines[0] !== String(index + 1)) return null;
    const match = timestampPattern.exec(lines[1]);
    if (!match || lines.slice(2).join("\n").trim().length === 0) return null;
    const start = milliseconds(match.slice(1, 5));
    const end = milliseconds(match.slice(5, 9));
    if (start === null || end === null || end <= start || start < previousEnd) return null;
    if (firstStart === null) firstStart = start;
    maximumGapMilliseconds = Math.max(maximumGapMilliseconds, start - previousEnd);
    coveredMilliseconds += end - start;
    previousEnd = end;
    maximumEnd = Math.max(maximumEnd, end);
  }
  return {
    cueCount: blocks.length,
    firstStartMilliseconds: firstStart,
    endMilliseconds: maximumEnd,
    coveredMilliseconds,
    maximumGapMilliseconds,
  };
}

export function captionEndMilliseconds(captions) {
  return inspectCaptionTimeline(captions)?.endMilliseconds ?? null;
}

export function inspectSubmissionDraft(root = ROOT) {
  const failures = [];
  const submissionDirectory = resolve(root, "artifacts", "submission-draft");
  const demoDirectory = resolve(root, "artifacts", "demo-draft");
  const submissionDirectoryReady = requireExactFileSet(
    submissionDirectory,
    REQUIRED_SUBMISSION_FILES,
    "Submission",
    failures,
  );
  const demoDirectoryReady = requireExactFileSet(
    demoDirectory,
    REQUIRED_DEMO_FILES,
    "Demo",
    failures,
  );

  const submissionTexts = new Map(
    REQUIRED_SUBMISSION_FILES.map((name) => [
      name,
      submissionDirectoryReady ? readManagedFile(submissionDirectory, name, failures) : null,
    ]),
  );
  const demoTexts = new Map(
    REQUIRED_DEMO_FILES.map((name) => [
      name,
      demoDirectoryReady ? readManagedFile(demoDirectory, name, failures) : null,
    ]),
  );

  for (const [name, text] of [...submissionTexts, ...demoTexts]) {
    if (text && SECRET_OR_PERSONAL_PATH.test(text)) {
      failures.push(`Sensitive value or personal path appears in draft: ${name}`);
    }
    SECRET_OR_PERSONAL_PATH.lastIndex = 0;
    if (text && /\bUNSET\b/u.test(text)) {
      failures.push(`UNSET placeholder appears in draft: ${name}`);
    }
  }
  for (const [name, text] of submissionTexts) {
    if (!JSON_SUBMISSION_FILES.has(name) && !text?.includes("DRAFT_NOT_READY")) {
      failures.push(`Truthful draft marker is absent: ${name}`);
    }
  }
  for (const [name, text] of demoTexts) {
    if (name !== "demo-data.json" && !text?.includes("DRAFT")) {
      failures.push(`Demo draft marker is absent: ${name}`);
    }
  }

  const links = parseJson(submissionTexts.get("links.json"), "links.json", failures);
  if (links.schemaVersion !== "1" || links.status !== "NOT_READY") {
    failures.push("Draft links state must remain NOT_READY schema v1.");
  }
  for (const key of [
    "liveUrl",
    "repositoryUrl",
    "videoUrl",
    "submissionUrl",
    "feedbackSessionId",
  ]) {
    if (!(key in links) || links[key] !== null) {
      failures.push(`Draft link field must be explicitly null: ${key}`);
    }
  }

  const state = parseJson(
    submissionTexts.get("submission-state.json"),
    "submission-state.json",
    failures,
  );
  const report = parseJson(
    submissionTexts.get("submission-check-report.json"),
    "submission-check-report.json",
    failures,
  );
  const demoData = parseJson(demoTexts.get("demo-data.json"), "demo-data.json", failures);
  const manifest = parseJson(
    readManagedFile(resolve(root, "artifacts", "evidence"), "evidence-manifest.json", failures),
    "evidence-manifest.json",
    failures,
  );
  const verification = parseJson(
    readManagedFile(
      resolve(root, "artifacts", "evidence"),
      "verification-summary.json",
      failures,
    ),
    "verification-summary.json",
    failures,
  );
  const security = parseJson(
    readManagedFile(resolve(root, "artifacts", "security"), "security-report.json", failures),
    "security-report.json",
    failures,
  );
  const clean = parseJson(
    readManagedFile(
      resolve(root, "artifacts", "security"),
      "clean-checkout-report.json",
      failures,
    ),
    "clean-checkout-report.json",
    failures,
  );
  const challengeRules = parseJson(
    readManagedFile(resolve(root, "config"), "build-week-rules.v1.json", failures),
    "build-week-rules.v1.json",
    failures,
  );
  const rulesCheck = submissionTexts.get("rules-check.md") ?? "";
  if (
    !rulesCheck.includes(`Status: ${challengeRules.status}`) ||
    !rulesCheck.includes(`Checked at: ${challengeRules.checkedAt}`)
  ) {
    failures.push("Draft rules check does not match the verified rules snapshot.");
  }
  if (
    state.schemaVersion !== "1" ||
    state.status !== "NOT_READY" ||
    state.confirmation !== null ||
    state.ownerAction !== null ||
    state.evidenceHash !== manifest.evidenceHash ||
    state.evidenceStatus !== verification.status ||
    state.staticSecurityStatus !== security.status ||
    state.cleanCopyStatus !== clean.status ||
    state.rulesStatus !== challengeRules.status
  ) {
    failures.push("Draft submission state is stale or overclaims readiness.");
  }
  if (
    report.schemaVersion !== "1" ||
    report.status !== "NOT_RUN" ||
    report.checkedSubmissionFiles !== 20 ||
    report.checkedDemoDraftFiles !== 4 ||
    report.requiredScreenshots !== 8 ||
    !Array.isArray(report.failures) ||
    report.failures.length === 0
  ) {
    failures.push("Draft checker report must remain an explicit NOT_RUN placeholder.");
  }
  if (
    demoData.schemaVersion !== "1" ||
    demoData.status !== "DRAFT_NOT_RECORDED" ||
    demoData.evidenceHash !== manifest.evidenceHash ||
    demoData.postRepairDrift !== null
  ) {
    failures.push("Demo draft data is stale or overclaims a recorded repair.");
  }
  const captions = demoTexts.get("captions.srt") ?? "";
  const finalCaptionEnd = captionEndMilliseconds(captions);
  if (finalCaptionEnd !== 175_000 || finalCaptionEnd >= 180_000) {
    failures.push("Demo draft captions must end at 02:55, strictly below three minutes.");
  }
  if (!(demoTexts.get("demo-script.md") ?? "").includes("2:42–2:55")) {
    failures.push("Demo draft script must target a 02:55 finish.");
  }

  return [...new Set(failures)].sort();
}

const currentScript = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentScript === fileURLToPath(import.meta.url)) {
  const failures = inspectSubmissionDraft();
  if (failures.length > 0) {
    console.error(`Submission draft check failed with ${failures.length} issue(s).`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Isolated submission and demo drafts are truthful, current, and under three minutes.");
}
