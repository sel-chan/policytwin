import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertSupervisorDockerArguments,
  createDockerCliCommandRunner,
} from "../../dist/codex/docker-command-runner.js";
import { buildSupervisorDockerLifecyclePlan } from "../../dist/codex/egress-runtime-contract.js";
import { createOpenAiEgressLease } from "../../dist/codex/openai-egress-contract.js";
import {
  createProcfsProcessObserver,
  createSupervisorDockerLifecycleDriver,
} from "../../dist/codex/supervisor-docker-driver.js";
import { createWorkerRuntimeLayout } from "../../dist/codex/worker-runtime-contract.js";
import { workerRpcSha256 } from "../../dist/codex/worker-rpc-contract.js";
import { createStaticSupervisorCpuBudgetController } from "../../dist/codex/cpu-budget-contract.js";

const IMAGE = `sha256:${"a".repeat(64)}`;
const NONCE = "b".repeat(32);
const PROXY_TOKEN = Buffer.alloc(32, 17).toString("base64url");
const FOREIGN_ID = "f".repeat(64);
const LIMITS = {
  wallTimeMs: 10_000,
  cpuTimeMs: 5_000,
  memoryBytes: 256 * 1024 * 1024,
  pids: 8,
  outputBytes: 1024 * 1024,
};

function values(args, option) {
  return args.flatMap((value, index) => (value === option ? [args[index + 1]] : []));
}

function value(args, option) {
  const result = values(args, option);
  if (result.length !== 1 || result[0] === undefined) throw new Error(`Missing ${option}`);
  return result[0];
}

function result(exitCode = 0, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

function parsePairs(entries) {
  return Object.fromEntries(
    entries.map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

function parseMount(specification) {
  const fields = specification.split(",");
  const options = Object.fromEntries(
    fields.filter((field) => field.includes("=")).map((field) => {
      const separator = field.indexOf("=");
      return [field.slice(0, separator), field.slice(separator + 1)];
    }),
  );
  return {
    Type: options.type,
    Source: options.source,
    Destination: options.target,
    RW: !fields.includes("readonly"),
    Propagation: "rprivate",
  };
}

class FakeDockerRunner {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
    this.networks = new Map();
    this.containers = new Map();
    this.nextId = 1;
    this.nextPid = 4_000;
    this.foreignContainerNames = new Set(options.foreignContainerNames ?? []);
  }

  id() {
    const id = this.nextId.toString(16).padStart(64, "0");
    this.nextId += 1;
    return id;
  }

  networkByName(name) {
    return [...this.networks.values()].find((network) => network.name === name);
  }

  containerByName(name) {
    return [...this.containers.values()].find((container) => container.name === name);
  }

  attach(container, network, aliases = []) {
    container.networks.set(network.name, {
      id: network.id,
      aliases: [container.name, container.id.slice(0, 12), ...aliases],
    });
    network.containers.set(container.id, container.name);
  }

  detach(container, network) {
    container.networks.delete(network.name);
    network.containers.delete(container.id);
  }

  networkJson(network) {
    const inspection = {
        Id: network.id,
        Name: network.name,
        Driver: "bridge",
        Scope: "local",
        Internal: network.internal,
        Attachable: false,
        Ingress: false,
        Labels: network.labels,
        Options: {},
        Containers: Object.fromEntries(
          [...network.containers].map(([id, name]) => [id, { Name: name }]),
        ),
    };
    this.options.mutateNetworkInspection?.(inspection, network);
    return JSON.stringify([inspection]);
  }

  containerJson(container) {
    const publishAll = this.options.publishRole === container.labels["com.policytwin.role"];
    const role = container.labels["com.policytwin.role"];
    const entrypoint = role === "worker"
      ? ["node", "scripts/worker-preflight.mjs"]
      : role === "verifier"
        ? ["node", "scripts/verifier-preflight.mjs"]
        : ["node", "scripts/openai-egress-proxy.mjs"];
    const path = role === "verifier"
      ? "/opt/policytwin/bin:/usr/local/bin:/usr/bin:/bin"
      : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    const environment = {
      PATH: path,
      NODE_VERSION: "22.22.2",
      YARN_VERSION: "1.22.22",
      NODE_ENV: "production",
      ...parsePairs(container.environment),
    };
    const inspection = {
        Id: container.id,
        Name: `/${container.name}`,
        Image: container.image,
        Config: {
          User: container.user,
          Entrypoint: entrypoint,
          WorkingDir: "/opt/policytwin",
          Labels: container.labels,
          Env: Object.entries(environment).map(([key, value]) => `${key}=${value}`),
          Cmd: container.command,
        },
        HostConfig: {
          ReadonlyRootfs: true,
          Privileged: false,
          UsernsMode: "",
          CgroupnsMode: "private",
          PidMode: "",
          IpcMode: "private",
          UTSMode: "",
          NetworkMode: container.networkMode,
          PidsLimit: container.pidsLimit,
          Memory: container.memoryBytes,
          MemorySwap: container.memorySwapBytes,
          NanoCpus: container.nanoCpus,
          Ulimits: [
            {
              Name: "fsize",
              Soft: container.fileSizeLimitBytes,
              Hard: container.fileSizeLimitBytes,
            },
          ],
          LogConfig: { Type: container.logDriver, Config: container.logOptions },
          RestartPolicy: { Name: container.restartPolicy, MaximumRetryCount: 0 },
          PublishAllPorts: publishAll,
          PortBindings: publishAll ? { "8443/tcp": [{ HostPort: "8443" }] } : {},
          CapDrop: ["ALL"],
          CapAdd: null,
          SecurityOpt: ["no-new-privileges:true"],
          Devices: [],
          DeviceRequests: null,
          Binds: null,
          VolumesFrom: null,
          Links: null,
          ExtraHosts: null,
          Dns: [],
          DnsOptions: [],
          DnsSearch: [],
          Tmpfs: container.tmpfs,
        },
        State: { Pid: container.pid, Running: container.running, StartedAt: container.startedAt },
        RestartCount: container.restartCount,
        NetworkSettings: {
          Ports: publishAll ? { "8443/tcp": [{ HostPort: "8443" }] } : {},
          Networks: Object.fromEntries(
            [...container.networks].map(([name, network]) => [
              name,
              { NetworkID: network.id, Aliases: network.aliases },
            ]),
          ),
        },
        Mounts: container.mounts,
    };
    this.options.mutateContainerInspection?.(inspection, container);
    return JSON.stringify([inspection]);
  }

  filteredContainers(args) {
    const filters = values(args, "--filter");
    const idFilter = filters.find((filter) => filter.startsWith("id="));
    if (idFilter !== undefined) {
      const id = idFilter.slice("id=".length);
      return [...this.containers.values()]
        .filter((container) => container.id.startsWith(id))
        .map((container) => container.id);
    }
    if (filters.some((filter) => filter.startsWith("name="))) {
      const name = filters.find((filter) => filter.startsWith("name="))
        .slice("name=^/".length, -1);
      if (this.foreignContainerNames.has(name)) return [FOREIGN_ID];
      return [...this.containers.values()]
        .filter((container) => container.name === name)
        .map((container) => container.id);
    }
    return [...this.containers.values()]
      .filter((container) =>
        filters
          .filter((filter) => filter.startsWith("label="))
          .every((filter) => {
            const [key, expected] = filter.slice("label=".length).split("=");
            return container.labels[key] === expected;
          }),
      )
      .map((container) => container.id);
  }

  filteredNetworks(args) {
    const filters = values(args, "--filter");
    const idFilter = filters.find((filter) => filter.startsWith("id="));
    if (idFilter !== undefined) {
      const id = idFilter.slice("id=".length);
      return [...this.networks.values()]
        .filter((network) => network.id.startsWith(id))
        .map((network) => network.id);
    }
    return [...this.networks.values()]
      .filter((network) =>
        filters.every((filter) => {
          if (filter.startsWith("name=")) {
            return network.name === filter.slice("name=^".length, -1);
          }
          if (filter.startsWith("label=")) {
            const [key, expected] = filter.slice("label=".length).split("=");
            return network.labels[key] === expected;
          }
          return true;
        }),
      )
      .map((network) => network.id);
  }

  async run(args) {
    this.calls.push([...args]);
    if (this.options.fail?.(args, this.calls.length)) return result(1, "", "injected failure");
    if (args[0] === "ps") return result(0, `${this.filteredContainers(args).join("\n")}\n`);
    if (args[0] === "network" && args[1] === "ls") {
      return result(0, `${this.filteredNetworks(args).join("\n")}\n`);
    }
    if (args[0] === "network" && args[1] === "create") {
      const id = this.id();
      const name = args.at(-1);
      const network = {
        id,
        name,
        internal: args.includes("--internal"),
        labels: parsePairs(values(args, "--label")),
        containers: new Map(),
      };
      this.networks.set(id, network);
      return result(0, `${id}\n`);
    }
    if (args[0] === "network" && args[1] === "inspect") {
      const network = this.networks.get(args[2]);
      return network === undefined
        ? result(1, "", "not found")
        : result(0, this.networkJson(network));
    }
    if (args[0] === "network" && args[1] === "connect") {
      const network = this.networks.get(args.at(-2));
      const container = this.containers.get(args.at(-1));
      if (network === undefined || container === undefined) return result(1);
      this.attach(container, network, values(args, "--alias"));
      return result();
    }
    if (args[0] === "network" && args[1] === "disconnect") {
      const network = this.networks.get(args.at(-2));
      const container = this.containers.get(args.at(-1));
      if (network === undefined || container === undefined) return result(1);
      this.detach(container, network);
      return result();
    }
    if (args[0] === "network" && args[1] === "rm") {
      const network = this.networks.get(args[2]);
      if (network === undefined || network.containers.size !== 0) return result(1);
      this.networks.delete(network.id);
      return result(0, `${network.id}\n`);
    }
    if (args[0] === "create") {
      const imageIndex = args.findIndex((argument) => /^sha256:[0-9a-f]{64}$/u.test(argument));
      const id = this.id();
      const name = value(args, "--name");
      if (this.foreignContainerNames.has(name) || this.containerByName(name) !== undefined) {
        return result(1, "", "name conflict");
      }
      const networkId = value(args, "--network");
      const network = this.networks.get(networkId);
      if (network === undefined && networkId !== "none") return result(1);
      const fileSizeLimit = /^fsize=([0-9]+):\1$/u.exec(value(args, "--ulimit"));
      if (fileSizeLimit?.[1] === undefined) return result(1);
      const container = {
        id,
        name,
        image: args[imageIndex],
        command: args.slice(imageIndex + 1),
        user: value(args, "--user"),
        labels: parsePairs(values(args, "--label")),
        environment: values(args, "--env"),
        mounts: values(args, "--mount").map(parseMount),
        tmpfs: Object.fromEntries(
          values(args, "--tmpfs").map((specification) => {
            const separator = specification.indexOf(":");
            return [specification.slice(0, separator), specification.slice(separator + 1)];
          }),
        ),
        pidsLimit: Number(value(args, "--pids-limit")),
        memoryBytes: Number(value(args, "--memory")),
        memorySwapBytes: Number(value(args, "--memory-swap")),
        nanoCpus: Number(value(args, "--cpus")) * 1_000_000_000,
        fileSizeLimitBytes: Number(fileSizeLimit[1]),
        logDriver: value(args, "--log-driver"),
        logOptions: parsePairs(values(args, "--log-opt")),
        restartPolicy: value(args, "--restart"),
        networkMode: networkId,
        networks: new Map(),
        running: false,
        pid: 0,
        startedAt: "0001-01-01T00:00:00Z",
        restartCount: 0,
        startGeneration: 0,
      };
      this.containers.set(id, container);
      if (network !== undefined) this.attach(container, network);
      return result(0, `${id}\n`);
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const container = this.containers.get(args[2]);
      return container === undefined
        ? result(1, "", "not found")
        : result(0, this.containerJson(container));
    }
    if (args[0] === "port") {
      const container = this.containers.get(args[1]);
      if (container === undefined) return result(1);
      return this.options.publishRole === container.labels["com.policytwin.role"]
        ? result(0, "8443/tcp -> 0.0.0.0:8443\n")
        : result();
    }
    if (args[0] === "start") {
      const container = this.containers.get(args[1]);
      if (container === undefined) return result(1);
      container.running = true;
      container.pid = this.nextPid;
      this.nextPid += 1;
      container.startGeneration += 1;
      container.startedAt = `2026-07-16T00:00:00.${String(container.startGeneration).padStart(9, "0")}Z`;
      return result(0, `${container.id}\n`);
    }
    if (args[0] === "wait") {
      const container = this.containers.get(args[1]);
      if (container === undefined) return result(1);
      container.running = false;
      container.pid = 0;
      if (container.labels["com.policytwin.role"] === "worker") {
        this.options.onWorkerWait?.(this, container);
      }
      this.options.onWait?.(this, container);
      return result(0, "0\n");
    }
    if (args[0] === "logs") {
      const container = this.containers.get(args[1]);
      if (container === undefined) return result(1);
      const role = container.labels["com.policytwin.role"];
      if (role === "worker") {
        return result(
          0,
          '{"schemaVersion":"1","status":"STATIC_PREFLIGHT_PASS","dynamicIsolationVerified":false,"liveCodexExecuted":false}\n',
        );
      }
      if (role === "verifier") {
        return result(
          0,
          '{"schemaVersion":"1","status":"FIXTURE_COMMANDS_PASS","network":"UNVERIFIED_BY_PROCESS","credentialsPresent":false,"dynamicIsolationVerified":false,"liveCodexExecuted":false}\n',
        );
      }
      return result();
    }
    if (args[0] === "stop") {
      const container = this.containers.get(args.at(-1));
      if (container === undefined) return result(1);
      container.running = false;
      container.pid = 0;
      return result(0, `${container.id}\n`);
    }
    if (args[0] === "rm") {
      const container = this.containers.get(args.at(-1));
      if (container === undefined) return result(1);
      for (const network of this.networks.values()) network.containers.delete(container.id);
      this.containers.delete(container.id);
      return result(0, `${container.id}\n`);
    }
    throw new Error(`Unhandled fake Docker command: ${args.join(" ")}`);
  }
}

async function createFixture(t) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "policytwin-docker-driver-"));
  const secretRoot = await mkdtemp(join(tmpdir(), "policytwin-docker-secrets-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  t.after(() => rm(secretRoot, { recursive: true, force: true }));
  const runId = "runtime-1234567890abcdef";
  const layout = createWorkerRuntimeLayout({ repositoryRoot, runId });
  const baselineRoot = join(repositoryRoot, "fixtures", "refund-demo", "baseline");
  await mkdir(join(baselineRoot, "src"), { recursive: true });
  await mkdir(join(baselineRoot, "tests"), { recursive: true });
  await mkdir(join(layout.repairRoot, "src"), { recursive: true });
  await mkdir(join(layout.repairRoot, "tests"), { recursive: true });
  await mkdir(join(layout.verificationRoot, "src"), { recursive: true });
  await mkdir(join(layout.verificationRoot, "tests"), { recursive: true });
  await mkdir(join(layout.verificationRoot, "dist"), { recursive: true });
  for (const [path, body] of [
    [join(baselineRoot, "package.json"), "{}\n"],
    [join(baselineRoot, "tsconfig.json"), "{}\n"],
    [join(baselineRoot, "src", "refund.ts"), "export const baseline = true;\n"],
    [join(baselineRoot, "tests", "refund.test.mjs"), "// baseline\n"],
    [join(layout.repairRoot, "src", "refund.ts"), "export const repaired = true;\n"],
    [join(layout.repairRoot, "tests", "refund.test.mjs"), "// repaired\n"],
    [join(layout.verificationRoot, "package.json"), "{}\n"],
    [join(layout.verificationRoot, "tsconfig.json"), "{}\n"],
    [join(layout.verificationRoot, "src", "refund.ts"), "export const baseline = true;\n"],
    [join(layout.verificationRoot, "tests", "refund.test.mjs"), "// baseline\n"],
    [layout.requestPath, "{}\n"],
    [layout.responsePath, "\n"],
    [layout.proxyTokenPath, `${PROXY_TOKEN}\n`],
    [layout.proxyCaPath, "test-ca\n"],
  ]) {
    await writeFile(path, body, "utf8");
  }
  const request = {
    requestId: "request-12345678",
    policy: {
      workerImageDigest: IMAGE,
      limits: LIMITS,
    },
  };
  const requestSha256 = workerRpcSha256(request);
  const tlsCertificatePath = join(secretRoot, "server-cert.pem");
  const tlsPrivateKeyPath = join(secretRoot, "server-key.pem");
  const leasePath = join(secretRoot, "lease.json");
  const providerCredentialPath = join(secretRoot, "provider-token");
  const lease = createOpenAiEgressLease({
    runId,
    token: PROXY_TOKEN,
    issuedAt: "2026-07-15T00:00:00.000Z",
    expiresAt: "2026-07-15T00:05:00.000Z",
    maxRequests: 16,
  });
  await writeFile(tlsCertificatePath, "certificate\n", "utf8");
  await writeFile(tlsPrivateKeyPath, "private-key\n", "utf8");
  await writeFile(leasePath, `${JSON.stringify(lease)}\n`, "utf8");
  await writeFile(providerCredentialPath, "provider-token\n", "utf8");
  const configuration = {
    repositoryRoot,
    runId,
    verifierImage: IMAGE,
    egressProxyImage: IMAGE,
    allowedWorkerImage: IMAGE,
    nativeHelperImage: IMAGE,
    nativeHelperBinarySha256: "d".repeat(64),
    nativeHelperBuildInputSha256: "e".repeat(64),
    nativeHelperSourceSha256: "f".repeat(64),
    maximumWorkerLimits: LIMITS,
    ownershipNonce: NONCE,
    egressSecrets: {
      tlsCertificatePath,
      tlsPrivateKeyPath,
      leasePath,
      providerCredentialPath,
    },
  };
  const plan = buildSupervisorDockerLifecyclePlan({
    ...configuration,
    workerImage: IMAGE,
    requestSha256,
    limits: LIMITS,
  });
  return { request, plan, configuration };
}

function staticCpuController(observations = {}, overrides = {}) {
  return createStaticSupervisorCpuBudgetController({
    roles: overrides.roles ?? [
      {
        role: "egress",
        cgroupIdentitySha256: "9".repeat(64),
        baselineUsageUsec: 10n,
        sampledUsageUsec: [],
        finalUsageUsec: 110n,
      },
      {
        role: "worker",
        cgroupIdentitySha256: "a".repeat(64),
        baselineUsageUsec: 20n,
        sampledUsageUsec: [],
        finalUsageUsec: 220n,
      },
      {
        role: "verifier",
        cgroupIdentitySha256: "b".repeat(64),
        baselineUsageUsec: 30n,
        sampledUsageUsec: [],
        finalUsageUsec: 330n,
      },
    ],
    cleanupStartFails: overrides.cleanupStartFails,
    cleanupCompletes: overrides.cleanupCompletes,
    onEvent(event) {
      observations.cpuEvents ??= [];
      observations.cpuEvents.push(event);
    },
  });
}

function createDriver(fake, fixture, observations = {}) {
  return createSupervisorDockerLifecycleDriver({
    runner: fake,
    cpuBudgetController:
      observations.cpuBudgetController ?? staticCpuController(observations),
    async configure() {
      return fixture.configuration;
    },
    workspace: {
      async prepare() {
        observations.prepared = true;
      },
      async reconstructVerification() {
        observations.reconstructed = true;
      },
      async cleanup() {
        observations.workspaceCleaned = true;
        return { repairWorkspaceDeleted: true, verificationWorkspaceDeleted: true };
      },
    },
    processObserver: {
      async processTreeIsEmpty() {
        return true;
      },
    },
    cpuControlTimeoutMs: observations.cpuControlTimeoutMs,
  });
}

test("Docker command allowlist rejects shell-like or boundary-weakening arguments", () => {
  assert.doesNotThrow(() =>
    assertSupervisorDockerArguments(["network", "inspect", "1".repeat(64)]),
  );
  assert.doesNotThrow(() =>
    assertSupervisorDockerArguments(["create", "--restart", "no", IMAGE]),
  );
  for (const args of [
    ["exec", "container", "sh"],
    ["create", "--privileged", IMAGE],
    ["create", "--network", "host", IMAGE],
    ["create", "--publish", "8443:8443", IMAGE],
    ["create", "--network", "__POLICYTWIN_WORKER_NETWORK_ID__", IMAGE],
    ["create", "--security-opt", "seccomp=unconfined", IMAGE],
    ["create", "--entrypoint=/bin/sh", IMAGE],
    ["create", "--privileged=true", IMAGE],
    ["create", "--device", "/dev/sda", IMAGE],
    ["create", "-v/:/host", IMAGE],
    ["create", "-eNODE_OPTIONS=--inspect", IMAGE],
    ["create", "--userns=host", IMAGE],
    ["create", "--cgroupns=host", IMAGE],
    ["create", "--mount=type=bind,source=/var/run/docker.sock,target=/sock", IMAGE],
    ["create", "--log-driver", "json-file", IMAGE],
    ["create", "--log-opt", "max-file=10", IMAGE],
    ["create", "--ulimit", "nofile=1:1", IMAGE],
    ["create", "--restart", "always", IMAGE],
    ["network", "create", "--opt", "bridge.name=eth0", "unsafe"],
  ]) {
    assert.throws(() => assertSupervisorDockerArguments(args), /Docker/u);
  }
});

test("Docker CLI runner requires a canonical executable and the platform-local daemon", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "policytwin-docker-runner-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const executablePath = join(repositoryRoot, process.platform === "win32" ? "docker.exe" : "docker");
  await writeFile(executablePath, "not executed\n", "utf8");
  const localDaemonHost = process.platform === "win32"
    ? "npipe:////./pipe/docker_engine"
    : "unix:///var/run/docker.sock";
  assert.doesNotThrow(() =>
    createDockerCliCommandRunner({ repositoryRoot, dockerExecutablePath: executablePath, localDaemonHost }),
  );
  assert.throws(
    () => createDockerCliCommandRunner({ repositoryRoot, dockerExecutablePath: "docker", localDaemonHost }),
    /absolute/u,
  );
  assert.throws(
    () => createDockerCliCommandRunner({
      repositoryRoot,
      dockerExecutablePath: executablePath,
      localDaemonHost: "tcp://127.0.0.1:2375",
    }),
    /local daemon/u,
  );
});

test("init-PID procfs absence alone is rejected as process-tree evidence", async () => {
  const observer = createProcfsProcessObserver();
  await assert.rejects(
    observer.processTreeIsEmpty(
      { containerId: "1".repeat(64), initialPids: [1234] },
      new AbortController().signal,
    ),
    /cannot prove/u,
  );
});

test("prepared Docker driver owns resources by returned IDs and proves full static teardown", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const observations = {};
  const driver = createDriver(fake, fixture, observations);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await driver.prepare(handle, fixture.request, signal);
  const worker = await driver.runWorker(handle, fixture.request, signal);
  const verifier = await driver.runVerifier(handle, fixture.request, signal);
  const budget = await driver.finalizeExecutionBudget(handle, fixture.request, signal);
  driver.validateWorkerOutput(worker, fixture.request);
  driver.validateVerifierOutput(verifier, fixture.request);
  const cleanup = await driver.cleanup(handle, "SUCCESS", signal);

  assert.equal(observations.reconstructed, true);
  assert.equal(observations.workspaceCleaned, true);
  assert.equal(budget.bindingSha256, fixture.plan.ownership.bindingSha256);
  assert.equal(budget.proof.aggregateUsageUsec, "600");
  assert.deepEqual(cleanup, {
    schemaVersion: "1",
    workerContainerRemoved: true,
    verifierContainerRemoved: true,
    egressContainerRemoved: true,
    workerNetworkReleased: true,
    outboundNetworkReleased: true,
    repairWorkspaceDeleted: true,
    verificationWorkspaceDeleted: true,
    processTreeReaped: true,
    remainingProcessCount: 0,
    cpuBudgetControllerStopped: true,
  });
  assert.deepEqual(observations.cpuEvents, [
    "cpu:begin",
    "cpu:start:egress",
    "cpu:start:worker",
    "cpu:stop:worker",
    "cpu:stop:egress",
    "cpu:start:verifier",
    "cpu:stop:verifier",
    "cpu:finalize",
    "cpu:cleanup-begin:SUCCESS",
    "cpu:cleanup-complete",
  ]);
  assert.equal(fake.containers.size, 0);
  assert.equal(fake.networks.size, 0);
  const ownedNames = [
    fixture.plan.egress.name,
    fixture.plan.worker.name,
    fixture.plan.verifier.name,
    fixture.plan.workerNetwork,
    fixture.plan.outboundNetwork,
  ];
  const nameBasedMutation = fake.calls.some(
    (args) =>
      !["create", "ps"].includes(args[0]) &&
      !(args[0] === "network" && ["create", "ls"].includes(args[1])) &&
      args.some((argument) => ownedNames.includes(argument)),
  );
  assert.equal(nameBasedMutation, false);
});

test("Docker driver rejects worker plus egress aggregate CPU overage before a receipt is trusted", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const observations = {};
  observations.cpuBudgetController = staticCpuController(observations, {
    roles: [
      {
        role: "egress",
        cgroupIdentitySha256: "9".repeat(64),
        baselineUsageUsec: 0n,
        sampledUsageUsec: [],
        finalUsageUsec: 3_000_000n,
      },
      {
        role: "worker",
        cgroupIdentitySha256: "a".repeat(64),
        baselineUsageUsec: 0n,
        sampledUsageUsec: [],
        finalUsageUsec: 3_000_000n,
      },
      {
        role: "verifier",
        cgroupIdentitySha256: "b".repeat(64),
        baselineUsageUsec: 0n,
        sampledUsageUsec: [],
        finalUsageUsec: 0n,
      },
    ],
  });
  const driver = createDriver(fake, fixture, observations);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await driver.prepare(handle, fixture.request, signal);
  await assert.rejects(driver.runWorker(handle, fixture.request, signal), /exceeded/u);
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.cpuBudgetControllerStopped, true);
  assert.equal(observations.cpuEvents.includes("cpu:start:verifier"), false);
});

test("Docker driver charges verifier CPU against the request aggregate", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const observations = {};
  observations.cpuBudgetController = staticCpuController(observations, {
    roles: [
      {
        role: "egress",
        cgroupIdentitySha256: "9".repeat(64),
        baselineUsageUsec: 0n,
        sampledUsageUsec: [],
        finalUsageUsec: 1_000_000n,
      },
      {
        role: "worker",
        cgroupIdentitySha256: "a".repeat(64),
        baselineUsageUsec: 0n,
        sampledUsageUsec: [],
        finalUsageUsec: 1_000_000n,
      },
      {
        role: "verifier",
        cgroupIdentitySha256: "b".repeat(64),
        baselineUsageUsec: 0n,
        sampledUsageUsec: [],
        finalUsageUsec: 3_000_001n,
      },
    ],
  });
  const driver = createDriver(fake, fixture, observations);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await driver.prepare(handle, fixture.request, signal);
  const worker = await driver.runWorker(handle, fixture.request, signal);
  await assert.rejects(
    driver.runVerifier(handle, fixture.request, signal),
    /exceeded/u,
  );
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.cpuBudgetControllerStopped, true);
});

test("Docker driver rejects CPU controller identity drift", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const observations = {};
  const base = staticCpuController(observations);
  observations.cpuBudgetController = {
    async begin(input, beginSignal) {
      const session = await base.begin(input, beginSignal);
      return {
        ...session,
        async roleStarted(observation, roleSignal) {
          const identity = await session.roleStarted(observation, roleSignal);
          return { ...identity, pid: identity.pid + 1 };
        },
      };
    },
  };
  const driver = createDriver(fake, fixture, observations);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await assert.rejects(
    driver.prepare(handle, fixture.request, signal),
    /drifted container identity/u,
  );
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.cpuBudgetControllerStopped, true);
});

test("Docker driver exposes CPU controller cleanup failure to the lifecycle", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const observations = {};
  observations.cpuBudgetController = staticCpuController(observations, {
    cleanupCompletes: false,
  });
  const driver = createDriver(fake, fixture, observations);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await driver.prepare(handle, fixture.request, signal);
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.cpuBudgetControllerStopped, false);
  assert.equal(cleanup.workerContainerRemoved, true);
  assert.equal(cleanup.egressContainerRemoved, true);
});

test("Docker driver bounds a CPU controller that ignores role-start cancellation", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const observations = { cpuControlTimeoutMs: 50 };
  const base = staticCpuController(observations);
  observations.cpuBudgetController = {
    async begin(input, beginSignal) {
      const session = await base.begin(input, beginSignal);
      return {
        ...session,
        async roleStarted(observation, roleSignal) {
          if (observation.role === "worker") return await new Promise(() => undefined);
          return await session.roleStarted(observation, roleSignal);
        },
      };
    },
  };
  const driver = createDriver(fake, fixture, observations);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await driver.prepare(handle, fixture.request, signal);
  await assert.rejects(driver.runWorker(handle, fixture.request, signal), /timed out/u);
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.cpuBudgetControllerStopped, false);
  assert.equal(cleanup.workerContainerRemoved, true);
  assert.equal(cleanup.egressContainerRemoved, true);
});

test("Docker cleanup continues when CPU cleanup start ignores its deadline", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const observations = { cpuControlTimeoutMs: 50 };
  const base = staticCpuController(observations);
  observations.cpuBudgetController = {
    async begin(input, beginSignal) {
      const session = await base.begin(input, beginSignal);
      return {
        ...session,
        async beginCleanup() {
          return await new Promise(() => undefined);
        },
      };
    },
  };
  const driver = createDriver(fake, fixture, observations);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await driver.prepare(handle, fixture.request, signal);
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.cpuBudgetControllerStopped, false);
  assert.equal(cleanup.workerContainerRemoved, true);
  assert.equal(cleanup.egressContainerRemoved, true);
  assert.equal(fake.containers.size, 0);
  assert.equal(fake.networks.size, 0);
});

for (const [label, mutate, pattern] of [
  ["PID", (egress) => { egress.pid += 100; }, /running instance changed/u],
  [
    "start timestamp",
    (egress) => { egress.startedAt = "2026-07-16T00:00:00.999999999Z"; },
    /running instance changed/u,
  ],
  ["running state", (egress) => { egress.running = false; egress.pid = 0; }, /running state/u],
  ["restart count", (egress) => { egress.restartCount = 1; }, /restarted/u],
  ["missing start timestamp", (egress) => { delete egress.startedAt; }, /start timestamp/u],
]) {
  test(`worker result is rejected after egress ${label} drift`, async (t) => {
    const fixture = await createFixture(t);
    const fake = new FakeDockerRunner({
      onWorkerWait(runner) {
        const egress = runner.containerByName(fixture.plan.egress.name);
        if (egress === undefined) throw new Error("Missing fake egress container.");
        mutate(egress);
      },
    });
    const driver = createDriver(fake, fixture);
    const signal = new AbortController().signal;
    const handle = driver.createHandle(fixture.request);
    await driver.prepare(handle, fixture.request, signal);
    await assert.rejects(driver.runWorker(handle, fixture.request, signal), pattern);
    const cleanup = await driver.cleanup(handle, "FAILURE", signal);
    assert.equal(cleanup.egressContainerRemoved, true);
    assert.equal(cleanup.workerContainerRemoved, true);
  });
}

for (const role of ["worker", "egress", "verifier"]) {
  test(`${role} result is rejected unless wait leaves the same container stopped`, async (t) => {
    const fixture = await createFixture(t);
    const fake = new FakeDockerRunner({
      onWait(_runner, container) {
        if (container.labels["com.policytwin.role"] !== role) return;
        container.running = true;
        container.pid = 90_000;
      },
    });
    const driver = createDriver(fake, fixture);
    const signal = new AbortController().signal;
    const handle = driver.createHandle(fixture.request);
    await driver.prepare(handle, fixture.request, signal);
    if (role === "verifier") {
      const worker = await driver.runWorker(handle, fixture.request, signal);
      await assert.rejects(
        driver.runVerifier(handle, fixture.request, signal),
        /remain stopped/u,
      );
    } else {
      await assert.rejects(driver.runWorker(handle, fixture.request, signal), /remain stopped/u);
    }
    const cleanup = await driver.cleanup(handle, "FAILURE", signal);
    assert.equal(cleanup.workerContainerRemoved, true);
    assert.equal(cleanup.egressContainerRemoved, true);
    assert.equal(cleanup.verifierContainerRemoved, true);
  });
}

test("name preemption is rejected and the foreign container is never removed", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner({ foreignContainerNames: [fixture.plan.worker.name] });
  const driver = createDriver(fake, fixture);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await assert.rejects(driver.prepare(handle, fixture.request, signal), /already exists/u);
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.workerContainerRemoved, true);
  assert.equal(
    fake.calls.some((args) => args[0] === "rm" && args.includes(FOREIGN_ID)),
    false,
  );
});

test("partial network creation cleans the captured ID and poisons the ambiguous role", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner({
    fail(args) {
      return args[0] === "network" && args[1] === "create" && args.at(-1) === fixture.plan.outboundNetwork;
    },
  });
  const driver = createDriver(fake, fixture);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await assert.rejects(driver.prepare(handle, fixture.request, signal), /creation failed/u);
  const capturedId = [...fake.networks.keys()][0];
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.workerNetworkReleased, true);
  assert.equal(cleanup.outboundNetworkReleased, false);
  assert.equal(fake.networks.size, 0);
  assert.equal(
    fake.calls.some((args) => args[0] === "network" && args[1] === "rm" && args[2] === capturedId),
    true,
  );
});

test("unverified create stdout ID is never promoted to destructive ownership", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const runner = {
    async run(args, options) {
      const response = await fake.run(args, options);
      if (
        args[0] === "create" &&
        values(args, "--label").includes("com.policytwin.role=worker")
      ) {
        return { ...response, stdout: `${FOREIGN_ID}\n` };
      }
      return response;
    },
  };
  const driver = createDriver(runner, fixture);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await assert.rejects(driver.prepare(handle, fixture.request, signal), /ownership inspection/u);
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.workerContainerRemoved, false);
  assert.equal(
    fake.calls.some(
      (args) => ["stop", "rm"].includes(args[0]) && args.includes(FOREIGN_ID),
    ),
    false,
  );
});

for (const [label, mutate] of [
  ["entrypoint", (inspection) => { inspection.Config.Entrypoint = ["/bin/sh"]; }],
  ["extra environment", (inspection) => { inspection.Config.Env.push("NODE_OPTIONS=--inspect"); }],
  ["user namespace", (inspection) => { inspection.HostConfig.UsernsMode = "host"; }],
  ["cgroup namespace", (inspection) => { inspection.HostConfig.CgroupnsMode = "host"; }],
  ["working directory", (inspection) => { inspection.Config.WorkingDir = "/tmp"; }],
  ["device", (inspection) => { inspection.HostConfig.Devices = [{ PathOnHost: "/dev/sda" }]; }],
  ["security option", (inspection) => { inspection.HostConfig.SecurityOpt.push("seccomp=unconfined"); }],
  ["memory swap", (inspection) => { inspection.HostConfig.MemorySwap += 1; }],
  ["file-size limit", (inspection) => { inspection.HostConfig.Ulimits[0].Hard += 1; }],
  ["log driver", (inspection) => { inspection.HostConfig.LogConfig.Type = "json-file"; }],
  ["log rotation", (inspection) => { inspection.HostConfig.LogConfig.Config["max-file"] = "10"; }],
  ["restart policy", (inspection) => { inspection.HostConfig.RestartPolicy.Name = "always"; }],
  ["missing restart policy", (inspection) => { delete inspection.HostConfig.RestartPolicy; }],
  ["invalid start timestamp", (inspection) => { inspection.State.StartedAt = "2026-02-31T00:00:00Z"; }],
  ["missing tmpfs", (inspection) => { inspection.HostConfig.Tmpfs = {}; }],
  ["weakened tmpfs", (inspection) => {
    const destination = Object.keys(inspection.HostConfig.Tmpfs)[0];
    inspection.HostConfig.Tmpfs[destination] = "rw,size=16777216";
  }],
  ["bind propagation", (inspection) => { inspection.Mounts[0].Propagation = "rshared"; }],
]) {
  test(`container observer rejects ${label} drift`, async (t) => {
    const fixture = await createFixture(t);
    const fake = new FakeDockerRunner({
      mutateContainerInspection(inspection, container) {
        if (container.labels["com.policytwin.role"] === "egress") mutate(inspection);
      },
    });
    const driver = createDriver(fake, fixture);
    const signal = new AbortController().signal;
    const handle = driver.createHandle(fixture.request);
    await assert.rejects(driver.prepare(handle, fixture.request, signal), /Docker/u);
    const cleanup = await driver.cleanup(handle, "FAILURE", signal);
    assert.equal(cleanup.egressContainerRemoved, true);
  });
}

test("unexpected network membership blocks removal instead of deleting a foreign endpoint", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner();
  const driver = createDriver(fake, fixture);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await driver.prepare(handle, fixture.request, signal);
  const workerNetwork = fake.networkByName(fixture.plan.workerNetwork);
  workerNetwork.containers.set(FOREIGN_ID, "foreign-container");
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.workerNetworkReleased, false);
  assert.equal(fake.networks.has(workerNetwork.id), true);
  assert.equal(
    fake.calls.some(
      (args) => args[0] === "network" && args[1] === "disconnect" && args.includes(FOREIGN_ID),
    ),
    false,
  );
});

test("published ports are rejected from supervisor-owned inspect evidence", async (t) => {
  const fixture = await createFixture(t);
  const fake = new FakeDockerRunner({ publishRole: "worker" });
  const driver = createDriver(fake, fixture);
  const signal = new AbortController().signal;
  const handle = driver.createHandle(fixture.request);
  await assert.rejects(driver.prepare(handle, fixture.request, signal), /isolation|port/u);
  const cleanup = await driver.cleanup(handle, "FAILURE", signal);
  assert.equal(cleanup.workerContainerRemoved, true);
  assert.equal(cleanup.egressContainerRemoved, true);
});

test("supervisor rejects a request image outside its sealed configuration", async (t) => {
  const fixture = await createFixture(t);
  fixture.configuration = {
    ...fixture.configuration,
    allowedWorkerImage: `sha256:${"c".repeat(64)}`,
  };
  const fake = new FakeDockerRunner();
  const driver = createDriver(fake, fixture);
  const handle = driver.createHandle(fixture.request);
  await assert.rejects(
    driver.prepare(handle, fixture.request, new AbortController().signal),
    /not admitted by the supervisor/u,
  );
  assert.equal(fake.calls.length, 0);
});

test("supervisor rejects request limits above its sealed maxima", async (t) => {
  const fixture = await createFixture(t);
  fixture.configuration = {
    ...fixture.configuration,
    maximumWorkerLimits: { ...LIMITS, memoryBytes: LIMITS.memoryBytes - 1 },
  };
  const fake = new FakeDockerRunner();
  const driver = createDriver(fake, fixture);
  const handle = driver.createHandle(fixture.request);
  await assert.rejects(
    driver.prepare(handle, fixture.request, new AbortController().signal),
    /not admitted by the supervisor/u,
  );
  assert.equal(fake.calls.length, 0);
});
