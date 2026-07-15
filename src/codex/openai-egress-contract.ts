import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const OPENAI_EGRESS_AUDIENCE = "policytwin-codex-egress" as const;
export const OPENAI_EGRESS_INBOUND_AUTHORITY = "policytwin-egress:8443" as const;
export const OPENAI_EGRESS_UPSTREAM_HOST = "api.openai.com" as const;
export const OPENAI_EGRESS_UPSTREAM_AUTHORITY = "api.openai.com:443" as const;
export const OPENAI_EGRESS_REQUEST_PATH = "/v1/responses" as const;
export const OPENAI_EGRESS_MAX_REQUEST_BYTES = 1024 * 1024;
export const OPENAI_EGRESS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const VISIBLE_ASCII = /^[\x20-\x7e]*$/u;
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "authorization",
  "connection",
  "content-length",
  "content-type",
  "host",
  "user-agent",
  "x-client-request-id",
]);

export interface OpenAiEgressLease {
  schemaVersion: "1";
  audience: typeof OPENAI_EGRESS_AUDIENCE;
  runId: string;
  tokenSha256: string;
  issuedAt: string;
  expiresAt: string;
  maxRequests: number;
}

export interface OpenAiEgressAdmission {
  contentLength: number;
  leaseToken: string;
  forwardedHeaders: Readonly<Record<string, string>>;
}

export interface OpenAiEgressLeaseUse {
  runId: string;
  requestNumber: number;
  remainingRequests: number;
}

export interface OpenAiEgressResponseHead {
  statusCode: number;
  contentLength: number | null;
  forwardedHeaders: Readonly<Record<string, string>>;
}

export class OpenAiEgressAdmissionError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "OpenAiEgressAdmissionError";
    this.httpStatus = httpStatus;
  }
}

function canonicalIso(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be canonical UTC ISO-8601.`);
  }
  return value;
}

function canonicalToken(value: string): string {
  if (!TOKEN.test(value)) {
    throw new OpenAiEgressAdmissionError("The egress capability token is invalid.", 401);
  }
  const bytes = Buffer.from(value, "base64url");
  const canonical = bytes.byteLength === 32 && bytes.toString("base64url") === value;
  bytes.fill(0);
  if (!canonical) {
    throw new OpenAiEgressAdmissionError("The egress capability token is invalid.", 401);
  }
  return value;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseRawHeaders(rawHeaders: readonly string[]): Map<string, string> {
  if (rawHeaders.length === 0 || rawHeaders.length % 2 !== 0) {
    throw new OpenAiEgressAdmissionError("The request header frame is invalid.");
  }
  const headers = new Map<string, string>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const rawName = rawHeaders[index];
    const rawValue = rawHeaders[index + 1];
    if (rawName === undefined || rawValue === undefined) {
      throw new OpenAiEgressAdmissionError("The request header frame is invalid.");
    }
    const name = rawName.toLowerCase();
    if (
      !/^[a-z0-9-]+$/u.test(name) ||
      rawValue.length > 1024 ||
      /[\r\n\0]/u.test(rawValue) ||
      headers.has(name)
    ) {
      throw new OpenAiEgressAdmissionError("Duplicate or unsafe request headers are forbidden.");
    }
    headers.set(name, rawValue);
  }
  return headers;
}

function decimalByteLength(value: string | undefined, maximum: number): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]{0,7})$/u.test(value)) {
    throw new OpenAiEgressAdmissionError("Content-Length must be one canonical decimal value.");
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 2 || result > maximum) {
    throw new OpenAiEgressAdmissionError("The request body exceeds the admitted size.", 413);
  }
  return result;
}

export function inspectOpenAiEgressRequestHead(input: {
  method: string | undefined;
  target: string | undefined;
  rawHeaders: readonly string[];
}): OpenAiEgressAdmission {
  if (input.method !== "POST" || input.target !== OPENAI_EGRESS_REQUEST_PATH) {
    throw new OpenAiEgressAdmissionError(
      "Only origin-form POST /v1/responses requests are admitted.",
    );
  }
  const headers = parseRawHeaders(input.rawHeaders);
  for (const name of headers.keys()) {
    if (!ALLOWED_REQUEST_HEADERS.has(name)) {
      throw new OpenAiEgressAdmissionError(`Request header ${name} is not admitted.`);
    }
  }
  if (headers.get("host")?.toLowerCase() !== OPENAI_EGRESS_INBOUND_AUTHORITY) {
    throw new OpenAiEgressAdmissionError("The egress proxy authority is invalid.");
  }
  if (headers.get("content-type")?.toLowerCase() !== "application/json") {
    throw new OpenAiEgressAdmissionError("Only application/json requests are admitted.");
  }
  const contentLength = decimalByteLength(
    headers.get("content-length"),
    OPENAI_EGRESS_MAX_REQUEST_BYTES,
  );
  const authorization = headers.get("authorization");
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new OpenAiEgressAdmissionError("A bearer capability is required.", 401);
  }
  const leaseToken = canonicalToken(authorization.slice("Bearer ".length));
  const accept = headers.get("accept");
  if (
    accept !== undefined &&
    accept.toLowerCase() !== "application/json" &&
    accept.toLowerCase() !== "text/event-stream"
  ) {
    throw new OpenAiEgressAdmissionError("The requested response representation is not admitted.");
  }
  const acceptEncoding = headers.get("accept-encoding");
  if (acceptEncoding !== undefined && acceptEncoding.toLowerCase() !== "identity") {
    throw new OpenAiEgressAdmissionError("Compressed upstream responses are not admitted.");
  }
  const connection = headers.get("connection");
  if (
    connection !== undefined &&
    connection.toLowerCase() !== "close" &&
    connection.toLowerCase() !== "keep-alive"
  ) {
    throw new OpenAiEgressAdmissionError("The connection header is not admitted.");
  }
  const userAgent = headers.get("user-agent");
  if (userAgent !== undefined && (userAgent.length > 256 || !VISIBLE_ASCII.test(userAgent))) {
    throw new OpenAiEgressAdmissionError("The user-agent value is invalid.");
  }
  const requestId = headers.get("x-client-request-id");
  if (requestId !== undefined && !REQUEST_ID.test(requestId)) {
    throw new OpenAiEgressAdmissionError("The client request ID is invalid.");
  }
  return {
    contentLength,
    leaseToken,
    forwardedHeaders: {
      accept: accept ?? "application/json",
      "accept-encoding": "identity",
      "content-length": String(contentLength),
      "content-type": "application/json",
      ...(userAgent === undefined ? {} : { "user-agent": userAgent }),
      ...(requestId === undefined ? {} : { "x-client-request-id": requestId }),
    },
  };
}

export function parseOpenAiEgressRequestBody(
  body: Uint8Array,
  expectedBytes: number,
): Readonly<Record<string, unknown>> {
  if (
    body.byteLength !== expectedBytes ||
    body.byteLength < 2 ||
    body.byteLength > OPENAI_EGRESS_MAX_REQUEST_BYTES
  ) {
    throw new OpenAiEgressAdmissionError("The request body length is inconsistent.", 413);
  }
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    value = JSON.parse(text);
  } catch {
    throw new OpenAiEgressAdmissionError("The request body must be canonical UTF-8 JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OpenAiEgressAdmissionError("The Responses API body must be a JSON object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function createOpenAiEgressLease(input: {
  runId: string;
  token: string;
  issuedAt: string;
  expiresAt: string;
  maxRequests: number;
}): OpenAiEgressLease {
  if (!RUN_ID.test(input.runId)) throw new Error("The egress lease run ID is invalid.");
  const token = canonicalToken(input.token);
  const issuedAt = canonicalIso(input.issuedAt, "Egress lease issuedAt");
  const expiresAt = canonicalIso(input.expiresAt, "Egress lease expiresAt");
  const lifetime = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (lifetime < 1_000 || lifetime > 15 * 60_000) {
    throw new Error("The egress lease lifetime is invalid.");
  }
  if (!Number.isInteger(input.maxRequests) || input.maxRequests < 1 || input.maxRequests > 64) {
    throw new Error("The egress lease request limit is invalid.");
  }
  return {
    schemaVersion: "1",
    audience: OPENAI_EGRESS_AUDIENCE,
    runId: input.runId,
    tokenSha256: sha256Text(token),
    issuedAt,
    expiresAt,
    maxRequests: input.maxRequests,
  };
}

function parseLease(value: OpenAiEgressLease): OpenAiEgressLease {
  if (
    value.schemaVersion !== "1" ||
    value.audience !== OPENAI_EGRESS_AUDIENCE ||
    !RUN_ID.test(value.runId) ||
    !SHA256.test(value.tokenSha256) ||
    !Number.isInteger(value.maxRequests) ||
    value.maxRequests < 1 ||
    value.maxRequests > 64
  ) {
    throw new Error("The egress lease contract is invalid.");
  }
  const issuedAt = canonicalIso(value.issuedAt, "Egress lease issuedAt");
  const expiresAt = canonicalIso(value.expiresAt, "Egress lease expiresAt");
  const lifetime = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (lifetime < 1_000 || lifetime > 15 * 60_000) {
    throw new Error("The egress lease lifetime is invalid.");
  }
  return { ...value, issuedAt, expiresAt };
}

export class OpenAiEgressLeaseGuard {
  readonly #lease: OpenAiEgressLease;
  #requestCount = 0;

  constructor(lease: OpenAiEgressLease) {
    this.#lease = parseLease(lease);
  }

  #assertUsable(token: string, now: Date): void {
    const canonical = canonicalToken(token);
    const expected = Buffer.from(this.#lease.tokenSha256, "hex");
    const actual = Buffer.from(sha256Text(canonical), "hex");
    const matches = expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
    expected.fill(0);
    actual.fill(0);
    if (!matches) {
      throw new OpenAiEgressAdmissionError("The egress capability is not recognized.", 403);
    }
    const milliseconds = now.getTime();
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < Date.parse(this.#lease.issuedAt) ||
      milliseconds >= Date.parse(this.#lease.expiresAt)
    ) {
      throw new OpenAiEgressAdmissionError("The egress capability is outside its validity window.", 403);
    }
    if (this.#requestCount >= this.#lease.maxRequests) {
      throw new OpenAiEgressAdmissionError("The egress capability request limit is exhausted.", 403);
    }
  }

  assertUsable(token: string, now = new Date()): void {
    this.#assertUsable(token, now);
  }

  consume(token: string, now = new Date()): OpenAiEgressLeaseUse {
    this.#assertUsable(token, now);
    this.#requestCount += 1;
    return {
      runId: this.#lease.runId,
      requestNumber: this.#requestCount,
      remainingRequests: this.#lease.maxRequests - this.#requestCount,
    };
  }
}

function octets(address: string): readonly number[] | null {
  if (isIP(address) !== 4) return null;
  const values = address.split(".").map(Number);
  return values.length === 4 ? values : null;
}

export function isPublicOpenAiIpv4(address: string): boolean {
  const values = octets(address);
  if (values === null) return false;
  const [a = -1, b = -1, c = -1] = values;
  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return false;
  }
  return true;
}

export function selectPinnedOpenAiIpv4(addresses: readonly string[]): string {
  if (addresses.length === 0 || addresses.length > 16 || addresses.some((item) => !isPublicOpenAiIpv4(item))) {
    throw new OpenAiEgressAdmissionError("OpenAI DNS returned an unsafe address set.", 502);
  }
  return [...new Set(addresses)].sort()[0] as string;
}

export function inspectOpenAiEgressResponseHead(input: {
  statusCode: number | undefined;
  rawHeaders: readonly string[];
}): OpenAiEgressResponseHead {
  const statusCode = input.statusCode;
  if (
    statusCode === undefined ||
    !Number.isInteger(statusCode) ||
    statusCode < 200 ||
    statusCode > 599 ||
    (statusCode >= 300 && statusCode <= 399)
  ) {
    throw new OpenAiEgressAdmissionError("The upstream response status is not admitted.", 502);
  }
  const headers = parseRawHeaders(input.rawHeaders);
  const contentType = headers.get("content-type")?.toLowerCase();
  if (
    contentType === undefined ||
    !/^(?:application\/json|text\/event-stream)(?:;\s*charset=utf-8)?$/u.test(contentType)
  ) {
    throw new OpenAiEgressAdmissionError("The upstream response content type is not admitted.", 502);
  }
  const contentEncoding = headers.get("content-encoding");
  if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== "identity") {
    throw new OpenAiEgressAdmissionError("Compressed upstream responses are not admitted.", 502);
  }
  const declaredLength = headers.get("content-length");
  let contentLength: number | null = null;
  if (declaredLength !== undefined) {
    if (!/^(?:0|[1-9][0-9]{0,8})$/u.test(declaredLength)) {
      throw new OpenAiEgressAdmissionError("The upstream response length is invalid.", 502);
    }
    contentLength = Number(declaredLength);
    if (contentLength > OPENAI_EGRESS_MAX_RESPONSE_BYTES) {
      throw new OpenAiEgressAdmissionError("The upstream response exceeds the byte limit.", 502);
    }
  }
  const forwardedHeaders: Record<string, string> = { "content-type": contentType };
  for (const name of ["openai-processing-ms", "retry-after", "x-request-id"]) {
    const value = headers.get(name);
    if (value !== undefined && value.length <= 256 && VISIBLE_ASCII.test(value)) {
      forwardedHeaders[name] = value;
    }
  }
  return { statusCode, contentLength, forwardedHeaders };
}
