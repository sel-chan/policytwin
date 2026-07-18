import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertDynamicDockerArguments,
  createPinnedDockerSync,
  exactDockerEnvironment,
} from "../../scripts/pinned-docker-cli.mjs";

test("dynamic Docker environment pins the local daemon and drops inherited routing", () => {
  const environment = exactDockerEnvironment({
    PATH: "C:\\untrusted",
    DOCKER_HOST: "tcp://attacker.example:2375",
    DOCKER_CONTEXT: "remote",
    DOCKER_TLS_VERIFY: "1",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\Temp",
  });
  assert.equal(
    environment.DOCKER_HOST,
    process.platform === "win32"
      ? "npipe:////./pipe/docker_engine"
      : "unix:///var/run/docker.sock",
  );
  assert.equal(environment.DOCKER_CLI_HINTS, "false");
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.SystemRoot, "C:\\Windows");
  assert.equal(environment.TEMP, "C:\\Temp");
  assert.equal("PATH" in environment, false);
  assert.equal("DOCKER_CONTEXT" in environment, false);
  assert.equal("DOCKER_TLS_VERIFY" in environment, false);
});

test("dynamic Docker command vocabulary is closed", () => {
  assert.doesNotThrow(() => assertDynamicDockerArguments(["container", "inspect", "a"]));
  assert.doesNotThrow(() => assertDynamicDockerArguments(["network", "rm", "b"]));
  assert.doesNotThrow(() => assertDynamicDockerArguments(["volume", "inspect", "c"]));
  assert.doesNotThrow(() => assertDynamicDockerArguments(["exec", "d", "node", "-v"]));
  assert.throws(
    () => assertDynamicDockerArguments(["context", "use", "remote"]),
    /not allowlisted/u,
  );
  assert.throws(() => assertDynamicDockerArguments(["run", "image"]), /not allowlisted/u);
  assert.throws(
    () => assertDynamicDockerArguments(["volume", "prune"]),
    /not allowlisted/u,
  );
  assert.throws(() => assertDynamicDockerArguments(["info\nrm"]), /unsafe/u);
});

test("dynamic Docker factory requires canonical absolute paths before execution", () => {
  assert.throws(
    () =>
      createPinnedDockerSync({
        repositoryRoot: ".",
        dockerExecutablePath: "docker",
        dockerExecutableSha256: "0".repeat(64),
      }),
    /absolute repository and CLI paths/u,
  );
  const executablePath = realpathSync.native(process.execPath);
  const executableSha256 = createHash("sha256")
    .update(readFileSync(executablePath))
    .digest("hex");
  assert.throws(
    () =>
      createPinnedDockerSync({
        repositoryRoot: realpathSync.native(resolve(".")),
        dockerExecutablePath: executablePath,
        dockerExecutableSha256: "0".repeat(64),
        environment: {},
      }),
    /reviewed SHA-256/u,
  );
  const factory = createPinnedDockerSync({
    repositoryRoot: realpathSync.native(resolve(".")),
    dockerExecutablePath: executablePath,
    dockerExecutableSha256: executableSha256,
    environment: {},
  });
  assert.equal(typeof factory, "function");
  assert.equal(typeof factory.binary, "function");
  assert.throws(
    () => factory.binary(["cp", "not-owned:/tmp/value", "-"]),
    /owned-container copy/u,
  );
});

test("dynamic Docker runner rechecks reviewed CLI bytes before every invocation", () => {
  const directory = mkdtempSync(join(tmpdir(), "policytwin-docker-cli-"));
  try {
    const executablePath = join(
      directory,
      process.platform === "win32" ? "docker.exe" : "docker",
    );
    copyFileSync(process.execPath, executablePath);
    const executableSha256 = createHash("sha256")
      .update(readFileSync(executablePath))
      .digest("hex");
    const docker = createPinnedDockerSync({
      repositoryRoot: realpathSync.native(resolve(".")),
      dockerExecutablePath: realpathSync.native(executablePath),
      dockerExecutableSha256: executableSha256,
      environment: {},
    });
    writeFileSync(executablePath, "tampered\n", "utf8");
    assert.throws(() => docker(["info"]), /reviewed SHA-256/u);
    assert.throws(
      () => docker.binary(["cp", `${"a".repeat(64)}:/helper`, "-"]),
      /reviewed SHA-256/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
