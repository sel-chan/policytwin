import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isDecision } from "../domain/decision.js";
import { parseRefundPolicyInput, type PolicyDecisionResult } from "../domain/refund.js";
import type { OpaCaseResult, OpaRunReport, OpaRunnerInput } from "./types.js";

const QUERY = "data.policytwin.refund.decision" as const;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(path: string): string {
  const digest = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return digest.digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of ["SYSTEMROOT", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value) {
      environment[key] = value;
    }
  }
  return environment;
}

function execute(
  executablePath: string,
  args: readonly string[],
  timeoutMs: number,
  input = "",
  cwd = process.cwd(),
): { stdout: string; stderr: string } {
  const result = spawnSync(executablePath, [...args], {
    cwd,
    encoding: "utf8",
    env: safeEnvironment(),
    input,
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`OPA process failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`OPA exited ${result.status ?? "without status"}: ${result.stderr.trim()}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function parseVersion(stdout: string): string {
  const match = /^Version:\s+(\S+)/mu.exec(stdout);
  if (!match?.[1]) {
    throw new Error("OPA version output is malformed.");
  }
  return match[1];
}

function parseDecision(stdout: string): PolicyDecisionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("OPA evaluation output is not valid JSON.");
  }
  const root = record(parsed);
  const result = Array.isArray(root?.result) ? root.result[0] : undefined;
  const resultRecord = record(result);
  const expression = Array.isArray(resultRecord?.expressions)
    ? resultRecord.expressions[0]
    : undefined;
  const value = record(record(expression)?.value);
  if (
    !value ||
    !isDecision(value.decision) ||
    !(typeof value.matchedRuleId === "string" || value.matchedRuleId === null) ||
    typeof value.explanation !== "string" ||
    !Number.isSafeInteger(value.policyVersion) ||
    (value.policyVersion as number) < 1
  ) {
    throw new Error("OPA evaluation did not return one strict PolicyDecisionResult.");
  }
  return {
    decision: value.decision,
    matchedRuleId: value.matchedRuleId,
    explanation: value.explanation,
    policyVersion: value.policyVersion as number,
  };
}

export function runOpaCases(input: OpaRunnerInput): OpaRunReport {
  if (!isAbsolute(input.executablePath)) {
    throw new Error("OPA executable path must be absolute.");
  }
  const executablePath = resolve(input.executablePath);
  if (!existsSync(executablePath)) {
    throw new Error("OPA executable does not exist.");
  }
  if (input.query !== QUERY) {
    throw new Error("OPA query is outside the PolicyTwin refund decision contract.");
  }
  if (input.regoSource.length === 0 || input.regoSource.length > 1_000_000) {
    throw new Error("Compiled Rego source size is invalid.");
  }
  if (input.cases.length === 0 || input.cases.length > 1_000) {
    throw new Error("OPA case count is outside the allowed range.");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.expectedExecutableSha256)) {
    throw new Error("Expected OPA executable SHA-256 is invalid.");
  }

  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("OPA timeout must be an integer between 100 and 30000 milliseconds.");
  }

  const executableSha256 = hashFile(executablePath);
  if (executableSha256 !== input.expectedExecutableSha256) {
    throw new Error(
      `OPA executable checksum mismatch: expected ${input.expectedExecutableSha256}, received ${executableSha256}.`,
    );
  }

  const version = parseVersion(execute(executablePath, ["version"], timeoutMs).stdout);
  if (version !== input.expectedVersion) {
    throw new Error(`OPA version mismatch: expected ${input.expectedVersion}, received ${version}.`);
  }

  const workspace = mkdtempSync(join(tmpdir(), "policytwin-opa-"));
  const policyName = "policy.rego";
  const policyPath = join(workspace, policyName);
  try {
    writeFileSync(policyPath, input.regoSource, { encoding: "utf8", flag: "wx" });
    try {
      execute(executablePath, ["check", "--strict", policyName], timeoutMs, "", workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.replaceAll(workspace, "<opa-workspace>"));
    }

    const seen = new Set<string>();
    const results: OpaCaseResult[] = input.cases.map((policyCase) => {
      if (!/^[A-Za-z0-9._-]{1,128}$/u.test(policyCase.id) || seen.has(policyCase.id)) {
        throw new Error(`OPA case ID is invalid or duplicated: ${policyCase.id}`);
      }
      seen.add(policyCase.id);
      const normalizedInput = parseRefundPolicyInput(policyCase.input);
      const canonicalInput = JSON.stringify(normalizedInput);
      const output = execute(
        executablePath,
        ["eval", "--format", "json", "--stdin-input", "--data", policyName, QUERY],
        timeoutMs,
        canonicalInput,
        workspace,
      );
      return {
        caseId: policyCase.id,
        inputHash: hash(canonicalInput),
        result: parseDecision(output.stdout),
      };
    });

    return {
      schemaVersion: "1",
      executionMode: "OPA_CLI",
      opaVersion: version,
      executableSha256,
      policyHash: hash(input.regoSource),
      query: QUERY,
      compileCommand: "opa check --strict <policy.rego>",
      evalCommand: "opa eval --format json --stdin-input --data <policy.rego> <query>",
      results,
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
