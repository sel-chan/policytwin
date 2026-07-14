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
- Evidence: `src/codex/worker-rpc-contract.ts`, `src/codex/worker-rpc-client.ts`, `tests/unit/worker-rpc.test.mjs`, `Dockerfile`, `.dockerignore`, `container-contract.json`, `scripts/container-check.mjs`, and `scripts/container-verify.mjs`.
- Consequences: The host can validate a future signed external result and its exact manifest delta without being able to construct the SDK or execute live fixture commands. Static web-container checks can pass without a Docker daemon, while dynamic image/OPA/non-root/read-only-root/SQLite-restart/health evidence remains a separate required gate.
- Risks: No authenticated transport, supervisor, worker image, OpenAI egress proxy, immutable verification workspace, or real signed result exists yet. An in-process transport object can only declare its authentication mode; only the future implementation and integration evidence can prove peer authentication and receive-size enforcement before socket allocation. A signed test double proves only the host contract. The immutable Node base-image digest is still unset, and dynamic Docker verification has not run. Handled cleanup covers normal/error/SIGINT/SIGTERM paths, not forced termination such as SIGKILL.
- Reversal or migration path: A different worker runtime may replace the transport only if it preserves mutual authentication, single-use request binding, canonical bounded frames, trusted supervisor signatures, repair/verification separation, fixed egress, process-tree teardown, and host live-construction rejection.
- Related files/commits: `PROGRESS.md`, `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/limitations.md`.
