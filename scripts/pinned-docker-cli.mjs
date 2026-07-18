import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_BYTES = 8_192;
const SHA256 = /^[0-9a-f]{64}$/u;
const SIMPLE_COMMANDS = new Set([
  "build",
  "cp",
  "create",
  "exec",
  "info",
  "logs",
  "port",
  "ps",
  "rm",
  "start",
  "stop",
  "wait",
]);
const SUBCOMMANDS = {
  container: new Set(["inspect"]),
  image: new Set(["inspect", "ls", "rm"]),
  network: new Set(["connect", "create", "disconnect", "inspect", "ls", "rm"]),
  volume: new Set(["create", "inspect", "ls", "rm"]),
};

export function exactDockerEnvironment(source) {
  const localDaemonHost = process.platform === "win32"
    ? "npipe:////./pipe/docker_engine"
    : "unix:///var/run/docker.sock";
  const result = {
    NODE_ENV: "production",
    DOCKER_HOST: localDaemonHost,
    DOCKER_CLI_HINTS: "false",
  };
  for (const name of [
    "SystemRoot",
    "COMSPEC",
    "ComSpec",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
  ]) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  return result;
}

export function assertDynamicDockerArguments(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > MAX_ARGUMENTS) {
    throw new Error("The dynamic Docker argument count is invalid.");
  }
  for (const argument of args) {
    if (
      typeof argument !== "string" ||
      argument.length < 1 ||
      Buffer.byteLength(argument, "utf8") > MAX_ARGUMENT_BYTES ||
      /[\0\r\n]/u.test(argument)
    ) {
      throw new Error("The dynamic Docker argument list is unsafe.");
    }
  }
  const [command, subcommand] = args;
  const allowed =
    SIMPLE_COMMANDS.has(command) ||
    (SUBCOMMANDS[command]?.has(subcommand) ?? false);
  if (!allowed) throw new Error("The dynamic Docker command is not allowlisted.");
}

function assertBinaryDockerArguments(args) {
  assertDynamicDockerArguments(args);
  const source = args?.[1] ?? "";
  const separator = source.indexOf(":");
  const containerId = separator < 0 ? "" : source.slice(0, separator);
  const containerPath = separator < 0 ? "" : source.slice(separator + 1);
  if (
    args.length !== 3 ||
    args[0] !== "cp" ||
    args[2] !== "-" ||
    !/^[0-9a-f]{64}$/u.test(containerId) ||
    !/^\/[A-Za-z0-9._/-]+$/u.test(containerPath) ||
    containerPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Binary Docker output is restricted to one owned-container copy.");
  }
}

export function createPinnedDockerSync(options) {
  if (
    typeof options?.repositoryRoot !== "string" ||
    !isAbsolute(options.repositoryRoot) ||
    typeof options?.dockerExecutablePath !== "string" ||
    !isAbsolute(options.dockerExecutablePath) ||
    !SHA256.test(options?.dockerExecutableSha256 ?? "")
  ) {
    throw new Error(
      "Dynamic Docker requires absolute repository and CLI paths plus a reviewed CLI SHA-256.",
    );
  }
  const repositoryRoot = resolve(options.repositoryRoot);
  const repositoryStat = lstatSync(repositoryRoot);
  if (
    !repositoryStat.isDirectory() ||
    repositoryStat.isSymbolicLink() ||
    realpathSync.native(repositoryRoot) !== repositoryRoot
  ) {
    throw new Error("The dynamic Docker repository root is unsafe.");
  }
  const dockerExecutablePath = resolve(options.dockerExecutablePath);
  const expectedDockerExecutableSha256 = options.dockerExecutableSha256;
  function assertReviewedDockerExecutable() {
    const executableStat = lstatSync(dockerExecutablePath);
    if (
      !executableStat.isFile() ||
      executableStat.isSymbolicLink() ||
      realpathSync.native(dockerExecutablePath) !== dockerExecutablePath
    ) {
      throw new Error("The dynamic Docker CLI path is unsafe.");
    }
    const observedSha256 = createHash("sha256")
      .update(readFileSync(dockerExecutablePath))
      .digest("hex");
    if (observedSha256 !== expectedDockerExecutableSha256) {
      throw new Error("The dynamic Docker CLI does not match the reviewed SHA-256.");
    }
  }
  assertReviewedDockerExecutable();
  const environment = exactDockerEnvironment(options.environment ?? process.env);
  function executeDocker(args, timeoutMs, allowFailure, binary) {
    assertDynamicDockerArguments(args);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60_000) {
      throw new Error("The dynamic Docker timeout is invalid.");
    }
    assertReviewedDockerExecutable();
    const result = spawnSync(dockerExecutablePath, args, {
      cwd: repositoryRoot,
      env: environment,
      encoding: binary ? null : "utf8",
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    if (!allowFailure && (result.error !== undefined || result.status !== 0)) {
      throw new Error(`Docker ${args[0] ?? "command"} failed.`);
    }
    return result;
  }
  function docker(args, timeoutMs = 60_000, allowFailure = false) {
    return executeDocker(args, timeoutMs, allowFailure, false);
  }
  Object.defineProperty(docker, "binary", {
    configurable: false,
    enumerable: false,
    writable: false,
    value(args, timeoutMs = 60_000) {
      assertBinaryDockerArguments(args);
      return executeDocker(args, timeoutMs, false, true);
    },
  });
  return Object.freeze(docker);
}
