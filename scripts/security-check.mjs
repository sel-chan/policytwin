import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { ROOT } from "./process.mjs";

const REPORT_DIRECTORY = resolve(ROOT, "artifacts", "security");
const REPORT_PATH = resolve(REPORT_DIRECTORY, "security-report.json");
const TEXT_EXTENSIONS = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".rego",
  ".srt",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const ALLOWED_CHILD_PROCESS_FILES = new Set([
  "fixtures/refund-demo/baseline/tests/refund.test.mjs",
  "scripts/clean-checkout.mjs",
  "scripts/container-check.mjs",
  "scripts/process.mjs",
  "scripts/repair-command.mjs",
  "scripts/security-check.mjs",
  "src/opa/runner.ts",
  "tests/integration/refund-fixture.integration.test.mjs",
]);
const TEST_SECRET_SENTINELS = new Set([
  "secret-value-123456789",
  "json-secret",
  "bearer-secret",
  "must-not-pass",
  "[REDACTED]",
  "must-not-pass\"",
]);
const CREDENTIAL_ASSIGNMENT =
  /["']?[A-Za-z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PASSWORD)[A-Za-z0-9_]*["']?[ \t]*[=:][ \t]*["']?([^"'\r\n\s,;}]*)/giu;
const PRIVATE_KEY = /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/gu;
const PERSONAL_PATH = /[A-Za-z]:\\Users\\[^\\\s]+|\/(?:home|Users)\/[^/\s]+/gu;

function git(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function normalizePath(path) {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe repository path: ${path}`);
  }
  return normalized;
}

function credentialFindings(text, location) {
  const findings = [];
  for (const match of text.matchAll(CREDENTIAL_ASSIGNMENT)) {
    const value = match[1] ?? "";
    if (value.length > 0 && !TEST_SECRET_SENTINELS.has(value)) {
      findings.push(`${location}: credential-shaped assignment`);
    }
  }
  if (PRIVATE_KEY.test(text)) {
    findings.push(`${location}: private-key material`);
  }
  PRIVATE_KEY.lastIndex = 0;
  return findings;
}

const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  .split("\0")
  .filter(Boolean)
  .map(normalizePath)
  .sort();
const findings = [];
let scannedTextFiles = 0;
for (const file of files) {
  if (file === ".env" || (/^\.env\./u.test(file) && file !== ".env.example")) {
    findings.push(`${file}: tracked environment file`);
  }
  if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) {
    continue;
  }
  const absolute = resolve(ROOT, file);
  if (relative(ROOT, absolute).startsWith("..")) {
    findings.push(`${file}: escapes repository root`);
    continue;
  }
  if (!existsSync(absolute)) {
    findings.push(`${file}: tracked file is missing`);
    continue;
  }
  const text = readFileSync(absolute, "utf8");
  scannedTextFiles += 1;
  findings.push(...credentialFindings(text, file));
  for (const pathMatch of text.matchAll(PERSONAL_PATH)) {
    const value = pathMatch[0];
    const isRedactionTest =
      file === "tests/unit/codex-worker-contract.test.mjs" && value.includes("Users\\alice");
    if (!isRedactionTest && file !== "scripts/security-check.mjs") {
      findings.push(`${file}: absolute personal path`);
    }
  }
  if (text.includes('from "node:child_process"') && !ALLOWED_CHILD_PROCESS_FILES.has(file)) {
    findings.push(`${file}: unreviewed child_process import`);
  }
  if (/\beval\s*\(|new\s+Function\s*\(/u.test(text)) {
    findings.push(`${file}: dynamic code execution`);
  }
}

const commits = git(["rev-list", "--all"]).split(/\r?\n/u).filter(Boolean);
const historyCandidatePattern =
  "API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PASSWORD|PRIVATE KEY|Users[/\\\\]|/home/";
for (const commit of commits) {
  const candidates = spawnSync(
    "git",
    ["grep", "-I", "-l", "-E", historyCandidatePattern, commit, "--"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  if (candidates.status !== 0 && candidates.status !== 1) {
    throw new Error(`Unable to scan Git history at ${commit.slice(0, 8)}.`);
  }
  for (const specification of candidates.stdout.split(/\r?\n/u).filter(Boolean)) {
    const separator = specification.indexOf(":");
    const file = separator >= 0 ? specification.slice(separator + 1) : specification;
    const content = spawnSync("git", ["show", specification], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    if (content.status !== 0) {
      throw new Error(`Unable to inspect Git history file ${file}.`);
    }
    findings.push(...credentialFindings(content.stdout, `git-history:${file}`));
    for (const pathMatch of content.stdout.matchAll(PERSONAL_PATH)) {
      const isRedactionTest =
        file === "tests/unit/codex-worker-contract.test.mjs" &&
        pathMatch[0].includes("Users\\alice");
      const isScannerPattern = file === "scripts/security-check.mjs";
      if (!isRedactionTest && !isScannerPattern) {
        findings.push(`git-history:${file}: absolute personal path`);
      }
    }
  }
}

const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const productionDependencies = Object.keys(packageJson.dependencies ?? {});
const uniqueFindings = [...new Set(findings)].sort();
const report = {
  schemaVersion: "1",
  status: uniqueFindings.length === 0 ? "PASS" : "FAIL",
  scope: "OFFLINE_STATIC_NOT_RELEASE_REVIEW",
  scannedFiles: files.length,
  scannedTextFiles,
  gitHistoryScanned: true,
  productionDependencyCount: productionDependencies.length,
  reviewedChildProcessFiles: [...ALLOWED_CHILD_PROCESS_FILES].sort(),
  findings: uniqueFindings,
};
mkdirSync(REPORT_DIRECTORY, { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (uniqueFindings.length > 0) {
  console.error(`Offline security check failed with ${uniqueFindings.length} finding(s).`);
  console.error(uniqueFindings.join("\n"));
  process.exit(1);
}
console.log(`Offline security check passed across ${scannedTextFiles} text files and Git history.`);
