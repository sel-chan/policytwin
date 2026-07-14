import { DecisionQueueClient } from "./decision-queue-client";

export const metadata = { title: "Decision Queue" };
export const dynamic = "force-dynamic";

export default function DecisionsPage() {
  return <DecisionQueueClient />;
}
