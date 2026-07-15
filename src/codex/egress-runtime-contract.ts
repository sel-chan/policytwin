import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  OpenAiEgressLeaseGuard,
  type OpenAiEgressLease,
} from "./openai-egress-contract.js";
import {
  buildWorkerRuntimePlan,
  createWorkerRuntimeLayout,
  deriveSupervisorDockerResourceSuffix,
  supervisorDockerBindingSha256,
  type WorkerContainerInvocation,
  type WorkerRuntimeMount,
  type WorkerRuntimeResourceLimits,
  type WorkerRuntimeTmpfsMount,
} from "./worker-runtime-contract.js";

const IMMUTABLE_IMAGE = /^sha256:[0-9a-f]{64}$/u;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/u;
const OWNERSHIP_NONCE = /^[0-9a-f]{32}$/u;
export const OBSERVED_OUTBOUND_NETWORK_ID = "__POLICYTWIN_OUTBOUND_NETWORK_ID__" as const;

export interface EgressProxySecretMounts {
  tlsCertificatePath: string;
  tlsPrivateKeyPath: string;
  leasePath: string;
  providerCredentialPath: string;
}

export interface SupervisorDockerProcessPlan {
  role: "egress" | "worker" | "verifier";
  name: string;
  image: string;
  creationNetwork: "worker" | "outbound" | "none";
  user: string;
  entrypoint: readonly string[];
  workingDirectory: string;
  labels: Readonly<Record<string, string>>;
  environment: Readonly<Record<string, string>>;
  imageEnvironment: Readonly<Record<string, string>>;
  mounts: readonly WorkerRuntimeMount[];
  tmpfsMounts: readonly WorkerRuntimeTmpfsMount[];
  pidsLimit: number;
  memoryBytes: number;
  memorySwapBytes: number;
  nanoCpus: number;
  fileSizeLimitBytes: number;
  logDriver: "local";
  logOptions: Readonly<Record<string, string>>;
  wallTimeMs: number;
  cpuTimeMs: number;
  outputBytes: number;
  cpuTimeEnforcement: "UNAVAILABLE_STATIC_DRIVER";
  commandArgs: readonly string[];
  createArgs: readonly string[];
  attachments: readonly {
    network: "worker" | "outbound";
    aliases: readonly string[];
  }[];
  operateByObservedId: true;
}

export interface SupervisorDockerNetworkPlan {
  name: string;
  role: "worker-internal" | "egress-outbound";
  internal: boolean;
  labels: Readonly<Record<string, string>>;
  createArgs: readonly string[];
  operateByObservedId: true;
}

export interface SupervisorDockerLifecyclePlan {
  schemaVersion: "2";
  status: "STATIC_PLAN_ONLY";
  dynamicIsolationVerified: false;
  liveCodexExecuted: false;
  ownership: {
    runId: string;
    nonce: string;
    requestSha256: string;
    bindingSha256: string;
  };
  workerNetwork: string;
  outboundNetwork: string;
  networks: {
    worker: SupervisorDockerNetworkPlan;
    outbound: SupervisorDockerNetworkPlan;
  };
  executionOrder: readonly string[];
  cleanupOrder: readonly string[];
  egress: SupervisorDockerProcessPlan;
  worker: SupervisorDockerProcessPlan;
  verifier: SupervisorDockerProcessPlan;
}

function assertRegularFile(path: string, maximumBytes: number, label: string): string {
  if (!isAbsolute(path) || /[,\r\n\0]/u.test(path)) {
    throw new Error(`${label} path is unsafe.`);
  }
  const resolved = resolve(path);
  const stat = lstatSync(resolved);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > maximumBytes ||
    realpathSync.native(resolved) !== resolved
  ) {
    throw new Error(`${label} mount is unsafe.`);
  }
  return resolved;
}

function assertOutsideRepository(repositoryRoot: string, path: string, label: string): void {
  const relativePath = relative(resolve(repositoryRoot), path);
  if (relativePath.length === 0 || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    throw new Error(`${label} must remain outside the repository.`);
  }
}

function immutableImage(value: string, label: string): string {
  if (!IMMUTABLE_IMAGE.test(value)) {
    throw new Error(`${label} must be an immutable local image ID.`);
  }
  return value;
}

function bindMount(source: string, target: string): string {
  return `type=bind,source=${source},target=${target},readonly`;
}

function labelArguments(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

function networkPlan(options: {
  name: string;
  runId: string;
  requestSha256: string;
  bindingSha256: string;
  role: "worker-internal" | "egress-outbound";
  internal: boolean;
}): SupervisorDockerNetworkPlan {
  const labels = {
    "com.policytwin.managed": "true",
    "com.policytwin.contract-version": "2",
    "com.policytwin.binding-sha256": options.bindingSha256,
    "com.policytwin.request-sha256": options.requestSha256,
    "com.policytwin.run-id": options.runId,
    "com.policytwin.role": options.role,
  } as const;
  return {
    name: options.name,
    role: options.role,
    internal: options.internal,
    labels,
    createArgs: [
      "network",
      "create",
      "--driver",
      "bridge",
      "--scope",
      "local",
      "--attachable=false",
      ...(options.internal ? ["--internal"] : []),
      ...labelArguments(labels),
      options.name,
    ],
    operateByObservedId: true,
  };
}

function explicitProcessPlan(
  invocation: WorkerContainerInvocation,
  role: "worker" | "verifier",
  attachments: SupervisorDockerProcessPlan["attachments"],
): SupervisorDockerProcessPlan {
  const imageIndex = invocation.dockerArgs.indexOf(invocation.image);
  if (
    invocation.dockerArgs[0] !== "run" ||
    invocation.dockerArgs[1] !== "--rm" ||
    imageIndex < 2 ||
    imageIndex !== invocation.dockerArgs.length - invocation.commandArgs.length - 1 ||
    invocation.commandArgs.some(
      (argument, index) => invocation.dockerArgs[imageIndex + index + 1] !== argument,
    )
  ) {
    throw new Error("The static container invocation cannot be converted safely.");
  }
  return {
    role,
    name: invocation.name,
    image: invocation.image,
    creationNetwork: invocation.creationNetwork,
    user: invocation.user,
    entrypoint: invocation.entrypoint,
    workingDirectory: invocation.workingDirectory,
    labels: invocation.labels,
    environment: invocation.environment,
    imageEnvironment: invocation.imageEnvironment,
    mounts: invocation.mounts,
    tmpfsMounts: invocation.tmpfsMounts,
    pidsLimit: invocation.pidsLimit,
    memoryBytes: invocation.memoryBytes,
    memorySwapBytes: invocation.memorySwapBytes,
    nanoCpus: invocation.nanoCpus,
    fileSizeLimitBytes: invocation.fileSizeLimitBytes,
    logDriver: invocation.logDriver,
    logOptions: invocation.logOptions,
    wallTimeMs: invocation.wallTimeMs,
    cpuTimeMs: invocation.cpuTimeMs,
    outputBytes: invocation.outputBytes,
    cpuTimeEnforcement: invocation.cpuTimeEnforcement,
    commandArgs: invocation.commandArgs,
    createArgs: ["create", ...invocation.dockerArgs.slice(2)],
    attachments,
    operateByObservedId: true,
  };
}

function parseLease(path: string, runId: string, tokenSha256: string): void {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("The egress lease file is invalid.");
  }
  const lease = value as OpenAiEgressLease;
  new OpenAiEgressLeaseGuard(lease);
  if (lease.runId !== runId || lease.tokenSha256 !== tokenSha256) {
    throw new Error("The egress lease is not bound to the worker capability.");
  }
}

export function buildSupervisorDockerLifecyclePlan(options: {
  repositoryRoot: string;
  runId: string;
  workerImage: string;
  verifierImage: string;
  egressProxyImage: string;
  ownershipNonce: string;
  requestSha256: string;
  limits: WorkerRuntimeResourceLimits;
  egressSecrets: EgressProxySecretMounts;
}): SupervisorDockerLifecyclePlan {
  if (!RUN_ID.test(options.runId)) throw new Error("The lifecycle run ID is invalid.");
  if (!OWNERSHIP_NONCE.test(options.ownershipNonce)) {
    throw new Error("The lifecycle ownership nonce is invalid.");
  }
  const resourceSuffix = deriveSupervisorDockerResourceSuffix(
    options.requestSha256,
    options.runId,
    options.ownershipNonce,
  );
  const bindingSha256 = supervisorDockerBindingSha256(
    options.requestSha256,
    options.runId,
    options.ownershipNonce,
  );
  const workerNetwork = `policytwin-worker-${resourceSuffix}`;
  const outboundNetwork = `policytwin-egress-${resourceSuffix}`;
  const egressProxyImage = immutableImage(options.egressProxyImage, "Egress proxy image");
  const runtime = buildWorkerRuntimePlan({ ...options, workerNetwork });
  const layout = createWorkerRuntimeLayout(options);
  const tlsCertificatePath = assertRegularFile(
    options.egressSecrets.tlsCertificatePath,
    64 * 1024,
    "Egress TLS certificate",
  );
  const tlsPrivateKeyPath = assertRegularFile(
    options.egressSecrets.tlsPrivateKeyPath,
    64 * 1024,
    "Egress TLS private key",
  );
  const leasePath = assertRegularFile(
    options.egressSecrets.leasePath,
    16 * 1024,
    "Egress lease",
  );
  const providerCredentialPath = assertRegularFile(
    options.egressSecrets.providerCredentialPath,
    4_096,
    "Provider credential",
  );
  assertOutsideRepository(options.repositoryRoot, tlsPrivateKeyPath, "Egress TLS private key");
  assertOutsideRepository(options.repositoryRoot, tlsCertificatePath, "Egress TLS certificate");
  assertOutsideRepository(options.repositoryRoot, leasePath, "Egress lease");
  assertOutsideRepository(
    options.repositoryRoot,
    providerCredentialPath,
    "Provider credential",
  );
  const capability = readFileSync(layout.proxyTokenPath, "utf8").trimEnd();
  if (!CAPABILITY.test(capability)) throw new Error("The worker proxy capability is invalid.");
  const decoded = Buffer.from(capability, "base64url");
  const validCapability =
    decoded.byteLength === 32 && decoded.toString("base64url") === capability;
  decoded.fill(0);
  if (!validCapability) throw new Error("The worker proxy capability is invalid.");
  const tokenSha256 = createHash("sha256").update(capability, "utf8").digest("hex");
  parseLease(leasePath, options.runId, tokenSha256);

  const egressName = `policytwin-egress-${resourceSuffix}`;
  const egressLabels = {
    "com.policytwin.managed": "true",
    "com.policytwin.contract-version": "2",
    "com.policytwin.binding-sha256": bindingSha256,
    "com.policytwin.request-sha256": options.requestSha256,
    "com.policytwin.run-id": options.runId,
    "com.policytwin.role": "egress",
  } as const;
  const workerNetworkPlan = networkPlan({
    name: workerNetwork,
    runId: options.runId,
    requestSha256: options.requestSha256,
    bindingSha256,
    role: "worker-internal",
    internal: true,
  });
  const outboundNetworkPlan = networkPlan({
    name: outboundNetwork,
    runId: options.runId,
    requestSha256: options.requestSha256,
    bindingSha256,
    role: "egress-outbound",
    internal: false,
  });
  const egressCreateArgs = [
    "create",
    "--name",
    egressName,
    "--read-only",
    "--user",
    "10003:10003",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "32",
    "--memory",
    "268435456",
    "--memory-swap",
    "268435456",
    "--ulimit",
    "fsize=8388608:8388608",
    "--log-driver",
    "local",
    "--log-opt",
    "max-size=8388608",
    "--log-opt",
    "max-file=1",
    "--cpus",
    "0.5",
    "--stop-timeout",
    "5",
    "--network",
    OBSERVED_OUTBOUND_NETWORK_ID,
    ...labelArguments(egressLabels),
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16777216",
    "--mount",
    bindMount(
      tlsCertificatePath,
      "/run/secrets/policytwin-egress-tls-cert.pem",
    ),
    "--mount",
    bindMount(tlsPrivateKeyPath, "/run/secrets/policytwin-egress-tls-key.pem"),
    "--mount",
    bindMount(leasePath, "/run/secrets/policytwin-egress-lease.json"),
    "--mount",
    bindMount(providerCredentialPath, "/run/secrets/policytwin-openai-key"),
    egressProxyImage,
  ];
  return {
    schemaVersion: "2",
    status: "STATIC_PLAN_ONLY",
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
    ownership: {
      runId: options.runId,
      nonce: options.ownershipNonce,
      requestSha256: options.requestSha256,
      bindingSha256,
    },
    workerNetwork,
    outboundNetwork,
    networks: { worker: workerNetworkPlan, outbound: outboundNetworkPlan },
    executionOrder: [
      "ASSERT_RESOURCE_NAMES_ABSENT",
      "WORKER_NETWORK_CREATE",
      "OUTBOUND_NETWORK_CREATE",
      "NETWORKS_INSPECT_EMPTY",
      "EGRESS_CREATE_CAPTURE_ID",
      "EGRESS_CONNECT_OUTBOUND_BY_ID",
      "EGRESS_CONNECT_INTERNAL_BY_ID",
      "EGRESS_INSPECT_BY_ID",
      "EGRESS_START",
      "WORKER_CREATE_CAPTURE_ID",
      "WORKER_CONNECT_INTERNAL_BY_ID",
      "WORKER_INSPECT_BY_ID",
      "WORKER_START",
      "WORKER_WAIT",
      "WORKER_LOGS",
      "WORKER_DISCONNECT_INTERNAL_BY_ID",
      "WORKER_REMOVE_BY_ID",
      "EGRESS_STOP",
      "EGRESS_WAIT",
      "EGRESS_LOGS",
      "EGRESS_DISCONNECT_INTERNAL_BY_ID",
      "EGRESS_DISCONNECT_OUTBOUND_BY_ID",
      "EGRESS_REMOVE_BY_ID",
      "VERIFIER_CREATE_CAPTURE_ID",
      "VERIFIER_INSPECT_BY_ID",
      "VERIFIER_START",
      "VERIFIER_WAIT",
      "VERIFIER_LOGS",
      "VERIFIER_REMOVE_BY_ID",
    ],
    cleanupOrder: [
      "VERIFIER_STOP_IF_PRESENT",
      "VERIFIER_REMOVE_BY_OBSERVED_ID",
      "WORKER_STOP_IF_PRESENT",
      "WORKER_DISCONNECT_IF_OBSERVED",
      "WORKER_REMOVE_BY_OBSERVED_ID",
      "EGRESS_STOP_IF_PRESENT",
      "EGRESS_DISCONNECT_IF_OBSERVED",
      "EGRESS_REMOVE_BY_OBSERVED_ID",
      "NETWORKS_INSPECT_EMPTY",
      "OUTBOUND_NETWORK_REMOVE_BY_ID",
      "WORKER_NETWORK_REMOVE_BY_ID",
      "NETWORKS_INSPECT_ABSENT",
      "DELETE_VERIFICATION_WORKSPACE",
      "DELETE_REPAIR_WORKSPACE",
      "OBSERVE_ZERO_REMAINING_PROCESSES",
    ],
    egress: {
      role: "egress",
      name: egressName,
      image: egressProxyImage,
      creationNetwork: "outbound",
      user: "10003:10003",
      entrypoint: ["node", "scripts/openai-egress-proxy.mjs"],
      workingDirectory: "/opt/policytwin",
      labels: egressLabels,
      environment: {},
      imageEnvironment: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        NODE_VERSION: "22.22.2",
        YARN_VERSION: "1.22.22",
        NODE_ENV: "production",
      },
      mounts: [
        {
          source: tlsCertificatePath,
          target: "/run/secrets/policytwin-egress-tls-cert.pem",
          readOnly: true,
        },
        {
          source: tlsPrivateKeyPath,
          target: "/run/secrets/policytwin-egress-tls-key.pem",
          readOnly: true,
        },
        {
          source: leasePath,
          target: "/run/secrets/policytwin-egress-lease.json",
          readOnly: true,
        },
        {
          source: providerCredentialPath,
          target: "/run/secrets/policytwin-openai-key",
          readOnly: true,
        },
      ],
      tmpfsMounts: [{ target: "/tmp", sizeBytes: 16_777_216 }],
      pidsLimit: 32,
      memoryBytes: 268_435_456,
      memorySwapBytes: 268_435_456,
      nanoCpus: 500_000_000,
      fileSizeLimitBytes: 8_388_608,
      logDriver: "local",
      logOptions: Object.freeze({ "max-size": "8388608", "max-file": "1" }),
      wallTimeMs: options.limits.wallTimeMs,
      cpuTimeMs: options.limits.cpuTimeMs,
      outputBytes: 8 * 1024 * 1024,
      cpuTimeEnforcement: "UNAVAILABLE_STATIC_DRIVER",
      commandArgs: [],
      createArgs: egressCreateArgs,
      attachments: [
        { network: "outbound", aliases: [] },
        { network: "worker", aliases: ["policytwin-egress"] },
      ],
      operateByObservedId: true,
    },
    worker: explicitProcessPlan(
      runtime.worker,
      "worker",
      [{ network: "worker", aliases: [] }],
    ),
    verifier: explicitProcessPlan(runtime.verifier, "verifier", []),
  };
}
