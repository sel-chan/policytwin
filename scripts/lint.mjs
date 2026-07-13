import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { ROOT } from "./process.mjs";

const requiredScripts = [
  "dev",
  "lint",
  "typecheck",
  "test",
  "test:integration",
  "test:e2e",
  "eval",
  "build",
  "verify",
  "verify:live",
  "demo:reset",
  "demo:run",
  "submission:check",
];
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const checkedExtensions = new Set([".json", ".mjs", ".ts", ".yaml", ".yml"]);
const failures = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }

    if (!checkedExtensions.has(extname(entry.name))) {
      continue;
    }

    const text = readFileSync(path, "utf8");
    const relativePath = path.slice(ROOT.length).replaceAll("\\", "/");
    if (!text.endsWith("\n")) {
      failures.push(`${relativePath}: missing final newline`);
    }
    text.split("\n").forEach((line, index) => {
      if (/\s+$/.test(line)) {
        failures.push(`${relativePath}:${index + 1}: trailing whitespace`);
      }
      if (line.includes("\t")) {
        failures.push(`${relativePath}:${index + 1}: tab indentation`);
      }
    });
  }
}

const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
for (const script of requiredScripts) {
  if (typeof packageJson.scripts?.[script] !== "string") {
    failures.push(`package.json: missing required script ${script}`);
  }
}

const tsconfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8"));
if (tsconfig.compilerOptions?.strict !== true) {
  failures.push("tsconfig.json: compilerOptions.strict must be true");
}

visit(ROOT);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("M0 static checks passed.");
