import { REPAIR_COMMAND_IDS, type RepairCommandId } from "./types.js";

export interface RepairCommandDefinition {
  id: RepairCommandId;
  executable: "node" | "tsc";
  args: readonly string[];
  timeoutMs: number;
  cwd: "FIXTURE_ROOT";
}

const COMMANDS: Record<RepairCommandId, RepairCommandDefinition> = {
  "fixture-typecheck": {
    id: "fixture-typecheck",
    executable: "tsc",
    args: ["-p", "tsconfig.json"],
    timeoutMs: 30_000,
    cwd: "FIXTURE_ROOT",
  },
  "fixture-test": {
    id: "fixture-test",
    executable: "node",
    args: ["tests/refund.test.mjs"],
    timeoutMs: 30_000,
    cwd: "FIXTURE_ROOT",
  },
};

export function isRepairCommandId(value: unknown): value is RepairCommandId {
  return typeof value === "string" && REPAIR_COMMAND_IDS.includes(value as RepairCommandId);
}

export function getRepairCommandDefinition(value: unknown): RepairCommandDefinition {
  if (!isRepairCommandId(value)) {
    throw new Error(`Unsupported repair command: ${String(value)}`);
  }
  const command = COMMANDS[value];
  return { ...command, args: [...command.args] };
}

export function assertSafeRelativePath(value: unknown, label = "path"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.includes(":") ||
    /[\u0000-\u001F]/u.test(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must stay within the trusted fixture.`);
  }
  return normalized;
}

const SECRET_ASSIGNMENT =
  /(["']?[A-Za-z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PASSWORD)[A-Za-z0-9_]*["']?\s*[=:]\s*)(["']?)([^"'\s,;]+)\2/giu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const WINDOWS_USER_PATH = /[A-Za-z]:\\Users\\[^\\\s]+/gu;
const POSIX_HOME_PATH = /\/(?:home|Users)\/[^/\s]+/gu;

export function redactWorkerOutput(value: string, maxLength = 16_384): {
  text: string;
  truncated: boolean;
} {
  const redacted = value
    .replace(SECRET_ASSIGNMENT, "$1$2[REDACTED]$2")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(WINDOWS_USER_PATH, "[REDACTED_HOME]")
    .replace(POSIX_HOME_PATH, "[REDACTED_HOME]");
  if (redacted.length <= maxLength) {
    return { text: redacted, truncated: false };
  }
  return { text: `${redacted.slice(0, maxLength)}\n[OUTPUT_TRUNCATED]`, truncated: true };
}
