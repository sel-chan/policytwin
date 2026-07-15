import type { CodexOptions, ThreadOptions } from "@openai/codex-sdk";
import type { WorkerRpcRequest } from "./worker-rpc-contract.js";

export const WORKER_CODEX_HOME = "/worker-home/.codex" as const;
export const WORKER_PROXY_TOKEN_FILE = "/run/secrets/policytwin-proxy-token" as const;
export const WORKER_PROXY_CA_FILE = "/run/secrets/policytwin-egress-ca.pem" as const;
export const WORKER_PROXY_BASE_URL = "https://policytwin-egress:8443/v1" as const;
export const WORKER_PROXY_PROVIDER = "policytwin_proxy" as const;
export const WORKER_PROXY_TOKEN_HELPER =
  "/opt/policytwin/scripts/proxy-token-helper.mjs" as const;

const WORKER_PATH = "/usr/local/bin:/usr/bin:/bin";

export function workerCodexSdkOptions(): CodexOptions {
  return {
    config: {
      model_provider: WORKER_PROXY_PROVIDER,
      model_providers: {
        [WORKER_PROXY_PROVIDER]: {
          name: "PolicyTwin OpenAI egress broker",
          base_url: WORKER_PROXY_BASE_URL,
          wire_api: "responses",
          auth: {
            command: "/usr/local/bin/node",
            args: [WORKER_PROXY_TOKEN_HELPER],
            timeout_ms: 5_000,
            refresh_interval_ms: 60_000,
          },
        },
      },
    },
    env: {
      HOME: "/worker-home",
      CODEX_HOME: WORKER_CODEX_HOME,
      PATH: WORKER_PATH,
      POLICYTWIN_PROXY_TOKEN_FILE: WORKER_PROXY_TOKEN_FILE,
      CODEX_CA_CERTIFICATE: WORKER_PROXY_CA_FILE,
    },
  };
}

export function workerCodexThreadOptions(request: WorkerRpcRequest): ThreadOptions {
  return {
    model: request.model,
    sandboxMode: "workspace-write",
    workingDirectory: "/workspace",
    skipGitRepoCheck: true,
    modelReasoningEffort: "high",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    approvalPolicy: "never",
    additionalDirectories: [],
  };
}

export function assertWorkerCodexSdkOptions(value: CodexOptions): CodexOptions {
  const expected = workerCodexSdkOptions();
  if (
    value.apiKey !== undefined ||
    value.baseUrl !== undefined ||
    value.codexPathOverride !== undefined ||
    JSON.stringify(value) !== JSON.stringify(expected)
  ) {
    throw new Error("Worker Codex SDK options weaken proxy-only credential custody.");
  }
  return value;
}
