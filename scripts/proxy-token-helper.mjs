import { lstatSync, readFileSync } from "node:fs";

const TOKEN_FILE = "/run/secrets/policytwin-proxy-token";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function fail() {
  console.error("PolicyTwin proxy authentication is unavailable.");
  process.exit(1);
}

if (process.env.POLICYTWIN_PROXY_TOKEN_FILE !== TOKEN_FILE) fail();

let stat;
try {
  stat = lstatSync(TOKEN_FILE);
} catch {
  fail();
}
if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 43 || stat.size > 45) fail();

const tokenBytes = readFileSync(TOKEN_FILE);
try {
  const token = tokenBytes.toString("utf8").trimEnd();
  const decoded = Buffer.from(token, "base64url");
  const valid =
    TOKEN_PATTERN.test(token) &&
    decoded.byteLength === 32 &&
    decoded.toString("base64url") === token;
  decoded.fill(0);
  if (!valid) fail();
  process.stdout.write(`${token}\n`);
} finally {
  tokenBytes.fill(0);
}
