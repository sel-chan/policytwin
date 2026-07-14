import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./process.mjs";
import { collectSubmissionFailures } from "./submission-validation.mjs";

const submissionDirectory = resolve(ROOT, "artifacts", "submission");
const demoDirectory = resolve(ROOT, "artifacts", "demo");
const requiredSubmission = [
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
];
const requiredDemoDrafts = ["demo-script.md", "shot-list.md", "captions.srt", "demo-data.json"];
const requiredScreenshots = [
  "01-policy-studio.png",
  "02-decision-queue.png",
  "03-case-lab-drift.png",
  "04-codex-repair.png",
  "05-proof.png",
  "06-change-impact.png",
  "07-mobile-or-responsive.png",
  "08-architecture.png",
];
const fileFailures = [];

function requireFile(directory, name) {
  const path = resolve(directory, name);
  if (!existsSync(path)) {
    fileFailures.push(`Missing required file: ${name}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

const submissionTexts = new Map(
  requiredSubmission.map((name) => [name, requireFile(submissionDirectory, name)]),
);
for (const name of requiredDemoDrafts) {
  requireFile(demoDirectory, name);
}
for (const name of requiredScreenshots) {
  if (!existsSync(resolve(ROOT, "artifacts", "screenshots", name))) {
    fileFailures.push(`Missing screenshot: ${name}`);
  }
}
if (!existsSync(resolve(demoDirectory, "policytwin-demo.mp4"))) {
  fileFailures.push("Missing final demo video file.");
}

for (const [name, text] of submissionTexts) {
  if (text?.includes("DRAFT_NOT_READY")) {
    fileFailures.push(`Draft marker remains: ${name}`);
  }
  if (text && /[A-Za-z]:\\Users\\|\/(?:home|Users)\//u.test(text)) {
    fileFailures.push(`Personal path appears in submission artifact: ${name}`);
  }
  if (text && /(?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET)[ \t]*[=:][ \t]*[^\r\n\s]+/iu.test(text)) {
    fileFailures.push(`Credential-shaped value appears in submission artifact: ${name}`);
  }
}

function parseJson(name) {
  const text = submissionTexts.get(name);
  if (text === null || text === undefined) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    fileFailures.push(`Invalid JSON: ${name}`);
    return {};
  }
}

const links = parseJson("links.json");
const state = parseJson("submission-state.json");
const rules = submissionTexts.get("rules-check.md") ?? "";
const evidence = JSON.parse(
  readFileSync(resolve(ROOT, "artifacts", "evidence", "verification-summary.json"), "utf8"),
);
const security = JSON.parse(
  readFileSync(resolve(ROOT, "artifacts", "security", "security-report.json"), "utf8"),
);
const container = JSON.parse(
  readFileSync(resolve(ROOT, "artifacts", "security", "container-report.json"), "utf8"),
);
const uniqueFailures = collectSubmissionFailures({
  fileFailures,
  links,
  state,
  rulesVerified: !rules.includes("UNVERIFIED") && !rules.includes("NOT_RUN"),
  evidence,
  licensePresent: existsSync(resolve(ROOT, "LICENSE")),
  securityStatus: security.status,
  containerStatus: container.status,
});
const report = {
  schemaVersion: "1",
  status: uniqueFailures.length === 0 ? "PASS" : "FAIL",
  checkedSubmissionFiles: requiredSubmission.length,
  checkedDemoDraftFiles: requiredDemoDrafts.length,
  requiredScreenshots: requiredScreenshots.length,
  failures: uniqueFailures,
};
mkdirSync(submissionDirectory, { recursive: true });
writeFileSync(
  resolve(submissionDirectory, "submission-check-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
if (uniqueFailures.length > 0) {
  console.error(`Submission check is fail-closed with ${uniqueFailures.length} unmet requirement(s).`);
  for (const failure of uniqueFailures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log("Submission package static checks passed.");
