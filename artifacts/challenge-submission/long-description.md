# PolicyTwin

Business policies live in prose while customer decisions live in code. A single strict inequality or misplaced exception can silently change who receives a refund. PolicyTwin connects each policy sentence to an explicit decision, executable rule, edge case, application behavior, code location, and reviewable proof.

The seeded Build Week workflow starts with a synthetic SaaS refund policy. Policy Studio keeps source-clause traceability and a strict PolicyIR. Decision Queue records three material ambiguity choices instead of hiding them in a prompt. Deterministic code compiles the accepted model to Rego, and checksum-pinned OPA 1.18.2 evaluates 41 golden, boundary, conflict, and generated cases. Integration / Drift compares the same accepted expectations with a deliberately buggy TypeScript fixture and exposes 16 counterexamples caused by three defects: excluding exactly day 14, excluding exactly 20% usage, and allowing an approved promotion to bypass final-sale precedence.

The Proof view keeps claims attached to machine-readable evidence and leaves unavailable capabilities marked as not run. The local challenge profile is deliberately separate from the production `verify:live` contract: it may use a logged-in Codex SDK run on a disposable fixture, but it never claims cgroup-v2 isolation, direct Responses API evidence, deployment security, or production attestation.

Judges can reproduce the deterministic seeded workflow with `pnpm demo:run`, inspect all six views with `pnpm dev`, and run the full offline gate with `pnpm verify`.
