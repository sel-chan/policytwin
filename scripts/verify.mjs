import { executable, run } from "./process.mjs";

const steps = [
  "lint",
  "typecheck",
  "test",
  "test:integration",
  "security:check",
  "license:check",
  "container:check",
  "clean:check",
  "submission:draft",
  "submission:check",
  "eval",
  "demo:reset",
  "demo:run",
  "test:e2e",
  "build",
];
const failures = [];

for (const step of steps) {
  console.log(`\n[verify] pnpm ${step}`);
  const status = run(executable("pnpm"), [step]);
  if (status !== 0) {
    failures.push({ step, status });
  }
}

if (failures.length > 0) {
  console.error(
    `\nOffline verification failed as required for the incomplete repository: ${failures
      .map(({ step, status }) => `${step} (${status})`)
      .join(", ")}`,
  );
  process.exit(1);
}

console.log("Offline verification passed.");
