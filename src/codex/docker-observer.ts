const DOCKER_ID = /^[0-9a-f]{64}$/u;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const POLICYTWIN_LABEL_PREFIX = "com.policytwin.";
const MAX_INSPECTION_BYTES = 4 * 1024 * 1024;

interface JsonRecord {
  [key: string]: unknown;
}

export interface DockerNetworkObservation {
  id: string;
  name: string;
  internal: boolean;
  labels: Readonly<Record<string, string>>;
  containerIds: readonly string[];
}

export interface DockerBindMountExpectation {
  source: string;
  destination: string;
  readOnly: boolean;
}

export interface DockerTmpfsExpectation {
  destination: string;
  sizeBytes: number;
}

export interface DockerContainerObservation {
  id: string;
  name: string;
  image: string;
  pid: number;
  running: boolean;
  networkIds: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function nullableRecord(value: unknown, label: string): JsonRecord {
  if (value === null || value === undefined) return {};
  return record(value, label);
}

function parseInspection(value: string, label: string): JsonRecord {
  if (Buffer.byteLength(value, "utf8") < 2 || Buffer.byteLength(value, "utf8") > MAX_INSPECTION_BYTES) {
    throw new Error(`${label} output size is invalid.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  const values = array(parsed, label);
  if (values.length !== 1) throw new Error(`${label} must contain exactly one resource.`);
  return record(values[0], label);
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  const source = nullableRecord(value, label);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item !== "string") throw new Error(`${label} is invalid.`);
    result[key] = item;
  }
  return result;
}

function assertPolicyTwinLabels(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): void {
  const relevant = Object.fromEntries(
    Object.entries(actual).filter(([key]) => key.startsWith(POLICYTWIN_LABEL_PREFIX)),
  );
  const actualEntries = Object.entries(relevant).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  if (
    actualEntries.length !== expectedEntries.length ||
    actualEntries.some(
      ([key, value], index) =>
        key !== expectedEntries[index]?.[0] || value !== expectedEntries[index]?.[1],
    )
  ) {
    throw new Error("Docker ownership labels do not match the admitted run.");
  }
}

export function parseCreatedDockerId(value: string, label: string): string {
  const id = value.trim();
  if (!DOCKER_ID.test(id)) throw new Error(`${label} did not return one canonical resource ID.`);
  return id;
}

export function parseDockerWaitExitCode(value: string, label: string): number {
  const output = value.trim();
  if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(output)) {
    throw new Error(`${label} returned an invalid exit code.`);
  }
  return integer(Number(output), `${label} exit code`);
}

export function parseDockerNetworkOwnershipInspection(
  value: string,
  expected: {
    id: string;
    name: string;
    labels: Readonly<Record<string, string>>;
  },
): void {
  const network = parseInspection(value, "Docker network ownership inspection");
  const id = text(network.Id, "Docker network ownership ID");
  const name = text(network.Name, "Docker network ownership name");
  const labels = stringRecord(network.Labels, "Docker network ownership labels");
  if (!DOCKER_ID.test(id) || id !== expected.id || name !== expected.name) {
    throw new Error("Docker network ownership does not match the created resource.");
  }
  assertPolicyTwinLabels(labels, expected.labels);
}

export function parseDockerContainerOwnershipInspection(
  value: string,
  expected: {
    id: string;
    name: string;
    labels: Readonly<Record<string, string>>;
  },
): void {
  const container = parseInspection(value, "Docker container ownership inspection");
  const id = text(container.Id, "Docker container ownership ID");
  const name = text(container.Name, "Docker container ownership name").replace(/^\//u, "");
  const config = record(container.Config, "Docker container ownership config");
  const labels = stringRecord(config.Labels, "Docker container ownership labels");
  if (!DOCKER_ID.test(id) || id !== expected.id || name !== expected.name) {
    throw new Error("Docker container ownership does not match the created resource.");
  }
  assertPolicyTwinLabels(labels, expected.labels);
}

export function parseDockerNetworkInspection(
  value: string,
  expected: {
    id: string;
    name: string;
    internal: boolean;
    labels: Readonly<Record<string, string>>;
    containerIds: readonly string[];
  },
): DockerNetworkObservation {
  const network = parseInspection(value, "Docker network inspection");
  const id = text(network.Id, "Docker network ID");
  const name = text(network.Name, "Docker network name");
  const driver = text(network.Driver, "Docker network driver");
  const scope = text(network.Scope, "Docker network scope");
  const internal = boolean(network.Internal, "Docker network internal flag");
  const attachable = boolean(network.Attachable, "Docker network attachable flag");
  const ingress = boolean(network.Ingress, "Docker network ingress flag");
  const labels = stringRecord(network.Labels, "Docker network labels");
  const options = nullableRecord(network.Options, "Docker network options");
  if (
    !DOCKER_ID.test(id) ||
    id !== expected.id ||
    name !== expected.name ||
    driver !== "bridge" ||
    scope !== "local" ||
    internal !== expected.internal ||
    attachable ||
    ingress
  ) {
    throw new Error("Docker network isolation does not match the admitted plan.");
  }
  if (Object.keys(options).length !== 0) {
    throw new Error("Docker network driver options are not admitted.");
  }
  assertPolicyTwinLabels(labels, expected.labels);
  const containers = nullableRecord(network.Containers, "Docker network containers");
  const containerIds = Object.keys(containers).sort();
  if (containerIds.some((containerId) => !DOCKER_ID.test(containerId))) {
    throw new Error("Docker network membership contains an invalid container ID.");
  }
  const expectedIds = [...expected.containerIds].sort();
  if (
    containerIds.length !== expectedIds.length ||
    containerIds.some((containerId, index) => containerId !== expectedIds[index])
  ) {
    throw new Error("Docker network membership does not match the admitted run.");
  }
  return { id, name, internal, labels, containerIds };
}

function assertEmptyRecord(value: unknown, label: string): void {
  if (Object.keys(nullableRecord(value, label)).length !== 0) {
    throw new Error(`${label} must be empty.`);
  }
}

function compareBindMounts(
  value: unknown,
  expected: readonly DockerBindMountExpectation[],
  expectedTmpfs: readonly DockerTmpfsExpectation[],
): void {
  const mounts = array(value, "Docker container mounts").map((item) =>
    record(item, "Docker container mount"),
  );
  const binds = mounts
    .filter((mount) => mount.Type === "bind")
    .map((mount) => ({
      source: text(mount.Source, "Docker bind source"),
      destination: text(mount.Destination, "Docker bind destination"),
      readOnly: !boolean(mount.RW, "Docker bind writable flag"),
      propagation: text(mount.Propagation, "Docker bind propagation"),
    }))
    .sort((left, right) => left.destination.localeCompare(right.destination));
  const required = [...expected].sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
  if (
    binds.length !== required.length ||
    binds.some(
      (mount, index) =>
        mount.source !== required[index]?.source ||
        mount.destination !== required[index]?.destination ||
        mount.readOnly !== required[index]?.readOnly ||
        mount.propagation !== "rprivate",
    )
  ) {
    throw new Error("Docker bind mounts do not match the admitted plan.");
  }
  const unexpected = mounts.filter((mount) => mount.Type !== "bind" && mount.Type !== "tmpfs");
  if (unexpected.length > 0) throw new Error("Docker container has an unexpected mount.");
  const expectedTmpfsDestinations = new Set(
    expectedTmpfs.map((mount) => mount.destination),
  );
  const unexpectedTmpfs = mounts.filter(
    (mount) =>
      mount.Type === "tmpfs" &&
      !expectedTmpfsDestinations.has(text(mount.Destination, "Docker tmpfs destination")),
  );
  if (unexpectedTmpfs.length > 0) throw new Error("Docker container has an unexpected tmpfs mount.");
}

function compareTmpfs(
  value: unknown,
  expected: readonly DockerTmpfsExpectation[],
): void {
  const tmpfs = stringRecord(value, "Docker tmpfs configuration");
  const expectedEntries = [...expected].sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
  const actualEntries = Object.entries(tmpfs).sort(([left], [right]) => left.localeCompare(right));
  if (actualEntries.length !== expectedEntries.length) {
    throw new Error("Docker tmpfs mounts do not match the admitted plan.");
  }
  for (let index = 0; index < actualEntries.length; index += 1) {
    const [destination, rawOptions] = actualEntries[index] ?? [];
    const expectedMount = expectedEntries[index];
    if (destination === undefined || rawOptions === undefined || expectedMount === undefined) {
      throw new Error("Docker tmpfs mounts do not match the admitted plan.");
    }
    const options = rawOptions.split(",").filter(Boolean).sort();
    const expectedOptions = [
      "nodev",
      "noexec",
      "nosuid",
      "rw",
      `size=${expectedMount.sizeBytes}`,
    ].sort();
    if (
      destination !== expectedMount.destination ||
      options.length !== expectedOptions.length ||
      options.some((option, optionIndex) => option !== expectedOptions[optionIndex])
    ) {
      throw new Error("Docker tmpfs mounts do not match the admitted plan.");
    }
  }
}

function exactStringArray(value: unknown, expected: readonly string[], label: string): void {
  const actual = value === null
    ? []
    : array(value, label).map((item) => text(item, label));
  if (
    actual.length !== expected.length ||
    actual.some((item, index) => item !== expected[index])
  ) {
    throw new Error(`${label} does not match the admitted plan.`);
  }
}

export function parseDockerContainerInspection(
  value: string,
  expected: {
    id: string;
    name: string;
    image: string;
    user: string;
    entrypoint: readonly string[];
    workingDirectory: string;
    labels: Readonly<Record<string, string>>;
    pidsLimit: number;
    memoryBytes: number;
    memorySwapBytes: number;
    nanoCpus: number;
    fileSizeLimitBytes: number;
    logDriver: "local";
    logOptions: Readonly<Record<string, string>>;
    creationNetwork: "none" | { name: string; id: string };
    requiredEnvironment: Readonly<Record<string, string>>;
    imageEnvironment: Readonly<Record<string, string>>;
    commandArgs: readonly string[];
    bindMounts: readonly DockerBindMountExpectation[];
    tmpfsMounts: readonly DockerTmpfsExpectation[];
    networks: readonly { name: string; id: string; requiredAliases: readonly string[] }[];
  },
): DockerContainerObservation {
  const container = parseInspection(value, "Docker container inspection");
  const id = text(container.Id, "Docker container ID");
  const name = text(container.Name, "Docker container name").replace(/^\//u, "");
  const image = text(container.Image, "Docker container image");
  const config = record(container.Config, "Docker container config");
  const host = record(container.HostConfig, "Docker host config");
  const state = record(container.State, "Docker container state");
  const networkSettings = record(container.NetworkSettings, "Docker network settings");
  const labels = stringRecord(config.Labels, "Docker container labels");
  const creationNetworkMode = text(host.NetworkMode, "Docker creation network mode");
  const creationNetworkMatches =
    expected.creationNetwork === "none"
      ? creationNetworkMode === "none"
      : creationNetworkMode === expected.creationNetwork.name ||
        creationNetworkMode === expected.creationNetwork.id;
  if (
    !DOCKER_ID.test(id) ||
    id !== expected.id ||
    name !== expected.name ||
    !IMAGE_ID.test(image) ||
    image !== expected.image ||
    text(config.User, "Docker container user") !== expected.user ||
    text(config.WorkingDir, "Docker working directory") !== expected.workingDirectory ||
    boolean(host.ReadonlyRootfs, "Docker read-only root flag") !== true ||
    boolean(host.Privileged, "Docker privileged flag") !== false ||
    text(host.UsernsMode, "Docker user namespace mode") !== "" ||
    text(host.CgroupnsMode, "Docker cgroup namespace mode") !== "private" ||
    text(host.PidMode, "Docker PID namespace mode") !== "" ||
    text(host.IpcMode, "Docker IPC namespace mode") !== "private" ||
    text(host.UTSMode, "Docker UTS namespace mode") !== "" ||
    !creationNetworkMatches ||
    integer(host.PidsLimit, "Docker PID limit") !== expected.pidsLimit ||
    integer(host.Memory, "Docker memory limit") !== expected.memoryBytes ||
    integer(host.MemorySwap, "Docker memory+swap limit") !== expected.memorySwapBytes ||
    integer(host.NanoCpus, "Docker CPU limit") !== expected.nanoCpus ||
    boolean(host.PublishAllPorts, "Docker publish-all flag") !== false
  ) {
    throw new Error("Docker container isolation does not match the admitted plan.");
  }
  assertPolicyTwinLabels(labels, expected.labels);
  exactStringArray(config.Entrypoint, expected.entrypoint, "Docker container entrypoint");
  const commandArgs = config.Cmd === null
    ? []
    : array(config.Cmd, "Docker container command").map((item) =>
        text(item, "Docker container command argument"),
      );
  if (
    commandArgs.length !== expected.commandArgs.length ||
    commandArgs.some((argument, index) => argument !== expected.commandArgs[index])
  ) {
    throw new Error("Docker container command does not match the admitted plan.");
  }
  const capDrop = array(host.CapDrop, "Docker capability drop");
  const capAdd = host.CapAdd === null ? [] : array(host.CapAdd, "Docker capability add");
  const securityOptions = array(host.SecurityOpt, "Docker security options");
  if (
    capDrop.length !== 1 ||
    capDrop[0] !== "ALL" ||
    capAdd.length !== 0 ||
    securityOptions.length !== 1 ||
    securityOptions[0] !== "no-new-privileges:true"
  ) {
    throw new Error("Docker container privilege controls are invalid.");
  }
  const ulimits = array(host.Ulimits, "Docker ulimits");
  if (ulimits.length !== 1) {
    throw new Error("Docker file-size limit does not match the admitted plan.");
  }
  const fileSizeLimit = record(ulimits[0], "Docker file-size limit");
  if (
    text(fileSizeLimit.Name, "Docker file-size limit name") !== "fsize" ||
    integer(fileSizeLimit.Soft, "Docker soft file-size limit") !== expected.fileSizeLimitBytes ||
    integer(fileSizeLimit.Hard, "Docker hard file-size limit") !== expected.fileSizeLimitBytes
  ) {
    throw new Error("Docker file-size limit does not match the admitted plan.");
  }
  const logConfig = record(host.LogConfig, "Docker log configuration");
  const logOptions = stringRecord(logConfig.Config, "Docker log options");
  const expectedLogOptions = Object.entries(expected.logOptions).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const observedLogOptions = Object.entries(logOptions).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (
    text(logConfig.Type, "Docker log driver") !== expected.logDriver ||
    observedLogOptions.length !== expectedLogOptions.length ||
    observedLogOptions.some(
      ([key, value], index) =>
        key !== expectedLogOptions[index]?.[0] || value !== expectedLogOptions[index]?.[1],
    )
  ) {
    throw new Error("Docker log limits do not match the admitted plan.");
  }
  assertEmptyRecord(host.PortBindings, "Docker port bindings");
  assertEmptyRecord(networkSettings.Ports, "Docker network ports");
  exactStringArray(host.Devices, [], "Docker devices");
  exactStringArray(host.DeviceRequests, [], "Docker device requests");
  exactStringArray(host.Binds, [], "Docker legacy binds");
  exactStringArray(host.VolumesFrom, [], "Docker inherited volumes");
  exactStringArray(host.Links, [], "Docker links");
  exactStringArray(host.ExtraHosts, [], "Docker extra hosts");
  exactStringArray(host.Dns, [], "Docker DNS servers");
  exactStringArray(host.DnsOptions, [], "Docker DNS options");
  exactStringArray(host.DnsSearch, [], "Docker DNS search domains");
  compareBindMounts(container.Mounts, expected.bindMounts, expected.tmpfsMounts);
  compareTmpfs(host.Tmpfs, expected.tmpfsMounts);

  const environment = array(config.Env, "Docker container environment").map((item) =>
    text(item, "Docker environment entry"),
  );
  const environmentMap = new Map(
    environment.map((item) => {
      const separator = item.indexOf("=");
      return separator < 1 ? [item, ""] : [item.slice(0, separator), item.slice(separator + 1)];
    }),
  );
  const expectedEnvironment = {
    ...expected.imageEnvironment,
    ...expected.requiredEnvironment,
  };
  const actualEnvironmentEntries = [...environmentMap.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEnvironmentEntries = Object.entries(expectedEnvironment).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (
    environment.length !== environmentMap.size ||
    actualEnvironmentEntries.length !== expectedEnvironmentEntries.length ||
    actualEnvironmentEntries.some(
      ([key, environmentValue], index) =>
        key !== expectedEnvironmentEntries[index]?.[0] ||
        environmentValue !== expectedEnvironmentEntries[index]?.[1],
    )
  ) {
    throw new Error("Docker container environment does not match the admitted plan.");
  }

  const networks = nullableRecord(networkSettings.Networks, "Docker attached networks");
  const networkIds: Record<string, string> = {};
  const expectedNames = expected.networks.map((network) => network.name).sort();
  const actualNames = Object.keys(networks).sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((networkName, index) => networkName !== expectedNames[index])
  ) {
    throw new Error("Docker container network membership is invalid.");
  }
  for (const expectedNetwork of expected.networks) {
    const attachment = record(
      networks[expectedNetwork.name],
      "Docker container network attachment",
    );
    const networkId = text(attachment.NetworkID, "Docker attached network ID");
    if (networkId !== expectedNetwork.id) {
      throw new Error("Docker container is attached to an unexpected network ID.");
    }
    const aliases = attachment.Aliases === null
      ? []
      : array(attachment.Aliases, "Docker network aliases").map((item) =>
          text(item, "Docker network alias"),
        );
    if (expectedNetwork.requiredAliases.some((alias) => !aliases.includes(alias))) {
      throw new Error("Docker container lacks a required network alias.");
    }
    networkIds[expectedNetwork.name] = networkId;
  }
  const pid = integer(state.Pid, "Docker container PID");
  const running = boolean(state.Running, "Docker container running flag");
  return { id, name, image, pid, running, networkIds, labels };
}
