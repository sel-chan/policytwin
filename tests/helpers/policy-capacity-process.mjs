import { SQLitePolicyRepository } from "../../dist/persistence/sqlite.js";

const [databasePath, projectJson, scopeJson] = process.argv.slice(2);
const project = JSON.parse(projectJson);
const scope = JSON.parse(scopeJson);
let repository;

function send(message, callback) {
  if (!process.send) {
    repository?.close();
    process.exitCode = 2;
    return;
  }
  process.send(message, callback);
}

process.once("message", (message) => {
  if (message?.type !== "START") {
    repository?.close();
    process.exitCode = 2;
    return;
  }
  send({ type: "ENTERING" }, () => {
    let result;
    try {
      repository = new SQLitePolicyRepository(databasePath);
      const created = repository.createProjectWithinCapacity(project, scope);
      result = { type: "RESULT", outcome: "CREATED", id: created.id };
    } catch (error) {
      result = {
        type: "RESULT",
        outcome: "ERROR",
        code: typeof error?.code === "string" ? error.code : "UNKNOWN",
      };
    }
    send(result, () => {
      repository?.close();
      process.disconnect();
    });
  });
});

send({ type: "READY" });
