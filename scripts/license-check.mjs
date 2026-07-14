import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./process.mjs";

const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.optionalDependencies,
};
const hasLicense = existsSync(resolve(ROOT, "LICENSE"));
const hasNotice = existsSync(resolve(ROOT, "NOTICE.md"));
const failures = [];
if (!hasLicense) {
  failures.push("OWNER_DECISION_REQUIRED: project LICENSE is absent.");
}
if (!hasNotice) {
  failures.push("NOTICE.md is absent.");
}
const report = {
  schemaVersion: "1",
  status: failures.length === 0 ? "PASS" : "FAIL",
  projectLicensePresent: hasLicense,
  noticePresent: hasNotice,
  productionDependencies: Object.keys(dependencies).sort(),
  failures,
};
const directory = resolve(ROOT, "artifacts", "security");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "license-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (failures.length > 0) {
  console.error(`License check is fail-closed: ${failures.join(" ")}`);
  process.exit(1);
}
console.log("License and notice check passed.");
