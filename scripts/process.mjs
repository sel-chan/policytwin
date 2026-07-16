import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function executable(name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const localExecutable = resolve(ROOT, "node_modules", ".bin", `${name}${suffix}`);

  return existsSync(localExecutable) ? localExecutable : `${name}${suffix}`;
}

export function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    // Windows cannot launch npm-generated .cmd shims directly through
    // CreateProcess. Callers pass only repository-owned command names and
    // fixed arguments; untrusted product input must never reach this helper.
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

export function runOrExit(command, args) {
  const status = run(command, args);
  if (status !== 0) {
    process.exit(status);
  }
}
