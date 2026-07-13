import { dirname, resolve } from "node:path";
import { rmSync } from "node:fs";
import { ROOT, executable, runOrExit } from "./process.mjs";

const outputDirectory = resolve(ROOT, ".tmp", "fixture-build");
if (dirname(outputDirectory) !== resolve(ROOT, ".tmp")) {
  throw new Error(`Refusing to clean unexpected fixture output path: ${outputDirectory}`);
}

rmSync(outputDirectory, { recursive: true, force: true });
runOrExit(executable("tsc"), ["-p", "tsconfig.fixtures.json"]);
