import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, executable, run } from "./process.mjs";
const verifyStatus = run(executable("pnpm"), ["verify"]);
await import("./build-core.mjs");
const { inspectSubmissionPackage } = await import("./submission-package-check.mjs");
const inspectedReport = await inspectSubmissionPackage(
  ROOT,
  Date.now(),
  verifyStatus === 0
    ? undefined
    : {
        probePublicLinks: async ({ liveUrl, repositoryUrl }) => ({
          valid: false,
          liveUrl,
          liveFinalUrl: null,
          liveStatusCode: null,
          repositoryUrl,
          repositoryHead: null,
          anonymousAccess: false,
          failures: ["Public link probes are disabled because fresh pnpm verify did not pass."],
        }),
      },
);
const report =
  verifyStatus === 0
    ? inspectedReport
    : {
        ...inspectedReport,
        status: "FAIL",
        failures: [
          ...new Set([
            ...inspectedReport.failures,
            "Fresh pnpm verify execution did not pass in this submission-check run.",
          ]),
        ].sort(),
      };
const submissionDirectory = resolve(ROOT, "artifacts", "submission");
mkdirSync(submissionDirectory, { recursive: true });
const reportPath = resolve(submissionDirectory, "submission-check-report.json");
if (existsSync(reportPath)) {
  const reportStat = lstatSync(reportPath);
  if (!reportStat.isFile() || reportStat.isSymbolicLink()) {
    console.error("Submission report target must be a plain regular file.");
    process.exit(1);
  }
}
writeFileSync(
  reportPath,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
if (report.failures.length > 0) {
  console.error(
    `Submission check is fail-closed with ${report.failures.length} unmet requirement(s).`,
  );
  for (const failure of report.failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Submission package static checks passed.");
