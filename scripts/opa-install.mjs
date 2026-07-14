import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { ROOT } from "./process.mjs";

const contract = JSON.parse(readFileSync(resolve(ROOT, "container-contract.json"), "utf8"));
const version = contract.opaVersion;
const assets = {
  win32: {
    name: "opa_windows_amd64.exe",
    executable: "opa.exe",
    sha256: contract.opaWindowsSha256,
  },
  linux: {
    name: "opa_linux_amd64_static",
    executable: "opa",
    sha256: contract.opaLinuxAmd64StaticSha256,
  },
};
const asset = assets[process.platform];
if (!asset || process.arch !== "x64") {
  throw new Error(`Unsupported OPA installer platform: ${process.platform}/${process.arch}`);
}
if (!/^\d+\.\d+\.\d+$/u.test(version) || !/^[a-f0-9]{64}$/u.test(asset.sha256)) {
  throw new Error("OPA contract version or checksum is invalid.");
}

const directory = resolve(ROOT, ".tools", "opa", version);
const target = resolve(directory, asset.executable);
const temporary = `${target}.download`;
if (relative(ROOT, target).startsWith("..") || dirname(target) !== directory) {
  throw new Error(`Refusing OPA install outside managed directory: ${target}`);
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (existsSync(target) && digest(target) === asset.sha256) {
  console.log(`OPA ${version} already verified at ${relative(ROOT, target)}.`);
  process.exit(0);
}

mkdirSync(directory, { recursive: true });
rmSync(temporary, { force: true });
const url = `https://github.com/open-policy-agent/opa/releases/download/v${version}/${asset.name}`;
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`OPA download failed with HTTP ${response.status}.`);
}
writeFileSync(temporary, new Uint8Array(await response.arrayBuffer()), { flag: "wx" });
const actual = digest(temporary);
if (actual !== asset.sha256) {
  rmSync(temporary, { force: true });
  throw new Error(`OPA checksum mismatch: expected ${asset.sha256}, received ${actual}.`);
}
renameSync(temporary, target);
if (process.platform !== "win32") {
  chmodSync(target, 0o755);
}
console.log(`Installed and verified OPA ${version} (${actual}) at ${relative(ROOT, target)}.`);
