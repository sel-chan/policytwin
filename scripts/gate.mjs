const gate = process.argv[2] ?? "unknown";
const reasons = {
  dev: "The Next.js workspace has not been installed or implemented.",
  "test:e2e": "No browser application or Playwright suite exists yet.",
  "submission:check": "Submission artifacts and verified URLs do not exist yet.",
};

console.error(`${gate} is fail-closed: ${reasons[gate] ?? "Required capability is not implemented."}`);
process.exit(1);
