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
  type WorkerContainerInvocation,
} from "./worker-runtime-contract.js";

const IMMUTABLE_IMAGE = /^sha256:[0-9a-f]{64}$/u;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/u;
const WORKER_NETWORK = "policytwin-worker-internal";
const OUTBOUND_NETWORK = "policytwin-egress-outbound";

export interface EgressProxySecretMounts {
  tlsCertificatePath: string;
  tlsPrivateKeyPath: string;
  leasePath: string;
  providerCredentialPath: string;
}

export interface SupervisorDockerProcessPlan {
  name: string;
  createArgs: readonly string[];
  startArgs: readonly string[];
  waitArgs: readonly string[];
  logsArgs: readonly string[];
  stopArgs: readonly string[];
  removeArgs: readonly string[];
}

export interface SupervisorDockerLifecyclePlan {
  schemaVersion: "1";
  status: "STATIC_PLAN_ONLY";
  dynamicIsolationVerified: false;
  liveCodexExecuted: false;
  workerNetwork: typeof WORKER_NETWORK;
  outboundNetwork: typeof OUTBOUND_NETWORK;
  networkInspectArgs: readonly (readonly string[])[];
  executionOrder: readonly string[];
  cleanupOrder: readonly string[];
  egressConnectInternalArgs: readonly string[];
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

function explicitProcessPlan(invocation: WorkerContainerInvocation): SupervisorDockerProcessPlan {
  if (
    invocation.dockerArgs[0] !== "run" ||
    invocation.dockerArgs[1] !== "--rm" ||
    invocation.dockerArgs.at(-1) !== invocation.image
  ) {
    throw new Error("The static container invocation cannot be converted safely.");
  }
  return {
    name: invocation.name,
    createArgs: ["create", ...invocation.dockerArgs.slice(2)],
    startArgs: ["start", invocation.name],
    waitArgs: ["wait", invocation.name],
    logsArgs: ["logs", "--stdout", "--stderr", invocation.name],
    stopArgs: ["stop", "--time", "5", invocation.name],
    removeArgs: ["rm", "--force", invocation.name],
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
  egressSecrets: EgressProxySecretMounts;
}): SupervisorDockerLifecyclePlan {
  if (!RUN_ID.test(options.runId)) throw new Error("The lifecycle run ID is invalid.");
  const egressProxyImage = immutableImage(options.egressProxyImage, "Egress proxy image");
  const runtime = buildWorkerRuntimePlan(options);
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

  const egressName = `policytwin-egress-${options.runId}`;
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
    "--cpus",
    "0.5",
    "--stop-timeout",
    "5",
    "--network",
    OUTBOUND_NETWORK,
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
    schemaVersion: "1",
    status: "STATIC_PLAN_ONLY",
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
    workerNetwork: WORKER_NETWORK,
    outboundNetwork: OUTBOUND_NETWORK,
    networkInspectArgs: [
      ["network", "inspect", WORKER_NETWORK],
      ["network", "inspect", OUTBOUND_NETWORK],
    ],
    executionOrder: [
      "EGRESS_CREATE",
      "EGRESS_CONNECT_INTERNAL",
      "EGRESS_START",
      "WORKER_CREATE",
      "WORKER_START",
      "WORKER_WAIT",
      "WORKER_LOGS",
      "WORKER_REMOVE",
      "EGRESS_STOP",
      "EGRESS_WAIT",
      "EGRESS_LOGS",
      "EGRESS_REMOVE",
      "VERIFIER_CREATE",
      "VERIFIER_START",
      "VERIFIER_WAIT",
      "VERIFIER_LOGS",
      "VERIFIER_REMOVE",
    ],
    cleanupOrder: [
      "VERIFIER_STOP_IF_PRESENT",
      "VERIFIER_REMOVE_IF_PRESENT",
      "WORKER_STOP_IF_PRESENT",
      "WORKER_REMOVE_IF_PRESENT",
      "EGRESS_STOP_IF_PRESENT",
      "EGRESS_REMOVE_IF_PRESENT",
      "DELETE_VERIFICATION_WORKSPACE",
      "DELETE_REPAIR_WORKSPACE",
      "OBSERVE_ZERO_REMAINING_PROCESSES",
    ],
    egressConnectInternalArgs: [
      "network",
      "connect",
      "--alias",
      "policytwin-egress",
      WORKER_NETWORK,
      egressName,
    ],
    egress: {
      name: egressName,
      createArgs: egressCreateArgs,
      startArgs: ["start", egressName],
      waitArgs: ["wait", egressName],
      logsArgs: ["logs", "--stdout", "--stderr", egressName],
      stopArgs: ["stop", "--time", "5", egressName],
      removeArgs: ["rm", "--force", egressName],
    },
    worker: explicitProcessPlan(runtime.worker),
    verifier: explicitProcessPlan(runtime.verifier),
  };
}
