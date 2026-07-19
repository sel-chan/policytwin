import assert from "node:assert/strict";
import test from "node:test";
import {
  PolicyResolutionError,
  PolicyWorkspaceServiceError,
  WorkspaceHttpError,
  assertWorkspaceMutationHeaders,
  isWorkspaceSessionExpired,
  mapWorkspaceHttpError,
  parseDecisionMutationBody,
  parseSourceMutationBody,
  readWorkspaceMutationBody,
  resolveWorkspacePublicOrigin,
} from "../../dist/index.js";
import { PolicyPersistenceError } from "../../dist/persistence/sqlite.js";
import { workspaceErrorResponse } from "../../app/lib/workspace-http.ts";

const csrfToken = "a".repeat(43);
const validHeaders = {
  expectedOrigin: "https://policytwin.example",
  contentType: "application/json; charset=utf-8",
  origin: "https://policytwin.example",
  secFetchSite: "same-origin",
  csrfCookie: csrfToken,
  csrfHeader: csrfToken,
};

test("workspace mutation bodies are closed and byte bounded", () => {
  assert.deepEqual(parseDecisionMutationBody('{"selectedOptionId":"default-deny"}'), {
    selectedOptionId: "default-deny",
  });
  assert.deepEqual(parseSourceMutationBody('{"sourceText":"Thirty days."}'), {
    sourceText: "Thirty days.",
  });
  for (const body of [
    "{}",
    "null",
    '{"selectedOptionId":"default-deny","policyPatch":{}}',
    '{"selectedOptionId":"../../escape"}',
  ]) {
    assert.throws(() => parseDecisionMutationBody(body), WorkspaceHttpError);
  }
  assert.throws(
    () => parseSourceMutationBody(JSON.stringify({ sourceText: "a".repeat(131_073) })),
    (error) => error instanceof WorkspaceHttpError && error.code === "INVALID_REQUEST",
  );
});

test("workspace mutations require JSON, same-origin browser provenance, and matching CSRF", () => {
  assert.doesNotThrow(() => assertWorkspaceMutationHeaders(validHeaders));
  for (const override of [
    { contentType: "text/plain" },
    { origin: "https://attacker.example" },
    { origin: "https://policytwin.example:444" },
    { expectedOrigin: "https://policytwin.example/" },
    { secFetchSite: "cross-site" },
    { csrfCookie: null },
    { csrfHeader: "b".repeat(43) },
  ]) {
    assert.throws(
      () => assertWorkspaceMutationHeaders({ ...validHeaders, ...override }),
      WorkspaceHttpError,
    );
  }
});

test("workspace public origins and session expiry fail closed", () => {
  assert.deepEqual(
    resolveWorkspacePublicOrigin({
      configuredOrigin: "https://policytwin.example",
      requestUrl: "http://internal:3000/api/policies/x/workspace",
      requestHost: "spoofed.example",
      production: true,
      allowInsecureLoopback: false,
    }),
    { origin: "https://policytwin.example", secureCookie: true },
  );
  assert.deepEqual(
    resolveWorkspacePublicOrigin({
      configuredOrigin: "http://127.0.0.1:3210",
      requestUrl: "http://127.0.0.1:3210/api/policies/x/workspace",
      requestHost: "127.0.0.1:3210",
      production: true,
      allowInsecureLoopback: true,
    }),
    { origin: "http://127.0.0.1:3210", secureCookie: false },
  );
  for (const configuredOrigin of [null, "http://policytwin.example", "https://policytwin.example/"]) {
    assert.throws(() =>
      resolveWorkspacePublicOrigin({
        configuredOrigin,
        requestUrl: "http://internal:3000/api/policies/x/workspace",
        requestHost: "internal:3000",
        production: true,
        allowInsecureLoopback: false,
      }),
    );
  }

  const now = new Date("2026-07-15T00:00:00.000Z");
  assert.equal(
    isWorkspaceSessionExpired("2026-07-14T00:00:00.000Z", now, 86_400_000),
    true,
  );
  assert.equal(
    isWorkspaceSessionExpired("2026-07-14T00:00:00.001Z", now, 86_400_000),
    false,
  );
  assert.throws(() => isWorkspaceSessionExpired("invalid", now, 86_400_000));
});

test("workspace body reader maps streaming limits to stable HTTP errors", async () => {
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12"));
      controller.enqueue(new TextEncoder().encode("34"));
      controller.close();
    },
  });
  await assert.rejects(
    readWorkspaceMutationBody(
      new Request("https://policytwin.example/api/policies/x", {
        method: "POST",
        body: chunked,
        duplex: "half",
      }),
      3,
      100,
    ),
    (error) => error instanceof WorkspaceHttpError && error.code === "PAYLOAD_TOO_LARGE",
  );

  const invalidUtf8 = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([0xc3]));
      controller.close();
    },
  });
  await assert.rejects(
    readWorkspaceMutationBody(
      new Request("https://policytwin.example/api/policies/x", {
        method: "POST",
        body: invalidUtf8,
        duplex: "half",
      }),
      3,
      100,
    ),
    (error) => error instanceof WorkspaceHttpError && error.code === "INVALID_REQUEST",
  );

  let releasePull;
  const stalled = new ReadableStream({
    pull() {
      return new Promise((resolve) => {
        releasePull = resolve;
      });
    },
  });
  const read = readWorkspaceMutationBody(
    new Request("https://policytwin.example/api/policies/x", {
      method: "POST",
      body: stalled,
      duplex: "half",
    }),
    32,
    20,
  ).then(
    () => ({ code: "RESOLVED" }),
    (error) => ({ code: error.code }),
  );
  const outcome = await Promise.race([
    read,
    new Promise((resolve) => setTimeout(() => resolve({ code: "OUTER_TIMEOUT" }), 250)),
  ]);
  releasePull?.();
  assert.equal(outcome.code, "REQUEST_TIMEOUT");
});

test("workspace domain failures map to stable public HTTP errors", () => {
  assert.deepEqual(
    mapWorkspaceHttpError(
      new PolicyPersistenceError("PROJECT_CAPACITY", "sensitive capacity detail"),
    ),
    new WorkspaceHttpError(
      429,
      "WORKSPACE_CAPACITY",
      "Anonymous workspace capacity is temporarily exhausted.",
    ),
  );
  assert.deepEqual(
    mapWorkspaceHttpError(
      new PolicyWorkspaceServiceError("STALE_VERSION", "sensitive current version detail"),
    ),
    new WorkspaceHttpError(409, "STALE_VERSION", "Policy version is stale."),
  );
  const contradiction = mapWorkspaceHttpError(
    new PolicyResolutionError("GOLDEN_CONTRADICTION", "sensitive case detail"),
  );
  assert.equal(contradiction.status, 409);
  assert.equal(contradiction.code, "GOLDEN_CONTRADICTION");
  const crossBundleContradiction = mapWorkspaceHttpError({
    name: "PolicyResolutionError",
    code: "GOLDEN_CONTRADICTION",
    message: "sensitive case detail",
  });
  assert.equal(crossBundleContradiction.status, 409);
  assert.equal(crossBundleContradiction.code, "GOLDEN_CONTRADICTION");
  assert.equal(mapWorkspaceHttpError(new Error("secret path")).code, "INTERNAL_ERROR");
});

test("workspace capacity responses are generic, non-cacheable, and retry bounded", async () => {
  const response = workspaceErrorResponse(
    new PolicyPersistenceError("PROJECT_CAPACITY", "sensitive capacity detail"),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "3600");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { error: "WORKSPACE_CAPACITY" });
});
