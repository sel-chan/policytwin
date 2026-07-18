import { requestE2eShutdown } from "./e2e-lifecycle.mjs";

export default async function shutdownE2eServer() {
  await requestE2eShutdown();
}
