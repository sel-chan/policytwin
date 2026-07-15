import assert from "node:assert/strict";
import { request as httpRequest, createServer } from "node:http";
import test from "node:test";
import {
  createOpenAiEgressLease,
  OpenAiEgressLeaseGuard,
} from "../../dist/codex/openai-egress-contract.js";
import { createOpenAiEgressProxyHandler } from "../../dist/codex/openai-egress-proxy.js";

const TOKEN = Buffer.alloc(32, 11).toString("base64url");
const NOW = new Date("2026-07-15T00:01:00.000Z");

function lease(maxRequests) {
  return createOpenAiEgressLease({
    runId: "run-proxy-12345678",
    token: TOKEN,
    issuedAt: "2026-07-15T00:00:00.000Z",
    expiresAt: "2026-07-15T00:05:00.000Z",
    maxRequests,
  });
}

async function listen(t, handler, upstreamClient) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    upstreamClient.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return address.port;
}

function send(port, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/v1/responses",
        headers: {
          host: "policytwin-egress:8443",
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          "content-length": String(body.byteLength),
          accept: "application/json",
          "accept-encoding": "identity",
          connection: "close",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

test("egress proxy admits one bounded Responses call and exhausts its run capability", async (t) => {
  const observed = [];
  let destroyed = false;
  const responseBody = Buffer.from('{"id":"resp_test","status":"completed"}', "utf8");
  const upstreamClient = {
    async send(request) {
      observed.push(request);
      return {
        statusCode: 200,
        rawHeaders: [
          "content-type",
          "application/json",
          "content-length",
          String(responseBody.byteLength),
          "x-request-id",
          "req_policytwin",
        ],
        body: responseBody,
      };
    },
    destroy() {
      destroyed = true;
    },
  };
  const port = await listen(
    t,
    createOpenAiEgressProxyHandler({
      leaseGuard: new OpenAiEgressLeaseGuard(lease(1)),
      upstreamClient,
      resolveIpv4: async () => ["93.184.216.34"],
      now: () => NOW,
    }),
    upstreamClient,
  );
  const body = Buffer.from('{"model":"gpt-5.6"}', "utf8");
  const malformed = await send(port, Buffer.from("{}x", "utf8"));
  assert.equal(malformed.statusCode, 400);
  assert.equal(observed.length, 0);
  const first = await send(port, body);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body, responseBody.toString("utf8"));
  assert.equal(first.headers["x-request-id"], "req_policytwin");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].pinnedIpv4, "93.184.216.34");
  assert.equal(Object.hasOwn(observed[0].headers, "authorization"), false);
  assert.equal(Object.hasOwn(observed[0].headers, "host"), false);

  const replay = await send(port, body);
  assert.equal(replay.statusCode, 403);
  assert.match(replay.body, /request_rejected/u);
  assert.equal(observed.length, 1);
  assert.equal(destroyed, false);
});

test("egress proxy limits concurrent upstream work and releases the slot", async (t) => {
  let startFirst;
  const firstStarted = new Promise((resolve) => {
    startFirst = resolve;
  });
  let releaseFirst;
  const released = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const responseBody = Buffer.from('{"status":"completed"}', "utf8");
  let calls = 0;
  const upstreamClient = {
    async send() {
      calls += 1;
      startFirst();
      await released;
      return {
        statusCode: 200,
        rawHeaders: [
          "content-type",
          "application/json",
          "content-length",
          String(responseBody.byteLength),
        ],
        body: responseBody,
      };
    },
    destroy() {},
  };
  const port = await listen(
    t,
    createOpenAiEgressProxyHandler({
      leaseGuard: new OpenAiEgressLeaseGuard(lease(4)),
      upstreamClient,
      resolveIpv4: async () => ["93.184.216.34"],
      now: () => NOW,
      maximumInFlight: 1,
      upstreamTimeoutMs: 5_000,
    }),
    upstreamClient,
  );
  const body = Buffer.from('{"model":"gpt-5.6"}', "utf8");
  const first = send(port, body);
  await firstStarted;
  const concurrent = await send(port, body);
  assert.equal(concurrent.statusCode, 429);
  assert.equal(calls, 1);
  releaseFirst();
  assert.equal((await first).statusCode, 200);
});

test("egress proxy aborts a stalled upstream and a completed client that disconnects", async (t) => {
  const signals = [];
  const starts = [];
  const upstreamClient = {
    async send(request) {
      signals.push(request.signal);
      starts.shift()?.();
      return await new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), {
          once: true,
        });
      });
    },
    destroy() {},
  };
  const port = await listen(
    t,
    createOpenAiEgressProxyHandler({
      leaseGuard: new OpenAiEgressLeaseGuard(lease(4)),
      upstreamClient,
      resolveIpv4: async () => ["93.184.216.34"],
      now: () => NOW,
      upstreamTimeoutMs: 1_000,
    }),
    upstreamClient,
  );
  const body = Buffer.from('{"model":"gpt-5.6"}', "utf8");
  const startedByTimeout = new Promise((resolve) => starts.push(resolve));
  const timed = send(port, body);
  await startedByTimeout;
  const timeoutResponse = await timed;
  assert.equal(timeoutResponse.statusCode, 502);
  assert.equal(signals[0].aborted, true);

  const startedByDisconnect = new Promise((resolve) => starts.push(resolve));
  const disconnected = httpRequest({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/v1/responses",
    headers: {
      host: "policytwin-egress:8443",
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "content-length": String(body.byteLength),
      accept: "application/json",
      "accept-encoding": "identity",
      connection: "close",
    },
  });
  disconnected.on("error", () => undefined);
  disconnected.end(body);
  await startedByDisconnect;
  disconnected.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(signals[1].aborted, true);
});
