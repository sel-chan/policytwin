import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  interpretPolicyWithClient,
  interpretPolicyWithOpenAI,
  PolicyInterpreterError,
} from "../../dist/openai/interpreter.js";
import { createPolicyIRModelOutputJsonSchema } from "../../dist/policy-ir/zod-schema.js";
import { canonicalizeKnownRefundAmbiguities } from "../../dist/policy-ir/canonicalize-ambiguities.js";
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

function completedResponse(id, policyIR = recorded) {
  const outputText = JSON.stringify(modelOutput(policyIR));
  return {
    id,
    status: "completed",
    error: null,
    incomplete_details: null,
    output_text: outputText,
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: outputText }],
      },
    ],
  };
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
          return completedResponse("resp_live_123");
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

test("canonicalizes known ambiguity presentation from closed patch meaning", async () => {
  const paraphrased = structuredClone(recorded);
  for (const [index, ambiguity] of paraphrased.ambiguities.entries()) {
    ambiguity.id = `model-ambiguity-${index}`;
    ambiguity.question = index === 0
      ? "Is exactly day 14 eligible for a refund?"
      : `Equivalent model question ${index}`;
    ambiguity.rationale = `Equivalent model rationale ${index}`;
    for (const [optionIndex, option] of ambiguity.options.entries()) {
      option.id = `model-option-${index}-${optionIndex}`;
      option.label = `Equivalent option ${optionIndex}`;
      option.description = `Equivalent description ${optionIndex}`;
      option.exampleImpacts[0].result = option.exampleImpacts[0].result === "ALLOW"
        ? "DENY"
        : "ALLOW";
    }
    ambiguity.options.reverse();
  }

  const result = await interpretPolicyWithClient(
    {
      responses: {
        async create() {
          return completedResponse("resp_canonical_ambiguities", paraphrased);
        },
      },
    },
    input(),
    { model: "gpt-5.6", now: clock() },
  );

  assert.deepEqual(result.policyIR.ambiguities, recorded.ambiguities);
});

test("limits known ambiguity canonicalization to the exact trusted seeded input", () => {
  const unrelatedPolicy = structuredClone(recorded);
  unrelatedPolicy.policyId = "policy-other-refund";
  unrelatedPolicy.ambiguities[0].question = "A valid question belonging to another policy?";
  assert.deepEqual(
    canonicalizeKnownRefundAmbiguities(unrelatedPolicy, {
      policyId: unrelatedPolicy.policyId,
      version: unrelatedPolicy.version,
      sourceText,
    }),
    unrelatedPolicy,
  );

  const changedSourcePolicy = structuredClone(recorded);
  changedSourcePolicy.ambiguities[0].question = "A valid question for changed source text?";
  assert.deepEqual(
    canonicalizeKnownRefundAmbiguities(changedSourcePolicy, {
      policyId: changedSourcePolicy.policyId,
      version: changedSourcePolicy.version,
      sourceText: `${sourceText}\nRefunds may also be granted after support review.`,
    }),
    changedSourcePolicy,
  );

  const mismatchedClausePolicy = structuredClone(recorded);
  mismatchedClausePolicy.clauses[0].text = "A model-supplied clause that does not match the source.";
  mismatchedClausePolicy.ambiguities[0].question = "A question tied to a false clause?";
  assert.deepEqual(
    canonicalizeKnownRefundAmbiguities(mismatchedClausePolicy, {
      policyId: mismatchedClausePolicy.policyId,
      version: mismatchedClausePolicy.version,
      sourceText,
    }),
    mismatchedClausePolicy,
  );

  const wrongTracePolicy = structuredClone(recorded);
  wrongTracePolicy.ambiguities[0].sourceClauseIds = ["clause-68b8918e"];
  wrongTracePolicy.ambiguities[0].question = "A question tied to the wrong source clause?";
  const partiallyCanonicalized = canonicalizeKnownRefundAmbiguities(wrongTracePolicy, {
    policyId: wrongTracePolicy.policyId,
    version: wrongTracePolicy.version,
    sourceText,
  });
  assert.equal(
    partiallyCanonicalized.ambiguities[0].question,
    wrongTracePolicy.ambiguities[0].question,
  );
  assert.deepEqual(partiallyCanonicalized.ambiguities.slice(1), recorded.ambiguities.slice(1));
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

test("does not retry explicit refusal, incomplete, failed, or nonterminal Responses outcomes", async (t) => {
  const outcomes = [
    {
      name: "model refusal",
      code: "OUTPUT_REFUSED",
      response: {
        id: "resp_refusal",
        status: "completed",
        error: null,
        incomplete_details: null,
        output_text: "",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "Policy interpretation declined." }],
          },
        ],
      },
    },
    {
      name: "maximum output tokens",
      code: "OUTPUT_INCOMPLETE",
      response: {
        id: "resp_tokens",
        status: "incomplete",
        error: null,
        incomplete_details: { reason: "max_output_tokens" },
        output_text: "{",
        output: [],
      },
    },
    {
      name: "content filter",
      code: "OUTPUT_INCOMPLETE",
      response: {
        id: "resp_filter",
        status: "incomplete",
        error: null,
        incomplete_details: { reason: "content_filter" },
        output_text: "",
        output: [],
      },
    },
    {
      name: "failed response",
      code: "API_ERROR",
      response: {
        id: "resp_failed",
        status: "failed",
        error: { code: "server_error", message: "upstream failed" },
        incomplete_details: null,
        output_text: "",
        output: [],
      },
    },
    {
      name: "queued response",
      code: "API_ERROR",
      response: {
        id: "resp_queued",
        status: "queued",
        error: null,
        incomplete_details: null,
        output_text: "",
        output: [],
      },
    },
  ];

  for (const outcome of outcomes) {
    await t.test(outcome.name, async () => {
      let calls = 0;
      await assert.rejects(
        interpretPolicyWithClient(
          {
            responses: {
              async create() {
                calls += 1;
                return outcome.response;
              },
            },
          },
          input(),
        ),
        (error) =>
          error instanceof PolicyInterpreterError &&
          error.code === outcome.code &&
          error.attempts === 1,
      );
      assert.equal(calls, 1);
    });
  }
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

  let inconsistentCalls = 0;
  await assert.rejects(
    interpretPolicyWithClient(
      {
        responses: {
          async create() {
            inconsistentCalls += 1;
            const response = completedResponse("resp_inconsistent");
            response.output[0].content[0].text = "{}";
            return response;
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
  assert.equal(inconsistentCalls, 2);
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
