import {
  buildSupervisorDockerLifecyclePlan,
  OBSERVED_OUTBOUND_NETWORK_ID,
  type EgressProxySecretMounts,
  type SupervisorDockerLifecyclePlan,
  type SupervisorDockerNetworkPlan,
  type SupervisorDockerProcessPlan,
} from "./egress-runtime-contract.js";
import {
  parseCreatedDockerId,
  parseDockerContainerOwnershipInspection,
  parseDockerContainerInspection,
  parseDockerNetworkOwnershipInspection,
  parseDockerNetworkInspection,
  parseDockerWaitExitCode,
} from "./docker-observer.js";
import {
  assertSupervisorDockerArguments,
  type DockerCommandResult,
  type DockerCommandRunner,
} from "./docker-command-runner.js";
import {
  OBSERVED_WORKER_NETWORK_ID,
  supervisorDockerBindingSha256,
  type WorkerRuntimeResourceLimits,
} from "./worker-runtime-contract.js";
import {
  workerRpcSha256,
  type WorkerRpcRequest,
} from "./worker-rpc-contract.js";
import type {
  PreparedWorkerOsLifecycleResult,
  WorkerOsCleanupObservation,
  WorkerOsLifecycleDriver,
} from "./worker-os-lifecycle.js";
import { createPreparedSupervisorWorkerLifecycle } from "./worker-os-lifecycle.js";

type ContainerRole = "egress" | "worker" | "verifier";
type NetworkRole = "worker" | "outbound";

export interface StaticDockerWorkerReceipt {
  schemaVersion: "1";
  status: "STATIC_PREFLIGHT_PASS";
  dynamicIsolationVerified: false;
  liveCodexExecuted: false;
}

export interface StaticDockerVerifierReceipt {
  schemaVersion: "1";
  status: "FIXTURE_COMMANDS_PASS";
  network: "UNVERIFIED_BY_PROCESS";
  credentialsPresent: false;
  dynamicIsolationVerified: false;
  liveCodexExecuted: false;
}

export interface SupervisorDockerWorkspaceController {
  prepare(
    configuration: SupervisorDockerExecutionConfiguration,
    request: WorkerRpcRequest,
    signal: AbortSignal,
  ): Promise<void>;
  reconstructVerification(
    plan: SupervisorDockerLifecyclePlan,
    request: WorkerRpcRequest,
    signal: AbortSignal,
  ): Promise<void>;
  cleanup(
    plan: SupervisorDockerLifecyclePlan | null,
    request: WorkerRpcRequest,
    signal: AbortSignal,
  ): Promise<{
    repairWorkspaceDeleted: boolean;
    verificationWorkspaceDeleted: boolean;
  }>;
}

export interface SupervisorDockerExecutionConfiguration {
  repositoryRoot: string;
  runId: string;
  verifierImage: string;
  egressProxyImage: string;
  allowedWorkerImage: string;
  maximumWorkerLimits: WorkerRuntimeResourceLimits;
  ownershipNonce: string;
  egressSecrets: EgressProxySecretMounts;
}

export interface SupervisorProcessObserver {
  processTreeIsEmpty(
    observation: {
      containerId: string;
      initialPids: readonly number[];
    },
    signal: AbortSignal,
  ): Promise<boolean>;
}

interface OwnedNetwork {
  id: string;
  plan: SupervisorDockerNetworkPlan;
  removed: boolean;
}

interface OwnedContainer {
  id: string;
  plan: SupervisorDockerProcessPlan;
  connections: Set<NetworkRole>;
  observedPids: Set<number>;
  removed: boolean;
}

interface SupervisorDockerHandle {
  request: WorkerRpcRequest;
  plan: SupervisorDockerLifecyclePlan | null;
  networks: Partial<Record<NetworkRole, OwnedNetwork>>;
  containers: Partial<Record<ContainerRole, OwnedContainer>>;
  ambiguousNetworks: Set<NetworkRole>;
  ambiguousContainers: Set<ContainerRole>;
}

const CONTROL_TIMEOUT_MS = 30_000;

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("The supervisor Docker run was aborted.");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const left = Object.entries(actual).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const right = Object.entries(expected).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  return (
    left.length === right.length &&
    left.every(
      ([key, value], index) => key === right[index]?.[0] && value === right[index]?.[1],
    )
  );
}

function assertPlanBoundToRequest(
  plan: SupervisorDockerLifecyclePlan,
  request: WorkerRpcRequest,
): void {
  const requestSha256 = workerRpcSha256(request);
  const bindingSha256 = supervisorDockerBindingSha256(
    requestSha256,
    plan.ownership.runId,
    plan.ownership.nonce,
  );
  const suffix = bindingSha256.slice(0, 32);
  const expectedCommonLabels = {
    "com.policytwin.managed": "true",
    "com.policytwin.contract-version": "2",
    "com.policytwin.binding-sha256": bindingSha256,
    "com.policytwin.request-sha256": requestSha256,
    "com.policytwin.run-id": plan.ownership.runId,
  };
  const resources = [
    [plan.networks.worker, "worker-internal"],
    [plan.networks.outbound, "egress-outbound"],
    [plan.egress, "egress"],
    [plan.worker, "worker"],
    [plan.verifier, "verifier"],
  ] as const;
  if (
    plan.schemaVersion !== "2" ||
    plan.status !== "STATIC_PLAN_ONLY" ||
    plan.dynamicIsolationVerified !== false ||
    plan.liveCodexExecuted !== false ||
    plan.ownership.requestSha256 !== requestSha256 ||
    plan.ownership.bindingSha256 !== bindingSha256 ||
    plan.workerNetwork !== `policytwin-worker-${suffix}` ||
    plan.outboundNetwork !== `policytwin-egress-${suffix}` ||
    plan.networks.worker.name !== plan.workerNetwork ||
    plan.networks.outbound.name !== plan.outboundNetwork ||
    plan.worker.name !== `policytwin-worker-${suffix}` ||
    plan.verifier.name !== `policytwin-verifier-${suffix}` ||
    plan.egress.name !== `policytwin-egress-${suffix}` ||
    plan.worker.image !== request.policy.workerImageDigest ||
    plan.worker.memoryBytes !== request.policy.limits.memoryBytes ||
    plan.worker.pidsLimit !== request.policy.limits.pids ||
    plan.worker.wallTimeMs !== request.policy.limits.wallTimeMs ||
    plan.worker.cpuTimeMs !== request.policy.limits.cpuTimeMs ||
    plan.worker.outputBytes !== request.policy.limits.outputBytes ||
    plan.worker.cpuTimeEnforcement !== "UNAVAILABLE_STATIC_DRIVER"
  ) {
    throw new Error("The supervisor Docker plan is not bound to the admitted request.");
  }
  for (const [resource, role] of resources) {
    if (
      !exactRecord(resource.labels, {
        ...expectedCommonLabels,
        "com.policytwin.role": role,
      })
    ) {
      throw new Error("The supervisor Docker plan labels are not request-bound.");
    }
  }
  const placeholderNetworks = {
    worker: { id: "1".repeat(64) },
    outbound: { id: "2".repeat(64) },
  } as unknown as Partial<Record<NetworkRole, OwnedNetwork>>;
  for (const network of [plan.networks.worker, plan.networks.outbound]) {
    assertSupervisorDockerArguments(network.createArgs);
  }
  for (const processPlan of [plan.egress, plan.worker, plan.verifier]) {
    assertSupervisorDockerArguments(resolveCreateArguments(processPlan, placeholderNetworks));
  }
}

async function run(
  runner: DockerCommandRunner,
  args: readonly string[],
  signal: AbortSignal,
  options: { timeoutMs?: number; maximumOutputBytes?: number } = {},
): Promise<DockerCommandResult> {
  assertSupervisorDockerArguments(args);
  return await runner.run(args, {
    signal,
    timeoutMs: options.timeoutMs ?? CONTROL_TIMEOUT_MS,
    ...(options.maximumOutputBytes === undefined
      ? {}
      : { maximumOutputBytes: options.maximumOutputBytes }),
  });
}

async function mustRun(
  runner: DockerCommandRunner,
  args: readonly string[],
  signal: AbortSignal,
  label: string,
  options: { timeoutMs?: number; maximumOutputBytes?: number } = {},
): Promise<DockerCommandResult> {
  const result = await run(runner, args, signal, options);
  if (result.exitCode !== 0) throw new Error(`${label} failed.`);
  return result;
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function exactPolicyTwinReceipt(value: string, status: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim());
  } catch {
    throw new Error("A prepared Docker process returned invalid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("A prepared Docker process returned an invalid receipt.");
  }
  const receipt = parsed as Record<string, unknown>;
  if (
    receipt.schemaVersion !== "1" ||
    receipt.status !== status ||
    receipt.dynamicIsolationVerified !== false ||
    receipt.liveCodexExecuted !== false
  ) {
    throw new Error("A prepared Docker process tried to cross the static truth boundary.");
  }
  const expectedKeys = status === "FIXTURE_COMMANDS_PASS"
    ? [
        "credentialsPresent",
        "dynamicIsolationVerified",
        "liveCodexExecuted",
        "network",
        "schemaVersion",
        "status",
      ]
    : ["dynamicIsolationVerified", "liveCodexExecuted", "schemaVersion", "status"];
  const actualKeys = Object.keys(receipt).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("A prepared Docker process returned unexpected receipt fields.");
  }
  return receipt;
}

function resolveCreateArguments(
  processPlan: SupervisorDockerProcessPlan,
  networks: Partial<Record<NetworkRole, OwnedNetwork>>,
): string[] {
  const values = processPlan.createArgs.map((argument) => {
    if (argument === OBSERVED_WORKER_NETWORK_ID) {
      const id = networks.worker?.id;
      if (id === undefined) throw new Error("The worker network ID is unavailable.");
      return id;
    }
    if (argument === OBSERVED_OUTBOUND_NETWORK_ID) {
      const id = networks.outbound?.id;
      if (id === undefined) throw new Error("The outbound network ID is unavailable.");
      return id;
    }
    return argument;
  });
  if (values.some((argument) => argument.startsWith("__POLICYTWIN_"))) {
    throw new Error("A Docker create plan contains an unresolved resource reference.");
  }
  return values;
}

function expectedNetworkIds(
  handle: SupervisorDockerHandle,
  networkRole: NetworkRole,
): string[] {
  return Object.values(handle.containers)
    .filter(
      (container): container is OwnedContainer =>
        container !== undefined && !container.removed && container.connections.has(networkRole),
    )
    .map((container) => container.id)
    .sort();
}

async function observeNetwork(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: NetworkRole,
  signal: AbortSignal,
): Promise<void> {
  const owned = handle.networks[role];
  if (owned === undefined || owned.removed) {
    throw new Error("The owned Docker network is unavailable for observation.");
  }
  const result = await mustRun(
    runner,
    ["network", "inspect", owned.id],
    signal,
    "Docker network inspection",
  );
  parseDockerNetworkInspection(result.stdout, {
    id: owned.id,
    name: owned.plan.name,
    internal: owned.plan.internal,
    labels: owned.plan.labels,
    containerIds: expectedNetworkIds(handle, role),
  });
}

function attachmentExpectation(
  handle: SupervisorDockerHandle,
  container: OwnedContainer,
): { name: string; id: string; requiredAliases: readonly string[] }[] {
  return [...container.connections].map((networkRole) => {
    const network = handle.networks[networkRole];
    if (network === undefined || network.removed) {
      throw new Error("The container references an unavailable Docker network.");
    }
    const attachment = container.plan.attachments.find(
      (candidate) => candidate.network === networkRole,
    );
    if (attachment === undefined) {
      throw new Error("The container has an unplanned Docker network attachment.");
    }
    return {
      name: network.plan.name,
      id: network.id,
      requiredAliases: attachment.aliases,
    };
  });
}

async function observeContainer(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: ContainerRole,
  signal: AbortSignal,
  requireRunning = false,
): Promise<void> {
  const owned = handle.containers[role];
  if (owned === undefined || owned.removed) {
    throw new Error("The owned Docker container is unavailable for observation.");
  }
  const result = await mustRun(
    runner,
    ["container", "inspect", owned.id],
    signal,
    "Docker container inspection",
  );
  const creationNetwork =
    owned.plan.creationNetwork === "none"
      ? "none"
      : (() => {
          const network = handle.networks[owned.plan.creationNetwork];
          if (network === undefined || network.removed) {
            throw new Error("The Docker creation network is unavailable.");
          }
          return { name: network.plan.name, id: network.id };
        })();
  const observation = parseDockerContainerInspection(result.stdout, {
    id: owned.id,
    name: owned.plan.name,
    image: owned.plan.image,
    user: owned.plan.user,
    entrypoint: owned.plan.entrypoint,
    workingDirectory: owned.plan.workingDirectory,
    labels: owned.plan.labels,
    pidsLimit: owned.plan.pidsLimit,
    memoryBytes: owned.plan.memoryBytes,
    memorySwapBytes: owned.plan.memorySwapBytes,
    nanoCpus: owned.plan.nanoCpus,
    fileSizeLimitBytes: owned.plan.fileSizeLimitBytes,
    logDriver: owned.plan.logDriver,
    logOptions: owned.plan.logOptions,
    creationNetwork,
    requiredEnvironment: owned.plan.environment,
    imageEnvironment: owned.plan.imageEnvironment,
    commandArgs: owned.plan.commandArgs,
    bindMounts: owned.plan.mounts.map((mount) => ({
      source: mount.source,
      destination: mount.target,
      readOnly: mount.readOnly,
    })),
    tmpfsMounts: owned.plan.tmpfsMounts.map((mount) => ({
      destination: mount.target,
      sizeBytes: mount.sizeBytes,
    })),
    networks: attachmentExpectation(handle, owned),
  });
  const ports = await mustRun(
    runner,
    ["port", owned.id],
    signal,
    "Docker port observation",
  );
  if (ports.stdout.trim().length !== 0) {
    throw new Error("A prepared Docker container published a host port.");
  }
  if (requireRunning) {
    if (!observation.running || observation.pid < 1) {
      throw new Error("The prepared Docker container did not enter a running state.");
    }
    owned.observedPids.add(observation.pid);
  }
}

async function assertNamesAbsent(
  runner: DockerCommandRunner,
  plan: SupervisorDockerLifecyclePlan,
  signal: AbortSignal,
): Promise<void> {
  for (const processPlan of [plan.egress, plan.worker, plan.verifier]) {
    const result = await mustRun(
      runner,
      [
        "ps",
        "--all",
        "--no-trunc",
        "--filter",
        `name=^/${processPlan.name}$`,
        "--format",
        "{{.ID}}",
      ],
      signal,
      "Docker container name preflight",
    );
    if (lines(result.stdout).length !== 0) {
      throw new Error("A prepared Docker container name already exists.");
    }
  }
  for (const networkPlan of [plan.networks.worker, plan.networks.outbound]) {
    const result = await mustRun(
      runner,
      [
        "network",
        "ls",
        "--no-trunc",
        "--filter",
        `name=^${networkPlan.name}$`,
        "--format",
        "{{.ID}}",
      ],
      signal,
      "Docker network name preflight",
    );
    if (lines(result.stdout).length !== 0) {
      throw new Error("A prepared Docker network name already exists.");
    }
  }
}

async function createNetwork(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: NetworkRole,
  plan: SupervisorDockerNetworkPlan,
  signal: AbortSignal,
): Promise<void> {
  let result: DockerCommandResult;
  let inspection: DockerCommandResult;
  let id: string;
  try {
    result = await mustRun(runner, plan.createArgs, signal, "Docker network creation");
    id = parseCreatedDockerId(result.stdout, "Docker network creation");
    inspection = await mustRun(
      runner,
      ["network", "inspect", id],
      signal,
      "Docker network ownership inspection",
    );
    parseDockerNetworkOwnershipInspection(inspection.stdout, {
      id,
      name: plan.name,
      labels: plan.labels,
    });
  } catch (error) {
    handle.ambiguousNetworks.add(role);
    throw error;
  }
  handle.networks[role] = { id, plan, removed: false };
  parseDockerNetworkInspection(inspection.stdout, {
    id,
    name: plan.name,
    internal: plan.internal,
    labels: plan.labels,
    containerIds: [],
  });
}

async function createContainer(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: ContainerRole,
  plan: SupervisorDockerProcessPlan,
  signal: AbortSignal,
): Promise<void> {
  const args = resolveCreateArguments(plan, handle.networks);
  let result: DockerCommandResult;
  let inspection: DockerCommandResult;
  let id: string;
  try {
    result = await mustRun(runner, args, signal, "Docker container creation");
    id = parseCreatedDockerId(result.stdout, "Docker container creation");
    inspection = await mustRun(
      runner,
      ["container", "inspect", id],
      signal,
      "Docker container ownership inspection",
    );
    parseDockerContainerOwnershipInspection(inspection.stdout, {
      id,
      name: plan.name,
      labels: plan.labels,
    });
  } catch (error) {
    handle.ambiguousContainers.add(role);
    throw error;
  }
  const connections = new Set<NetworkRole>();
  if (plan.creationNetwork !== "none") connections.add(plan.creationNetwork);
  handle.containers[role] = {
    id,
    plan,
    connections,
    observedPids: new Set(),
    removed: false,
  };
  await observeContainer(runner, handle, role, signal);
  if (plan.creationNetwork !== "none") {
    await observeNetwork(runner, handle, plan.creationNetwork, signal);
  }
}

async function connectContainer(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  containerRole: ContainerRole,
  networkRole: NetworkRole,
  aliases: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  const container = handle.containers[containerRole];
  const network = handle.networks[networkRole];
  if (container === undefined || network === undefined || container.removed || network.removed) {
    throw new Error("An owned Docker resource is unavailable for connection.");
  }
  const result = await mustRun(
    runner,
    [
      "network",
      "connect",
      ...aliases.flatMap((alias) => ["--alias", alias]),
      network.id,
      container.id,
    ],
    signal,
    "Docker network connection",
  );
  if (result.stdout.trim().length !== 0) {
    throw new Error("Docker network connection returned unexpected output.");
  }
  container.connections.add(networkRole);
  await observeNetwork(runner, handle, networkRole, signal);
  await observeContainer(runner, handle, containerRole, signal);
}

async function disconnectContainer(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  containerRole: ContainerRole,
  networkRole: NetworkRole,
  signal: AbortSignal,
): Promise<void> {
  const container = handle.containers[containerRole];
  const network = handle.networks[networkRole];
  if (container === undefined || network === undefined || !container.connections.has(networkRole)) {
    return;
  }
  await mustRun(
    runner,
    ["network", "disconnect", "--force", network.id, container.id],
    signal,
    "Docker network disconnection",
  );
  container.connections.delete(networkRole);
  await observeNetwork(runner, handle, networkRole, signal);
}

async function removeContainer(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: ContainerRole,
  signal: AbortSignal,
): Promise<void> {
  const container = handle.containers[role];
  if (container === undefined || container.removed) return;
  await mustRun(
    runner,
    ["rm", "--force", container.id],
    signal,
    "Docker container removal",
  );
  container.removed = true;
}

async function startContainer(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: ContainerRole,
  signal: AbortSignal,
): Promise<void> {
  const container = handle.containers[role];
  if (container === undefined || container.removed) {
    throw new Error("The Docker container is unavailable for start.");
  }
  await mustRun(runner, ["start", container.id], signal, "Docker container start");
  await observeContainer(runner, handle, role, signal, true);
}

async function waitAndReadLogs(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: ContainerRole,
  signal: AbortSignal,
  timeoutMs: number,
  maximumOutputBytes: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const container = handle.containers[role];
  if (container === undefined || container.removed) {
    throw new Error("The Docker container is unavailable for wait.");
  }
  const waitResult = await mustRun(
    runner,
    ["wait", container.id],
    signal,
    "Docker container wait",
    { timeoutMs },
  );
  const logs = await mustRun(
    runner,
    ["logs", container.id],
    signal,
    "Docker container logs",
    { maximumOutputBytes },
  );
  return {
    exitCode: parseDockerWaitExitCode(waitResult.stdout, "Docker container wait"),
    stdout: logs.stdout,
    stderr: logs.stderr,
  };
}

async function stopEgress(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  signal: AbortSignal,
): Promise<void> {
  const egress = handle.containers.egress;
  if (egress === undefined || egress.removed) return;
  await mustRun(
    runner,
    ["stop", "--time", "5", egress.id],
    signal,
    "Docker egress stop",
  );
  const logs = await waitAndReadLogs(
    runner,
    handle,
    "egress",
    signal,
    CONTROL_TIMEOUT_MS,
    egress.plan.outputBytes,
  );
  if (logs.exitCode !== 0 || logs.stdout.trim().length !== 0 || logs.stderr.trim().length !== 0) {
    throw new Error("The Docker egress process did not stop cleanly.");
  }
  await disconnectContainer(runner, handle, "egress", "worker", signal);
  await disconnectContainer(runner, handle, "egress", "outbound", signal);
  await removeContainer(runner, handle, "egress", signal);
}

async function tolerantRun(
  runner: DockerCommandRunner,
  args: readonly string[],
  signal: AbortSignal,
): Promise<DockerCommandResult | null> {
  try {
    return await run(runner, args, signal);
  } catch {
    return null;
  }
}

async function observeContainerAbsent(
  runner: DockerCommandRunner,
  id: string,
  bindingSha256: string,
  role: ContainerRole,
  signal: AbortSignal,
): Promise<boolean> {
  const inspect = await tolerantRun(runner, ["container", "inspect", id], signal);
  const listedById = await tolerantRun(
    runner,
    [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `id=${id}`,
      "--format",
      "{{.ID}}",
    ],
    signal,
  );
  const listed = await tolerantRun(
    runner,
    [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `label=com.policytwin.binding-sha256=${bindingSha256}`,
      "--filter",
      `label=com.policytwin.role=${role}`,
      "--format",
      "{{.ID}}",
    ],
    signal,
  );
  return (
    inspect?.exitCode !== 0 &&
    listedById?.exitCode === 0 &&
    lines(listedById.stdout).length === 0 &&
    listed?.exitCode === 0 &&
    lines(listed.stdout).length === 0
  );
}

async function cleanupContainer(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: ContainerRole,
  signal: AbortSignal,
): Promise<boolean> {
  const container = handle.containers[role];
  const bindingSha256 = handle.plan?.ownership.bindingSha256;
  if (handle.ambiguousContainers.has(role)) return false;
  if (container === undefined) return true;
  if (bindingSha256 === undefined) return false;
  if (!container.removed) {
    await tolerantRun(runner, ["stop", "--time", "5", container.id], signal);
    for (const networkRole of [...container.connections]) {
      const network = handle.networks[networkRole];
      if (network !== undefined) {
        const disconnected = await tolerantRun(
          runner,
          ["network", "disconnect", "--force", network.id, container.id],
          signal,
        );
        if (disconnected?.exitCode === 0) container.connections.delete(networkRole);
      }
    }
    const removed = await tolerantRun(runner, ["rm", "--force", container.id], signal);
    if (removed?.exitCode === 0) container.removed = true;
  }
  return await observeContainerAbsent(
    runner,
    container.id,
    bindingSha256,
    container.plan.role,
    signal,
  );
}

async function cleanupNetwork(
  runner: DockerCommandRunner,
  handle: SupervisorDockerHandle,
  role: NetworkRole,
  signal: AbortSignal,
): Promise<boolean> {
  const network = handle.networks[role];
  const bindingSha256 = handle.plan?.ownership.bindingSha256;
  if (handle.ambiguousNetworks.has(role)) return false;
  if (network === undefined) return true;
  if (bindingSha256 === undefined) return false;
  if (!network.removed) {
    const inspected = await tolerantRun(runner, ["network", "inspect", network.id], signal);
    if (inspected?.exitCode === 0) {
      try {
        parseDockerNetworkInspection(inspected.stdout, {
          id: network.id,
          name: network.plan.name,
          internal: network.plan.internal,
          labels: network.plan.labels,
          containerIds: [],
        });
      } catch {
        return false;
      }
      const removed = await tolerantRun(runner, ["network", "rm", network.id], signal);
      if (removed?.exitCode === 0) network.removed = true;
    }
  }
  const inspect = await tolerantRun(runner, ["network", "inspect", network.id], signal);
  const listedById = await tolerantRun(
    runner,
    [
      "network",
      "ls",
      "--no-trunc",
      "--filter",
      `id=${network.id}`,
      "--format",
      "{{.ID}}",
    ],
    signal,
  );
  const listed = await tolerantRun(
    runner,
    [
      "network",
      "ls",
      "--no-trunc",
      "--filter",
      `label=com.policytwin.binding-sha256=${bindingSha256}`,
      "--filter",
      `label=com.policytwin.role=${network.plan.role}`,
      "--format",
      "{{.ID}}",
    ],
    signal,
  );
  return (
    inspect?.exitCode !== 0 &&
    listedById?.exitCode === 0 &&
    lines(listedById.stdout).length === 0 &&
    listed?.exitCode === 0 &&
    lines(listed.stdout).length === 0
  );
}

export function createProcfsProcessObserver(): SupervisorProcessObserver {
  return {
    async processTreeIsEmpty(_observation, signal) {
      throwIfAborted(signal);
      throw new Error(
        "Init-PID procfs absence cannot prove that a container process tree was reaped.",
      );
    },
  };
}

export function createSupervisorDockerLifecycleDriver(options: {
  runner: DockerCommandRunner;
  workspace: SupervisorDockerWorkspaceController;
  configure(
    request: WorkerRpcRequest,
    signal: AbortSignal,
  ): Promise<SupervisorDockerExecutionConfiguration>;
  processObserver: SupervisorProcessObserver;
}): WorkerOsLifecycleDriver<
  SupervisorDockerHandle,
  StaticDockerWorkerReceipt,
  StaticDockerVerifierReceipt
> {
  return {
    createHandle(request) {
      return {
        request,
        plan: null,
        networks: {},
        containers: {},
        ambiguousNetworks: new Set(),
        ambiguousContainers: new Set(),
      };
    },
    async prepare(handle, request, signal) {
      throwIfAborted(signal);
      if (handle.request !== request || handle.plan !== null) {
        throw new Error("The supervisor Docker handle is invalid.");
      }
      const configuration = deepFreeze(await options.configure(request, signal));
      if (
        configuration.allowedWorkerImage !== request.policy.workerImageDigest ||
        Object.keys(configuration.maximumWorkerLimits).length !== 5 ||
        Object.entries(request.policy.limits).some(([key, value]) => {
          const maximum = configuration.maximumWorkerLimits[
            key as keyof WorkerRuntimeResourceLimits
          ];
          return !Number.isSafeInteger(maximum) || value > maximum;
        })
      ) {
        throw new Error("The worker image or resource policy is not admitted by the supervisor.");
      }
      await options.workspace.prepare(configuration, request, signal);
      const plan = deepFreeze(
        buildSupervisorDockerLifecyclePlan({
          ...configuration,
          workerImage: configuration.allowedWorkerImage,
          requestSha256: workerRpcSha256(request),
          limits: request.policy.limits,
        }),
      );
      assertPlanBoundToRequest(plan, request);
      handle.plan = plan;
      await assertNamesAbsent(options.runner, plan, signal);
      await createNetwork(options.runner, handle, "worker", plan.networks.worker, signal);
      await createNetwork(options.runner, handle, "outbound", plan.networks.outbound, signal);
      await createContainer(options.runner, handle, "egress", plan.egress, signal);
      await connectContainer(
        options.runner,
        handle,
        "egress",
        "worker",
        ["policytwin-egress"],
        signal,
      );
      await startContainer(options.runner, handle, "egress", signal);
      await createContainer(options.runner, handle, "worker", plan.worker, signal);
    },
    async runWorker(handle, request, signal) {
      if (handle.request !== request || handle.plan === null) {
        throw new Error("The supervisor Docker handle is not prepared.");
      }
      await startContainer(options.runner, handle, "worker", signal);
      const output = await waitAndReadLogs(
        options.runner,
        handle,
        "worker",
        signal,
        request.policy.limits.wallTimeMs,
        request.policy.limits.outputBytes,
      );
      await disconnectContainer(options.runner, handle, "worker", "worker", signal);
      await removeContainer(options.runner, handle, "worker", signal);
      await observeNetwork(options.runner, handle, "worker", signal);
      await stopEgress(options.runner, handle, signal);
      await observeNetwork(options.runner, handle, "worker", signal);
      await observeNetwork(options.runner, handle, "outbound", signal);
      if (output.exitCode !== 0 || output.stderr.trim().length !== 0) {
        throw new Error("The prepared Docker worker failed.");
      }
      const receipt = exactPolicyTwinReceipt(output.stdout, "STATIC_PREFLIGHT_PASS");
      return receipt as unknown as StaticDockerWorkerReceipt;
    },
    validateWorkerOutput(output) {
      exactPolicyTwinReceipt(JSON.stringify(output), "STATIC_PREFLIGHT_PASS");
    },
    async runVerifier(handle, _workerOutput, request, signal) {
      const plan = handle.plan;
      if (handle.request !== request || plan === null) {
        throw new Error("The supervisor Docker handle is not prepared.");
      }
      await options.workspace.reconstructVerification(plan, request, signal);
      await createContainer(options.runner, handle, "verifier", plan.verifier, signal);
      await startContainer(options.runner, handle, "verifier", signal);
      const output = await waitAndReadLogs(
        options.runner,
        handle,
        "verifier",
        signal,
        request.policy.limits.wallTimeMs,
        request.policy.limits.outputBytes,
      );
      await removeContainer(options.runner, handle, "verifier", signal);
      if (output.exitCode !== 0 || output.stderr.trim().length !== 0) {
        throw new Error("The prepared Docker verifier failed.");
      }
      const receipt = exactPolicyTwinReceipt(output.stdout, "FIXTURE_COMMANDS_PASS");
      if (
        receipt.network !== "UNVERIFIED_BY_PROCESS" ||
        receipt.credentialsPresent !== false
      ) {
        throw new Error("The prepared Docker verifier receipt is invalid.");
      }
      return receipt as unknown as StaticDockerVerifierReceipt;
    },
    validateVerifierOutput(output) {
      const receipt = exactPolicyTwinReceipt(JSON.stringify(output), "FIXTURE_COMMANDS_PASS");
      if (
        receipt.network !== "UNVERIFIED_BY_PROCESS" ||
        receipt.credentialsPresent !== false
      ) {
        throw new Error("The prepared Docker verifier receipt is invalid.");
      }
    },
    async cleanup(handle, _reason, signal): Promise<WorkerOsCleanupObservation> {
      const verifierContainerRemoved = await cleanupContainer(
        options.runner,
        handle,
        "verifier",
        signal,
      );
      const workerContainerRemoved = await cleanupContainer(
        options.runner,
        handle,
        "worker",
        signal,
      );
      const egressContainerRemoved = await cleanupContainer(
        options.runner,
        handle,
        "egress",
        signal,
      );
      const outboundNetworkReleased = await cleanupNetwork(
        options.runner,
        handle,
        "outbound",
        signal,
      );
      const workerNetworkReleased = await cleanupNetwork(
        options.runner,
        handle,
        "worker",
        signal,
      );
      let workspace = {
        repairWorkspaceDeleted: false,
        verificationWorkspaceDeleted: false,
      };
      try {
        workspace = await options.workspace.cleanup(handle.plan, handle.request, signal);
      } catch {
        // The false observation below poisons the enclosing lifecycle.
      }
      let remainingProcessCount = 0;
      let processObservationComplete = true;
      for (const container of Object.values(handle.containers)) {
        if (container === undefined || container.observedPids.size === 0) continue;
        try {
          if (
            !(await options.processObserver.processTreeIsEmpty(
              {
                containerId: container.id,
                initialPids: [...container.observedPids].sort((left, right) => left - right),
              },
              signal,
            ))
          ) {
            remainingProcessCount += 1;
          }
        } catch {
          processObservationComplete = false;
        }
      }
      return {
        schemaVersion: "1",
        workerContainerRemoved,
        verifierContainerRemoved,
        egressContainerRemoved,
        workerNetworkReleased,
        outboundNetworkReleased,
        repairWorkspaceDeleted: workspace.repairWorkspaceDeleted,
        verificationWorkspaceDeleted: workspace.verificationWorkspaceDeleted,
        processTreeReaped: processObservationComplete && remainingProcessCount === 0,
        remainingProcessCount: processObservationComplete ? remainingProcessCount : -1,
      };
    },
  };
}

export function createPreparedSupervisorDockerLifecycle(options: {
  runner: DockerCommandRunner;
  workspace: SupervisorDockerWorkspaceController;
  configure(
    request: WorkerRpcRequest,
    signal: AbortSignal,
  ): Promise<SupervisorDockerExecutionConfiguration>;
  processObserver: SupervisorProcessObserver;
  cleanupTimeoutMs?: number;
}): {
  execute(
    value: unknown,
    input: { signal: AbortSignal },
  ): Promise<PreparedWorkerOsLifecycleResult>;
} {
  return createPreparedSupervisorWorkerLifecycle(
    createSupervisorDockerLifecycleDriver(options),
    options.cleanupTimeoutMs === undefined
      ? {}
      : { cleanupTimeoutMs: options.cleanupTimeoutMs },
  );
}
