import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { canonicalWorkerRpcJson } from "../dist/codex/worker-rpc-contract.js";
import { prepareWorkerEntrypointContract } from "../dist/codex/worker-entrypoint-contract.js";

const PATHS = {
  request: "/run/policytwin/request.json",
  response: "/run/policytwin/response.json",
  proxyToken: "/run/secrets/policytwin-proxy-token",
  proxyCa: "/run/secrets/policytwin-egress-ca.pem",
  codexHome: "/worker-home/.codex",
  workspace: "/workspace",
};
const EXPECTED_ENVIRONMENT = {
  HOME: "/worker-home",
  CODEX_HOME: PATHS.codexHome,
  POLICYTWIN_WORKER_REQUEST: PATHS.request,
  POLICYTWIN_WORKER_RESPONSE: PATHS.response,
  POLICYTWIN_PROXY_TOKEN_FILE: PATHS.proxyToken,
  POLICYTWIN_OPENAI_PROXY: "https://policytwin-egress:8443/v1",
  CODEX_CA_CERTIFICATE: PATHS.proxyCa,
};
const FORBIDDEN_ENVIRONMENT =
  /^(?:OPENAI_|AZURE_OPENAI_|CODEX_(?!HOME$|CA_CERTIFICATE$)|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/iu;

function fail() {
  console.error("PolicyTwin live worker remains disabled until dynamic isolation is verified.");
  process.exit(1);
}

function assertReal(path, kind, maximumBytes) {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) ||
    (maximumBytes !== undefined && stat.size > maximumBytes)
  ) {
    fail();
  }
}

if (process.argv[2] !== "--validate-only") fail();
if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
  fail();
}
for (const [key, value] of Object.entries(EXPECTED_ENVIRONMENT)) {
  if (process.env[key] !== value) fail();
}
for (const key of Object.keys(process.env)) {
  if (FORBIDDEN_ENVIRONMENT.test(key)) fail();
}
assertReal(PATHS.workspace, "directory");
assertReal(PATHS.request, "file", 1024 * 1024);
assertReal(PATHS.response, "file", 4 * 1024 * 1024);
assertReal(PATHS.proxyToken, "file", 45);
assertReal(PATHS.proxyCa, "file", 64 * 1024);
try {
  mkdirSync(PATHS.codexHome, { mode: 0o700 });
} catch (error) {
  if (error?.code !== "EEXIST") fail();
}
assertReal(PATHS.codexHome, "directory");

const tokenBytes = readFileSync(PATHS.proxyToken);
const requestBytes = readFileSync(PATHS.request);
try {
  const token = tokenBytes.toString("utf8").trimEnd();
  const decoded = Buffer.from(token, "base64url");
  const tokenValid =
    /^[A-Za-z0-9_-]{43}$/u.test(token) &&
    decoded.byteLength === 32 &&
    decoded.toString("base64url") === token;
  decoded.fill(0);
  if (!tokenValid) fail();
  const requestText = new TextDecoder("utf-8", { fatal: true }).decode(requestBytes);
  const value = JSON.parse(requestText);
  const contract = prepareWorkerEntrypointContract(value, {
    codexHomeEntries: readdirSync(PATHS.codexHome),
  });
  if (requestText !== `${canonicalWorkerRpcJson(value)}\n`) fail();
  writeFileSync(PATHS.response, `${JSON.stringify(contract)}\n`, "utf8");
} catch {
  fail();
} finally {
  tokenBytes.fill(0);
  requestBytes.fill(0);
}
