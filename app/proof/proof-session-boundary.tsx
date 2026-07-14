"use client";

import { useEffect, useState } from "react";
import { policyMeaningFingerprint } from "../lib/policy-meaning";
import {
  SEEDED_WORKSPACE_API,
  type WorkspaceGetResponse,
  workspaceErrorMessage,
  workspaceResponse,
} from "../lib/workspace-contract";

export function ProofSessionBoundary({
  referencePolicyMeaning,
  referenceVersion,
}: {
  referencePolicyMeaning: string;
  referenceVersion: number;
}) {
  const [matches, setMatches] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${SEEDED_WORKSPACE_API}/workspace`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await workspaceResponse<WorkspaceGetResponse>(response);
        const latestPolicy = data.latestValidatedVersion.policyIR;
        if (!controller.signal.aborted) {
          setMatches(
            latestPolicy !== null &&
              policyMeaningFingerprint(latestPolicy) === referencePolicyMeaning,
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(workspaceErrorMessage(error));
        }
      }
    })();
    return () => controller.abort();
  }, [referencePolicyMeaning]);

  if (errorMessage) {
    return (
      <div className="inline-alert" role="alert">
        <strong>Session-to-proof mapping unavailable.</strong>
        <span>{errorMessage} Downloads below remain recorded reference artifacts only.</span>
      </div>
    );
  }
  if (matches === null) {
    return (
      <div className="proof-session-boundary" role="status">
        <strong>Checking this session against recorded reference v{referenceVersion}…</strong>
      </div>
    );
  }
  if (!matches) {
    return (
      <div className="inline-alert" role="alert">
        <strong>Recorded proof does not match this session.</strong>
        <span>
          The downloads below prove only the seeded reference choices. They are not evidence for
          this browser&apos;s latest accepted PolicyIR.
        </span>
      </div>
    );
  }
  return (
    <div className="proof-session-boundary match" role="status">
      <strong>This session matches recorded reference v{referenceVersion}.</strong>
      <span>The latest accepted PolicyIR meaning matches the policy in the evidence package.</span>
    </div>
  );
}
