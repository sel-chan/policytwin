import { lstatSync, readFileSync } from "node:fs";
import { connect } from "node:tls";

const CA_PATH = "/run/secrets/policytwin-egress-ca.pem";
const FORBIDDEN_ENVIRONMENT = /^(?:OPENAI_|AZURE_OPENAI_|CODEX_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/iu;

function readCa() {
  const stat = lstatSync(CA_PATH);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 64 * 1024) {
    throw new Error("The egress probe CA mount is invalid.");
  }
  return readFileSync(CA_PATH);
}

export async function runEgressTlsProbe() {
  if (
    process.platform !== "linux" ||
    typeof process.getuid !== "function" ||
    process.getuid() === 0
  ) {
    throw new Error("The egress probe must run as a non-root Linux user.");
  }
  if (process.env.POLICYTWIN_EGRESS_PROBE !== "1") {
    throw new Error("The egress probe environment is not admitted.");
  }
  for (const key of Object.keys(process.env)) {
    if (FORBIDDEN_ENVIRONMENT.test(key)) {
      throw new Error("The egress probe received a forbidden credential or proxy variable.");
    }
  }
  const ca = readCa();
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const socket = connect({
        host: "policytwin-egress",
        port: 8443,
        servername: "policytwin-egress",
        ca,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
      });
      const timer = setTimeout(() => {
        socket.destroy();
        rejectPromise(new Error("The egress TLS probe timed out."));
      }, 5_000);
      socket.once("error", (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });
      socket.once("secureConnect", () => {
        clearTimeout(timer);
        const certificate = socket.getPeerCertificate();
        const fingerprint = certificate.fingerprint256?.replaceAll(":", "").toLowerCase();
        if (
          socket.authorized !== true ||
          socket.getProtocol() !== "TLSv1.3" ||
          typeof fingerprint !== "string" ||
          !/^[0-9a-f]{64}$/u.test(fingerprint)
        ) {
          socket.destroy();
          rejectPromise(new Error("The egress TLS peer evidence is invalid."));
          return;
        }
        socket.end();
        resolvePromise({
          schemaVersion: "1",
          status: "TLS_HANDSHAKE_PASS",
          peerAuthority: "policytwin-egress:8443",
          tlsVersion: "TLSv1.3",
          peerCertificateSha256: fingerprint,
          probeHttpRequestSent: false,
          proxyUpstreamTrafficObservation: "NOT_MEASURED",
          probeModelInvocation: false,
          liveCodexExecuted: false,
        });
      });
    });
  } finally {
    ca.fill(0);
  }
}
