import { executable, runOrExit } from "./process.mjs";

const suites = {
  unit: "tests/unit/scaffold.test.mjs",
  integration: "tests/integration/scaffold.integration.test.mjs",
  eval: "evals/scaffold.eval.test.mjs",
};

const suite = process.argv[2];
const testFile = suites[suite];

if (!testFile) {
  console.error(`Unknown test suite: ${suite ?? "<missing>"}`);
  process.exit(2);
}

runOrExit(process.execPath, ["scripts/build.mjs"]);
runOrExit(process.execPath, ["--test", testFile]);
