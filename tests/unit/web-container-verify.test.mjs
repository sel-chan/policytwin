import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_CONTAINER_MEMORY_BYTES,
  WEB_CONTAINER_OUTPUT_BYTES,
  assertWebContainerRuntimeObservation,
  createWebContainerResourceOwner,
  inspectWebContainerPrerequisites,
} from "../../scripts/web-container-runtime.mjs";
import {
  initializeVolume,
  webRuntimeArguments,
} from "../../scripts/container-verify.mjs";

const PINNED_NODE = `node:22.22.2-bookworm-slim@sha256:${"a".repeat(64)}`;

function contract(overrides = {}) {
  return {
    schemaVersion: "15",
    targetPlatform: "linux/amd64",
    nodeBaseImage: PINNED_NODE,
    webContainer: {
      status: "STATIC_PREPARED",
      runtimeUser: "node",
      readOnlyRootRequired: true,
      canonicalDockerExecutableRequired: true,
      reviewedDockerExecutableSha256Required: true,
      platformLocalDaemonRequired: true,
      dockerCliEnvironmentVariable: "POLICYTWIN_DOCKER_CLI",
      pathSearchAllowed: false,
      remoteDaemonAllowed: false,
      baseImagePullAllowed: false,
      resourceOwnership: "NONCE_BOUND_LABELS_AND_OBSERVED_IDENTITIES",
      restartPolicy: "no",
      restartCountMustRemainZero: true,
      pidsLimit: 64,
      memoryBytes: WEB_CONTAINER_MEMORY_BYTES,
      memorySwapBytes: WEB_CONTAINER_MEMORY_BYTES,
      cpus: 1,
      fileSizeLimitBytes: WEB_CONTAINER_OUTPUT_BYTES,
      logDriver: "local",
      maximumLogFiles: 1,
      maximumLogBytes: WEB_CONTAINER_OUTPUT_BYTES,
      volumeInitialization: "ROOT_CHOWN_THEN_NODE_RUNTIME",
      persistenceVerification: "API_MUTATION_RESTART_READ",
      handledCleanupSignals: ["SIGINT", "SIGTERM"],
    },
    ...overrides,
  };
}

function labelsFromArgs(args) {
  const labels = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--label") {
      const [key, ...pieces] = args[index + 1].split("=");
      labels[key] = pieces.join("=");
      index += 1;
    }
  }
  return labels;
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function argumentsFor(args, name) {
  return args.filter((_value, index) => args[index - 1] === name);
}

function success(stdout = "") {
  return { status: 0, stdout, stderr: "", error: undefined };
}

function failure() {
  return { status: 1, stdout: "", stderr: "not found", error: undefined };
}

function createFakeDocker(options = {}) {
  const calls = [];
  const images = new Map([[PINNED_NODE, { id: `sha256:${"b".repeat(64)}`, labels: {} }]]);
  const volumes = new Map();
  const containers = new Map();
  let nextContainer = 1;
  let ambiguousRole = options.ambiguousRole ?? null;

  function imageObject(reference) {
    const image = images.get(reference) ??
      [...images.values()].find((candidate) => candidate.id === reference);
    if (!image) return null;
    return {
      Id: image.id,
      RepoTags: [...images.entries()]
        .filter(([, candidate]) => candidate === image)
        .map(([tag]) => tag),
      Config: { Labels: image.labels },
    };
  }

  function volumeObject(name) {
    const volume = volumes.get(name);
    return volume
      ? { Name: name, Driver: "local", Scope: "local", Labels: volume.labels }
      : null;
  }

  function containerObject(reference) {
    const candidate = containers.get(reference) ??
      [...containers.values()].find((container) => container.name === reference);
    if (!candidate) return null;
    return {
      Id: candidate.id,
      Name: `/${candidate.name}`,
      Image: candidate.imageId,
      RestartCount: 0,
      Config: {
        Labels: candidate.labels,
        User: argument(candidate.args, "--user"),
      },
      State: {
        Running: candidate.running,
        Pid: candidate.running ? 4321 : 0,
        StartedAt: candidate.startedAt,
      },
      HostConfig: {
        ReadonlyRootfs: candidate.args.includes("--read-only"),
        Privileged: candidate.args.includes("--privileged"),
        AutoRemove: candidate.args.includes("--rm"),
        PidsLimit: Number(argument(candidate.args, "--pids-limit")),
        Memory: Number(argument(candidate.args, "--memory")),
        MemorySwap: Number(argument(candidate.args, "--memory-swap")),
        NanoCpus: Number(argument(candidate.args, "--cpus")) * 1_000_000_000,
        CapDrop: argumentsFor(candidate.args, "--cap-drop"),
        CapAdd: argumentsFor(candidate.args, "--cap-add"),
        SecurityOpt: argumentsFor(candidate.args, "--security-opt"),
        RestartPolicy: {
          Name: argument(candidate.args, "--restart"),
          MaximumRetryCount: 0,
        },
        LogConfig: {
          Type: argument(candidate.args, "--log-driver"),
          Config: Object.fromEntries(
            argumentsFor(candidate.args, "--log-opt").map((entry) => entry.split("=")),
          ),
        },
        Ulimits: argumentsFor(candidate.args, "--ulimit").map((entry) => {
          const [name, soft, hard] = entry.split(/[=:]/u);
          return { Name: name, Soft: Number(soft), Hard: Number(hard) };
        }),
      },
    };
  }

  const docker = (args) => {
    calls.push([...args]);
    if (args[0] === "image" && args[1] === "inspect") {
      const reference = args.at(-1);
      const value = imageObject(reference);
      return value ? success(`${JSON.stringify(value)}\n`) : failure();
    }
    if (args[0] === "image" && args[1] === "ls") {
      const reference = argument(args, "--filter")?.replace(/^reference=/u, "");
      return success(images.has(reference) ? `${images.get(reference).id}\n` : "");
    }
    if (args[0] === "build") {
      const tag = argument(args, "--tag");
      images.set(tag, { id: `sha256:${"c".repeat(64)}`, labels: labelsFromArgs(args) });
      return success();
    }
    if (args[0] === "volume" && args[1] === "inspect") {
      const value = volumeObject(args.at(-1));
      return value ? success(`${JSON.stringify(value)}\n`) : failure();
    }
    if (args[0] === "volume" && args[1] === "ls") {
      const labelFilters = args
        .filter((_value, index) => args[index - 1] === "--filter")
        .filter((value) => value.startsWith("label="))
        .map((value) => value.slice("label=".length));
      const names = [...volumes.entries()]
        .filter(([, volume]) =>
          labelFilters.every((filter) => {
            const [key, expected] = filter.split("=");
            return volume.labels[key] === expected;
          }),
        )
        .map(([name]) => name);
      return success(names.length === 0 ? "" : `${names.join("\n")}\n`);
    }
    if (args[0] === "volume" && args[1] === "create") {
      const name = args.at(-1);
      volumes.set(name, { labels: labelsFromArgs(args) });
      return success(`${name}\n`);
    }
    if (args[0] === "create") {
      const name = argument(args, "--name");
      const labels = labelsFromArgs(args);
      const imageTag = [...images.keys()].find((tag) => args.includes(tag));
      const id = nextContainer.toString(16).padStart(64, "0");
      nextContainer += 1;
      const container = {
        id,
        name,
        labels,
        args: [...args],
        imageId: images.get(imageTag).id,
        running: false,
        startedAt: "0001-01-01T00:00:00Z",
        exitCode: 0,
        logs: labels["com.policytwin.role"] === "web-volume-probe" ? "1000" : "",
      };
      containers.set(id, container);
      if (labels["com.policytwin.role"] === ambiguousRole) {
        ambiguousRole = null;
        return failure();
      }
      return success(`${id}\n`);
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const value = containerObject(args.at(-1));
      return value ? success(`${JSON.stringify(value)}\n`) : failure();
    }
    if (args[0] === "ps") {
      const filters = args.filter((_value, index) => args[index - 1] === "--filter");
      const ids = [...containers.values()]
        .filter((container) =>
          filters.every((filter) => {
            if (filter.startsWith("id=")) return container.id === filter.slice(3);
            if (filter.startsWith("name=^/")) {
              return container.name === filter.slice("name=^/".length, -1);
            }
            if (filter.startsWith("label=")) {
              const [key, expected] = filter.slice("label=".length).split("=");
              return container.labels[key] === expected;
            }
            return true;
          }),
        )
        .map((container) => container.id);
      return success(ids.length === 0 ? "" : `${ids.join("\n")}\n`);
    }
    if (args[0] === "start") {
      const container = containers.get(args[1]);
      container.running = true;
      container.startedAt = "2026-07-18T10:00:00.000000000Z";
      return success(`${container.id}\n`);
    }
    if (args[0] === "wait") {
      const container = containers.get(args[1]);
      container.running = false;
      return success(`${container.exitCode}\n`);
    }
    if (args[0] === "logs") {
      return success(containers.get(args[1]).logs);
    }
    if (args[0] === "rm") {
      containers.delete(args.at(-1));
      return success();
    }
    if (args[0] === "volume" && args[1] === "rm") {
      volumes.delete(args.at(-1));
      return success();
    }
    if (args[0] === "image" && args[1] === "rm") {
      const reference = args.at(-1);
      for (const [tag, image] of images) {
        if (tag === reference || image.id === reference) images.delete(tag);
      }
      return success();
    }
    throw new Error(`Unexpected fake Docker call: ${JSON.stringify(args)}`);
  };

  return { docker, calls, images, volumes, containers };
}

function runtimeArgs(owner) {
  return [
    "--user",
    "node",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "64",
    "--memory",
    String(WEB_CONTAINER_MEMORY_BYTES),
    "--memory-swap",
    String(WEB_CONTAINER_MEMORY_BYTES),
    "--cpus",
    "1",
    "--ulimit",
    `fsize=${WEB_CONTAINER_OUTPUT_BYTES}:${WEB_CONTAINER_OUTPUT_BYTES}`,
    "--log-driver",
    "local",
    "--log-opt",
    `max-size=${WEB_CONTAINER_OUTPUT_BYTES}`,
    "--log-opt",
    "max-file=1",
    owner.identity.imageTag,
  ];
}

test("web container prerequisites reject an unset or mutable base before Docker", () => {
  assert.deepEqual(inspectWebContainerPrerequisites(contract({ nodeBaseImage: null })), {
    schemaVersion: "1",
    status: "FAIL",
    dockerInvoked: false,
    failures: ["immutable Node base image is unset"],
  });
  assert.equal(inspectWebContainerPrerequisites(contract()).status, "PASS");
});

test("web verifier owns tagged image, volume, and containers through exact bindings", () => {
  const fake = createFakeDocker();
  const owner = createWebContainerResourceOwner({
    docker: fake.docker,
    contract: contract(),
    nonce: "1".repeat(32),
  });
  owner.preflight();
  assert.equal(owner.buildImage(), `sha256:${"c".repeat(64)}`);
  assert.equal(owner.createVolume(), owner.identity.volumeName);
  const firstId = owner.createContainer("web-first", runtimeArgs(owner));
  owner.startContainer("web-first");
  const observation = owner.observeContainer("web-first", true);
  assert.equal(observation.Id, firstId);
  assertWebContainerRuntimeObservation(observation);
  owner.removeContainer("web-first");
  assert.deepEqual(owner.cleanup(), []);
  assert.equal(fake.volumes.size, 0);
  assert.equal(fake.containers.size, 0);
  assert.equal(fake.images.has(owner.identity.imageTag), false);
  const build = fake.calls.find((args) => args[0] === "build");
  assert.equal(build.includes("--pull=false"), true);
  assert.equal(build.includes("--pull"), false);
  for (const args of fake.calls.filter((entry) => ["start", "wait", "logs", "rm"].includes(entry[0]))) {
    assert.match(args.at(-1), /^[0-9a-f]{64}$/u);
  }
  const imageRemoval = fake.calls.find(
    (args) => args[0] === "image" && args[1] === "rm",
  );
  assert.match(imageRemoval.at(-1), /^sha256:[0-9a-f]{64}$/u);
});

test("ambiguous create recovers only one exact-name exact-label container for cleanup", () => {
  const fake = createFakeDocker({ ambiguousRole: "web-runtime-first" });
  const owner = createWebContainerResourceOwner({
    docker: fake.docker,
    contract: contract(),
    nonce: "2".repeat(32),
  });
  owner.preflight();
  owner.buildImage();
  owner.createVolume();
  assert.throws(
    () => owner.createContainer("web-first", runtimeArgs(owner)),
    /ambiguous|cleanup-only/iu,
  );
  assert.throws(() => owner.containerId("web-first"), /execution authority/iu);
  assert.deepEqual(owner.cleanup(), []);
  assert.equal(fake.containers.size, 0);
  assert.equal(fake.volumes.size, 0);
});

test("weakened runtime creation is cleanup-only and never gains start authority", () => {
  const fake = createFakeDocker();
  const owner = createWebContainerResourceOwner({
    docker: fake.docker,
    contract: contract(),
    nonce: "3".repeat(32),
  });
  owner.preflight();
  owner.buildImage();
  owner.createVolume();
  const weakened = runtimeArgs(owner);
  weakened[weakened.indexOf("--memory-swap") + 1] = "0";
  assert.throws(
    () => owner.createContainer("web-first", weakened),
    /runtime resources|weakened/iu,
  );
  assert.throws(() => owner.startContainer("web-first"), /execution authority/iu);
  assert.deepEqual(owner.cleanup(), []);
  assert.equal(fake.containers.size, 0);
  assert.equal(fake.volumes.size, 0);
  assert.equal(fake.images.has(owner.identity.imageTag), false);
});

test("volume setup and both web roles complete through the owned four-role lifecycle", () => {
  const fake = createFakeDocker();
  const owner = createWebContainerResourceOwner({
    docker: fake.docker,
    contract: contract(),
    nonce: "4".repeat(32),
  });
  const facts = {};
  owner.preflight();
  owner.buildImage();
  owner.createVolume();
  initializeVolume(owner, facts);
  assert.equal(facts.volumeOwnerUid, "1000");
  assert.equal(facts.initializationResourceLimitsVerified, true);
  for (const role of ["web-first", "web-second"]) {
    owner.createContainer(role, webRuntimeArguments(owner));
    owner.startContainer(role);
    assertWebContainerRuntimeObservation(owner.observeContainer(role, true), role);
    owner.removeContainer(role);
  }
  assert.deepEqual(owner.cleanup(), []);
  assert.equal(fake.containers.size, 0);
  assert.equal(fake.volumes.size, 0);
  assert.equal(fake.images.has(owner.identity.imageTag), false);
  assert.deepEqual(
    fake.calls
      .filter((args) => args[0] === "create")
      .map((args) => labelsFromArgs(args)["com.policytwin.role"]),
    ["web-volume-init", "web-volume-probe", "web-runtime-first", "web-runtime-second"],
  );
});

test("runtime observation rejects restart, swap, file, or log weakening", () => {
  const fake = createFakeDocker();
  const owner = createWebContainerResourceOwner({
    docker: fake.docker,
    contract: contract(),
    nonce: "3".repeat(32),
  });
  owner.preflight();
  owner.buildImage();
  owner.createVolume();
  owner.createContainer("web-first", runtimeArgs(owner));
  owner.startContainer("web-first");
  const observation = owner.observeContainer("web-first", true);
  assert.doesNotThrow(() => assertWebContainerRuntimeObservation(observation));
  for (const mutate of [
    (value) => { value.RestartCount = 1; },
    (value) => { value.HostConfig.RestartPolicy.Name = "always"; },
    (value) => { value.HostConfig.MemorySwap += 1; },
    (value) => { value.HostConfig.Ulimits[0].Hard += 1; },
    (value) => { value.HostConfig.LogConfig.Config["max-file"] = "2"; },
  ]) {
    const weakened = structuredClone(observation);
    mutate(weakened);
    assert.throws(() => assertWebContainerRuntimeObservation(weakened));
  }
  owner.cleanup();
});
