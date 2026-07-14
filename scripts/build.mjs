import { executable, runOrExit } from "./process.mjs";

runOrExit(process.execPath, ["scripts/build-core.mjs"]);
runOrExit(executable("next"), ["build"]);
console.log("Built PolicyTwin core and Next.js workspace.");
