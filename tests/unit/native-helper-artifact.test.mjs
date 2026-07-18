import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { computeContainerBuildInput } from "../../scripts/container-build-inputs.mjs";
import { extractNativeHelperTar } from "../../scripts/native-helper-container-verify.mjs";
import {
  NATIVE_HELPER_COMPILER_ARGUMENTS,
  computeNativeHelperSource,
  inspectNativeHelperBinary,
  inspectNativeHelperDockerfile,
  inspectNativeHelperPrerequisites,
} from "../../scripts/native-helper-contract.mjs";

function minimalStaticPie() {
  const programHeaderOffset = 64;
  const programHeaderBytes = 56;
  const dynamicOffset = programHeaderOffset + programHeaderBytes * 3;
  const binary = Buffer.alloc(dynamicOffset + 32);
  binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0);
  binary.writeUInt16LE(3, 16);
  binary.writeUInt16LE(62, 18);
  binary.writeUInt32LE(1, 20);
  binary.writeBigUInt64LE(BigInt(programHeaderOffset), 32);
  binary.writeUInt16LE(64, 52);
  binary.writeUInt16LE(programHeaderBytes, 54);
  binary.writeUInt16LE(3, 56);

  binary.writeUInt32LE(1, programHeaderOffset);
  binary.writeUInt32LE(5, programHeaderOffset + 4);
  binary.writeBigUInt64LE(0n, programHeaderOffset + 8);
  binary.writeBigUInt64LE(BigInt(binary.byteLength), programHeaderOffset + 32);

  const stackHeader = programHeaderOffset + programHeaderBytes;
  binary.writeUInt32LE(0x6474e551, stackHeader);
  binary.writeUInt32LE(6, stackHeader + 4);

  const dynamicHeader = stackHeader + programHeaderBytes;
  binary.writeUInt32LE(2, dynamicHeader);
  binary.writeUInt32LE(6, dynamicHeader + 4);
  binary.writeBigUInt64LE(BigInt(dynamicOffset), dynamicHeader + 8);
  binary.writeBigUInt64LE(32n, dynamicHeader + 32);
  return binary;
}

function tarWithHelper(body, { mode = 0o555, uid = 0, gid = 0 } = {}) {
  const header = Buffer.alloc(512);
  header.write("policytwin-linux-cgroup-helper", 0, "ascii");
  const octal = (value, bytes) => `${value.toString(8).padStart(bytes - 1, "0")}\0`;
  header.write(octal(mode, 8), 100, "ascii");
  header.write(octal(uid, 8), 108, "ascii");
  header.write(octal(gid, 8), 116, "ascii");
  header.write(octal(body.byteLength, 12), 124, "ascii");
  header.write(octal(0, 12), 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  const padding = Buffer.alloc(Math.ceil(body.byteLength / 512) * 512 - body.byteLength);
  return Buffer.concat([header, body, padding, Buffer.alloc(1024)]);
}

test("native helper source, Dockerfile, and build inputs form one immutable contract", async () => {
  const source = computeNativeHelperSource();
  assert.match(source.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(source.relativePath, "native/policytwin-linux-cgroup-helper.c");
  assert.equal(source.bytes > 0, true);

  const dockerfile = await readFile(resolve("Dockerfile.cgroup-helper"), "utf8");
  assert.deepEqual(inspectNativeHelperDockerfile(dockerfile), []);
  assert.equal(NATIVE_HELPER_COMPILER_ARGUMENTS.includes("-static-pie"), true);
  assert.equal(NATIVE_HELPER_COMPILER_ARGUMENTS.includes("-fstack-protector-strong"), true);

  const input = computeContainerBuildInput("helper");
  assert.equal(input.files.includes("Dockerfile.cgroup-helper"), true);
  assert.equal(input.files.includes("native/policytwin-linux-cgroup-helper.c"), true);
  assert.equal(input.files.includes("scripts/native-helper-contract.mjs"), true);
});

test("native helper local build invalidates stale evidence when compilation fails", async () => {
  const builder = await readFile(resolve("scripts/native-helper-build.mjs"), "utf8");
  assert.match(
    builder,
    /catch \(error\) \{[\s\S]*rmSync\(resolve\(ROOT, REPORT_RELATIVE_PATH\), \{ force: true \}\)/u,
  );
});

test("native helper binary extraction cannot bypass the pinned Docker runner", async () => {
  const verifier = await readFile(
    resolve("scripts/native-helper-container-verify.mjs"),
    "utf8",
  );
  assert.match(verifier, /docker\.binary\(args, 60_000\)/u);
  assert.doesNotMatch(verifier, /spawnSync/u);
  assert.doesNotMatch(verifier, /process\.env\.POLICYTWIN_DOCKER_CLI, containerId/u);
});

test("native helper prerequisites fail closed before Docker and detect input tampering", async () => {
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  const report = inspectNativeHelperPrerequisites(contract);
  assert.equal(report.status, "FAIL");
  assert.equal(report.dockerInvoked, false);
  assert.deepEqual(report.failures, ["immutable native helper builder image is unset"]);

  const buildInput = computeContainerBuildInput("helper");
  const source = computeNativeHelperSource();
  const tampered = inspectNativeHelperPrerequisites(contract, {
    buildInput: { ...buildInput, sha256: "0".repeat(64) },
    source,
  });
  assert.match(tampered.failures.join(" "), /helper build inputs do not match/u);
});

test("native helper ELF inspection requires amd64 static PIE and a non-executable stack", () => {
  const binary = minimalStaticPie();
  const facts = inspectNativeHelperBinary(binary);
  assert.equal(facts.elfClass, "ELF64");
  assert.equal(facts.machine, "AMD64");
  assert.equal(facts.staticPie, true);
  assert.equal(facts.interpreterPresent, false);
  assert.equal(facts.neededLibraryCount, 0);
  assert.equal(facts.executableStack, false);

  const interpreter = Buffer.from(binary);
  interpreter.writeUInt32LE(3, 64 + 56);
  assert.throws(() => inspectNativeHelperBinary(interpreter), /interpreter/u);

  const executableStack = Buffer.from(binary);
  executableStack.writeUInt32LE(7, 64 + 56 + 4);
  assert.throws(() => inspectNativeHelperBinary(executableStack), /executable stack/u);

  const neededLibrary = Buffer.from(binary);
  neededLibrary.writeBigInt64LE(1n, binary.byteLength - 32);
  assert.throws(() => inspectNativeHelperBinary(neededLibrary), /shared libraries/u);
});

test("native helper Docker extraction accepts only the fixed root-owned 0555 tar entry", () => {
  const body = Buffer.from("helper-binary", "utf8");
  assert.deepEqual(extractNativeHelperTar(tarWithHelper(body)), body);
  assert.throws(
    () => extractNativeHelperTar(tarWithHelper(body, { mode: 0o755 })),
    /ownership or mode/u,
  );
  assert.throws(
    () => extractNativeHelperTar(tarWithHelper(body, { uid: 1000 })),
    /ownership or mode/u,
  );
  const corrupted = tarWithHelper(body);
  corrupted[148] ^= 1;
  assert.throws(() => extractNativeHelperTar(corrupted), /checksum/u);
});
