# PROGRESS.md — PolicyTwin Goal Ledger

> Codex must keep this file current. Update it at the beginning of a run, after every milestone checkpoint, before pausing, and before declaring completion. Never record a pass without command or artifact evidence.

## Current status

- Overall state: `IN_PROGRESS`
- Current milestone: `M3 — Persisted policy workspace service`
- Goal state: `IN_PROGRESS`
- Submission state: `NOT_STARTED`
- Last updated: `2026-07-14 12:47:17 +09:00`
- Latest checkpoint commit: `85259ea1e70449c1307b382e3f2541fb7e8c2327`
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
| OPA | NOT_INSTALLED | `opa version` | Command not found; address during M0 implementation |
| Codex client | codex-cli 0.144.0 | `codex --version` |  |
| Goal mode | stable/enabled | `codex features list` | `goals stable true` |
| OpenAI API auth | UNSET | redacted environment-name check only | `OPENAI_API_KEY` and `CODEX_API_KEY` are not configured; never record secrets |
| Codex SDK feasibility | PARTIAL | `codex --version`; `npm list --global --depth=0` | Codex CLI 0.144.0 is present; project SDK dependency is not installed |
| Browser/Playwright | UNSET |  |  |
| GitHub auth | UNSET | redacted status only |  |
| Deployment auth | UNSET | redacted status only |  |
| Devpost access | UNSET | redacted status only |  |

## Challenge facts verified

Replace placeholders after checking current official sources.

- Official challenge URL: `UNSET`
- Exact submission deadline and timezone: `UNSET`
- Local deadline: `UNSET`
- Selected track/category: `UNSET`
- Team/eligibility status: `UNSET`
- Repository visibility requirement: `UNSET`
- Demo video constraints: `UNSET`
- Required submission fields: `UNSET`
- Rules checked at: `UNSET`
- Source links: `UNSET`

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
| M0 Preflight and baseline | IN_PROGRESS | document-contract validation, Git baseline, offline install, strict TypeScript scaffold, unit/integration/eval, and build pass; official rules and pinned project dependencies remain | `c175d1c` | OPA, Docker daemon, browser stack, SDK/API facts, and challenge facts are not yet verified |
| M1 Domain core and seeded fixture | PASS | strict validation; 4 unit tests; 5 integration tests; fixture-local 4-test suite; deterministic reset and exactly 3 seeded drifts | `e509486` | Evaluation-only fixed fixture must remain outside future Codex repair context |
| M2 PolicyIR and interpretation | IN_PROGRESS | offline contracts committed; 11 unit and 7 eval tests pass for strict IR validation, stable clauses, prompt safety, recorded semantics, and 9-case reference agreement | `e535209` | Project-pinned Zod/OpenAI integration and fresh GPT-5.6 evidence require approved network scope |
| M3 Decision Queue and versioning | IN_PROGRESS | offline patch/version/state contracts, SQLite persistence, and framework-independent workspace service; restart, immutable text versions, atomic/idempotent resolution, corruption, stale-write, and decision-replay checks pass | `85259ea` | Decision Queue UI and Next.js route wiring require the pinned application stack |
| M4 Compiler and OPA | IN_PROGRESS | offline compiler committed; 25 unit tests and byte-stable 3,008-byte Rego/manifest snapshots cover all predicate types and exact mappings | `27a2b92` | OPA binary/version and real compile/evaluation evidence require approved installation scope |
| M5 Case generation/conflict/mutation | IN_PROGRESS | offline engines committed; canonical corpus now has 41 unique cases including D01–D03, 3 conflicts, 36 contrasts, and 44/47 killed mutants (93.62%) with all survivors reported | `66431fc` | OPA-backed agreement, Case Lab UI, and final evidence remain unavailable until earlier external/app gates |
| M6 Differential runner and drift UX | IN_PROGRESS | offline runner verified: 41 cases, 16 classified baseline drifts, 0 execution errors, D01–D03 preserved, and 0 fixed-reference drift | `866bb20` | OPA results and web drift UX remain unavailable |
| M7 Codex repair and review | IN_PROGRESS | offline foundation verified: fresh trusted copies, strict input/results, closed commands, credential-stripped environment, 2-attempt bound, independent review blocking; explicitly no live Codex claim | `0c6fb85` | Current Codex SDK integration, real patch/diff, zero post-repair drift, and live review evidence require approved documentation/install/network scope |
| M8 Proof, impact, and polish | IN_PROGRESS | offline foundation verified: 14→30 impact, G02 contradiction block, 4/4 clause and rule traceability, 41/41 valid case links, deterministic 25-file FAIL evidence package | `efff641` | Proof UI, archive/download, screenshots, accessibility, and browser gates require the application stack |
| M9 Security, reproducibility, deployment | IN_PROGRESS | offline foundation verified: threat model, 158-file current/history scan, 158-file clean-copy replay, notice/inventory, and fail-closed license/container reports | `9602a6c` | Owner license choice, app/OPA container, Docker daemon, provider selection, and deployment remain |
| M10 Submission package | IN_PROGRESS | 21 submission and 4 demo draft files generated; deterministic checker reports 37 unmet requirements; 43 unit and 21 eval checks pass | `130c355` | Official rules, license, UI/screenshots, live/repo/video URLs, form, and confirmation remain unavailable |

## Current checkpoint

### Objective

Connect the pure policy-resolution domain and SQLite repository through a framework-independent server service that exposes strict workspace reads, immutable policy-text version creation, and atomic ambiguity resolution suitable for future Next.js route handlers.

### Failing or missing condition

The repository now persists projects and decisions, but callers must manually read the current version, invoke `resolvePolicyAmbiguity`, and append the result. There is no single server-side operation that enforces expected-version concurrency, preserves golden cases/source text, handles idempotent selections, or returns a complete current workspace. A future route could therefore omit one of these required steps.

### Planned actions

- [x] Confirm the missing orchestration boundary between domain resolution and persistence.
- [x] Define a narrow repository port and strict service inputs/results.
- [x] Implement project creation/read, immutable policy-text version creation, and ambiguity resolution.
- [x] Preserve expected-version concurrency, golden contradictions, decision replay, and idempotency.
- [x] Add service tests including restart-backed persistence behavior.
- [x] Run full regressions, update docs/evidence, review, and commit the checkpoint.

### Completion evidence

- Commands: `pnpm typecheck`; `pnpm test`; `pnpm test:integration`; `pnpm verify`
- Exit codes: `0`; `0` (49/49); `0` (15/15); `1` (expected aggregate failures: license, container, browser, submission only)
- Artifacts: `src/workspace/service.ts`; `tests/unit/policy-workspace-service.test.mjs`; updated restart integration test
- Screenshots: not applicable to this server-service slice
- Commit: `85259ea1e70449c1307b382e3f2541fb7e8c2327`

## Quality gates

Record latest actual result.

| Gate | Status | Command | Evidence/artifact | Last run |
|---|---|---|---|---|
| Document contract validation | PASS | PowerShell manifest/hash/fence/milestone validator | 10 manifest entries and 11 root Markdown files | 2026-07-14 11:50 +09:00 |
| Install/lockfile | PASS | `pnpm install --offline` | `pnpm-lock.yaml` | 2026-07-14 08:39 +09:00 |
| Lint | PASS | `pnpm lint` via `pnpm verify` | repository static checks | 2026-07-14 12:41 +09:00 |
| Typecheck | PASS | `pnpm typecheck` via `pnpm verify` | domain through persisted workspace service and submission validation pass strict TypeScript | 2026-07-14 12:41 +09:00 |
| Unit tests | PASS | `pnpm test` via `pnpm verify` | 49/49 passed, including workspace reads, immutable text versions, atomic/idempotent resolution, stale writes, contradictions, and corruption | 2026-07-14 12:41 +09:00 |
| Integration tests | PASS | `pnpm test:integration` via `pnpm verify` | 15/15 passed; service-created four versions and three decisions survive close/reopen with lifecycle state | 2026-07-14 12:41 +09:00 |
| Browser tests | FAIL | `pnpm test:e2e` via `pnpm verify` | fail-closed: no web app or Playwright suite | 2026-07-14 12:41 +09:00 |
| Prompt/eval suite | PASS | `pnpm eval` via `pnpm verify` | 21/21 offline/recorded evals pass, including draft generation and submission audit; live model/Codex/OPA eval remains unverified | 2026-07-14 12:41 +09:00 |
| Production build | PASS | `pnpm build` via `pnpm verify` | `dist/` generated and ignored | 2026-07-14 12:41 +09:00 |
| Offline full verification | FAIL | `pnpm verify` | every implemented gate passes; exact expected remaining failures are license, container, browser, and submission | 2026-07-14 12:41 +09:00 |
| Fresh live integration | FAIL | `pnpm verify:live` | fail-closed: credentials and live integration absent | 2026-07-14 08:42 +09:00 |
| Clean-copy reproduction | PASS | `pnpm clean:check` via `pnpm verify` | 195 files copied; offline frozen install and 10 implemented command groups pass; no source `node_modules` or credential variables | 2026-07-14 12:41 +09:00 |
| Container health | FAIL | `pnpm container:check` via `pnpm verify`; `docker info` | OPA/container contract not ready; Dockerfile and health route absent; Docker daemon unavailable | 2026-07-14 12:41 +09:00 |
| Secret scan | PASS | credential-shaped `rg` scan | no matches | 2026-07-14 08:20 +09:00 |
| Dependency/license review | FAIL | `pnpm license:check` via `pnpm verify` | zero production dependencies and NOTICE present; owner-selected project LICENSE absent | 2026-07-14 12:41 +09:00 |
| Security review | PASS | `pnpm security:check` via `pnpm verify` | offline static scope only: 195 files, 193 text files, full Git history, zero findings; release review remains NOT_RUN | 2026-07-14 12:41 +09:00 |
| Submission consistency | FAIL | `pnpm submission:check` via `pnpm verify` | expected fail-closed result with 37 explicit unmet requirements; draft artifacts exist but live proof, official rules, license, media, URLs, and confirmation do not | 2026-07-14 12:41 +09:00 |

## Product proof metrics

Never fill from estimates.

| Metric | Target | Current actual | Evidence |
|---|---:|---:|---|
| Structured-output schema pass | 100% | UNSET |  |
| Required ambiguity labels found | 100% | UNSET |  |
| Explicit seeded semantics mislabeled as ambiguity | 0 | UNSET |  |
| Golden cases passed | 100% | 6/6 (offline reference evaluator; not OPA) | `artifacts/evidence/verification-summary.json` |
| Accepted corpus size | ≥30 | 41 (offline reference corpus including D01–D03) | `tests/snapshots/offline-m5-summary.json` |
| Seeded app bugs detected | 3/3 | 3/3 | `pnpm demo:run`; `tests/integration/refund-fixture.integration.test.mjs` |
| Post-repair drift | 0 | 0 (evaluation-only fixed fixture; no Codex/OPA claim) | `tests/snapshots/offline-m6-summary.json` |
| Mutation kill rate | ≥90% | 93.62% (offline reference; OPA unverified) | `tests/snapshots/offline-m5-summary.json` |
| Rule-to-clause traceability | 100% | 4/4 rules and 4/4 clauses (offline) | `artifacts/evidence/traceability.json` |
| Rule-to-case traceability | 100% | 41/41 accepted case links valid (offline) | `artifacts/evidence/traceability.json` |
| Critical/high security findings | 0 | UNSET |  |
| Browser happy path | 100% | UNSET |  |

## Checkpoint log

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
| B-001 | External network approval | Current official OpenAI/Codex/Build Week/OPA/Next.js facts, pinned package installation, and OPA acquisition cannot be performed under the unapproved network boundary | All independent offline domain, compiler, cases, mutation, differential, repair safety, evidence, security, submission-draft, SQLite persistence, and workspace-service work completed and verified | Approve network use limited to official documentation lookup, pinned pnpm package installation, and official OPA binary acquisition | Official sources can be recorded and M0/M2/M4/M7 plus the web stack can resume without guessing |

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner/status |
|---|---|---|---|---|
| Deadline compression | Medium | High | Preserve P0 vertical slice; cut only P1 | Codex / open |
| Live model/API outage | Medium | Medium | Keep recorded verified evidence clearly labeled | Codex / open |
| Hosted worker restrictions | Medium | High | Use container/VM host or split worker | Codex / open |
| Codex SDK interface changes | Medium | High | Check current official docs and adapt | Codex / open |
| Empty local package cache | High | Medium | Keep M0 dependency-free; request one scoped approval before installing pinned project dependencies | Codex / open |
| Docker daemon unavailable | High | Medium | Continue non-container gates; start Docker Desktop before the container gate | Owner/Codex / open |
| Offline validator/Zod duplication | Medium | Medium | Cross-check both contracts and generate JSON Schema from the pinned runtime schema after network approval | Codex / open |
| Demo recording/account blocker | Medium | Medium | Prepare script, captions, screenshots, and exact owner action | Codex / open |

## Decisions pending

Link to IDs in `DECISIONS.md`.

- Project license selection requires owner acceptance; see D-013 and `docs/license-review.md`.

## Next action

`After B-001 approval, verify current official sources, install the pinned application/API/test stack and OPA, then resume M0 followed by the live M2/M4/M7 and web UI gates.`

## Pause handoff

Fill before `/goal pause` or any handoff.

- Why paused: `B-001 — required external network scope is not approved`
- Exact current state: `M1 passes; M2–M10 have truthful offline foundations; M3 now includes restart-safe SQLite persistence and a tested server workspace service; external/live/UI/deployment gates remain incomplete`
- Last successful command: `pnpm build` within the final `pnpm verify`; full implemented suites also passed (`49` unit, `15` integration, `21` eval)
- Current failing command: `pnpm verify` exits `1` only for `license:check`, `container:check`, `submission:check`, and `test:e2e`; `pnpm verify:live` remains fail-closed
- Uncommitted files: `none after this ledger checkpoint`
- Safe resume command/action: `verify the approved scope, then check official sources before any install or API-specific implementation`
- One owner action, if any: `Approve external network use limited to official documentation lookup, pinned pnpm package installation, and official OPA binary acquisition.`

## Final completion record

Do not fill until the end.

- Engineering definition of done: `NOT_VERIFIED`
- `pnpm verify`: `NOT_RUN`
- `pnpm verify:live`: `NOT_RUN`
- Production deployment: `NOT_VERIFIED`
- Public repository: `NOT_VERIFIED`
- Demo video: `NOT_VERIFIED`
- Challenge submission: `NOT_VERIFIED`
- Final evidence hash: `UNSET`
- Final commit/tag: `UNSET`
- Final truthful state: `NOT_STARTED`
