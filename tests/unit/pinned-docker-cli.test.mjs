import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
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
  assert.throws(
    () => assertDynamicDockerArguments(["context", "use", "remote"]),
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
      }),
    /absolute repository and CLI paths/u,
  );
  const factory = createPinnedDockerSync({
    repositoryRoot: realpathSync.native(resolve(".")),
    dockerExecutablePath: realpathSync.native(process.execPath),
    environment: {},
  });
  assert.equal(typeof factory, "function");
});
