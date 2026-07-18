import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, runOrExit } from "./process.mjs";

const mode = process.argv[2] ?? "--check";
if (!new Set(["--check", "--write"]).has(mode)) {
  console.error("Usage: node scripts/policy-ir-schema.mjs [--check|--write]");
  process.exit(2);
}

runOrExit(process.execPath, ["scripts/build-core.mjs"]);
const { renderPolicyIRJsonSchema } = await import("../dist/policy-ir/zod-schema.js");
const expected = renderPolicyIRJsonSchema();
const schemaPath = resolve(ROOT, "schemas", "policy-ir.v1.schema.json");

if (mode === "--write") {
  writeFileSync(schemaPath, expected, "utf8");
  console.log("Wrote schemas/policy-ir.v1.schema.json from the shared Zod contract.");
  process.exit(0);
}

const actual = readFileSync(schemaPath, "utf8");
if (actual !== expected) {
  console.error(
    "schemas/policy-ir.v1.schema.json is stale. Run pnpm schema:write and review the diff.",
  );
  process.exit(1);
}

console.log("PolicyIR JSON Schema matches the shared Zod contract.");
