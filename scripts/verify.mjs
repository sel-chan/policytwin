import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOfflineVerifyReceipt, OFFLINE_VERIFY_STEPS } from "./offline-verify-receipt.mjs";
import { ROOT, executable, run } from "./process.mjs";

const failures = [];
const results = [];

for (const step of OFFLINE_VERIFY_STEPS) {
  console.log(`\n[verify] pnpm ${step}`);
  const status = run(executable("pnpm"), [step]);
  results.push({ step, status });
  if (status !== 0) {
    failures.push({ step, status });
  }
}

const reportDirectory = resolve(ROOT, "artifacts", "security");
mkdirSync(reportDirectory, { recursive: true });
writeFileSync(
  resolve(reportDirectory, "offline-verify-report.json"),
  `${JSON.stringify(createOfflineVerifyReceipt(ROOT, results), null, 2)}\n`,
  "utf8",
);

if (failures.length > 0) {
  console.error(
    `\nOffline verification failed as required for the incomplete repository: ${failures
      .map(({ step, status }) => `${step} (${status})`)
      .join(", ")}`,
  );
  process.exit(1);
}

console.log("Offline verification passed.");
