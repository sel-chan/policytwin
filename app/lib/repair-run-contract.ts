import type {
  RepairRunEvent,
  RepairRunRecord,
} from "../../dist/repair-runs/types.js";
import { SEEDED_WORKSPACE_API, workspaceErrorCode } from "./workspace-contract";

export function seededRepairRunApi(version: number): string {
  return `${SEEDED_WORKSPACE_API}/versions/${version}/repair-runs`;
}

export interface RepairRunResponse {
  schemaVersion: "1";
  run: RepairRunRecord;
  events: RepairRunEvent[];
  created: boolean;
}

export interface LatestRepairRunResponse {
  schemaVersion: "1";
  run: RepairRunRecord | null;
  events: RepairRunEvent[];
}

export function repairRunErrorMessage(error: unknown): string {
  const code = workspaceErrorCode(error);
  const messages: Record<string, string> = {
    POLICY_NOT_READY: "Resolve every policy ambiguity before starting a repair run.",
    REFERENCE_POLICY_MISMATCH:
      "The guarded repair demo accepts only the exact seeded reference policy and golden cases.",
    REPAIR_RUN_BUSY: "The guarded repair executor already has an active or fail-stop run.",
    REPAIR_RUN_CAPACITY: "This session reached the bounded repair-run history limit.",
    REPAIR_RUN_IDEMPOTENCY_CONFLICT:
      "That request identity was already used for different repair input.",
    REPAIR_RUN_NOT_FOUND: "The requested repair run is not available in this browser session.",
  };
  return messages[code ?? ""] ?? "The guarded repair run could not be started or restored.";
}
