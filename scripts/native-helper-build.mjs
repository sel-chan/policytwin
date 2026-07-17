import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  NATIVE_HELPER_COMPILER_ARGUMENTS,
  NATIVE_HELPER_IMAGE_PATH,
  NATIVE_HELPER_MAXIMUM_BYTES,
  NATIVE_HELPER_SOURCE_PATH,
  computeNativeHelperSource,
  inspectNativeHelperBinary,
} from "./native-helper-contract.mjs";
import { ROOT } from "./process.mjs";

const OUTPUT_RELATIVE_PATH = ".tmp/native-helper/local/policytwin-linux-cgroup-helper";
const REPORT_RELATIVE_PATH = "artifacts/security/native-helper-local-build-report.json";

function resultError(result, label) {
  if (result.error !== undefined) return `${label}: ${result.error.message}`;
  const stderr = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString("utf8")
    : String(result.stderr ?? "");
  return `${label}: ${stderr.trim().slice(0, 2_000) || `exit ${result.status}`}`;
}

function invoke(command, args, options, label) {
  // Security-reviewed local-only boundary: callers select fixed cc/WSL programs and fixed
  // compiler arguments; shell execution is disabled and time/output are bounded.
  const result = spawnSync(command, args, {
    cwd: ROOT,
    timeout: 120_000,
    maxBuffer: NATIVE_HELPER_MAXIMUM_BYTES + 1024 * 1024,
    shell: false,
    windowsHide: true,
    ...options,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(resultError(result, label));
  }
  return result;
}

function linuxEnvironment() {
  return {
    ...process.env,
    LANG: "C",
    LC_ALL: "C",
    SOURCE_DATE_EPOCH: "0",
    TZ: "UTC",
  };
}

function compileLinux(source, outputPath) {
  invoke(
    "cc",
    [...NATIVE_HELPER_COMPILER_ARGUMENTS, "-o", outputPath, "-"],
    { env: linuxEnvironment(), input: source, encoding: null },
    "native helper compiler",
  );
  return readFileSync(outputPath);
}

function wsl(args, options, label) {
  return invoke("wsl.exe", ["--exec", ...args], options, label);
}

function compileWsl(source, outputPath) {
  wsl(["rm", "-f", outputPath], { encoding: "utf8" }, "WSL helper cleanup");
  try {
    wsl(
      [
        "env",
        "LANG=C",
        "LC_ALL=C",
        "SOURCE_DATE_EPOCH=0",
        "TZ=UTC",
        "cc",
        ...NATIVE_HELPER_COMPILER_ARGUMENTS,
        "-o",
        outputPath,
        "-",
      ],
      { input: source, encoding: null },
      "WSL native helper compiler",
    );
    return Buffer.from(
      wsl(["cat", outputPath], { encoding: null }, "WSL native helper extraction").stdout,
    );
  } finally {
    wsl(["rm", "-f", outputPath], { encoding: "utf8" }, "WSL helper cleanup");
  }
}

function compilerVersion() {
  const result = process.platform === "win32"
    ? wsl(["env", "LC_ALL=C", "cc", "--version"], { encoding: "utf8" }, "WSL cc version")
    : invoke("cc", ["--version"], { env: linuxEnvironment(), encoding: "utf8" }, "cc version");
  return String(result.stdout).split(/\r?\n/u)[0].trim();
}

function main() {
  if (process.platform !== "linux" && process.platform !== "win32") {
    throw new Error("Native helper local build requires Linux or Windows with WSL.");
  }
  const sourceContract = computeNativeHelperSource();
  const source = readFileSync(resolve(ROOT, NATIVE_HELPER_SOURCE_PATH));
  const outputPath = resolve(ROOT, OUTPUT_RELATIVE_PATH);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  const wslOutputPath = `/tmp/policytwin-native-helper-${process.pid}`;
  const compile = process.platform === "win32"
    ? () => compileWsl(source, wslOutputPath)
    : () => compileLinux(source, outputPath);
  const first = compile();
  const second = compile();
  if (!first.equals(second)) {
    throw new Error("Native helper compiler did not produce byte-identical repeated output.");
  }
  const facts = inspectNativeHelperBinary(first);
  mkdirSync(resolve(ROOT, ".tmp/native-helper/local"), { recursive: true });
  rmSync(outputPath, { force: true });
  writeFileSync(outputPath, first, { mode: 0o555 });
  if (process.platform === "linux") chmodSync(outputPath, 0o555);
  const report = {
    schemaVersion: "1",
    status: "PASS_LOCAL_TOOLCHAIN_NOT_IMAGE_BOUND",
    scope: "LOCAL_NATIVE_HELPER_REPRODUCIBILITY_ONLY",
    sourcePath: sourceContract.relativePath,
    sourceSha256: sourceContract.sha256,
    sourceBytes: sourceContract.bytes,
    compilerArguments: NATIVE_HELPER_COMPILER_ARGUMENTS,
    compilerVersion: compilerVersion(),
    toolchainPinned: false,
    deterministicEnvironment: {
      LANG: "C",
      LC_ALL: "C",
      SOURCE_DATE_EPOCH: "0",
      TZ: "UTC",
    },
    repeatedBuilds: 2,
    byteIdenticalRepeat: true,
    binaryRelativePath: OUTPUT_RELATIVE_PATH,
    binaryImagePath: NATIVE_HELPER_IMAGE_PATH,
    binarySha256: createHash("sha256").update(first).digest("hex"),
    binaryBytes: first.byteLength,
    elf: facts,
    immutableBuilderImage: null,
    helperImageId: null,
    imageBuildVerified: false,
    hostInstallVerified: false,
    cgroupV2RuntimeVerified: false,
    liveEvidenceSigningEligible: false,
    passClaim: false,
  };
  mkdirSync(resolve(ROOT, "artifacts/security"), { recursive: true });
  writeFileSync(
    resolve(ROOT, REPORT_RELATIVE_PATH),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  rmSync(resolve(ROOT, OUTPUT_RELATIVE_PATH), { force: true });
  rmSync(resolve(ROOT, REPORT_RELATIVE_PATH), { force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
