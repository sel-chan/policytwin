import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  interpretPolicyWithClient,
  interpretPolicyWithOpenAI,
  PolicyInterpreterError,
} from "../../dist/openai/interpreter.js";
import { createPolicyIRModelOutputJsonSchema } from "../../dist/policy-ir/zod-schema.js";
import {
  readUtf8BodyLimited,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
  SingleRunGate,
} from "../../dist/openai/request-guard.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const sourceText = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const goldenCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/refund-demo/cases/golden-cases.json", import.meta.url),
    "utf8",
  ),
);

function input(overrides = {}) {
  return {
    policyId: recorded.policyId,
    version: recorded.version,
    sourceText,
    goldenCases,
    ...overrides,
  };
}

function modelOutput(policyIR = recorded) {
  const output = structuredClone(policyIR);
  delete output.inputSchema;
  delete output.metadata;
  for (const ambiguity of output.ambiguities) {
    ambiguity.selectedOptionId ??= null;
  }
  return output;
}

function clock() {
  const values = [
    new Date("2026-07-14T07:00:00.000Z"),
    new Date("2026-07-14T07:00:01.000Z"),
  ];
  return () => values.shift() ?? new Date("2026-07-14T07:00:02.000Z");
}

test("streams request bodies under a byte limit and reserves one run before awaits", async () => {
  const accepted = new Request("http://policytwin.local/api/interpret", {
    method: "POST",
    body: '{"policy":"ok"}',
  });
  assert.equal(await readUtf8BodyLimited(accepted, 32), '{"policy":"ok"}');

  const oversized = new Request("http://policytwin.local/api/interpret", {
    method: "POST",
    body: "éé",
  });
  await assert.rejects(
    readUtf8BodyLimited(oversized, 3),
    (error) => error instanceof RequestBodyTooLargeError,
  );

  const chunkedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12"));
      controller.enqueue(new TextEncoder().encode("34"));
      controller.close();
    },
  });
  await assert.rejects(
    readUtf8BodyLimited(
      new Request("http://policytwin.local/api/interpret", {
        method: "POST",
        body: chunkedBody,
        duplex: "half",
      }),
      3,
    ),
    (error) => error instanceof RequestBodyTooLargeError,
  );

  const invalidUtf8Body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([0xc3]));
      controller.close();
    },
  });
  await assert.rejects(
    readUtf8BodyLimited(
      new Request("http://policytwin.local/api/interpret", {
        method: "POST",
        body: invalidUtf8Body,
        duplex: "half",
      }),
      3,
    ),
    TypeError,
  );

  const gate = new SingleRunGate();
  const release = gate.tryAcquire();
  assert.equal(typeof release, "function");
  assert.equal(gate.tryAcquire(), null);
  release();
  assert.equal(typeof gate.tryAcquire(), "function");
  assert.throws(() => release(), /more than once/u);
});

test("bounds a stalled request body without waiting for the pending stream read", async () => {
  let releasePull;
  let cancelled = false;
  const stalledBody = new ReadableStream({
    pull() {
      return new Promise((resolve) => {
        releasePull = resolve;
      });
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://policytwin.local/api/interpret", {
    method: "POST",
    body: stalledBody,
    duplex: "half",
  });
  const bodyRead = readUtf8BodyLimited(request, 32, 20).then(
    () => ({ type: "resolved" }),
    (error) => ({ type: "rejected", error }),
  );
  const outcome = await Promise.race([
    bodyRead,
    new Promise((resolve) =>
      setTimeout(() => resolve({ type: "outer-timeout" }), 250),
    ),
  ]);
  releasePull?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outcome.type, "rejected");
  assert.ok(outcome.error instanceof RequestBodyTimeoutError);
  assert.equal(cancelled, true);
});

test("builds a strict GPT-5.6 Responses request and trusts only server provenance", async () => {
  const requests = [];
  const result = await interpretPolicyWithClient(
    {
      responses: {
        async create(parameters) {
          requests.push(parameters);
          return { id: "resp_live_123", output_text: JSON.stringify(modelOutput()) };
        },
      },
    },
    input(),
    { model: "gpt-5.6", now: clock() },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "gpt-5.6");
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].max_output_tokens, 12_000);
  assert.equal(requests[0].text.format.type, "json_schema");
  assert.equal(requests[0].text.format.name, "policy_ir_v1");
  assert.equal(requests[0].text.format.strict, true);
  assert.deepEqual(requests[0].text.format.schema, createPolicyIRModelOutputJsonSchema());
  assert.equal("apiKey" in requests[0], false);
  assert.equal(result.policyIR.metadata.source, "LIVE_RESPONSE");
  assert.equal(result.policyIR.metadata.requestId, "resp_live_123");
  assert.equal(result.policyIR.metadata.model, "gpt-5.6");
  assert.equal(result.evidence.responseId, "resp_live_123");
  assert.equal(result.evidence.attemptCount, 1);
});

test("retries one recoverable structured-output failure and then succeeds", async () => {
  let calls = 0;
  const result = await interpretPolicyWithClient(
    {
      responses: {
        async create() {
          calls += 1;
          return calls === 1
            ? { id: "resp_bad", output_text: "not-json" }
            : { id: "resp_good", output_text: JSON.stringify(modelOutput()) };
        },
      },
    },
    input(),
    { now: clock() },
  );
  assert.equal(calls, 2);
  assert.equal(result.evidence.attemptCount, 2);
  assert.equal(result.evidence.responseId, "resp_good");
});

test("rejects invalid request shapes and fails closed after two bad outputs", async () => {
  await assert.rejects(
    interpretPolicyWithClient(
      { responses: { async create() { return {}; } } },
      input({ unexpected: true }),
    ),
    (error) => error instanceof PolicyInterpreterError && error.code === "INVALID_INPUT",
  );

  await assert.rejects(
    interpretPolicyWithClient(
      {
        responses: {
          async create() {
            return { id: "resp_bad", output_text: "{}" };
          },
        },
      },
      input(),
    ),
    (error) =>
      error instanceof PolicyInterpreterError &&
      error.code === "OUTPUT_INVALID" &&
      error.attempts === 2,
  );
});

test("validates input before reporting missing live credentials", async () => {
  await assert.rejects(
    interpretPolicyWithOpenAI(input({ unexpected: true })),
    (error) => error instanceof PolicyInterpreterError && error.code === "INVALID_INPUT",
  );
});

test("rejects incomplete source traceability and mismatched request identity", async () => {
  const incomplete = structuredClone(recorded);
  incomplete.clauses = incomplete.clauses.slice(1);
  await assert.rejects(
    interpretPolicyWithClient(
      {
        responses: {
          async create() {
            return { id: "resp_incomplete", output_text: JSON.stringify(modelOutput(incomplete)) };
          },
        },
      },
      input(),
    ),
    (error) => error instanceof PolicyInterpreterError && error.code === "OUTPUT_INVALID",
  );

  const wrongIdentity = structuredClone(recorded);
  wrongIdentity.policyId = "policy-other";
  await assert.rejects(
    interpretPolicyWithClient(
      {
        responses: {
          async create() {
            return { id: "resp_identity", output_text: JSON.stringify(modelOutput(wrongIdentity)) };
          },
        },
      },
      input(),
    ),
    (error) => error instanceof PolicyInterpreterError && error.code === "OUTPUT_INVALID",
  );
});

test("rejects a schema-valid interpretation that contradicts golden cases", async () => {
  const contradictory = structuredClone(recorded);
  const finalSaleRule = contradictory.rules.find((rule) => rule.id === "final-sale-deny");
  finalSaleRule.decision = "ALLOW";

  await assert.rejects(
    interpretPolicyWithClient(
      {
        responses: {
          async create() {
            return {
              id: "resp_contradiction",
              output_text: JSON.stringify(modelOutput(contradictory)),
            };
          },
        },
      },
      input(),
    ),
    (error) =>
      error instanceof PolicyInterpreterError &&
      error.code === "OUTPUT_INVALID" &&
      /golden cases/u.test(error.message),
  );
});
