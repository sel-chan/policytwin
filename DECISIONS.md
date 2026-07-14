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

### D-012 — Partial evidence packages must be complete in shape and fail closed

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M8
- Context: The required proof filenames can be generated from deterministic offline fixtures before OPA, GPT-5.6, Codex, browser, container, security, and deployment gates are available. Omitting the package hides integration gaps, while filling missing results with evaluation fixtures risks false proof.
- Options considered:
  1. wait to create any evidence files until every live gate exists;
  2. generate every required filename now with explicit provenance and a mandatory failing summary;
  3. use the evaluation-only fixed fixture as post-Codex repair evidence.
- Decision: Generate a complete-shape `PARTIAL_OFFLINE` package whose machine and human summaries remain `FAIL`. Record unavailable external work as `NOT_RUN`, keep `driftAfter` null, expose evaluation-only fixed-fixture drift in a separate field, and reject any `PASS` claim unless every external gate, post-repair drift, and security result is proven. Hash every payload file with SHA-256 and validate missing, modified, unmanifested, or contradictory evidence.
- Evidence: `src/evidence/validate.ts`, `scripts/generate-offline-evidence.mjs`, `artifacts/evidence/verification-summary.json`, and `artifacts/evidence/evidence-manifest.json`.
- Consequences: Evidence consumers can integrate against the final file surface early without mistaking offline reference results for completion.
- Risks: Live generation must replace `NOT_RUN` artifacts and preserve validator compatibility rather than layering unsupported claims on the partial package.
- Reversal or migration path: The same manifest advances to `LIVE_VERIFIED`/`PASS` only after all required gates supply fresh evidence and the fail-closed validator accepts it.
- Related files/commits: `artifacts/evidence/`, `schemas/verification-summary.v1.schema.json`, `PROGRESS.md`.

### D-013 — Do not guess the project license or create a placeholder container

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M9
- Context: Choosing a repository license requires owner acceptance, while a container built before the web server, pinned OPA, health endpoint, and verified base digest would imply deployment readiness that does not exist.
- Options considered:
  1. assume MIT and build a placeholder Node health server;
  2. omit all license/container work until the end;
  3. prepare inventories and strict prerequisite checks while keeping both gates failed.
- Decision: Record the zero-production-dependency inventory and recommendation without granting a license. Keep `license:check` failed until the owner selects a license. Define container prerequisites and report each missing item, but do not add a Dockerfile or fake health server until the actual Next.js/OPA application exists and image versions can be verified.
- Evidence: `docs/license-review.md`, `NOTICE.md`, `scripts/license-check.mjs`, `container-contract.json`, `scripts/container-check.mjs`, and `artifacts/security/`.
- Consequences: `pnpm verify` now truthfully includes license and container failures in addition to browser/submission gaps.
- Risks: Owner license selection and Docker Desktop startup remain unavoidable later actions; current official base image and OPA facts still require approved network lookup.
- Reversal or migration path: Add the accepted `LICENSE`, resolved dependency notices, verified image digest, pinned OPA checksum, production health route, and real Docker build/health evidence, then allow both checks to pass.
- Related files/commits: `PROGRESS.md`, `docs/threat-model.md`, `docs/limitations.md`.

### D-014 — Keep submission drafts invalid by construction until live proof exists

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M10
- Context: Judge-facing copy and demo plans can be derived from offline evidence before official rules, live verification, deployment, media, license, and submission confirmation exist. A polished draft without machine-enforced invalidity could be mistaken for a publishable package.
- Options considered:
  1. defer all submission materials until engineering and deployment are complete;
  2. generate polished files without readiness markers and rely on manual review;
  3. generate complete-shape drafts with mandatory non-final markers and a fail-closed consistency checker.
- Decision: Generate every offline submission and demo artifact as `DRAFT_NOT_READY`, retain null URLs and unverified rule fields, and fail `submission:check` for any draft marker, non-live proof, missing license/media/HTTPS URL/official-rule verification/confirmation, or non-final submission state. Changing the state field alone must never hide independent failures.
- Evidence: `scripts/generate-submission-draft.mjs`, `scripts/submission-check.mjs`, `scripts/submission-validation.mjs`, `artifacts/submission/submission-check-report.json`, and submission unit/eval tests.
- Consequences: M10 copy and production planning can advance offline while the repository continues to reject publication and submission claims.
- Risks: The generated copy must be refreshed after live evidence changes, and final rule/form fields still require current official sources.
- Reversal or migration path: Replace draft markers and null fields only with verified live values, regenerate the package, and require the same checker to pass before owner submission action.
- Related files/commits: `artifacts/submission/`, `artifacts/demo/`, `SUBMISSION.md`, `PROGRESS.md`.

### D-015 — Use built-in SQLite behind a replaceable offline repository boundary

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M3
- Context: M3 requires real restart persistence, the local package cache has no SQLite dependency, external installation is not approved, and Node.js 22.22.2 exposes the experimental built-in `node:sqlite` `DatabaseSync` API.
- Options considered:
  1. postpone all persistence until package installation is approved;
  2. use JSON files as a temporary store;
  3. implement the required SQLite semantics through a narrow built-in adapter and keep production readiness explicit.
- Decision: Use `node:sqlite` only behind `SQLitePolicyRepository` for the offline M3 contract. Persist immutable policy versions, golden cases, validated IR, lifecycle state, and reproducible decision records transactionally. Do not claim production storage readiness until current official documentation, the selected Node/container runtime, and persistent-volume behavior are verified.
- Evidence: local `DatabaseSync` create/insert/read probe; `src/persistence/sqlite.ts`; unit corruption/stale-write tests; process-style close/reopen integration test.
- Consequences: Real SQLite restart evidence is available without a network install, while the eventual web layer depends on a small repository boundary rather than SQLite calls spread through application code.
- Risks: The built-in API is experimental and may differ from the final supported deployment contract.
- Reversal or migration path: Preserve the repository behavior and replace only the adapter with a current supported Node SQLite binding or stable built-in implementation after approved official-document and dependency review.
- Related files/commits: `src/persistence/sqlite.ts`, `src/node-sqlite.d.ts`, `tests/unit/policy-persistence.test.mjs`, `tests/integration/policy-persistence.integration.test.mjs`.
