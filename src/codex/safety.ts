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
  /(["']?[A-Za-z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|PRIVATE[_-]?KEY|SECRET(?:[_-]?ACCESS)?[_-]?KEY|TOKEN|DATABASE[_-]?(?:URL|URI)|POSTGRES(?:QL)?[_-]?(?:URL|URI)|REDIS[_-]?(?:URL|URI)|CONNECTION[_-]?(?:STRING|URI)|MONGO(?:DB)?[_-]?(?:URL|URI))[A-Za-z0-9_]*["']?\s*[=:]\s*)(["']?)([^"'\s,;]+)\2/giu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const CREDENTIAL_URL =
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/gu;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/giu;
const OPENAI_TOKEN = /\bsk-[A-Za-z0-9_-]{16,}/gu;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/gu;
const GOOGLE_CREDENTIAL = /\bAIza[0-9A-Za-z_-]{35}\b/gu;
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu;
const WINDOWS_USER_PATH = /[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/giu;
const POSIX_HOME_PATH = /\/(?:home|Users)\/[^/\s]+|\/root(?:\/[^\s]*)?/giu;

export function redactWorkerOutput(value: string, maxLength = 16_384): {
  text: string;
  truncated: boolean;
} {
  const redacted = value
    .replace(PRIVATE_KEY_BLOCK, "[REDACTED_PRIVATE_KEY]")
    .replace(SECRET_ASSIGNMENT, "$1$2[REDACTED]$2")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(CREDENTIAL_URL, "[REDACTED_CREDENTIAL_URL]")
    .replace(OPENAI_TOKEN, "[REDACTED_CREDENTIAL]")
    .replace(GITHUB_TOKEN, "[REDACTED_CREDENTIAL]")
    .replace(AWS_ACCESS_KEY, "[REDACTED_CREDENTIAL]")
    .replace(GOOGLE_CREDENTIAL, "[REDACTED_CREDENTIAL]")
    .replace(SLACK_TOKEN, "[REDACTED_CREDENTIAL]")
    .replace(WINDOWS_USER_PATH, "[REDACTED_HOME]")
    .replace(POSIX_HOME_PATH, "[REDACTED_HOME]");
  if (redacted.length <= maxLength) {
    return { text: redacted, truncated: false };
  }
  return { text: `${redacted.slice(0, maxLength)}\n[OUTPUT_TRUNCATED]`, truncated: true };
}

export function assertNoSensitiveWorkerText(
  value: string,
  label: string,
  maxLength = 16_384,
): string {
  const redacted = redactWorkerOutput(value, maxLength);
  if (redacted.truncated || redacted.text !== value) {
    throw new Error(`${label} contains sensitive or personal-path content.`);
  }
  return value;
}
