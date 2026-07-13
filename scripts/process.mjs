import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
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
