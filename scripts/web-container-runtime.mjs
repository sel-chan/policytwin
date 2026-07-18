import { createHash } from "node:crypto";

export const WEB_CONTAINER_MEMORY_BYTES = 1024 * 1024 * 1024;
export const WEB_CONTAINER_OUTPUT_BYTES = 16 * 1024 * 1024;
export const WEB_CONTAINER_PIDS = 64;

const NODE_IMAGE = /^node:22\.22\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u;
const DOCKER_ID = /^[0-9a-f]{64}$/u;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const NONCE = /^[0-9a-f]{32}$/u;
const SAFE_DOCKER_ARGUMENT = /^[^\0\r\n]+$/u;
const ROLES = Object.freeze({
  "volume-init": "web-volume-init",
  "volume-probe": "web-volume-probe",
  "web-first": "web-runtime-first",
  "web-second": "web-runtime-second",
});
const ROLE_ORDER = Object.freeze(["volume-init", "volume-probe", "web-first", "web-second"]);
const CONTROLLED_CREATE_OPTIONS = new Set(["--name", "--label", "--restart", "--rm", "--detach"]);

function resultPassed(result) {
  return result?.error === undefined && result?.status === 0;
}

function outputLines(value) {
  return typeof value === "string"
    ? value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    : [];
}

function parseDockerObject(result, label) {
  if (!resultPassed(result)) throw new Error(`${label} could not be inspected.`);
  let value;
  try {
    value = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`${label} inspection returned invalid JSON.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} inspection returned an invalid object.`);
  }
  return value;
}

function requiredDockerId(value, label) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!DOCKER_ID.test(id)) throw new Error(`${label} did not return one canonical Docker ID.`);
  return id;
}

function assertRequiredLabels(actual, required, label) {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    throw new Error(`${label} labels are unavailable.`);
  }
  for (const [key, value] of Object.entries(required)) {
    if (actual[key] !== value) throw new Error(`${label} ownership labels do not match.`);
  }
}

function safeDockerTail(args, imageTag) {
  if (!Array.isArray(args) || args.length === 0 || args.length > 128) {
    throw new Error("Web container create arguments are invalid.");
  }
  let imageReferences = 0;
  for (const value of args) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      Buffer.byteLength(value, "utf8") > 8_192 ||
      !SAFE_DOCKER_ARGUMENT.test(value) ||
      CONTROLLED_CREATE_OPTIONS.has(value)
    ) {
      throw new Error("Web container create arguments weaken the ownership contract.");
    }
    if (value === imageTag) imageReferences += 1;
  }
  if (imageReferences !== 1) {
    throw new Error("Web container create arguments must select the exact owned image tag once.");
  }
  return [...args];
}

function bindingFor(contract, nonce) {
  return createHash("sha256")
    .update("policytwin-web-container-verify-v1", "utf8")
    .update("\0", "utf8")
    .update(contract.nodeBaseImage, "utf8")
    .update("\0", "utf8")
    .update(contract.targetPlatform, "utf8")
    .update("\0", "utf8")
    .update(nonce, "utf8")
    .digest("hex");
}

function labels(bindingSha256, nonce, role) {
  return Object.freeze({
    "com.policytwin.managed": "true",
    "com.policytwin.contract-version": "web-v1",
    "com.policytwin.binding-sha256": bindingSha256,
    "com.policytwin.run-id": `web-${nonce}`,
    "com.policytwin.role": role,
  });
}

function labelArguments(value) {
  return Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([key, entry]) => ["--label", `${key}=${entry}`]);
}

function exactResourceIdentity(contract, nonce) {
  const bindingSha256 = bindingFor(contract, nonce);
  const suffix = bindingSha256.slice(0, 32);
  const containerNames = Object.fromEntries(
    ROLE_ORDER.map((role) => [role, `policytwin-web-${role}-${suffix}`]),
  );
  const roleLabels = Object.fromEntries(
    ROLE_ORDER.map((role) => [role, labels(bindingSha256, nonce, ROLES[role])]),
  );
  return Object.freeze({
    schemaVersion: "1",
    bindingSha256,
    imageTag: `policytwin-web-verify:${suffix}`,
    volumeName: `policytwin-web-data-${suffix}`,
    containerNames: Object.freeze(containerNames),
    imageLabels: labels(bindingSha256, nonce, "web-image"),
    volumeLabels: labels(bindingSha256, nonce, "web-data"),
    roleLabels: Object.freeze(roleLabels),
  });
}

export function inspectWebContainerPrerequisites(contract) {
  const failures = [];
  if (contract?.schemaVersion !== "15") failures.push("container schema v15 is required");
  if (contract?.targetPlatform !== "linux/amd64") {
    failures.push("web container target platform must be linux/amd64");
  }
  if (!NODE_IMAGE.test(contract?.nodeBaseImage ?? "")) {
    failures.push("immutable Node base image is unset");
  }
  if (
    contract?.webContainer?.status !== "STATIC_PREPARED" ||
    contract?.webContainer?.runtimeUser !== "node" ||
    contract?.webContainer?.readOnlyRootRequired !== true ||
    contract?.webContainer?.canonicalDockerExecutableRequired !== true ||
    contract?.webContainer?.reviewedDockerExecutableSha256Required !== true ||
    contract?.webContainer?.platformLocalDaemonRequired !== true ||
    contract?.webContainer?.dockerCliEnvironmentVariable !== "POLICYTWIN_DOCKER_CLI" ||
    contract?.webContainer?.pathSearchAllowed !== false ||
    contract?.webContainer?.remoteDaemonAllowed !== false ||
    contract?.webContainer?.baseImagePullAllowed !== false ||
    contract?.webContainer?.resourceOwnership !==
      "NONCE_BOUND_LABELS_AND_OBSERVED_IDENTITIES" ||
    contract?.webContainer?.restartPolicy !== "no" ||
    contract?.webContainer?.restartCountMustRemainZero !== true ||
    contract?.webContainer?.pidsLimit !== WEB_CONTAINER_PIDS ||
    contract?.webContainer?.memoryBytes !== WEB_CONTAINER_MEMORY_BYTES ||
    contract?.webContainer?.memorySwapBytes !== WEB_CONTAINER_MEMORY_BYTES ||
    contract?.webContainer?.cpus !== 1 ||
    contract?.webContainer?.fileSizeLimitBytes !== WEB_CONTAINER_OUTPUT_BYTES ||
    contract?.webContainer?.logDriver !== "local" ||
    contract?.webContainer?.maximumLogFiles !== 1 ||
    contract?.webContainer?.maximumLogBytes !== WEB_CONTAINER_OUTPUT_BYTES ||
    contract?.webContainer?.volumeInitialization !== "ROOT_CHOWN_THEN_NODE_RUNTIME" ||
    contract?.webContainer?.persistenceVerification !== "API_MUTATION_RESTART_READ" ||
    JSON.stringify(contract?.webContainer?.handledCleanupSignals) !==
      JSON.stringify(["SIGINT", "SIGTERM"])
  ) {
    failures.push("web container static contract is invalid");
  }
  return {
    schemaVersion: "1",
    status: failures.length === 0 ? "PASS" : "FAIL",
    dockerInvoked: false,
    failures,
  };
}

export function assertWebContainerRuntimeObservation(value, role = "web-first") {
  if (!ROLE_ORDER.includes(role)) {
    throw new Error("Web container runtime role is invalid.");
  }
  const host = value?.HostConfig;
  const ulimit = Array.isArray(host?.Ulimits)
    ? host.Ulimits.find((entry) => entry?.Name === "fsize")
    : null;
  const security = Array.isArray(host?.SecurityOpt) ? host.SecurityOpt : [];
  const expectedUser = role === "volume-init" ? "0:0" : "node";
  const expectedCapAdd = role === "volume-init" ? ["CHOWN"] : [];
  if (
    typeof value !== "object" ||
    value === null ||
    !DOCKER_ID.test(value.Id ?? "") ||
    value.RestartCount !== 0 ||
    value?.Config?.User !== expectedUser ||
    host?.ReadonlyRootfs !== true ||
    host?.Privileged !== false ||
    host?.AutoRemove !== false ||
    host?.PidsLimit !== WEB_CONTAINER_PIDS ||
    host?.Memory !== WEB_CONTAINER_MEMORY_BYTES ||
    host?.MemorySwap !== WEB_CONTAINER_MEMORY_BYTES ||
    host?.NanoCpus !== 1_000_000_000 ||
    JSON.stringify(host?.CapDrop) !== JSON.stringify(["ALL"]) ||
    JSON.stringify(host?.CapAdd ?? []) !== JSON.stringify(expectedCapAdd) ||
    !security.some((entry) => entry === "no-new-privileges" || entry === "no-new-privileges:true") ||
    host?.RestartPolicy?.Name !== "no" ||
    host?.RestartPolicy?.MaximumRetryCount !== 0 ||
    host?.LogConfig?.Type !== "local" ||
    host?.LogConfig?.Config?.["max-size"] !== String(WEB_CONTAINER_OUTPUT_BYTES) ||
    host?.LogConfig?.Config?.["max-file"] !== "1" ||
    ulimit?.Soft !== WEB_CONTAINER_OUTPUT_BYTES ||
    ulimit?.Hard !== WEB_CONTAINER_OUTPUT_BYTES
  ) {
    throw new Error("Web container runtime resources or restart policy were weakened.");
  }
  return value;
}

export function createWebContainerResourceOwner(options) {
  if (typeof options?.docker !== "function") {
    throw new Error("Web container ownership requires the pinned Docker runner.");
  }
  const readiness = inspectWebContainerPrerequisites(options.contract);
  if (readiness.status !== "PASS") {
    throw new Error(`Web container prerequisites are incomplete: ${readiness.failures.join(" ")}`);
  }
  if (!NONCE.test(options.nonce ?? "")) {
    throw new Error("Web container ownership nonce must be 128-bit lowercase hex.");
  }
  const docker = options.docker;
  const contract = structuredClone(options.contract);
  const identity = exactResourceIdentity(contract, options.nonce);
  const containers = new Map(
    ROLE_ORDER.map((role) => [role, { id: null, cleanupOnly: false, uncertain: false }]),
  );
  let preflightComplete = false;
  let imageId = null;
  let imageCleanupOnly = false;
  let imageUncertain = false;
  let volumeOwned = false;
  let volumeCleanupOnly = false;
  let volumeUncertain = false;

  function inspectImage(reference, allowFailure = false) {
    const result = docker(
      ["image", "inspect", "--format", "{{json .}}", reference],
      30_000,
      allowFailure,
    );
    if (allowFailure && !resultPassed(result)) return null;
    return parseDockerObject(result, "Web verification image");
  }

  function inspectVolume(name, allowFailure = false) {
    const result = docker(
      ["volume", "inspect", "--format", "{{json .}}", name],
      30_000,
      allowFailure,
    );
    if (allowFailure && !resultPassed(result)) return null;
    return parseDockerObject(result, "Web verification volume");
  }

  function inspectContainer(reference, allowFailure = false) {
    const result = docker(
      ["container", "inspect", "--format", "{{json .}}", reference],
      30_000,
      allowFailure,
    );
    if (allowFailure && !resultPassed(result)) return null;
    return parseDockerObject(result, "Web verification container");
  }

  function assertImage(value) {
    if (
      !IMAGE_ID.test(value?.Id ?? "") ||
      !Array.isArray(value?.RepoTags) ||
      value.RepoTags.length !== 1 ||
      value.RepoTags[0] !== identity.imageTag
    ) {
      throw new Error("Web verification image identity is invalid.");
    }
    assertRequiredLabels(value?.Config?.Labels, identity.imageLabels, "Web verification image");
    return value.Id;
  }

  function assertVolume(value) {
    if (
      value?.Name !== identity.volumeName ||
      value?.Driver !== "local" ||
      value?.Scope !== "local"
    ) {
      throw new Error("Web verification volume identity is invalid.");
    }
    assertRequiredLabels(value?.Labels, identity.volumeLabels, "Web verification volume");
    return value.Name;
  }

  function assertContainer(value, role, expectedRunning = null) {
    assertContainerIdentity(value, role, expectedRunning);
    assertWebContainerRuntimeObservation(value, role);
    return value;
  }

  function assertContainerIdentity(value, role, expectedRunning = null) {
    const state = containers.get(role);
    if (state === undefined) throw new Error("Web verification container role is invalid.");
    if (
      !DOCKER_ID.test(value?.Id ?? "") ||
      value?.Name !== `/${identity.containerNames[role]}` ||
      value?.Image !== imageId ||
      value?.RestartCount !== 0 ||
      value?.HostConfig?.RestartPolicy?.Name !== "no" ||
      value?.HostConfig?.RestartPolicy?.MaximumRetryCount !== 0
    ) {
      throw new Error("Web verification container identity or restart policy is invalid.");
    }
    assertRequiredLabels(
      value?.Config?.Labels,
      identity.roleLabels[role],
      "Web verification container",
    );
    if (state.id !== null && value.Id !== state.id) {
      throw new Error("Web verification container ID changed unexpectedly.");
    }
    if (
      expectedRunning === true &&
      (value?.State?.Running !== true ||
        !Number.isSafeInteger(value?.State?.Pid) ||
        value.State.Pid < 1 ||
        value.State.StartedAt === "0001-01-01T00:00:00Z")
    ) {
      throw new Error("Web verification container is not one valid running instance.");
    }
    if (
      expectedRunning === false &&
      (value?.State?.Running !== false || value?.State?.Pid !== 0)
    ) {
      throw new Error("Web verification container did not stop as the same instance.");
    }
    return value;
  }

  function containerLines(role) {
    const filters = [
      `name=^/${identity.containerNames[role]}$`,
      `label=com.policytwin.binding-sha256=${identity.bindingSha256}`,
      `label=com.policytwin.role=${ROLES[role]}`,
    ];
    return outputLines(
      docker(
        [
          "ps",
          "--all",
          "--no-trunc",
          ...filters.flatMap((filter) => ["--filter", filter]),
          "--format",
          "{{.ID}}",
        ],
        10_000,
      ).stdout,
    );
  }

  function recoverImageForCleanup() {
    const observed = inspectImage(identity.imageTag, true);
    if (observed === null) return false;
    try {
      imageId = assertImage(observed);
      imageCleanupOnly = true;
      imageUncertain = false;
      return true;
    } catch {
      return false;
    }
  }

  function recoverVolumeForCleanup() {
    const observed = inspectVolume(identity.volumeName, true);
    if (observed === null) return false;
    try {
      assertVolume(observed);
      volumeOwned = true;
      volumeCleanupOnly = true;
      volumeUncertain = false;
      return true;
    } catch {
      return false;
    }
  }

  function recoverContainerForCleanup(role) {
    const state = containers.get(role);
    const ids = containerLines(role);
    if (ids.length !== 1 || !DOCKER_ID.test(ids[0])) return false;
    try {
      const observed = inspectContainer(ids[0]);
      state.id = ids[0];
      assertContainerIdentity(observed, role, null);
      state.cleanupOnly = true;
      state.uncertain = false;
      return true;
    } catch {
      state.id = null;
      return false;
    }
  }

  function preflight() {
    if (preflightComplete) throw new Error("Web container preflight is single-use.");
    const base = inspectImage(contract.nodeBaseImage, true);
    if (base === null || !IMAGE_ID.test(base.Id ?? "")) {
      throw new Error("Immutable Node base image is not present locally; no pull was attempted.");
    }
    if (inspectImage(identity.imageTag, true) !== null) {
      throw new Error("Web verification image tag already exists.");
    }
    if (inspectVolume(identity.volumeName, true) !== null) {
      throw new Error("Web verification volume name already exists.");
    }
    for (const role of ROLE_ORDER) {
      if (inspectContainer(identity.containerNames[role], true) !== null) {
        throw new Error("Web verification container name already exists.");
      }
    }
    preflightComplete = true;
  }

  function buildImage() {
    if (!preflightComplete || imageId !== null || imageUncertain) {
      throw new Error("Web verification image build is not admissible in this state.");
    }
    imageUncertain = true;
    const result = docker(
      [
        "build",
        "--pull=false",
        "--platform",
        contract.targetPlatform,
        "--build-arg",
        `NODE_BASE_IMAGE=${contract.nodeBaseImage}`,
        ...labelArguments(identity.imageLabels),
        "--tag",
        identity.imageTag,
        ".",
      ],
      20 * 60_000,
      true,
    );
    if (!resultPassed(result)) {
      recoverImageForCleanup();
      throw new Error("Web verification image build was ambiguous and cannot grant execution authority.");
    }
    const observed = inspectImage(identity.imageTag);
    imageId = assertImage(observed);
    imageCleanupOnly = false;
    imageUncertain = false;
    return imageId;
  }

  function createVolume() {
    if (!preflightComplete || imageId === null || imageCleanupOnly || volumeOwned || volumeUncertain) {
      throw new Error("Web verification volume creation is not admissible in this state.");
    }
    volumeUncertain = true;
    const result = docker(
      ["volume", "create", ...labelArguments(identity.volumeLabels), identity.volumeName],
      30_000,
      true,
    );
    if (!resultPassed(result) || result.stdout.trim() !== identity.volumeName) {
      recoverVolumeForCleanup();
      throw new Error("Web verification volume creation was ambiguous and cannot grant execution authority.");
    }
    assertVolume(inspectVolume(identity.volumeName));
    volumeOwned = true;
    volumeCleanupOnly = false;
    volumeUncertain = false;
    return identity.volumeName;
  }

  function createContainer(role, args) {
    const state = containers.get(role);
    if (
      state === undefined ||
      !volumeOwned ||
      volumeCleanupOnly ||
      imageId === null ||
      imageCleanupOnly ||
      state.id !== null ||
      state.uncertain
    ) {
      throw new Error("Web verification container creation is not admissible in this state.");
    }
    const tail = safeDockerTail(args, identity.imageTag);
    state.uncertain = true;
    const result = docker(
      [
        "create",
        "--name",
        identity.containerNames[role],
        "--restart",
        "no",
        ...labelArguments(identity.roleLabels[role]),
        ...tail,
      ],
      60_000,
      true,
    );
    let candidate;
    try {
      candidate = resultPassed(result)
        ? requiredDockerId(result.stdout, "Web verification container create")
        : null;
    } catch {
      candidate = null;
    }
    if (candidate === null) {
      recoverContainerForCleanup(role);
      throw new Error("Web verification container creation was ambiguous and is cleanup-only.");
    }
    state.id = candidate;
    try {
      assertContainer(inspectContainer(candidate), role, null);
    } catch (error) {
      try {
        assertContainerIdentity(inspectContainer(candidate), role, null);
        state.cleanupOnly = true;
        state.uncertain = false;
      } catch {
        state.id = null;
        recoverContainerForCleanup(role);
      }
      throw error;
    }
    state.cleanupOnly = false;
    state.uncertain = false;
    return candidate;
  }

  function containerId(role) {
    const state = containers.get(role);
    if (state?.id === null || state === undefined || state.cleanupOnly || state.uncertain) {
      throw new Error("Web verification container lacks execution authority.");
    }
    return state.id;
  }

  function startContainer(role, requireRunningObservation = true) {
    if (typeof requireRunningObservation !== "boolean") {
      throw new Error("Web verification container start observation mode is invalid.");
    }
    const id = containerId(role);
    assertContainer(inspectContainer(id), role, false);
    const result = docker(["start", id], 30_000, true);
    if (!resultPassed(result) || result.stdout.trim() !== id) {
      throw new Error("Web verification container start failed.");
    }
    assertContainer(inspectContainer(id), role, requireRunningObservation ? true : null);
    return id;
  }

  function observeContainer(role, expectedRunning) {
    if (expectedRunning !== true && expectedRunning !== false && expectedRunning !== null) {
      throw new Error("Web verification container state expectation is invalid.");
    }
    return assertContainer(
      inspectContainer(containerId(role)),
      role,
      expectedRunning,
    );
  }

  function waitContainer(role) {
    const id = containerId(role);
    const result = docker(["wait", id], 30_000, true);
    const exitCode = Number(result?.stdout?.trim());
    if (!resultPassed(result) || !Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) {
      throw new Error("Web verification container wait returned an invalid exit code.");
    }
    assertContainer(inspectContainer(id), role, false);
    return exitCode;
  }

  function logsContainer(role) {
    const id = containerId(role);
    const result = docker(["logs", id], 30_000, true);
    if (!resultPassed(result) || typeof result.stdout !== "string") {
      throw new Error("Web verification container logs are unavailable.");
    }
    return result.stdout;
  }

  function containerAbsent(id, role) {
    const inspected = inspectContainer(id, true);
    const byId = outputLines(
      docker(
        ["ps", "--all", "--no-trunc", "--filter", `id=${id}`, "--format", "{{.ID}}"],
        10_000,
        true,
      ).stdout,
    );
    const byRole = containerLines(role);
    return inspected === null && byId.length === 0 && byRole.length === 0;
  }

  function removeContainer(role) {
    const state = containers.get(role);
    if (state?.id === null || state === undefined) return;
    const id = state.id;
    assertContainerIdentity(inspectContainer(id), role, null);
    const result = docker(["rm", "--force", id], 30_000, true);
    if (!resultPassed(result) || !containerAbsent(id, role)) {
      throw new Error("Web verification container cleanup did not prove final absence.");
    }
    state.id = null;
    state.cleanupOnly = false;
    state.uncertain = false;
  }

  function volumeAbsent() {
    const inspected = inspectVolume(identity.volumeName, true);
    const listed = docker(
      [
        "volume",
        "ls",
        "--filter",
        `label=com.policytwin.binding-sha256=${identity.bindingSha256}`,
        "--filter",
        "label=com.policytwin.role=web-data",
        "--format",
        "{{.Name}}",
      ],
      10_000,
      true,
    );
    return inspected === null && resultPassed(listed) && outputLines(listed.stdout).length === 0;
  }

  function imageAbsent(id) {
    const inspected = inspectImage(identity.imageTag, true);
    const inspectedId = inspectImage(id, true);
    const listed = docker(
      [
        "image",
        "ls",
        "--no-trunc",
        "--filter",
        `reference=${identity.imageTag}`,
        "--format",
        "{{.ID}}",
      ],
      10_000,
      true,
    );
    return (
      inspected === null &&
      inspectedId === null &&
      resultPassed(listed) &&
      outputLines(listed.stdout).length === 0
    );
  }

  function cleanup() {
    const failures = [];
    for (const role of [...ROLE_ORDER].reverse()) {
      const state = containers.get(role);
      if (state.uncertain && state.id === null && !recoverContainerForCleanup(role)) {
        failures.push(`Web ${role} container side effect remains unresolved.`);
      }
      if (state.id !== null) {
        try {
          removeContainer(role);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    if (volumeUncertain && !volumeOwned && !recoverVolumeForCleanup()) {
      failures.push("Web verification volume side effect remains unresolved.");
    }
    if (volumeOwned) {
      try {
        assertVolume(inspectVolume(identity.volumeName));
        const result = docker(
          ["volume", "rm", "--force", identity.volumeName],
          30_000,
          true,
        );
        if (!resultPassed(result) || !volumeAbsent()) {
          throw new Error("Web verification volume cleanup did not prove final absence.");
        }
        volumeOwned = false;
        volumeCleanupOnly = false;
        volumeUncertain = false;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (imageUncertain && imageId === null && !recoverImageForCleanup()) {
      failures.push("Web verification image side effect remains unresolved.");
    }
    if (imageId !== null) {
      try {
        assertImage(inspectImage(identity.imageTag));
        const ownedImageId = imageId;
        const result = docker(
          ["image", "rm", "--force", ownedImageId],
          60_000,
          true,
        );
        if (!resultPassed(result) || !imageAbsent(ownedImageId)) {
          throw new Error("Web verification image cleanup did not prove final identity absence.");
        }
        imageId = null;
        imageCleanupOnly = false;
        imageUncertain = false;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    return [...new Set(failures)];
  }

  return Object.freeze({
    identity,
    preflight,
    buildImage,
    createVolume,
    createContainer,
    containerId,
    startContainer,
    observeContainer,
    waitContainer,
    logsContainer,
    removeContainer,
    cleanup,
  });
}
