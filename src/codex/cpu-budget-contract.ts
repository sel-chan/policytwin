export const SUPERVISOR_CPU_BUDGET_ROLES = ["egress", "worker", "verifier"] as const;

export type SupervisorCpuBudgetRole = (typeof SUPERVISOR_CPU_BUDGET_ROLES)[number];

export interface SupervisorCpuContainerIdentity {
  role: SupervisorCpuBudgetRole;
  containerId: string;
  pid: number;
  startedAt: string;
  cgroupIdentitySha256: string;
}

export type SupervisorCpuContainerStartObservation = Omit<
  SupervisorCpuContainerIdentity,
  "cgroupIdentitySha256"
>;

export interface StaticSupervisorCpuRoleProof {
  role: SupervisorCpuBudgetRole;
  identity: SupervisorCpuContainerIdentity;
  baselineUsageUsec: string;
  finalUsageUsec: string;
  deltaUsageUsec: string;
  sampleCount: number;
}

export interface StaticSupervisorCpuBudgetProof {
  schemaVersion: "1";
  status: "STATIC_FAKE_CONTROLLER_VERIFIED";
  requestSha256: string;
  bindingSha256: string;
  budgetUsec: string;
  aggregateUsageUsec: string;
  accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE";
  samplingMode: "SERIAL_SUPERVISOR_FAKE";
  cumulativeCpuTimeEnforced: false;
  hardLimitEnforced: false;
  overshootBounded: false;
  containmentTriggered: false;
  roles: readonly [
    StaticSupervisorCpuRoleProof,
    StaticSupervisorCpuRoleProof,
    StaticSupervisorCpuRoleProof,
  ];
}

export interface SupervisorCpuBudgetSession {
  roleStarted(
    observation: SupervisorCpuContainerStartObservation,
    signal: AbortSignal,
  ): Promise<SupervisorCpuContainerIdentity>;
  roleStopped(identity: SupervisorCpuContainerIdentity, signal: AbortSignal): Promise<void>;
  finalize(signal: AbortSignal): Promise<unknown>;
  beginCleanup(
    reason: "SUCCESS" | "FAILURE" | "ABORT",
    signal: AbortSignal,
  ): Promise<void>;
  /** Return true only after all prior controller work is aborted, drained, and unable to mutate state. */
  completeCleanup(signal: AbortSignal): Promise<boolean>;
}

export interface SupervisorCpuBudgetController {
  begin(
    input: {
      requestSha256: string;
      bindingSha256: string;
      budgetUsec: bigint;
    },
    signal: AbortSignal,
  ): Promise<SupervisorCpuBudgetSession>;
}

export interface StaticSupervisorCpuRoleScript {
  role: SupervisorCpuBudgetRole;
  cgroupIdentitySha256: string;
  baselineUsageUsec: bigint;
  sampledUsageUsec: readonly bigint[];
  finalUsageUsec: bigint;
}

export interface StaticSupervisorCpuBudgetControllerOptions {
  roles: readonly [
    StaticSupervisorCpuRoleScript,
    StaticSupervisorCpuRoleScript,
    StaticSupervisorCpuRoleScript,
  ];
  cleanupStartFails?: boolean;
  cleanupCompletes?: boolean;
  onEvent?(event: string): void;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface RoleState {
  identity: SupervisorCpuContainerIdentity;
  baselineUsageUsec: bigint;
  lastUsageUsec: bigint;
  finalUsageUsec: bigint | null;
  sampleCount: number;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const DOCKER_ID = /^[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/u;
const MAX_UINT64 = (1n << 64n) - 1n;

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Supervisor CPU accounting was aborted.");
  }
}

function admittedUsageUsec(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= MAX_UINT64;
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as JsonRecord;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function decimal(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT64) throw new Error(`${label} is invalid.`);
  return parsed;
}

function strictTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(
    value,
  );
  if (matched === null) throw new Error(`${label} is invalid.`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parseRole(value: unknown, expectedRole: SupervisorCpuBudgetRole): StaticSupervisorCpuRoleProof {
  const result = record(value, `CPU budget ${expectedRole} proof`);
  exactKeys(
    result,
    [
      "role",
      "identity",
      "baselineUsageUsec",
      "finalUsageUsec",
      "deltaUsageUsec",
      "sampleCount",
    ],
    `CPU budget ${expectedRole} proof`,
  );
  if (result.role !== expectedRole) throw new Error("CPU budget role order is invalid.");
  const identityValue = record(result.identity, `CPU budget ${expectedRole} identity`);
  exactKeys(
    identityValue,
    ["role", "containerId", "pid", "startedAt", "cgroupIdentitySha256"],
    `CPU budget ${expectedRole} identity`,
  );
  if (
    identityValue.role !== expectedRole ||
    typeof identityValue.containerId !== "string" ||
    !DOCKER_ID.test(identityValue.containerId) ||
    typeof identityValue.cgroupIdentitySha256 !== "string" ||
    !SHA256.test(identityValue.cgroupIdentitySha256)
  ) {
    throw new Error(`CPU budget ${expectedRole} identity is invalid.`);
  }
  const baseline = decimal(result.baselineUsageUsec, `CPU budget ${expectedRole} baseline`);
  const final = decimal(result.finalUsageUsec, `CPU budget ${expectedRole} final usage`);
  const delta = decimal(result.deltaUsageUsec, `CPU budget ${expectedRole} delta`);
  if (final < baseline || final - baseline !== delta) {
    throw new Error(`CPU budget ${expectedRole} usage is inconsistent.`);
  }
  return {
    role: expectedRole,
    identity: {
      role: expectedRole,
      containerId: identityValue.containerId,
      pid: integer(identityValue.pid, `CPU budget ${expectedRole} PID`, 1, 2_147_483_647),
      startedAt: strictTimestamp(
        identityValue.startedAt,
        `CPU budget ${expectedRole} start timestamp`,
      ),
      cgroupIdentitySha256: identityValue.cgroupIdentitySha256,
    },
    baselineUsageUsec: baseline.toString(),
    finalUsageUsec: final.toString(),
    deltaUsageUsec: delta.toString(),
    sampleCount: integer(result.sampleCount, `CPU budget ${expectedRole} sample count`, 2, 10_000),
  };
}

export function parseStaticSupervisorCpuBudgetProof(
  value: unknown,
  expected: { requestSha256: string; bindingSha256?: string; budgetUsec: bigint },
): StaticSupervisorCpuBudgetProof {
  if (
    !SHA256.test(expected.requestSha256) ||
    (expected.bindingSha256 !== undefined && !SHA256.test(expected.bindingSha256)) ||
    typeof expected.budgetUsec !== "bigint" ||
    expected.budgetUsec < 1n ||
    expected.budgetUsec > MAX_UINT64
  ) {
    throw new Error("Expected CPU budget binding is invalid.");
  }
  const result = record(value, "supervisor CPU budget proof");
  exactKeys(
    result,
    [
      "schemaVersion",
      "status",
      "requestSha256",
      "bindingSha256",
      "budgetUsec",
      "aggregateUsageUsec",
      "accountingScope",
      "samplingMode",
      "cumulativeCpuTimeEnforced",
      "hardLimitEnforced",
      "overshootBounded",
      "containmentTriggered",
      "roles",
    ],
    "supervisor CPU budget proof",
  );
  const roleValues = result.roles;
  if (
    result.schemaVersion !== "1" ||
    result.status !== "STATIC_FAKE_CONTROLLER_VERIFIED" ||
    result.requestSha256 !== expected.requestSha256 ||
    typeof result.bindingSha256 !== "string" ||
    !SHA256.test(result.bindingSha256) ||
    result.accountingScope !== "POST_BASELINE_THREE_ROLE_AGGREGATE" ||
    result.samplingMode !== "SERIAL_SUPERVISOR_FAKE" ||
    result.cumulativeCpuTimeEnforced !== false ||
    result.hardLimitEnforced !== false ||
    result.overshootBounded !== false ||
    result.containmentTriggered !== false ||
    (expected.bindingSha256 !== undefined &&
      result.bindingSha256 !== expected.bindingSha256) ||
    !Array.isArray(roleValues) ||
    roleValues.length !== SUPERVISOR_CPU_BUDGET_ROLES.length
  ) {
    throw new Error("Supervisor CPU budget proof is not an admitted static result.");
  }
  const budget = decimal(result.budgetUsec, "supervisor CPU budget");
  const aggregate = decimal(result.aggregateUsageUsec, "supervisor aggregate CPU usage");
  if (budget !== expected.budgetUsec || aggregate > budget) {
    throw new Error("Supervisor aggregate CPU budget is invalid or exceeded.");
  }
  const roles = SUPERVISOR_CPU_BUDGET_ROLES.map((role, index) =>
    parseRole(roleValues[index], role),
  ) as unknown as StaticSupervisorCpuBudgetProof["roles"];
  const calculated = roles.reduce((total, role) => total + BigInt(role.deltaUsageUsec), 0n);
  if (calculated !== aggregate) throw new Error("Supervisor aggregate CPU usage is inconsistent.");
  if (
    new Set(roles.map((role) => role.identity.containerId)).size !== roles.length ||
    new Set(roles.map((role) => role.identity.cgroupIdentitySha256)).size !== roles.length
  ) {
    throw new Error("Supervisor CPU role identities are not unique.");
  }
  return {
    schemaVersion: "1",
    status: "STATIC_FAKE_CONTROLLER_VERIFIED",
    requestSha256: expected.requestSha256,
    bindingSha256: result.bindingSha256,
    budgetUsec: budget.toString(),
    aggregateUsageUsec: aggregate.toString(),
    accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE",
    samplingMode: "SERIAL_SUPERVISOR_FAKE",
    cumulativeCpuTimeEnforced: false,
    hardLimitEnforced: false,
    overshootBounded: false,
    containmentTriggered: false,
    roles,
  };
}

function sameIdentity(
  left: SupervisorCpuContainerIdentity,
  right: SupervisorCpuContainerIdentity,
): boolean {
  return (
    left.role === right.role &&
    left.containerId === right.containerId &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.cgroupIdentitySha256 === right.cgroupIdentitySha256
  );
}

export class StaticSupervisorCpuBudgetLedger {
  readonly #requestSha256: string;
  readonly #bindingSha256: string;
  readonly #budgetUsec: bigint;
  readonly #roles = new Map<SupervisorCpuBudgetRole, RoleState>();
  #failed = false;
  #finalized = false;

  constructor(input: { requestSha256: string; bindingSha256: string; budgetUsec: bigint }) {
    if (
      !SHA256.test(input.requestSha256) ||
      !SHA256.test(input.bindingSha256) ||
      typeof input.budgetUsec !== "bigint" ||
      input.budgetUsec < 1n ||
      input.budgetUsec > MAX_UINT64
    ) {
      throw new Error("Static CPU budget ledger binding is invalid.");
    }
    this.#requestSha256 = input.requestSha256;
    this.#bindingSha256 = input.bindingSha256;
    this.#budgetUsec = input.budgetUsec;
  }

  #assertMutable(): void {
    if (this.#failed) throw new Error("Static CPU budget ledger is poisoned.");
    if (this.#finalized) throw new Error("Static CPU budget ledger is finalized.");
  }

  #fail(message: string): never {
    this.#failed = true;
    throw new Error(message);
  }

  #aggregateCurrent(): bigint {
    let total = 0n;
    for (const state of this.#roles.values()) {
      total += state.lastUsageUsec - state.baselineUsageUsec;
    }
    return total;
  }

  #assertWithinBudget(): void {
    if (this.#aggregateCurrent() > this.#budgetUsec) {
      this.#fail("Supervisor cumulative CPU budget was exceeded.");
    }
  }

  beginRole(identity: SupervisorCpuContainerIdentity, usageUsec: bigint): void {
    this.#assertMutable();
    const expectedRole = SUPERVISOR_CPU_BUDGET_ROLES[this.#roles.size];
    if (expectedRole !== identity.role || !admittedUsageUsec(usageUsec)) {
      this.#fail("Supervisor CPU role baseline is invalid or out of order.");
    }
    if (identity.role === "worker" && this.#roles.get("egress")?.finalUsageUsec !== null) {
      this.#fail("Worker CPU accounting started without an active egress role.");
    }
    parseRole(
      {
        role: identity.role,
        identity,
        baselineUsageUsec: usageUsec.toString(),
        finalUsageUsec: usageUsec.toString(),
        deltaUsageUsec: "0",
        sampleCount: 2,
      },
      identity.role,
    );
    for (const state of this.#roles.values()) {
      if (
        state.identity.containerId === identity.containerId ||
        state.identity.cgroupIdentitySha256 === identity.cgroupIdentitySha256
      ) {
        this.#fail("Supervisor CPU role identity was reused.");
      }
    }
    if (identity.role === "verifier") {
      const worker = this.#roles.get("worker");
      const egress = this.#roles.get("egress");
      if (worker?.finalUsageUsec === null || egress?.finalUsageUsec === null) {
        this.#fail("Verifier CPU accounting started before worker and egress were sealed.");
      }
    }
    this.#roles.set(identity.role, {
      identity: { ...identity },
      baselineUsageUsec: usageUsec,
      lastUsageUsec: usageUsec,
      finalUsageUsec: null,
      sampleCount: 1,
    });
  }

  sampleRole(identity: SupervisorCpuContainerIdentity, usageUsec: bigint): void {
    this.#assertMutable();
    const state = this.#roles.get(identity.role);
    if (
      state === undefined ||
      state.finalUsageUsec !== null ||
      !sameIdentity(state.identity, identity) ||
      !admittedUsageUsec(usageUsec) ||
      usageUsec < state.lastUsageUsec ||
      state.sampleCount >= 10_000
    ) {
      this.#fail("Supervisor CPU usage sample is invalid, non-monotonic, or identity-drifted.");
    }
    state.lastUsageUsec = usageUsec;
    state.sampleCount += 1;
    this.#assertWithinBudget();
  }

  finishRole(identity: SupervisorCpuContainerIdentity, usageUsec: bigint): void {
    this.sampleRole(identity, usageUsec);
    const state = this.#roles.get(identity.role);
    if (state === undefined) this.#fail("Supervisor CPU role is missing at finalization.");
    if (identity.role === "egress" && this.#roles.get("worker")?.finalUsageUsec === null) {
      this.#fail("Egress CPU accounting ended before worker accounting was sealed.");
    }
    state.finalUsageUsec = usageUsec;
  }

  finalize(): StaticSupervisorCpuBudgetProof {
    this.#assertMutable();
    const roles = SUPERVISOR_CPU_BUDGET_ROLES.map((role) => {
      const state = this.#roles.get(role);
      if (state === undefined || state.finalUsageUsec === null || state.sampleCount < 2) {
        this.#fail("Supervisor CPU budget proof is incomplete.");
      }
      return {
        role,
        identity: { ...state.identity },
        baselineUsageUsec: state.baselineUsageUsec.toString(),
        finalUsageUsec: state.finalUsageUsec.toString(),
        deltaUsageUsec: (state.finalUsageUsec - state.baselineUsageUsec).toString(),
        sampleCount: state.sampleCount,
      } satisfies StaticSupervisorCpuRoleProof;
    }) as unknown as StaticSupervisorCpuBudgetProof["roles"];
    const proof: StaticSupervisorCpuBudgetProof = {
      schemaVersion: "1",
      status: "STATIC_FAKE_CONTROLLER_VERIFIED",
      requestSha256: this.#requestSha256,
      bindingSha256: this.#bindingSha256,
      budgetUsec: this.#budgetUsec.toString(),
      aggregateUsageUsec: this.#aggregateCurrent().toString(),
      accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE",
      samplingMode: "SERIAL_SUPERVISOR_FAKE",
      cumulativeCpuTimeEnforced: false,
      hardLimitEnforced: false,
      overshootBounded: false,
      containmentTriggered: false,
      roles,
    };
    const parsed = parseStaticSupervisorCpuBudgetProof(proof, {
      requestSha256: this.#requestSha256,
      bindingSha256: this.#bindingSha256,
      budgetUsec: this.#budgetUsec,
    });
    this.#finalized = true;
    return parsed;
  }
}

export function createStaticSupervisorCpuBudgetController(
  options: StaticSupervisorCpuBudgetControllerOptions,
): SupervisorCpuBudgetController {
  if (
    options.roles.length !== SUPERVISOR_CPU_BUDGET_ROLES.length ||
    options.roles.some(
      (script, index) =>
        script.role !== SUPERVISOR_CPU_BUDGET_ROLES[index] ||
        !SHA256.test(script.cgroupIdentitySha256) ||
        !admittedUsageUsec(script.baselineUsageUsec) ||
        !admittedUsageUsec(script.finalUsageUsec) ||
        !Array.isArray(script.sampledUsageUsec) ||
        script.sampledUsageUsec.some((sample) => !admittedUsageUsec(sample)),
    )
  ) {
    throw new Error("The static supervisor CPU script is invalid.");
  }
  const scripts = options.roles.map((script) => ({
    ...script,
    sampledUsageUsec: [...script.sampledUsageUsec],
  })) as unknown as StaticSupervisorCpuBudgetControllerOptions["roles"];
  const cleanupStartFails = options.cleanupStartFails === true;
  const cleanupCompletes = options.cleanupCompletes !== false;
  const onEvent = options.onEvent;
  const controller: SupervisorCpuBudgetController = {
    async begin(input, signal) {
      throwIfAborted(signal);
      onEvent?.("cpu:begin");
      const ledger = new StaticSupervisorCpuBudgetLedger(input);
      const identities = new Map<SupervisorCpuBudgetRole, SupervisorCpuContainerIdentity>();
      let started = 0;
      let cleanupStarted = false;
      let cleanupCompleted = false;
      return {
        async roleStarted(observation, roleSignal) {
          throwIfAborted(roleSignal);
          const script = scripts[started];
          if (script === undefined || script.role !== observation.role) {
            throw new Error("The static supervisor CPU role start is out of order.");
          }
          const identity: SupervisorCpuContainerIdentity = {
            ...observation,
            cgroupIdentitySha256: script.cgroupIdentitySha256,
          };
          ledger.beginRole(identity, script.baselineUsageUsec);
          identities.set(identity.role, identity);
          started += 1;
          onEvent?.(`cpu:start:${identity.role}`);
          return { ...identity };
        },
        async roleStopped(identity, roleSignal) {
          throwIfAborted(roleSignal);
          const script = scripts.find((candidate) => candidate.role === identity.role);
          const admittedIdentity = identities.get(identity.role);
          if (
            script === undefined ||
            admittedIdentity === undefined ||
            !sameIdentity(admittedIdentity, identity)
          ) {
            throw new Error("The static supervisor CPU role stop identity is invalid.");
          }
          for (const sample of script.sampledUsageUsec) ledger.sampleRole(identity, sample);
          ledger.finishRole(identity, script.finalUsageUsec);
          onEvent?.(`cpu:stop:${identity.role}`);
        },
        async finalize(finalizeSignal) {
          throwIfAborted(finalizeSignal);
          onEvent?.("cpu:finalize");
          return ledger.finalize();
        },
        async beginCleanup(reason, cleanupSignal) {
          throwIfAborted(cleanupSignal);
          if (cleanupStarted || cleanupCompleted) {
            throw new Error("Static supervisor CPU cleanup was started more than once.");
          }
          cleanupStarted = true;
          onEvent?.(`cpu:cleanup-begin:${reason}`);
          if (cleanupStartFails) {
            throw new Error("Static supervisor CPU cleanup start failed.");
          }
        },
        async completeCleanup(cleanupSignal) {
          throwIfAborted(cleanupSignal);
          if (!cleanupStarted || cleanupCompleted) {
            throw new Error("Static supervisor CPU cleanup completion is out of order.");
          }
          cleanupCompleted = true;
          onEvent?.("cpu:cleanup-complete");
          return cleanupCompletes;
        },
      } satisfies SupervisorCpuBudgetSession;
    },
  };
  return Object.freeze(controller);
}

export function createUnavailableSupervisorCpuBudgetController(): SupervisorCpuBudgetController {
  const controller: SupervisorCpuBudgetController = {
    async begin(_input, signal): Promise<never> {
      throwIfAborted(signal);
      throw new Error("A real supervisor cgroup CPU budget controller is unavailable.");
    },
  };
  return Object.freeze(controller);
}
