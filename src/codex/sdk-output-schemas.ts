const RELATIVE_PATH_SCHEMA = {
  type: "string",
  minLength: 1,
} as const;

const PATH_ARRAY_SCHEMA = {
  type: "array",
  items: RELATIVE_PATH_SCHEMA,
} as const;

const STRING_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string", minLength: 1 },
} as const;

const COMMAND_ARRAY_SCHEMA = {
  type: "array",
  minItems: 1,
  items: { enum: ["fixture-typecheck", "fixture-test"] },
} as const;

const LOCATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["file", "lineStart", "lineEnd", "symbol", "reason"],
  properties: {
    file: RELATIVE_PATH_SCHEMA,
    lineStart: { type: "integer", minimum: 1 },
    lineEnd: { type: "integer", minimum: 1 },
    symbol: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 },
  },
} as const;

export const CARTOGRAPHY_MODEL_OUTPUT_KEYS = [
  "relevantFiles",
  "entryPoints",
  "policyLogicLocations",
  "dataFlow",
  "testFiles",
  "risks",
  "proposedFilesToChange",
  "verificationCommandIds",
] as const;

export const CARTOGRAPHY_MODEL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: CARTOGRAPHY_MODEL_OUTPUT_KEYS,
  properties: {
    relevantFiles: { ...PATH_ARRAY_SCHEMA, minItems: 1 },
    entryPoints: { type: "array", minItems: 1, items: LOCATION_SCHEMA },
    policyLogicLocations: { type: "array", minItems: 1, items: LOCATION_SCHEMA },
    dataFlow: { type: "array", minItems: 1, items: LOCATION_SCHEMA },
    testFiles: { ...PATH_ARRAY_SCHEMA, minItems: 1 },
    risks: STRING_ARRAY_SCHEMA,
    proposedFilesToChange: { ...PATH_ARRAY_SCHEMA, minItems: 1 },
    verificationCommandIds: COMMAND_ARRAY_SCHEMA,
  },
} as const;

export const REPAIR_MODEL_OUTPUT_KEYS = [
  "summary",
  "rationale",
  "remainingRisks",
  "verificationCommandIds",
] as const;

export const REPAIR_MODEL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: REPAIR_MODEL_OUTPUT_KEYS,
  properties: {
    summary: { type: "string", minLength: 1 },
    rationale: STRING_ARRAY_SCHEMA,
    remainingRisks: STRING_ARRAY_SCHEMA,
    verificationCommandIds: COMMAND_ARRAY_SCHEMA,
  },
} as const;

const REVIEW_FINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "severity", "title", "description", "relatedFiles"],
  properties: {
    id: { type: "string", minLength: 1 },
    severity: { enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    title: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    relatedFiles: PATH_ARRAY_SCHEMA,
  },
} as const;

export const REVIEW_MODEL_OUTPUT_KEYS = ["verdict", "summary", "findings"] as const;

export const REVIEW_MODEL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: REVIEW_MODEL_OUTPUT_KEYS,
  properties: {
    verdict: { enum: ["APPROVE", "BLOCK"] },
    summary: { type: "string", minLength: 1 },
    findings: { type: "array", items: REVIEW_FINDING_SCHEMA },
  },
} as const;
