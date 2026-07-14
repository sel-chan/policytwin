import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [security, license, clean, container, threatModel, limitations] = await Promise.all([
  "security-report.json",
  "license-report.json",
  "clean-checkout-report.json",
  "container-report.json",
  "../../docs/threat-model.md",
  "../../docs/limitations.md",
].map((name, index) =>
  index < 4
    ? readFile(new URL(`../../artifacts/security/${name}`, import.meta.url), "utf8").then(JSON.parse)
    : readFile(new URL(name, import.meta.url), "utf8"),
));

test("offline security and clean-copy checks pass without becoming a release review", () => {
  assert.equal(security.status, "PASS");
  assert.equal(security.scope, "OFFLINE_STATIC_NOT_RELEASE_REVIEW");
  assert.deepEqual(security.findings, []);
  if (process.env.POLICYTWIN_CLEAN_CHECK === "1") {
    assert.equal(clean.status, "IN_PROGRESS");
  } else {
    assert.equal(clean.status, "PASS");
    assert.equal(clean.sourceIncludedNodeModules, false);
    assert.deepEqual(clean.credentialVariablesForwarded, []);
    assert.equal(clean.commands.every((command) => command.exitCode === 0), true);
  }
});

test("license and container remain fail-closed for explicit owner/external work", () => {
  assert.equal(license.status, "FAIL");
  assert.equal(license.failures.some((failure) => failure.includes("OWNER_DECISION_REQUIRED")), true);
  assert.equal(container.schemaVersion, "2");
  assert.equal(container.status, "FAIL");
  assert.equal(container.scope, "DYNAMIC_WEB_CONTAINER");
  assert.equal(container.workerContainerVerified, false);
  assert.equal(container.releaseReady, false);
  assert.equal(container.facts.baseImage, null);
  assert.equal(container.facts.healthStatus, null);
  assert.equal(
    container.failures.some((failure) => failure.includes("immutable Node 22.22.2 image")),
    true,
  );
});

test("threat and limitation documents preserve the hosted trust boundary", () => {
  assert.match(threatModel, /bundled trusted fixture/iu);
  assert.match(threatModel, /arbitrary shell commands/iu);
  assert.match(threatModel, /PARTIAL_OFFLINE/iu);
  assert.match(limitations, /not legal advice/iu);
  assert.match(limitations, /evaluation-only/iu);
});
