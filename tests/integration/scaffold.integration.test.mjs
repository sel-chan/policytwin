import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REQUIRED_ROOT_SCRIPTS } from "../../dist/index.js";

test("root package exposes every repository-contract command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));
  for (const script of REQUIRED_ROOT_SCRIPTS) {
    assert.equal(typeof packageJson.scripts[script], "string", `missing script: ${script}`);
  }
});
