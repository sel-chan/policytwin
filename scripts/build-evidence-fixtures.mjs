import { existsSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { ROOT, executable, runOrExit } from "./process.mjs";

const outputDirectory = resolve(ROOT, ".tmp", "evidence-fixture-build");
if (
  dirname(outputDirectory) !== resolve(ROOT, ".tmp") ||
  relative(ROOT, outputDirectory).startsWith("..")
) {
  throw new Error(`Refusing to clean unexpected evidence fixture path: ${outputDirectory}`);
}

rmSync(outputDirectory, { recursive: true, force: true });
runOrExit(executable("tsc"), [
  "-p",
  "tsconfig.fixtures.json",
  "--outDir",
  ".tmp/evidence-fixture-build",
]);

for (const fixture of ["baseline", "expected-fixed"]) {
  const output = resolve(outputDirectory, fixture, "src", "refund.js");
  if (!existsSync(output)) {
    throw new Error(`Fixture compiler did not emit ${relative(ROOT, output)}.`);
  }
}
