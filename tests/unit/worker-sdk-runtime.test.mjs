import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWorkerCodexSdkOptions,
  workerCodexSdkOptions,
  workerCodexThreadOptions,
} from "../../dist/codex/worker-sdk-runtime.js";

test("worker SDK uses command-backed proxy capability auth with no provider credential", () => {
  const options = workerCodexSdkOptions();
  assert.equal(options.apiKey, undefined);
  assert.equal(options.baseUrl, undefined);
  assert.equal(options.codexPathOverride, undefined);
  assert.equal(options.config.model_provider, "policytwin_proxy");
  assert.equal(
    options.config.model_providers.policytwin_proxy.base_url,
    "https://policytwin-egress:8443/v1",
  );
  assert.equal(options.config.model_providers.policytwin_proxy.wire_api, "responses");
  assert.deepEqual(options.config.model_providers.policytwin_proxy.auth, {
    command: "/usr/local/bin/node",
    args: ["/opt/policytwin/scripts/proxy-token-helper.mjs"],
    timeout_ms: 5_000,
    refresh_interval_ms: 60_000,
  });
  assert.deepEqual(options.env, {
    HOME: "/worker-home",
    CODEX_HOME: "/worker-home/.codex",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    POLICYTWIN_PROXY_TOKEN_FILE: "/run/secrets/policytwin-proxy-token",
    CODEX_CA_CERTIFICATE: "/run/secrets/policytwin-egress-ca.pem",
  });
  const serialized = JSON.stringify(options);
  assert.doesNotMatch(serialized, /OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN/u);
  assert.equal(assertWorkerCodexSdkOptions(options), options);
  assert.throws(
    () =>
      assertWorkerCodexSdkOptions({
        ...options,
        env: { ...options.env, OPENAI_API_KEY: "must-not-pass" },
      }),
    /credential custody/u,
  );
});

test("worker thread keeps fixture tools offline and fixes the admitted model", () => {
  assert.deepEqual(workerCodexThreadOptions({ model: "gpt-5.6" }), {
    model: "gpt-5.6",
    sandboxMode: "workspace-write",
    workingDirectory: "/workspace",
    skipGitRepoCheck: true,
    modelReasoningEffort: "high",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    approvalPolicy: "never",
    additionalDirectories: [],
  });
});
