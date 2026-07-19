import { SQLitePolicyRepository } from "../../dist/persistence/sqlite.js";
import { SQLiteRepairRunRepository } from "../../dist/repair-runs/sqlite.js";

const [
  policyDatabasePath,
  repairDatabasePath,
  policyId,
  storageGeneration,
  sessionSha256,
] = process.argv.slice(2);
const policyRepository = new SQLitePolicyRepository(policyDatabasePath);
const repairRepository = new SQLiteRepairRunRepository(repairDatabasePath);

function send(message, callback) {
  if (!process.send) {
    repairRepository.close();
    policyRepository.close();
    process.exitCode = 2;
    return;
  }
  process.send(message, callback);
}

process.once("message", (message) => {
  if (message?.type !== "START") {
    repairRepository.close();
    policyRepository.close();
    process.exitCode = 2;
    return;
  }
  send({ type: "ENTERING" }, () => {
    let result;
    try {
      const admission = policyRepository.withAnonymousWorkspaceGeneration(
        policyId,
        storageGeneration,
        () =>
          repairRepository.createOrGetRun(
            {
              clientRequestId: "81818181-8181-4181-8181-818181818181",
              sessionSha256,
              policyId,
              policyVersion: 1,
              policyIrSha256: "a".repeat(64),
              inputSha256: "b".repeat(64),
              createdAt: "2026-07-20T00:00:00.000Z",
            },
            { ownerId: `reo_${"8".repeat(32)}`, leaseDurationMs: 60_000 },
          ),
      );
      result = {
        type: "RESULT",
        outcome: admission.matched ? "ADMITTED" : "NOT_MATCHED",
      };
    } catch (error) {
      result = {
        type: "RESULT",
        outcome: "ERROR",
        code: typeof error?.code === "string" ? error.code : "UNKNOWN",
      };
    }
    send(result, () => {
      repairRepository.close();
      policyRepository.close();
      process.disconnect();
    });
  });
});

send({ type: "READY" });
