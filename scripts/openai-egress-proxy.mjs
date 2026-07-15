import { createServer } from "node:https";
import { lstatSync, readFileSync } from "node:fs";
import {
  createOpenAiEgressProxyHandler,
  createPinnedOpenAiUpstreamClient,
} from "../dist/codex/openai-egress-proxy.js";
import { OpenAiEgressLeaseGuard } from "../dist/codex/openai-egress-contract.js";

const FILES = {
  certificate: ["/run/secrets/policytwin-egress-tls-cert.pem", 64 * 1024],
  privateKey: ["/run/secrets/policytwin-egress-tls-key.pem", 64 * 1024],
  lease: ["/run/secrets/policytwin-egress-lease.json", 16 * 1024],
  providerToken: ["/run/secrets/policytwin-openai-key", 4096],
};

function readSecret([path, maximumBytes]) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error("An egress proxy secret mount is invalid.");
  }
  return readFileSync(path);
}

const certificate = readSecret(FILES.certificate);
const privateKey = readSecret(FILES.privateKey);
const leaseBytes = readSecret(FILES.lease);
const providerToken = readSecret(FILES.providerToken);
let lease;
try {
  lease = JSON.parse(leaseBytes.toString("utf8"));
} finally {
  leaseBytes.fill(0);
}
const upstreamClient = createPinnedOpenAiUpstreamClient(providerToken);
providerToken.fill(0);
const handler = createOpenAiEgressProxyHandler({
  leaseGuard: new OpenAiEgressLeaseGuard(lease),
  upstreamClient,
});
const server = createServer(
  {
    cert: certificate,
    key: privateKey,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
  },
  handler,
);
certificate.fill(0);
privateKey.fill(0);
server.maxHeadersCount = 16;
server.headersTimeout = 5_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 1_000;

let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  server.close(() => {
    upstreamClient.destroy();
    process.exit(0);
  });
  setTimeout(() => {
    upstreamClient.destroy();
    process.exit(1);
  }, 5_000).unref();
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
server.listen(8443, "0.0.0.0");
