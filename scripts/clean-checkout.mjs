import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { ROOT, executable } from "./process.mjs";

const cleanBase = resolve(tmpdir());
const cleanRoot = resolve(cleanBase, "policytwin-clean-checkout");
const reportDirectory = resolve(ROOT, "artifacts", "security");
if (dirname(cleanRoot) !== cleanBase || relative(cleanBase, cleanRoot).startsWith("..")) {
  throw new Error(`Refusing to replace unexpected clean-copy path: ${cleanRoot}`);
}

function safeEnvironment() {
  const localOpaPath = resolve(
    ROOT,
    ".tools",
    "opa",
    "1.18.2",
    process.platform === "win32" ? "opa.exe" : "opa",
  );
  return {
    ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        typeof value === "string" && !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PASSWORD)/iu.test(key),
    ),
    ),
    POLICYTWIN_CLEAN_CHECK: "1",
    ...(existsSync(localOpaPath) ? { OPA_PATH: localOpaPath } : {}),
  };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: cleanRoot,
    env: safeEnvironment(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
  });
  return {
    command: [command.replace(/\.cmd$/iu, ""), ...args].join(" "),
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr || result.error?.message || "",
  };
}

const list = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
if (list.status !== 0) {
  throw new Error(`Unable to enumerate clean-copy files: ${list.stderr}`);
}
const files = list.stdout.split("\0").filter(Boolean).sort();
rmSync(cleanRoot, { recursive: true, force: true });
mkdirSync(cleanRoot, { recursive: true });
for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized) || normalized.includes("../")) {
    throw new Error(`Unsafe clean-copy path: ${file}`);
  }
  const source = resolve(ROOT, normalized);
  const destination = resolve(cleanRoot, normalized);
  if (relative(ROOT, source).startsWith("..") || relative(cleanRoot, destination).startsWith("..")) {
    throw new Error(`Clean-copy path escaped its root: ${file}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { force: false, errorOnExist: true });
}
const inProgressReportPath = resolve(
  cleanRoot,
  "artifacts",
  "security",
  "clean-checkout-report.json",
);
mkdirSync(dirname(inProgressReportPath), { recursive: true });
writeFileSync(
  inProgressReportPath,
  `${JSON.stringify({ schemaVersion: "1", status: "IN_PROGRESS", commands: [] }, null, 2)}\n`,
  "utf8",
);

const pnpm = executable("pnpm");
const commands = [
  [pnpm, ["install", "--offline", "--frozen-lockfile"]],
  [pnpm, ["submission:draft"]],
  [pnpm, ["submission:draft:check"]],
  [pnpm, ["lint"]],
  [pnpm, ["typecheck"]],
  [pnpm, ["test"]],
  [pnpm, ["test:integration"]],
  [pnpm, ["evidence:offline"]],
  [pnpm, ["submission:draft"]],
  [pnpm, ["submission:draft:check"]],
  [pnpm, ["eval"]],
  [pnpm, ["build"]],
  [pnpm, ["test:e2e"]],
  [pnpm, ["demo:reset"]],
  [pnpm, ["demo:run"]],
];
const results = [];
for (const [command, args] of commands) {
  const result = run(command, args);
  results.push({ command: result.command, exitCode: result.exitCode });
  if (result.exitCode !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    break;
  }
}
const failures = results.filter((result) => result.exitCode !== 0);
const report = {
  schemaVersion: "1",
  status: failures.length === 0 && results.length === commands.length ? "PASS" : "FAIL",
  copiedFiles: files.length,
  sourceIncludedNodeModules: files.some((file) => file.replaceAll("\\", "/").startsWith("node_modules/")),
  credentialVariablesForwarded: Object.keys(safeEnvironment()).filter((key) =>
    /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PASSWORD)/iu.test(key),
  ),
  commands: results,
};
mkdirSync(reportDirectory, { recursive: true });
writeFileSync(resolve(reportDirectory, "clean-checkout-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
rmSync(cleanRoot, { recursive: true, force: true });
if (report.status !== "PASS") {
  process.exit(1);
}
console.log(`Clean-copy reproduction passed with ${files.length} source files.`);
