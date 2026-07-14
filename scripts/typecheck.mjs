import { executable, runOrExit } from "./process.mjs";

runOrExit(process.execPath, ["scripts/build-core.mjs"]);
runOrExit(executable("tsc"), ["--noEmit", "-p", "tsconfig.json"]);
