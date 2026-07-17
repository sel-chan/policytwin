import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_BYTES = 8_192;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 15 * 60_000;
const privateDockerCliRunners = new WeakSet<object>();
const FORBIDDEN_OPTIONS = new Set([
  "--privileged",
  "--publish",
  "--publish-all",
  "--expose",
  "--env-file",
  "--device",
  "--device-cgroup-rule",
  "--volume",
  "--volumes-from",
  "--cap-add",
  "--userns",
  "--cgroupns",
  "--pid",
  "--ipc",
  "--uts",
  "--runtime",
  "--gpus",
  "--add-host",
  "--dns",
  "--dns-search",
  "--link",
  "--label-file",
  "--sysctl",
  "--workdir",
  "--opt",
  "--init",
  "--hostname",
  "--mac-address",
  "--ip",
  "--ip6",
  "--rm",
  "-e",
  "-v",
  "-w",
  "-p",
  "-P",
  "-o",
]);
const SIMPLE_COMMANDS = new Set([
  "create",
  "start",
  "wait",
  "logs",
  "stop",
  "rm",
  "port",
  "ps",
]);
const NETWORK_COMMANDS = new Set([
  "create",
  "inspect",
  "connect",
  "disconnect",
  "rm",
  "ls",
]);
const IMMUTABLE_IMAGE = /^sha256:[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BARRIER_TOKEN = /^[A-Za-z0-9_-]{43}$/u;

function optionValues(args: readonly string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === name) {
      const value = args[index + 1];
      if (value === undefined) throw new Error("The Docker option is missing its value.");
      values.push(value);
      index += 1;
    } else if (argument?.startsWith(`${name}=`)) {
      values.push(argument.slice(name.length + 1));
    }
  }
  return values;
}

function exactBarrierTarget(role: string, target: readonly string[]) {
  const hold = "--observation-hold-ms=5000";
  const allowlist: Readonly<Record<string, readonly (readonly string[])[]>> = {
    egress: [["node", "scripts/openai-egress-proxy.mjs"]],
    worker: [
      ["node", "scripts/worker-preflight.mjs", "--static-preflight"],
      ["node", "scripts/worker-preflight.mjs", "--static-preflight", hold],
      ["node", "scripts/worker-preflight.mjs", "--egress-tls-probe"],
      ["node", "scripts/worker-preflight.mjs", "--egress-tls-probe", hold],
      ["node", "scripts/worker-entrypoint.mjs", "--validate-only"],
    ],
    verifier: [
      ["node", "scripts/verifier-preflight.mjs", "--static-preflight"],
      ["node", "scripts/verifier-preflight.mjs", "--static-preflight", hold],
      ["node", "scripts/verifier-preflight.mjs", "--verify"],
      ["node", "scripts/verifier-preflight.mjs", "--verify", hold],
    ],
  };
  return (allowlist[role] ?? []).some(
    (candidate) =>
      candidate.length === target.length &&
      candidate.every((argument, index) => argument === target[index]),
  );
}

function parseMount(value: string) {
  const fields = value.split(",");
  const entries = new Map<string, string>();
  let readOnly = false;
  for (const field of fields) {
    if (field === "readonly") {
      if (readOnly) throw new Error("The Docker barrier invocation is invalid.");
      readOnly = true;
      continue;
    }
    const separator = field.indexOf("=");
    if (separator < 1) throw new Error("The Docker barrier invocation is invalid.");
    const key = field.slice(0, separator);
    const item = field.slice(separator + 1);
    if (item.length === 0 || entries.has(key)) {
      throw new Error("The Docker barrier invocation is invalid.");
    }
    entries.set(key, item);
  }
  return { entries, readOnly };
}

function assertDedicatedBarrierInvocation(args: readonly string[]) {
  const entrypoints = optionValues(args, "--entrypoint");
  if (entrypoints.length !== 1 || entrypoints[0] !== "node" || args[0] !== "create") {
    throw new Error("The Docker barrier invocation is invalid.");
  }
  const imageIndexes = args
    .map((argument, index) => (IMMUTABLE_IMAGE.test(argument) ? index : -1))
    .filter((index) => index >= 0);
  if (imageIndexes.length !== 1) {
    throw new Error("The Docker barrier invocation is invalid.");
  }
  const imageIndex = imageIndexes[0]!;
  const command = args.slice(imageIndex + 1);
  if (
    command[0] !== "scripts/role-start-barrier.mjs" ||
    command[1] !== "--" ||
    command.length < 4
  ) {
    throw new Error("The Docker barrier invocation is invalid.");
  }
  const environment = new Map<string, string>();
  for (const value of optionValues(args.slice(0, imageIndex), "--env")) {
    const separator = value.indexOf("=");
    const name = separator < 1 ? "" : value.slice(0, separator);
    if (name.length === 0 || environment.has(name)) {
      throw new Error("The Docker barrier invocation is invalid.");
    }
    environment.set(name, value.slice(separator + 1));
  }
  const role = environment.get("POLICYTWIN_START_BARRIER_ROLE") ?? "";
  const root = `/run/policytwin-start-barrier/${role}`;
  const holdTimeout = environment.get("POLICYTWIN_START_BARRIER_HOLD_TIMEOUT_MS") ?? "";
  const pollInterval = environment.get("POLICYTWIN_START_BARRIER_POLL_INTERVAL_MS") ?? "";
  if (
    environment.get("NODE_OPTIONS") !== "" ||
    environment.get("POLICYTWIN_START_BARRIER_MODE") !== "REQUIRED_V1" ||
    !BARRIER_TOKEN.test(environment.get("POLICYTWIN_START_BARRIER_ID") ?? "") ||
    !SHA256.test(environment.get("POLICYTWIN_START_BARRIER_RUN_BINDING_SHA256") ?? "") ||
    environment.get("POLICYTWIN_START_BARRIER_RECEIPT_DIRECTORY") !== `${root}/receipt` ||
    environment.get("POLICYTWIN_START_BARRIER_CONTROL_DIRECTORY") !== `${root}/control` ||
    !/^[1-9][0-9]{2,4}$/u.test(holdTimeout) ||
    !/^[1-9][0-9]{0,2}$/u.test(pollInterval) ||
    Number(pollInterval) >= Number(holdTimeout) ||
    !exactBarrierTarget(role, command.slice(2))
  ) {
    throw new Error("The Docker barrier invocation is invalid.");
  }
  const barrierMounts = optionValues(args.slice(0, imageIndex), "--mount")
    .map(parseMount)
    .filter(({ entries }) => entries.get("target")?.startsWith(`${root}/`) === true);
  const receipt = barrierMounts.filter(
    ({ entries }) => entries.get("target") === `${root}/receipt`,
  );
  const control = barrierMounts.filter(
    ({ entries }) => entries.get("target") === `${root}/control`,
  );
  if (
    barrierMounts.length !== 2 ||
    receipt.length !== 1 ||
    control.length !== 1 ||
    receipt[0]!.readOnly ||
    !control[0]!.readOnly ||
    receipt[0]!.entries.get("type") !== "bind" ||
    control[0]!.entries.get("type") !== "bind" ||
    receipt[0]!.entries.size !== 3 ||
    control[0]!.entries.size !== 3
  ) {
    throw new Error("The Docker barrier invocation is invalid.");
  }
}

export interface DockerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DockerCommandRunner {
  run(
    args: readonly string[],
    options: {
      signal: AbortSignal;
      timeoutMs: number;
      maximumOutputBytes?: number;
    },
  ): Promise<DockerCommandResult>;
}

export function assertPrivateDockerCliCommandRunner(
  value: unknown,
): asserts value is DockerCommandRunner {
  if (
    typeof value !== "object" ||
    value === null ||
    !privateDockerCliRunners.has(value)
  ) {
    throw new Error("The Docker runner was not issued by the private CLI factory.");
  }
}

export function assertSupervisorDockerArguments(args: readonly string[]): void {
  if (args.length < 1 || args.length > MAX_ARGUMENTS) {
    throw new Error("The Docker argument count is invalid.");
  }
  for (const argument of args) {
    if (
      typeof argument !== "string" ||
      argument.length < 1 ||
      Buffer.byteLength(argument, "utf8") > MAX_ARGUMENT_BYTES ||
      /[\0\r\n]/u.test(argument) ||
      argument.startsWith("__POLICYTWIN_") ||
      [...FORBIDDEN_OPTIONS].some(
        (option) => argument === option || argument.startsWith(`${option}=`),
      )
    ) {
      throw new Error("The Docker argument list is unsafe.");
    }
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];
    if (argument === undefined) {
      throw new Error("The Docker argument list is unsafe.");
    }
    const combinedShortOption = /^(?:-e|-v|-w|-p|-o).+/u.test(argument);
    const mountPayload =
      argument === "--mount"
        ? next
        : argument.startsWith("--mount=")
          ? argument.slice("--mount=".length)
          : undefined;
    if (
      combinedShortOption ||
      (argument === "--network" && next === "host") ||
      argument === "--network=host" ||
      argument === "--entrypoint" ||
      (argument.startsWith("--entrypoint=") && argument !== "--entrypoint=node") ||
      (argument === "--security-opt" && next !== "no-new-privileges:true") ||
      (argument.startsWith("--security-opt=") &&
        argument !== "--security-opt=no-new-privileges:true") ||
      (argument === "--cap-drop" && next !== "ALL") ||
      (argument.startsWith("--cap-drop=") && argument !== "--cap-drop=ALL") ||
      (argument === "--log-driver" && next !== "local") ||
      (argument.startsWith("--log-driver=") && argument !== "--log-driver=local") ||
      (argument === "--log-opt" &&
        !/^(?:max-size=[1-9][0-9]{5,7}|max-file=1)$/u.test(next ?? "")) ||
      (argument.startsWith("--log-opt=") &&
        !/^--log-opt=(?:max-size=[1-9][0-9]{5,7}|max-file=1)$/u.test(argument)) ||
      (argument === "--ulimit" &&
        !/^fsize=([1-9][0-9]{5,7}):\1$/u.test(next ?? "")) ||
      (argument.startsWith("--ulimit=") &&
        !/^--ulimit=fsize=([1-9][0-9]{5,7}):\1$/u.test(argument)) ||
      (argument === "--restart" && next !== "no") ||
      (argument.startsWith("--restart=") && argument !== "--restart=no") ||
      argument === "--read-only=false" ||
      (mountPayload !== undefined &&
        /(?:docker\.sock|docker_engine)/iu.test(mountPayload))
    ) {
      throw new Error("The Docker argument list weakens the supervisor boundary.");
    }
  }
  const [command, subcommand] = args;
  const allowed =
    (command !== undefined && SIMPLE_COMMANDS.has(command)) ||
    (command === "container" && subcommand === "inspect") ||
    (command === "network" && subcommand !== undefined && NETWORK_COMMANDS.has(subcommand));
  if (!allowed) throw new Error("The Docker command is not allowlisted.");
  if (args.some((argument) => argument.startsWith("--entrypoint="))) {
    assertDedicatedBarrierInvocation(args);
  }
}

function exactEnvironment(source: NodeJS.ProcessEnv, localDaemonHost: string): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "SystemRoot",
    "COMSPEC",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
  ] as const;
  const result: NodeJS.ProcessEnv = {
    NODE_ENV: source.NODE_ENV ?? "production",
    DOCKER_HOST: localDaemonHost,
  };
  for (const name of allowed) {
    const value = source[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

export function createDockerCliCommandRunner(options: {
  repositoryRoot: string;
  dockerExecutablePath: string;
  localDaemonHost: string;
  environment?: NodeJS.ProcessEnv;
}): DockerCommandRunner {
  if (!isAbsolute(options.repositoryRoot)) {
    throw new Error("The Docker runner repository root must be absolute.");
  }
  const repositoryRoot = resolve(options.repositoryRoot);
  const stat = lstatSync(repositoryRoot);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync.native(repositoryRoot) !== repositoryRoot
  ) {
    throw new Error("The Docker runner repository root is unsafe.");
  }
  if (!isAbsolute(options.dockerExecutablePath)) {
    throw new Error("The Docker executable path must be absolute.");
  }
  const dockerExecutablePath = resolve(options.dockerExecutablePath);
  const dockerExecutableStat = lstatSync(dockerExecutablePath);
  const executableName = basename(dockerExecutablePath).toLowerCase();
  if (
    !dockerExecutableStat.isFile() ||
    dockerExecutableStat.isSymbolicLink() ||
    realpathSync.native(dockerExecutablePath) !== dockerExecutablePath ||
    (executableName !== "docker" && executableName !== "docker.exe")
  ) {
    throw new Error("The Docker executable path is unsafe.");
  }
  const expectedLocalDaemonHost =
    process.platform === "win32"
      ? "npipe:////./pipe/docker_engine"
      : "unix:///var/run/docker.sock";
  if (options.localDaemonHost !== expectedLocalDaemonHost) {
    throw new Error("The Docker runner must use the platform local daemon endpoint.");
  }
  const environment = exactEnvironment(
    options.environment ?? process.env,
    options.localDaemonHost,
  );
  const runner: DockerCommandRunner = {
    async run(args, commandOptions) {
      assertSupervisorDockerArguments(args);
      if (
        !Number.isInteger(commandOptions.timeoutMs) ||
        commandOptions.timeoutMs < 1_000 ||
        commandOptions.timeoutMs > MAX_TIMEOUT_MS
      ) {
        throw new Error("The Docker command timeout is invalid.");
      }
      const maximumOutputBytes = commandOptions.maximumOutputBytes ?? 1024 * 1024;
      if (
        !Number.isInteger(maximumOutputBytes) ||
        maximumOutputBytes < 1_024 ||
        maximumOutputBytes > MAX_OUTPUT_BYTES
      ) {
        throw new Error("The Docker command output limit is invalid.");
      }
      if (commandOptions.signal.aborted) {
        throw commandOptions.signal.reason instanceof Error
          ? commandOptions.signal.reason
          : new Error("The Docker command was aborted.");
      }
      return await new Promise<DockerCommandResult>((resolvePromise, rejectPromise) => {
        const child = spawn(dockerExecutablePath, [...args], {
          cwd: repositoryRoot,
          env: environment,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let settled = false;
        let killTimer: NodeJS.Timeout | undefined;
        let pendingFailure: Error | undefined;

        const stopChild = (): void => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGTERM");
          killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
          killTimer.unref();
        };
        const cleanup = (): void => {
          clearTimeout(timeoutTimer);
          if (killTimer !== undefined) clearTimeout(killTimer);
          commandOptions.signal.removeEventListener("abort", onAbort);
        };
        const failAfterClose = (error: Error): void => {
          if (settled || pendingFailure !== undefined) return;
          pendingFailure = error;
          stopChild();
        };
        const onAbort = (): void => {
          failAfterClose(
            commandOptions.signal.reason instanceof Error
              ? commandOptions.signal.reason
              : new Error("The Docker command was aborted."),
          );
        };
        const capture = (target: Buffer[], chunk: Buffer | string): void => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          outputBytes += bytes.byteLength;
          if (outputBytes > maximumOutputBytes) {
            failAfterClose(new Error("The Docker command output exceeded its limit."));
            return;
          }
          target.push(bytes);
        };
        const timeoutTimer = setTimeout(
          () => failAfterClose(new Error("The Docker command timed out.")),
          commandOptions.timeoutMs,
        );
        commandOptions.signal.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
        child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
        child.once("error", () =>
          failAfterClose(new Error("The Docker command failed to start.")),
        );
        child.once("close", (code) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (pendingFailure !== undefined) {
            rejectPromise(pendingFailure);
            return;
          }
          if (!Number.isInteger(code)) {
            rejectPromise(new Error("The Docker command ended without an exit code."));
            return;
          }
          resolvePromise({
            exitCode: code as number,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        });
      });
    },
  };
  privateDockerCliRunners.add(runner);
  return runner;
}
