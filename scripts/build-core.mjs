import { dirname, resolve } from "node:path";
import { rmSync } from "node:fs";
import { ROOT, executable, runOrExit } from "./process.mjs";

const outputDirectory = resolve(ROOT, "dist");
if (dirname(outputDirectory) !== resolve(ROOT)) throw new Error(`Refusing to clean unexpected output path: ${outputDirectory}`);
rmSync(outputDirectory, { recursive: true, force: true });
runOrExit(executable("tsc"), ["-p", "tsconfig.build.json"]);
console.log("Built PolicyTwin core into dist/.");
