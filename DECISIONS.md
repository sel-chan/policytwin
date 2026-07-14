# DECISIONS.md — PolicyTwin Decision Log

Record durable product and technical decisions here. Do not use this file for routine progress. Each decision must be based on evidence and must preserve `AGENTS.md` and `PLAN.md`.

## Decision template

### D-XXX — Title

- Date:
- Status: `PROPOSED | ACCEPTED | SUPERSEDED | REJECTED`
- Milestone:
- Context:
- Options considered:
  1. Option A
  2. Option B
- Decision:
- Evidence:
- Consequences:
- Risks:
- Reversal or migration path:
- Related files/commits:

---

## Accepted baseline decisions

### D-001 — Narrow the MVP to SaaS refund eligibility

- Date: 2026-07-13
- Status: `ACCEPTED`
- Milestone: planning
- Context: A broad policy platform would dilute the demo and make validation unreliable.
- Options considered:
  1. general-purpose policy platform;
  2. one refund-policy vertical slice.
- Decision: Build one complete SaaS refund-policy flow with `ALLOW`, `DENY`, and `REVIEW`.
- Evidence: `PLAN.md` product boundary and demo contract.
- Consequences: The product can show end-to-end proof rather than shallow domain breadth.
- Risks: Reviewers may mistake it for a refund-only product.
- Reversal or migration path: Present refund as the first policy pack and document the general `PolicyIR` boundary.
- Related files/commits: `PLAN.md`.

### D-002 — GPT-5.6 interprets meaning; deterministic code executes policy

- Date: 2026-07-13
- Status: `ACCEPTED`
- Milestone: planning
- Context: Model-generated executable policy is difficult to reproduce and audit.
- Options considered:
  1. ask the model to write Rego directly;
  2. ask the model for strict `PolicyIR`, then compile deterministically.
- Decision: Use strict Structured Outputs to produce `PolicyIR`; a pure compiler generates Rego.
- Evidence: product proof requirements.
- Consequences: Better reproducibility, traceability, mutation testing, and security.
- Risks: The IR/compiler requires more implementation.
- Reversal or migration path: Extend the IR, not direct-code generation.
- Related files/commits: `PLAN.md`, future `packages/policy-ir`, `packages/policy-compiler`.

### D-003 — Hosted repair supports only the bundled trusted fixture

- Date: 2026-07-13
- Status: `ACCEPTED`
- Milestone: planning
- Context: Arbitrary repository execution creates security and deployment risk that is unnecessary for the challenge demo.
- Options considered:
  1. accept arbitrary repositories;
  2. run only a bundled fixture.
- Decision: Use a fresh temporary copy of the bundled TypeScript fixture for each Codex repair.
- Evidence: threat boundary and deadline.
- Consequences: Reliable, safe, repeatable demo.
- Risks: Less apparent generality.
- Reversal or migration path: Add isolated customer-owned runners after the hackathon.
- Related files/commits: `PLAN.md`, future `docs/threat-model.md`.

### D-004 — Evidence, not model confidence, determines success

- Date: 2026-07-13
- Status: `ACCEPTED`
- Milestone: planning
- Context: A model confidence number is not proof that policy and software agree.
- Options considered:
  1. display model confidence;
  2. display executed tests, drift, mutation, traceability, and hashes.
- Decision: Do not use confidence as a top-level success metric.
- Evidence: product thesis.
- Consequences: Proof screen is grounded in reproducible artifacts.
- Risks: More engineering work.
- Reversal or migration path: Confidence may be shown only as secondary diagnostic metadata.
- Related files/commits: `PLAN.md`.

## New decisions

Add new entries below this line with the template above.

### D-005 — Do not turn explicit seeded semantics into ambiguity cards

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M0
- Context: The seeded policy explicitly includes day 14, includes 20% usage, keeps undecided promotions in review, and gives final sale overriding denial, while the original demo plan asked some of those facts again.
- Options considered:
  1. weaken the policy text so those facts become ambiguous;
  2. keep the strong policy contract and ask only genuinely unresolved questions.
- Decision: Keep the explicit policy facts and limit the seeded Decision Queue to purchase-day indexing, usage measurement time, and the no-match default.
- Evidence: `PLAN.md` sections 4.1–4.2 and the preflight review.
- Consequences: The three seeded code defects remain exact policy drift, while the ambiguity UI demonstrates real missing semantics.
- Risks: Fewer ambiguity cards in the demo.
- Reversal or migration path: Add separate intentionally ambiguous policy fixtures without weakening the seeded contract.
- Related files/commits: `PLAN.md`, `SUBMISSION.md`.

### D-006 — Split deterministic offline and fresh live verification

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M0
- Context: A single deterministic `pnpm verify` cannot both avoid external variability and prove fresh GPT/Codex execution.
- Options considered:
  1. let one command mix deterministic and external work;
  2. define separate offline and live gates.
- Decision: `pnpm verify` is the deterministic offline gate; `pnpm verify:live` performs fresh GPT-5.6 and Codex integration. Both are mandatory for completion.
- Evidence: reproducibility and truthful-evidence requirements.
- Consequences: Local regression remains stable while submission evidence proves real model and Codex work.
- Risks: Two gates increase release time and require freshness validation.
- Reversal or migration path: A wrapper may run both commands, but their evidence and semantics remain separate.
- Related files/commits: `AGENTS.md`, `PLAN.md`, `GOAL_PROMPT.md`, `SUBMISSION.md`.

### D-007 — Use the current branch and require scoped approval for network work

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M0
- Context: The active owner instructions require current-branch commits and approval before external network calls, while the original pack allowed worktrees, new branches, and autonomous publishing.
- Options considered:
  1. preserve the generic pack defaults;
  2. align repository rules with the active owner contract.
- Decision: Commit on the current branch, use subagents only for read-only review by default, and obtain explicit approval for a stated network scope before installs, lookups, pushes, deployments, uploads, or submission.
- Evidence: active workspace instructions and owner authorization for local Git initialization.
- Consequences: Local work can continue autonomously without exceeding permissions.
- Risks: External verification may wait for approval.
- Reversal or migration path: The owner may explicitly authorize a broader network scope or isolated worktree workflow.
- Related files/commits: `AGENTS.md`, `GOAL_PROMPT.md`, `START_HERE.md`, `START_HERE_KO.md`.

### D-008 — Restrict ambiguity resolution to a closed `PolicyPatch` union

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M0
- Context: `PolicyPatch` was referenced but undefined, allowing an implementation to drift toward arbitrary JSON mutation.
- Options considered:
  1. JSON Patch or free-form partial objects;
  2. a versioned union of domain-specific commands.
- Decision: Allow only normalization, boundary operator, missing outcome, precedence, and default-decision commands with fixed category mapping and full post-apply validation.
- Evidence: policy-engineering safety and traceability invariants.
- Consequences: Ambiguity decisions are auditable, idempotent, and schema constrained.
- Risks: New ambiguity categories require deliberate schema evolution.
- Reversal or migration path: Add a new union member and schema version with migration tests.
- Related files/commits: `PLAN.md` FR-04 and FR-05.

### D-009 — Enforce a 90% non-equivalent mutation kill rate

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M0
- Context: The pack alternated between a strict 90% gate and allowing documented survivors as a substitute.
- Options considered:
  1. waive the threshold when survivors are documented;
  2. require 90% over non-equivalent mutants and report all survivors.
- Decision: Verification fails below 90% over non-equivalent mutants. Equivalent exclusions require deterministic justification, and every surviving non-equivalent mutant must be reported.
- Evidence: `PLAN.md` mutation metric and truthful proof requirements.
- Consequences: Documentation improves transparency but cannot weaken the quantitative gate.
- Risks: The case corpus may need additional iteration.
- Reversal or migration path: Change the numeric threshold only through an explicit product-contract decision supported by evidence.
- Related files/commits: `AGENTS.md`, `PLAN.md`, `GOAL_PROMPT.md`.

### D-010 — Keep recorded interpretation evidence distinct from live model evidence

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M2
- Context: The project-local package cache is empty, no OpenAI credentials are configured, and external documentation lookup or dependency installation requires an owner-approved network scope.
- Options considered:
  1. block all M2 work until network access is approved;
  2. build strict dependency-free contracts and clearly labeled recorded fixtures, then add pinned Zod and live Responses API integration after approval;
  3. present a hand-authored fixture as if it were a current model response.
- Decision: Implement the offline `PolicyIR` types, runtime semantic validator, JSON Schema, clause segmentation, prompt contract, and eval corpus now. Mark every hand-authored output `RECORDED_FIXTURE` with a non-model identifier. Do not pass M2 or `verify:live` until current official documentation is checked, project-local Zod/OpenAI dependencies are pinned, and a fresh GPT-5.6 request with request metadata passes the same contracts.
- Evidence: empty pnpm store, absent API environment variables, fail-closed live gate, and `fixtures/interpreter/recorded-policy-ir.v1.json` metadata.
- Consequences: Offline schema and security work remains testable without fabricating live evidence; M2 intentionally remains in progress.
- Risks: The dependency-free validator duplicates some later Zod constraints and must be cross-checked when Zod is introduced.
- Reversal or migration path: Make Zod/JSON Schema the shared authoritative runtime contract while retaining the deterministic semantic checks for cross-reference, priority, and patch-target invariants.
- Related files/commits: `src/policy-ir/`, `schemas/policy-ir.v1.schema.json`, `prompts/interpreter.v1.md`, `PROGRESS.md`.

### D-011 — Separate repair orchestration contracts from live Codex evidence

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M7
- Context: Current Codex SDK documentation and packages cannot be fetched without approved network scope, but trusted-copy isolation, command safety, result validation, retry bounds, and review policy can be implemented and tested independently. An untagged fake backend could otherwise be mistaken for a real in-product Codex repair.
- Options considered:
  1. postpone every M7 component until live SDK access is available;
  2. implement a mode-tagged injected backend contract with strict offline test doubles and require separate live evidence;
  3. use local scripted edits and label them as Codex repair.
- Decision: Build the worker boundary now with mandatory `OFFLINE_TEST_DOUBLE` or `LIVE_CODEX_SDK` provenance, strict schemas, a two-command allowlist, at most two repair attempts, and a distinct independent-review run identity. Offline snapshots must set `liveCodexClaim` to false and cannot satisfy `verify:live` or the M7 gate. Only a future adapter verified against current official SDK documentation may emit `LIVE_CODEX_SDK` evidence.
- Evidence: `src/codex/`, `scripts/repair-workspace.mjs`, `scripts/repair-command.mjs`, `schemas/codex-results.v1.schema.json`, and `tests/snapshots/offline-m7-summary.json`.
- Consequences: Most safety and orchestration behavior is deterministic and testable before credentials exist, while live repair claims remain fail-closed.
- Risks: The eventual SDK adapter may require contract mapping changes after official documentation review.
- Reversal or migration path: Keep the domain contracts and replace only the injected backend adapter when the current SDK interface is verified.
- Related files/commits: `src/codex/`, `prompts/cartographer.v1.md`, `prompts/repair.v1.md`, `prompts/reviewer.v1.md`, `PROGRESS.md`.
