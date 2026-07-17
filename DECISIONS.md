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
- Decision: Record the resolved production-dependency inventory and recommendation without granting a license. Keep `license:check` failed until the owner selects a license. Define container prerequisites and report each missing item, but do not add a Dockerfile or fake health server until the actual Next.js/OPA application exists and image versions can be verified.
- Evidence: `docs/license-review.md`, `NOTICE.md`, `scripts/license-check.mjs`, `container-contract.json`, `scripts/container-check.mjs`, and `artifacts/security/`.
- Consequences: `pnpm verify` now truthfully includes license and container failures in addition to browser/submission gaps.
- Risks: Owner license selection and Docker Desktop startup remain unavoidable later actions; final browser/container artifacts require a release-platform license refresh.
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

### D-016 — Submit PolicyTwin in the Developer Tools track

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M0/M10
- Context: The verified Build Week rules offer Apps for Your Life, Work and Productivity, Developer Tools, and Education. PolicyTwin is an evidence-first testing and agentic verification product whose primary users include application engineers.
- Options considered:
  1. Work and Productivity because policy owners and operations teams also benefit;
  2. Developer Tools because the core demonstrated value is compiler, OPA, test generation, differential execution, mutation testing, and Codex-assisted code repair.
- Decision: Use the `Developer Tools` track. Preserve operations impact in the narrative without changing the primary category.
- Evidence: `https://openai.devpost.com/`, `https://openai.devpost.com/rules`, and `PLAN.md` sections 2, 3, and 5.
- Consequences: Submission materials must include installation instructions, supported platforms, and a judge-ready test path that does not require rebuilding from scratch.
- Risks: The policy-owner UX must remain understandable so the project is not presented as an engineer-only tool.
- Reversal or migration path: Re-evaluate only if the official categories change or the implemented product materially shifts before submission.
- Related files/commits: `config/build-week-rules.v1.json`, `SUBMISSION.md`, `PROGRESS.md`.

### D-017 — Pin the application stack and run OPA from a checksum-verified local tool boundary

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M0/M4/M9
- Context: The workspace is on an exFAT drive that cannot create pnpm's normal symlinks, the approved network scope permits exact package installation and official OPA acquisition, and proof must identify the executable policy engine rather than depend on an unversioned global command.
- Options considered:
  1. rely on globally installed or latest packages and a PATH-resolved OPA command;
  2. use pnpm's hoisted linker on exFAT, exact locked package versions, and a checksum-pinned official OPA binary outside Git;
  3. replace OPA with the existing TypeScript reference evaluator.
- Decision: Use `nodeLinker: hoisted` in `pnpm-workspace.yaml`, exact dependency versions in the lockfile, and only explicitly reviewed package build scripts. Acquire OPA 1.18.2 from the official release, verify the published SHA-256 checksum, keep the executable in ignored `.tools/opa/1.18.2`, and invoke it through a fixed-query, no-shell runner with strict input, timeout, compile check, version, and content hashes.
- Evidence: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `container-contract.json`, `scripts/opa-install.mjs`, `src/opa/runner.ts`, `tests/integration/opa-runner.integration.test.mjs`, and `artifacts/evidence/opa-results.json`.
- Consequences: Local and clean-copy verification can reproduce real OPA policy evaluation without committing a platform binary; package installation works on the workspace filesystem.
- Risks: A fresh machine still needs the approved installer or an explicit `OPA_PATH`; Linux container acquisition must verify its separate recorded checksum; the shared pnpm store may remain marked mutated after interrupted installation attempts.
- Reversal or migration path: Move to pnpm's isolated linker on a symlink-capable filesystem, or provide OPA through a digest-pinned container while preserving the runner contract and evidence fields.
- Related files/commits: `package.json`, `pnpm-workspace.yaml`, `container-contract.json`, `src/opa/`, `PROGRESS.md`.

### D-018 — Separate the NodeNext core build from the Next.js web typecheck

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M2–M8
- Context: The existing policy core is authored as NodeNext ESM, while Next.js 16 expects a Bundler-mode application typecheck. Webpack also failed on the exFAT workspace with `EISDIR` during symlink/readlink handling, while Turbopack completed the same build.
- Options considered:
  1. convert the entire core to Next.js module semantics;
  2. move the repository to a different filesystem or add a second workspace package immediately;
  3. compile the core through a dedicated NodeNext config, typecheck the web app through the Next config, and use the default Turbopack build.
- Decision: Keep `tsconfig.build.json` as the deterministic NodeNext core compiler, make the root `tsconfig.json` the strict Next.js/Bundler typecheck, and have `typecheck`, tests, development, and production build invoke the narrow core build first. Import only required prebuilt core submodules from server components and routes.
- Evidence: `scripts/build-core.mjs`, `scripts/typecheck.mjs`, `scripts/build.mjs`, `app/lib/demo-data.ts`, and repeated `pnpm typecheck`/`pnpm build` passes.
- Consequences: The core remains framework-independent while the six-view web application builds on the current drive.
- Risks: The prebuilt boundary is a repository-layout coupling and must remain covered by clean-copy and standalone-output checks.
- Reversal or migration path: Move the core into an explicit workspace package on a symlink-capable filesystem while preserving its public contracts and tests.
- Related files/commits: `tsconfig.json`, `tsconfig.build.json`, `next.config.ts`, `PROGRESS.md`.

### D-019 — Gate live interpretation behind server-owned identity, evidence, and cost controls

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M2/M9
- Context: A public model route could incur unbounded cost and accept schema-valid but incomplete or contradictory policy meaning. Model-supplied provenance, policy identity, source clauses, and golden-case agreement are not trustworthy evidence by themselves.
- Options considered:
  1. expose an unauthenticated demo endpoint and rely on provider quotas;
  2. disable all HTTP integration until deployment;
  3. implement the server adapter now with an explicit run token, byte and concurrency limits, cancellation, server provenance, exact clause comparison, request identity checks, and golden-case contradiction blocking.
- Decision: `POST /api/interpret` is disabled unless `POLICYTWIN_RUN_TOKEN` is configured and presented. It accepts at most 128 KB, one active run per process, a 60-second cancellation boundary, and generic external errors. The adapter uses strict Responses `text.format`, a bounded output budget and two application attempts with SDK retries disabled. Server-owned metadata and the closed input schema replace model values; policy identity, the complete deterministic clause list, and authoritative golden cases are revalidated before success.
- Evidence: `src/openai/interpreter.ts`, `app/api/interpret/route.ts`, `.env.example`, and `tests/unit/openai-interpreter.test.mjs`.
- Consequences: Recorded fixtures cannot impersonate live evidence, and a malformed or contradictory response fails closed before persistence or compilation.
- Risks: The strict provider schema still requires a fresh credentialed Responses call, and a distributed deployment needs shared rate limiting beyond the per-process concurrency guard.
- Reversal or migration path: Replace the static run token with authenticated sessions and a shared quota service while preserving every server-side semantic check.
- Related files/commits: `prompts/interpreter.v1.md`, `schemas/policy-ir.v1.schema.json`, `PROGRESS.md`.

### D-020 — Authenticate live evidence and recompute claims from source artifacts

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M8/M9
- Context: An adversarial review proved that an author could rewrite every evidence file, recompute the SHA-256 manifest, set external gates to `PASS`, and obtain `LIVE_VERIFIED` with a fake OPA version, zero post-repair cases, a mutation rate above 100%, and empty traceability. The aggregate hash detected unapproved byte changes but could not authenticate the package author or prove external execution.
- Options considered:
  1. keep the self-hashed manifest and add only numeric range checks;
  2. add structured proof files and semantic cross-checks but continue treating a self-generated hash as live provenance;
  3. recompute all material claims and require a detached signature from a trusted live runner.
- Decision: Every payload remains included in the deterministic SHA-256 aggregate, but `LIVE_VERIFIED` additionally requires an Ed25519 attestation over the evidence hash, run ID, and timestamp within a fail-closed 24-hour default freshness window. Trusted public keys are injected by the verifier; private keys must remain outside the repository. The validator regenerates Rego from PolicyIR, pins accepted OPA version/checksums, checks every case/result/input hash, derives differential counts and seeded witnesses, recomputes the deterministic mutation corpus and traceability metrics, validates complete Codex contracts and commands, and requires structured GPT/browser/Linux-container/deployment/security receipts. Empty-set completeness and self-reported top-level `PASS` strings cannot satisfy the gate.
- Evidence: `src/evidence/validate.ts`; new structured summaries in `artifacts/evidence/`; adversarial, semantic-forgery, and Ed25519 integration tests in `tests/integration/evidence-package.integration.test.mjs`.
- Consequences: The current offline package remains reproducible with `liveAttestation: null`, while a future live package cannot pass without both internally consistent evidence and a signature trusted by the verifier.
- Risks: The live signer, external key custody/rotation, structured receipt production, and successful live fixture are not implemented yet. A compromised trusted signer can still attest false work, so the live runner must execute gates directly and protect its key.
- Reversal or migration path: Replace the local Ed25519 trust list with CI OIDC/Sigstore or another verifiable build attestation while preserving the signed evidence hash, run identity, semantic checks, and fail-closed default.
- Related files/commits: `README.md`, `docs/threat-model.md`, `schemas/verification-summary.v1.schema.json`, `PROGRESS.md`.

### D-021 — Persist only accepted decisions and text-only blocked impact drafts through seeded web routes

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M3/M8/M9
- Context: The existing Decision Queue replayed a recorded v4 in memory, while the 14-to-30 impact engine proves that the candidate contradicts authoritative golden case G02. Storing the candidate as accepted PolicyIR would silently weaken the golden-case gate, but leaving every screen read-only would fail the M3 and FR-17 product contracts.
- Options considered:
  1. keep static UI replay and show the impact artifact without a persisted version;
  2. persist the contradictory v5 candidate as accepted PolicyIR and mark its proof partial;
  3. wire seeded, versioned HTTP mutations to the existing SQLite service, persist accepted ambiguity choices as PolicyIR versions, and persist the 14-to-30 edit only as a text-only `DRAFT` with a reference-evaluator preview.
- Decision: Use option 3. The browser can mutate only `policy-seeded-refund` through versioned paths and closed bodies. Accepted decisions produce immutable v2-v4 PolicyIR and decision records. The exact source edit produces replay-safe v5 `DRAFT` with no PolicyIR. G02 remains authoritative, v4 proof remains accessible, and no OPA/Codex/code-change claim is made. Mutation routes require same-origin browser metadata, an HttpOnly SameSite CSRF cookie plus matching custom header, byte limits, and a shared per-process write gate.
- Evidence: `src/workspace/service.ts`, `src/workspace/http.ts`, `app/api/policies/`, `app/decisions/`, `app/impact/`, unit tests, and Chrome E2E covering v1-v5, conflict rejection, refresh persistence, and mobile layout.
- Consequences: M3's UI write/persistence gate and M8's minimum impact interaction become demonstrable without weakening evidence truthfulness.
- Risks: The public demo has anonymous session isolation but no authenticated identity; SQLite, capacity, expiry, and the gate are process-local, so multi-instance hosting requires shared identity, quotas, cleanup, and coordination.
- Reversal or migration path: Add authenticated per-user projects and a shared transactional store while preserving version-path CAS, closed patches, replay semantics, golden blocking, and draft-versus-accepted provenance.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `PROGRESS.md`.

### D-022 — Bound anonymous demo sessions and trust one configured public origin

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M3/M8/M9
- Context: A shared seeded project lets one reviewer overwrite another's demo, while issuing a permanent SQLite project for every cookie-less GET permits unbounded disk growth. Proxy-derived host/protocol values also cannot define a production trust boundary safely.
- Options considered:
  1. retain one global seeded project;
  2. require full account authentication before the demo can be used;
  3. isolate a bounded anonymous demo session now and retain authentication/shared quotas as a release boundary.
- Decision: Use option 3. A 256-bit HttpOnly SameSite session token maps through SHA-256 to an internal project ID. A new token is issued only for a same-origin browser fetch. Production requires an exact `POLICYTWIN_PUBLIC_ORIGIN` and HTTPS, validated before project creation, except the explicit loopback-only E2E override. Anonymous projects expire after 24 hours and are capped at 128 per process; expired projects and all child rows are deleted transactionally, and every mutation rechecks expiry. Mutation bodies have an overall ten-second read deadline and are parsed before the write gate.
- Evidence: `app/lib/policy-workspace-store.ts`, `app/lib/workspace-http.ts`, `src/persistence/sqlite.ts`, request/persistence unit tests, and production-server Chrome E2E with a second isolated browser context.
- Consequences: Reviewers no longer share versions, slow bodies do not monopolize writes, and repeated anonymous requests cannot grow one process's database without bound.
- Risks: Anonymous tokens are not user identity. Caps, TTL cleanup, and write serialization remain process-local; a deployed multi-instance service still needs authenticated sessions, shared rate limits/quotas, and coordinated storage cleanup.
- Reversal or migration path: Move session/project ownership and quotas to a shared authenticated store while preserving hashed opaque identifiers, exact-origin/CSRF checks, immutable CAS versions, and transactional cleanup.
- Related files/commits: `.env.example`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `PROGRESS.md`.

### D-023 — Bind recorded proof and impact to exact reference policy meaning

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M3/M8
- Context: Purchase-day indexing and usage measurement have multiple valid options. A session can therefore reach v4 with different normalization from the seeded reference v4 while sharing the same version number. Version equality alone would falsely present static OPA evidence and the 14-to-30 impact preview as proof for another PolicyIR.
- Options considered:
  1. remove alternative ambiguity options from the demo;
  2. treat every v4 as equivalent because the current fixture inputs are already normalized;
  3. compare accepted policy meaning and block reference evidence reuse on mismatch.
- Decision: Use option 3. Compute a deterministic equality fingerprint over policy version, schema/domain, clauses, rules, ambiguity selections, default, normalization, and input schema while excluding opaque per-session IDs and provenance. Proof states whether the latest validated session meaning matches the recorded reference. Change Impact requires the same match before persisting v5. A mismatch is explicit and cannot inherit the reference package's claims.
- Evidence: `app/lib/policy-meaning.ts`, `app/proof/proof-session-boundary.tsx`, `app/impact/change-impact-client.tsx`, and Chrome E2E covering alternate v4 choices and blocked impact.
- Consequences: Valid alternative decisions remain reviewable without allowing a static evidence package to impersonate session-specific proof.
- Risks: The fingerprint is an application equality guard, not a cryptographic attestation. It relies on validated deterministic object ordering; the evidence manifest and Ed25519 boundary remain authoritative for package integrity/origin.
- Reversal or migration path: Generate, validate, hash, and attest a fresh evidence package for each accepted session policy, then replace the reference-only block with session-specific proof.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `PROGRESS.md`.

### D-024 — Build the complete proof download as a validated deterministic USTAR archive

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M8/M9
- Context: FR-16 requires one downloadable archive that excludes secrets and transient logs. The evidence generator already produces 38 closed text files and a semantic SHA-256 manifest, but the web route exposed only 20 individual files. Node.js has no standard ZIP writer, and adding a production dependency for a small deterministic container format would expand the supply chain without improving proof.
- Options considered:
  1. add a ZIP library and compress the evidence directory;
  2. enumerate the evidence directory into a generated archive file;
  3. validate the exact required-file map and emit an uncompressed fixed-metadata USTAR archive in memory.
- Decision: Use option 3. Load exactly `REQUIRED_EVIDENCE_FILES`, require a complete semantic package and any required live attestation, reject missing/extra/tampered files plus credential-shaped, private-key, bearer-token, OpenAI-token, personal-path, per-file, and aggregate-size violations, then emit bytewise-sorted USTAR entries with mode `0644`, uid/gid/mtime zero, validated checksums, and two zero termination blocks. Never enumerate the directory or write the archive into `artifacts/evidence/`. The HTTP ETag is the archive SHA-256; the existing semantic evidence hash remains a separate response header.
- Evidence: `src/evidence/archive.ts`, `app/lib/evidence-download.ts`, `app/api/evidence/archive/route.ts`, `app/proof/page.tsx`, integration archive extraction/forgery tests, and production Chrome download checks.
- Consequences: Reviewers receive one portable 38-file proof package whose bytes are stable for the same evidence, while every required file remains individually downloadable. The current archive and UI continue to say `PARTIAL_OFFLINE / FAIL` and recorded reference v4.
- Risks: USTAR is uncompressed and the route builds the archive in memory; fixed 4 MiB per-file and 16 MiB aggregate limits intentionally reject larger future packages. The sensitive-content patterns are a fail-closed guard, not a substitute for release review or live artifact redaction at the source.
- Reversal or migration path: If binary evidence later exceeds the bounded text package, introduce a separately reviewed streaming archive format with fixed metadata and the same exact allowlist, validation, sensitive-content, hash, and provenance contracts.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-025 — Derive Codex provenance and repair scope from the SDK stream and filesystem

- Date: 2026-07-14
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: The offline M7 contract accepted model-supplied metadata and changed-file lists. Directly wiring that shape to the SDK would let a response claim a live run identity or a repair that the filesystem did not show. Reusing one thread across read and write phases would also blur the privilege boundary, while inheriting the server environment or personal Codex home could expose credentials, config, MCP servers, or hooks.
- Options considered:
  1. trust strict structured output for metadata and changed files;
  2. resume one SDK thread through cartography, repair, and review;
  3. use distinct phase threads, accept only semantic model fields, and derive provenance and file changes server-side.
- Decision: Use option 3 with pinned `@openai/codex-sdk` 0.144.3. Cartography and review use separate `read-only` threads; each bounded repair attempt uses a fresh `workspace-write` thread. Every thread has the exact managed fixture root, explicit model and high effort, no extra directories, no web search or agent network, `approvalPolicy: never`, and bounded abort/event/output limits. The adapter consumes `runStreamed()` so top-level stream errors fail closed and awaits abort-aware stream teardown. The server supplies SDK provenance and content-derived changes, validates line ranges and contained paths, and fixes the only writable files to `src/refund.ts` and `tests/refund.test.mjs`; model cartography cannot expand that set. The repair input must match the exact server-owned golden-plus-generated 41-case digest. The server runs typecheck then test in fixed order, retains both commands for every attempt with the repair run and before/after tree hashes, and rejects tests that alter the typechecked tree. A separate trusted runner then emits a strict receipt bound to the attempt, repair SDK run, final fixture tree, accepted corpus, and PolicyIR; failed command-passing receipts remain in retry history and only a final 41/41 receipt reaches review. Read-only mutation, metadata-only repair, repeated identity, added/deleted files, write-set expansion, malformed output, incomplete or altered receipts, and unobserved changes fail. A fresh empty disjoint `CODEX_HOME`, allowlisted CLI environment, and `shell_environment_policy.inherit: none` isolate personal config. Because the SDK sandbox is not a read jail and modified JavaScript is untrusted, no web route invokes live repair and the host command runner rejects `LIVE_CODEX_SDK`; D-027 additionally makes host-process live construction fail closed until a real external worker RPC exists.
- Evidence: `src/codex/sdk-adapter.ts`, `src/codex/sdk-output-schemas.ts`, fake-stream unit tests, canonical-corpus and command-history forgery tests, fresh managed-copy integration with real typecheck/test commands, malicious test-tree mutation rejection, direct 41-case execution, live-host command rejection, and host live-factory rejection.
- Consequences: Offline tests can exercise the whole SDK-compatible adapter contract without credentials while remaining `OFFLINE_TEST_DOUBLE`; no in-process path can emit `LIVE_CODEX_SDK`. Model prose can no longer manufacture run identity or changed-file evidence.
- Risks: The SDK does not provide a fixture-only read jail. D-026 now rejects every SDK command-execution event rather than attempting a shell allowlist, but the SDK stderr or one JSONL line still has no adapter-side pre-parse byte cap. Persistent filesystem changes are detected, but a hostile background child can only be prevented and reaped by the external worker. Windows/Linux sandbox behavior, API-key exclusion from real agent child processes, process-tree termination, CPU/memory/PID isolation, immutable execution in that sandbox, fresh post-repair differential evidence, live receipts, and signing still require a credentialed worker/container run. A constructed SDK client without an executed turn is not evidence.
- Reversal or migration path: Move the same phase/provenance contract into a dedicated container worker or newer supported SDK while preserving distinct threads, empty per-run home, environment isolation, streamed error handling, filesystem-derived deltas, fixed external verification commands, and fail-closed live evidence.
- Related files/commits: `.env.example`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-026 — Make server-owned assertions and execution the only Codex regression proof

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M8/M9
- Context: A strict model schema still allowed the repair response to report `addedTests` and `regressionTestLinks` without proving that the changed test file executed the named witnesses. The SDK stream also exposed command-execution events that were previously ignored, while command hashes and downloadable fixture receipts used different tree definitions and handled generated `dist` files inconsistently.
- Options considered:
  1. retain model-reported links and trust independent review;
  2. statically inspect model-authored JavaScript assertions;
  3. remove model regression claims, reject SDK command execution, and treat only server-owned commands plus the exact 41-case receipt as regression proof.
- Decision: Use option 3. Repair output contains semantic summary, rationale, risks, and closed command IDs only. The adapter supplies bounded fixture contents and rejects every SDK `command_execution` lifecycle event; only the orchestrator may execute typecheck and test. The canonical test file contains skipped server-owned D01-D03 assertions, and the repair must change the exact two-file set and produce the digest of that file with all three skips removed. Worker metadata binds the prompt template, full request, and output schema hashes. Command runner or evidence-capture exceptions receive redacted attempted-command records. The canonical execution-tree hash covers the root plus sorted file and directory paths, kinds, modes, mtimes, and file bytes. Live tree receipts use the same producer and validator contract; the before tree must match the exact trusted path set and content fingerprint, while the after tree permits only the two deterministic `dist` outputs in addition to the server-fixed source/test delta. Policy verification remains bound to the repair run, final execution tree, accepted-corpus digest, and PolicyIR digest, and only 41/41 can reach review.
- Evidence: `src/codex/sdk-adapter.ts`, `src/codex/orchestrate.ts`, `src/codex/types.ts`, `src/evidence/validate.ts`, `scripts/repair-command.mjs`, `schemas/codex-results.v1.schema.json`, phase prompts, and unit/integration tests for forbidden command events, runner errors, generated-file write attempts, sensitive paths, mtime-only mutation, tree-receipt parity, and 41-case replay.
- Consequences: Model prose and arbitrary model-authored tests can no longer manufacture regression coverage. Every accepted regression claim comes from the executed digest-pinned assertions plus immutable server-owned case results, and live evidence cannot mix a content-only receipt with a metadata-aware command hash.
- Risks: The real SDK may require command tools for file inspection or editing; the current live path therefore remains intentionally disabled until a credentialed external worker proves a no-command file-edit path or a separately designed closed command protocol. Tree mtimes make live execution hashes run-specific by design, so the portable baseline identity remains a separate content fingerprint and exact path set.
- Reversal or migration path: A future SDK may expose typed read/edit operations or typed command receipts. Adopt them only if every operation is allowlisted, bounded, retained, tree-reconciled, and still subordinate to server-owned 41-case verification.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-027 — Require a real external worker boundary before any live Codex construction

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: An `EXTERNAL_OS_SANDBOX` option string cannot prove that the calling process actually runs inside an isolated operating-system boundary. Constructing the Codex SDK in the web or host process would allow an SDK command to execute before its lifecycle event could be rejected and would leave background-process teardown outside the adapter's control.
- Options considered:
  1. trust the caller-provided isolation label and construct the SDK in process;
  2. add more in-process environment checks;
  3. reject every host-process live construction until a separately launched worker RPC enforces the boundary.
- Decision: Use option 3. `createIsolatedWorkerCodexSdkBackend()` is a fail-closed placeholder and always rejects in the host process. Offline SDK-compatible streams remain available only as `OFFLINE_TEST_DOUBLE`. A future live worker must instantiate the pinned SDK inside a non-privileged OS sandbox with fixture-only mounts, an empty per-run home, hard CPU/memory/PID/output limits, process-tree termination, workspace deletion, immutable command/corpus runners, and signed receipts. Per D-028, only the supervisor-controlled SDK compartment may reach an OpenAI-only egress proxy; fixture commands and verification remain non-networked. Every phase failure—including cartography and review—poisons its disposable workspace and clears baselines and review receipts. Unknown future SDK event and item types are rejected rather than ignored. Sensitive assignments, credential URLs, canonical fixture text, command output, diffs, and archive content are checked before crossing or leaving the worker boundary.
- Evidence: `src/codex/sdk-adapter.ts`, `src/codex/safety.ts`, `src/evidence/archive.ts`, `src/evidence/validate.ts`, and unit/integration tests covering host-live rejection, read/write phase poisoning, unknown lifecycle rejection, credential-URL rejection, canonical diff/tree binding, and exact corpus binding.
- Consequences: The repository cannot accidentally promote an in-process SDK run to `LIVE_CODEX_SDK`. M7 remains incomplete until the external worker and a fresh signed live run exist.
- Risks: The final worker RPC and hard process limits are not implemented or exercised in this environment. Abort-aware SDK iteration alone is not a process-reaping guarantee.
- Reversal or migration path: Replace the rejecting placeholder only with an RPC client whose remote worker produces independently validated isolation, teardown, command, tree, corpus, and attestation receipts; never re-enable direct host construction.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-028 — Authenticate one complete repair-run RPC and separate the web image

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: A phase-by-phase host RPC would leave SDK state, verification commands, the 41-case runner, and teardown split across trust boundaries. A combined web/worker image would also expose the application process to Codex credentials and broader process privileges. The Codex API requires controlled egress, while fixture verification must remain non-networked.
- Options considered:
  1. enable the existing SDK adapter directly in the web process;
  2. proxy individual cartography, repair, command, corpus, and review calls from the host;
  3. send one validated repair request to an authenticated external supervisor and keep the web image separate.
- Decision: Use option 3. The host RPC sends only validated `RepairWorkerInput`, an explicit model, immutable baseline/corpus/image digests, a host-calculated baseline execution-tree manifest covering canonical paths, kinds, modes, modification times, and file hashes, closed file/command IDs, bounded resource policy, a 128-bit request ID, a 256-bit nonce, and a short expiry. It sends no API key, `CODEX_HOME`, host path, executable, or arbitrary command. The future transport must mutually authenticate by mTLS or protected local-socket ACL; the current interface value is only a fail-closed precondition and is not authentication evidence. Responses use declared-length asynchronous raw-byte streams capped before body access at 4 MiB, 64 KiB per chunk, and 1,024 chunks, followed by canonical UTF-8/JSON validation. A trusted Ed25519 supervisor signature covers the exact request, result, isolation policy, image, final execution-tree manifest, and teardown receipt. The client compares baseline and final manifests and requires exactly the fixed source and regression-test files to change; every verification command must preserve the final tree including mtimes. Repair runs in a disposable two-file write workspace; typecheck, tests, and the 41-case corpus run in a separately reconstructed immutable verification workspace. Only the supervisor may use an OpenAI-only egress proxy; fixture processes have no network. The standalone web Dockerfile contains no live Codex worker or credentials, rejects mutable build-argument image references, and requires a verified Node 22.22.2 image digest at dynamic build time. Dynamic verification initializes volume ownership separately, runs the app non-root/read-only, verifies an actual SQLite API mutation across restart, and treats any tracked-resource cleanup failure as a failed gate.
- Evidence: `src/codex/worker-rpc-contract.ts`, `src/codex/worker-rpc-client.ts`, `tests/unit/worker-rpc.test.mjs`, `Dockerfile`, `.dockerignore`, `container-contract.json`, `scripts/container-check.mjs`, and `scripts/container-verify.mjs`. D-029 records the later concrete mTLS/supervisor implementation.
- Consequences: The host can validate a future signed external result and its exact manifest delta without being able to construct the SDK or execute live fixture commands. Static web-container checks can pass without a Docker daemon, while dynamic image/OPA/non-root/read-only-root/SQLite-restart/health evidence remains a separate required gate.
- Risks: D-029 now implements and loopback-tests a concrete authenticated transport, bounded supervisor service, and durable replay store, but no worker image, OpenAI egress proxy, immutable verification workspace, or live signed PASS result exists. The mTLS tests prove peer authentication and wire framing only; their signed `FAIL` executor double does not prove OS isolation or Codex work. The immutable Node base-image digest is still unset, and dynamic Docker verification has not run. Handled cleanup covers normal/error/SIGINT/SIGTERM paths, not forced termination such as SIGKILL.
- Reversal or migration path: A different worker runtime may replace the transport only if it preserves mutual authentication, single-use request binding, canonical bounded frames, trusted supervisor signatures, repair/verification separation, fixed egress, process-tree teardown, and host live-construction rejection.
- Related files/commits: `PROGRESS.md`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`.

### D-029 — Use pinned TLS 1.3 peers and durable replay state for the external supervisor transport

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: D-028 left `authenticationMode` as a transport object's self-assertion. A real boundary must reject the wrong peer before parsing, check frame size before body accumulation, prevent the same request capability from running twice after a supervisor restart, and propagate connection loss or shutdown to the injected executor. The transport must not be mistaken for the still-missing OS-isolated Codex worker.
- Options considered:
  1. keep only the injected transport interface and rely on a deployment proxy;
  2. use TLS chain validation without an exact service identity or persistent replay state;
  3. implement Node TLS 1.3 mutual authentication with fixed ALPN, server-name verification, exact certificate fingerprint pins on both peers, bounded single-frame RPC, a one-active-run supervisor, and a transactional SQLite replay store.
- Decision: Use option 3. The client and supervisor accept only TLS 1.3 with `policytwin-worker-rpc/1`, configured CA material, and exact SHA-256 certificate pins. The client also performs the standard server-name check. Each connection carries exactly one `PTQ1` request and one `PTS1` response with an eight-byte magic/unsigned-length header; request and response declarations are capped at 1 MiB and 4 MiB before body accumulation, and canonical UTF-8/JSON validation remains mandatory. The supervisor checks validity immediately and before execution, admits one repair, atomically consumes both request ID and nonce, aborts the executor on timeout/disconnect/shutdown, tracks pre-handshake sockets, and waits for executor settlement before close. Production wiring must inject the SQLite store so replay state survives restart; the bounded in-memory store is explicitly test/development only. The supervisor constructs and signs the response only after the injected executor supplies a schema-valid report or failure plus a complete teardown receipt.
- Evidence: `src/codex/worker-rpc-mtls.ts`, `src/codex/worker-rpc-replay-sqlite.ts`, `tests/integration/worker-rpc-mtls.integration.test.mjs`, and `tests/integration/worker-rpc-replay.integration.test.mjs`. Test certificates are generated into a temporary directory with local OpenSSL and deleted; no private TLS key is committed.
- Consequences: Real loopback sockets now prove mutual peer authentication, name/pin/ALPN enforcement, bounded fragmented framing, rejection of missing/wrong/untrusted clients, replay/concurrency rejection, timeout and close cancellation, pre-handshake cleanup, and signed fail-closed responses. Replay rejection persists across SQLite reopen and treats reuse of either request ID or nonce as a replay.
- Risks: Certificate issuance, rotation, revocation, production secret mounts, edge connection/rate limiting, and multi-replica access to the replay database still require deployment design. A TLS-authenticated supervisor is not an OS sandbox. The current executor is an explicit signed `FAIL` test double; no SDK client, worker image, fixture mount, egress proxy, no-network verifier, cgroup/process-tree proof, or live evidence is connected. If an executor ignores cancellation, supervisor close fails after a bounded timeout rather than claiming teardown.
- Reversal or migration path: Replace TLS with a protected local socket only if OS peer credentials and ACLs are verified equivalently; replace SQLite with a shared transactional store only if unique request-ID/nonce consumption and expiry pruning remain atomic across replicas.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-030 — Separate static worker and credential-free verifier images before enabling the live executor

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: D-029 authenticated the supervisor transport but left every OS control as an RPC declaration. Reusing the web image would expose unrelated application code and storage to the SDK, while running typecheck/tests in the SDK compartment would expose verification to its network and credentials. Docker and immutable image digests are unavailable in the current environment, so configuration evidence must remain distinct from observed isolation.
- Options considered:
  1. keep a single web/worker/verifier image and depend on runtime flags;
  2. add only a worker Dockerfile and let it run SDK and fixture verification together;
  3. define separate web, SDK-worker, and credential-free verifier images, generate an exact Docker run plan, statically reject weakened plans, and require a distinct non-live dynamic smoke before any SDK executor is connected.
- Decision: Use option 3. `container-contract.json` schema v3 marks the worker and verifier only `STATIC_PREPARED`; `dynamicVerified` and `liveCodexExecuted` stay false. The web image still excludes refund repair fixtures and worker credentials. The worker image runs as numeric UID/GID 10001, expects a read-only canonical baseline, overlays only `src/refund.ts` and `tests/refund.test.mjs` writable from a checked disposable run root, receives request/response and a bounded proxy-token file through fixed mounts, uses a read-only root plus bounded tmpfs, drops all capabilities, forbids privilege escalation, applies fixed PID/memory/CPU/stop limits, and attaches only to `policytwin-worker-internal`. The verifier image runs as 10002 with no Codex/OpenAI package copied into its runtime, accepts a reconstructed fixture read-only, writes only `dist` and `/tmp` tmpfs, uses `network=none`, inherits no host credential/proxy environment, and invokes only the fixed TypeScript compiler and test file without a shell. Before any run file is created, the dynamic-smoke harness rejects linked or non-directory repository, `.tmp`, and `worker-runs` parents; it creates a new direct run child and rechecks its physical containment before copying fixtures or writing request/token files. The pure plan builder accepts only bare local `sha256:` image IDs, rejects mutable/registry references, traversal, unsafe or symlinked layout roots, missing/extra files, and extra mounts. It reconstructs verification from the canonical baseline plus exactly the two repair-overlay contents and records the copied paths plus separate baseline, overlay, and reconstructed content bindings. The contract pins deterministic hashes over every file copied by each Dockerfile rather than assuming Docker image IDs are reproducible across daemons. The Dockerfiles use no externally resolved mutable syntax directive; the selected daemon/BuildKit version is recorded dynamically and remains a release blocker until verified or replaced with a verified digest-pinned frontend. `worker:verify` rejects a build-input mismatch or missing immutable Node base before Docker; on a Docker-eligible run it rebuilds the current TypeScript plan, builds both images from the checked-in Dockerfiles/current repository context, records their runtime image IDs in the dynamic report, requires an internal Docker network, runs only static worker preflight and reconstructed fixed verification, and cleans its run root, containers, and temporary image tags while still reporting egress/live Codex as unverified. Worker-only runtime modules are not exported through `src/index.ts`, and the host SDK factory/command runner remain rejecting.
- Evidence: `Dockerfile.worker`, `Dockerfile.verifier`, `container-contract.json`, `src/codex/worker-runtime-contract.ts`, `scripts/worker-preflight.mjs`, `scripts/verifier-preflight.mjs`, `scripts/worker-container-verify.mjs`, `scripts/container-check.mjs`, and unit tests for exact mounts, mutable images, traversal, junctions, credential inheritance, weakened verifier networking, and fixture bundling.
- Consequences: Offline verification can prove the intended split and deterministic Docker arguments without fabricating a kernel-isolation result. A future daemon run has one explicit non-live gate before the executor is wired, and verifier commands do not share SDK credentials or networking by construction.
- Risks: Docker bind-file overlays on a read-only parent, actual namespace/cgroup values, the internal-network topology, proxy authentication/allowlisting, SIGTERM-to-SIGKILL process-tree cleanup, and absence of residual containers/processes still require Linux daemon evidence. At this checkpoint the egress proxy was `NOT_IMPLEMENTED`; D-031 later prepares its static contract without converting it into runtime evidence. Numeric users assume compatible ownership for mounted files and must be verified on the selected runtime. A process can report only its own view; `docker inspect`, cgroup observation, and supervisor-side teardown checks remain authoritative.
- Reversal or migration path: Replace Docker with another OS sandbox only if it preserves immutable image/runtime identity, non-root read-only execution, the exact two-file write set, separate no-network credential-free verification, fixed egress, resource/process-tree enforcement, fail-closed cleanup, and independently signed receipts.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-031 — Use a run-capability Responses broker and keep the provider credential outside the worker

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: The external worker needs Codex model traffic but must not receive a reusable OpenAI credential or arbitrary outbound network access. The pinned SDK accepts a custom model provider and exact child environment, while the current official Codex manual documents command-backed provider authentication. A generic HTTP `CONNECT` proxy would create an unnecessary destination and framing surface, and passing `apiKey` to the SDK would place the provider credential in the worker process.
- Options considered:
  1. inject a provider key directly into the SDK worker;
  2. expose a generic authenticated forward proxy;
  3. give the worker a short-lived per-run capability and terminate it at a fixed Responses-only reverse broker that alone mounts the provider credential.
- Decision: Use option 3. The prepared SDK options select a custom `responses` provider at `https://policytwin-egress:8443/v1` and use a fixed command helper that reads one canonical 256-bit capability file. The SDK child receives an exact environment containing only its empty home, fixed path, capability-file path, and CA-bundle path; it receives no provider key and inherits no host environment. The broker accepts only origin-form JSON `POST /v1/responses` at the internal authority, bounded to 1 MiB requests and 8 MiB JSON/SSE responses. It rejects arbitrary and duplicate headers, transfer framing, absolute/query targets, redirects, compression, non-public DNS results, and exhausted, wrong, or expired capabilities. It resolves only `api.openai.com` A records, rejects the complete result set if any address is unsafe, pins the selected IP for the TLS connection, and preserves `api.openai.com` as SNI, certificate identity, and Host. Leases last at most 15 minutes and 64 admitted upstream attempts. The handler permits at most two concurrent upstream calls, uses a 120-second overall deadline, a 15-second upstream idle timeout, and aborts when either side closes. Malformed bodies do not consume the lease; consumption occurs immediately before upstream dispatch. The provider credential and TLS private key must be regular read-only mounts outside the repository. The egress image publishes no host port and the static lifecycle uses explicit create/start/wait/logs/stop/remove operations with a fixed internal alias and a separate outbound network.
- Evidence: `src/codex/openai-egress-contract.ts`, `src/codex/openai-egress-proxy.ts`, `src/codex/worker-sdk-runtime.ts`, `src/codex/worker-entrypoint-contract.ts`, `src/codex/egress-runtime-contract.ts`, `src/codex/worker-os-lifecycle.ts`, `scripts/proxy-token-helper.mjs`, `scripts/openai-egress-proxy.mjs`, `scripts/worker-entrypoint.mjs`, `Dockerfile.egress-proxy`, `container-contract.json`, and focused unit/integration tests.
- Consequences: The static design no longer requires a reusable Codex credential inside the worker and cannot be repurposed as a generic proxy. The prepared worker entrypoint validates the canonical request and empty `CODEX_HOME` but can emit only `VALIDATED_REQUEST_LIVE_DISABLED`. The lifecycle coordinator deep-freezes the request, always enters cleanup after resource preparation, imposes a bounded cleanup wait, and returns only `STATIC_DRIVER_TEST_ONLY`.
- Risks: This is application-level admission, not a kernel firewall. The proxy container still needs an outbound network, and a compromised proxy process could attempt other traffic unless the deployment adds independently observed egress controls. The current header allowlist has not been exercised by a real Codex CLI request. Lease counters are process-local, so a proxy restart must fail the run rather than reuse the same lease. The supervisor does not yet cryptographically bind the worker CA bundle to the mounted proxy leaf/key. No immutable image, Docker network, DNS answer, TLS certificate, secret mount, cgroup, process tree, SDK turn, or teardown fact has been observed. Driver-reported cleanup booleans are not attestation; a future concrete Docker executor must derive them through supervisor-owned inspect/PS/filesystem checks before any signed response. Forced termination remains unproved.
- Reversal or migration path: Replace the broker with a platform-native workload-identity or egress-policy service only if it preserves per-run capability scope, exact upstream/path restrictions, provider-key isolation, pinned TLS identity, bounded bodies/responses, non-networked fixture verification, and supervisor-observed teardown. Expand headers only from captured real SDK evidence and add a regression test for every new allowance.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-032 — Own Docker resources by returned IDs and separate the TLS-only egress gate

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: D-030 and D-031 fixed static arguments but used shared network names and left cleanup facts to an injected driver's booleans. Reusing a pre-existing network or removing a newly reused container name could cross run boundaries. A real egress smoke also must not be confused with a model/API call.
- Options considered:
  1. keep fixed names and adopt resources whose labels appear to match;
  2. generate per-run names but continue start/inspect/remove by name;
  3. bind every resource name and label to the admitted request plus a supervisor nonce, acquire ownership only from successful create stdout, use only the returned IDs afterward, and run a separate TLS-handshake gate that sends no HTTP request.
- Decision: Use option 3. The Docker v2 binding is SHA-256 over a fixed domain, request digest, run ID, and independent 128-bit supervisor nonce; its first 32 hex characters name the worker/outbound networks and egress/worker/verifier containers. PolicyTwin labels carry the full binding, request, run, contract version, managed marker, and exact role. Name checks are fail-fast only: existing resources are never adopted or deleted. Network and container creation must return exactly one 64-hex ID; a returned ID becomes destructively owned only after an independent ID/name/label inspection, and every later operation uses that ID. Worker and egress creation replace closed observed-network placeholders with captured network IDs; verifier remains `network=none`. The shell-free Docker runner rejects unapproved verbs, unresolved references, host namespaces, publication, privilege, entrypoint, unsafe security options, and Docker-socket mounts; it requires a canonical absolute Docker executable, the platform-local daemon endpoint, an exact environment, deadlines, abort propagation, output caps, and child close before timeout/abort settles. Supervisor observers require immutable images, numeric users, exact entrypoints/working directories/environments, read-only roots, dropped capabilities, no-new-privileges, exact limits/commands/binds/tmpfs, no published ports, exact per-stage network IDs/membership plus required aliases, and exact PolicyTwin labels. Cleanup attempts all inspected-owned resources in reverse order, never touches unverified IDs, uncaptured names, or unexpected endpoints, requires empty networks before ID removal, verifies both ID-filtered and role/binding-filtered absence, deletes both workspaces, and requires a process-tree observer; init-PID-only procfs evidence is explicitly rejected. `worker:verify` now creates and removes its own labeled internal network and operates containers by inspected IDs. A separate `egress:verify` gate builds worker and proxy images, creates labeled internal/outbound networks, mounts ephemeral CA/leaf/key/lease/dummy-provider files, and runs an internal non-root TLS 1.3 probe. The probe validates `policytwin-egress` and the leaf fingerprint and closes without writing HTTP. It records its own HTTP/model non-action, marks proxy outbound traffic `NOT_MEASURED`, and cannot prove upstream absence. Both dynamic gates require Linux cgroup v2 membership bound to the Docker ID, initial PID absence, an empty/released cgroup, independently observed resource absence, and secret deletion. `verify:live` requires both dynamic gates before it may proceed, but still fails because cumulative CPU-time enforcement and the live worker are unavailable.
- Evidence: `src/codex/docker-command-runner.ts`, `src/codex/docker-observer.ts`, `src/codex/supervisor-docker-driver.ts`, `src/codex/worker-os-lifecycle.ts`, `src/codex/worker-runtime-contract.ts`, `src/codex/egress-runtime-contract.ts`, `scripts/worker-container-verify.mjs`, `scripts/egress-container-verify.mjs`, `scripts/egress-tls-probe.mjs`, `container-contract.json`, and fake-daemon tests for ID-only operation, name preemption, partial creation, foreign endpoints, and published ports.
- Consequences: The repository now has a concrete supervisor Docker command driver rather than only a sequence string, while its deterministic result remains `STATIC_DRIVER_TEST_ONLY`. A future Docker host has two explicit non-live dynamic prerequisites, and a TLS-path PASS cannot impersonate an OpenAI, model, or Codex request.
- Risks: The concrete driver is not connected to a live mTLS execution result. Docker and immutable images are unavailable here, so the real create/inspect/TLS/cgroup/cleanup path has not run. The exact cgroup v2 path and Docker inspect assumptions must be checked on the selected Linux daemon. Docker-administrator compromise is outside the label ownership contract. The dynamic TLS gate does not test OpenAI DNS/SNI/upstream headers, and the broker's process-local lease still requires fail-stop restart handling. The CA/leaf/key binding is verified only when the dynamic TLS gate actually runs. Cumulative `cpuTimeMs` is not a hard-enforced Docker limit in this static driver and therefore remains a live-execution blocker. D-032 supersedes D-030's fixed shared-network detail without changing its worker/verifier privilege split.
- Reversal or migration path: Replace Docker only with a runtime that returns non-reusable resource handles, supports exact network/mount/process observation and bounded teardown, and preserves the TLS-only gate plus separately observed and authorized live OpenAI/Codex traffic.
- Related files/commits: `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-033 — Keep cumulative CPU enforcement unavailable and harden Docker ownership before live wiring

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: Adversarial review found that a valid-looking create ID could be promoted before identity inspection, Docker CLI lookup could be PATH-substituted, post-create observation omitted several weakening fields, init-PID disappearance did not prove a reaped process tree, and the RPC memory/PID/output policy was not reflected in the worker plan. Docker `NanoCpus` is a rate limit, not a cumulative CPU-time budget.
- Options considered:
  1. preserve the fake-daemon pass and document all gaps for later;
  2. treat any 64-hex stdout as owned and rely on labels during cleanup;
  3. split candidate and inspected ownership, close the observer and CLI boundary now, bind enforceable RPC limits, and explicitly leave cumulative CPU enforcement unavailable until a cgroup-aware live executor exists.
- Decision: Use option 3. Workspace preparation no longer supplies an execution plan. A trusted supervisor configuration provider supplies only the repository root, run identity, auxiliary image IDs, and external secret paths; the driver itself builds the closed plan and recomputes request/binding/names/labels and request-bound worker limits before Docker. Memory, PID, output, and one prepare/worker/verifier execution deadline are request-bound; teardown uses a separately bounded cleanup grace period. `cpuTimeMs` is recorded with `UNAVAILABLE_STATIC_DRIVER` and cannot support a live claim. Create stdout is only a candidate; independent ID/name/PolicyTwin-label inspection is required before cleanup authority. Invalid or lost create output poisons cleanup and is found only through non-destructive binding/role enumeration. Container observation closes entrypoint, working directory, environment, namespaces, devices, security options, bind propagation, and tmpfs settings. Timeout/abort does not settle until the Docker CLI child closes. Dynamic gates require Docker-ID-bound cgroup v2 membership plus init-PID and cgroup process-set teardown, while the injectable procfs-only observer always rejects.
- Evidence: `src/codex/docker-command-runner.ts`, `src/codex/docker-observer.ts`, `src/codex/supervisor-docker-driver.ts`, `src/codex/worker-runtime-contract.ts`, `src/codex/worker-os-lifecycle.ts`, `scripts/linux-cgroup-observer.mjs`, both dynamic gate scripts, and regression tests covering foreign IDs, ambiguous creation, entrypoint/environment/namespace/device/security/tmpfs/bind drift, canonical Docker executable/local daemon admission, request-bound limits, and procfs-only rejection.
- Consequences: The static driver remains useful as a deterministic lifecycle contract but cannot be mistaken for a live CPU-bounded executor. A future live connection must add supervisor-owned cumulative cgroup CPU accounting/enforcement and preserve the current candidate/ownership distinction.
- Risks: No real Docker daemon, immutable image, cgroup, TLS probe, or forced-termination path was available in this environment. Exact Docker image environment and inspect fields may require a narrowly evidenced compatibility adjustment when the immutable base is selected. The trusted minimal configuration provider still needs production wiring from sealed supervisor configuration, and secret inode/hash invariance across a live run remains to be added.
- Reversal or migration path: A replacement runtime may expose a native cumulative CPU quota, but it must still enforce the admitted memory/PID/output/execution-deadline limits plus bounded teardown, return non-reusable resource handles, prove process-tree teardown, and keep all live/dynamic truth flags false until observed.
- Related files/commits: `container-contract.json`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-034 ??Seal worker admission and bound swap, regular-file writes, and Docker logs

- Date: 2026-07-15
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: Final adversarial review found three remaining static resource-policy gaps. `--memory` without `--memory-swap` allowed additional swap; `outputBytes` capped only the later Docker CLI read while writable response/overlay files and daemon logs could grow during execution; and a trusted mTLS request could select any locally present immutable worker image and any schema-valid resource limits because the supervisor configuration did not independently admit them.
- Options considered:
  1. document these as real-Docker deployment concerns;
  2. inspect sizes only after the worker exits;
  3. enforce the limits in the closed Docker plan, inspect them independently, and reject request image/limits outside sealed supervisor configuration before workspace or Docker work.
- Decision: Use option 3. Every worker, verifier, egress, and TLS-probe container sets memory+swap equal, so the declared memory ceiling cannot borrow extra swap. Each process inherits an `fsize` soft/hard limit equal to its admitted output ceiling, bounding every regular response/overlay write. Docker uses only the local log driver with `max-size` equal to the same ceiling and `max-file=1`; the command runner rejects other log/ulimit shapes. Supervisor inspection requires exact `MemorySwap`, `Ulimits`, and `LogConfig` values before execution. The supervisor configuration now supplies an exact allowed worker image plus five maximum resource values; a request must match that image and remain at or below every maximum before workspace preparation. The driver still uses request values inside those sealed maxima and still cannot claim cumulative CPU-time enforcement.
- Evidence: `src/codex/worker-runtime-contract.ts`, `src/codex/egress-runtime-contract.ts`, `src/codex/docker-command-runner.ts`, `src/codex/docker-observer.ts`, `src/codex/supervisor-docker-driver.ts`, both dynamic container scripts, `container-contract.json`, and regression tests for swap, file-size, log-driver/rotation, worker-image, and supervisor-limit drift.
- Consequences: Static/fake-daemon evidence now bounds the principal per-run host-disk and swap surfaces before any live wiring. The response and exactly two writable repair files can each reach at most the admitted output ceiling; other writable container storage is size-bounded tmpfs. A weakening or mismatched Docker inspection fails before the process result is trusted.
- Risks: No real Docker daemon has confirmed the selected `local` log-driver option serialization, `fsize` behavior, memory/swap behavior, or cleanup after an actual limit violation. These remain dynamic gate obligations. Cumulative CPU time remains unavailable and blocks live work; Docker-daemon administrator compromise remains outside this contract.
- Reversal or migration path: A replacement runtime may use filesystem quotas or a native bounded log sink instead of `RLIMIT_FSIZE` and Docker local-log rotation, but it must preserve supervisor-sealed image/resource admission, a no-swap-overrun memory ceiling, independently observed limits, bounded writable storage, and fail-closed cleanup.
- Related files/commits: `container-contract.json`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-035 — Fail the run if the egress proxy instance restarts or changes

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: The Responses-only proxy keeps its per-lease request count in memory. Reconstructing the guard after a proxy restart would reset that count. The worker cannot reach the Docker daemon and Docker-administrator compromise is outside the owned-resource contract, but the supervisor still needs to prevent automatic restart and reject any stopped, restarted, or replaced proxy before trusting a worker result.
- Options considered:
  1. persist the lease counter in a writable proxy-local database and allow a restarted proxy to continue;
  2. rely on Docker's default restart behavior without inspecting it;
  3. explicitly set `restart=no`, require zero restart count, pin the owned container ID plus PID and canonical start timestamp, and reobserve the same running identity before and after worker execution and immediately before the supervisor stops the proxy.
- Decision: Use option 3 for the trusted single-run fixture. Every worker, verifier, egress, and TLS-probe invocation explicitly requests `restart=no`; inspect must report restart policy `no`, retry count zero, and container `RestartCount` zero. The driver pins the first running PID/start timestamp and rejects a missing or zero start time, stopped egress, PID change, start-time change, nonzero restart count, or missing inspection field. It reobserves egress before worker start, after the worker wait/log boundary, and before proxy stop; a failure prevents receipt validation and proceeds only to supervisor cleanup. Container ownership remains the inspected returned ID, not a name or mutable PID.
- Result boundary: After every worker, verifier, or egress wait, the driver requires the same start timestamp, `running=false`, and PID zero both before and after reading logs. A running or changed instance cannot supply a trusted receipt even if its log bytes look valid.
- Evidence: `src/codex/worker-runtime-contract.ts`, `src/codex/egress-runtime-contract.ts`, `src/codex/docker-command-runner.ts`, `src/codex/docker-observer.ts`, `src/codex/supervisor-docker-driver.ts`, both dynamic container scripts, `container-contract.json`, and fake-daemon regressions for policy, PID, timestamp, running-state, stopped-state, restart-count, and missing-field drift.
- Consequences: A proxy crash cannot be automatically restarted, and a worker result cannot be accepted after the observed proxy instance changes. The process-local lease counter remains acceptable only inside that one continuously observed proxy instance.
- Risks: This is static/fake-daemon evidence until a real Linux Docker gate confirms `RestartPolicy`, `RestartCount`, timestamp, PID, and stop semantics. The supervisor samples at execution boundaries rather than continuously; a Docker administrator could still manipulate the daemon between samples, which remains outside this threat model. Cumulative cgroup CPU enforcement, durable proxy-state alternatives, real upstream behavior, and live Codex execution remain unavailable.
- Reversal or migration path: A durable external lease store may later replace fail-stop restart handling, but it must atomically bind run ID/token hash/request count, survive process restart without reuse, and preserve the same owned-container and cleanup proofs.
- Related files/commits: `container-contract.json`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-038 — Admit Worker RPC v2 transports by factory identity rather than self-declaration

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: Worker RPC v2 required `authenticationMode:"MUTUAL_TLS"`, but that field belonged to a public structural interface. A fake object, shallow copy, or wrapper could claim the string and reach request construction. An admitted Ed25519 live-purpose key was still required to forge PASS and PASS signing remained disabled, so this was a P2 hardening gap rather than a live-promotion path.
- Options considered:
  1. retain the string check and rely only on response signatures;
  2. add a copyable symbol/property brand to the public transport object;
  3. co-locate the actual v2 TLS factory with a private `WeakSet`, expose no arbitrary registrar, freeze factory results, and require object-identity membership at v2 client construction.
- Decision: Use option 3. The v2 mTLS client module privately records only the exact object created and frozen by its actual factory. Before closing over connection state, the factory reads every option once, validates it, stores scalar values in a frozen snapshot, defensively copies every Buffer and the CA array, and exposes no arbitrary registration function. The v2 client requires the opaque type and runtime assertion before it creates a request. V1 factory results, self-declared objects, shallow copies, and wrappers fail construction. The assertion module is outside the root package exports, while the public v2 factory and opaque transport type remain available through their intended API. Synthetic response-validation tests use scripted real TLS 1.3 peers and the actual factory instead of an internal registration seam.
- Evidence: `src/codex/worker-rpc-mtls-transport.ts`, `src/codex/worker-rpc-transport-capability.ts`, v2 client/factory integration, root/subpath export assertions, fake/v1/copy/wrapper rejection tests, scalar/Buffer/array post-construction mutation tests, factory-backed scripted TLS response tests, and loopback mTLS v2 FAIL integration.
- Consequences: Public callers cannot opt into the v2 security profile by setting a string or copying fields. The returned transport cannot be monkey-patched after creation, and later mutation of the caller-owned options object or in-memory TLS buffers cannot change its private connection snapshot.
- Risks: This is a trusted host-process/package boundary, not protection against arbitrary code already executing inside the repository or a compromised process. Security still depends on TLS peer validation, certificate pins, the dedicated Ed25519 trust bundle, and disabled PASS/live admission.
- Reversal or migration path: A future runtime can replace the private factory capability with a private-class or native transport handle, but it must preserve identity-only admission, immutability, absence of arbitrary registration, and rejection of copied/wrapped transports.
- Related files/commits: `container-contract.json`, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `PROGRESS.md`.

### D-037 — Separate signed live CPU evidence into Worker RPC v2 without admitting a live run

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: Worker RPC v1 signs the repair report, execution tree, policy, corpus, and teardown fields, but it has no client-owned execution binding, Docker binding, or three-role CPU proof. Adding an optional proof to v1 would let a legacy frame, signature domain, or general-purpose worker key be confused with a live CPU-capable result. The static fake ledger is intentionally unsigned and cannot establish Linux observation.
- Options considered:
  1. add an optional CPU object to Worker RPC v1 and reuse its key and transport profile;
  2. trust a dynamic-report boolean or the static fake proof after signing it;
  3. define a strict independent live proof and a non-downgradable Worker RPC v2 profile while keeping every live gate closed until a real Linux controller produces that proof.
- Decision: Use option 3. `LiveLinuxCgroupCpuProof` is a separate exact-key candidate-success envelope. It binds request ID/nonce/digest, a client-derived execution binding, supervisor run, immutable worker image, worker policy, accepted corpus, unsigned-64-bit request budget, exact ordered egress/worker/verifier identities, embedded monotonic role samples and hashes, exact deltas/aggregate, controller stop, and cgroup release. Its Docker binding is deterministically recomputed from the request digest, execution binding, supervisor run, worker image, and the three container/PID/start/cgroup identities rather than trusted as an opaque string. It admits only `OBSERVED_WITHIN_BUDGET`; `hardLimitEnforced` and `overshootBounded` are always false. Worker RPC v2 uses a new protocol and signature domain, client-derived execution binding, one factory-created immutable trust bundle that parses and deduplicates every v1/v2 Ed25519 SPKI, exact live-purpose signer registration with key material distinct from v1, a durable SQLite replay store, mutual TLS only, and separate ALPN plus request/response magics. The client shape requires a proof for PASS and forbids a success proof on FAIL, but the repository's generic v2 supervisor is deliberately fail-only and refuses to sign PASS until a real Linux controller is wired. Runtime receipt bodies are exact-key checked so an injected executor cannot override signer identity. V1, a static proof, an unsigned v2-shaped object, reused key material, signature reuse, and ALPN/frame downgrade cannot promote a run. `verify:live` remains unchanged and fail-closed.
- Evidence: `src/codex/live-linux-cgroup-cpu-proof.ts`, `schemas/live-linux-cgroup-cpu-proof.v1.schema.json`, Worker RPC contract/client/mTLS v2 implementations, schema-v7 static container checks, exact uint64/parser-schema boundary tests, proof/client adversarial unit tests, and loopback mTLS tests covering fail-only signing, distinct key material, durable replay admission, signer-field injection, and downgrade rejection.
- Consequences: The signed evidence shape and downgrade boundary can be reviewed and tested before implementing privileged Linux control. A future controller has one exact result contract instead of extending a legacy protocol in place.
- Risks: No current artifact was observed from Linux. Unit tests construct synthetic within-budget proofs with test keys, while the real mTLS v2 integration intentionally returns signed `FAIL` with `cpuProof:null`. The candidate proof has per-role values but no signed global timestamped start/sample/stop event transcript, so it cannot yet prove the egress-worker overlap or verifier ordering. FAIL has no bounded CPU failure/containment evidence union. These two fields remain explicit schema-v7 false blockers and require a later proof-schema version before PASS signing can be enabled. No cgroup path, `cpu.stat` sample, serial poll, freeze, kill, containment, release, Docker execution, model call, or Codex repair occurred. User-space polling still cannot prove a hard cap or bounded overshoot.
- Reversal or migration path: Version the candidate proof with a global timestamped event transcript and signed failure/containment union, implement a Linux-only controller behind a dedicated PASS producer, exercise under-budget and deliberate-overage/identity/timeout/cleanup failures in immutable real containers, bind the receipt into evidence v2, and only then enable PASS signing or narrow the live gate's unavailable state. Preserve v1 as non-live compatibility and never reinterpret old receipts as v2.
- Related files/commits: `container-contract.json`, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-044 — Construct the private Docker-owned Linux adapter without admitting runtime proof

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: D-043 prepared a role barrier and native helper, but no authority owned Docker creation, no factory-issued observation could bind a helper role, and no concrete adapter enforced the required bind/baseline/release/containment/cleanup order. A structural port or caller-supplied PID/container ID would allow forged authority, while terminating a poisoned helper before independently proving Docker absence could strand or release processes unsafely.
- Options considered:
  1. let the existing static Docker driver or arbitrary port supply role identities to the helper;
  2. expose public role-plan and observation objects and rely on their validated fields;
  3. add private factory-identity capabilities for exact role plans, a real Docker CLI owner, one-shot Docker reobservation and removal receipts, a full helper role session, and a private system adapter/lifecycle, while retaining every runtime, finalization, PASS, and live flag as false until dynamic Linux evidence exists.
- Decision: Use option 3. Schema v13 adds exact per-role commands, users, work directory, bind targets, tmpfs, barrier entrypoint, labels, resources, and security options behind a private role-plan identity. A private owner accepts only the repository's actual Docker CLI runner, preflights unique names, creates containers without starting them, independently verifies ownership and runtime identity, connects networks, starts held roles, issues single-use reobservation receipts, and removes only independently reverified owned containers. Malformed create output is recovered only through the exact unique name plus ownership label; removal and all-role-absence receipts require both inspect and list absence. The helper client now exposes private bind/sample/freeze/kill/quiescent/release sessions, checks run binding, role state, counters, and one session-global RAW clock, and accepts only owner-issued reobservation receipts. The system adapter orders create, held receipt, first Docker observation, helper bind with baseline capture, second Docker observation, cached-baseline acceptance, barrier release, serial sampling, containment, quiescent final sample, Docker removal, cgroup release, and controller stop. Partial starts and failures retain sticky cleanup; forced helper termination is permitted only after an opaque all-Docker-roles-absent receipt, using EOF then SIGTERM and SIGKILL only as the final bounded step. The dedicated private lifecycle accepts only the concrete private adapter. No finalized-result issuer or signer integration is added.
- Evidence: `src/codex/live-linux-docker-role-plan.ts`, `src/codex/live-linux-docker-owned-container.ts`, `src/codex/live-linux-docker-cgroup-system-adapter.ts`, `src/codex/linux-cgroup-helper-client.ts`, `src/codex/linux-cgroup-helper-protocol.ts`, `src/codex/live-linux-cgroup-cpu-dedicated-lifecycle.ts`, `src/codex/docker-command-runner.ts`, `native/policytwin-linux-cgroup-helper.c`, focused unit tests, schema-v13 source-tamper checks, and strict C17 compilation. Independent hostile reviews identified and drove fixes for forged mount/plan authority, cross-run binding, identity drift before actuation, partial-start cleanup, nonzero Docker wait acceptance, malformed-create orphan recovery, helper poison termination, and concurrent cleanup races.
- Consequences: The repository now contains one reviewable concrete construction path from owned Docker roles through kernel-backed helper operations and the dedicated lifecycle. Parser-valid objects, copies, fake ports, the static driver, and the synthetic evidence producer cannot enter that path. This is implementation evidence only: the available host has not run it against a Linux Docker daemon and cgroup v2, so the contract retains `dynamicIsolationVerified:false`, `nativeHelperRuntimeVerified:false`, `finalizedEvidenceIssuerImplemented:false`, `passSigningEligible:false`, and all live claims false.
- Risks: The helper is not yet built reproducibly into a digest-bound supervisor image; Docker/cgroup v2, cross-UID barrier permissions, descriptor exclusivity, pidfd/cgroup identity drift, descendant survival, forced containment, teardown-tail CPU, and helper-crash recovery remain dynamically unverified. The current role target still performs validation-only fixture work rather than the final live Codex repair. User-space polling cannot prove a hard limit or bounded overshoot. No private finalized-evidence issuer, Worker RPC v2 PASS signer, live gate admission, model call, Codex repair, deployment, or submission exists.
- Reversal or migration path: Build and pin the helper image, run the exact private construction on an immutable Linux Docker/cgroup-v2 host, and exercise under-budget, one-microsecond-over, cancellation, identity drift, descendant survivor, helper crash, malformed create, and cleanup-timeout cases. Only after those dynamic results pass may a private finalized-result issuer be added and its exact identity considered by the signer and live gate.
- Related files/commits: `container-contract.json`, `src/codex/live-linux-docker-role-plan.ts`, `src/codex/live-linux-docker-owned-container.ts`, `src/codex/live-linux-docker-cgroup-system-adapter.ts`, `src/codex/linux-cgroup-helper-client.ts`, `src/codex/live-linux-cgroup-cpu-dedicated-lifecycle.ts`, `native/policytwin-linux-cgroup-helper.c`, focused tests, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-045 — Seal supervisor configuration and make Docker network ownership explicit

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: D-044 created a concrete private owner, but a structurally valid caller-supplied role plan could still choose images, source mounts, environment, limits, or network IDs. In addition, `docker create` or `docker network create` can perform its daemon-side effect and then throw, time out, abort, or return unusable output; recovery limited to parsed stdout would leave an owned resource orphaned. Treating only returned IDs as cleanup authority also conflicted with the exact-name recovery needed for this side-effect-ambiguous state.
- Options considered:
  1. keep accepting validated role plans and rely on field-by-field checks at each Docker call;
  2. let the caller create networks and pass their IDs to the private owner;
  3. require one deeply frozen factory-issued supervisor lifecycle plan, make the owner create and independently inspect both networks, derive role plans internally from their observed IDs, and use exact-name plus ownership-label recovery only for cleanup after ambiguous create outcomes.
- Decision: Use option 3. Schema v14 registers only the exact lifecycle plan returned by the supervisor factory in a module-private identity set and recursively freezes it. The private Docker owner accepts that plan, the exact prepared barriers, and the concrete Docker runner; it rejects copies, mutable descendants, externally supplied role plans, raw images, mounts, environment, labels, limits, run bindings, or network IDs. It preflights both names, creates an internal worker network and a distinct outbound bridge, independently inspects name/labels/driver/scope/internal/attachable/options/endpoints, then derives all three role plans from the observed network IDs. Container and network create operations mark the side effect unresolved before invoking Docker. Any thrown, timed-out, aborted, malformed, empty, foreign, or ambiguous result uses a fresh bounded cleanup signal to list by the exact name and may acquire cleanup-only authority only over one independently inspected exact-label owned resource. Uncertainty remains sticky and can never authorize start or execution. Normal and emergency cleanup remove containers before networks, require exact endpoint membership while resources exist, and prove container ID/name plus network ID/name absence before a cleanup receipt can complete. The system adapter also verifies that the owner carries the exact barrier controller and prepared barrier identities.
- Evidence: `src/codex/egress-runtime-contract.ts`, `src/codex/live-linux-docker-role-plan.ts`, `src/codex/live-linux-docker-owned-container.ts`, `src/codex/live-linux-docker-cgroup-system-adapter.ts`, schema-v14 `container-contract.json`, focused copy/tamper/create-recovery/network-absence tests, the authoritative unit suite, static source checks, strict typecheck, and lint. Independent P1 reviews drove the sealed-plan boundary, owner-created network lifecycle, whole-command ambiguity recovery, exact-name absence checks, and independent cleanup cancellation.
- Consequences: The private construction no longer trusts request-shaped Docker configuration or pre-existing network IDs, and a daemon-side create followed by client failure has an explicit fail-closed cleanup path. Cleanup-only recovery is distinct from execution authority. These are source and offline contract facts only; no Docker daemon or Linux cgroup v2 runtime has exercised them.
- Risks: Real Docker list/inspect behavior during daemon restart, delayed name visibility, network endpoint races, selected image environment, cross-UID barrier mounts, helper packaging, cgroup identity, containment, and teardown-tail CPU remain dynamically unverified. Schema v14 therefore keeps `dynamicIsolationVerified:false`, `nativeHelperRuntimeVerified:false`, `finalizedEvidenceIssuerImplemented:false`, `passSigningEligible:false`, and live admission false. No model call, Codex repair, deployment, or submission is implied.
- Reversal or migration path: If the selected daemon requires a compatibility adjustment, change only the sealed factory and independent observer together, preserve owner-created unique resources, cleanup-only exact-name recovery, sticky ambiguity, and final name/ID absence, then prove the exact behavior under immutable Linux Docker/cgroup-v2 failure injection before adding any finalized-result issuer.
- Related files/commits: `container-contract.json`, `src/codex/egress-runtime-contract.ts`, `src/codex/live-linux-docker-role-plan.ts`, `src/codex/live-linux-docker-owned-container.ts`, `src/codex/live-linux-docker-cgroup-system-adapter.ts`, `tests/unit/worker-runtime-contract.test.mjs`, `tests/unit/live-linux-docker-role-plan.test.mjs`, `tests/unit/live-linux-docker-owned-container.test.mjs`, `tests/unit/live-linux-docker-cgroup-system-adapter.test.mjs`, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-046 — Package the native helper as a digest-bound artifact without promoting local compilation

- Date: 2026-07-17
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: D-045 sealed Docker lifecycle ownership, but the native cgroup helper still existed only as reviewable C source plus an ad hoc local compile. A privileged helper container with Docker-socket access would unnecessarily enlarge authority, while accepting a host-compiled path or a caller-provided hash would leave the executable outside the sealed runtime configuration. The current network approval does not include a compiler-image registry pull, and the local WSL distribution has no usable cgroup-v2 host.
- Options considered:
  1. run a privileged supervisor/helper container with the Docker socket and cgroup filesystem mounted;
  2. compile the helper on the host and trust the resulting path or reported hash;
  3. define a digest-pinned compiler stage that emits one root-owned static PIE into a scratch artifact image, extract and validate that exact file without starting it, bind its image/source/build/binary identities into the sealed lifecycle, and keep local compilation as explicitly non-image-bound evidence.
- Decision: Use option 3. `Dockerfile.cgroup-helper` has no mutable base fallback, package installation, download, or runtime layer. It compiles stdin with the fixed C17 hardening arguments and copies only `/policytwin-linux-cgroup-helper` into `scratch` with mode `0555`. The artifact contract hashes the fixed source and build inputs and parses ELF directly: only little-endian AMD64 `ET_DYN` with an executable load segment, no interpreter, no `DT_NEEDED`, a declared non-executable GNU stack, and a 4 MiB maximum is accepted. The local builder performs two byte-identical strict builds and records SHA-256 plus ELF facts, but marks the compiler unpinned and every image/install/cgroup/signing claim false. The dynamic verifier requires an approved `@sha256` builder already present locally, uses `--pull=false` and `--network=none`, extracts a root-owned `0555` tar entry without starting the helper, compares observed image and binary identities with the contract, and remains fail-closed before Docker while the builder is unset. Schema v15 and supervisor lifecycle v3 carry the helper artifact image ID, source hash, build-input hash, and binary hash. The private Docker owner snapshots the sealed binary hash, and the Docker/cgroup adapter rejects a helper client whose same-FD executable hash differs.
- Evidence: `Dockerfile.cgroup-helper`, `scripts/native-helper-contract.mjs`, `scripts/native-helper-build.mjs`, `scripts/native-helper-container-verify.mjs`, `artifacts/security/native-helper-local-build-report.json`, `artifacts/security/native-helper-container-report.json`, lifecycle v3 source changes, helper/ELF/tar/tamper tests, and schema-v15 static checks. The local WSL compiler produced two byte-identical 841,656-byte static PIE files with SHA-256 `906214d0489875ebbc718d934397fb2e43b00b5af825391c247b1efb112abdef`; this is local-toolchain evidence only.
- Consequences: The executable selected by the future private adapter can no longer be independent of the sealed supervisor plan, and artifact extraction does not require granting a container Docker or cgroup authority. The repository now has a reproducible build recipe and a two-phase discovery/pinning gate, but it truthfully retains `imageBuildVerified:false`, `hostInstallVerified:false`, `runtimeVerified:false`, and `passSigningEligible:false`.
- Risks: No immutable compiler image is configured or present, so Docker image reproducibility, compiler provenance, root/mode preservation on the selected daemon, host installation, helper handshake, real pidfd/cgroup binding, cross-UID barriers, containment, teardown-tail accounting, and cleanup remain unobserved. A local compiler version string and repeated output are not a supply-chain pin. The helper image and binary hashes must be discovered and committed only after an approved registry scope and real local-daemon build; they must then be rebuilt and matched in the final Linux environment.
- Reversal or migration path: If the selected compiler image cannot emit a compatible static PIE, change the pinned builder and fixed flags through a new contract version, regenerate the build-input/source/binary identities, and repeat artifact plus runtime failure injection. Do not weaken the ELF checks, accept a dynamically linked helper, or let a caller substitute a path/hash. Only after exact image build, host installation, real cgroup-v2 lifecycle, containment, and cleanup gates pass may finalized evidence or PASS admission be added.
- Related files/commits: `container-contract.json`, `Dockerfile.cgroup-helper`, `scripts/container-build-inputs.mjs`, `scripts/native-helper-contract.mjs`, `scripts/native-helper-build.mjs`, `scripts/native-helper-container-verify.mjs`, `src/codex/egress-runtime-contract.ts`, `src/codex/worker-runtime-contract.ts`, `src/codex/supervisor-docker-driver.ts`, `src/codex/live-linux-docker-owned-container.ts`, `src/codex/live-linux-docker-cgroup-system-adapter.ts`, focused tests, `README.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, and `PROGRESS.md`.

### D-041 — Harden the non-live cgroup observer without promoting it to the live adapter

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: The existing dynamic-smoke observer accepted a Docker ID as any path substring, followed caller-provided observation paths after the first read, converted `cpu.stat usage_usec` through `Number`, and treated an empty direct `cgroup.procs` file as proof that the whole subtree was empty. A forged object or a live process in a child cgroup could therefore satisfy its local teardown check, while a counter regression could produce a negative delta that passed the budget comparison. These facts were not connected to Worker RPC v2 PASS, but they would be unsafe inputs to a future Linux adapter and could overstate the non-live dynamic gate.
- Options considered:
  1. leave the observer unchanged because the real daemon and PASS signer are unavailable;
  2. recursively walk descendant pathname entries after container exit;
  3. harden the current non-live observer around one private, descriptor-pinned cgroup identity while keeping the real adapter, start barrier, containment controller, signer, and live gate separate.
- Decision: Use option 3. Only canonical POSIX memberships ending in `/docker/<64-id>` or `docker-<64-id>.scope` are accepted. The observer verifies a cgroup v2 filesystem, opens the cgroup directory with `O_DIRECTORY | O_NOFOLLOW`, binds its path, descriptor target, device, and inode, and stores the open descriptor in a module-private `WeakMap`. Follow-up operations reject forged, copied, closed, or reused handles and read allowlisted files through `/proc/self/fd/<fd>` with fatal UTF-8 decoding and an actual 64 KiB byte cap. `usage_usec` is parsed over the full unsigned-64 range as `bigint`; the caller requires `final >= initial` and exact `BigInt(cpuTimeMs) * 1000n` arithmetic. Final CPU sampling requires `cgroup.events populated 0` plus an empty direct process list, and any sampling failure explicitly fails the report. Final teardown separately records subtree quiescence, initial-PID absence, and original cgroup release, closes the descriptor on every outcome, and preserves normal or recovery-path stop/disconnect/removal failure even if a later forced removal succeeds. The static container contract advances to schema v10 and explicitly marks this as `NON_LIVE_DYNAMIC_GATE_ONLY`, with runtime verification, start barrier, live evidence adaptation, actuation, generic PASS signing, and live admission still false.
- Evidence: `scripts/linux-cgroup-observer.mjs`, both dynamic container verifiers, `tests/unit/linux-cgroup-observer.test.mjs`, static source-tamper checks in `tests/unit/container-contract.test.mjs`, and schema-v10 container checks.
- Consequences: The existing dynamic smoke can no longer pass on a child-cgroup survivor, forged pathname object, reused inode/path, uint64 precision loss, counter regression, or ignored teardown action failure. Its facts no longer call `populated=0` “all processes reaped”; subtree quiescence, PID absence, cgroup release, and Docker-resource absence remain distinct.
- Risks: This checkpoint ran on Windows without a Linux cgroup v2 filesystem or Docker daemon. The two admitted Docker membership forms, descriptor behavior after cgroup removal, and cleanup timing still require dynamic validation on the selected Linux daemon. The observer still takes its baseline after Docker start and therefore cannot become cumulative live evidence. It has no pre-execution start barrier, raw monotonic clock, serial poller, freeze/kill controller, independently bounded cleanup signal, or signer capability.
- Reversal or migration path: The future private-capability Linux adapter may reuse the reviewed parsing and identity invariants, but it must own a pre-execution Docker start barrier, baseline-before-work ordering, raw-clock transcript, bounded polling and containment, finalize-after-cleanup lifecycle, and dynamic failure evidence. Do not pass this static observer's object or facts to a Worker RPC signer.
- Related files/commits: `container-contract.json`, `scripts/linux-cgroup-observer.mjs`, `scripts/worker-container-verify.mjs`, `scripts/egress-container-verify.mjs`, `tests/unit/linux-cgroup-observer.test.mjs`, `tests/unit/container-contract.test.mjs`, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-042 — Separate private adapter identity from parser-valid CPU evidence

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: CPU evidence v2 deliberately accepts parser-valid synthetic success fixtures, while Worker RPC v2 currently stays safe because its supervisor rejects every PASS. Removing that rejection in the future without an independent runtime-identity check would let a raw evidence object, synthetic candidate, copied wrapper, or non-live cgroup observation become a signing candidate. The existing static OS lifecycle also finalizes its fake CPU proof before cleanup and takes baselines after container start, so it cannot define the real lifecycle order.
- Options considered:
  1. add a `provenance` or `passSigningEligible` field and trust its value after JSON parsing;
  2. reinterpret the synthetic producer, static Docker lifecycle, or non-live observer as the future real adapter;
  3. create a separate internal capability scaffold with compile-time brands plus module-private object-identity admission, define the required finalize-after-cleanup lifecycle order, and provide no finalized-evidence issuer or PASS integration until the concrete Linux runtime exists.
- Decision: Use option 3. A non-root-exported capability module defines distinct adapter and finalized-evidence brands, but runtime authority comes only from private `WeakSet` identity. The scaffold factory snapshots its cleanup timeout once, returns a frozen object that hard-codes `runtimeAvailable:false`, `liveEvidenceIssuanceEnabled:false`, and `passSigningEligible:false`, and exposes no arbitrary registrar. The finalized-evidence guard has no issuer in this checkpoint, so raw evidence, synthetic candidates, copied or wrapped objects, and non-live observations all fail identity admission. A separate 28-stage success contract requires each role's held start barrier before cgroup binding and baseline, release only after baseline, worker/egress cleanup before verifier admission, Docker and cgroup release before controller stop, and evidence finalization only after controller stop. The contract requires serial polling, per-sample identity revalidation, a cleanup signal independent of execution cancellation, and sticky cleanup failure. It is a scaffold only: the Linux system adapter, start-barrier runtime, lifecycle implementation, final-result issuance, signer admission, PASS signing, and live gate remain disabled. The static container contract advances to schema v11 to preserve these distinctions.
- Evidence: `src/codex/live-linux-cgroup-cpu-adapter-capability.ts`, `src/codex/live-linux-cgroup-cpu-adapter.ts`, `tests/unit/live-linux-cgroup-cpu-adapter.test.mjs`, `tests/unit/container-contract.test.mjs`, and schema-v11 source-tamper checks.
- Consequences: Future PASS work now has an explicit object-identity boundary and an immutable lifecycle order instead of relying on evidence shape or prose provenance. The current repository still cannot create signer-eligible evidence, and the unconditional v2 PASS rejection plus `CUMULATIVE_CPU_PROOF_UNAVAILABLE` live-gate result remain mandatory.
- Risks: The scaffold is not a Linux adapter and cannot prove any runtime fact. It has no owned-container capability, PID start-time or pidfd, actual `clock_gettime(CLOCK_MONOTONIC_RAW)`, start barrier, cgroup poller, freeze/kill actuation, cleanup runner, dynamic Docker evidence, or final-result issuer. Code with arbitrary access to internal modules can create the non-live scaffold, so future signing must require the separately issued finalized-result identity, not adapter identity alone.
- Reversal or migration path: Implement the concrete Linux-only factory in the same internal boundary, bind factory-issued Docker and start-barrier handles to PID start-time/pidfd plus cgroup FD/device/inode, execute the 28-stage lifecycle with independently bounded cleanup, and add a private finalized-result issuer only after immutable-container under-budget, over-budget, cancellation, identity-drift, descendant-survivor, and cleanup-failure gates pass. Then wire the signer to finalized-result identity rather than raw evidence shape; never add a public registrar.
- Related files/commits: `container-contract.json`, `src/codex/live-linux-cgroup-cpu-adapter-capability.ts`, `src/codex/live-linux-cgroup-cpu-adapter.ts`, `tests/unit/live-linux-cgroup-cpu-adapter.test.mjs`, `tests/unit/container-contract.test.mjs`, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.
- Follow-up: D-044 implements the private role-plan, Docker-owner, full helper-session, system-adapter, and dedicated-lifecycle construction. The finalized-result issuer, dynamic Linux proof, signer admission, PASS, and live gate remain absent.

### D-043 — Prepare the start barrier and native Linux helper without admitting live evidence

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: D-042 fixed the private authority boundary and 28-stage success order, but no role-side code could actually wait before policy work, no host-only release capability existed, and Node.js could not provide `CLOCK_MONOTONIC_RAW`, pidfds, `openat2`, or cgroup actuation. Reusing the post-start non-live observer or trusting `process.hrtime.bigint()` would silently weaken the evidence contract. Connecting an arbitrary fake port to the real adapter would also create a promotion path before Linux runtime validation.
- Options considered:
  1. use Node.js timing plus the existing observer and describe them as the live adapter;
  2. add an in-process FFI/native addon for Linux syscalls and directly connect its structural results to signing;
  3. implement a host/role one-shot barrier, a separately labeled non-privileged lifecycle harness, and a repository-owned out-of-process C helper boundary, while leaving the real Docker-owned system adapter and finalized-evidence issuer absent.
- Decision: Use option 3. Each role image now bundles an immutable barrier launcher, but the default static entrypoint is unchanged. A future dedicated invocation must provide two run-scoped bind mounts. The receipt mount contains host-created and host-owned `held.json` plus `held.commit.json` slots inside a non-writable directory; the non-root role may fill only those existing files, closes the payload before writing a SHA-256 commit, and cannot replace either path. The separate control mount is host-writable and container-read-only. The host therefore reads and same-FD-freezes its own inodes instead of assuming that it can open or chmod a container-UID-owned `0600` file. The launcher accepts only an exact binding-matched host release, requires an empty `NODE_OPTIONS`, strips inherited Node loader options from the child, and never receives a release secret in its environment. The host controller uses private `WeakMap` identities, a fresh canonical root, CSPRNG barrier IDs, no-follow bounded reads, payload/commit identity and hash revalidation, an atomic one-shot release, and identity-checked cleanup. A separate `NON_PRIVILEGED_TEST_PORT` harness exercises the lifecycle order without becoming adapter authority: every external execution operation is checked for cancellation before and after, role samples carry their own RAW timestamp, all reads are serial, quiescent teardown receives a final sample before Docker/cgroup release, aggregate `bigint` accounting includes teardown CPU, and cleanup timeout triggers controller termination plus bounded settlement handling. It returns only frozen `COMPLETED_NOT_FINALIZED` or `FAILED_NOT_FINALIZED` diagnostics with live, finalization, and signing claims false; if forced termination cannot settle the outstanding operation, it rejects the entire run and returns no lifecycle result. The native helper uses a fixed 24-byte binary frame, strict sequence numbers, `clock_gettime(CLOCK_MONOTONIC_RAW)`, pidfd identity, exact Docker cgroup components, `openat2` with beneath/no-symlink/no-magiclink/no-cross-mount constraints, pinned cgroup v2 dirfds, session-wide unique roles, uint64 counters, freeze/kill/quiescence/release state, and best-effort EOF containment. The private client hashes a non-writable binary from an open no-follow FD and executes that same FD through `/proc/self/fd/3`; it currently exposes only handshake and RAW-clock access, not structural Docker bind authority. Schema v12 records the prepared protocol/source/harness separately from all still-false runtime, system-adapter, finalization, signer, PASS, and live flags.
- Evidence: `src/codex/linux-start-barrier.ts`, `scripts/role-start-barrier.mjs`, `src/codex/live-linux-cgroup-cpu-dedicated-lifecycle.ts`, `src/codex/linux-cgroup-helper-protocol.ts`, `src/codex/linux-cgroup-helper-client.ts`, `native/policytwin-linux-cgroup-helper.c`, the three role Dockerfiles, focused barrier/lifecycle/protocol tests, and schema-v12 source-tamper checks. The latest C source compiled successfully in the existing WSL2 Ubuntu-Hermes environment with C17, `-Wall -Wextra -Werror -Wpedantic`, PIE, fortify, and stack protection. Runtime handshake then failed closed before protocol admission because that WSL distribution exposes tmpfs rather than cgroup v2 at `/sys/fs/cgroup`.
- Consequences: The project now has reviewable pre-execution and kernel-helper building blocks plus deterministic lifecycle failure tests without confusing them with runtime proof. No third-party FFI dependency or in-process native memory-safety boundary was added. The existing static Docker driver, synthetic producer, post-start observer, live gate, and signer remain unchanged and non-admitting.
- Risks: The C helper binary is not reproducibly built into a pinned supervisor image, the helper has not bound a real Docker PID or cgroup, and the barrier has not run as PID 1 in an immutable role image. The host-owned `0622` slots plus `0511` directory are a POSIX permission design, not observed cross-UID Docker evidence. `fchmod(0444)` blocks later opens but cannot revoke a write descriptor that was already open; the protocol therefore relies on the pinned trusted launcher closing and syncing the payload before it writes the commit, and the future runtime gate must verify that only that launcher exists and no writable receipt FD survives before release. A malicious or uncooperative future privileged port still requires process-level supervisor fail-stop and external Docker/cgroup cleanup authority. User-space polling cannot prove a hard cap or bounded overshoot. No production private system adapter, Docker-owned-container capability bridge, finalized-result issuer, signed CPU evidence, model call, Codex repair, or deployment exists.
- Reversal or migration path: Add a reproducible digest-bound helper build, a private Docker-owned-container capability, and a Linux-only system adapter that sandwiches Docker reobservation around pidfd/cgroup binding. Exercise exact under-budget, one-microsecond-over, cancellation, identity drift, descendant survivor, helper crash, cleanup timeout, and teardown-tail cases on immutable containers. Only after those dynamic gates pass may the private lifecycle issue finalized evidence and the signer/live gate consider that exact object identity.
- Related files/commits: `container-contract.json`, the three role Dockerfiles, `src/codex/live-linux-cgroup-cpu-adapter-capability.ts`, `src/codex/live-linux-cgroup-cpu-adapter.ts`, `src/codex/linux-start-barrier.ts`, `src/codex/live-linux-cgroup-cpu-dedicated-lifecycle.ts`, `src/codex/linux-cgroup-helper-protocol.ts`, `src/codex/linux-cgroup-helper-client.ts`, `scripts/role-start-barrier.mjs`, `native/policytwin-linux-cgroup-helper.c`, `tests/unit/linux-start-barrier.test.mjs`, `tests/unit/live-linux-cgroup-cpu-dedicated-lifecycle.test.mjs`, `tests/unit/linux-cgroup-helper-protocol.test.mjs`, `tests/unit/container-contract.test.mjs`, `PROGRESS.md`.
- Follow-up: D-044 implements the private Docker-owned capability bridge, full helper role session, system adapter, and dedicated lifecycle wrapper. Runtime validation, digest-bound helper packaging, final-result issuance, PASS, and live admission remain absent.

### D-036 — Gate receipt validation on a fake-only three-role CPU ledger

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: Docker `NanoCpus` limits scheduling rate rather than cumulative CPU time. The dynamic worker smoke compared worker and verifier only after exit, excluded egress, and exposed an unbound `cumulativeCpuTimeEnforced` boolean that the live gate could trust. The prepared lifecycle also validated the worker receipt before verifier execution, so a full-request resource verdict did not precede result trust.
- Options considered:
  1. treat role-local post-exit comparisons or a report boolean as cumulative enforcement;
  2. implement user-space polling and describe the first observed overage as an exact hard cap;
  3. add a required supervisor controller port and strict fake-only aggregate ledger now, reorder receipt validation behind its proof, and keep real enforcement unavailable until a signed Linux cgroup controller is dynamically verified.
- Decision: Use option 3. One request budget is exactly `BigInt(cpuTimeMs) * 1000n` microseconds across egress plus worker concurrency and the subsequent verifier. The static ledger admits roles only in the order egress start, worker start/stop, egress stop, verifier start/stop; requires unique container and cgroup identities, monotonic unsigned 64-bit samples, and an exact request/Docker-binding proof; and poisons on regression, identity drift, incompleteness, or aggregate overage. The Docker driver requires a `SupervisorCpuBudgetController`, binds controller identities to its inspected container ID/PID/start timestamp, keeps worker and verifier JSON as raw wrappers, finalizes and revalidates the proof against the observed identities, then validates both receipts. Every controller call has a bounded supervisor wait. A timeout or ignored abort permanently invalidates the controller-cleanup proof even if that operation later completes; Docker cleanup still proceeds. Controller cleanup begins before Docker teardown and must drain prior work before completing afterward; failure makes lifecycle cleanup incomplete. The provided controller is explicitly `STATIC_FAKE_CONTROLLER_VERIFIED` with post-baseline serial fake sampling and `cumulativeCpuTimeEnforced`, `hardLimitEnforced`, `overshootBounded`, and `containmentTriggered` all false. The unavailable controller always rejects. The live gate admits neither this static proof nor a boolean and remains closed until a separately versioned, signed, request-bound real-Linux proof contract exists.
- Evidence: `src/codex/cpu-budget-contract.ts`, `src/codex/worker-os-lifecycle.ts`, `src/codex/supervisor-docker-driver.ts`, `scripts/live-gate-contract.mjs`, `scripts/worker-container-verify.mjs`, `container-contract.json`, and focused CPU/lifecycle/fake-daemon/live-gate tests.
- Consequences: Offline tests can prove exact arithmetic, state ordering, identity binding, delayed receipt validation, and controller cleanup behavior without fabricating real cgroup enforcement. The dynamic worker report now requires its limited role-local post-exit comparisons for its own PASS, but those facts still cannot satisfy the live gate.
- Risks: Baselines are still conceptually post-start, and no real cgroup path/inode, `cpu.stat` read, sampling interval, scheduler consumption between samples, freeze/kill permission, child-cgroup traversal, forced containment, or teardown reaction time has been measured. User-space polling alone cannot prove zero overshoot or an exact hard cap. The signed RPC result schema does not yet carry a CPU proof.
- Reversal or migration path: Add a separate Linux cgroup-v2 controller and versioned signed proof that binds the request, Docker binding, all role identities, monotonic samples, aggregate/budget verdict, containment actions, and teardown. Exercise intentional overage and every failure path on immutable real images before changing any false enforcement flag or allowing the live gate to advance.
- Related files/commits: `container-contract.json`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-039 — Replace the unreleased Worker RPC v2 CPU slot with versioned success and failure evidence

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: The candidate CPU proof v1 contained role-local counter arrays but no common monotonic clock, so it could not establish egress/worker overlap or verifier ordering. Worker RPC v2 also required `cpuProof:null` on `FAIL` and forced successful teardown fields for every receipt, making pre-execution rejection, controller failure, observed overage, and incomplete containment impossible to express truthfully. The v2 wire profile has never been deployed or admitted by the live gate; its generic supervisor has always refused PASS.
- Options considered:
  1. append optional timing and failure fields to proof v1;
  2. retain nullable `cpuProof` and place failure details in the free-text error;
  3. preserve proof v1 as a non-live legacy parser, define exact CPU evidence schema v2, and atomically replace the unreleased Worker RPC v2 receipt slot with required `cpuEvidence`.
- Decision: Use option 3. CPU evidence v2 binds request, nonce, execution, image, policy, corpus, role identities, and a domain-separated evidence hash. Successful and non-CPU-failure observations are derived from one strictly increasing `CLOCK_MONOTONIC_RAW_NS` event transcript whose exact role lifecycle and samples prove egress/worker overlap, verifier-after-egress ordering, arithmetic, controller stop, and release. Closed failure branches distinguish pre-execution rejection, Linux controller failure, observed over-budget containment, and incomplete containment; partial role attempts receive a separate deterministic attempt binding and may not claim a complete Docker binding. Worker RPC v2 signs the evidence hash as part of both `resultSha256` and the full receipt payload, requires PASS to carry only `OBSERVED_WITHIN_BUDGET`, rejects old v1/static/nullable shapes, permits truthful failure teardown values, and remains generically FAIL-only. The static container contract advances to schema v8 and records contract implementation separately from runtime observation.
- Evidence: `src/codex/live-linux-cgroup-cpu-evidence-v2.ts`, `schemas/live-linux-cgroup-cpu-evidence.v2.schema.json`, Worker RPC v2 contract/client/mTLS code, focused union/transcript/adversarial tests, typed loopback mTLS FAIL, and schema-v8 static checks.
- Consequences: A future dedicated Linux producer has one exact signed success/failure surface, while existing proof v1 cannot be reinterpreted or promoted. Contract tests can exercise synthetic success and failure objects without implying Linux provenance.
- Risks: No Linux controller, Docker role image, cgroup sample, overage, containment action, or release was observed. Strict transcript timestamps are controller assertions authenticated by the future trusted signer, not independent kernel attestation. User-space polling still proves neither a hard cap nor bounded overshoot, so both claims remain false and PASS signing/live admission remain disabled.
- Reversal or migration path: If an external consumer ever requires compatibility with the unreleased candidate wire, introduce a new protocol/signature/ALPN version rather than a permissive union. Enable PASS only through a dedicated real-Linux producer after under-budget and deliberate failure paths pass immutable-container dynamic gates and the resulting receipt is bound into live evidence validation.
- Related files/commits: `container-contract.json`, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.

### D-040 — Keep the first CPU evidence producer synthetic, internal, and non-admitted

- Date: 2026-07-16
- Status: `ACCEPTED`
- Milestone: M7/M9
- Context: CPU evidence schema v2 defined the exact success and failure surface, but no producer owned event serialization, arithmetic, role order, or cleanup-state derivation. A first producer that accepted a public `LINUX_CGROUP_V2` string or connected directly to the existing static lifecycle could let a fake adapter claim Linux provenance, miss CPU consumed before a post-start baseline, finalize before Docker/cgroup cleanup, or lose evidence after abort, overflow, and partial bind side effects.
- Options considered:
  1. wire the new state machine directly into the existing static Docker lifecycle and enable v2 PASS when its parser accepts;
  2. let any frozen system port self-declare Linux provenance while marking only the final wrapper non-live;
  3. implement an internal synthetic-only state machine now, keep every wrapper unsigned/non-live/ineligible for current signing and admission, and require a separate private-capability Linux adapter plus dedicated bounded-cleanup lifecycle before any runtime provenance or PASS path exists.
- Decision: Use option 3. The producer snapshots request and Docker identity inputs, serializes one strict global event queue, enforces egress/worker/verifier order, uses `bigint` unsigned-64 counters, derives bindings and evidence hashes, detects counter regression, identity drift, overage, overlap omission, transient cleanup failure, and incomplete containment, and validates its own final object through the canonical v2 parser. Cleanup action failure remains `CONTAINMENT_INCOMPLETE` even if later release/stop checks recover; all-success actions may also be incomplete when process, release, or controller-stop proof is absent. The only wrapper provenance is `SYNTHETIC_CONTRACT`; the producer is absent from the root export, returns a frozen `UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE`, and hard-codes `liveClaim:false` plus `passSigningEligible:false`. The enclosed raw evidence intentionally remains parser-valid for contract testing, so this is an admission boundary rather than a cryptographic impossibility claim: the generic supervisor refuses PASS, the live gate accepts none, and a future signer must require a separate private real-Linux capability instead of trusting raw evidence shape. Post-system-boundary invalidity, in-flight abort, event/sample exhaustion, and aggregate overflow poison the synthetic session rather than fabricating a parsed result.
- Evidence: `src/codex/linux-cgroup-cpu-evidence-producer.ts`, `src/codex/live-linux-cgroup-cpu-evidence-v2.ts`, `schemas/live-linux-cgroup-cpu-evidence.v2.schema.json`, `tests/unit/linux-cgroup-cpu-evidence-producer.test.mjs`, `tests/unit/live-linux-cgroup-cpu-evidence-v2.test.mjs`, and schema-v9 static container checks.
- Consequences: Contract tests can now prove deterministic production of every producer-supported observed outcome without implying a kernel observation; the separate parser fixtures continue to cover pre-execution rejection. No current production path can sign or admit the wrapper: generic Worker RPC v2 PASS signing, live-gate admission, Linux provenance, and existing static lifecycle behavior remain unchanged and disabled. Parser-valid raw fixture evidence is not itself provenance or signer authorization.
- Risks: Poisoning is fail-closed but does not itself clean real resources. The synthetic port shares the caller signal and has no independent timeout, raw-clock factory, cgroup filesystem identity pinning, descendant-process proof, Docker start barrier, or supervisor-owned emergency cleanup. Therefore it must never be reused as the real Linux adapter or handed to a signer.
- Reversal or migration path: Build a separate Linux-only factory with a private capability and actual `clock_gettime(CLOCK_MONOTONIC_RAW)`, descriptor/inode-pinned cgroup v2 observation, pre-execution start barriers, serial polling, independently bounded containment and Docker cleanup, and dynamic under/over-budget/failure tests. Only that dedicated lifecycle may return a signer-eligible wrapper after immutable-container evidence passes; never treat a synthetic wrapper or raw parser-valid fixture as signer authorization or live provenance.
- Related files/commits: `container-contract.json`, `README.md`, `START_HERE.md`, `SUBMISSION.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`, `docs/demo-runbook.md`, `PROGRESS.md`.
