import { timingSafeEqual } from "node:crypto";
import {
  interpretPolicyWithOpenAI,
  PolicyInterpreterError,
} from "../../../dist/openai/interpreter.js";
import {
  readUtf8BodyLimited,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
  SingleRunGate,
} from "../../../dist/openai/request-guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 128_000;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const RUN_GATE = new SingleRunGate();

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

function hasValidRunToken(request: Request, expected: string): boolean {
  const provided = request.headers.get("x-policytwin-run-token") ?? "";
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export async function POST(request: Request) {
  const runToken = process.env.POLICYTWIN_RUN_TOKEN;
  if (!runToken) {
    return json({ error: "LIVE_RUN_DISABLED" }, 503);
  }
  if (!hasValidRunToken(request, runToken)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  const contentLength = request.headers.get("content-length");
  const length = contentLength === null ? null : Number(contentLength);
  if (length !== null && (!Number.isSafeInteger(length) || length < 0)) {
    return json({ error: "INVALID_CONTENT_LENGTH" }, 400);
  }
  if (length !== null && length > MAX_REQUEST_BYTES) {
    return json({ error: "REQUEST_TOO_LARGE" }, 413);
  }
  const releaseRun = RUN_GATE.tryAcquire();
  if (releaseRun === null) {
    return json({ error: "RUN_BUSY" }, 429);
  }
  try {
    let body: unknown;
    try {
      body = JSON.parse(
        await readUtf8BodyLimited(request, MAX_REQUEST_BYTES, 10_000),
      ) as unknown;
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ error: "REQUEST_TOO_LARGE" }, 413);
      }
      if (error instanceof RequestBodyTimeoutError) {
        return json({ error: "REQUEST_TIMEOUT" }, 408);
      }
      return json({ error: "INVALID_JSON" }, 400);
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    const result = await interpretPolicyWithOpenAI(body as never, { signal });
    return Response.json(result, { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    if (error instanceof PolicyInterpreterError) {
      const status =
        error.code === "AUTH_REQUIRED" ? 503 : error.code === "INVALID_INPUT" ? 400 : 502;
      return json({ error: error.code }, status);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  } finally {
    releaseRun();
  }
}
