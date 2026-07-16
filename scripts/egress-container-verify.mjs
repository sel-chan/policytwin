import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeContainerBuildInput } from "./container-build-inputs.mjs";
import {
  assertLinuxCgroupProcessTreeEmpty,
  observeLinuxCgroupV2,
} from "./linux-cgroup-observer.mjs";
import {
  prepareWorkerRunRoot,
  removeSafeWorkerRunRoot,
} from "./worker-container-verify.mjs";
import { ROOT } from "./process.mjs";
import { createPinnedDockerSync } from "./pinned-docker-cli.mjs";

const NODE_IMAGE = /^node:22\.22\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u;
const DOCKER_ID = /^[0-9a-f]{64}$/u;

export function inspectEgressContainerPrerequisites(
  contract,
  buildInputs = {
    worker: computeContainerBuildInput("worker"),
    egress: computeContainerBuildInput("egress"),
  },
) {
  const failures = [];
  if (contract?.schemaVersion !== "8") failures.push("container schema v8 is required");
  if (!NODE_IMAGE.test(contract?.nodeBaseImage ?? "")) {
    failures.push("immutable Node base image is unset");
  }
  if (contract?.workerBuildInputSha256 !== buildInputs.worker.sha256) {
    failures.push("worker build inputs do not match the contract");
  }
  if (contract?.egressProxyBuildInputSha256 !== buildInputs.egress.sha256) {
    failures.push("egress proxy build inputs do not match the contract");
  }
  if (
    contract?.supervisorDockerExecutor?.status !== "STATIC_FAKE_RUNNER_VERIFIED" ||
    contract?.supervisorDockerExecutor?.dynamicVerified !== false ||
    contract?.egressProxy?.dynamicVerified !== false ||
    contract?.egressProxy?.liveCodexExecuted !== false
  ) {
    failures.push("egress dynamic gate static boundary is invalid");
  }
  return { schemaVersion: "1", status: failures.length === 0 ? "PASS" : "FAIL", failures };
}

let pinnedDocker = null;

function docker(args, timeoutMs = 60_000, allowFailure = false) {
  if (pinnedDocker === null) throw new Error("The pinned Docker CLI is not initialized.");
  return pinnedDocker(args, timeoutMs, allowFailure);
}

function requiredId(value, label) {
  const id = value.trim();
  if (!DOCKER_ID.test(id)) throw new Error(`${label} did not return one canonical ID.`);
  return id;
}

function assertRunningContainerInstance(observation, label) {
  if (
    !observation.running ||
    observation.pid < 1 ||
    observation.startedAt === "0001-01-01T00:00:00Z" ||
    observation.restartCount !== 0
  ) {
    throw new Error(`${label} did not expose one valid zero-restart running instance.`);
  }
}

function assertSameRunningContainerInstance(expected, actual, label) {
  assertRunningContainerInstance(actual, label);
  if (
    actual.id !== expected.id ||
    actual.pid !== expected.pid ||
    actual.startedAt !== expected.startedAt
  ) {
    throw new Error(`${label} running container instance changed during the admitted probe.`);
  }
}

function assertStoppedSameContainerInstance(running, stopped, label) {
  if (
    stopped.id !== running.id ||
    stopped.running ||
    stopped.pid !== 0 ||
    stopped.startedAt !== running.startedAt ||
    stopped.restartCount !== 0
  ) {
    throw new Error(`${label} container instance changed before its result was trusted.`);
  }
}

function outputLines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function containerRoleAbsent(id, bindingSha256, role) {
  const inspected = id === null ? null : docker(["container", "inspect", id], 10_000, true);
  const listed = docker(
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
    10_000,
    true,
  );
  const listedById = id === null
    ? null
    : docker(
        ["ps", "--all", "--no-trunc", "--filter", `id=${id}`, "--format", "{{.ID}}"],
        10_000,
        true,
      );
  return (
    (inspected === null || (inspected.error === undefined && inspected.status !== 0)) &&
    (listedById === null ||
      (listedById.error === undefined &&
        listedById.status === 0 &&
        outputLines(listedById.stdout).length === 0)) &&
    listed.error === undefined &&
    listed.status === 0 &&
    outputLines(listed.stdout).length === 0
  );
}

function networkRoleAbsent(id, bindingSha256, role) {
  const inspected = id === null ? null : docker(["network", "inspect", id], 10_000, true);
  const listed = docker(
    [
      "network",
      "ls",
      "--no-trunc",
      "--filter",
      `label=com.policytwin.binding-sha256=${bindingSha256}`,
      "--filter",
      `label=com.policytwin.role=${role}`,
      "--format",
      "{{.ID}}",
    ],
    10_000,
    true,
  );
  const listedById = id === null
    ? null
    : docker(
        [
          "network",
          "ls",
          "--no-trunc",
          "--filter",
          `id=${id}`,
          "--format",
          "{{.ID}}",
        ],
        10_000,
        true,
      );
  return (
    (inspected === null || (inspected.error === undefined && inspected.status !== 0)) &&
    (listedById === null ||
      (listedById.error === undefined &&
        listedById.status === 0 &&
        outputLines(listedById.stdout).length === 0)) &&
    listed.error === undefined &&
    listed.status === 0 &&
    outputLines(listed.stdout).length === 0
  );
}

function imageTagAbsent(tag) {
  const inspected = docker(["image", "inspect", tag], 10_000, true);
  const listed = docker(
    ["image", "ls", "--no-trunc", "--filter", `reference=${tag}`, "--format", "{{.ID}}"],
    10_000,
    true,
  );
  return (
    inspected.error === undefined &&
    inspected.status !== 0 &&
    listed.error === undefined &&
    listed.status === 0 &&
    outputLines(listed.stdout).length === 0
  );
}

function assertReadableSecret(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > 64 * 1024 ||
    (stat.mode & 0o777) !== 0o444
  ) {
    throw new Error("An ephemeral egress secret has unsafe permissions.");
  }
}

function findOpenSsl() {
  const candidates = [
    process.env.OPENSSL_PATH,
    "openssl",
    process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe" : undefined,
    process.platform === "win32" ? "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe" : undefined,
    process.platform !== "win32" ? "/usr/bin/openssl" : undefined,
    process.platform !== "win32" ? "/usr/local/bin/openssl" : undefined,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const checked = spawnSync(candidate, ["version"], { encoding: "utf8", windowsHide: true });
    if (checked.status === 0) return candidate;
  }
  throw new Error("OpenSSL is required for the dynamic egress TLS probe.");
}

function openssl(executable, cwd, args) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("Ephemeral egress TLS certificate generation failed.");
  }
}

function createTlsMaterial(directory) {
  const executable = findOpenSsl();
  const caKey = "ca-key.pem";
  const caCert = "ca-cert.pem";
  const serverKey = "server-key.pem";
  const serverCsr = "server.csr";
  const serverCert = "server-cert.pem";
  const extensions = "server.ext";
  openssl(executable, directory, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    caKey,
    "-out",
    caCert,
    "-subj",
    "/CN=PolicyTwin Egress Dynamic CA",
    "-days",
    "2",
    "-sha256",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  writeFileSync(
    join(directory, extensions),
    [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=DNS:policytwin-egress",
      "",
    ].join("\n"),
    "utf8",
  );
  openssl(executable, directory, [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    serverKey,
    "-out",
    serverCsr,
    "-subj",
    "/CN=policytwin-egress",
    "-sha256",
  ]);
  openssl(executable, directory, [
    "x509",
    "-req",
    "-in",
    serverCsr,
    "-CA",
    caCert,
    "-CAkey",
    caKey,
    "-set_serial",
    "41001",
    "-out",
    serverCert,
    "-days",
    "2",
    "-sha256",
    "-extfile",
    extensions,
  ]);
  const certificatePath = join(directory, serverCert);
  for (const transient of [caKey, serverCsr, extensions]) {
    rmSync(join(directory, transient), { force: true });
  }
  return {
    caPath: join(directory, caCert),
    certificatePath,
    privateKeyPath: join(directory, serverKey),
    certificateSha256: new X509Certificate(readFileSync(certificatePath)).fingerprint256
      .replaceAll(":", "")
      .toLowerCase(),
  };
}

function inspectNetwork(parseDockerNetworkInspection, id, plan, containerIds) {
  const inspected = docker(["network", "inspect", id]);
  return parseDockerNetworkInspection(inspected.stdout, {
    id,
    name: plan.name,
    internal: plan.internal,
    labels: plan.labels,
    containerIds,
  });
}

function labelArguments(labels) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

async function main() {
  const contract = JSON.parse(readFileSync(resolve(ROOT, "container-contract.json"), "utf8"));
  const buildInputs = {
    worker: computeContainerBuildInput("worker"),
    egress: computeContainerBuildInput("egress"),
  };
  const readiness = inspectEgressContainerPrerequisites(contract, buildInputs);
  const facts = {
    dockerServerVersion: null,
    canonicalDockerCliVerified: false,
    platformLocalDaemonSelected: false,
    workerImageId: null,
    egressProxyImageId: null,
    workerBuildInputSha256: buildInputs.worker.sha256,
    egressProxyBuildInputSha256: buildInputs.egress.sha256,
    workerNetworkId: null,
    outboundNetworkId: null,
    networkOwnershipVerified: false,
    egressMountsVerified: false,
    publishedPortsAbsent: false,
    tlsHandshakeVerified: false,
    tlsVersion: null,
    peerCertificateSha256: null,
    probeHttpRequestSent: false,
    proxyUpstreamTrafficObservation: "NOT_MEASURED",
    probeModelInvocation: false,
    egressCgroupObserved: false,
    probeCgroupObserved: false,
    restartPolicyVerified: false,
    runningInstanceIdentityVerified: false,
    processTreesReaped: false,
    secretMaterialDeleted: false,
    cleanupPassed: false,
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
  };
  const failures = [...readiness.failures];
  let dockerInvoked = false;
  let secretRoot = null;
  let runRoot = null;
  let workerTag = null;
  let egressTag = null;
  let workerNetworkId = null;
  let outboundNetworkId = null;
  let egressId = null;
  let probeId = null;
  let plan = null;
  let cleanupFailed = false;
  let egressCgroup = null;
  let probeCgroup = null;

  try {
    if (failures.length > 0) throw new Error("Egress container prerequisites are incomplete.");
    const build = spawnSync(process.execPath, ["scripts/build-core.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 120_000,
      shell: false,
      windowsHide: true,
    });
    if (build.error !== undefined || build.status !== 0) {
      throw new Error("Egress runtime build failed.");
    }
    pinnedDocker = createPinnedDockerSync({
      repositoryRoot: ROOT,
      dockerExecutablePath: process.env.POLICYTWIN_DOCKER_CLI,
    });
    facts.canonicalDockerCliVerified = true;
    facts.platformLocalDaemonSelected = true;
    dockerInvoked = true;
    facts.dockerServerVersion = docker(["info", "--format", "{{.ServerVersion}}"], 10_000)
      .stdout.trim();
    docker(["image", "inspect", contract.nodeBaseImage]);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    workerTag = `policytwin-egress-probe-worker:${suffix}`;
    egressTag = `policytwin-egress-probe:${suffix}`;
    docker(
      [
        "build",
        "--platform",
        contract.targetPlatform,
        "--build-arg",
        `NODE_BASE_IMAGE=${contract.nodeBaseImage}`,
        "--file",
        "Dockerfile.worker",
        "--tag",
        workerTag,
        ".",
      ],
      20 * 60_000,
    );
    facts.workerImageId = docker(["image", "inspect", "--format", "{{.Id}}", workerTag])
      .stdout.trim();
    docker(
      [
        "build",
        "--platform",
        contract.targetPlatform,
        "--build-arg",
        `NODE_BASE_IMAGE=${contract.nodeBaseImage}`,
        "--file",
        "Dockerfile.egress-proxy",
        "--tag",
        egressTag,
        ".",
      ],
      20 * 60_000,
    );
    facts.egressProxyImageId = docker([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      egressTag,
    ]).stdout.trim();
    if (!/^sha256:[0-9a-f]{64}$/u.test(facts.workerImageId) || !/^sha256:[0-9a-f]{64}$/u.test(facts.egressProxyImageId)) {
      throw new Error("Dynamic egress images did not resolve to immutable IDs.");
    }

    secretRoot = mkdtempSync(join(tmpdir(), "policytwin-egress-dynamic-"));
    chmodSync(secretRoot, 0o700);
    if (process.platform === "linux" && (lstatSync(secretRoot).mode & 0o777) !== 0o700) {
      throw new Error("The ephemeral egress secret directory is not private.");
    }
    const tls = createTlsMaterial(secretRoot);
    const runId = `runtime-${suffix}`;
    const ownershipNonce = randomBytes(16).toString("hex");
    const capability = randomBytes(32).toString("base64url");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
    const { createOpenAiEgressLease } = await import("../dist/codex/openai-egress-contract.js");
    const { buildSupervisorDockerLifecyclePlan, OBSERVED_OUTBOUND_NETWORK_ID } = await import(
      "../dist/codex/egress-runtime-contract.js"
    );
    const { OBSERVED_WORKER_NETWORK_ID, createWorkerRuntimeLayout } = await import(
      "../dist/codex/worker-runtime-contract.js"
    );
    const {
      parseDockerContainerInspection,
      parseDockerContainerOwnershipInspection,
      parseDockerNetworkInspection,
      parseDockerNetworkOwnershipInspection,
    } = await import("../dist/codex/docker-observer.js");
    runRoot = prepareWorkerRunRoot({ repositoryRoot: ROOT, runId });
    const layout = createWorkerRuntimeLayout({ repositoryRoot: ROOT, runId });
    const baseline = resolve(ROOT, "fixtures", "refund-demo", "baseline");
    mkdirSync(resolve(layout.repairRoot, "src"), { recursive: true });
    mkdirSync(resolve(layout.repairRoot, "tests"), { recursive: true });
    mkdirSync(resolve(layout.verificationRoot, "src"), { recursive: true });
    mkdirSync(resolve(layout.verificationRoot, "tests"), { recursive: true });
    mkdirSync(resolve(layout.verificationRoot, "dist"), { recursive: true });
    copyFileSync(resolve(baseline, "src", "refund.ts"), resolve(layout.repairRoot, "src", "refund.ts"));
    copyFileSync(resolve(baseline, "tests", "refund.test.mjs"), resolve(layout.repairRoot, "tests", "refund.test.mjs"));
    for (const relativePath of ["package.json", "tsconfig.json", "src/refund.ts", "tests/refund.test.mjs"]) {
      const destination = resolve(layout.verificationRoot, relativePath);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      copyFileSync(resolve(baseline, relativePath), destination);
    }
    writeFileSync(layout.requestPath, "{}\n", "utf8");
    writeFileSync(layout.responsePath, "", "utf8");
    writeFileSync(layout.proxyTokenPath, capability, { encoding: "utf8", mode: 0o444 });
    chmodSync(layout.proxyTokenPath, 0o444);
    copyFileSync(tls.caPath, layout.proxyCaPath);
    chmodSync(layout.proxyCaPath, 0o444);
    assertReadableSecret(layout.proxyTokenPath);
    assertReadableSecret(layout.proxyCaPath);
    const leasePath = join(secretRoot, "lease.json");
    const providerCredentialPath = join(secretRoot, "provider-token");
    writeFileSync(
      leasePath,
      `${JSON.stringify(
        createOpenAiEgressLease({
          runId,
          token: capability,
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          maxRequests: 4,
        }),
      )}\n`,
      { encoding: "utf8", mode: 0o444 },
    );
    writeFileSync(providerCredentialPath, "sk-policytwin-dynamic-probe-invalid", {
      encoding: "utf8",
      mode: 0o444,
    });
    for (const path of [
      tls.caPath,
      tls.certificatePath,
      tls.privateKeyPath,
      leasePath,
      providerCredentialPath,
    ]) {
      chmodSync(path, 0o444);
      assertReadableSecret(path);
    }
    const requestSha256 = createHash("sha256")
      .update("policytwin-egress-dynamic-probe", "utf8")
      .update("\0", "utf8")
      .update(runId, "utf8")
      .digest("hex");
    plan = buildSupervisorDockerLifecyclePlan({
      repositoryRoot: ROOT,
      runId,
      workerImage: facts.workerImageId,
      verifierImage: facts.workerImageId,
      egressProxyImage: facts.egressProxyImageId,
      ownershipNonce,
      requestSha256,
      limits: {
        wallTimeMs: 60_000,
        cpuTimeMs: 30_000,
        memoryBytes: 1_073_741_824,
        pids: 64,
        outputBytes: 4_194_304,
      },
      egressSecrets: {
        tlsCertificatePath: tls.certificatePath,
        tlsPrivateKeyPath: tls.privateKeyPath,
        leasePath,
        providerCredentialPath,
      },
    });
    for (const name of [plan.workerNetwork, plan.outboundNetwork]) {
      const existing = docker(
        ["network", "ls", "--no-trunc", "--filter", `name=^${name}$`, "--format", "{{.ID}}"],
        10_000,
      ).stdout.trim();
      if (existing.length !== 0) throw new Error("A dynamic egress network name already exists.");
    }
    const workerNetworkCandidateId = requiredId(
      docker([...plan.networks.worker.createArgs]).stdout,
      "Worker network creation",
    );
    const workerNetworkOwnership = docker(["network", "inspect", workerNetworkCandidateId]);
    parseDockerNetworkOwnershipInspection(workerNetworkOwnership.stdout, {
      id: workerNetworkCandidateId,
      name: plan.networks.worker.name,
      labels: plan.networks.worker.labels,
    });
    parseDockerNetworkInspection(workerNetworkOwnership.stdout, {
      id: workerNetworkCandidateId,
      name: plan.networks.worker.name,
      internal: plan.networks.worker.internal,
      labels: plan.networks.worker.labels,
      containerIds: [],
    });
    workerNetworkId = workerNetworkCandidateId;
    facts.workerNetworkId = workerNetworkId;
    const outboundNetworkCandidateId = requiredId(
      docker([...plan.networks.outbound.createArgs]).stdout,
      "Outbound network creation",
    );
    const outboundNetworkOwnership = docker(["network", "inspect", outboundNetworkCandidateId]);
    parseDockerNetworkOwnershipInspection(outboundNetworkOwnership.stdout, {
      id: outboundNetworkCandidateId,
      name: plan.networks.outbound.name,
      labels: plan.networks.outbound.labels,
    });
    parseDockerNetworkInspection(outboundNetworkOwnership.stdout, {
      id: outboundNetworkCandidateId,
      name: plan.networks.outbound.name,
      internal: plan.networks.outbound.internal,
      labels: plan.networks.outbound.labels,
      containerIds: [],
    });
    outboundNetworkId = outboundNetworkCandidateId;
    facts.outboundNetworkId = outboundNetworkId;
    facts.networkOwnershipVerified = true;

    const egressCreate = plan.egress.createArgs.map((argument) =>
      argument === OBSERVED_OUTBOUND_NETWORK_ID ? outboundNetworkId : argument,
    );
    const egressCandidateId = requiredId(docker(egressCreate).stdout, "Egress container creation");
    const egressOwnership = docker(["container", "inspect", egressCandidateId]);
    parseDockerContainerOwnershipInspection(egressOwnership.stdout, {
      id: egressCandidateId,
      name: plan.egress.name,
      labels: plan.egress.labels,
    });
    egressId = egressCandidateId;
    docker(["network", "connect", "--alias", "policytwin-egress", workerNetworkId, egressId]);
    inspectNetwork(parseDockerNetworkInspection, workerNetworkId, plan.networks.worker, [egressId]);
    inspectNetwork(parseDockerNetworkInspection, outboundNetworkId, plan.networks.outbound, [egressId]);
    const egressInspectionExpectation = {
      id: egressId,
      name: plan.egress.name,
      image: plan.egress.image,
      user: plan.egress.user,
      entrypoint: plan.egress.entrypoint,
      workingDirectory: plan.egress.workingDirectory,
      labels: plan.egress.labels,
      pidsLimit: plan.egress.pidsLimit,
      memoryBytes: plan.egress.memoryBytes,
      memorySwapBytes: plan.egress.memorySwapBytes,
      nanoCpus: plan.egress.nanoCpus,
      fileSizeLimitBytes: plan.egress.fileSizeLimitBytes,
      logDriver: plan.egress.logDriver,
      logOptions: plan.egress.logOptions,
      creationNetwork: { name: plan.outboundNetwork, id: outboundNetworkId },
      requiredEnvironment: plan.egress.environment,
      imageEnvironment: plan.egress.imageEnvironment,
      commandArgs: plan.egress.commandArgs,
      bindMounts: plan.egress.mounts.map((mount) => ({
        source: mount.source,
        destination: mount.target,
        readOnly: mount.readOnly,
      })),
      tmpfsMounts: plan.egress.tmpfsMounts.map((mount) => ({
        destination: mount.target,
        sizeBytes: mount.sizeBytes,
      })),
      networks: [
        { name: plan.outboundNetwork, id: outboundNetworkId, requiredAliases: [] },
        { name: plan.workerNetwork, id: workerNetworkId, requiredAliases: ["policytwin-egress"] },
      ],
    };
    parseDockerContainerInspection(
      docker(["container", "inspect", egressId]).stdout,
      egressInspectionExpectation,
    );
    if (docker(["port", egressId]).stdout.trim().length !== 0) {
      throw new Error("The egress proxy published a host port.");
    }
    facts.egressMountsVerified = true;
    facts.publishedPortsAbsent = true;
    docker(["start", egressId]);
    const runningEgress = parseDockerContainerInspection(
      docker(["container", "inspect", egressId]).stdout,
      egressInspectionExpectation,
    );
    assertRunningContainerInstance(runningEgress, "Egress proxy");
    egressCgroup = observeLinuxCgroupV2(runningEgress.pid, egressId);
    facts.egressCgroupObserved = true;

    const probeName = `policytwin-probe-${plan.ownership.bindingSha256.slice(0, 32)}`;
    const probeLabels = {
      ...Object.fromEntries(
        Object.entries(plan.egress.labels).filter(([key]) => key !== "com.policytwin.role"),
      ),
      "com.policytwin.role": "egress-probe",
    };
    const probeCandidateId = requiredId(
      docker([
        "create",
        "--name",
        probeName,
        "--restart",
        "no",
        "--read-only",
        "--user",
        "10001:10001",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--pids-limit",
        "16",
        "--memory",
        "134217728",
        "--memory-swap",
        "134217728",
        "--ulimit",
        "fsize=1048576:1048576",
        "--log-driver",
        "local",
        "--log-opt",
        "max-size=1048576",
        "--log-opt",
        "max-file=1",
        "--cpus",
        "0.25",
        "--network",
        workerNetworkId,
        ...labelArguments(probeLabels),
        "--env",
        "POLICYTWIN_EGRESS_PROBE=1",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=16777216",
        "--mount",
        `type=bind,source=${layout.proxyCaPath},target=/run/secrets/policytwin-egress-ca.pem,readonly`,
        facts.workerImageId,
        "--egress-tls-probe",
        "--observation-hold-ms=5000",
      ]).stdout,
      "Egress probe creation",
    );
    const probeOwnership = docker(["container", "inspect", probeCandidateId]);
    parseDockerContainerOwnershipInspection(probeOwnership.stdout, {
      id: probeCandidateId,
      name: probeName,
      labels: probeLabels,
    });
    probeId = probeCandidateId;
    inspectNetwork(parseDockerNetworkInspection, workerNetworkId, plan.networks.worker, [
      egressId,
      probeId,
    ]);
    const probeInspectionExpectation = {
      id: probeId,
      name: probeName,
      image: facts.workerImageId,
      user: "10001:10001",
      entrypoint: ["node", "scripts/worker-preflight.mjs"],
      workingDirectory: "/opt/policytwin",
      labels: probeLabels,
      pidsLimit: 16,
      memoryBytes: 134_217_728,
      memorySwapBytes: 134_217_728,
      nanoCpus: 250_000_000,
      fileSizeLimitBytes: 1_048_576,
      logDriver: "local",
      logOptions: { "max-size": "1048576", "max-file": "1" },
      creationNetwork: { name: plan.workerNetwork, id: workerNetworkId },
      requiredEnvironment: { POLICYTWIN_EGRESS_PROBE: "1" },
      imageEnvironment: plan.worker.imageEnvironment,
      commandArgs: ["--egress-tls-probe", "--observation-hold-ms=5000"],
      bindMounts: [
        {
          source: layout.proxyCaPath,
          destination: "/run/secrets/policytwin-egress-ca.pem",
          readOnly: true,
        },
      ],
      tmpfsMounts: [{ destination: "/tmp", sizeBytes: 16_777_216 }],
      networks: [{ name: plan.workerNetwork, id: workerNetworkId, requiredAliases: [] }],
    };
    parseDockerContainerInspection(
      docker(["container", "inspect", probeId]).stdout,
      probeInspectionExpectation,
    );
    docker(["start", probeId]);
    const runningProbe = parseDockerContainerInspection(
      docker(["container", "inspect", probeId]).stdout,
      probeInspectionExpectation,
    );
    assertRunningContainerInstance(runningProbe, "Egress probe");
    probeCgroup = observeLinuxCgroupV2(runningProbe.pid, probeId);
    facts.probeCgroupObserved = true;
    const probeExit = docker(["wait", probeId], 15_000).stdout.trim();
    const stoppedProbeBeforeLogs = parseDockerContainerInspection(
      docker(["container", "inspect", probeId]).stdout,
      probeInspectionExpectation,
    );
    assertStoppedSameContainerInstance(runningProbe, stoppedProbeBeforeLogs, "Egress probe");
    const probeLogs = docker(["logs", probeId]).stdout.trim();
    const stoppedProbeAfterLogs = parseDockerContainerInspection(
      docker(["container", "inspect", probeId]).stdout,
      probeInspectionExpectation,
    );
    assertStoppedSameContainerInstance(runningProbe, stoppedProbeAfterLogs, "Egress probe");
    if (probeExit !== "0") throw new Error("The egress TLS probe failed.");
    const observedEgressAfterProbe = parseDockerContainerInspection(
      docker(["container", "inspect", egressId]).stdout,
      egressInspectionExpectation,
    );
    assertSameRunningContainerInstance(runningEgress, observedEgressAfterProbe, "Egress proxy");
    const probeReceipt = JSON.parse(probeLogs);
    if (
      probeReceipt?.schemaVersion !== "1" ||
      probeReceipt?.status !== "TLS_HANDSHAKE_PASS" ||
      probeReceipt?.tlsVersion !== "TLSv1.3" ||
      probeReceipt?.peerCertificateSha256 !== tls.certificateSha256 ||
      probeReceipt?.probeHttpRequestSent !== false ||
      probeReceipt?.proxyUpstreamTrafficObservation !== "NOT_MEASURED" ||
      probeReceipt?.probeModelInvocation !== false ||
      probeReceipt?.liveCodexExecuted !== false
    ) {
      throw new Error("The egress TLS probe receipt is invalid.");
    }
    facts.tlsHandshakeVerified = true;
    facts.tlsVersion = probeReceipt.tlsVersion;
    facts.peerCertificateSha256 = probeReceipt.peerCertificateSha256;
    facts.restartPolicyVerified = true;
    facts.runningInstanceIdentityVerified = true;
  } catch (error) {
    if (failures.length === 0) failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    for (const [containerId, networkIds] of [
      [probeId, [workerNetworkId]],
      [egressId, [workerNetworkId, outboundNetworkId]],
    ]) {
      if (containerId === null) continue;
      docker(["stop", "--time", "5", containerId], 15_000, true);
      for (const networkId of networkIds) {
        if (networkId !== null) {
          docker(["network", "disconnect", "--force", networkId, containerId], 15_000, true);
        }
      }
      const removed = docker(["rm", "--force", containerId], 30_000, true);
      if (removed.status !== 0 || removed.error !== undefined) cleanupFailed = true;
    }
    for (const networkId of [outboundNetworkId, workerNetworkId]) {
      if (networkId === null) continue;
      const inspected = docker(["network", "inspect", networkId], 10_000, true);
      if (inspected.status === 0) {
        try {
          const network = JSON.parse(inspected.stdout)?.[0];
          if (Object.keys(network?.Containers ?? {}).length !== 0) {
            cleanupFailed = true;
            continue;
          }
        } catch {
          cleanupFailed = true;
          continue;
        }
        const removed = docker(["network", "rm", networkId], 30_000, true);
        if (removed.status !== 0 || removed.error !== undefined) cleanupFailed = true;
      }
    }
    for (const tag of [workerTag, egressTag]) {
      if (tag === null) continue;
      const removed = docker(["image", "rm", tag], 60_000, true);
      if (
        removed.error !== undefined ||
        removed.status !== 0 ||
        !imageTagAbsent(tag)
      ) {
        cleanupFailed = true;
      }
    }
    if (runRoot !== null) {
      try {
        removeSafeWorkerRunRoot(runRoot);
      } catch {
        cleanupFailed = true;
      }
    }
    if (plan !== null) {
      const bindingSha256 = plan.ownership.bindingSha256;
      for (const [id, role] of [[egressId, "egress"], [probeId, "egress-probe"]]) {
        if (!containerRoleAbsent(id, bindingSha256, role)) cleanupFailed = true;
      }
      if (!networkRoleAbsent(workerNetworkId, bindingSha256, "worker-internal")) {
        cleanupFailed = true;
      }
      if (!networkRoleAbsent(outboundNetworkId, bindingSha256, "egress-outbound")) {
        cleanupFailed = true;
      }
    }
    let processTreesReaped = egressCgroup !== null && probeCgroup !== null;
    for (const cgroup of [egressCgroup, probeCgroup]) {
      if (cgroup === null) continue;
      try {
        assertLinuxCgroupProcessTreeEmpty(cgroup);
      } catch {
        processTreesReaped = false;
        cleanupFailed = true;
      }
    }
    facts.processTreesReaped = processTreesReaped;
    if (secretRoot !== null) {
      try {
        rmSync(secretRoot, { recursive: true, force: true });
        facts.secretMaterialDeleted = !existsSync(secretRoot);
      } catch {
        facts.secretMaterialDeleted = false;
      }
      if (!facts.secretMaterialDeleted) cleanupFailed = true;
    }
    facts.cleanupPassed = dockerInvoked && !cleanupFailed;
    if (cleanupFailed && !failures.includes("Dynamic egress cleanup failed.")) {
      failures.push("Dynamic egress cleanup failed.");
    }
    facts.dynamicIsolationVerified =
      failures.length === 0 &&
      facts.networkOwnershipVerified &&
      facts.egressMountsVerified &&
      facts.publishedPortsAbsent &&
      facts.tlsHandshakeVerified &&
      facts.egressCgroupObserved &&
      facts.probeCgroupObserved &&
      facts.restartPolicyVerified &&
      facts.runningInstanceIdentityVerified &&
      facts.processTreesReaped &&
      facts.secretMaterialDeleted &&
      facts.cleanupPassed;
  }

  const report = {
    schemaVersion: "1",
    status: failures.length === 0 ? "PASS" : "FAIL",
    scope: "DYNAMIC_EGRESS_PROXY_TLS_HANDSHAKE_ONLY_OUTBOUND_NOT_MEASURED",
    dockerInvoked,
    facts,
    releaseReady: false,
    failures: [...new Set(failures)],
  };
  mkdirSync(resolve(ROOT, "artifacts", "security"), { recursive: true });
  writeFileSync(
    resolve(ROOT, "artifacts", "security", "egress-container-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (report.status !== "PASS") {
    console.error(`Egress container verification failed: ${report.failures.join(" ")}`);
    process.exit(1);
  }
  console.log(
    "Dynamic egress TLS/container gate passed: the probe wrote no HTTP and proxy outbound traffic was not measured.",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
