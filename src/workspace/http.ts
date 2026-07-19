import { timingSafeEqual } from "node:crypto";
import {
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
  readUtf8BodyLimited,
} from "../openai/request-guard.js";
import { PolicyPersistenceError } from "../persistence/sqlite.js";
import { PolicyResolutionError } from "../policy-ir/resolve.js";
import { PolicyWorkspaceServiceError } from "./service.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/u;

export const DECISION_MUTATION_MAX_BYTES = 4 * 1024;
export const SOURCE_MUTATION_MAX_BYTES = 128 * 1024;

export type WorkspaceHttpErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "REQUEST_TIMEOUT"
  | "FORBIDDEN_ORIGIN"
  | "INVALID_CSRF_TOKEN"
  | "INVALID_SESSION"
  | "WORKSPACE_CAPACITY"
  | "REFERENCE_POLICY_MISMATCH"
  | "PROJECT_NOT_FOUND"
  | "DECISION_NOT_FOUND"
  | "STALE_VERSION"
  | "GOLDEN_CONTRADICTION"
  | "NOT_INTERPRETED"
  | "WORKSPACE_BUSY"
  | "INTERNAL_ERROR";

export class WorkspaceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: WorkspaceHttpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceHttpError";
  }
}

export interface WorkspaceMutationHeaders {
  expectedOrigin: string;
  contentType: string | null;
  origin: string | null;
  secFetchSite: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
}

export interface WorkspacePublicOriginInput {
  configuredOrigin: string | null;
  requestUrl: string;
  requestHost: string | null;
  production: boolean;
  allowInsecureLoopback: boolean;
}

export interface WorkspacePublicOrigin {
  origin: string;
  secureCookie: boolean;
}

export function resolveWorkspacePublicOrigin(
  input: WorkspacePublicOriginInput,
): WorkspacePublicOrigin {
  let origin: URL;
  if (input.configuredOrigin) {
    origin = new URL(input.configuredOrigin);
    if (
      origin.origin !== input.configuredOrigin ||
      origin.username.length > 0 ||
      origin.password.length > 0 ||
      origin.pathname !== "/" ||
      origin.search.length > 0 ||
      origin.hash.length > 0
    ) {
      throw new Error("Configured workspace origin must be one canonical origin.");
    }
  } else {
    if (input.production) {
      throw new Error("A configured workspace origin is required in production.");
    }
    if (!input.requestHost) {
      throw new Error("Workspace request is missing its host header.");
    }
    const requestUrl = new URL(input.requestUrl);
    if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
      throw new Error("Workspace request protocol is invalid.");
    }
    origin = new URL(`${requestUrl.protocol}//${input.requestHost}`);
  }
  if (origin.protocol === "https:") {
    return { origin: origin.origin, secureCookie: true };
  }
  const loopback =
    origin.hostname === "127.0.0.1" ||
    origin.hostname === "localhost" ||
    origin.hostname === "::1";
  if (input.production && !(input.allowInsecureLoopback && loopback)) {
    throw new Error("Production workspace sessions require HTTPS.");
  }
  if (origin.protocol !== "http:") {
    throw new Error("Workspace origin protocol is invalid.");
  }
  return { origin: origin.origin, secureCookie: false };
}

export function isWorkspaceSessionExpired(
  createdAt: string,
  now: Date,
  ttlMs: number,
): boolean {
  const createdAtMs = Date.parse(createdAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs <= 0
  ) {
    throw new Error("Workspace session expiry input is invalid.");
  }
  return createdAtMs <= nowMs - ttlMs;
}

export async function readWorkspaceMutationBody(
  request: Request,
  maxBytes: number,
  timeoutMs = 10_000,
): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Content length is invalid.");
    }
    if (Number(contentLength) > maxBytes) {
      throw new WorkspaceHttpError(413, "PAYLOAD_TOO_LARGE", "Workspace request is too large.");
    }
  }
  try {
    return await readUtf8BodyLimited(request, maxBytes, timeoutMs);
  } catch (error) {
    if (
      error instanceof RequestBodyTooLargeError ||
      (error instanceof Error && error.name === "RequestBodyTooLargeError")
    ) {
      throw new WorkspaceHttpError(413, "PAYLOAD_TOO_LARGE", "Workspace request is too large.");
    }
    if (
      error instanceof RequestBodyTimeoutError ||
      (error instanceof Error && error.name === "RequestBodyTimeoutError")
    ) {
      throw new WorkspaceHttpError(408, "REQUEST_TIMEOUT", "Workspace request timed out.");
    }
    if (error instanceof TypeError) {
      throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Workspace request is not UTF-8.");
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new WorkspaceHttpError(400, "INVALID_REQUEST", `$body.${key} is not allowed.`);
    }
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  }
  if (!isRecord(value)) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Request body must be an object.");
  }
  return value;
}

function safeIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", `${path} is invalid.`);
  }
  return value;
}

export function parseDecisionMutationBody(text: string): { selectedOptionId: string } {
  const value = parseJsonObject(text);
  assertOnlyKeys(value, ["selectedOptionId"]);
  return { selectedOptionId: safeIdentifier(value.selectedOptionId, "$body.selectedOptionId") };
}

export function parseSourceMutationBody(text: string): { sourceText: string } {
  const value = parseJsonObject(text);
  assertOnlyKeys(value, ["sourceText"]);
  if (
    typeof value.sourceText !== "string" ||
    value.sourceText.length === 0 ||
    new TextEncoder().encode(value.sourceText).byteLength > SOURCE_MUTATION_MAX_BYTES
  ) {
    throw new WorkspaceHttpError(
      400,
      "INVALID_REQUEST",
      "$body.sourceText must be non-empty and within the configured byte limit.",
    );
  }
  return { sourceText: value.sourceText };
}

export function isWorkspaceCsrfToken(value: string | null): value is string {
  return value !== null && CSRF_TOKEN.test(value);
}

export function assertWorkspaceMutationHeaders(input: WorkspaceMutationHeaders): void {
  if (input.contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new WorkspaceHttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Workspace mutations require application/json.",
    );
  }

  let expectedOrigin: string;
  let requestOrigin: string;
  try {
    expectedOrigin = new URL(input.expectedOrigin).origin;
    requestOrigin = new URL(input.origin ?? "").origin;
  } catch {
    throw new WorkspaceHttpError(403, "FORBIDDEN_ORIGIN", "Workspace mutation origin is invalid.");
  }
  if (
    input.expectedOrigin !== expectedOrigin ||
    requestOrigin !== expectedOrigin ||
    input.secFetchSite !== "same-origin"
  ) {
    throw new WorkspaceHttpError(403, "FORBIDDEN_ORIGIN", "Workspace mutation origin is invalid.");
  }

  if (!isWorkspaceCsrfToken(input.csrfCookie) || !isWorkspaceCsrfToken(input.csrfHeader)) {
    throw new WorkspaceHttpError(403, "INVALID_CSRF_TOKEN", "Workspace CSRF token is invalid.");
  }
  const cookieBytes = Buffer.from(input.csrfCookie);
  const headerBytes = Buffer.from(input.csrfHeader);
  if (cookieBytes.length !== headerBytes.length || !timingSafeEqual(cookieBytes, headerBytes)) {
    throw new WorkspaceHttpError(403, "INVALID_CSRF_TOKEN", "Workspace CSRF token is invalid.");
  }
}

export function mapWorkspaceHttpError(error: unknown): WorkspaceHttpError {
  if (error instanceof WorkspaceHttpError) {
    return error;
  }
  const structuralCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;
  const structuralName =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : null;
  if (
    structuralName === "WorkspaceHttpError" &&
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    structuralCode !== null
  ) {
    const publicCodes = new Set<WorkspaceHttpErrorCode>([
      "INVALID_REQUEST",
      "UNSUPPORTED_MEDIA_TYPE",
      "PAYLOAD_TOO_LARGE",
      "REQUEST_TIMEOUT",
      "FORBIDDEN_ORIGIN",
      "INVALID_CSRF_TOKEN",
      "INVALID_SESSION",
      "WORKSPACE_CAPACITY",
      "REFERENCE_POLICY_MISMATCH",
      "PROJECT_NOT_FOUND",
      "DECISION_NOT_FOUND",
      "STALE_VERSION",
      "GOLDEN_CONTRADICTION",
      "NOT_INTERPRETED",
      "WORKSPACE_BUSY",
      "INTERNAL_ERROR",
    ]);
    if (publicCodes.has(structuralCode as WorkspaceHttpErrorCode)) {
      return new WorkspaceHttpError(
        error.status,
        structuralCode as WorkspaceHttpErrorCode,
        "Workspace request failed.",
      );
    }
  }
  if (structuralCode === "GOLDEN_CONTRADICTION") {
    return new WorkspaceHttpError(
      409,
      "GOLDEN_CONTRADICTION",
      "Decision contradicts an authoritative golden case.",
    );
  }
  if (structuralCode === "UNKNOWN_AMBIGUITY" || structuralCode === "UNKNOWN_OPTION") {
    return new WorkspaceHttpError(404, "DECISION_NOT_FOUND", "Decision option was not found.");
  }
  if (structuralCode === "STALE_VERSION") {
    return new WorkspaceHttpError(409, "STALE_VERSION", "Policy version is stale.");
  }
  if (structuralCode === "NOT_INTERPRETED") {
    return new WorkspaceHttpError(409, "NOT_INTERPRETED", "Policy version is not interpreted.");
  }
  if (structuralCode === "PROJECT_NOT_FOUND" || structuralCode === "VERSION_NOT_FOUND") {
    return new WorkspaceHttpError(404, "PROJECT_NOT_FOUND", "Policy project was not found.");
  }
  if (
    structuralCode === "INVALID_INPUT" ||
    structuralCode === "DECISION_MISMATCH" ||
    structuralCode === "INVALID_DECISION_TIME"
  ) {
    return new WorkspaceHttpError(400, "INVALID_REQUEST", "Workspace command is invalid.");
  }
  if (error instanceof PolicyWorkspaceServiceError) {
    if (error.code === "INVALID_INPUT") {
      return new WorkspaceHttpError(400, "INVALID_REQUEST", "Workspace command is invalid.");
    }
    if (error.code === "PROJECT_NOT_FOUND") {
      return new WorkspaceHttpError(404, "PROJECT_NOT_FOUND", "Policy project was not found.");
    }
    if (error.code === "STALE_VERSION") {
      return new WorkspaceHttpError(409, "STALE_VERSION", "Policy version is stale.");
    }
    if (error.code === "NOT_INTERPRETED") {
      return new WorkspaceHttpError(409, "NOT_INTERPRETED", "Policy version is not interpreted.");
    }
    return new WorkspaceHttpError(500, "INTERNAL_ERROR", "Workspace state is unavailable.");
  }
  if (error instanceof PolicyResolutionError) {
    if (error.code === "UNKNOWN_AMBIGUITY" || error.code === "UNKNOWN_OPTION") {
      return new WorkspaceHttpError(404, "DECISION_NOT_FOUND", "Decision option was not found.");
    }
    if (error.code === "GOLDEN_CONTRADICTION") {
      return new WorkspaceHttpError(
        409,
        "GOLDEN_CONTRADICTION",
        "Decision contradicts an authoritative golden case.",
      );
    }
    return new WorkspaceHttpError(500, "INTERNAL_ERROR", "Stored decision contract is invalid.");
  }
  if (error instanceof PolicyPersistenceError) {
    if (error.code === "PROJECT_CAPACITY") {
      return new WorkspaceHttpError(
        429,
        "WORKSPACE_CAPACITY",
        "Anonymous workspace capacity is temporarily exhausted.",
      );
    }
    if (error.code === "PROJECT_NOT_FOUND" || error.code === "VERSION_NOT_FOUND") {
      return new WorkspaceHttpError(404, "PROJECT_NOT_FOUND", "Policy project was not found.");
    }
    if (error.code === "STALE_VERSION") {
      return new WorkspaceHttpError(409, "STALE_VERSION", "Policy version is stale.");
    }
    if (error.code === "INVALID_INPUT" || error.code === "DECISION_MISMATCH") {
      return new WorkspaceHttpError(400, "INVALID_REQUEST", "Workspace command is invalid.");
    }
  }
  return new WorkspaceHttpError(500, "INTERNAL_ERROR", "Workspace mutation failed.");
}
