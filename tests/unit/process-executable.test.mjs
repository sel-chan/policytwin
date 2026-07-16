import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { executable, ROOT } from "../../scripts/process.mjs";

test("repository-local command shims take precedence over global PATH tools", () => {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const localTypeScript = resolve(ROOT, "node_modules", ".bin", `tsc${suffix}`);

  assert.equal(existsSync(localTypeScript), true);
  assert.equal(executable("tsc"), localTypeScript);
});

test("commands without a repository-local shim retain their platform fallback", () => {
  const name = "policytwin-command-that-does-not-exist";
  const suffix = process.platform === "win32" ? ".cmd" : "";

  assert.equal(executable(name), `${name}${suffix}`);
});
