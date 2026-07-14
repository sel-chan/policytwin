import { executable, runOrExit } from "./process.mjs";

const suites = {
  unit: [
    "tests/unit/scaffold.test.mjs",
    "tests/unit/refund-domain.test.mjs",
    "tests/unit/clause-segmentation.test.mjs",
    "tests/unit/policy-ir-validation.test.mjs",
    "tests/unit/policy-resolution.test.mjs",
    "tests/unit/policy-state.test.mjs",
  ],
  integration: [
    "tests/integration/scaffold.integration.test.mjs",
    "tests/integration/refund-fixture.integration.test.mjs",
  ],
  eval: ["evals/scaffold.eval.test.mjs", "evals/interpreter/recorded-interpreter.eval.test.mjs"],
};

const suite = process.argv[2];
const testFiles = suites[suite];

if (!testFiles) {
  console.error(`Unknown test suite: ${suite ?? "<missing>"}`);
  process.exit(2);
}

runOrExit(process.execPath, ["scripts/build.mjs"]);
if (suite === "integration") {
  runOrExit(process.execPath, ["scripts/build-fixtures.mjs"]);
}
runOrExit(process.execPath, ["--test", ...testFiles]);
