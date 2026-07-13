import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT, executable, runOrExit } from "./process.mjs";

export const BASELINE_FIXTURE = resolve(ROOT, "fixtures", "refund-demo", "baseline");
export const CURRENT_FIXTURE = resolve(ROOT, ".tmp", "refund-demo", "current");
export const CURRENT_BUILD = resolve(ROOT, ".tmp", "refund-demo", "current-dist");
const TRANSIENT_DIRECTORIES = new Set([".tmp", "dist", "node_modules"]);

function assertManagedPath(path, expected) {
  const resolved = resolve(path);
  if (resolved !== resolve(expected) || relative(ROOT, resolved).startsWith("..")) {
    throw new Error(`Refusing to mutate unmanaged path: ${resolved}`);
  }
}

export function directoryHash(directory) {
  const hash = createHash("sha256");

  function visit(path, prefix) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && TRANSIENT_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolutePath = join(path, entry.name);
      const relativePath = join(prefix, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        hash.update(relativePath);
        hash.update("\0");
        hash.update(readFileSync(absolutePath));
        hash.update("\0");
      }
    }
  }

  visit(directory, "");
  return hash.digest("hex");
}

export function resetFixture() {
  assertManagedPath(CURRENT_FIXTURE, resolve(ROOT, ".tmp", "refund-demo", "current"));
  const baselineHash = directoryHash(BASELINE_FIXTURE);
  rmSync(CURRENT_FIXTURE, { recursive: true, force: true });
  mkdirSync(resolve(CURRENT_FIXTURE, ".."), { recursive: true });
  cpSync(BASELINE_FIXTURE, CURRENT_FIXTURE, {
    recursive: true,
    errorOnExist: true,
    filter: (source) => !TRANSIENT_DIRECTORIES.has(source.split(/[\\/]/).at(-1)),
  });
  const currentHash = directoryHash(CURRENT_FIXTURE);
  if (currentHash !== baselineHash) {
    throw new Error("Reset copy does not match the canonical baseline hash.");
  }
  return { baselineHash, currentHash };
}

export function compileCurrentFixture() {
  assertManagedPath(CURRENT_BUILD, resolve(ROOT, ".tmp", "refund-demo", "current-dist"));
  rmSync(CURRENT_BUILD, { recursive: true, force: true });
  runOrExit(executable("tsc"), [
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--strict",
    "--outDir",
    ".tmp/refund-demo/current-dist",
    ".tmp/refund-demo/current/src/refund.ts",
  ]);
}
