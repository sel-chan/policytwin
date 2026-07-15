import { lstatSync, readFileSync, writeFileSync, rmSync } from "node:fs";

const EXPECTED_ENVIRONMENT = {
  HOME: "/worker-home",
  CODEX_HOME: "/worker-home/.codex",
  POLICYTWIN_WORKER_REQUEST: "/run/policytwin/request.json",
  POLICYTWIN_WORKER_RESPONSE: "/run/policytwin/response.json",
  POLICYTWIN_PROXY_TOKEN_FILE: "/run/secrets/policytwin-proxy-token",
  POLICYTWIN_OPENAI_PROXY: "https://policytwin-egress:8443/v1",
  CODEX_CA_CERTIFICATE: "/run/secrets/policytwin-egress-ca.pem",
};
const FORBIDDEN_ENVIRONMENT = /^(?:OPENAI_|AZURE_OPENAI_|CODEX_(?!HOME$|CA_CERTIFICATE$)|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/iu;

function fail(message) {
  console.error(`Worker static preflight failed: ${message}`);
  process.exit(1);
}

function assertReal(path, kind, maximumBytes = Number.POSITIVE_INFINITY) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail(`${kind} mount is absent.`);
  }
  if (
    stat.isSymbolicLink() ||
    (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) ||
    stat.size > maximumBytes
  ) {
    fail(`${kind} mount is invalid.`);
  }
}

function assertWritableOverlay(path) {
  const body = readFileSync(path);
  try {
    writeFileSync(path, body);
  } catch {
    fail("an approved repair overlay is not writable.");
  } finally {
    body.fill(0);
  }
}

function assertReadOnlyMount(path) {
  try {
    writeFileSync(path, readFileSync(path));
    fail("a read-only fixture mount accepted a write.");
  } catch (error) {
    if (error?.code !== "EROFS" && error?.code !== "EACCES" && error?.code !== "EPERM") throw error;
  }
}

if (process.argv[2] !== "--static-preflight") {
  fail("live worker execution is not implemented in this image.");
}
if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
  fail("the worker must run as a non-root Linux user.");
}
for (const [key, value] of Object.entries(EXPECTED_ENVIRONMENT)) {
  if (process.env[key] !== value) fail(`required environment ${key} is not exact.`);
}
for (const key of Object.keys(process.env)) {
  if (FORBIDDEN_ENVIRONMENT.test(key)) fail("a forbidden credential or proxy environment exists.");
}
assertReal("/workspace", "directory");
assertReal("/workspace/src/refund.ts", "file", 1024 * 1024);
assertReal("/workspace/tests/refund.test.mjs", "file", 1024 * 1024);
assertReal(EXPECTED_ENVIRONMENT.POLICYTWIN_WORKER_REQUEST, "file", 1024 * 1024);
assertReal(EXPECTED_ENVIRONMENT.POLICYTWIN_WORKER_RESPONSE, "file", 4 * 1024 * 1024);
assertReal(EXPECTED_ENVIRONMENT.POLICYTWIN_PROXY_TOKEN_FILE, "file", 4_096);
assertReal(EXPECTED_ENVIRONMENT.CODEX_CA_CERTIFICATE, "file", 64 * 1024);
assertWritableOverlay("/workspace/src/refund.ts");
assertWritableOverlay("/workspace/tests/refund.test.mjs");
assertReadOnlyMount("/workspace/package.json");
assertReadOnlyMount(EXPECTED_ENVIRONMENT.POLICYTWIN_WORKER_REQUEST);
const token = readFileSync(EXPECTED_ENVIRONMENT.POLICYTWIN_PROXY_TOKEN_FILE);
const tokenText = token.toString("utf8").trimEnd();
const tokenDecoded = Buffer.from(tokenText, "base64url");
if (
  !/^[A-Za-z0-9_-]{43}$/u.test(tokenText) ||
  tokenDecoded.byteLength !== 32 ||
  tokenDecoded.toString("base64url") !== tokenText
) {
  tokenDecoded.fill(0);
  fail("the proxy token is invalid.");
}
tokenDecoded.fill(0);
token.fill(0);
writeFileSync(
  EXPECTED_ENVIRONMENT.POLICYTWIN_WORKER_RESPONSE,
  '{"schemaVersion":"1","status":"STATIC_PREFLIGHT_PASS"}\n',
  "utf8",
);
const rootProbe = "/opt/policytwin/.readonly-probe";
try {
  writeFileSync(rootProbe, "probe", { flag: "wx" });
  rmSync(rootProbe, { force: true });
  fail("the worker root filesystem is writable.");
} catch (error) {
  if (error?.code !== "EROFS" && error?.code !== "EACCES" && error?.code !== "EPERM") throw error;
}
console.log(
  JSON.stringify({
    schemaVersion: "1",
    status: "STATIC_PREFLIGHT_PASS",
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
  }),
);
