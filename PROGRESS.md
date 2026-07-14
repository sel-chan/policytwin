# PROGRESS.md — PolicyTwin Goal Ledger

> Codex must keep this file current. Update it at the beginning of a run, after every milestone checkpoint, before pausing, and before declaring completion. Never record a pass without command or artifact evidence.

## Current status

- Overall state: `IN_PROGRESS`
- Current milestone: `M7/M9 — external worker RPC and static container prerequisites`
- Goal state: `IN_PROGRESS`
- Submission state: `NOT_STARTED`
- Last updated: `2026-07-15 08:26:44 +09:00`
- Latest checkpoint commit: `24a524629424f2480c6793861c3bcc0ce99f660e`
- Working branch: `main`
- Live URL: `UNSET`
- Repository URL: `UNSET`
- Demo video URL: `UNSET`
- Submission confirmation: `UNSET`

Allowed overall states:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
ENGINEERING_COMPLETE
READY_FOR_OWNER_ACTION
SUBMITTED
```

## Verified environment

Fill with actual evidence.

| Item | Detected version/status | Evidence command | Notes |
|---|---|---|---|
| OS | Windows 10 Home 64-bit (reported build family 2009) | `Get-ComputerInfo` | PowerShell environment |
| Git | 2.49.0.windows.1; initialized on `main` | `git --version`; `git status --short --branch` | `F:/oaibuild` registered as a safe directory because the drive does not report ownership |
| Node.js | v22.22.2 | `node --version` | Supported LTS/newer baseline |
| pnpm | 11.7.0 | `pnpm --version` | Available globally |
| Docker | 29.1.5 CLI; daemon unavailable | `docker --version`; `docker info --format '{{.ServerVersion}}'` | Docker Desktop Linux engine pipe is absent |
| OPA | 1.18.2, Rego v1, windows/amd64 | `.tools/opa/1.18.2/opa.exe version`; SHA-256 verification | Official binary is repository-ignored; checksum `b9022224ee660c87cc35ce957c21c352fa57b267d71fb4e1ce779a38e107c9df` |
| Codex client | codex-cli 0.144.0 | `codex --version` |  |
| Goal mode | stable/enabled | `codex features list` | `goals stable true` |
| OpenAI API auth | UNSET | redacted environment-name check only | `OPENAI_API_KEY` and `CODEX_API_KEY` are not configured; never record secrets |
| Codex SDK feasibility | PARTIAL | `codex --version`; `pnpm list --depth 0` | Codex CLI 0.144.0 and project-pinned `@openai/codex-sdk` 0.144.3 are installed; live adapter/credentials remain unverified |
| Browser/Playwright | PASS_LOCAL | `pnpm test:e2e` | Playwright 1.61.1 drives installed Chrome against the production standalone server; 3/3 navigation, API, session isolation/capacity/expiry, reference mismatch, keyboard, and 390px responsive checks pass with seven inspected screenshots |
| GitHub auth | UNSET | redacted status only |  |
| Deployment auth | UNSET | redacted status only |  |
| Devpost access | PACKAGE_CACHED_NOT_CALLABLE | local plugin manifest; `codex plugin list`; current tool inventory | Devpost Hackathons 3.0.0 package and required app manifest exist in the curated remote cache, but it is absent from the CLI active-plugin list and exposes no callable Devpost tool in this task |

## Approved external network scope

- Approved by owner: `2026-07-14`
- Approved scope: direct verification of the three supplied OpenAI Build Week/Devpost URLs, current official OpenAI/Codex/OPA/Next.js documentation lookup, pinned pnpm package installation, and official OPA binary acquisition needed for the PolicyTwin goal
- Not inferred from this approval: Git push, public repository publication, deployment, media upload, challenge registration, terms acceptance, or final submission
- Supplied official URLs: `https://openai.com/build-week/`; `https://openai.devpost.com/`; `https://openai.devpost.com/rules`

## Challenge facts verified

Replace placeholders after checking current official sources.

- Official challenge URL: `https://openai.devpost.com/`
- Exact submission deadline and timezone: `2026-07-21 17:00 PDT (UTC-07:00)`
- Local deadline: `2026-07-22 09:00 KST (UTC+09:00)`
- Selected track/category: `Developer Tools`
- Team/eligibility status: `Republic of Korea and current API-supported-territory condition verified; age, conflicts, representative, and legal declarations remain owner-confirmed fields`
- Repository visibility requirement: `public with relevant licensing, or private and shared with testing@devpost.com and build-week-event@openai.com`
- Demo video constraints: `public YouTube, less than 3 minutes, clear audio, show the project and use of Codex/GPT-5.6, no unlicensed third-party marks/music/material`
- Required submission fields: `category; description; demo video; repository; README Codex collaboration narrative; /feedback session ID; developer-tool installation/platform/testing path; working access and testing instructions`
- Rules checked at: `2026-07-14 13:07:58 +09:00`
- Source links: `https://openai.com/build-week/`; `https://openai.devpost.com/`; `https://openai.devpost.com/rules`

## Baseline

- Repository condition: documentation-only Git repository initialized on `main` with an initial baseline commit
- Existing implementation: none; nine planning/control Markdown files only
- Existing tests: none; no `package.json`
- Existing build result: not runnable; no `package.json`
- Existing known failures: OPA command unavailable; product scaffold absent
- Baseline commit/tag: `38f8060cdb87c410f12e91d26b2d689ab1e07582`
- Secrets scan result: PASS for credential-shaped values in the initial document pack

## Milestone board

Use one of: `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`, `DEFERRED_P1`.

| Milestone | Status | Gate evidence | Commit | Remaining risk |
|---|---|---|---|---|
| M0 Preflight and baseline | PASS | official rules/current implementation facts verified; exact stack and frozen offline install pass; checksum-pinned OPA 1.18.2 executes 41 accepted cases; security and clean-copy replay pass | `1d7261d` | Docker daemon remains unavailable but is outside the M0 gate |
| M1 Domain core and seeded fixture | PASS | strict validation; 4 unit tests; 5 integration tests; fixture-local 4-test suite; deterministic reset and exactly 3 seeded drifts | `e509486` | Evaluation-only fixed fixture must remain outside future Codex repair context |
| M2 PolicyIR and interpretation | IN_PROGRESS | strict server-only Responses adapter, provider-compatible structured schema, exact request/source/golden validation, bounded cancellation/retry controls, and unit tests pass | pending | credentials and a fresh GPT-5.6 response/evidence remain; live provider acceptance is not claimed |
| M3 Decision Queue and versioning | PASS | anonymous-session-isolated SQLite v1-v5, closed replay-safe HTTP writes, one-card Decision Queue, revisit, golden contradiction, restart, expiry, and production Chrome checks pass | `16c06fc` | authenticated multi-user identity and distributed coordination remain M9 release work, not an M3 gate |
| M4 Compiler and OPA | PASS | official OPA 1.18.2 strict compile/evaluation, deterministic compiler, invalid-input rejection, 41/41 accepted cases, and compilation status UI pass | pending | none for the milestone gate; live package still depends on later milestones |
| M5 Case generation/conflict/mutation | PASS | 41 unique traceable cases, required boundaries/overlaps, 3 conflicts, 36 contrasts, 44/47 killed reference mutants (93.62%), and Case Lab UI pass | pending | mutation provenance remains explicitly reference-based rather than OPA |
| M6 Differential runner and drift UX | PASS | full 41-record report has 25 matches, 16 classified drifts, 0 errors, D01–D03 witnesses, evidence contract validation, and Integration/Drift UI | pending | actual post-Codex evidence remains M7 work |
| M7 Codex repair and review | IN_PROGRESS | pinned SDK-compatible phase adapter plus a single-run streamed RPC request/response/client contract; exact policy/image/corpus/baseline/final tree-manifest, nonce, signature, command, teardown, replay, and two-file delta checks pass with generated-key test doubles | `24a5246` | host live construction and live commands remain disabled; actual authentication-enforcing transport, external supervisor/worker image, credentials, fresh SDK repair, zero post-repair drift, live review, and signed evidence remain |
| M8 Proof, impact, and polish | IN_PROGRESS | reference-bound Proof UI, blocked 14-to-30 v5 draft, semantic mismatch guard, deterministic guarded 38-file USTAR download, responsive six-view navigation, seven inspected screenshots, and 3/3 production Chrome E2E checks pass | `5fecdde` | live signer/receipts, actual Codex proof, and architecture/Codex submission captures remain |
| M9 Security, reproducibility, deployment | IN_PROGRESS | checksum-pinned OPA/dependency foundation, session/CSRF/body limits, safe reset, static scan, clean-copy replay, digest-required split web Dockerfile, static container contract, and a prepared dynamic OPA/non-root/read-only-root/SQLite-restart verifier | `24a5246` | immutable Node base digest, running Docker daemon, actual dynamic web-container PASS, separate worker container, owner license, shared auth/quotas, provider selection, and deployment remain |
| M10 Submission package | IN_PROGRESS | official rules/dates/track/requirements verified and generated rules-check updated; draft remains fail-closed | `130c355` | owner declarations, license, UI/screenshots, live/repo/video URLs, form, and confirmation remain unavailable |

## Current checkpoint

### Objective

Define and verify the fail-closed external-worker RPC boundary for one complete Codex repair run, add the independently safe web-container prerequisites, and keep every host-process live SDK/command path disabled. This checkpoint is contract and static-container work only; it must not claim a live Codex call, a running container, or deployment.

### Starting failing condition

At checkpoint start, the host correctly rejected `createIsolatedWorkerCodexSdkBackend()` and live command execution, but had no RPC request/response schema, replay defense, trusted worker identity, signed result receipt, preallocation byte cap, teardown binding, or transport client. The web application had standalone output and a health route but no Dockerfile or `.dockerignore`; the Docker daemon was unavailable and the immutable Node base-image digest had not been verified within the approved network scope.

### Planned actions

- [x] Re-read the repository contract and current ledger, inspect the clean `main` worktree, and refresh the official Codex SDK/sandbox manual.
- [x] Complete independent read-only RPC, container, and adversarial security gap reviews.
- [x] Define a strict single-run RPC request/response and supervisor receipt with exact keys, bounded canonical JSON, nonce/request/result hashes, expiry, sequence, and Ed25519 verification.
- [x] Reject secrets, personal/absolute paths, arbitrary commands, unknown protocol fields, replayed/mismatched responses, untrusted keys, oversized frames, and incomplete isolation/teardown claims before any result reaches orchestration or evidence.
- [x] Provide a transport-injected host client contract that can validate an external worker result but cannot construct the SDK, run live fixture commands, or self-assert OS isolation in the host process.
- [x] Add unit and integration coverage for valid signed test-double receipts, streamed receive limits, exact baseline/final tree-manifest deltas, and security-negative cases while retaining host-live rejection tests.
- [x] Add `.dockerignore`, a digest-required web Dockerfile contract, static container validation, and separate daemon-backed verification without representing the future Codex worker as part of the web image.
- [x] Correct architecture/threat/limitations/runbook truth boundaries, record D-028, and regenerate truthful submission drafts.
- [x] Run focused tests, lint, typecheck, full offline verification, dynamic fail-closed probes, and independent final reviews; commit remains the final checkpoint action.

### Completion evidence

- Starting HEAD: `6213f1c`; clean `main` worktree.
- Starting local gate: lint, strict typecheck, 80/80 unit, 31/31 integration, 21/21 eval, 3/3 production Chrome E2E, security, clean-copy replay, and production build pass from the prior checkpoint.
- Current expected failures: owner-selected project license, immutable base-image digest/dynamic container verification, 30-item non-final submission gate, and the separate fresh live gate.
- Official source refresh: current Codex manual confirms server-side SDK use, per-thread sandbox modes, disabled network controls, dedicated `CODEX_HOME`, and that sandbox enforcement applies to spawned commands; these SDK controls supplement but do not prove the required external OS boundary.
- RPC result: declared-length asynchronous raw frames are rejected before body access above 4 MiB; 64 KiB/chunk and 1,024-chunk limits, exact UTF-8/JSON, request/nonce/expiry/replay/signature, fixed command/corpus, cleanup, and host-known path/kind/mode/mtime/file-hash baseline/final manifest checks are covered by 24 focused assertions within the 105-test unit suite.
- Container result: `.dockerignore`, a two-stage standalone web Dockerfile, daemon-free static validation, and a daemon-backed verifier exist. The dynamic verifier rejects mutable image references, prepares volume ownership, requires non-root/read-only-root/resource/OPA/health controls, verifies a real API SQLite mutation across restart, and fails if tracked resource cleanup fails. `container:check` is `PASS`; `container:verify` is truthfully `FAIL` before build because `nodeBaseImage` is unset.
- Full verification: lint, typecheck, 105/105 unit, 31/31 integration, 22/22 eval, 3/3 Chrome E2E, 281-file clean-copy replay, 256-text-file plus Git-history security scan, demo reset/run, static container contract, and production build pass. `pnpm verify` fails only `license:check` and the 30-item `submission:check`.
- Live verification: `pnpm verify:live` fails closed for missing host `OPENAI_API_KEY` and `CODEX_MODEL`; no authentication-enforcing transport, supervisor/worker, live SDK turn, or live evidence promotion exists.
- Independent final reviews: RPC, container, and cross-document reviewers found no remaining P0/P1 after streamed receive limits, tree-manifest mtime binding, mutable image rejection, actual SQLite restart verification, and cleanup-failure propagation were corrected.

## Quality gates

Record latest actual result.

| Gate | Status | Command | Evidence/artifact | Last run |
|---|---|---|---|---|
| Document contract validation | PASS | PowerShell manifest/hash/fence/milestone validator | 10 manifest entries and 11 root Markdown files | 2026-07-14 11:50 +09:00 |
| Install/lockfile | PASS | `pnpm install --offline --frozen-lockfile` | exact 469-entry lock graph passes supply-chain policy | 2026-07-14 15:16 +09:00 |
| Lint | PASS | `pnpm lint` via `pnpm verify` | static checks include `.tsx`, CSS, RPC, and container scripts while excluding generated Next output | 2026-07-15 08:14 +09:00 |
| Typecheck | PASS | `pnpm typecheck` via `pnpm verify` | strict TypeScript 6.0.3 across NodeNext core and Next.js web boundary | 2026-07-15 08:14 +09:00 |
| Unit tests | PASS | `pnpm test` via `pnpm verify` | 105/105 assertions passed, including streamed RPC frames, signature/replay/teardown, exact tree-manifest delta/mtime/content binding, static container contract, SDK phase isolation, and host-live rejection | 2026-07-15 08:18 +09:00 |
| Integration tests | PASS | `pnpm test:integration` via `pnpm verify` | 31/31 passed, including real OPA 1.18.2, exact corpus, canonical diff/fixture receipt binding, semantic forgeries, live attestation, deterministic USTAR, trusted commands, and safe reset | 2026-07-15 08:14 +09:00 |
| Browser tests | PASS | `pnpm test:e2e` via `pnpm verify` | 3/3 production standalone Chrome tests; native archive download, identical bytes, all 38 individual artifacts, six views, v1-v5 writes, isolation/capacity/expiry, focus, and 390px cards | 2026-07-15 08:14 +09:00 |
| Prompt/eval suite | PASS | `pnpm eval` via `pnpm verify` | 22/22 offline/recorded evals pass, including the external-worker precondition boundary; live model/Codex work remains unverified | 2026-07-15 08:14 +09:00 |
| Production build | PASS | `pnpm build` via `pnpm verify` | Next.js 16 Turbopack standalone build includes the dynamic archive and workspace routes | 2026-07-15 08:14 +09:00 |
| Offline full verification | FAIL | `pnpm verify` | all implemented code/static gates pass; exact expected failures are owner-selected project LICENSE and the 30-item non-final submission gate | 2026-07-15 08:14 +09:00 |
| Fresh live integration | FAIL | `pnpm verify:live` | fail-closed at missing host `OPENAI_API_KEY` and `CODEX_MODEL`; authentication-enforcing transport, supervisor/worker, worker credential, and fresh evidence are also not implemented | 2026-07-15 08:14 +09:00 |
| Clean-copy reproduction | PASS | `pnpm clean:check` via `pnpm verify` | 281 source files; frozen offline install and all 11 command groups including production Chrome E2E pass | 2026-07-15 08:14 +09:00 |
| Static container contract | PASS | `pnpm container:check` via `pnpm verify` | `artifacts/security/container-static-report.json`: `STATIC_WEB_CONTAINER/PASS`, no worker, no base digest, no dynamic/release claim | 2026-07-15 08:14 +09:00 |
| Dynamic container health | FAIL | `pnpm container:verify` | `artifacts/security/container-report.json`: `DYNAMIC_WEB_CONTAINER/FAIL`; immutable Node digest is unset, so Docker build/runtime/SQLite restart checks did not run | 2026-07-15 08:06 +09:00 |
| Secret scan | PASS | credential-shaped `rg` scan | no matches | 2026-07-14 08:20 +09:00 |
| Dependency/license review | FAIL | `pnpm license:check`; prior `pnpm audit --prod --json` | 6 production dependencies inventoried, audit 0 vulnerabilities, NOTICE present; owner-selected project LICENSE absent | 2026-07-15 08:14 +09:00 |
| Security review | PASS | `pnpm security:check` via `pnpm verify` | 256 text files plus Git history; RPC/container/consistency final reviews report no remaining P0/P1; live release review remains required | 2026-07-15 08:14 +09:00 |
| Submission consistency | FAIL | `pnpm submission:check` via `pnpm verify` | exactly 30 unmet requirements: partial proof, dynamic container/license, two required captures, media/HTTPS URLs, drafts, and confirmation | 2026-07-15 08:14 +09:00 |

## Product proof metrics

Never fill from estimates.

| Metric | Target | Current actual | Evidence |
|---|---:|---:|---|
| Structured-output schema pass | 100% | 100% offline adapter contract; live provider result UNSET | `tests/unit/openai-interpreter.test.mjs` |
| Required ambiguity labels found | 100% | 3/3 recorded candidate ambiguities | `fixtures/interpreter/recorded-policy-ir.v1.json` |
| Explicit seeded semantics mislabeled as ambiguity | 0 | UNSET |  |
| Golden cases passed | 100% | 6/6 (OPA CLI 1.18.2) | `artifacts/evidence/verification-summary.json` |
| Accepted corpus size | ≥30 | 41 (offline reference corpus including D01–D03) | `tests/snapshots/offline-m5-summary.json` |
| Seeded app bugs detected | 3/3 | 3/3 | `pnpm demo:run`; `tests/integration/refund-fixture.integration.test.mjs` |
| Post-repair drift | 0 | 0 (evaluation-only fixed fixture; no Codex/OPA claim) | `tests/snapshots/offline-m6-summary.json` |
| Mutation kill rate | ≥90% | 93.62% (reference mutation execution; accepted cases separately agree with OPA) | `tests/snapshots/offline-m5-summary.json` |
| Rule-to-clause traceability | 100% | 4/4 rules and 4/4 clauses (offline) | `artifacts/evidence/traceability.json` |
| Rule-to-case traceability | 100% | 41/41 accepted case links valid (offline) | `artifacts/evidence/traceability.json` |
| Critical/high security findings | 0 | 0 static/offline; release review pending | `artifacts/security/security-report.json` |
| Browser happy path | 100% | 3/3 local production-server Chrome tests | `tests/e2e/workspace.spec.ts`, `artifacts/screenshots/` |

## Checkpoint log

### 2026-07-15 08:14 +09:00 — External worker RPC and static web-container boundaries verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint completes the host RPC client contract and static web-container prerequisites, not the external worker, live Codex run, dynamic container, or deployment
- RPC change: added one complete-run canonical request/response protocol, declared-length asynchronous receive contract, 4 MiB/64 KiB/1,024-chunk limits, single-use request/nonce/expiry/replay checks, trusted Ed25519 supervisor receipts, exact worker/policy/corpus bindings, cleanup proof, and host-known baseline versus signed final path/kind/mode/mtime/file-hash manifest comparison that permits only `src/refund.ts` and `tests/refund.test.mjs`
- Container change: added `.dockerignore`, split standalone web Dockerfile with no worker/credentials or mutable base fallback, daemon-free static validation, and a dynamic verifier prepared to check immutable build input, OPA digest, loopback health, non-root/read-only/resource limits, named-volume ownership, an actual API SQLite mutation across restart, and cleanup failures
- Truth boundary: `authenticationMode` is only an interface precondition; no mTLS/socket-ACL transport, external supervisor/worker image, SDK turn, worker credential, or live response exists. `container:check` passes only `STATIC_WEB_CONTAINER`; `container:verify` remains `DYNAMIC_WEB_CONTAINER/FAIL` because the immutable Node image digest is unset and therefore does not reach the unavailable daemon.
- Verified: lint; strict typecheck; 105/105 unit assertions; 31/31 integration; 22/22 eval; 3/3 production Chrome E2E; 281-file clean-copy replay; 256-text-file plus Git-history security scan; demo reset/run; static container contract; production build; generated fail-closed submission drafts
- Independent review: RPC, container, and consistency reviews found no remaining P0/P1 after receive preallocation/chunk controls, exact manifest/mtime delta binding, mutable Docker build-argument rejection, SQLite API restart verification, signal cleanup, and cleanup-failure propagation were corrected
- Full gate: `pnpm verify` passes every implemented code/static gate and fails only owner-selected `LICENSE` plus the exact 30-item non-final `submission:check`; `pnpm verify:live` fails closed at missing `OPENAI_API_KEY` and `CODEX_MODEL`
- Evidence: `artifacts/security/container-static-report.json` is static `PASS`; `artifacts/security/container-report.json` is dynamic `FAIL`; evidence hash remains `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`)
- Commit: `24a524629424f2480c6793861c3bcc0ce99f660e`
- Next: implement the authentication-enforcing transport and external supervisor/worker runtime without enabling host live execution; verify an immutable Node base-image digest only within an explicitly approved registry scope

### 2026-07-15 02:21 +09:00 — Fail-closed Codex SDK-compatible adapter contract verified offline

- Milestone: M7 remains `IN_PROGRESS`; the offline adapter and evidence contract are complete, while live execution is intentionally blocked pending a real external OS-sandbox worker RPC
- Change: added strict model-only phase schemas; separate cartography/repair/review streams; server-owned SDK metadata; exact two-file and D01-D03 digest enforcement; exact 41-case corpus execution receipt; command/tree/PolicyIR/run bindings; canonical before/after receipt-bound diff; all-phase workspace poisoning; unknown SDK lifecycle rejection; sensitive prompt, fixture, command, DSN/URI, diff, and archive guards; and unconditional host live-factory rejection
- Verified: lint; strict typecheck; 80/80 unit; 31/31 integration; 21/21 eval; 3/3 production Chrome E2E; 273-file clean-copy replay; 248-text-file plus Git-history security scan; production build; deterministic evidence and submission draft generation
- Independent review: final M7 contract and adversarial security reviews found no remaining P0/P1 after the host factory, all-phase poison, lifecycle allowlist, credential URI, canonical diff, and fixed corpus corrections
- Recovered failures: parallel unit/integration builds contended on Windows `dist` and produced `EPERM`; serial reruns passed. The first review-poison test exposed a missing `await` around the read-only Promise; the catch boundary was corrected and the regression now passes. Prettier is not installed, so the attempted optional formatter command failed; canonical lint passes.
- Full gate: `pnpm verify` passes every local engineering check and fails only `license:check`, `container:check`, and `submission:check`; `pnpm verify:live` separately fails closed for missing credentials/model, external worker, and fresh evidence
- Evidence hash: `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1`
- Expected release gaps: owner-selected LICENSE; Dockerfile/running daemon; external Codex worker; fresh GPT-5.6/Codex calls; signed live proof; two remaining captures; public URLs/video; submission confirmation
- Commit: `5b1006f9b76362e919beb96096988ebac0b7d9f9`
- Next: implement independently safe container prerequisites and the external-worker RPC design without enabling host live execution

### 2026-07-14 22:34 +09:00 — Deterministic complete evidence archive verified

- Milestone: M8 advances with the required downloadable archive; it remains in progress only for fresh live proof, signing, and final submission captures
- Change: added a dependency-free fixed-metadata USTAR builder, exact 38-file download allowlist, bounded regular-file UTF-8 reader, common semantic/sensitive-content validation, complete individual evidence API, native Proof download action, and truthful generated submission copy
- Security boundary: 4 MiB per file and 16 MiB aggregate limits apply before parsing; symlinks/non-files, invalid UTF-8, missing/extra/tampered payloads, credential/private-key/bearer/OpenAI-token content, absolute/personal/file-URI paths, and untrusted or invalid live attestations fail closed; one archive build runs per process at a time
- Recovered review findings: replaced a quadratic secret regex, closed the individual-download bypass, bounded disk allocation, covered camel/general credential keys and CR/LF values, expanded Windows/UNC/POSIX path detection without rejecting HTTPS, and verified a real browser download plus all 38 individual routes
- Verified: lint; strict typecheck; 63 unit; 25 integration; 21 eval; 3 production Chrome E2E; production build; 269-file clean-copy replay; 269-file/244-text-file security scan; direct Proof screenshot inspection; independent final review reports no P0/P1
- Full gate: `pnpm verify` fails only `license:check`, `container:check`, and `submission:check`; the submission checker reports 30 truthful unmet requirements
- Evidence hash: `99f8da5a9c28356d0b6eef4a92e0ae5f8460de14a9f35a80197a98f1c3f588b9`
- Commit: `5fecdded3f2bcec43c2fe6cf20bf93afdaccba10`
- Residual: repeated public downloads need short metadata-keyed caching or shared rate limiting before deployment; the current package is approximately 227 KiB and remains bounded/fail-closed
- Next: implement the offline-safe server-side Codex SDK adapter, then return to static container prerequisites once a verified base-image digest is within approved network scope

### 2026-07-14 21:08 +09:00 — Persisted Decision Queue and reference-bound Change Impact verified

- Milestones: M3 gate passes; M8 and M9 advance with a complete local v1-v5 reference flow but remain incomplete for archive/live/container/deployment work
- Change: added anonymous-session-isolated SQLite workspaces, replay-safe versioned decision/source routes, a one-card Decision Queue with revisit and focus management, a blocked 14-to-30 v5 draft, a sixth Change Impact view, and reference-policy meaning binding in Proof/Impact
- Security boundary: exact configured production origin/HTTPS, same-origin session creation, HttpOnly SameSite session/CSRF cookies, ten-second streamed body limit, 24-hour expiry enforced on GET and POST, 128-project cap, transactional cleanup, and fail-closed custom reset
- Recovered review findings: non-blocking stream cancellation, newest-first self-referencing SQLite deletion, bounded anonymous storage, production captures without a dev overlay, alternate-v4 proof mismatch blocking, and expired-token POST rejection
- Verified: lint; strict typecheck; 63 unit; 22 integration; 21 eval; 3 production Chrome E2E; production build; deterministic evidence hash; 264-file clean-copy replay; 264-file/239-text-file security scan
- Full gate: `pnpm verify` fails only `license:check`, `container:check`, and `submission:check`; the submission checker reports 30 truthful unmet requirements
- Evidence hash: `99f8da5a9c28356d0b6eef4a92e0ae5f8460de14a9f35a80197a98f1c3f588b9`
- Commit: `16c06fc28f7948c3aa3d9748873b77ed3dbf81f6`
- Next: implement the remaining offline-safe Codex SDK adapter/container/archive prerequisites before requesting owner-only credentials, license acceptance, deployment, and submission actions

### 2026-07-14 19:13 +09:00 — Five-view workspace and authenticated evidence boundary verified

- Milestones: M4, M5, and M6 gates pass; M2, M3, and M8 advance but remain incomplete pending live/write/impact flows
- Change: added a strict GPT-5.6 Responses adapter contract and protected route; complete drift-report validation; five evidence-backed Next.js views and APIs; manifest-verified downloads; explicit error/loading/not-found states; Chrome E2E; six screenshots; responsive navigation; social preview; structured external proof receipts; semantic evidence recomputation; and a trusted Ed25519 live-attestation boundary
- Security boundary: live interpretation requires a server token, 128 KB body limit, one active run, 60-second cancellation, no SDK retries, two bounded schema attempts, generic external errors, exact request/source identity, and golden-case agreement
- Recovered failures: clean-copy replay found incremental fixture compilation could report success after deleting emitted JavaScript; fixture builds are now non-incremental and assert both outputs exist. Adversarial review then proved a self-rehashed package could forge live PASS; the exact attack and semantic variants are now regression tests and fail closed.
- Verified: lint; strict typecheck; 56 unit; 21 integration; 21 eval; 2 Chrome E2E; production build; deterministic evidence generation; 247-file clean-copy replay; 247-file/228-text-file static security scan
- Independent review: no unresolved P0/P1 remained after moving the one-run reservation before body reads, enforcing streamed byte limits, and regenerating all hash-bound artifacts.
- Full gate: `pnpm verify` fails only `license:check`, `container:check`, and `submission:check`, each for an explicit owner/external/incomplete condition
- Evidence hash: `99f8da5a9c28356d0b6eef4a92e0ae5f8460de14a9f35a80197a98f1c3f588b9`
- Commit: `eae20ed5d92358361c449764ade91c74d7f2d4ba`
- Next: checkpoint the verified changes, then implement remaining independent M3/M8 write and impact surfaces before requesting owner-only live/license/deployment actions

### 2026-07-14 15:47 +09:00 — M0 official preflight and real OPA gate verified

- Milestone: M0 PASS; M4 engine gate PASS while UI portion remains in progress
- Change: verified official challenge rules and Developer Tools track; confirmed cached Devpost package is not callable; installed exact Next/OpenAI/Codex/Zod/Playwright stack; added checksum-pinned OPA 1.18.2 installer/runner/evidence; refreshed submission, license, container, and security truth boundaries
- Verified: frozen offline install; production audit 0 vulnerabilities after PostCSS 8.5.19 override; lint; TypeScript; 49 unit; 17 integration including 41 OPA cases; 21 eval; build; 200-file clean-copy replay; 200-file/198-text-file security scan; D01–D03 replay
- Full gate: `pnpm verify` fails only `license:check`, `container:check`, `submission:check`, and `test:e2e`, each for an explicit incomplete/owner/external condition
- Evidence hash: `2dc9b83479eae24d6086dd76c46bd1d07b4ceb64d2e82b229b6b7fbd4692a111`
- Commit: `1d7261d0f41201e8501558d8b59368605d258db1`
- Next: review and commit this checkpoint, then implement the server-side GPT-5.6 adapter and five-screen Next.js workspace without claiming live model evidence until credentials exist

Append newest entries at the top. Keep entries compact and evidence-oriented.

### 2026-07-14 12:38 +09:00 — M3 persisted workspace service verified

- Milestone: M3 (offline server-service subset; milestone remains in progress)
- Change: added a repository port and framework-independent service for complete current-workspace reads, immutable policy-text `DRAFT` versions, and atomic ambiguity resolution
- Verified: unit 49/49 and integration 15/15; new text preserves authoritative golden cases and prior source; repeated choices are idempotent; stale expected versions and contradictory default-review choices do not create versions; three service-driven decisions survive SQLite close/reopen
- Commands: `pnpm typecheck`; `pnpm test`; `pnpm test:integration`; `pnpm verify`
- Artifacts: `src/workspace/service.ts`, `tests/unit/policy-workspace-service.test.mjs`, updated `tests/integration/policy-persistence.integration.test.mjs`
- Commit: `85259ea1e70449c1307b382e3f2541fb7e8c2327`
- Risks: no HTTP route or Decision Queue UI exists; those require the approved pinned Next.js application stack
- Next: run the complete offline gate, review and commit, then re-audit remaining offline P0 work

### 2026-07-14 12:14 +09:00 — M3 offline SQLite persistence foundation verified

- Milestone: M3 (offline persistence subset; milestone remains in progress)
- Change: added strict golden-case parsing and a transactional SQLite repository for projects, immutable versions, validated IR, lifecycle state, and ambiguity decision records
- Verified: unit 46/46 and integration 15/15; four versions, three reproducible decisions, policy text, golden cases, and `COMPILED` state survive a close/reopen; stale parents, silent resolutions, unrelated decision edits, invalid clause/source links, and corrupted JSON fail closed
- Recovered failures: first Windows test cleanup attempted to delete an open SQLite file and was fixed by closing before recursive cleanup; a later full run found `submission:draft` removed its tracked checker report before security scanning, so draft generation now writes an accurate `NOT_RUN` report and the scanner reports missing tracked files instead of crashing
- Truth boundary: local Node 22 `node:sqlite` is experimental; production runtime/volume behavior and web/API integration remain unverified
- Commands: local `node:sqlite` probe; `pnpm typecheck`; `pnpm test`; `pnpm test:integration`; `pnpm submission:draft`; `pnpm security:check`; `pnpm submission:check`; `pnpm verify`
- Artifacts: `src/persistence/sqlite.ts`, `src/domain/case-validation.ts`, persistence unit/integration tests
- Commit: `9e293e00e06e71adcf2789e89b330af848150825`
- Next: run the complete offline gate, review and commit this checkpoint, then continue approved external integration work

### 2026-07-14 11:48 +09:00 — M10 offline submission foundation verified

- Milestone: M10 (offline subset; milestone remains in progress)
- Change: added evidence-derived English submission/demo drafts, machine-readable readiness state, strict fail-closed submission validation, unit/eval coverage, and a Git-history scanner self-pattern exclusion
- Verified: 21 submission and 4 demo files generated with mandatory non-final markers; checker reports exactly 37 independent unmet requirements; unit 43/43, integration 14/14, eval 21/21, security 188/188 files and 186 text files with zero findings, clean-copy replay 188 files, build, and three-drift demo all pass
- Commands: `pnpm submission:draft`; `pnpm submission:check`; `pnpm security:check`; `pnpm verify`
- Artifacts: `artifacts/submission/`, `artifacts/demo/`, `artifacts/security/security-report.json`, `artifacts/security/clean-checkout-report.json`
- Commit: `130c3553abdd1ad668d8c367c0f819d242962029`
- Risks: M10 remains incomplete until current official rules, live proof, owner-selected license, UI screenshots, video, HTTPS URLs, form data, and confirmation exist
- Next: commit this offline checkpoint, then obtain one scoped network approval for current official documentation and pinned dependency/OPA work

### 2026-07-14 11:33 +09:00 — M9 offline security and reproducibility foundation committed

- Milestone: M9 (offline subset; milestone remains in progress)
- Change: added architecture/threat/limitations/runbook/license-review docs, NOTICE, current+history secret/path/unsafe-process scan, fail-closed license/container checks, container prerequisites, and isolated clean-copy reproduction
- Verified: security scan PASS across 158 files, 156 text files, and full Git history with zero findings; clean copy PASS across frozen offline install, lint, typecheck, 41 unit, 14 integration, 19 eval, build, reset, drift replay, and evidence regeneration; no credential variables forwarded
- Expected failures: project LICENSE requires owner acceptance; container lacks verified OPA, Dockerfile, health route, and running daemon; browser and submission remain absent
- Recovered failures: history patch scanning falsely joined empty `.env.example` values and was replaced by commit-tree scanning; clean-copy eval self-reference was made explicit as `IN_PROGRESS` until the outer run writes PASS
- Full gate: `pnpm verify` fails exactly `license:check`, `container:check`, `test:e2e`, and `submission:check`
- Commit: `9602a6c38c5707de8e4aafc32a9e0ea636fa2416`

### 2026-07-14 11:06 +09:00 — M8 offline impact and evidence foundation committed

- Milestone: M8 (offline subset; milestone remains in progress)
- Change: made numeric case boundaries derive from PolicyIR; corrected stale golden/drift clause links; added immutable 14→30 version impact, traceability diagnostics, deterministic evidence generation, SHA-256 manifest validation, strict verification summary, and tamper/false-PASS tests
- Verified: unit 41/41; integration 14/14; eval 16/16; 8 case expectations change under 14→30; G02 blocks automatic verification; 4/4 clauses, 4/4 rules, 41/41 cases, and 6 code locations linked; 25 evidence files regenerate to hash `05e6f75a03fafa655f97c491983d3044e214f8a30c56fa31099762c095eee655`
- Recovered failure: first parallel integration run deleted the shared fixture build during evidence generation; classified as code concurrency; isolated evidence compilation under `.tmp/evidence-fixture-build`; retry passed 14/14
- Truth boundary: verification summary remains `FAIL`; OPA, live GPT-5.6, live Codex, post-repair drift, security, browser, container, and deployment are `NOT_RUN`
- Commit: `efff64154be5645fed1a15bf564bdb849a608cf6`

### 2026-07-14 10:42 +09:00 — M7 offline repair-worker foundation committed

- Milestone: M7 (offline contracts only; milestone remains in progress)
- Change: added strict worker inputs/results, mode-tagged injected backend, fresh trusted-copy lifecycle, canonical hash guard, closed command IDs, sanitized child environment, time/output limits, bounded retry, independent review rules, three prompts, schema, and snapshot
- Verified: unit 37/37; integration 12/12; eval 14/14; real fresh-copy fixture test command passes; canonical baseline remains unchanged; full offline gate fails only browser/submission
- Safety evidence: traversal/absolute paths and unknown commands are rejected; `OPENAI_API_KEY`/`CODEX_API_KEY` are absent from child environments; output secrets and personal home paths are redacted; high/critical review blocks proof
- Truth boundary: snapshot execution mode is `OFFLINE_TEST_DOUBLE` with `liveCodexClaim: false`; no SDK call, Codex patch, or live review is claimed
- Commit: `0c6fb85f392243a578eea0452b8de4ff50e58910`

### 2026-07-14 10:06 +09:00 — M6 offline differential runner committed

- Milestone: M6 (offline subset; milestone remains in progress)
- Change: preserved D01–D03 in the 41-case corpus; added typed differential records, per-case error isolation, deterministic defect clustering, strict schema, report CLI, integration/eval coverage, and before/after snapshot
- Verified: unit 32/32; integration 9/9; eval 11/11; baseline 25 matches, 16 drifts, 0 errors; fixed reference 41 matches, 0 drifts, 0 errors; full offline gate fails only browser/submission
- Diagnostic correction: the first run exposed five previously unclassified promotional approvals outside basic eligibility; these are now truthfully reported as `PROMOTION_ELIGIBILITY_BYPASS`
- Expected gap: execution mode is `REFERENCE_EXPECTATION_NOT_OPA`; no Codex repair claim or web drift UX exists
- Commit: `866bb205455945e0ee14afc8f776c1f5efe5b782`

### 2026-07-14 09:49 +09:00 — M5 offline case/conflict/mutation engines committed

- Milestone: M5 (offline subset; milestone remains in progress)
- Change: added 38-case deterministic corpus, conflict/minimal-contrast analysis, 10 mutation operators, actual reference execution, strict schemas, and reviewable score snapshot
- Verified: unit 32/32; eval 9/9; 3 conflicts; 35 one-field contrasts; all rules reached; 44/47 mutants killed (93.62%); all 3 survivors listed; full offline gate fails only browser/submission
- Commands: lint, typecheck, unit, eval, M5 report, fail-closed full verification, manifest/diff/secret checks
- Commit: `66431fc9b8dabb93438fd8ab8d51336c0169eb87`
- Expected gap: execution mode is `REFERENCE_EVALUATOR_NOT_OPA`; Case Lab and OPA evidence are not implemented
- Next: include D01–D03 in the canonical corpus and build before/after fixture differential reports

### 2026-07-14 09:36 +09:00 — M4 deterministic Rego compiler committed

- Milestone: M4 (offline subset; milestone remains in progress)
- Change: added pure Rego v1 generation, strict Rego input guard, exhaustive predicate helpers, priority exclusions, default fallback, compiler line mappings, snapshots, and compile CLI
- Verified: unit 25/25; 3,008-byte source and manifest are byte-stable; every predicate type covered; unresolved/invalid IR rejected; full offline gate fails only browser/submission
- Commands: lint, typecheck, unit, build, compile/manifest output, fail-closed full verification, manifest/diff/secret checks
- Commit: `27a2b924d44bd900c28cb393e58e5413bb857445`
- Expected gap: no OPA binary is installed, so Rego compile and evaluation remain unverified
- Next: deterministic case/conflict/mutation engines using the clearly labeled reference evaluator

### 2026-07-14 09:26 +09:00 — M3 offline versioned ambiguity resolution committed

- Milestone: M3 (offline subset; milestone remains in progress)
- Change: added immutable closed-patch application, versioned decision records, idempotent/revisit semantics, golden contradiction blocking, compile guard, and lifecycle transition table
- Verified: unit 20/20; all six patch operations covered; seeded decisions advance v1 to v4 without mutating the original; default-review conflicts with G02; full offline gate fails only browser/submission
- Commands: lint, typecheck, unit, fail-closed full verification, manifest/diff/secret checks
- Commit: `506a8187bf5fd419122d8d5fdde54c7d77ab728f`
- Expected gap: SQLite persistence, server restart evidence, and Decision Queue UI remain for the pinned app stack
- Next: implement the pure deterministic Rego compiler and snapshots offline

### 2026-07-14 09:17 +09:00 — M2 offline PolicyIR and interpretation contracts committed

- Milestone: M2 (offline subset; milestone remains in progress)
- Change: added exhaustive IR/patch types, strict semantic validation, fixed refund input schema, deterministic clause segmentation, diagnostic evaluator, strict JSON Schemas, interpreter prompt, recorded fixture, and eight-case eval corpus
- Verified: unit 11/11; eval 7/7; integration 5/5; all nine golden/drift examples agree with the diagnostic reference; unknown fields, executable predicates, dangling clauses, duplicate priorities, patch mismatch, and unsupported input fields are rejected
- Commands: lint, typecheck, unit, eval, integration, demo replay, build, fail-closed full verification, manifest/diff/secret checks
- Commit: `e535209fb2f3f4bac00c0fe95bcfdd27c1296549`
- Expected gap: no claim of live GPT-5.6 work; recorded metadata is explicit; Zod/OpenAI dependencies and official API verification remain approval-gated
- Next: implement M3 patch/version/state logic offline

### 2026-07-14 08:59 +09:00 — M1 domain and deterministic seeded fixture passed

- Milestone: M1
- Change: added strict refund input validation, six golden cases, three drift witnesses, canonical buggy and evaluation-only fixed TypeScript fixtures, safe reset/copy hashing, fixture-local tests, and demo replay
- Verified: root unit 4/4; integration 5/5; fixture-local 4/4 in canonical and reset copies; typecheck, lint, eval, and build pass; `demo:run` reports exactly D01/D02/D03 drift; canonical baseline remains unchanged
- Commands: `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm test:integration`; fixture-local `npm test`; `pnpm demo:reset`; `pnpm demo:run`; `pnpm eval`; `pnpm build`; `pnpm verify`; manifest/diff/secret checks
- Commit: `e509486d525c1f3a5825d39469298b70acb5025f`
- Expected failure: offline full verification still fails only browser and submission gates
- Risk: future Codex repair context must include only a fresh baseline copy and never the `expected-fixed` directory
- Next: M2 offline PolicyIR/schema/segmentation/prompt contracts; live interpretation remains network-approval gated

### 2026-07-14 08:45 +09:00 — Fail-closed M0 scaffold committed

- Milestone: M0
- Change: added a dependency-free pnpm workspace, strict TypeScript build, required root script surface, unit/integration/eval tests, README, and safe environment template
- Verified: offline install, lint, typecheck, unit, integration, M0 eval, build, manifest hashes, staged diff, and secret-pattern scan
- Commands: `pnpm install --offline`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm test:integration`; `pnpm eval`; `pnpm build`; fail-closed gate commands; `git diff --cached --check`
- Commit: `c175d1c9e667dc98f258e36de11522479bc49ec0`
- Expected failures: `pnpm verify` fails only browser/submission gates; `pnpm verify:live` fails credentials/live integration; dev/demo commands fail because their later milestones are absent
- Risks: TypeScript is currently global rather than project-pinned; OPA and browser dependencies are absent; Docker daemon is stopped; official challenge and OpenAI/Codex facts remain unverified without approved network scope
- Next: continue independent M1 domain/fixture work, then use one approved network scope for official documentation and pinned dependency installation

### 2026-07-14 08:23 +09:00 — Preflight document-contract cleanup completed

- Milestone: M0
- Change: resolved all five document-contract defects; added Git safety/line-ending files; initialized `main`
- Verified: required control files read; stale contradiction phrases absent; `PolicyPatch` closed union present; offline/live gates separated; mutation threshold strict; current-branch/network boundary aligned; manifest/fences/M0–M10/goal length pass; staged diff clean; no credential-shaped values found
- Commands: environment/version commands; targeted `rg`; PowerShell manifest validator; `git diff --cached --check`; credential-shaped value scan
- Artifacts: updated control documents, `.gitignore`, `.gitattributes`, `PACK_MANIFEST.md`
- Commit: `38f8060cdb87c410f12e91d26b2d689ab1e07582`
- Risks: OPA is not installed; no `package.json` exists, so product lint/test/build/verify commands are not yet runnable; official online facts remain unverified because this checkpoint performs no network access
- Next: begin the remaining M0 product scaffold; request scoped network approval only when an install or official-document check is ready to run

## Active blockers

A blocker is valid only when the task cannot continue safely without external input. Continue all independent work first.

| ID | Type | Exact blocker | Work already completed | One owner action | Resume condition |
|---|---|---|---|---|---|
| B-000 | None | No active blocker for the current offline checkpoint | All approved independent work continues | None | Continue the checkpoint |

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner/status |
|---|---|---|---|---|
| Deadline compression | Medium | High | Preserve P0 vertical slice; cut only P1 | Codex / open |
| Live model/API outage | Medium | Medium | Keep recorded verified evidence clearly labeled | Codex / open |
| Hosted worker restrictions | Medium | High | Keep host live construction disabled; implement a fixture-only external worker RPC with hard process limits and teardown receipts | Codex / open |
| Codex SDK/live adapter mismatch | Medium | High | Current package/docs are pinned; validate the real adapter with fresh SDK evidence | Codex / open |
| Live attestation key custody | Medium | High | Keep private key outside Git/logs/evidence; inject only trusted public keys into verification | Codex / open |
| Repeated evidence-download pressure | Low locally / Medium when public | Medium | Exact 4 MiB/16 MiB bounds and one active archive build exist; add short metadata-keyed caching or shared rate limiting before public deployment | Codex / M9 open |
| Docker daemon unavailable | High | Medium | Continue non-container gates; start Docker Desktop before the container gate | Owner/Codex / open |
| Offline validator/Zod duplication | Medium | Medium | Cross-check both contracts and generate JSON Schema from the pinned runtime schema after network approval | Codex / open |
| Demo recording/account blocker | Medium | Medium | Prepare script, captions, screenshots, and exact owner action | Codex / open |

## Decisions pending

Link to IDs in `DECISIONS.md`.

- Project license selection requires owner acceptance; see D-013 and `docs/license-review.md`.

## Next action

`Implement the authentication-enforcing transport and external supervisor/worker runtime without enabling host live execution; separately verify the immutable Node base-image digest within an explicitly approved registry scope.`

## Pause handoff

Fill before `/goal pause` or any handoff.

- Why paused: `not paused; the external-worker RPC/static-container checkpoint is at final commit handoff`
- Exact current state: `the host RPC client and static web-container boundaries are verified offline; host live construction/commands remain disabled, actual transport/supervisor/worker/live Codex and dynamic container/deployment remain absent`
- Last successful command: `pnpm verify completed 105 unit assertions, 31 integration, 22 eval, 3 browser, 281-file clean-copy, 256-file security, static container, and production build checks`
- Current failing command: `pnpm verify retains only owner LICENSE and 30-item non-final submission failures; pnpm container:verify fails at the unset immutable Node digest; pnpm verify:live fails at missing OPENAI_API_KEY and CODEX_MODEL before the unimplemented worker path`
- Uncommitted files: `none after the ledger follow-up commit`
- Safe resume command/action: `start the actual authentication-enforcing transport/supervisor implementation from the clean checkpoint after commit`
- One owner action, if any: `none`

## Final completion record

Do not fill until the end.

- Engineering definition of done: `NOT_VERIFIED`
- `pnpm verify`: `FAIL_EXPECTED — all implemented gates pass; owner LICENSE and non-final submission only`
- `pnpm verify:live`: `FAIL — host credentials plus authentication-enforcing transport/supervisor/worker/fresh GPT/Codex evidence absent`
- Production deployment: `NOT_VERIFIED`
- Public repository: `NOT_VERIFIED`
- Demo video: `NOT_VERIFIED`
- Challenge submission: `NOT_VERIFIED`
- Final evidence hash: `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`, not final live proof)
- Final commit/tag: `UNSET`
- Final truthful state: `NOT_STARTED`
