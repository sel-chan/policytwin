import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PolicyIRModelOutputSchema,
  PolicyIRStructureSchema,
  createPolicyIRJsonSchema,
  createPolicyIRModelOutputJsonSchema,
  renderPolicyIRJsonSchema,
} from "../../dist/policy-ir/zod-schema.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);

function toModelOutput(policyIR) {
  const output = structuredClone(policyIR);
  delete output.inputSchema;
  delete output.metadata;
  for (const ambiguity of output.ambiguities) {
    ambiguity.selectedOptionId ??= null;
  }
  return output;
}

function collectObjectSchemas(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectSchemas(item, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  if (value.type === "object" && typeof value.properties === "object") result.push(value);
  for (const child of Object.values(value)) collectObjectSchemas(child, result);
  return result;
}

test("renders the checked-in PolicyIR JSON Schema exactly from the shared Zod contract", async () => {
  const checkedIn = await readFile(
    new URL("../../schemas/policy-ir.v1.schema.json", import.meta.url),
    "utf8",
  );
  assert.equal(checkedIn, renderPolicyIRJsonSchema());
  assert.deepEqual(JSON.parse(checkedIn), createPolicyIRJsonSchema());
});

test("shares strict runtime structure while keeping model-owned fields separate", () => {
  assert.equal(PolicyIRStructureSchema.safeParse(recorded).success, true);

  const duplicateTrace = structuredClone(recorded);
  duplicateTrace.rules[0].sourceClauseIds.push(duplicateTrace.rules[0].sourceClauseIds[0]);
  assert.equal(PolicyIRStructureSchema.safeParse(duplicateTrace).success, false);

  const modelOutput = toModelOutput(recorded);
  assert.equal(PolicyIRModelOutputSchema.safeParse(modelOutput).success, true);
  assert.equal(PolicyIRModelOutputSchema.safeParse(recorded).success, false);
  assert.equal("metadata" in modelOutput, false);
  assert.equal("inputSchema" in modelOutput, false);

  delete modelOutput.ambiguities[0].selectedOptionId;
  assert.equal(PolicyIRModelOutputSchema.safeParse(modelOutput).success, false);
});

test("emits an OpenAI strict model-output schema without trusted server fields", () => {
  const schema = createPolicyIRModelOutputJsonSchema();
  assert.equal(schema.type, "object");
  assert.equal("metadata" in schema.properties, false);
  assert.equal("inputSchema" in schema.properties, false);

  const objectSchemas = collectObjectSchemas(schema);
  assert.ok(objectSchemas.length > 10);
  for (const objectSchema of objectSchemas) {
    assert.equal(objectSchema.additionalProperties, false);
    assert.deepEqual(
      [...objectSchema.required].sort(),
      Object.keys(objectSchema.properties).sort(),
    );
  }

  const ambiguitySchema = objectSchemas.find(
    (candidate) => "selectedOptionId" in candidate.properties,
  );
  assert.ok(ambiguitySchema);
  assert.ok(ambiguitySchema.required.includes("selectedOptionId"));
  assert.equal(
    ambiguitySchema.properties.selectedOptionId.anyOf.some((item) => item.type === "null"),
    true,
  );
});
