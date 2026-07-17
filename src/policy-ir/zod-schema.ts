import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { DECISIONS } from "../domain/decision.js";
import { PLAN_TYPES } from "../domain/refund.js";
import type { Predicate } from "./types.js";

const POLICY_IR_SCHEMA_ID = "https://policytwin.local/schemas/policy-ir.v1.schema.json";
const POLICY_IR_FORMAT_NAME = "policy_ir_v1";
const INPUT_FIELDS = [
  "daysSincePurchase",
  "usageBasisPoints",
  "promotionalPurchase",
  "finalSale",
  "managerApproved",
  "planType",
] as const;

const NonEmptyStringSchema = z.string().min(1).meta({ id: "nonEmptyString" });
const NonNegativeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .meta({ id: "nonNegativeInteger" });
const DecisionSchema = z.enum(DECISIONS).meta({ id: "decision" });
const InputFieldSchema = z.enum(INPUT_FIELDS).meta({ id: "inputField" });
const ScalarSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .meta({ id: "scalar" });

function uniqueNonEmptyStrings(minimum = 1) {
  return z
    .array(NonEmptyStringSchema)
    .min(minimum)
    .refine((values) => new Set(values).size === values.length, {
      message: "Values must be unique.",
    })
    .meta({ uniqueItems: true });
}

const ClauseSchema = z
  .object({
    id: NonEmptyStringSchema,
    text: NonEmptyStringSchema,
    startOffset: NonNegativeIntegerSchema,
    endOffset: z.number().int().min(1),
    normalizedText: NonEmptyStringSchema,
  })
  .strict()
  .meta({ id: "clause" });

export const PredicateStructureSchema: z.ZodType<Predicate> = z
  .lazy(() =>
    z.union([
      z
        .object({
          type: z.literal("compare"),
          field: InputFieldSchema,
          operator: z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]),
          value: ScalarSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("in"),
          field: InputFieldSchema,
          values: z.array(ScalarSchema).min(1),
        })
        .strict(),
      z
        .object({
          type: z.enum(["and", "or"]),
          children: z.array(PredicateStructureSchema).min(2),
        })
        .strict(),
      z
        .object({
          type: z.literal("not"),
          child: PredicateStructureSchema,
        })
        .strict(),
    ]),
  )
  .meta({ id: "predicate" });

const RuleSchema = z
  .object({
    id: NonEmptyStringSchema,
    sourceClauseIds: uniqueNonEmptyStrings(),
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    when: PredicateStructureSchema,
    decision: DecisionSchema,
    priority: NonNegativeIntegerSchema,
    explanationTemplate: NonEmptyStringSchema,
  })
  .strict()
  .meta({ id: "rule" });

const RefundInputSchema = z
  .object({
    daysSincePurchase: NonNegativeIntegerSchema,
    usageBasisPoints: NonNegativeIntegerSchema,
    promotionalPurchase: z.boolean(),
    finalSale: z.boolean(),
    managerApproved: z.boolean(),
    planType: z.enum(PLAN_TYPES),
  })
  .strict()
  .meta({ id: "refundInput" });

const ExampleImpactSchema = z
  .object({
    input: RefundInputSchema,
    result: DecisionSchema,
  })
  .strict()
  .meta({ id: "exampleImpact" });

const PolicyPatchSchema = z.union([
  z
    .object({
      op: z.literal("SET_NORMALIZATION"),
      field: z.literal("purchaseDayIndex"),
      value: z.union([z.literal(0), z.literal(1)]),
    })
    .strict(),
  z
    .object({
      op: z.literal("SET_NORMALIZATION"),
      field: z.literal("usageMeasuredAt"),
      value: z.enum(["REQUEST_TIME", "DECISION_TIME"]),
    })
    .strict(),
  z
    .object({
      op: z.literal("SET_BOUNDARY_OPERATOR"),
      ruleId: NonEmptyStringSchema,
      field: z.enum(["daysSincePurchase", "usageBasisPoints"]),
      value: z.enum(["lt", "lte", "gt", "gte"]),
    })
    .strict(),
  z
    .object({
      op: z.literal("SET_RULE_DECISION"),
      ruleId: NonEmptyStringSchema,
      value: DecisionSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("SET_PRECEDENCE"),
      higherRuleId: NonEmptyStringSchema,
      lowerRuleId: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("SET_DEFAULT_DECISION"),
      value: DecisionSchema,
    })
    .strict(),
]).meta({ id: "policyPatch" });

const AmbiguityOptionSchema = z
  .object({
    id: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    policyPatch: PolicyPatchSchema,
    exampleImpacts: z.array(ExampleImpactSchema).min(1),
  })
  .strict()
  .meta({ id: "ambiguityOption" });

const AmbiguityBaseShape = {
  id: NonEmptyStringSchema,
  sourceClauseIds: uniqueNonEmptyStrings(),
  category: z.enum([
    "BOUNDARY",
    "PRECEDENCE",
    "DEFAULT",
    "MEASUREMENT",
    "MISSING_OUTCOME",
    "OTHER",
  ]),
  question: NonEmptyStringSchema,
  rationale: NonEmptyStringSchema,
  options: z.array(AmbiguityOptionSchema).min(2),
  status: z.enum(["OPEN", "RESOLVED"]),
} as const;

const RuntimeAmbiguitySchema = z
  .object({
    ...AmbiguityBaseShape,
    selectedOptionId: NonEmptyStringSchema.optional(),
  })
  .strict()
  .meta({ id: "ambiguity" });

const ModelOutputAmbiguitySchema = z
  .object({
    ...AmbiguityBaseShape,
    selectedOptionId: NonEmptyStringSchema.nullable(),
  })
  .strict()
  .meta({ id: "modelOutputAmbiguity" });

const ModelOwnedShape = {
  id: NonEmptyStringSchema,
  policyId: NonEmptyStringSchema,
  version: z.number().int().min(1),
  schemaVersion: z.literal("1"),
  domain: z.literal("saas_refund"),
  clauses: z.array(ClauseSchema).min(1),
  rules: z.array(RuleSchema).min(1),
  defaultDecision: DecisionSchema,
  normalization: z
    .object({
      purchaseDayIndex: z.union([z.literal(0), z.literal(1)]),
      usageMeasuredAt: z.enum(["REQUEST_TIME", "DECISION_TIME"]),
    })
    .strict(),
} as const;

const MetadataBaseShape = {
  model: NonEmptyStringSchema,
  promptVersion: NonEmptyStringSchema,
  schemaVersion: z.literal("1"),
  createdAt: z.iso.datetime({ offset: true }),
} as const;

const MetadataSchema = z.discriminatedUnion("source", [
  z
    .object({
      ...MetadataBaseShape,
      source: z.literal("LIVE_RESPONSE"),
      requestId: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      ...MetadataBaseShape,
      source: z.literal("RECORDED_FIXTURE"),
      requestId: NonEmptyStringSchema.optional(),
    })
    .strict(),
]).meta({ id: "metadata" });

export const PolicyIRModelOutputSchema = z
  .object({
    ...ModelOwnedShape,
    ambiguities: z.array(ModelOutputAmbiguitySchema),
  })
  .strict();

export const PolicyIRStructureSchema = z
  .object({
    ...ModelOwnedShape,
    ambiguities: z.array(RuntimeAmbiguitySchema),
    inputSchema: z.record(z.string(), z.unknown()),
    metadata: MetadataSchema,
  })
  .strict();

export function createPolicyIRModelOutputTextFormat() {
  return zodTextFormat(PolicyIRModelOutputSchema, POLICY_IR_FORMAT_NAME);
}

export function createPolicyIRModelOutputJsonSchema(): Record<string, unknown> {
  return structuredClone(
    createPolicyIRModelOutputTextFormat().schema as Record<string, unknown>,
  );
}

export function createPolicyIRJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(PolicyIRStructureSchema, {
    target: "draft-2020-12",
    cycles: "ref",
    reused: "ref",
  }) as Record<string, unknown>;
  const { $schema: _generatedSchema, ...body } = generated;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: POLICY_IR_SCHEMA_ID,
    title: "PolicyIR v1",
    ...body,
  };
}

export function renderPolicyIRJsonSchema(): string {
  return `${JSON.stringify(createPolicyIRJsonSchema(), null, 2)}\n`;
}
