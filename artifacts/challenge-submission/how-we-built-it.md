# How we built it

We used Codex as the engineering workspace for repository mapping, implementation, adversarial test design, repeated independent review, and verification. GPT-5.6 was selected for the Build Week collaboration path. The repository also contains an explicitly opt-in `LOCAL_CHALLENGE` runner pinned to `gpt-5.6`; it uses the installed Codex SDK and existing Codex login against a disposable copy of the seeded fixture, then requires fixed server-owned typecheck and test commands, 41/41 policy cases, zero drift, and a separate read-only review.

Policy interpretation is admitted through a strict schema and source-traceability boundary. Accepted PolicyIR is compiled to Rego by deterministic TypeScript, not by model output. OPA 1.18.2 is checksum-pinned, and the same 41 accepted expectations are used for application differential testing. SQLite stores versioned policy decisions and fail-closed repair-run state. The Next.js interface exposes Policy Studio, Decision Queue, Case Lab, Integration / Drift, Proof, and Change Impact.

We kept the challenge demonstration honest by separating locally reproducible Build Week evidence from a stricter production-security gate. Recorded or offline evidence cannot promote itself to live production proof, and unavailable model, container, deployment, or attestation claims remain false.
