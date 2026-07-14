import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, runOrExit } from "./process.mjs";

runOrExit(process.execPath, ["scripts/build.mjs"]);
const standaloneDirectory = resolve(ROOT, ".next", "standalone");
mkdirSync(resolve(standaloneDirectory, ".next"), { recursive: true });
cpSync(resolve(ROOT, "public"), resolve(standaloneDirectory, "public"), {
  recursive: true,
  force: true,
});
cpSync(resolve(ROOT, ".next", "static"), resolve(standaloneDirectory, ".next", "static"), {
  recursive: true,
  force: true,
});
process.env.HOSTNAME ??= "127.0.0.1";
process.env.PORT ??= "3210";
runOrExit(process.execPath, [resolve(standaloneDirectory, "server.js")]);
