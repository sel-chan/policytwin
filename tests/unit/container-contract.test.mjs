import assert from "node:assert/strict";
import test from "node:test";
import { inspectStaticContainerContract } from "../../scripts/container-check.mjs";

test("static web-container contract is fail-closed and excludes the live Codex worker", () => {
  const report = inspectStaticContainerContract();
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");
  assert.equal(report.scope, "STATIC_WEB_CONTAINER");
  assert.equal(report.baseImagePinned, false);
  assert.equal(report.dynamicContainerVerified, false);
  assert.equal(report.webContainerIncludesLiveCodexWorker, false);
  assert.equal(report.workerContainerStatus, "NOT_IMPLEMENTED");
  assert.equal(report.releaseReady, false);
});
