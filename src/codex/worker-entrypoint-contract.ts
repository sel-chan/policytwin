import type { CodexOptions } from "@openai/codex-sdk";
import {
  parseWorkerRpcRequest,
  workerRpcSha256,
} from "./worker-rpc-contract.js";
import {
  assertWorkerCodexSdkOptions,
  workerCodexSdkOptions,
} from "./worker-sdk-runtime.js";

export interface PreparedWorkerEntrypointContract {
  schemaVersion: "1";
  status: "VALIDATED_REQUEST_LIVE_DISABLED";
  requestId: string;
  requestSha256: string;
  codexHomeEmpty: true;
  providerCredentialPresent: false;
  dynamicIsolationVerified: false;
  liveCodexExecuted: false;
}

export function prepareWorkerEntrypointContract(
  value: unknown,
  options: {
    codexHomeEntries: readonly string[];
    sdkOptions?: CodexOptions;
  },
): PreparedWorkerEntrypointContract {
  if (options.codexHomeEntries.length !== 0) {
    throw new Error("Worker CODEX_HOME must be empty before a run.");
  }
  const sdkOptions = options.sdkOptions ?? workerCodexSdkOptions();
  assertWorkerCodexSdkOptions(sdkOptions);
  const request = parseWorkerRpcRequest(value);
  return {
    schemaVersion: "1",
    status: "VALIDATED_REQUEST_LIVE_DISABLED",
    requestId: request.requestId,
    requestSha256: workerRpcSha256(request),
    codexHomeEmpty: true,
    providerCredentialPresent: false,
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
  };
}
