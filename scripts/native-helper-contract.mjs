import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { computeContainerBuildInput } from "./container-build-inputs.mjs";
import { ROOT } from "./process.mjs";

export const NATIVE_HELPER_SOURCE_PATH = "native/policytwin-linux-cgroup-helper.c";
export const NATIVE_HELPER_DOCKERFILE_PATH = "Dockerfile.cgroup-helper";
export const NATIVE_HELPER_IMAGE_PATH = "/policytwin-linux-cgroup-helper";
export const NATIVE_HELPER_MAXIMUM_BYTES = 4 * 1024 * 1024;
export const NATIVE_HELPER_COMPILER_ARGUMENTS = Object.freeze([
  "-x",
  "c",
  "-std=c17",
  "-D_FORTIFY_SOURCE=3",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-Wpedantic",
  "-fstack-protector-strong",
  "-fPIE",
  "-fno-plt",
  "-fno-record-gcc-switches",
  "-static-pie",
  "-Wl,-z,relro,-z,now,-z,noexecstack",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IMMUTABLE_BUILDER_IMAGE =
  /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/u;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const PT_INTERP = 3;
const PT_GNU_STACK = 0x6474e551;
const PF_X = 1;
const DT_NULL = 0n;
const DT_NEEDED = 1n;

function safeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Native helper ${label} exceeds the safe integer range.`);
  }
  return Number(value);
}

function assertRange(buffer, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.byteLength
  ) {
    throw new Error(`Native helper ${label} is outside the ELF file.`);
  }
}

export function computeNativeHelperSource(root = ROOT) {
  const repositoryRoot = realpathSync(resolve(root));
  const path = resolve(repositoryRoot, NATIVE_HELPER_SOURCE_PATH);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024 * 1024) {
    throw new Error("Native helper source must be one bounded regular file.");
  }
  const canonical = realpathSync(path);
  const relativePath = relative(repositoryRoot, canonical).replaceAll("\\", "/");
  if (relativePath !== NATIVE_HELPER_SOURCE_PATH) {
    throw new Error("Native helper source escaped its fixed repository path.");
  }
  const body = readFileSync(canonical);
  return Object.freeze({
    schemaVersion: "1",
    relativePath,
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}

export function inspectNativeHelperDockerfile(value) {
  const failures = [];
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  const compilerCommand =
    `RUN cc ${NATIVE_HELPER_COMPILER_ARGUMENTS.join(" ")} ` +
    `-o ${NATIVE_HELPER_IMAGE_PATH} - < /src/policytwin-linux-cgroup-helper.c`;
  for (const marker of [
    "ARG HELPER_BUILDER_IMAGE",
    "FROM ${HELPER_BUILDER_IMAGE} AS builder",
    "SOURCE_DATE_EPOCH=0",
    `COPY ${NATIVE_HELPER_SOURCE_PATH} /src/policytwin-linux-cgroup-helper.c`,
    compilerCommand,
    "FROM scratch",
    `COPY --from=builder --chmod=0555 ${NATIVE_HELPER_IMAGE_PATH} ${NATIVE_HELPER_IMAGE_PATH}`,
  ]) {
    if (!normalized.includes(marker)) failures.push(`native helper Dockerfile is missing: ${marker}`);
  }
  if (/\b(?:ADD|apt|apk|dnf|yum|curl|wget)\b|https?:\/\//iu.test(normalized)) {
    failures.push("native helper Dockerfile may not fetch or install mutable build inputs");
  }
  if ((normalized.match(/\bFROM\b/gu) ?? []).length !== 2) {
    failures.push("native helper Dockerfile must contain exactly one builder and one scratch stage");
  }
  return failures;
}

export function inspectNativeHelperBinary(value) {
  const binary = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (binary.byteLength < 64 || binary.byteLength > NATIVE_HELPER_MAXIMUM_BYTES) {
    throw new Error("Native helper binary size is outside its fixed bound.");
  }
  if (
    binary[0] !== 0x7f ||
    binary[1] !== 0x45 ||
    binary[2] !== 0x4c ||
    binary[3] !== 0x46
  ) {
    throw new Error("Native helper binary is not ELF.");
  }
  if (binary[4] !== 2 || binary[5] !== 1 || binary[6] !== 1) {
    throw new Error("Native helper binary must be ELF64 little-endian version 1.");
  }
  if (binary.readUInt16LE(16) !== 3 || binary.readUInt16LE(18) !== 62) {
    throw new Error("Native helper binary must be an AMD64 position-independent executable.");
  }
  if (binary.readUInt32LE(20) !== 1 || binary.readUInt16LE(52) !== 64) {
    throw new Error("Native helper ELF header is invalid.");
  }
  const programHeaderOffset = safeNumber(binary.readBigUInt64LE(32), "program header offset");
  const programHeaderBytes = binary.readUInt16LE(54);
  const programHeaderCount = binary.readUInt16LE(56);
  if (programHeaderBytes !== 56 || programHeaderCount < 1 || programHeaderCount > 128) {
    throw new Error("Native helper ELF program header table is invalid.");
  }
  assertRange(
    binary,
    programHeaderOffset,
    programHeaderBytes * programHeaderCount,
    "program header table",
  );

  let executableLoad = false;
  let interpreterPresent = false;
  let gnuStackPresent = false;
  let executableStack = false;
  let neededLibraryCount = 0;
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset = programHeaderOffset + index * programHeaderBytes;
    const type = binary.readUInt32LE(offset);
    const flags = binary.readUInt32LE(offset + 4);
    const fileOffset = safeNumber(binary.readBigUInt64LE(offset + 8), "segment offset");
    const fileBytes = safeNumber(binary.readBigUInt64LE(offset + 32), "segment size");
    if (type === PT_LOAD && (flags & PF_X) !== 0) executableLoad = true;
    if (type === PT_INTERP) interpreterPresent = true;
    if (type === PT_GNU_STACK) {
      gnuStackPresent = true;
      executableStack = (flags & PF_X) !== 0;
    }
    if (type === PT_DYNAMIC) {
      if (fileBytes % 16 !== 0) throw new Error("Native helper dynamic table is malformed.");
      assertRange(binary, fileOffset, fileBytes, "dynamic table");
      let terminated = false;
      for (let dynamicOffset = fileOffset; dynamicOffset < fileOffset + fileBytes; dynamicOffset += 16) {
        const tag = binary.readBigInt64LE(dynamicOffset);
        if (tag === DT_NULL) {
          terminated = true;
          break;
        }
        if (tag === DT_NEEDED) neededLibraryCount += 1;
      }
      if (!terminated) throw new Error("Native helper dynamic table is not terminated.");
    }
  }
  if (interpreterPresent) {
    throw new Error("Native helper binary may not contain a runtime interpreter.");
  }
  if (neededLibraryCount !== 0) {
    throw new Error("Native helper binary may not require shared libraries.");
  }
  if (!executableLoad) throw new Error("Native helper binary has no executable load segment.");
  if (!gnuStackPresent || executableStack) {
    throw new Error("Native helper binary must declare a non-executable stack.");
  }
  return Object.freeze({
    schemaVersion: "1",
    elfClass: "ELF64",
    byteOrder: "LITTLE_ENDIAN",
    machine: "AMD64",
    staticPie: true,
    interpreterPresent,
    neededLibraryCount,
    gnuStackPresent,
    executableStack,
    executableLoadSegmentPresent: executableLoad,
    bytes: binary.byteLength,
    sha256: createHash("sha256").update(binary).digest("hex"),
  });
}

export function inspectNativeHelperPrerequisites(
  contract,
  observed = {
    buildInput: computeContainerBuildInput("helper"),
    source: computeNativeHelperSource(),
  },
) {
  const failures = [];
  if (contract?.schemaVersion !== "15") failures.push("container schema v15 is required");
  const helper = contract?.nativeHelper;
  if (helper?.builderImage === null || helper?.builderImage === undefined) {
    failures.push("immutable native helper builder image is unset");
  } else if (!IMMUTABLE_BUILDER_IMAGE.test(helper.builderImage)) {
    failures.push("native helper builder image is not immutable");
  }
  if (helper?.buildInputSha256 !== observed.buildInput.sha256) {
    failures.push("native helper build inputs do not match the contract");
  }
  if (helper?.sourceSha256 !== observed.source.sha256) {
    failures.push("native helper source does not match the contract");
  }
  if (
    helper?.status !== "STATIC_SOURCE_AND_PACKAGE_PREPARED" ||
    helper?.dockerfile !== NATIVE_HELPER_DOCKERFILE_PATH ||
    helper?.imagePath !== NATIVE_HELPER_IMAGE_PATH ||
    helper?.imageBuildVerified !== false ||
    helper?.hostInstallVerified !== false ||
    helper?.runtimeVerified !== false ||
    helper?.passSigningEligible !== false ||
    (helper?.image !== null && !/^sha256:[0-9a-f]{64}$/u.test(helper.image)) ||
    (helper?.binarySha256 !== null && !SHA256.test(helper.binarySha256))
  ) {
    failures.push("native helper static boundary is invalid");
  }
  return Object.freeze({
    schemaVersion: "1",
    status: failures.length === 0 ? "PASS" : "FAIL",
    dockerInvoked: false,
    failures: Object.freeze(failures),
  });
}
