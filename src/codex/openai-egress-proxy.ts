import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { checkServerIdentity } from "node:tls";
import {
  inspectOpenAiEgressRequestHead,
  inspectOpenAiEgressResponseHead,
  OPENAI_EGRESS_MAX_REQUEST_BYTES,
  OPENAI_EGRESS_MAX_RESPONSE_BYTES,
  OPENAI_EGRESS_REQUEST_PATH,
  OPENAI_EGRESS_UPSTREAM_AUTHORITY,
  OPENAI_EGRESS_UPSTREAM_HOST,
  OpenAiEgressAdmissionError,
  OpenAiEgressLeaseGuard,
  parseOpenAiEgressRequestBody,
  selectPinnedOpenAiIpv4,
} from "./openai-egress-contract.js";

export interface OpenAiEgressUpstreamRequest {
  pinnedIpv4: string;
  body: Uint8Array;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface OpenAiEgressUpstreamResponse {
  statusCode: number;
  rawHeaders: readonly string[];
  body: Uint8Array;
}

export interface OpenAiEgressUpstreamClient {
  send(request: OpenAiEgressUpstreamRequest): Promise<OpenAiEgressUpstreamResponse>;
  destroy(): void;
}

export interface OpenAiEgressProxyOptions {
  leaseGuard: OpenAiEgressLeaseGuard;
  upstreamClient: OpenAiEgressUpstreamClient;
  resolveIpv4?: () => Promise<readonly string[]>;
  now?: () => Date;
  maximumInFlight?: number;
  upstreamTimeoutMs?: number;
}

function boundedProviderToken(value: Uint8Array): Buffer {
  if (value.byteLength < 20 || value.byteLength > 4096) {
    throw new Error("The provider credential mount is invalid.");
  }
  const result = Buffer.from(value);
  const text = result.toString("utf8");
  if (text.trim() !== text || !/^[\x21-\x7e]+$/u.test(text)) {
    result.fill(0);
    throw new Error("The provider credential mount is invalid.");
  }
  return result;
}

async function readBoundedResponse(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > OPENAI_EGRESS_MAX_RESPONSE_BYTES) {
      response.destroy();
      throw new OpenAiEgressAdmissionError("The upstream response exceeds the byte limit.", 502);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

export function createPinnedOpenAiUpstreamClient(
  providerTokenBytes: Uint8Array,
  options: { idleTimeoutMs?: number } = {},
): OpenAiEgressUpstreamClient {
  const providerToken = boundedProviderToken(providerTokenBytes);
  const idleTimeoutMs = options.idleTimeoutMs ?? 15_000;
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1_000 || idleTimeoutMs > 60_000) {
    providerToken.fill(0);
    throw new Error("The upstream idle timeout is invalid.");
  }
  let destroyed = false;
  return {
    async send(input) {
      if (destroyed) throw new Error("The upstream client has been destroyed.");
      if (input.signal.aborted) throw input.signal.reason;
      return await new Promise<OpenAiEgressUpstreamResponse>((resolve, reject) => {
        const options: RequestOptions = {
          hostname: input.pinnedIpv4,
          port: 443,
          method: "POST",
          path: OPENAI_EGRESS_REQUEST_PATH,
          servername: OPENAI_EGRESS_UPSTREAM_HOST,
          minVersion: "TLSv1.2",
          maxVersion: "TLSv1.3",
          rejectUnauthorized: true,
          checkServerIdentity: (_host, certificate) =>
            checkServerIdentity(OPENAI_EGRESS_UPSTREAM_HOST, certificate),
          signal: input.signal,
          headers: {
            ...input.headers,
            authorization: `Bearer ${providerToken.toString("utf8")}`,
            connection: "close",
            host: OPENAI_EGRESS_UPSTREAM_AUTHORITY,
          },
        };
        const request = httpsRequest(options, (response) => {
          response.setTimeout(idleTimeoutMs, () => {
            response.destroy(new Error("The upstream response timed out."));
          });
          let head;
          try {
            head = inspectOpenAiEgressResponseHead({
              statusCode: response.statusCode,
              rawHeaders: response.rawHeaders,
            });
          } catch (error) {
            response.destroy();
            reject(error);
            return;
          }
          void readBoundedResponse(response).then(
            (body) => {
              if (head.contentLength !== null && body.byteLength !== head.contentLength) {
                reject(
                  new OpenAiEgressAdmissionError(
                    "The upstream response length is inconsistent.",
                    502,
                  ),
                );
                return;
              }
              resolve({
                statusCode: head.statusCode,
                rawHeaders: response.rawHeaders,
                body,
              });
            },
            reject,
          );
        });
        request.setTimeout(idleTimeoutMs, () => {
          request.destroy(new Error("The upstream request timed out."));
        });
        request.once("error", reject);
        request.end(input.body);
      });
    },
    destroy() {
      destroyed = true;
      providerToken.fill(0);
    },
  };
}

export async function resolveOpenAiPublicIpv4(): Promise<readonly string[]> {
  const addresses = await lookup(OPENAI_EGRESS_UPSTREAM_HOST, {
    all: true,
    family: 4,
    verbatim: true,
  });
  return addresses.map((item) => item.address);
}

async function readBoundedRequest(
  request: IncomingMessage,
  expectedBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    if (signal.aborted) throw signal.reason;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > expectedBytes || total > OPENAI_EGRESS_MAX_REQUEST_BYTES) {
      throw new OpenAiEgressAdmissionError("The request body length is inconsistent.", 413);
    }
    chunks.push(bytes);
  }
  if (total !== expectedBytes) {
    throw new OpenAiEgressAdmissionError("The request body length is inconsistent.");
  }
  return Buffer.concat(chunks, total);
}

function writeProxyError(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
): void {
  request.resume();
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  const statusCode =
    error instanceof OpenAiEgressAdmissionError ? error.httpStatus : 502;
  const body = Buffer.from(
    JSON.stringify({
      error: {
        code: statusCode >= 500 ? "upstream_unavailable" : "request_rejected",
        message: "PolicyTwin egress request rejected.",
      },
    }),
    "utf8",
  );
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    connection: "close",
    "content-length": String(body.byteLength),
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export function createOpenAiEgressProxyHandler(
  options: OpenAiEgressProxyOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const resolveIpv4 = options.resolveIpv4 ?? resolveOpenAiPublicIpv4;
  const now = options.now ?? (() => new Date());
  const maximumInFlight = options.maximumInFlight ?? 2;
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? 120_000;
  if (!Number.isInteger(maximumInFlight) || maximumInFlight < 1 || maximumInFlight > 4) {
    throw new Error("The egress in-flight limit is invalid.");
  }
  if (
    !Number.isInteger(upstreamTimeoutMs) ||
    upstreamTimeoutMs < 1_000 ||
    upstreamTimeoutMs > 180_000
  ) {
    throw new Error("The egress upstream timeout is invalid.");
  }
  let inFlight = 0;
  return (request, response) => {
    const abortController = new AbortController();
    let reserved = false;
    let deadline: NodeJS.Timeout | undefined;
    const abort = (): void => {
      if (!abortController.signal.aborted) {
        abortController.abort(new Error("The egress client connection closed."));
      }
    };
    request.once("aborted", abort);
    request.once("close", () => {
      if (!request.complete) abort();
    });
    response.once("close", () => {
      if (!response.writableEnded) abort();
    });
    void (async () => {
      const admission = inspectOpenAiEgressRequestHead({
        method: request.method,
        target: request.url,
        rawHeaders: request.rawHeaders,
      });
      options.leaseGuard.assertUsable(admission.leaseToken, now());
      if (inFlight >= maximumInFlight) {
        throw new OpenAiEgressAdmissionError("The egress concurrency limit is reached.", 429);
      }
      inFlight += 1;
      reserved = true;
      deadline = setTimeout(() => {
        abortController.abort(new Error("The egress upstream deadline expired."));
        if (!request.complete) request.destroy();
      }, upstreamTimeoutMs);
      const body = await readBoundedRequest(
        request,
        admission.contentLength,
        abortController.signal,
      );
      parseOpenAiEgressRequestBody(body, admission.contentLength);
      const pinnedIpv4 = selectPinnedOpenAiIpv4(await resolveIpv4());
      options.leaseGuard.consume(admission.leaseToken, now());
      const upstream = await options.upstreamClient.send({
        pinnedIpv4,
        body,
        headers: admission.forwardedHeaders,
        signal: abortController.signal,
      });
      const head = inspectOpenAiEgressResponseHead({
        statusCode: upstream.statusCode,
        rawHeaders: upstream.rawHeaders,
      });
      if (
        upstream.body.byteLength > OPENAI_EGRESS_MAX_RESPONSE_BYTES ||
        (head.contentLength !== null && upstream.body.byteLength !== head.contentLength)
      ) {
        throw new OpenAiEgressAdmissionError("The upstream response length is inconsistent.", 502);
      }
      if (abortController.signal.aborted) throw abortController.signal.reason;
      response.writeHead(head.statusCode, {
        ...head.forwardedHeaders,
        "cache-control": "no-store",
        connection: "close",
        "content-length": String(upstream.body.byteLength),
        "x-content-type-options": "nosniff",
      });
      response.end(upstream.body);
    })()
      .catch((error: unknown) => writeProxyError(request, response, error))
      .finally(() => {
        if (deadline !== undefined) clearTimeout(deadline);
        if (reserved) inFlight -= 1;
      });
  };
}
