import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { parsePolicyCases } from "../domain/case-validation.js";
import { REFUND_INPUT_SCHEMA_V1 } from "../domain/refund-schema.js";
import { segmentPolicyClauses } from "../policy-ir/clauses.js";
import { findGoldenContradictions } from "../policy-ir/evaluate.js";
import { parsePolicyIR, PolicyIRValidationError } from "../policy-ir/validate.js";
import {
  createPolicyIRModelOutputTextFormat,
  PolicyIRModelOutputSchema,
} from "../policy-ir/zod-schema.js";
import type { PolicyIR } from "../policy-ir/types.js";

const PROMPT_VERSION = "interpreter.v1" as const;
const SCHEMA_VERSION = "1" as const;
const DEFAULT_MODEL = "gpt-5.6";
const MAX_ATTEMPTS = 2;
const MAX_OUTPUT_TOKENS = 12_000;

const InterpreterInputSchema = z
  .object({
    policyId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
    version: z.number().int().positive(),
    sourceText: z.string().min(1).max(50_000),
    goldenCases: z.array(z.unknown()).min(1).max(500),
  })
  .strict();

const ResponseEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    output_text: z.string(),
  })
  .passthrough();

export interface PolicyInterpretationInput {
  policyId: string;
  version: number;
  sourceText: string;
  goldenCases: unknown[];
}

export interface PolicyInterpretationEvidence {
  schemaVersion: "1";
  source: "LIVE_RESPONSE";
  model: string;
  responseId: string;
  promptVersion: typeof PROMPT_VERSION;
  policySchemaVersion: typeof SCHEMA_VERSION;
  attemptCount: number;
  startedAt: string;
  completedAt: string;
}

export interface PolicyInterpretationResult {
  policyIR: PolicyIR;
  evidence: PolicyInterpretationEvidence;
}

export interface ResponsesClientPort {
  responses: {
    create(
      parameters: Record<string, unknown>,
      requestOptions?: { signal?: AbortSignal },
    ): Promise<unknown>;
  };
}

export class PolicyInterpreterError extends Error {
  constructor(
    readonly code: "AUTH_REQUIRED" | "INVALID_INPUT" | "API_ERROR" | "OUTPUT_INVALID",
    message: string,
    readonly attempts = 0,
  ) {
    super(message);
    this.name = "PolicyInterpreterError";
  }
}

interface InterpreterOptions {
  model?: string;
  now?: () => Date;
  signal?: AbortSignal;
}

function parseInterpreterInput(rawInput: unknown): PolicyInterpretationInput {
  const parsedInput = InterpreterInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new PolicyInterpreterError("INVALID_INPUT", parsedInput.error.message);
  }
  try {
    parsePolicyCases(parsedInput.data.goldenCases);
  } catch (error) {
    throw new PolicyInterpreterError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Golden cases are invalid.",
    );
  }
  return parsedInput.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadPrompt(): string {
  return readFileSync(resolve(process.cwd(), "prompts", "interpreter.v1.md"), "utf8");
}

function validateSourceTraceability(policy: PolicyIR, sourceText: string): void {
  const expected = segmentPolicyClauses(sourceText);
  if (policy.clauses.length !== expected.length) {
    throw new PolicyInterpreterError(
      "OUTPUT_INVALID",
      "PolicyIR clauses do not cover the complete source text.",
    );
  }
  for (const [index, clause] of policy.clauses.entries()) {
    const sourceClause = expected[index];
    if (
      sourceClause === undefined ||
      clause.id !== sourceClause.id ||
      clause.text !== sourceClause.text ||
      clause.startOffset !== sourceClause.startOffset ||
      clause.endOffset !== sourceClause.endOffset ||
      clause.normalizedText !== sourceClause.normalizedText
    ) {
      throw new PolicyInterpreterError(
        "OUTPUT_INVALID",
        `Clause ${clause.id} does not exactly match source clause ${index + 1}.`,
      );
    }
  }
}

function sanitizeModelValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeModelValue(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !(key === "selectedOptionId" && item === null))
      .map(([key, item]) => [key, sanitizeModelValue(item)]),
  );
}

function withTrustedMetadata(
  value: unknown,
  model: string,
  responseId: string,
  createdAt: string,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return {
    ...(sanitizeModelValue(value) as Record<string, unknown>),
    inputSchema: REFUND_INPUT_SCHEMA_V1,
    metadata: {
      model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt,
      source: "LIVE_RESPONSE",
      requestId: responseId,
    },
  };
}

function requestParameters(
  input: PolicyInterpretationInput,
  model: string,
): Record<string, unknown> {
  const clauses = segmentPolicyClauses(input.sourceText);
  const goldenCases = parsePolicyCases(input.goldenCases);
  return {
    model,
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    instructions: loadPrompt(),
    input: JSON.stringify({
      policyId: input.policyId,
      version: input.version,
      policyText: input.sourceText,
      clauses,
      goldenCases,
    }),
    text: {
      format: createPolicyIRModelOutputTextFormat(),
    },
    metadata: {
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    },
  };
}

export async function interpretPolicyWithClient(
  client: ResponsesClientPort,
  rawInput: unknown,
  options: InterpreterOptions = {},
): Promise<PolicyInterpretationResult> {
  const input = parseInterpreterInput(rawInput);

  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let lastFailure = "Structured output was not valid PolicyIR.";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: unknown;
    try {
      response = await client.responses.create(
        requestParameters(input, model),
        options.signal ? { signal: options.signal } : undefined,
      );
    } catch (error) {
      throw new PolicyInterpreterError(
        "API_ERROR",
        error instanceof Error ? error.message : "Responses API request failed.",
        attempt,
      );
    }
    const parsedEnvelope = ResponseEnvelopeSchema.safeParse(response);
    if (!parsedEnvelope.success) {
      lastFailure = "Responses API output envelope was incomplete.";
      continue;
    }
    const envelope: z.infer<typeof ResponseEnvelopeSchema> = parsedEnvelope.data;

    try {
      const completedAt = now().toISOString();
      const modelOutput = PolicyIRModelOutputSchema.safeParse(
        JSON.parse(envelope.output_text) as unknown,
      );
      if (!modelOutput.success) {
        throw new PolicyInterpreterError(
          "OUTPUT_INVALID",
          `Structured model output failed PolicyIR admission: ${modelOutput.error.message}`,
        );
      }
      const value = withTrustedMetadata(
        modelOutput.data,
        model,
        envelope.id,
        completedAt,
      );
      const policyIR = parsePolicyIR(value);
      if (policyIR.policyId !== input.policyId || policyIR.version !== input.version) {
        throw new PolicyInterpreterError(
          "OUTPUT_INVALID",
          "PolicyIR identity does not match the interpretation request.",
        );
      }
      validateSourceTraceability(policyIR, input.sourceText);
      const contradictions = findGoldenContradictions(
        policyIR,
        parsePolicyCases(input.goldenCases),
      );
      if (contradictions.length > 0) {
        throw new PolicyInterpreterError(
          "OUTPUT_INVALID",
          `PolicyIR contradicts authoritative golden cases: ${contradictions
            .map((item) => item.caseId)
            .join(", ")}.`,
        );
      }
      return {
        policyIR,
        evidence: {
          schemaVersion: "1",
          source: "LIVE_RESPONSE",
          model,
          responseId: envelope.id,
          promptVersion: PROMPT_VERSION,
          policySchemaVersion: SCHEMA_VERSION,
          attemptCount: attempt,
          startedAt,
          completedAt,
        },
      };
    } catch (error) {
      lastFailure =
        error instanceof PolicyIRValidationError || error instanceof PolicyInterpreterError
          ? error.message
          : "Responses API output was not valid JSON.";
    }
  }

  throw new PolicyInterpreterError("OUTPUT_INVALID", lastFailure, MAX_ATTEMPTS);
}

export async function interpretPolicyWithOpenAI(
  input: PolicyInterpretationInput,
  options: InterpreterOptions = {},
): Promise<PolicyInterpretationResult> {
  const parsedInput = parseInterpreterInput(input);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new PolicyInterpreterError(
      "AUTH_REQUIRED",
      "OPENAI_API_KEY is required for a fresh GPT-5.6 interpretation.",
    );
  }
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
  return interpretPolicyWithClient(
    {
      responses: {
        create: (parameters, requestOptions) =>
          client.responses.create(parameters as never, requestOptions as never),
      },
    },
    parsedInput,
    options,
  );
}
