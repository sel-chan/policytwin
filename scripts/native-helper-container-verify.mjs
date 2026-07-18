import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeContainerBuildInput } from "./container-build-inputs.mjs";
import {
  NATIVE_HELPER_IMAGE_PATH,
  computeNativeHelperSource,
  inspectNativeHelperBinary,
  inspectNativeHelperPrerequisites,
} from "./native-helper-contract.mjs";
import { createPinnedDockerSync } from "./pinned-docker-cli.mjs";
import { ROOT } from "./process.mjs";

function parseOctal(field, label) {
  const value = field.toString("ascii").replaceAll("\0", "").trim();
  if (!/^[0-7]+$/u.test(value)) throw new Error(`Helper archive ${label} is invalid.`);
  return Number.parseInt(value, 8);
}

export function extractNativeHelperTar(value) {
  const archive = Buffer.from(value);
  let offset = 0;
  let helper = null;
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = parseOctal(header.subarray(148, 156), "checksum");
    let checksum = 0;
    for (let index = 0; index < 512; index += 1) {
      checksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (checksum !== storedChecksum) throw new Error("Helper archive checksum is invalid.");
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/su, "");
    const size = parseOctal(header.subarray(124, 136), "size");
    const mode = parseOctal(header.subarray(100, 108), "mode") & 0o7777;
    const uid = parseOctal(header.subarray(108, 116), "uid");
    const gid = parseOctal(header.subarray(116, 124), "gid");
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const bodyOffset = offset + 512;
    if (bodyOffset + size > archive.byteLength) {
      throw new Error("Helper archive body is truncated.");
    }
    if (name === NATIVE_HELPER_IMAGE_PATH.slice(1) || name === `.${NATIVE_HELPER_IMAGE_PATH}`) {
      if (helper !== null || type !== "0" || mode !== 0o555 || uid !== 0 || gid !== 0) {
        throw new Error("Helper archive entry ownership or mode is invalid.");
      }
      helper = Buffer.from(archive.subarray(bodyOffset, bodyOffset + size));
    }
    offset = bodyOffset + Math.ceil(size / 512) * 512;
  }
  if (helper === null) throw new Error("Helper archive did not contain the fixed binary path.");
  return helper;
}

function binaryDockerCopy(docker, containerId) {
  const args = ["cp", `${containerId}:${NATIVE_HELPER_IMAGE_PATH}`, "-"];
  const result = docker.binary(args, 60_000);
  return extractNativeHelperTar(result.stdout);
}

function main() {
  const contract = JSON.parse(readFileSync(resolve(ROOT, "container-contract.json"), "utf8"));
  const buildInput = computeContainerBuildInput("helper");
  const source = computeNativeHelperSource();
  const readiness = inspectNativeHelperPrerequisites(contract, { buildInput, source });
  const report = {
    schemaVersion: "1",
    status: "FAIL",
    scope: "IMMUTABLE_NATIVE_HELPER_ARTIFACT_IMAGE",
    dockerInvoked: false,
    dockerServerVersion: null,
    builderImage: contract?.nativeHelper?.builderImage ?? null,
    builderImagePresent: false,
    buildInputSha256: buildInput.sha256,
    sourceSha256: source.sha256,
    helperImageId: null,
    expectedHelperImageId: contract?.nativeHelper?.image ?? null,
    binarySha256: null,
    expectedBinarySha256: contract?.nativeHelper?.binarySha256 ?? null,
    binaryMode: null,
    binaryOwner: null,
    elf: null,
    imageBuildVerified: false,
    hostInstallVerified: false,
    cgroupV2RuntimeVerified: false,
    passSigningEligible: false,
    failures: [...readiness.failures],
  };
  let docker = null;
  let tag = null;
  let containerId = null;
  try {
    if (report.failures.length === 0) {
      docker = createPinnedDockerSync({
        repositoryRoot: ROOT,
        dockerExecutablePath: process.env.POLICYTWIN_DOCKER_CLI,
        dockerExecutableSha256: contract.supervisorDockerExecutor?.dockerCliSha256,
      });
      report.dockerInvoked = true;
      report.dockerServerVersion = docker(
        ["info", "--format", "{{.ServerVersion}}"],
        10_000,
      ).stdout.trim();
      const builderInspection = docker(
        ["image", "inspect", contract.nativeHelper.builderImage],
        30_000,
        true,
      );
      if (builderInspection.status !== 0) {
        throw new Error(
          "Immutable native helper builder image is not present locally; no pull was attempted.",
        );
      }
      report.builderImagePresent = true;
      const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
      tag = `policytwin-native-helper-verify:${suffix}`;
      docker(
        [
          "build",
          "--pull=false",
          "--network=none",
          "--platform",
          contract.targetPlatform,
          "--build-arg",
          `HELPER_BUILDER_IMAGE=${contract.nativeHelper.builderImage}`,
          "--file",
          "Dockerfile.cgroup-helper",
          "--tag",
          tag,
          ".",
        ],
        20 * 60_000,
      );
      report.helperImageId = docker(["image", "inspect", "--format", "{{.Id}}", tag])
        .stdout.trim();
      if (!/^sha256:[0-9a-f]{64}$/u.test(report.helperImageId)) {
        throw new Error("Native helper image did not resolve to one immutable ID.");
      }
      containerId = docker([
        "create",
        "--network",
        "none",
        tag,
        NATIVE_HELPER_IMAGE_PATH,
      ]).stdout.trim();
      if (!/^[0-9a-f]{64}$/u.test(containerId)) {
        throw new Error("Native helper extraction container ID is invalid.");
      }
      const binary = binaryDockerCopy(docker, containerId);
      const elf = inspectNativeHelperBinary(binary);
      report.binarySha256 = elf.sha256;
      report.binaryMode = "0555";
      report.binaryOwner = "0:0";
      report.elf = elf;
      if (report.expectedHelperImageId === null) {
        report.failures.push("native helper image ID is not pinned in the contract");
      } else if (report.expectedHelperImageId !== report.helperImageId) {
        report.failures.push("native helper image ID does not match the contract");
      }
      if (report.expectedBinarySha256 === null) {
        report.failures.push("native helper binary SHA-256 is not pinned in the contract");
      } else if (report.expectedBinarySha256 !== report.binarySha256) {
        report.failures.push("native helper binary SHA-256 does not match the contract");
      }
      report.imageBuildVerified = report.failures.length === 0;
    }
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (docker !== null && containerId !== null) {
      const cleanup = docker(["rm", "--force", containerId], 30_000, true);
      if (cleanup.status !== 0) report.failures.push("native helper extraction container cleanup failed");
    }
    if (docker !== null && tag !== null) {
      const cleanup = docker(["image", "rm", "--force", tag], 30_000, true);
      if (cleanup.status !== 0) report.failures.push("native helper verification image cleanup failed");
    }
  }
  report.status = report.failures.length === 0 && report.imageBuildVerified ? "PASS" : "FAIL";
  mkdirSync(resolve(ROOT, "artifacts/security"), { recursive: true });
  writeFileSync(
    resolve(ROOT, "artifacts/security/native-helper-container-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
