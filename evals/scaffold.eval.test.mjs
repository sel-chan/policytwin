import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M0 keeps the live and offline verification contracts separate", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.notEqual(packageJson.scripts.verify, packageJson.scripts["verify:live"]);
  assert.match(packageJson.scripts.verify, /verify\.mjs/);
  assert.match(packageJson.scripts["verify:live"], /live-gate\.mjs/);
});
