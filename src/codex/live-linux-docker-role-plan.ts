import { isAbsolute } from "node:path";
import {
  type PrivateLinuxStartBarrierController,
  type PrivatePreparedLinuxStartBarrierRole,
  assertPrivatePreparedLinuxStartBarrierRole,
} from "./linux-start-barrier.js";
import type { LinuxCgroupHelperRole } from "./linux-cgroup-helper-protocol.js";
import {
  type SupervisorDockerLifecyclePlan,
  type SupervisorDockerProcessPlan,
  assertFactoryIssuedSupervisorDockerLifecyclePlan,
} from "./egress-runtime-contract.js";

const SHA256 = /^[0-9a-f]{64}$/u;
const IMAGE = /^sha256:[0-9a-f]{64}$/u;
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/u;
const BARRIER_ENVIRONMENT_NAMES = new Set([
  "NODE_OPTIONS",
  "POLICYTWIN_START_BARRIER_MODE",
  "POLICYTWIN_START_BARRIER_ROLE",
  "POLICYTWIN_START_BARRIER_ID",
  "POLICYTWIN_START_BARRIER_RUN_BINDING_SHA256",
  "POLICYTWIN_START_BARRIER_RECEIPT_DIRECTORY",
  "POLICYTWIN_START_BARRIER_CONTROL_DIRECTORY",
  "POLICYTWIN_START_BARRIER_HOLD_TIMEOUT_MS",
  "POLICYTWIN_START_BARRIER_POLL_INTERVAL_MS",
]);
const privateRolePlans = new WeakSet<object>();
const REQUIRED_BIND_MOUNTS: Readonly<
  Record<LinuxCgroupHelperRole, Readonly<Record<string, boolean>>>
> = Object.freeze({
  worker: Object.freeze({
    "/workspace": true,
    "/workspace/src/refund.ts": false,
    "/workspace/tests/refund.test.mjs": false,
    "/run/policytwin/request.json": true,
    "/run/policytwin/response.json": false,
    "/run/secrets/policytwin-proxy-token": true,
    "/run/secrets/policytwin-egress-ca.pem": true,
  }),
  verifier: Object.freeze({ "/fixture": true }),
  egress: Object.freeze({
    "/run/secrets/policytwin-egress-tls-cert.pem": true,
    "/run/secrets/policytwin-egress-tls-key.pem": true,
    "/run/secrets/policytwin-egress-lease.json": true,
    "/run/secrets/policytwin-openai-key": true,
  }),
});
const REQUIRED_TMPFS_MOUNTS: Readonly<
  Record<LinuxCgroupHelperRole, Readonly<Record<string, number>>>
> = Object.freeze({
  worker: Object.freeze({ "/worker-home": 67_108_864, "/tmp": 67_108_864 }),
  verifier: Object.freeze({ "/tmp": 67_108_864, "/fixture/dist": 67_108_864 }),
  egress: Object.freeze({ "/tmp": 16_777_216 }),
});
const ROLE_TARGETS: Readonly<Record<LinuxCgroupHelperRole, readonly string[]>> = Object.freeze({
  egress: Object.freeze(["node", "scripts/openai-egress-proxy.mjs"]),
  worker: Object.freeze(["node", "scripts/worker-entrypoint.mjs", "--validate-only"]),
  verifier: Object.freeze(["node", "scripts/verifier-preflight.mjs", "--verify"]),
});

export declare const PRIVATE_LIVE_LINUX_DOCKER_ROLE_PLAN: unique symbol;

export interface LiveLinuxBarrierDockerRolePlanInput {
  role: LinuxCgroupHelperRole;
  lifecyclePlan: SupervisorDockerLifecyclePlan;
  observedNetworkIds: Readonly<{ worker: string; outbound: string }>;
  preparedBarrier: PrivatePreparedLinuxStartBarrierRole;
}

export interface LiveLinuxBarrierDockerRolePlan {
  readonly [PRIVATE_LIVE_LINUX_DOCKER_ROLE_PLAN]: "PRIVATE_LIVE_LINUX_DOCKER_ROLE_PLAN";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_BARRIER_PLAN_NOT_RUNTIME_VERIFIED";
  readonly role: LinuxCgroupHelperRole;
  readonly dynamicRuntimeVerified: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
  readonly name: string;
  readonly image: string;
  readonly user: string;
  readonly workingDirectory: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly requiredEnvironment: Readonly<Record<string, string>>;
  readonly imageEnvironment: Readonly<Record<string, string>>;
  readonly entrypoint: readonly ["node"];
  readonly commandArgs: readonly string[];
  readonly bindMounts: readonly {
    source: string;
    destination: string;
    readOnly: boolean;
  }[];
  readonly tmpfsMounts: readonly { destination: string; sizeBytes: number }[];
  readonly pidsLimit: number;
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly nanoCpus: number;
  readonly fileSizeLimitBytes: number;
  readonly logDriver: "local";
  readonly logOptions: Readonly<Record<string, string>>;
  readonly creationNetwork: "none" | { name: string; id: string };
  readonly networks: readonly {
    name: string;
    id: string;
    requiredAliases: readonly string[];
  }[];
  readonly createArgs: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactRole(value: unknown): asserts value is LinuxCgroupHelperRole {
  if (value !== "egress" && value !== "worker" && value !== "verifier") {
    throw new Error("The live Linux Docker role is invalid.");
  }
}

function safeText(value: string, label: string) {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n,]/u.test(value)) {
    throw new Error(`${label} is unsafe.`);
  }
  return value;
}

function safePositiveInteger(value: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function exactTarget(role: LinuxCgroupHelperRole, target: readonly string[]) {
  const hold = "--observation-hold-ms=5000";
  const allowlist: Readonly<Record<LinuxCgroupHelperRole, readonly (readonly string[])[]>> = {
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
  const accepted = allowlist[role].some(
    (candidate) =>
      candidate.length === target.length &&
      candidate.every((argument, index) => argument === target[index]),
  );
  if (!accepted) throw new Error("The live Linux Docker barrier target is not allowlisted.");
}

function validateEnvironment(
  environment: Readonly<Record<string, string>>,
  label: string,
  forbidBarrierNames: boolean,
) {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (
      !ENVIRONMENT_NAME.test(name) ||
      typeof value !== "string" ||
      /[\0\r\n]/u.test(value) ||
      (forbidBarrierNames && BARRIER_ENVIRONMENT_NAMES.has(name))
    ) {
      throw new Error(`${label} is unsafe.`);
    }
    result[name] = value;
  }
  return result;
}

function labelArguments(labels: Readonly<Record<string, string>>) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => {
      safeText(key, "The live Linux Docker label name");
      safeText(value, "The live Linux Docker label value");
      return ["--label", `${key}=${value}`];
    });
}

function mountArgument(mount: { source: string; target: string; readOnly: boolean }) {
  if (
    !isAbsolute(mount.source) ||
    !isAbsolute(mount.target) ||
    /[\0\r\n,]/u.test(mount.source) ||
    /[\0\r\n,]/u.test(mount.target)
  ) {
    throw new Error("The live Linux Docker bind mount is unsafe.");
  }
  return `type=bind,source=${mount.source},target=${mount.target}${
    mount.readOnly ? ",readonly" : ""
  }`;
}

function assertExactBindMounts(
  role: LinuxCgroupHelperRole,
  mounts: readonly { source: string; target: string; readOnly: boolean }[],
) {
  const expected = REQUIRED_BIND_MOUNTS[role];
  const actual = new Map<string, boolean>();
  for (const mount of mounts) {
    if (actual.has(mount.target)) {
      throw new Error("The live Linux Docker bind mounts are duplicated.");
    }
    actual.set(mount.target, mount.readOnly);
  }
  const expectedEntries = Object.entries(expected);
  if (
    actual.size !== expectedEntries.length ||
    expectedEntries.some(([target, readOnly]) => actual.get(target) !== readOnly)
  ) {
    throw new Error("The live Linux Docker role bind mounts are not exactly allowlisted.");
  }
}

function assertExactTmpfsMounts(
  role: LinuxCgroupHelperRole,
  mounts: readonly { destination: string; sizeBytes: number }[],
) {
  const expected = REQUIRED_TMPFS_MOUNTS[role];
  const actual = new Map(mounts.map((mount) => [mount.destination, mount.sizeBytes]));
  const expectedEntries = Object.entries(expected);
  if (
    actual.size !== mounts.length ||
    actual.size !== expectedEntries.length ||
    expectedEntries.some(([target, sizeBytes]) => actual.get(target) !== sizeBytes)
  ) {
    throw new Error("The live Linux Docker role tmpfs mounts are not exactly allowlisted.");
  }
}

function cpuArgument(nanoCpus: number) {
  if (
    !Number.isSafeInteger(nanoCpus) ||
    nanoCpus < 1_000_000 ||
    nanoCpus > 1_000_000_000 ||
    nanoCpus % 1_000_000 !== 0
  ) {
    throw new Error("The live Linux Docker CPU limit is invalid.");
  }
  return (nanoCpus / 1_000_000_000).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function sameAliases(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function assertSealedRoleTopology(
  lifecyclePlan: SupervisorDockerLifecyclePlan,
  role: LinuxCgroupHelperRole,
  processPlan: SupervisorDockerProcessPlan,
) {
  if (
    lifecyclePlan.networks.worker.name !== lifecyclePlan.workerNetwork ||
    lifecyclePlan.networks.worker.internal !== true ||
    lifecyclePlan.networks.outbound.name !== lifecyclePlan.outboundNetwork ||
    lifecyclePlan.networks.outbound.internal !== false
  ) {
    throw new Error("The sealed Docker network topology is invalid.");
  }
  const expected = {
    worker: {
      creationNetwork: "worker",
      attachments: [{ network: "worker", aliases: [] }],
    },
    verifier: { creationNetwork: "none", attachments: [] },
    egress: {
      creationNetwork: "outbound",
      attachments: [
        { network: "outbound", aliases: [] },
        { network: "worker", aliases: ["policytwin-egress"] },
      ],
    },
  } as const;
  const required = expected[role];
  if (
    processPlan.role !== role ||
    processPlan.creationNetwork !== required.creationNetwork ||
    processPlan.attachments.length !== required.attachments.length ||
    processPlan.attachments.some((attachment, index) => {
      const candidate = required.attachments[index];
      return (
        candidate === undefined ||
        attachment.network !== candidate.network ||
        !sameAliases(attachment.aliases, candidate.aliases)
      );
    })
  ) {
    throw new Error("The sealed Docker role network topology is invalid.");
  }
}

export function assertPrivateLiveLinuxBarrierDockerRolePlan(
  value: unknown,
): asserts value is LiveLinuxBarrierDockerRolePlan {
  if (
    typeof value !== "object" ||
    value === null ||
    !privateRolePlans.has(value)
  ) {
    throw new Error("The Docker barrier role plan was not issued by the private plan factory.");
  }
}

export function buildLiveLinuxBarrierDockerRolePlan(
  controller: PrivateLinuxStartBarrierController,
  input: LiveLinuxBarrierDockerRolePlanInput,
): LiveLinuxBarrierDockerRolePlan {
  assertFactoryIssuedSupervisorDockerLifecyclePlan(input.lifecyclePlan);
  assertPrivatePreparedLinuxStartBarrierRole(controller, input.preparedBarrier);
  exactRole(input.role);
  const lifecyclePlan = input.lifecyclePlan;
  const processPlan = lifecyclePlan[input.role];
  if (
    lifecyclePlan.schemaVersion !== "2" ||
    lifecyclePlan.status !== "STATIC_PLAN_ONLY" ||
    lifecyclePlan.dynamicIsolationVerified !== false ||
    lifecyclePlan.liveCodexExecuted !== false ||
    lifecyclePlan.ownership.bindingSha256 !== controller.runBindingSha256 ||
    input.preparedBarrier.roleProtocol.role !== input.role ||
    input.preparedBarrier.roleProtocol.runBindingSha256 !== controller.runBindingSha256 ||
    !IMAGE.test(processPlan.image) ||
    processPlan.workingDirectory !== "/opt/policytwin" ||
    processPlan.user !==
      ({ worker: "10001:10001", verifier: "10002:10002", egress: "10003:10003" } as const)[
        input.role
      ] ||
    processPlan.labels["com.policytwin.managed"] !== "true" ||
    processPlan.labels["com.policytwin.contract-version"] !== "2" ||
    processPlan.labels["com.policytwin.binding-sha256"] !== controller.runBindingSha256 ||
    processPlan.labels["com.policytwin.request-sha256"] !==
      lifecyclePlan.ownership.requestSha256 ||
    processPlan.labels["com.policytwin.run-id"] !== lifecyclePlan.ownership.runId ||
    processPlan.labels["com.policytwin.role"] !== input.role ||
    processPlan.restartPolicy !== "no" ||
    processPlan.operateByObservedId !== true
  ) {
    throw new Error("The live Linux Docker role plan is not bound to the sealed supervisor plan.");
  }
  if (
    !SHA256.test(input.observedNetworkIds.worker) ||
    !SHA256.test(input.observedNetworkIds.outbound) ||
    input.observedNetworkIds.worker === input.observedNetworkIds.outbound
  ) {
    throw new Error("The observed Docker network identities are invalid.");
  }
  assertSealedRoleTopology(lifecyclePlan, input.role, processPlan);
  safeText(processPlan.name, "The live Linux Docker role name");
  safeText(processPlan.user, "The live Linux Docker role user");
  const target = ROLE_TARGETS[input.role];
  exactTarget(input.role, target);
  const environment = validateEnvironment(
    processPlan.environment,
    "The sealed role environment",
    true,
  );
  const imageEnvironment = validateEnvironment(
    processPlan.imageEnvironment,
    "The sealed role image environment",
    true,
  );
  const requiredEnvironment = {
    ...environment,
    ...input.preparedBarrier.containerConfiguration.environment,
  };
  const baseMounts = processPlan.mounts.map((mount) => ({
    source: mount.source,
    target: mount.target,
    readOnly: mount.readOnly,
  }));
  assertExactBindMounts(input.role, baseMounts);
  const receipt = input.preparedBarrier.containerConfiguration.receiptMount;
  const control = input.preparedBarrier.containerConfiguration.controlMount;
  const allMounts = [
    ...baseMounts,
    { source: receipt.source, target: receipt.target, readOnly: receipt.readOnly },
    { source: control.source, target: control.target, readOnly: control.readOnly },
  ];
  if (
    allMounts.some(
      (mount, index) =>
        allMounts.findIndex((candidate) => candidate.target === mount.target) !== index,
    ) ||
    receipt.readOnly ||
    !control.readOnly
  ) {
    throw new Error("The live Linux Docker barrier mounts are invalid.");
  }
  const mountArguments = allMounts.flatMap((mount) => ["--mount", mountArgument(mount)]);
  const tmpfsMounts = processPlan.tmpfsMounts.map((mount) => {
    if (!isAbsolute(mount.target) || /[\0\r\n,:]/u.test(mount.target)) {
      throw new Error("The live Linux Docker tmpfs mount is unsafe.");
    }
    safePositiveInteger(mount.sizeBytes, 1024 * 1024 * 1024, "The tmpfs size");
    return { destination: mount.target, sizeBytes: mount.sizeBytes };
  });
  if (
    tmpfsMounts.some(
      (mount, index) =>
        tmpfsMounts.findIndex((candidate) => candidate.destination === mount.destination) !== index,
    )
  ) {
    throw new Error("The live Linux Docker tmpfs mounts are duplicated.");
  }
  assertExactTmpfsMounts(input.role, tmpfsMounts);
  const networkFor = (network: "worker" | "outbound") => ({
    name: lifecyclePlan.networks[network].name,
    id: input.observedNetworkIds[network],
  });
  const creationNetwork =
    processPlan.creationNetwork === "none"
      ? ("none" as const)
      : networkFor(processPlan.creationNetwork);
  const networks = processPlan.attachments.map((attachment) => ({
    ...networkFor(attachment.network),
    requiredAliases: [...attachment.aliases],
  }));
  const pidsLimit = safePositiveInteger(processPlan.pidsLimit, 4_096, "The role PID limit");
  const memoryBytes = safePositiveInteger(
    processPlan.memoryBytes,
    16 * 1024 * 1024 * 1024,
    "The role memory limit",
  );
  const memorySwapBytes = safePositiveInteger(
    processPlan.memorySwapBytes,
    16 * 1024 * 1024 * 1024,
    "The role memory+swap limit",
  );
  if (memorySwapBytes !== memoryBytes) {
    throw new Error("The live Linux Docker role must disable swap expansion.");
  }
  const fileSizeLimitBytes = safePositiveInteger(
    processPlan.fileSizeLimitBytes,
    64 * 1024 * 1024,
    "The role file-size limit",
  );
  const nanoCpus = processPlan.nanoCpus;
  const cpus = cpuArgument(nanoCpus);
  if (
    processPlan.logOptions["max-size"] !== String(fileSizeLimitBytes) ||
    processPlan.logOptions["max-file"] !== "1" ||
    Object.keys(processPlan.logOptions).length !== 2
  ) {
    throw new Error("The live Linux Docker log options are invalid.");
  }
  const commandArgs = ["scripts/role-start-barrier.mjs", "--", ...target];
  const createArgs = [
    "create",
    "--name",
    processPlan.name,
    "--user",
    processPlan.user,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--pids-limit",
    String(pidsLimit),
    "--memory",
    String(memoryBytes),
    "--memory-swap",
    String(memorySwapBytes),
    "--cpus",
    cpus,
    "--network",
    creationNetwork === "none" ? "none" : creationNetwork.id,
    "--restart=no",
    "--log-driver=local",
    `--log-opt=max-size=${fileSizeLimitBytes}`,
    "--log-opt=max-file=1",
    `--ulimit=fsize=${fileSizeLimitBytes}:${fileSizeLimitBytes}`,
    ...labelArguments(processPlan.labels),
    ...Object.entries(requiredEnvironment)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([name, value]) => ["--env", `${name}=${value}`]),
    ...tmpfsMounts.flatMap((mount) => [
      "--tmpfs",
      `${mount.destination}:rw,noexec,nosuid,nodev,size=${mount.sizeBytes}`,
    ]),
    ...mountArguments,
    "--entrypoint=node",
    processPlan.image,
    ...commandArgs,
  ];
  const plan = deepFreeze({
    schemaVersion: "1" as const,
    status: "PRIVATE_BARRIER_PLAN_NOT_RUNTIME_VERIFIED" as const,
    role: input.role,
    dynamicRuntimeVerified: false as const,
    liveEvidenceIssuanceEnabled: false as const,
    passSigningEligible: false as const,
    name: processPlan.name,
    image: processPlan.image,
    user: processPlan.user,
    workingDirectory: processPlan.workingDirectory,
    labels: { ...processPlan.labels },
    requiredEnvironment,
    imageEnvironment,
    entrypoint: ["node"] as const,
    commandArgs,
    bindMounts: allMounts.map((mount) => ({
      source: mount.source,
      destination: mount.target,
      readOnly: mount.readOnly,
    })),
    tmpfsMounts,
    pidsLimit,
    memoryBytes,
    memorySwapBytes,
    nanoCpus,
    fileSizeLimitBytes,
    logDriver: "local" as const,
    logOptions: { ...processPlan.logOptions },
    creationNetwork,
    networks,
    createArgs,
  }) as unknown as LiveLinuxBarrierDockerRolePlan;
  privateRolePlans.add(plan);
  return plan;
}
