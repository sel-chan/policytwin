import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect as connectTcp } from "node:net";
import { after, test } from "node:test";
import { connect as connectTls, createServer as createTlsServer } from "node:tls";
import {
  WORKER_RPC_MAX_REQUEST_BYTES,
  WORKER_RPC_MAX_RESPONSE_BYTES,
  WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
  WORKER_RPC_MAX_RESPONSE_CHUNKS,
  WORKER_RPC_MTLS_ALPN,
  WORKER_RPC_MTLS_REQUEST_MAGIC,
  WORKER_RPC_MTLS_RESPONSE_MAGIC,
  createEd25519WorkerRpcSigner,
  createEphemeralWorkerRpcReplayStore,
  createExternalWorkerRpcClient,
  createMutualTlsWorkerRpcSupervisor,
  createMutualTlsWorkerRpcTransport,
  workerRpcExecutionTreeSha256,
} from "../../dist/index.js";
import { createEphemeralWorkerRpcTlsCertificates } from "../helpers/worker-rpc-tls-certificates.mjs";

const certificates = await createEphemeralWorkerRpcTlsCertificates();
after(async () => certificates.cleanup());

const sourcePolicy = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const acceptedPolicyIr = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/policy-ir.json", import.meta.url), "utf8"),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/golden-cases.json", import.meta.url), "utf8"),
);
const generatedCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/generated-cases.json", import.meta.url), "utf8"),
);
const driftCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url),
    "utf8",
  ),
);

const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
const defectsByCase = {
  D01: ["DAY_14_INCLUSIVE"],
  D02: ["USAGE_2000_INCLUSIVE"],
  D03: ["FINAL_SALE_PRECEDENCE"],
};
const input = {
  policyId: acceptedPolicyIr.policyId,
  policyVersion: 4,
  fixtureId: "seeded-refund-demo",
  sourcePolicy,
  policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
  acceptedPolicyIr,
  acceptedCases: [...goldenCases, ...generatedCases],
  failingCaseIds: ["D01", "D02", "D03"],
  failingDriftWitnesses: driftCases.map((policyCase) => ({
    caseId: policyCase.id,
    input: policyCase.input,
    expectedDecision: policyCase.expectedDecision,
    actualDecision: actualByCase[policyCase.id],
    defectIds: defectsByCase[policyCase.id],
    relatedClauseIds: policyCase.relatedClauseIds,
    relatedRuleIds: policyCase.relatedRuleIds,
  })),
  allowedCommandIds: ["fixture-typecheck", "fixture-test"],
  maxRepairAttempts: 1,
};

const baselineManifest = {
  schemaVersion: "1",
  entries: [
    {
      path: ".",
      kind: "directory",
      mode: 16877,
      mtimeMs: 1_700_000_000_000,
      sha256: null,
    },
    {
      path: "package.json",
      kind: "file",
      mode: 33188,
      mtimeMs: 1_700_000_000_001,
      sha256: "3".repeat(64),
    },
    {
      path: "src",
      kind: "directory",
      mode: 16877,
      mtimeMs: 1_700_000_000_002,
      sha256: null,
    },
    {
      path: "src/refund.ts",
      kind: "file",
      mode: 33188,
      mtimeMs: 1_700_000_000_003,
      sha256: "4".repeat(64),
    },
    {
      path: "tests",
      kind: "directory",
      mode: 16877,
      mtimeMs: 1_700_000_000_004,
      sha256: null,
    },
    {
      path: "tests/refund.test.mjs",
      kind: "file",
      mode: 33188,
      mtimeMs: 1_700_000_000_005,
      sha256: "5".repeat(64),
    },
  ],
};
const baselineTreeSha256 = workerRpcExecutionTreeSha256(baselineManifest);
const imageDigest = `sha256:${"d".repeat(64)}`;
const baselineContentSha256 = "e".repeat(64);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = createEd25519WorkerRpcSigner({
  keyId: "worker-test-key-v1",
  supervisorId: "policytwin-test-supervisor",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
});
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

function deterministicRandom(seed) {
  let counter = seed;
  return (size) => Buffer.alloc(size, counter++);
}

function failureResult(request, runNumber) {
  return {
    status: "FAIL",
    report: null,
    error: "OFFLINE_TEST_DOUBLE_NO_LIVE_WORKER",
    receipt: {
      supervisorRunId: `tls-test-supervisor-run-${String(runNumber).padStart(4, "0")}`,
      workerImageDigest: request.policy.workerImageDigest,
      workerPolicySha256: request.policySha256,
      fixtureId: request.policy.fixtureId,
      baselineContentSha256: request.policy.baselineContentSha256,
      baselineExecutionTreeSha256: request.policy.baselineExecutionTreeSha256,
      finalExecutionTreeSha256: request.policy.baselineExecutionTreeSha256,
      finalExecutionTreeManifest: request.policy.baselineExecutionTreeManifest,
      acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
      executionMode: "LIVE_CODEX_SDK",
      repairWorkspaceDeleted: true,
      verificationWorkspaceDeleted: true,
      processTreeReaped: true,
      remainingProcessCount: 0,
    },
  };
}

async function startSupervisor(t, options = {}) {
  let runNumber = 0;
  let executorCalls = 0;
  const events = [];
  const executor =
    options.executor ??
    {
      async execute(request) {
        executorCalls += 1;
        runNumber += 1;
        return failureResult(request, runNumber);
      },
    };
  const supervisor = createMutualTlsWorkerRpcSupervisor({
    host: "127.0.0.1",
    port: 0,
    ca: certificates.ca,
    cert: certificates.server.cert,
    key: certificates.server.key,
    expectedClientCertificateSha256:
      options.expectedClientCertificateSha256 ?? certificates.client.fingerprintSha256,
    replayStore: options.replayStore ?? createEphemeralWorkerRpcReplayStore(),
    executor: {
      async execute(request, context) {
        executorCalls += options.executor === undefined ? 0 : 1;
        return executor.execute(request, context);
      },
    },
    signer,
    requestReadTimeoutMs: options.requestReadTimeoutMs ?? 1_000,
    onAuditEvent(event) {
      events.push(event.type);
    },
  });
  const address = await supervisor.listen();
  t.after(async () => supervisor.close());
  return {
    supervisor,
    address,
    events,
    get executorCalls() {
      return executorCalls;
    },
  };
}

function transportFor(address, options = {}) {
  const clientCertificate = options.clientCertificate ?? certificates.client;
  return createMutualTlsWorkerRpcTransport({
    id: options.id ?? "loopback-worker-mtls",
    host: address.host,
    port: address.port,
    servername: options.servername ?? "worker.policytwin.test",
    ca: certificates.ca,
    cert: clientCertificate.cert,
    key: clientCertificate.key,
    expectedServerCertificateSha256:
      options.expectedServerCertificateSha256 ?? certificates.server.fingerprintSha256,
    handshakeTimeoutMs: 2_000,
  });
}

function clientFor(transport, seed = 1, overrides = {}) {
  return createExternalWorkerRpcClient({
    transport,
    trustedWorkerPublicKeys: { "worker-test-key-v1": publicKeyPem },
    expectedSupervisorId: "policytwin-test-supervisor",
    expectedBackendId: "policytwin-external-worker",
    workerImageDigest: imageDigest,
    baselineContentSha256,
    baselineExecutionTreeSha256: baselineTreeSha256,
    baselineExecutionTreeManifest: baselineManifest,
    model: "gpt-codex-test",
    limits: {
      wallTimeMs: 4_000,
      cpuTimeMs: 2_000,
      memoryBytes: 256 * 1024 * 1024,
      pids: 8,
      outputBytes: 1024 * 1024,
    },
    rpcTimeoutMs: 5_000,
    randomBytes: deterministicRandom(seed),
    ...overrides,
  });
}

function waitForSocketClose(socket) {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once("close", resolve);
    socket.once("error", () => undefined);
  });
}

function connectRawClient(address, material = certificates.client, alpn = WORKER_RPC_MTLS_ALPN) {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host: address.host,
      port: address.port,
      servername: "worker.policytwin.test",
      ca: certificates.ca,
      cert: material.cert,
      key: material.key,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ALPNProtocols: [alpn],
    });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", () => reject(new Error("Raw mTLS test client failed.")));
  });
}

function frameHeader(magic, length) {
  const header = Buffer.alloc(8);
  header.write(magic, 0, 4, "ascii");
  header.writeUInt32BE(length, 4);
  return header;
}

test("real mTLS transport authenticates both peers and verifies a signed fail-closed response", async (t) => {
  const service = await startSupervisor(t);
  const client = clientFor(transportFor(service.address));
  await assert.rejects(client.runRepair(input), /External worker rejected the repair/u);
  assert.equal(service.executorCalls, 1);
  assert.equal(service.events.includes("TLS_CLIENT_AUTHENTICATED"), true);
  assert.equal(service.events.includes("REQUEST_ACCEPTED"), true);
  assert.equal(service.events.includes("RESPONSE_SENT"), true);
});

test("mTLS rejects wrong, untrusted, and missing client identity before execution", async (t) => {
  const service = await startSupervisor(t);
  await assert.rejects(
    clientFor(
      transportFor(service.address, { clientCertificate: certificates.otherClient }),
    ).runRepair(input),
    /External worker transport failed/u,
  );
  await assert.rejects(
    clientFor(
      transportFor(service.address, { clientCertificate: certificates.untrustedClient }),
      3,
    ).runRepair(input),
    /External worker transport failed/u,
  );
  assert.throws(
    () =>
      createMutualTlsWorkerRpcTransport({
        id: "missing-client-cert",
        host: service.address.host,
        port: service.address.port,
        servername: "worker.policytwin.test",
        ca: certificates.ca,
        cert: Buffer.alloc(0),
        key: Buffer.alloc(0),
        expectedServerCertificateSha256: certificates.server.fingerprintSha256,
      }),
    /client certificate/u,
  );
  await new Promise((resolve) => {
    const noCertificate = connectTls({
      host: service.address.host,
      port: service.address.port,
      servername: "worker.policytwin.test",
      ca: certificates.ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ALPNProtocols: [WORKER_RPC_MTLS_ALPN],
    });
    noCertificate.once("error", () => resolve());
    noCertificate.once("close", () => resolve());
  });
  assert.equal(service.executorCalls, 0);
});

test("mTLS rejects wrong server name and certificate pin before execution", async (t) => {
  const service = await startSupervisor(t);
  await assert.rejects(
    clientFor(
      transportFor(service.address, { servername: "wrong.policytwin.test" }),
    ).runRepair(input),
    /External worker transport failed/u,
  );
  await assert.rejects(
    clientFor(
      transportFor(service.address, {
        id: "wrong-server-pin",
        expectedServerCertificateSha256: "0".repeat(64),
      }),
      3,
    ).runRepair(input),
    /External worker transport failed/u,
  );
  assert.equal(service.executorCalls, 0);
});

test("supervisor rejects oversized and partial request frames before parsing or execution", async (t) => {
  const service = await startSupervisor(t, { requestReadTimeoutMs: 250 });
  const oversized = await connectRawClient(service.address);
  oversized.write(
    frameHeader(WORKER_RPC_MTLS_REQUEST_MAGIC, WORKER_RPC_MAX_REQUEST_BYTES + 1),
  );
  await waitForSocketClose(oversized);

  const partial = await connectRawClient(service.address);
  partial.write(Buffer.from("P", "ascii"));
  await waitForSocketClose(partial);
  assert.equal(service.executorCalls, 0);
});

test("supervisor rejects wrong magic and trailing bytes before execution", async (t) => {
  const service = await startSupervisor(t);
  const wrongMagic = await connectRawClient(service.address);
  wrongMagic.write(Buffer.concat([frameHeader("BAD1", 2), Buffer.from("{}", "utf8")]));
  await waitForSocketClose(wrongMagic);

  let canonicalRequest;
  const captureTransport = {
    id: "capture-request-only",
    authenticationMode: "MUTUAL_TLS",
    async call(value) {
      canonicalRequest = value;
      throw new Error("capture complete");
    },
  };
  await assert.rejects(
    clientFor(captureTransport, 17).runRepair(input),
    /External worker transport failed/u,
  );
  const requestBytes = Buffer.from(canonicalRequest, "utf8");
  const trailing = await connectRawClient(service.address);
  trailing.write(
    Buffer.concat([
      frameHeader(WORKER_RPC_MTLS_REQUEST_MAGIC, requestBytes.byteLength),
      requestBytes,
      Buffer.from("x", "ascii"),
    ]),
  );
  await waitForSocketClose(trailing);
  assert.equal(service.executorCalls, 0);
});

test("supervisor consumes request capabilities once across independent clients", async (t) => {
  const replayStore = createEphemeralWorkerRpcReplayStore();
  const service = await startSupervisor(t, { replayStore });
  await assert.rejects(
    clientFor(transportFor(service.address), 11).runRepair(input),
    /External worker rejected the repair/u,
  );
  await assert.rejects(
    clientFor(transportFor(service.address), 11).runRepair(input),
    /External worker transport failed/u,
  );
  assert.equal(service.executorCalls, 1);
});

test("supervisor admits only one active repair and propagates cancellation boundaries", async (t) => {
  let release;
  let firstRequest;
  const started = new Promise((resolve) => {
    firstRequest = resolve;
  });
  const executor = {
    async execute(request, context) {
      firstRequest();
      await new Promise((resolve, reject) => {
        release = resolve;
        context.signal.addEventListener(
          "abort",
          () => reject(new Error("test executor aborted")),
          { once: true },
        );
      });
      return failureResult(request, 1);
    },
  };
  const service = await startSupervisor(t, { executor });
  const first = clientFor(transportFor(service.address), 21).runRepair(input);
  await started;
  await assert.rejects(
    clientFor(transportFor(service.address), 31).runRepair(input),
    /External worker transport failed/u,
  );
  assert.equal(service.supervisor.activeRepairCount, 1);
  release();
  await assert.rejects(first, /External worker rejected the repair/u);
  assert.equal(service.executorCalls, 1);
});

test("client timeout aborts the supervisor executor before the repair slot is released", async (t) => {
  let markStarted;
  let markAborted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const aborted = new Promise((resolve) => {
    markAborted = resolve;
  });
  const executor = {
    async execute(_request, context) {
      markStarted();
      await new Promise((_resolve, reject) => {
        context.signal.addEventListener(
          "abort",
          () => {
            markAborted();
            reject(new Error("test executor cancelled"));
          },
          { once: true },
        );
      });
    },
  };
  const service = await startSupervisor(t, { executor });
  const run = clientFor(transportFor(service.address), 41, {
    limits: {
      wallTimeMs: 1_000,
      cpuTimeMs: 1_000,
      memoryBytes: 256 * 1024 * 1024,
      pids: 8,
      outputBytes: 1024 * 1024,
    },
    rpcTimeoutMs: 1_000,
  }).runRepair(input);
  await started;
  await assert.rejects(run, /(timed out|aborted|ended before its declared length)/u);
  await aborted;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(service.supervisor.activeRepairCount, 0);
  assert.equal(service.executorCalls, 1);
});

test("supervisor close aborts and awaits an active executor before returning", async (t) => {
  let markStarted;
  let markAborted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const aborted = new Promise((resolve) => {
    markAborted = resolve;
  });
  const executor = {
    async execute(_request, context) {
      markStarted();
      await new Promise((_resolve, reject) => {
        context.signal.addEventListener(
          "abort",
          () => {
            setTimeout(() => {
              markAborted();
              reject(new Error("test executor stopped after supervisor close"));
            }, 25);
          },
          { once: true },
        );
      });
    },
  };
  const service = await startSupervisor(t, { executor });
  const run = clientFor(transportFor(service.address), 51).runRepair(input);
  const runRejected = assert.rejects(run, /External worker transport failed/u);
  await started;
  await service.supervisor.close();
  await aborted;
  await runRejected;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(service.supervisor.activeRepairCount, 0);
});

test("supervisor close during replay admission cannot start the executor", async (t) => {
  let markConsumeStarted;
  let releaseConsume;
  const consumeStarted = new Promise((resolve) => {
    markConsumeStarted = resolve;
  });
  const replayStore = {
    async consume() {
      markConsumeStarted();
      await new Promise((resolve) => {
        releaseConsume = resolve;
      });
      return true;
    },
  };
  const service = await startSupervisor(t, { replayStore });
  const runRejected = assert.rejects(
    clientFor(transportFor(service.address), 61).runRepair(input),
    /External worker transport failed/u,
  );
  await consumeStarted;
  const closing = service.supervisor.close();
  releaseConsume();
  await closing;
  await runRejected;
  assert.equal(service.executorCalls, 0);
  assert.equal(service.supervisor.activeRepairCount, 0);
});

test("supervisor close destroys pre-handshake TCP sockets without waiting for TLS timeout", async (t) => {
  const service = await startSupervisor(t);
  const rawSockets = await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        new Promise((resolve, reject) => {
          const socket = connectTcp(service.address.port, service.address.host);
          socket.once("connect", () => resolve(socket));
          socket.once("error", reject);
        }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(service.supervisor.openConnectionCount, 4);
  const startedAt = Date.now();
  await service.supervisor.close();
  assert.equal(Date.now() - startedAt < 1_000, true);
  assert.equal(service.supervisor.openConnectionCount, 0);
  for (const socket of rawSockets) socket.destroy();
});

test("client rejects oversized response headers and ALPN mismatch before body allocation", async (t) => {
  async function startRawServer(alpn, onConnection) {
    const server = createTlsServer(
      {
        ca: certificates.ca,
        cert: certificates.server.cert,
        key: certificates.server.key,
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
        ALPNProtocols: [alpn],
      },
      onConnection,
    );
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(0, "127.0.0.1");
    });
    t.after(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    );
    const address = server.address();
    return { host: "127.0.0.1", port: address.port };
  }

  const oversizedAddress = await startRawServer(WORKER_RPC_MTLS_ALPN, (socket) => {
    socket.once("data", () => {
      socket.end(
        frameHeader(WORKER_RPC_MTLS_RESPONSE_MAGIC, WORKER_RPC_MAX_RESPONSE_BYTES + 1),
      );
    });
  });
  const controller = new AbortController();
  await assert.rejects(
    transportFor(oversizedAddress).call("{}", {
      signal: controller.signal,
      maxResponseBytes: WORKER_RPC_MAX_RESPONSE_BYTES,
      maxChunkBytes: WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
      maxChunks: WORKER_RPC_MAX_RESPONSE_CHUNKS,
    }),
    /frame byte length/u,
  );

  const alpnAddress = await startRawServer("not-policytwin-rpc", (socket) => {
    socket.end();
  });
  await assert.rejects(
    transportFor(alpnAddress).call("{}", {
      signal: controller.signal,
      maxResponseBytes: WORKER_RPC_MAX_RESPONSE_BYTES,
      maxChunkBytes: WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
      maxChunks: WORKER_RPC_MAX_RESPONSE_CHUNKS,
    }),
    /(handshake failed|authentication profile)/u,
  );

  const truncatedAddress = await startRawServer(WORKER_RPC_MTLS_ALPN, (socket) => {
    socket.once("data", () => {
      socket.end(
        Buffer.concat([
          frameHeader(WORKER_RPC_MTLS_RESPONSE_MAGIC, 10),
          Buffer.from("{}", "utf8"),
        ]),
      );
    });
  });
  const truncated = await transportFor(truncatedAddress).call("{}", {
    signal: controller.signal,
    maxResponseBytes: WORKER_RPC_MAX_RESPONSE_BYTES,
    maxChunkBytes: WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
    maxChunks: WORKER_RPC_MAX_RESPONSE_CHUNKS,
  });
  await assert.rejects(
    async () => {
      for await (const _chunk of truncated.chunks) {
        // Consume the bounded stream to force exact-length validation.
      }
    },
    /ended before its declared length/u,
  );

  const trailingAddress = await startRawServer(WORKER_RPC_MTLS_ALPN, (socket) => {
    socket.once("data", () => {
      socket.end(
        Buffer.concat([
          frameHeader(WORKER_RPC_MTLS_RESPONSE_MAGIC, 2),
          Buffer.from("{}x", "utf8"),
        ]),
      );
    });
  });
  const trailing = await transportFor(trailingAddress).call("{}", {
    signal: controller.signal,
    maxResponseBytes: WORKER_RPC_MAX_RESPONSE_BYTES,
    maxChunkBytes: WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
    maxChunks: WORKER_RPC_MAX_RESPONSE_CHUNKS,
  });
  await assert.rejects(
    async () => {
      for await (const _chunk of trailing.chunks) {
        // Consume the bounded stream to force trailing-byte validation.
      }
    },
    /trailing bytes/u,
  );
});
