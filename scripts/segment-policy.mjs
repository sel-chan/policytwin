import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { segmentPolicyClauses } from "../dist/index.js";
import { ROOT } from "./process.mjs";

const inputPath = resolve(ROOT, process.argv[2] ?? "");
if (relative(ROOT, inputPath).startsWith("..")) {
  throw new Error(`Policy path must stay inside the repository: ${inputPath}`);
}

const policyText = await readFile(inputPath, "utf8");
console.log(JSON.stringify(segmentPolicyClauses(policyText), null, 2));
