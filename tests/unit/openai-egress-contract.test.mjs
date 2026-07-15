import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAiEgressLease,
  inspectOpenAiEgressRequestHead,
  inspectOpenAiEgressResponseHead,
  isPublicOpenAiIpv4,
  OpenAiEgressLeaseGuard,
  parseOpenAiEgressRequestBody,
  selectPinnedOpenAiIpv4,
} from "../../dist/codex/openai-egress-contract.js";

const TOKEN = Buffer.alloc(32, 7).toString("base64url");
const BODY = Buffer.from('{"model":"gpt-5.6"}', "utf8");

function requestHeaders(overrides = {}) {
  const headers = {
    host: "policytwin-egress:8443",
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "content-length": String(BODY.byteLength),
    accept: "application/json",
    "accept-encoding": "identity",
    ...overrides,
  };
  return Object.entries(headers).flatMap(([name, value]) => [name, value]);
}

test("OpenAI egress admission fixes the only destination, request shape, and bounded lease", () => {
  const admission = inspectOpenAiEgressRequestHead({
    method: "POST",
    target: "/v1/responses",
    rawHeaders: requestHeaders(),
  });
  assert.equal(admission.contentLength, BODY.byteLength);
  assert.equal(admission.leaseToken, TOKEN);
  assert.deepEqual(parseOpenAiEgressRequestBody(BODY, BODY.byteLength), {
    model: "gpt-5.6",
  });
  assert.equal(Object.hasOwn(admission.forwardedHeaders, "authorization"), false);
  assert.equal(Object.hasOwn(admission.forwardedHeaders, "host"), false);

  const lease = createOpenAiEgressLease({
    runId: "run-egress-12345678",
    token: TOKEN,
    issuedAt: "2026-07-15T00:00:00.000Z",
    expiresAt: "2026-07-15T00:05:00.000Z",
    maxRequests: 2,
  });
  const guard = new OpenAiEgressLeaseGuard(lease);
  assert.deepEqual(guard.consume(TOKEN, new Date("2026-07-15T00:01:00.000Z")), {
    runId: "run-egress-12345678",
    requestNumber: 1,
    remainingRequests: 1,
  });
  guard.consume(TOKEN, new Date("2026-07-15T00:02:00.000Z"));
  assert.throws(
    () => guard.consume(TOKEN, new Date("2026-07-15T00:03:00.000Z")),
    /request limit/u,
  );
});

test("OpenAI egress admission rejects request-smuggling and destination bypasses", (t) => {
  const cases = [
    ["CONNECT method", { method: "CONNECT" }, /Only origin-form/u],
    ["absolute target", { target: "https://api.openai.com/v1/responses" }, /origin-form/u],
    ["query target", { target: "/v1/responses?x=1" }, /origin-form/u],
    ["wrong host", { rawHeaders: requestHeaders({ host: "api.openai.com" }) }, /authority/u],
    [
      "transfer encoding",
      { rawHeaders: requestHeaders({ "transfer-encoding": "chunked" }) },
      /not admitted/u,
    ],
    ["proxy header", { rawHeaders: requestHeaders({ "proxy-authorization": "x" }) }, /not admitted/u],
    ["compressed response", { rawHeaders: requestHeaders({ "accept-encoding": "gzip" }) }, /Compressed/u],
    ["unsafe connection", { rawHeaders: requestHeaders({ connection: "upgrade" }) }, /connection/u],
    [
      "oversized body",
      { rawHeaders: requestHeaders({ "content-length": String(1024 * 1024 + 1) }) },
      /exceeds/u,
    ],
    [
      "duplicate authorization",
      { rawHeaders: [...requestHeaders(), "Authorization", `Bearer ${TOKEN}`] },
      /Duplicate/u,
    ],
  ];
  for (const [name, override, pattern] of cases) {
    t.assert.throws(
      () =>
        inspectOpenAiEgressRequestHead({
          method: "POST",
          target: "/v1/responses",
          rawHeaders: requestHeaders(),
          ...override,
        }),
      pattern,
      name,
    );
  }
  assert.throws(
    () => parseOpenAiEgressRequestBody(Buffer.from("[]", "utf8"), 2),
    /JSON object/u,
  );
  assert.throws(
    () => parseOpenAiEgressRequestBody(Buffer.from("{}x", "utf8"), 3),
    /UTF-8 JSON/u,
  );
});

test("OpenAI DNS pinning rejects every non-public or ambiguous address set", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::1",
  ]) {
    assert.equal(isPublicOpenAiIpv4(address), false, address);
    assert.throws(() => selectPinnedOpenAiIpv4(["93.184.216.34", address]), /unsafe/u);
  }
  assert.equal(selectPinnedOpenAiIpv4(["93.184.216.35", "93.184.216.34"]), "93.184.216.34");
});

test("OpenAI egress response admission rejects redirects, compression, and oversized framing", () => {
  assert.deepEqual(
    inspectOpenAiEgressResponseHead({
      statusCode: 200,
      rawHeaders: [
        "content-type",
        "text/event-stream; charset=utf-8",
        "x-request-id",
        "req_123",
      ],
    }),
    {
      statusCode: 200,
      contentLength: null,
      forwardedHeaders: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-request-id": "req_123",
      },
    },
  );
  assert.throws(
    () =>
      inspectOpenAiEgressResponseHead({
        statusCode: 307,
        rawHeaders: ["content-type", "application/json", "location", "https://example.invalid"],
      }),
    /status/u,
  );
  assert.throws(
    () =>
      inspectOpenAiEgressResponseHead({
        statusCode: 200,
        rawHeaders: ["content-type", "application/json", "content-encoding", "gzip"],
      }),
    /Compressed/u,
  );
  assert.throws(
    () =>
      inspectOpenAiEgressResponseHead({
        statusCode: 200,
        rawHeaders: ["content-type", "application/json", "content-length", String(8 * 1024 * 1024 + 1)],
      }),
    /byte limit/u,
  );
});
