import { rmSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { resetFixture } from "./fixture.mjs";
import { ROOT } from "./process.mjs";

const dataDirectory = resolve(ROOT, ".data");
const databasePath = resolve(dataDirectory, "policytwin.sqlite");
const configuredDatabasePath = process.env.POLICYTWIN_DATABASE_PATH?.trim();
if (configuredDatabasePath) {
  if (!isAbsolute(configuredDatabasePath)) {
    throw new Error("POLICYTWIN_DATABASE_PATH must be absolute when it is configured.");
  }
  const configuredResolved = resolve(configuredDatabasePath);
  const samePath =
    process.platform === "win32"
      ? configuredResolved.toLowerCase() === databasePath.toLowerCase()
      : configuredResolved === databasePath;
  if (!samePath) {
    throw new Error(
      "demo:reset refuses to delete a custom POLICYTWIN_DATABASE_PATH. Unset it to reset the repository-local seeded demo database.",
    );
  }
}
if (dirname(databasePath) !== dataDirectory) {
  throw new Error(`Refusing to reset unexpected demo database path: ${databasePath}`);
}
for (const suffix of ["", "-shm", "-wal"]) {
  try {
    rmSync(`${databasePath}${suffix}`, { force: true });
  } catch (error) {
    throw new Error(
      `Unable to reset the local demo database. Stop pnpm dev and retry: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

const result = resetFixture();
console.log(`Reset trusted refund fixture: ${result.currentHash}`);
console.log("Reset local persisted policy workspace to seeded v1.");
