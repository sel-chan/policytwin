import { executable, runOrExit } from "./process.mjs";

const suites = {
  unit: [
    "tests/unit/process-executable.test.mjs",
    "tests/unit/scaffold.test.mjs",
    "tests/unit/container-contract.test.mjs",
    "tests/unit/architecture-asset.test.mjs",
    "tests/unit/refund-domain.test.mjs",
    "tests/unit/clause-segmentation.test.mjs",
    "tests/unit/policy-ir-validation.test.mjs",
    "tests/unit/policy-resolution.test.mjs",
    "tests/unit/policy-state.test.mjs",
    "tests/unit/policy-persistence.test.mjs",
    "tests/unit/policy-workspace-service.test.mjs",
    "tests/unit/rego-compiler.test.mjs",
    "tests/unit/case-generation.test.mjs",
    "tests/unit/mutation-engine.test.mjs",
    "tests/unit/codex-worker-contract.test.mjs",
    "tests/unit/codex-sdk-adapter.test.mjs",
    "tests/unit/worker-rpc.test.mjs",
    "tests/unit/worker-runtime-contract.test.mjs",
    "tests/unit/cpu-budget-contract.test.mjs",
    "tests/unit/live-linux-cgroup-cpu-proof.test.mjs",
    "tests/unit/live-linux-cgroup-cpu-evidence-v2.test.mjs",
    "tests/unit/live-linux-cgroup-cpu-adapter.test.mjs",
    "tests/unit/linux-start-barrier.test.mjs",
    "tests/unit/live-linux-cgroup-cpu-dedicated-lifecycle.test.mjs",
    "tests/unit/live-linux-docker-role-plan.test.mjs",
    "tests/unit/live-linux-docker-owned-container.test.mjs",
    "tests/unit/live-linux-docker-cgroup-system-adapter.test.mjs",
    "tests/unit/linux-cgroup-helper-protocol.test.mjs",
    "tests/unit/linux-cgroup-cpu-evidence-producer.test.mjs",
    "tests/unit/linux-cgroup-observer.test.mjs",
    "tests/unit/worker-os-lifecycle.test.mjs",
    "tests/unit/supervisor-docker-driver.test.mjs",
    "tests/unit/pinned-docker-cli.test.mjs",
    "tests/unit/live-gate-contract.test.mjs",
    "tests/unit/worker-sdk-runtime.test.mjs",
    "tests/unit/openai-egress-contract.test.mjs",
    "tests/unit/impact-traceability.test.mjs",
    "tests/unit/submission-validation.test.mjs",
    "tests/unit/openai-interpreter.test.mjs",
    "tests/unit/workspace-http.test.mjs",
  ],
  integration: [
    "tests/integration/scaffold.integration.test.mjs",
    "tests/integration/refund-fixture.integration.test.mjs",
    "tests/integration/differential-runner.integration.test.mjs",
    "tests/integration/repair-workspace.integration.test.mjs",
    "tests/integration/worker-rpc-mtls.integration.test.mjs",
    "tests/integration/worker-rpc-replay.integration.test.mjs",
    "tests/integration/openai-egress-proxy.integration.test.mjs",
    "tests/integration/evidence-package.integration.test.mjs",
    "tests/integration/policy-persistence.integration.test.mjs",
    "tests/integration/opa-runner.integration.test.mjs",
  ],
  eval: [
    "evals/scaffold.eval.test.mjs",
    "evals/interpreter/recorded-interpreter.eval.test.mjs",
    "evals/cases/offline-m5.eval.test.mjs",
    "evals/differential/offline-m6.eval.test.mjs",
    "evals/codex/offline-m7.eval.test.mjs",
    "evals/evidence/offline-m8.eval.test.mjs",
    "evals/security/offline-m9.eval.test.mjs",
    "evals/submission/offline-m10.eval.test.mjs",
  ],
};

const suite = process.argv[2];
const testFiles = suites[suite];

if (!testFiles) {
  console.error(`Unknown test suite: ${suite ?? "<missing>"}`);
  process.exit(2);
}

runOrExit(process.execPath, ["scripts/build-core.mjs"]);
if (suite === "integration") {
  runOrExit(process.execPath, ["scripts/build-fixtures.mjs"]);
}
const testArguments = ["--test"];
if (suite === "integration") {
  // Integration tests intentionally rebuild shared dist/fixture/evidence outputs.
  // Serial execution prevents one test from replacing those outputs while another imports them.
  testArguments.push("--test-concurrency=1", "--test-reporter=spec");
}
runOrExit(process.execPath, [...testArguments, ...testFiles]);
