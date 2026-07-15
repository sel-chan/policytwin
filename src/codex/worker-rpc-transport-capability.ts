export interface ExternalWorkerRpcResponseStream {
  readonly declaredLength: number;
  readonly chunks: AsyncIterable<Uint8Array>;
}

export interface ExternalWorkerRpcTransport {
  readonly id: string;
  readonly authenticationMode: "MUTUAL_TLS" | "LOCAL_SOCKET_ACL";
  call(
    canonicalRequest: string,
    options: {
      signal: AbortSignal;
      maxResponseBytes: number;
      maxChunkBytes: number;
      maxChunks: number;
    },
  ): Promise<ExternalWorkerRpcResponseStream>;
}

declare const MUTUAL_TLS_WORKER_RPC_V2_TRANSPORT: unique symbol;

export interface MutualTlsWorkerRpcV2Transport extends ExternalWorkerRpcTransport {
  readonly authenticationMode: "MUTUAL_TLS";
  readonly [MUTUAL_TLS_WORKER_RPC_V2_TRANSPORT]: true;
}
