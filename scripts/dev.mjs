import { executable, runOrExit } from "./process.mjs";

runOrExit(process.execPath, ["scripts/build-core.mjs"]);
runOrExit(executable("next"), ["dev", ...process.argv.slice(2)]);
