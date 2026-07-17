import {
  type DockerCommandResult,
  type DockerCommandRunner,
  assertPrivateDockerCliCommandRunner,
} from "./docker-command-runner.js";
import {
  type DockerContainerObservation,
  parseCreatedDockerId,
  parseDockerContainerInspection,
  parseDockerContainerOwnershipInspection,
  parseDockerNetworkInspection,
  parseDockerNetworkOwnershipInspection,
} from "./docker-observer.js";
import type { LinuxCgroupHelperRole } from "./linux-cgroup-helper-protocol.js";
import {
  type LiveLinuxBarrierDockerRolePlan,
  assertPrivateLiveLinuxBarrierDockerRolePlan,
  buildLiveLinuxBarrierDockerRolePlan,
} from "./live-linux-docker-role-plan.js";
import {
  type SupervisorDockerLifecyclePlan,
  type SupervisorDockerNetworkPlan,
  type SupervisorDockerProcessPlan,
  assertFactoryIssuedSupervisorDockerLifecyclePlan,
} from "./egress-runtime-contract.js";
import {
  type PrivateLinuxStartBarrierController,
  type PrivatePreparedLinuxStartBarrierRole,
  assertPrivateLinuxStartBarrierController,
  assertPrivatePreparedLinuxStartBarrierRole,
} from "./linux-start-barrier.js";

const ROLE_ORDER = Object.freeze(["egress", "worker", "verifier"] as const);
const NETWORK_ORDER = Object.freeze(["worker", "outbound"] as const);
const CONTROL_TIMEOUT_MS = 30_000;
const dockerOwnerStates = new WeakMap<object, DockerOwnerState>();
const ownedRoleStates = new WeakMap<object, OwnedRoleState>();
const reobservationStates = new WeakMap<object, ReobservationState>();
const removalReceiptStates = new WeakMap<object, RemovalReceiptState>();
const cleanupReceiptStates = new WeakMap<object, DockerCleanupReceiptState>();

export declare const PRIVATE_LIVE_LINUX_DOCKER_OWNER: unique symbol;
export declare const PRIVATE_LIVE_LINUX_OWNED_DOCKER_ROLE: unique symbol;
export declare const PRIVATE_LIVE_LINUX_DOCKER_REOBSERVATION: unique symbol;
export declare const PRIVATE_LIVE_LINUX_DOCKER_REMOVAL_RECEIPT: unique symbol;
export declare const PRIVATE_LIVE_LINUX_DOCKER_CLEANUP_RECEIPT: unique symbol;

export interface PrivateLiveLinuxDockerOwner {
  readonly [PRIVATE_LIVE_LINUX_DOCKER_OWNER]: "PRIVATE_LIVE_LINUX_DOCKER_OWNER";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_DOCKER_OWNER_NOT_RUNTIME_VERIFIED";
  readonly runBindingSha256: string;
  readonly nativeHelperBinarySha256: string;
  readonly dynamicRuntimeVerified: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
}

export interface PrivateLiveLinuxOwnedDockerRole {
  readonly [PRIVATE_LIVE_LINUX_OWNED_DOCKER_ROLE]: "PRIVATE_LIVE_LINUX_OWNED_DOCKER_ROLE";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_DOCKER_ROLE_OBSERVED_NOT_RUNTIME_VERIFIED";
  readonly role: LinuxCgroupHelperRole;
  readonly runBindingSha256: string;
  readonly dynamicRuntimeVerified: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
}

export interface PrivateLiveLinuxDockerReobservation {
  readonly [PRIVATE_LIVE_LINUX_DOCKER_REOBSERVATION]: "PRIVATE_LIVE_LINUX_DOCKER_REOBSERVATION";
  readonly schemaVersion: "1";
  readonly status: "RUNNING_IDENTITY_REOBSERVED_NOT_RUNTIME_VERIFIED";
  readonly role: LinuxCgroupHelperRole;
}

export interface PrivateLiveLinuxDockerRemovalReceipt {
  readonly [PRIVATE_LIVE_LINUX_DOCKER_REMOVAL_RECEIPT]: "PRIVATE_LIVE_LINUX_DOCKER_REMOVAL_RECEIPT";
  readonly schemaVersion: "1";
  readonly status: "DOCKER_ROLE_ABSENCE_REOBSERVED_NOT_RUNTIME_VERIFIED";
  readonly role: LinuxCgroupHelperRole;
}

export interface PrivateLiveLinuxDockerCleanupReceipt {
  readonly [PRIVATE_LIVE_LINUX_DOCKER_CLEANUP_RECEIPT]: "PRIVATE_LIVE_LINUX_DOCKER_CLEANUP_RECEIPT";
  readonly schemaVersion: "1";
  readonly status: "ALL_DOCKER_ROLE_ABSENCE_REOBSERVED_NOT_RUNTIME_VERIFIED";
  readonly dynamicRuntimeVerified: false;
}

interface DockerOwnerState {
  readonly owner: PrivateLiveLinuxDockerOwner;
  readonly runner: DockerCommandRunner;
  readonly lifecyclePlan: SupervisorDockerLifecyclePlan;
  readonly barrierController: PrivateLinuxStartBarrierController;
  readonly preparedBarriers: Readonly<
    Record<LinuxCgroupHelperRole, PrivatePreparedLinuxStartBarrierRole>
  >;
  plans: Readonly<Record<LinuxCgroupHelperRole, LiveLinuxBarrierDockerRolePlan>> | undefined;
  readonly resources: Map<LinuxCgroupHelperRole, DockerResourceState>;
  readonly networks: Map<"worker" | "outbound", DockerNetworkResourceState>;
  destroyed: boolean;
  containersCreated: boolean;
  creationPromise: Promise<void> | undefined;
  networkRemovalPromise: Promise<void> | undefined;
}

interface DockerResourceState {
  readonly role: LinuxCgroupHelperRole;
  readonly sealedPlan: SupervisorDockerProcessPlan;
  plan: LiveLinuxBarrierDockerRolePlan | undefined;
  id: string | undefined;
  ownershipVerified: boolean;
  runningObservation: DockerContainerObservation | undefined;
  capability: PrivateLiveLinuxOwnedDockerRole | undefined;
  removalReceipt: PrivateLiveLinuxDockerRemovalReceipt | undefined;
  startPromise: Promise<void> | undefined;
  issuePromise: Promise<PrivateLiveLinuxOwnedDockerRole> | undefined;
  removalPromise: Promise<PrivateLiveLinuxDockerRemovalReceipt> | undefined;
  creationSideEffectUnresolved: boolean;
  removed: boolean;
}

interface DockerNetworkResourceState {
  readonly role: "worker" | "outbound";
  readonly plan: SupervisorDockerNetworkPlan;
  id: string | undefined;
  ownershipVerified: boolean;
  creationSideEffectUnresolved: boolean;
  removed: boolean;
}

interface OwnedRoleState {
  readonly ownerState: DockerOwnerState;
  readonly resource: DockerResourceState;
  readonly capability: PrivateLiveLinuxOwnedDockerRole;
  readonly containerId: string;
  readonly pid: number;
  readonly startedAt: string;
}

interface ReobservationState {
  readonly ownerState: DockerOwnerState;
  readonly roleState: OwnedRoleState;
  readonly receipt: PrivateLiveLinuxDockerReobservation;
  readonly containerId: string;
  readonly pid: number;
  readonly startedAt: string;
  consumed: boolean;
}

interface RemovalReceiptState {
  readonly ownerState: DockerOwnerState;
  readonly resource: DockerResourceState;
  readonly receipt: PrivateLiveLinuxDockerRemovalReceipt;
}

interface DockerCleanupReceiptState {
  readonly ownerState: DockerOwnerState;
  readonly receipt: PrivateLiveLinuxDockerCleanupReceipt;
}

function requiredOwnerState(owner: PrivateLiveLinuxDockerOwner) {
  const state =
    typeof owner === "object" && owner !== null ? dockerOwnerStates.get(owner) : undefined;
  if (state === undefined || state.destroyed) {
    throw new Error("The Docker owner was not issued by the private Linux Docker factory.");
  }
  return state;
}

function requiredResource(owner: PrivateLiveLinuxDockerOwner, role: LinuxCgroupHelperRole) {
  const state = requiredOwnerState(owner);
  const resource = state.resources.get(role);
  if (resource === undefined) throw new Error("The private Docker role is invalid.");
  return { state, resource };
}

function requiredRolePlan(resource: DockerResourceState) {
  if (resource.plan === undefined) {
    throw new Error("The private Docker role plan is not available before owned networks.");
  }
  return resource.plan;
}

function requiredOwnedRoleState(
  owner: PrivateLiveLinuxDockerOwner,
  role: PrivateLiveLinuxOwnedDockerRole,
) {
  const ownerState = requiredOwnerState(owner);
  const roleState =
    typeof role === "object" && role !== null ? ownedRoleStates.get(role) : undefined;
  if (
    roleState === undefined ||
    roleState.ownerState !== ownerState ||
    roleState.resource.removed
  ) {
    throw new Error("The Docker role is not an active capability of this private owner.");
  }
  return roleState;
}

async function run(
  state: DockerOwnerState,
  args: readonly string[],
  signal: AbortSignal,
  maximumOutputBytes = 1024 * 1024,
) {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("The Docker operation was aborted.");
  }
  return await state.runner.run(args, {
    signal,
    timeoutMs: CONTROL_TIMEOUT_MS,
    maximumOutputBytes,
  });
}

async function mustRun(
  state: DockerOwnerState,
  args: readonly string[],
  signal: AbortSignal,
  label: string,
  maximumOutputBytes?: number,
) {
  const result = await run(state, args, signal, maximumOutputBytes);
  if (result.exitCode !== 0) throw new Error(`${label} failed.`);
  return result;
}

function assertEmptyOutput(result: DockerCommandResult, label: string) {
  if (result.stdout.trim().length !== 0 || result.stderr.trim().length !== 0) {
    throw new Error(`${label} returned unexpected output.`);
  }
}

async function observe(
  state: DockerOwnerState,
  resource: DockerResourceState,
  signal: AbortSignal,
) {
  const id = resource.id;
  if (id === undefined || resource.removed) {
    throw new Error("The owned Docker container is unavailable for observation.");
  }
  const inspection = await mustRun(
    state,
    ["container", "inspect", id],
    signal,
    "Docker container inspection",
    4 * 1024 * 1024,
  );
  const plan = requiredRolePlan(resource);
  const observation = parseDockerContainerInspection(inspection.stdout, {
    id,
    name: plan.name,
    image: plan.image,
    user: plan.user,
    entrypoint: plan.entrypoint,
    workingDirectory: plan.workingDirectory,
    labels: plan.labels,
    pidsLimit: plan.pidsLimit,
    memoryBytes: plan.memoryBytes,
    memorySwapBytes: plan.memorySwapBytes,
    nanoCpus: plan.nanoCpus,
    fileSizeLimitBytes: plan.fileSizeLimitBytes,
    logDriver: plan.logDriver,
    logOptions: plan.logOptions,
    creationNetwork: plan.creationNetwork,
    requiredEnvironment: plan.requiredEnvironment,
    imageEnvironment: plan.imageEnvironment,
    commandArgs: plan.commandArgs,
    bindMounts: plan.bindMounts,
    tmpfsMounts: plan.tmpfsMounts,
    networks: plan.networks,
  });
  const ports = await mustRun(state, ["port", id], signal, "Docker port observation");
  assertEmptyOutput(ports, "Docker port observation");
  return observation;
}

async function assertAbsent(
  state: DockerOwnerState,
  resource: DockerResourceState,
  signal: AbortSignal,
) {
  const id = resource.id;
  if (id !== undefined) {
    const inspection = await run(state, ["container", "inspect", id], signal, 4 * 1024 * 1024);
    if (inspection.exitCode === 0 || inspection.stdout.trim().length !== 0) {
      throw new Error("The removed Docker container is still inspectable.");
    }
    const listing = await mustRun(
      state,
      ["ps", "--all", "--no-trunc", "--filter", `id=${id}`, "--format", "{{.ID}}"],
      signal,
      "Docker container absence observation",
    );
    assertEmptyOutput(listing, "Docker container absence observation");
  }
  if ((await idsForExactName(state, resource.sealedPlan.name, signal)).length !== 0) {
    throw new Error("The removed Docker container name is still present.");
  }
}

async function idsForExactName(
  state: DockerOwnerState,
  name: string,
  signal: AbortSignal,
) {
  const listed = await mustRun(
    state,
    [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.ID}}",
    ],
    signal,
    "Docker container name observation",
  );
  if (listed.stderr.trim().length !== 0) {
    throw new Error("Docker container name observation returned unexpected output.");
  }
  return listed.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function idsForExactNetworkName(
  state: DockerOwnerState,
  name: string,
  signal: AbortSignal,
) {
  const listed = await mustRun(
    state,
    [
      "network",
      "ls",
      "--no-trunc",
      "--filter",
      `name=^${name}$`,
      "--format",
      "{{.ID}}",
    ],
    signal,
    "Docker network name observation",
  );
  if (listed.stderr.trim().length !== 0) {
    throw new Error("Docker network name observation returned unexpected output.");
  }
  return listed.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function verifyNetworkOwnership(
  state: DockerOwnerState,
  resource: DockerNetworkResourceState,
  signal: AbortSignal,
) {
  const id = resource.id;
  if (id === undefined) throw new Error("The Docker network ID is unavailable.");
  const inspection = await mustRun(
    state,
    ["network", "inspect", id],
    signal,
    `${resource.role} Docker network ownership inspection`,
    4 * 1024 * 1024,
  );
  parseDockerNetworkOwnershipInspection(inspection.stdout, {
    id,
    name: resource.plan.name,
    labels: resource.plan.labels,
  });
  parseDockerNetworkInspection(inspection.stdout, {
    id,
    name: resource.plan.name,
    internal: resource.plan.internal,
    labels: resource.plan.labels,
    containerIds: [],
  });
  resource.ownershipVerified = true;
}

async function assertNetworkAbsent(
  state: DockerOwnerState,
  resource: DockerNetworkResourceState,
  signal: AbortSignal,
) {
  const id = resource.id;
  if (id !== undefined) {
    const inspection = await run(state, ["network", "inspect", id], signal, 4 * 1024 * 1024);
    if (inspection.exitCode === 0 || inspection.stdout.trim().length !== 0) {
      throw new Error("The removed Docker network is still inspectable.");
    }
    const listing = await mustRun(
      state,
      ["network", "ls", "--no-trunc", "--filter", `id=${id}`, "--format", "{{.ID}}"],
      signal,
      "Docker network ID absence observation",
    );
    assertEmptyOutput(listing, "Docker network ID absence observation");
  }
  if ((await idsForExactNetworkName(state, resource.plan.name, signal)).length !== 0) {
    throw new Error("The removed Docker network name is still present.");
  }
}

async function removeNetworkResource(
  state: DockerOwnerState,
  resource: DockerNetworkResourceState,
  signal: AbortSignal,
) {
  if (resource.removed) return;
  if (resource.creationSideEffectUnresolved) {
    resource.id = undefined;
    resource.ownershipVerified = false;
    const recovered = await idsForExactNetworkName(state, resource.plan.name, signal);
    if (recovered.length === 0) {
      throw new Error(
        "Docker network creation side effects remain unresolved after an empty exact-name observation.",
      );
    } else if (recovered.length === 1 && /^[0-9a-f]{64}$/u.test(recovered[0]!)) {
      resource.id = recovered[0]!;
      await verifyNetworkOwnership(state, resource, signal);
    } else {
      throw new Error("Docker network creation side effects remain unresolved.");
    }
  }
  if (resource.id !== undefined) {
    if (!resource.ownershipVerified) await verifyNetworkOwnership(state, resource, signal);
    const inspection = await mustRun(
      state,
      ["network", "inspect", resource.id],
      signal,
      `${resource.role} Docker network empty inspection`,
      4 * 1024 * 1024,
    );
    parseDockerNetworkInspection(inspection.stdout, {
      id: resource.id,
      name: resource.plan.name,
      internal: resource.plan.internal,
      labels: resource.plan.labels,
      containerIds: [],
    });
    const removed = await mustRun(
      state,
      ["network", "rm", resource.id],
      signal,
      `${resource.role} Docker network removal`,
    );
    if (removed.stderr.trim().length !== 0 || removed.stdout.trim() !== resource.id) {
      throw new Error("Docker network removal returned an unexpected identity.");
    }
  }
  resource.creationSideEffectUnresolved = false;
  await assertNetworkAbsent(state, resource, signal);
  resource.removed = true;
}

async function recoverFailedDockerNetworkCreation(
  state: DockerOwnerState,
  resource: DockerNetworkResourceState,
  signal: AbortSignal,
  creationError: unknown,
): Promise<never> {
  resource.id = undefined;
  resource.ownershipVerified = false;
  resource.creationSideEffectUnresolved = true;
  let recovered: string[];
  try {
    recovered = await idsForExactNetworkName(state, resource.plan.name, signal);
  } catch (recoveryError) {
    throw new AggregateError(
      [creationError, recoveryError],
      `${resource.role} Docker network creation failed and recovery was incomplete.`,
    );
  }
  if (recovered.length === 0) {
    throw new AggregateError(
      [
        creationError,
        new Error(
          "Docker network creation side effects remain unresolved after an empty exact-name observation.",
        ),
      ],
      `${resource.role} Docker network creation failed and recovery was inconclusive.`,
    );
  }
  try {
    if (recovered.length !== 1 || !/^[0-9a-f]{64}$/u.test(recovered[0]!)) {
      throw new Error("Docker network recovery did not find one exact identity.");
    }
    resource.id = recovered[0]!;
    await verifyNetworkOwnership(state, resource, signal);
    await removeNetworkResource(state, resource, signal);
  } catch (recoveryError) {
    throw new AggregateError(
      [creationError, recoveryError],
      `${resource.role} Docker network creation failed and recovery was incomplete.`,
    );
  }
  throw creationError;
}

async function verifyResourceOwnership(
  state: DockerOwnerState,
  resource: DockerResourceState,
  signal: AbortSignal,
) {
  const id = resource.id;
  if (id === undefined) throw new Error("The Docker resource ID is unavailable.");
  const ownership = await mustRun(
    state,
    ["container", "inspect", id],
    signal,
    `${resource.role} Docker ownership inspection`,
    4 * 1024 * 1024,
  );
  parseDockerContainerOwnershipInspection(ownership.stdout, {
    id,
    name: requiredRolePlan(resource).name,
    labels: requiredRolePlan(resource).labels,
  });
  resource.ownershipVerified = true;
}

async function recoverFailedDockerCreation(
  owner: PrivateLiveLinuxDockerOwner,
  state: DockerOwnerState,
  resource: DockerResourceState,
  signal: AbortSignal,
  creationError: unknown,
): Promise<never> {
  resource.id = undefined;
  resource.ownershipVerified = false;
  resource.creationSideEffectUnresolved = true;
  let recovered: string[];
  try {
    recovered = await idsForExactName(state, resource.sealedPlan.name, signal);
  } catch (recoveryError) {
    throw new AggregateError(
      [creationError, recoveryError],
      `${resource.role} Docker creation failed and recovery was incomplete.`,
    );
  }
  if (recovered.length === 0) {
    throw new AggregateError(
      [
        creationError,
        new Error(
          "Docker container creation side effects remain unresolved after an empty exact-name observation.",
        ),
      ],
      `${resource.role} Docker creation failed and recovery was inconclusive.`,
    );
  }
  try {
    if (recovered.length !== 1 || !/^[0-9a-f]{64}$/u.test(recovered[0]!)) {
      throw new Error("Docker creation recovery did not find one exact container identity.");
    }
    resource.id = recovered[0]!;
    await verifyResourceOwnership(state, resource, signal);
    await removePrivateLiveLinuxOwnedDockerRole(owner, resource.role, signal);
  } catch (recoveryError) {
    throw new AggregateError(
      [creationError, recoveryError],
      `${resource.role} Docker creation failed and recovery was incomplete.`,
    );
  }
  throw creationError;
}

export function createPrivateLiveLinuxDockerOwner(options: {
  runner: DockerCommandRunner;
  lifecyclePlan: SupervisorDockerLifecyclePlan;
  barrierController: PrivateLinuxStartBarrierController;
  preparedBarriers: Readonly<
    Record<LinuxCgroupHelperRole, PrivatePreparedLinuxStartBarrierRole>
  >;
}): PrivateLiveLinuxDockerOwner {
  assertPrivateDockerCliCommandRunner(options.runner);
  assertFactoryIssuedSupervisorDockerLifecyclePlan(options.lifecyclePlan);
  assertPrivateLinuxStartBarrierController(options.barrierController);
  const runBindingSha256 = options.lifecyclePlan.ownership.bindingSha256;
  if (runBindingSha256 !== options.barrierController.runBindingSha256) {
    throw new Error("The private Docker owner run binding is invalid.");
  }
  for (const role of ROLE_ORDER) {
    const prepared = options.preparedBarriers[role];
    assertPrivatePreparedLinuxStartBarrierRole(options.barrierController, prepared);
    if (
      prepared.roleProtocol.role !== role ||
      prepared.roleProtocol.runBindingSha256 !== runBindingSha256 ||
      options.lifecyclePlan[role].role !== role ||
      options.lifecyclePlan[role].labels["com.policytwin.binding-sha256"] !== runBindingSha256
    ) {
      throw new Error("The private Docker owner sealed role configuration is invalid.");
    }
  }
  const owner = Object.freeze({
    schemaVersion: "1" as const,
    status: "PRIVATE_DOCKER_OWNER_NOT_RUNTIME_VERIFIED" as const,
    runBindingSha256,
    nativeHelperBinarySha256: options.lifecyclePlan.nativeHelper.binarySha256,
    dynamicRuntimeVerified: false as const,
    liveEvidenceIssuanceEnabled: false as const,
    passSigningEligible: false as const,
  }) as unknown as PrivateLiveLinuxDockerOwner;
  const resources = new Map<LinuxCgroupHelperRole, DockerResourceState>();
  for (const role of ROLE_ORDER) {
    resources.set(role, {
      role,
      sealedPlan: options.lifecyclePlan[role],
      plan: undefined,
      id: undefined,
      ownershipVerified: false,
      runningObservation: undefined,
      capability: undefined,
      removalReceipt: undefined,
      startPromise: undefined,
      issuePromise: undefined,
      removalPromise: undefined,
      creationSideEffectUnresolved: false,
      removed: false,
    });
  }
  const networks = new Map<"worker" | "outbound", DockerNetworkResourceState>();
  for (const role of NETWORK_ORDER) {
    networks.set(role, {
      role,
      plan: options.lifecyclePlan.networks[role],
      id: undefined,
      ownershipVerified: false,
      creationSideEffectUnresolved: false,
      removed: false,
    });
  }
  dockerOwnerStates.set(owner, {
    owner,
    runner: options.runner,
    lifecyclePlan: options.lifecyclePlan,
    barrierController: options.barrierController,
    preparedBarriers: Object.freeze({ ...options.preparedBarriers }),
    plans: undefined,
    resources,
    networks,
    destroyed: false,
    containersCreated: false,
    creationPromise: undefined,
    networkRemovalPromise: undefined,
  });
  return owner;
}

export function assertPrivateLiveLinuxDockerOwner(
  value: unknown,
): asserts value is PrivateLiveLinuxDockerOwner {
  requiredOwnerState(value as PrivateLiveLinuxDockerOwner);
}

export function assertPrivateLiveLinuxDockerOwnerBarrierConfiguration(
  owner: PrivateLiveLinuxDockerOwner,
  barrierController: PrivateLinuxStartBarrierController,
  preparedBarriers: Readonly<
    Record<LinuxCgroupHelperRole, PrivatePreparedLinuxStartBarrierRole>
  >,
) {
  const state = requiredOwnerState(owner);
  if (
    state.barrierController !== barrierController ||
    ROLE_ORDER.some((role) => state.preparedBarriers[role] !== preparedBarriers[role])
  ) {
    throw new Error("The Docker owner barrier configuration is not the sealed owner identity.");
  }
}

async function createPrivateLiveLinuxOwnedDockerContainersOnce(
  owner: PrivateLiveLinuxDockerOwner,
  signal: AbortSignal,
) {
  const state = requiredOwnerState(owner);
  if (process.platform !== "linux") {
    throw new Error("The private Docker owner requires a Linux supervisor.");
  }
  if (state.containersCreated) throw new Error("The owned Docker containers were already created.");
  for (const role of NETWORK_ORDER) {
    const network = state.networks.get(role)!;
    if ((await idsForExactNetworkName(state, network.plan.name, signal)).length !== 0) {
      throw new Error("A private Docker network name already exists.");
    }
  }
  for (const role of ROLE_ORDER) {
    const resource = state.resources.get(role)!;
    if ((await idsForExactName(state, resource.sealedPlan.name, signal)).length !== 0) {
      throw new Error("A private Docker role name already exists.");
    }
  }
  for (const role of NETWORK_ORDER) {
    const network = state.networks.get(role)!;
    network.creationSideEffectUnresolved = true;
    try {
      const created = await mustRun(
        state,
        network.plan.createArgs,
        signal,
        `${role} Docker network creation`,
      );
      if (created.stderr.trim().length !== 0) {
        throw new Error("Docker network creation returned unexpected diagnostic output.");
      }
      network.id = parseCreatedDockerId(created.stdout, `${role} Docker network creation`);
      await verifyNetworkOwnership(state, network, signal);
      network.creationSideEffectUnresolved = false;
    } catch (error) {
      await recoverFailedDockerNetworkCreation(
        state,
        network,
        AbortSignal.timeout(CONTROL_TIMEOUT_MS),
        error,
      );
    }
  }
  const workerNetwork = state.networks.get("worker")!;
  const outboundNetwork = state.networks.get("outbound")!;
  if (
    workerNetwork.id === undefined ||
    outboundNetwork.id === undefined ||
    !workerNetwork.ownershipVerified ||
    !outboundNetwork.ownershipVerified
  ) {
    throw new Error("The private Docker networks are not independently owned and observed.");
  }
  const observedNetworkIds = Object.freeze({
    worker: workerNetwork.id,
    outbound: outboundNetwork.id,
  });
  const plans = Object.freeze({
    egress: buildLiveLinuxBarrierDockerRolePlan(state.barrierController, {
      role: "egress",
      lifecyclePlan: state.lifecyclePlan,
      observedNetworkIds,
      preparedBarrier: state.preparedBarriers.egress,
    }),
    worker: buildLiveLinuxBarrierDockerRolePlan(state.barrierController, {
      role: "worker",
      lifecyclePlan: state.lifecyclePlan,
      observedNetworkIds,
      preparedBarrier: state.preparedBarriers.worker,
    }),
    verifier: buildLiveLinuxBarrierDockerRolePlan(state.barrierController, {
      role: "verifier",
      lifecyclePlan: state.lifecyclePlan,
      observedNetworkIds,
      preparedBarrier: state.preparedBarriers.verifier,
    }),
  });
  for (const role of ROLE_ORDER) {
    const plan = plans[role];
    assertPrivateLiveLinuxBarrierDockerRolePlan(plan);
    state.resources.get(role)!.plan = plan;
  }
  state.plans = plans;
  for (const role of ROLE_ORDER) {
    const resource = state.resources.get(role)!;
    const plan = requiredRolePlan(resource);
    resource.creationSideEffectUnresolved = true;
    try {
      const created = await mustRun(
        state,
        plan.createArgs,
        signal,
        `${role} Docker container creation`,
      );
      if (created.stderr.trim().length !== 0) {
        throw new Error("Docker container creation returned unexpected diagnostic output.");
      }
      resource.id = parseCreatedDockerId(created.stdout, `${role} Docker container creation`);
      await verifyResourceOwnership(state, resource, signal);
      resource.creationSideEffectUnresolved = false;
    } catch (error) {
      await recoverFailedDockerCreation(
        owner,
        state,
        resource,
        AbortSignal.timeout(CONTROL_TIMEOUT_MS),
        error,
      );
    }
  }
  for (const role of ROLE_ORDER) {
    const resource = state.resources.get(role)!;
    const plan = requiredRolePlan(resource);
    const id = resource.id!;
    const creationId =
      plan.creationNetwork === "none" ? undefined : plan.creationNetwork.id;
    for (const network of plan.networks) {
      if (network.id === creationId) continue;
      const connected = await mustRun(
        state,
        [
          "network",
          "connect",
          ...network.requiredAliases.flatMap((alias) => ["--alias", alias]),
          network.id,
          id,
        ],
        signal,
        `${role} Docker network connection`,
      );
      assertEmptyOutput(connected, `${role} Docker network connection`);
    }
    const initial = await observe(state, resource, signal);
    if (
      initial.running ||
      initial.pid !== 0 ||
      initial.startedAt !== "0001-01-01T00:00:00Z" ||
      initial.restartCount !== 0
    ) {
      throw new Error("An owned Docker role executed before its explicit barrier-held start.");
    }
  }
  state.containersCreated = true;
}

export async function createPrivateLiveLinuxOwnedDockerContainers(
  owner: PrivateLiveLinuxDockerOwner,
  signal: AbortSignal,
) {
  const state = requiredOwnerState(owner);
  if (state.creationPromise !== undefined) return await state.creationPromise;
  const creationPromise = createPrivateLiveLinuxOwnedDockerContainersOnce(owner, signal);
  state.creationPromise = creationPromise;
  return await creationPromise;
}

export async function settlePrivateLiveLinuxDockerOwnerOperations(
  owner: PrivateLiveLinuxDockerOwner,
) {
  const state = requiredOwnerState(owner);
  if (state.creationPromise !== undefined) {
    await state.creationPromise.catch(() => undefined);
  }
  for (const resource of state.resources.values()) {
    if (resource.startPromise !== undefined) {
      await resource.startPromise.catch(() => undefined);
    }
    if (resource.issuePromise !== undefined) {
      await resource.issuePromise.catch(() => undefined);
    }
  }
}

export async function startPrivateLiveLinuxOwnedDockerRoleHeld(
  owner: PrivateLiveLinuxDockerOwner,
  role: LinuxCgroupHelperRole,
  signal: AbortSignal,
) {
  const { state, resource } = requiredResource(owner, role);
  if (!state.containersCreated || resource.id === undefined || resource.removed) {
    throw new Error("The owned Docker role is unavailable for start.");
  }
  if (resource.startPromise !== undefined) return await resource.startPromise;
  if (resource.runningObservation !== undefined) {
    throw new Error("The owned Docker role was already started.");
  }
  const startPromise = (async () => {
    const started = await mustRun(state, ["start", resource.id!], signal, `${role} Docker start`);
    if (started.stderr.trim().length !== 0 || started.stdout.trim() !== resource.id) {
      throw new Error("Docker start returned an unexpected identity.");
    }
    const observation = await observe(state, resource, signal);
    if (
      !observation.running ||
      observation.pid < 1 ||
      observation.startedAt === "0001-01-01T00:00:00Z" ||
      observation.restartCount !== 0
    ) {
      throw new Error("The owned Docker role did not enter one running instance.");
    }
    resource.runningObservation = observation;
  })();
  resource.startPromise = startPromise;
  return await startPromise;
}

export async function issuePrivateLiveLinuxOwnedDockerRole(
  owner: PrivateLiveLinuxDockerOwner,
  role: LinuxCgroupHelperRole,
  signal: AbortSignal,
): Promise<PrivateLiveLinuxOwnedDockerRole> {
  const { state, resource } = requiredResource(owner, role);
  if (resource.issuePromise !== undefined) return await resource.issuePromise;
  if (resource.capability !== undefined) throw new Error(`The ${role} Docker role was already issued.`);
  const issuePromise = (async () => {
    if (resource.startPromise !== undefined) await resource.startPromise;
    if (resource.removalPromise !== undefined || resource.removed) {
      throw new Error("The Docker role cannot be issued during removal.");
    }
    const observation = await observe(state, resource, signal);
    const started = resource.runningObservation;
    if (
      started === undefined ||
      !observation.running ||
      observation.id !== started.id ||
      observation.pid !== started.pid ||
      observation.startedAt !== started.startedAt ||
      observation.restartCount !== 0
    ) {
      throw new Error("The running Docker role changed before ownership issuance.");
    }
    const capability = Object.freeze({
      schemaVersion: "1" as const,
      status: "PRIVATE_DOCKER_ROLE_OBSERVED_NOT_RUNTIME_VERIFIED" as const,
      role,
      runBindingSha256: owner.runBindingSha256,
      dynamicRuntimeVerified: false as const,
      liveEvidenceIssuanceEnabled: false as const,
      passSigningEligible: false as const,
    }) as unknown as PrivateLiveLinuxOwnedDockerRole;
    const roleState: OwnedRoleState = {
      ownerState: state,
      resource,
      capability,
      containerId: observation.id,
      pid: observation.pid,
      startedAt: observation.startedAt,
    };
    ownedRoleStates.set(capability, roleState);
    resource.capability = capability;
    return capability;
  })();
  resource.issuePromise = issuePromise;
  return await issuePromise;
}

export function assertPrivateLiveLinuxOwnedDockerRole(
  owner: PrivateLiveLinuxDockerOwner,
  value: unknown,
): asserts value is PrivateLiveLinuxOwnedDockerRole {
  requiredOwnedRoleState(owner, value as PrivateLiveLinuxOwnedDockerRole);
}

export async function reobservePrivateLiveLinuxOwnedDockerRole(
  owner: PrivateLiveLinuxDockerOwner,
  role: PrivateLiveLinuxOwnedDockerRole,
  signal: AbortSignal,
): Promise<PrivateLiveLinuxDockerReobservation> {
  const roleState = requiredOwnedRoleState(owner, role);
  const observation = await observe(roleState.ownerState, roleState.resource, signal);
  if (
    !observation.running ||
    observation.id !== roleState.containerId ||
    observation.pid !== roleState.pid ||
    observation.startedAt !== roleState.startedAt ||
    observation.restartCount !== 0
  ) {
    throw new Error("The running Docker role instance changed after ownership issuance.");
  }
  const receipt = Object.freeze({
    schemaVersion: "1" as const,
    status: "RUNNING_IDENTITY_REOBSERVED_NOT_RUNTIME_VERIFIED" as const,
    role: role.role,
  }) as unknown as PrivateLiveLinuxDockerReobservation;
  reobservationStates.set(receipt, {
    ownerState: roleState.ownerState,
    roleState,
    receipt,
    containerId: observation.id,
    pid: observation.pid,
    startedAt: observation.startedAt,
    consumed: false,
  });
  return receipt;
}

export function consumePrivateLiveLinuxDockerHelperBindIdentity(
  owner: PrivateLiveLinuxDockerOwner,
  role: PrivateLiveLinuxOwnedDockerRole,
  receipt: PrivateLiveLinuxDockerReobservation,
) {
  const roleState = requiredOwnedRoleState(owner, role);
  const receiptState =
    typeof receipt === "object" && receipt !== null ? reobservationStates.get(receipt) : undefined;
  if (
    receiptState === undefined ||
    receiptState.ownerState !== roleState.ownerState ||
    receiptState.roleState !== roleState ||
    receiptState.consumed
  ) {
    throw new Error("The Docker helper-bind reobservation receipt is invalid or consumed.");
  }
  receiptState.consumed = true;
  return Object.freeze({
    role: roleState.resource.role,
    containerId: receiptState.containerId,
    pid: receiptState.pid,
    startedAt: receiptState.startedAt,
    runBindingSha256: owner.runBindingSha256,
  });
}

export async function waitPrivateLiveLinuxOwnedDockerRoleExit(
  owner: PrivateLiveLinuxDockerOwner,
  role: PrivateLiveLinuxOwnedDockerRole,
  signal: AbortSignal,
) {
  const roleState = requiredOwnedRoleState(owner, role);
  const waited = await mustRun(
    roleState.ownerState,
    ["wait", roleState.containerId],
    signal,
    `${role.role} Docker wait`,
  );
  if (waited.stdout.trim() !== "0" || waited.stderr.trim().length !== 0) {
    throw new Error(`${role.role} Docker execution exited unsuccessfully.`);
  }
}

export async function stopPrivateLiveLinuxOwnedDockerRole(
  owner: PrivateLiveLinuxDockerOwner,
  role: PrivateLiveLinuxOwnedDockerRole,
  signal: AbortSignal,
) {
  const roleState = requiredOwnedRoleState(owner, role);
  const observation = await observe(roleState.ownerState, roleState.resource, signal);
  if (!observation.running) return;
  const stopped = await mustRun(
    roleState.ownerState,
    ["stop", "--time", "5", roleState.containerId],
    signal,
    `${role.role} Docker stop`,
  );
  if (stopped.stderr.trim().length !== 0 || stopped.stdout.trim() !== roleState.containerId) {
    throw new Error("Docker stop returned an unexpected identity.");
  }
}

export async function removePrivateLiveLinuxOwnedDockerRole(
  owner: PrivateLiveLinuxDockerOwner,
  role: LinuxCgroupHelperRole,
  signal: AbortSignal,
): Promise<PrivateLiveLinuxDockerRemovalReceipt> {
  const { state, resource } = requiredResource(owner, role);
  if (resource.removalReceipt !== undefined) return resource.removalReceipt;
  if (resource.removalPromise !== undefined) return await resource.removalPromise;
  const removalPromise = (async () => {
    if (resource.startPromise !== undefined) {
      await resource.startPromise.catch(() => undefined);
    }
    if (resource.issuePromise !== undefined) {
      await resource.issuePromise.catch(() => undefined);
    }
    if (resource.creationSideEffectUnresolved) {
      resource.id = undefined;
      resource.ownershipVerified = false;
      const recovered = await idsForExactName(state, resource.sealedPlan.name, signal);
      if (recovered.length === 0) {
        throw new Error(
          "Docker container creation side effects remain unresolved after an empty exact-name observation.",
        );
      } else if (recovered.length === 1 && /^[0-9a-f]{64}$/u.test(recovered[0]!)) {
        resource.id = recovered[0]!;
        await verifyResourceOwnership(state, resource, signal);
      } else {
        throw new Error("Docker creation side effects remain unresolved.");
      }
    }
    if (resource.id !== undefined) {
      if (!resource.ownershipVerified) {
        await verifyResourceOwnership(state, resource, signal);
      }
      const removed = await mustRun(
        state,
        ["rm", "--force", resource.id],
        signal,
        `${role} Docker removal`,
      );
      if (removed.stderr.trim().length !== 0 || removed.stdout.trim() !== resource.id) {
        throw new Error("Docker removal returned an unexpected identity.");
      }
    }
    await assertAbsent(state, resource, signal);
    resource.creationSideEffectUnresolved = false;
    resource.removed = true;
    const receipt = Object.freeze({
      schemaVersion: "1" as const,
      status: "DOCKER_ROLE_ABSENCE_REOBSERVED_NOT_RUNTIME_VERIFIED" as const,
      role,
    }) as unknown as PrivateLiveLinuxDockerRemovalReceipt;
    removalReceiptStates.set(receipt, { ownerState: state, resource, receipt });
    resource.removalReceipt = receipt;
    return receipt;
  })();
  resource.removalPromise = removalPromise;
  try {
    return await removalPromise;
  } catch (error) {
    resource.removalPromise = undefined;
    throw error;
  }
}

export function assertPrivateLiveLinuxDockerRemovalReceipt(
  owner: PrivateLiveLinuxDockerOwner,
  role: PrivateLiveLinuxOwnedDockerRole,
  receipt: PrivateLiveLinuxDockerRemovalReceipt,
) {
  const ownerState = requiredOwnerState(owner);
  const roleState = ownedRoleStates.get(role);
  const receiptState = removalReceiptStates.get(receipt);
  if (
    roleState === undefined ||
    roleState.ownerState !== ownerState ||
    receiptState === undefined ||
    receiptState.ownerState !== ownerState ||
    receiptState.resource !== roleState.resource ||
    !roleState.resource.removed
  ) {
    throw new Error("The Docker role removal receipt is invalid.");
  }
}

export async function removePrivateLiveLinuxOwnedDockerNetworks(
  owner: PrivateLiveLinuxDockerOwner,
  signal: AbortSignal,
) {
  const state = requiredOwnerState(owner);
  if (state.networkRemovalPromise !== undefined) return await state.networkRemovalPromise;
  const removalPromise = (async () => {
    if (state.creationPromise !== undefined) {
      await state.creationPromise.catch(() => undefined);
    }
    if (
      [...state.resources.values()].some(
        (resource) => !resource.removed || resource.removalReceipt === undefined,
      )
    ) {
      throw new Error("Docker networks cannot be removed before every role is absent.");
    }
    for (const role of [...NETWORK_ORDER].reverse()) {
      await removeNetworkResource(state, state.networks.get(role)!, signal);
    }
  })();
  state.networkRemovalPromise = removalPromise;
  try {
    await removalPromise;
  } catch (error) {
    state.networkRemovalPromise = undefined;
    throw error;
  }
}

export async function finalizePrivateLiveLinuxDockerCleanupReceipt(
  owner: PrivateLiveLinuxDockerOwner,
  signal: AbortSignal,
): Promise<PrivateLiveLinuxDockerCleanupReceipt> {
  const state = requiredOwnerState(owner);
  for (const role of ROLE_ORDER) {
    const resource = state.resources.get(role)!;
    if (!resource.removed || resource.removalReceipt === undefined) {
      throw new Error("The Docker cleanup receipt requires all roles to be removed.");
    }
    await assertAbsent(state, resource, signal);
  }
  await removePrivateLiveLinuxOwnedDockerNetworks(owner, signal);
  for (const role of NETWORK_ORDER) {
    const network = state.networks.get(role)!;
    if (!network.removed) {
      throw new Error("The Docker cleanup receipt requires all networks to be removed.");
    }
    await assertNetworkAbsent(state, network, signal);
  }
  const receipt = Object.freeze({
    schemaVersion: "1" as const,
    status: "ALL_DOCKER_ROLE_ABSENCE_REOBSERVED_NOT_RUNTIME_VERIFIED" as const,
    dynamicRuntimeVerified: false as const,
  }) as unknown as PrivateLiveLinuxDockerCleanupReceipt;
  cleanupReceiptStates.set(receipt, { ownerState: state, receipt });
  return receipt;
}

export function assertPrivateLiveLinuxDockerCleanupReceipt(
  owner: PrivateLiveLinuxDockerOwner,
  receipt: PrivateLiveLinuxDockerCleanupReceipt,
) {
  const ownerState = requiredOwnerState(owner);
  const receiptState = cleanupReceiptStates.get(receipt);
  if (receiptState === undefined || receiptState.ownerState !== ownerState) {
    throw new Error("The all-role Docker cleanup receipt is invalid.");
  }
}

export function destroyPrivateLiveLinuxDockerOwner(owner: PrivateLiveLinuxDockerOwner) {
  const state = requiredOwnerState(owner);
  if (
    [...state.resources.values()].some(
      (resource) =>
        !resource.removed ||
        resource.removalReceipt === undefined ||
        resource.creationSideEffectUnresolved,
    ) ||
    [...state.networks.values()].some(
      (network) => !network.removed || network.creationSideEffectUnresolved,
    )
  ) {
    throw new Error("The private Docker owner cannot close while an owned resource remains.");
  }
  state.destroyed = true;
}
