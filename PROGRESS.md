# PROGRESS.md — PolicyTwin Goal Ledger

> Codex must keep this file current. Update it at the beginning of a run, after every milestone checkpoint, before pausing, and before declaring completion. Never record a pass without command or artifact evidence.

## Current status

- Overall state: `IN_PROGRESS`
- Current milestone: `M7/M9 — factory-only Worker RPC v2 mTLS transport capability`
- Goal state: `IN_PROGRESS`
- Submission state: `DRAFT_NOT_READY`
- Last updated: `2026-07-16 06:59 +09:00`
- Latest checkpoint commit: `e736ccc5693ad607c0a4572cf207b9e40c4ce94d`
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
| OpenAI API auth | UNSET | redacted environment-name check only | `OPENAI_API_KEY` is not configured; the prepared worker receives only a run capability and never a provider credential |
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
| M7 Codex repair and review | IN_PROGRESS | pinned SDK-compatible phase adapter, signed v1 RPC client, real TLS 1.3 mTLS transport, durable replay rejection, shell-free Docker lifecycle driver, fake-only aggregate CPU ledger, and a separate Worker RPC v2 candidate with strict three-role proof parsing, client/Docker bindings, cross-purpose-SPKI-deduplicated trust bundle, downgrade rejection, and a deliberately FAIL-only supervisor | pending | host live construction and v2 PASS signing remain disabled; no immutable image run, real cgroup controller/global event transcript/failure evidence, observed real-Docker behavior, fresh SDK repair, zero live post-repair drift, live review, or signed live evidence exists |
| M8 Proof, impact, and polish | IN_PROGRESS | reference-bound Proof UI, blocked 14-to-30 v5 draft, semantic mismatch guard, deterministic guarded 38-file USTAR download, responsive six-view navigation, seven inspected product screenshots plus a reviewed architecture asset, and 3/3 production Chrome E2E checks pass | `5fecdde` | live signer/receipts, actual Codex proof, and the truthful live Codex repair capture remain |
| M9 Security, reproducibility, deployment | IN_PROGRESS | checksum-pinned OPA/dependency foundation, session/CSRF/body limits, real mTLS plus restart-persistent replay, factory-identity-only v2 transport admission with private validated TLS-input snapshots, 332-file clean-copy replay, schema-v7 split web/worker/verifier/egress contracts, canonical local Docker CLI boundary, cgroup-v2 teardown observer, explicit `restart=no` identity checks, TLS-only no-HTTP probe, strict fake CPU accounting, and static/fake-daemon supervisor checks | pending | real restart/lease behavior, immutable Node/role images, Linux Docker daemon, dynamic web/worker/verifier/egress PASS, measured upstream behavior, signed real-Linux CPU proof, owner license, shared auth/quotas, and deployment remain |
| M10 Submission package | IN_PROGRESS | official rules/dates/track/requirements verified; reproducible 1800x1200 architecture SVG/PNG reviewed; generated draft remains fail-closed with 29 unmet requirements | `130c355` | live Codex repair screenshot, owner declarations/license, live/repo/video/submission URLs, final media/form, and confirmation remain unavailable |

## Current checkpoint

### Objective

Close the remaining P2 in Worker RPC v2 transport admission. A plain object that merely claims `authenticationMode:"MUTUAL_TLS"` must not enter the v2 client. Only the exact frozen object created and privately recorded by the concrete `createMutualTlsWorkerRpcV2Transport` factory may satisfy the runtime capability; no arbitrary registrar may exist. Preserve v1 transport compatibility, the current FAIL-only supervisor, and the live-gate boundary.

### Starting failing condition

The fail-only v2 CPU evidence envelope was committed at `c366246` with ledger commit `dc4ff8a`; `main` was clean. Independent review found no P0/P1 and one P2: `createExternalWorkerRpcV2Client` trusts the public transport interface's self-declared `authenticationMode:"MUTUAL_TLS"`. Any fake or shallow copy can therefore pass construction even though it cannot forge an admitted Ed25519 PASS receipt. Reproduction: a synthetic object with that string is accepted by the current unit client constructor; the actual mTLS v2 factory has no opaque runtime identity.

### Planned actions

- [x] Confirm clean `main` at `dc4ff8a` and reproduce acceptance of a self-declared fake v2 mTLS transport.
- [x] Co-locate the concrete v2 TLS factory with a private `WeakSet` and expose no arbitrary registrar.
- [x] Add only exact frozen v2 factory results; do not admit v1 transports or copied/wrapped objects.
- [x] Change v2 client admission to require the opaque capability and retain clear diagnostics without creating a client↔transport cycle.
- [x] Replace direct synthetic v2 transport injection with scripted real TLS peers and the actual v2 factory.
- [x] Add regressions for fake self-declaration, v1 factory reuse, shallow copy/wrapper forgery, root/subpath export leakage, and real v2 FAIL flow.
- [x] Update decisions, threat model, limitations, static contract checks, generated copy, and current role hashes without implying live execution.
- [x] Snapshot validated scalar and in-memory TLS factory inputs so post-construction caller mutation cannot redirect or corrupt an admitted transport.
- [x] Add real TLS regressions for scalar mutation and CA/certificate/key Buffer/array mutation.
- [x] Rerun focused and authoritative offline gates after the snapshot fix.
- [x] Complete final truth re-review and diff review against the current ledger.
- [x] Create the current-branch implementation checkpoint commit.
- [ ] Verify and commit this post-checkpoint ledger update, then confirm a clean worktree.

### Completion evidence

- Starting HEAD: `dc4ff8a38382ad1c355e68e4e92f3f96e2a5104b`; clean `main` worktree before this ledger update.
- Gap evidence: the new regression initially failed with `Missing expected exception` because a plain object with a safe ID, `authenticationMode:"MUTUAL_TLS"`, and a scripted `call` method passed v2 client construction. A shallow copy retained the same public fields.
- Security invariant: v2 transport admission now depends on `WeakSet` membership of the exact object frozen by the concrete mTLS v2 factory, not a public string or copyable property. V1 transports, fake objects, shallow copies, and wrappers fail before request creation or network use.
- Package invariant: the actual TLS factory owns the private capability set and exposes no arbitrary registrar. The internal assertion module is not exported from `src/index.ts`; public consumers receive only the intended concrete factory and opaque transport type.
- Test boundary: scripted signed PASS and rejection fixtures now run through real TLS 1.3 loopback peers and the concrete v2 factory. The generic supervisor remains FAIL-only and live admission remains disabled.
- Focused verification: strict typecheck passed; Worker RPC unit tests passed 36/36; mTLS integration passed 20/20 including scalar and Buffer/array mutation; container contract tests passed 5/5; `pnpm container:check` passed after recomputing worker and egress role-input hashes.
- Independent review and correction: the reviewer who reported the registrar P1 confirmed that path is closed with no P0/P1. Final truth review then found one P2: the frozen transport captured the caller-owned TLS options object, so later scalar or Buffer/array mutation could alter a future connection. Two real-TLS regressions failed with the expected handshake/PEM errors. The factory now reads each option once, stores validated scalars in a frozen private snapshot, defensively copies Buffers and the CA array, and passes both regressions. Final re-review found no remaining P0/P1/P2 and confirmed current role hashes plus every FAIL-only/live-disabled truth boundary.
- Authoritative offline verification: the post-snapshot serial `pnpm verify` passed lint, strict typecheck, 217/217 unit, 57/57 integration, 22/22 eval, 3/3 production Chrome E2E, build, schema-v7 static container inspection, 332-file clean-copy replay, and 332-file/303-text-file plus Git-history security review. It exited 1 only for the owner-selected project `LICENSE` and the exact 29-item non-final submission gate.
- Recovered environment failure: an earlier overlapping E2E invocation briefly failed to overwrite `03-case-lab-drift.png` with Windows `UNKNOWN: open`. The file was writable and unlocked afterward; the failed case passed 1/1 in isolation, the full suite passed 3/3, and a fresh serial authoritative verify passed E2E 3/3. No code change or suppressed assertion was used.
- Dynamic/live truth: web, worker/verifier, and egress gates each failed before Docker because the immutable Node base is unset. `pnpm verify:live` failed before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`. No Docker, Linux cgroup, model, Codex, deployment, or live proof execution occurred.
- Truth boundary: closing a host-process nominal capability does not prove Docker, Linux cgroups, CPU enforcement, OpenAI traffic, Codex repair, deployment, or live evidence.
- Implementation commit: `e736ccc5693ad607c0a4572cf207b9e40c4ce94d` (`fix: require immutable v2 mTLS transport`).

## Quality gates

Record latest actual result.

| Gate | Status | Command | Evidence/artifact | Last run |
|---|---|---|---|---|
| Document contract validation | PASS | PowerShell manifest/hash/fence/milestone validator | 10 manifest entries and 11 root Markdown files | 2026-07-14 11:50 +09:00 |
| Install/lockfile | PASS | `pnpm install --offline --frozen-lockfile` | exact 469-entry lock graph passes supply-chain policy | 2026-07-14 15:16 +09:00 |
| Lint | PASS | `pnpm lint` | Worker RPC v2, strict CPU proof/schema, fail-only supervisor, container/static checks, and submission generators pass repository checks | 2026-07-16 06:47 +09:00 |
| Typecheck | PASS | `pnpm typecheck` | strict TypeScript 6.0.3 covers v1/v2 RPC, immutable trust bundle, CPU proof, lifecycle, application, and policy engine boundaries | 2026-07-16 06:47 +09:00 |
| Unit tests | PASS | `pnpm test` | 217/217 assertions pass, including factory-only v2 transport admission, strict uint64/schema parity, CPU proof forgery/replay, live-gate, lifecycle, and Docker-driver cases | 2026-07-16 06:47 +09:00 |
| Integration tests | PASS | `pnpm test:integration` | 57/57 serial mTLS v1/v2, TLS input-snapshot mutation, FAIL-only signing, replay restart, OPA, evidence, persistence, and fixture assertions pass | 2026-07-16 06:47 +09:00 |
| Browser tests | PASS | `pnpm test:e2e` | 3/3 production standalone Chrome tests; six views, archive, v1-v5 writes, isolation/capacity/expiry, focus, and 390px layout pass | 2026-07-16 06:47 +09:00 |
| Prompt/eval suite | PASS | `pnpm eval` | 22/22 offline/recorded evals pass after explicit factory-capability and contract-only CPU claims; live model/Codex work remains unverified | 2026-07-16 06:47 +09:00 |
| Production build | PASS | `pnpm build` | Next.js 16 Turbopack standalone build includes the dynamic archive and workspace routes | 2026-07-16 06:47 +09:00 |
| Offline full verification | FAIL | `pnpm verify` | authoritative post-snapshot serial current-worktree sequence passes every implemented offline gate; exit 1 is limited to owner-selected project `LICENSE` and the exact 29-item non-final submission gate | 2026-07-16 06:47 +09:00 |
| Fresh live integration | FAIL | `pnpm verify:live` | fail-closed before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`; no fresh evidence exists | 2026-07-16 06:47 +09:00 |
| Clean-copy reproduction | PASS | `pnpm clean:check` | 332 source files; frozen offline install and all 11 command groups, including architecture regeneration and production Chrome E2E, pass | 2026-07-16 06:47 +09:00 |
| Static container contract | PASS | `pnpm container:check` | schema-v7 structural JSON plus required-source-marker inspection, TLS input-snapshot requirement, and current worker/verifier/egress hashes pass; behavioral proof remains in separate unit/integration suites and dynamic/live facts remain false | 2026-07-16 06:47 +09:00 |
| Dynamic container health | FAIL | `pnpm container:verify` | `DYNAMIC_WEB_CONTAINER/FAIL`; immutable Node base is unset, so Docker build/runtime/SQLite restart checks did not run | 2026-07-16 06:00 +09:00 |
| Dynamic worker/verifier smoke | FAIL | `pnpm worker:verify` | current role hashes match; fails before Docker at the unset immutable Node base with `dockerInvoked:false`; post-exit role observation and cumulative enforcement remain false | 2026-07-16 06:00 +09:00 |
| Dynamic TLS-only egress smoke | FAIL | `pnpm egress:verify` | fails before Docker at the unset immutable Node base; restart/identity/TLS facts remain false, HTTP/model facts remain false, and outbound is `NOT_MEASURED` | 2026-07-16 06:00 +09:00 |
| Secret scan | PASS | credential-shaped `rg` scan | no matches | 2026-07-14 08:20 +09:00 |
| Dependency/license review | FAIL | `pnpm license:check` via final `pnpm verify`; prior `pnpm audit --prod --json` | 6 production dependencies inventoried, audit 0 vulnerabilities, NOTICE present; owner-selected project LICENSE absent | 2026-07-15 23:58 +09:00 |
| Security review | PASS | `pnpm security:check` | 332 files/303 text files plus Git history; no findings | 2026-07-16 06:47 +09:00 |
| Submission consistency | FAIL | `pnpm submission:check` | exactly 29 unmet requirements; claim audit limits v2 to candidate/fail-only evidence, and only the truthful live Codex repair capture remains missing among screenshots | 2026-07-16 06:47 +09:00 |

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

### 2026-07-16 06:59 +09:00 — Factory-only Worker RPC v2 mTLS transport verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint closes host-process transport self-declaration and caller-mutation gaps without enabling a live run.
- Admission boundary: the v2 client accepts only the exact frozen object recorded by the concrete v2 TLS factory's private `WeakSet`. V1 results, fake declarations, copies, wrappers, root/subpath access, and arbitrary registrar paths fail before request construction.
- Input boundary: the factory reads each option once, validates it, stores scalars in a frozen private snapshot, and defensively copies CA/certificate/key Buffers plus the CA array. Mutating the caller-owned object or material after construction cannot redirect or corrupt the admitted connection.
- Regression evidence: the self-declared-object test first failed with `Missing expected exception`; scalar and Buffer/array mutation tests then failed with the expected handshake and PEM errors. After correction, focused RPC unit 36/36, mTLS integration 20/20, container contract 5/5, strict typecheck, and static container checks pass.
- Full verification: post-snapshot `pnpm verify` passes lint, typecheck, 217/217 unit, 57/57 integration, 22/22 eval, 3/3 production Chrome, build, schema-v7 static container checks, 332-file clean-copy replay, and 332-file/303-text-file plus Git-history security. It exits 1 only for owner-selected `LICENSE` and the exact 29-item non-final submission gate.
- Review: final independent read-only review found no remaining P0/P1/P2 and confirmed role hashes `ef656bc847e4bb02900d5eeb8fa574bfe8f63cd399b5f62f7d1ad02af4932057`, `ecfd6e9ac299c5a65b6dcbfc3fbc67e6f6840284f91d76341f60d1716946c949`, and `9760d2599be2ca47e35d8bcd538718be1bc49479af4b5b0c7e5cd0199309813c` across the contract and reports.
- Dynamic/live truth: all three dynamic gates fail before Docker at the unset immutable Node base; `verify:live` fails before network at missing `OPENAI_API_KEY`/`CODEX_MODEL`. No Docker, Linux CPU observation, OpenAI request, Codex repair, deployment, or live proof occurred.
- Commit: `e736ccc5693ad607c0a4572cf207b9e40c4ce94d` (`fix: require immutable v2 mTLS transport`).

### 2026-07-16 05:05 +09:00 — Fail-only Worker RPC v2 CPU evidence envelope verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint defines a non-downgradable signed success shape without claiming or enabling a live Linux success.
- Proof contract: strict TypeScript and JSON Schema bind request/nonce/digest, client execution identity, derived Docker identity, immutable worker image, policy/corpus/final tree, exact ordered egress/worker/verifier identities, monotonic uint64 samples and hashes, exact aggregate arithmetic, controller stop, and cgroup release. Hard-limit and bounded-overshoot claims remain false.
- RPC boundary: v2 uses independent protocol/signature/execution-binding domains, mTLS ALPN/frame magics, durable SQLite replay, a factory-created immutable trust bundle with cross-purpose SPKI deduplication, and exact live-purpose signer registration. V1, static fake, unsigned, replayed, key-reused, or downgraded inputs cannot be promoted.
- PASS boundary: the generic v2 supervisor signs only explicit `FAIL` with `cpuProof:null` and rejects PASS before signing. A global timestamped event transcript and signed CPU-failure/containment union remain schema-v7 false blockers before a dedicated Linux controller may enable PASS.
- Verification: `pnpm verify` passes lint, strict typecheck, 217/217 unit, 55/55 integration, 22/22 eval, 3/3 production Chrome, build, schema-v7 static container checks, 330-file clean-copy replay, and 330-file/301-text-file plus Git-history security. It exits 1 only for owner-selected `LICENSE` and the exact 29-item non-final submission gate.
- Dynamic/live truth: web, worker/verifier, and egress gates fail before Docker at the unset immutable Node base; `verify:live` fails before network at missing `OPENAI_API_KEY`/`CODEX_MODEL`. No Docker, Linux `cpu.stat`, model, Codex, deployment, or live evidence run occurred.
- Review: independent read-only review found no P0/P1. The remaining P2 is opaque runtime branding of the mTLS v2 transport object; Ed25519 verification plus disabled PASS/live admission prevent promotion in the current checkpoint.
- Commit: `c366246df1c5df210c7d536870253a55f6411c32` (`feat: define fail-only live CPU proof envelope`).

### 2026-07-16 03:08 +09:00 — Fake-only three-role CPU budget proof gates receipt trust

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint adds the safest static/fake CPU accounting foundation without claiming real Linux enforcement.
- Contract: one unsigned-64 `bigint` request budget aggregates post-baseline egress, worker, and verifier usage; strict proof parsing binds request SHA, Docker binding, unique container/cgroup identities, exact role order, monotonic samples, and aggregate arithmetic. Enforcement, hard-limit, overshoot-bound, and containment flags remain false.
- Lifecycle: worker and verifier outputs remain raw wrappers through both executions. The lifecycle finalizes and validates the CPU proof first, then validates worker and verifier receipts, and returns only after controller plus Docker/workspace/process cleanup passes.
- Failure handling: every CPU-controller operation is supervisor-time-bounded; timeout or ignored abort permanently invalidates cleanup proof, while Docker cleanup still runs. Over-budget, forged, incomplete, drifted, reused, regressed, overflowing, timed-out, or cleanup-failed proofs cannot return a result.
- Live boundary: schema v6 static checks require the controller port and fake-only proof contract. The worker dynamic report requires only its limited role-local post-exit observation and retains `cumulativeCpuTimeEnforced:false`; the live gate rejects both a forged boolean and the static fake proof.
- Verified: final `pnpm verify` passes lint, strict typecheck, 196/196 unit, 49/49 integration, 22/22 eval, 3/3 production Chrome, build, schema-v6 static container checks, 327-file clean-copy replay, and 327-file/298-text-file plus Git-history security. It exits 1 only for the owner-selected `LICENSE` and the exact 29-item non-final submission gate.
- Dynamic/live truth: all three dynamic reports fail before Docker at the unset immutable Node base; `verify:live` fails before network at missing `OPENAI_API_KEY`/`CODEX_MODEL`. No real cgroup path/sample/poll/freeze/kill, aggregate enforcement, model call, Codex repair, or live proof exists.
- Review: initial P1/P2 findings were corrected; the final independent read-only code/truth re-review found no P0/P1/P2. `git diff --check` passes.
- Commit: `b24bd9f6700ec2b102e32b88e922b9ac050d633e` (`feat: gate receipts on aggregate CPU proof`).

### 2026-07-16 01:11 +09:00 — Egress restart and stopped-result identity fail closed offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint closes the process-local egress lease restart gap only at the static/fake-daemon boundary.
- Runtime contract: worker, verifier, egress, and TLS probe explicitly use `restart=no`; independent inspect requires policy `no`, retry count/restart count zero, and strict canonical start timestamps.
- Supervisor behavior: one running ID/PID/start timestamp is pinned, egress is reobserved before/after worker execution and before stop, and worker/verifier/egress must remain the same stopped PID-zero instance before and after log collection.
- Regression evidence: fake-daemon tests reject PID, start time, running state, restart count, missing timestamp, invalid calendar timestamp, weakened/missing restart policy, and wait-returned running containers. Focused suites pass 43/43 and the full unit suite passes 178/178.
- Broader evidence: integration 49/49, eval 22/22, production Chrome 3/3, build, static container contract, 325-file/296-text-file security scan, and 325-file clean-copy replay pass.
- Review: one read-only security review found the driver stopped-state P1, and a separate truth review found the dynamic-smoke ordering P0. Both were corrected with log-boundary inspections, order checks, and worker/verifier/egress regressions; the final re-review found no remaining P0/P1.
- Truth boundary: real Docker and live work did not run. The three dynamic gates fail before Docker at the unset immutable Node base, and `verify:live` fails before network at missing `OPENAI_API_KEY`/`CODEX_MODEL`. The submission checker remains fail-closed with 29 unmet requirements.

### 2026-07-15 23:32 +09:00 — Truthful architecture submission asset verified offline

- Milestones: M8 and M10 remain `IN_PROGRESS`; this checkpoint supplies the independently completable architecture capture without fabricating the still-missing live Codex repair capture.
- Asset: added a self-contained 1800x1200 SVG and locally rendered PNG with 12 explicit architecture nodes, solid verified/deterministic paths, dashed prepared-not-executed paths, exact `PARTIAL_OFFLINE / FAIL` state, and no external image, font, URL, credential, or personal-path dependency.
- Truth boundary: real OPA 41/41 execution is separated from the 16 reference-expectation drifts and the 44/47 reference mutation score. GPT-5.6, live Codex repair/review, real Docker, upstream OpenAI traffic, signed live proof, deployment, and submission remain visibly not run or not measured.
- Reproducibility: `submission:architecture` opens only the repository SVG through installed Chrome. Four architecture assertions require self-containment, exact dimensions, local-only navigation, and byte-identical regeneration to a temporary managed artifact.
- Output safety: the renderer validates lexical and physical repository containment for the source and every output parent before the screenshot, rejects links/unsupported objects, writes only a randomized managed temporary PNG, and promotes only a validated regular file.
- Submission change: `08-architecture.png` is now present and reviewed; `submission:check` fell from 30 to exactly 29 unmet requirements. `04-codex-repair.png` remains deliberately absent because no live repair occurred.
- Claim correction: the generated accomplishments, claim audit, and captions now label buggy-app drift as reference-expectation differential evidence, not OPA-backed evidence.
- Submission-state consistency: the authoritative offline sequence now runs `clean:check` before draft/check generation, and the checker rejects stale clean-copy, security, or evidence states. The final draft records `cleanCopyStatus: PASS` and `staticSecurityStatus: PASS` while preserving `evidenceStatus: FAIL`.
- Regression evidence: 167/167 unit assertions, 49 integration assertions, 22/22 evals, 3/3 production Chrome E2E, lint, strict typecheck, production build, 325-file clean-copy replay, and 325-file/296-text-file plus Git-history security scan pass.
- Full gate: final `pnpm verify` exits 1 only because the owner-selected `LICENSE` is absent and `submission:check` retains the exact 29 non-final requirements. Every implemented offline gate passes.
- Dynamic/live truth: `container:verify`, `worker:verify`, and `egress:verify` fail before Docker at the unset immutable Node base. `verify:live` fails before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`; no request, probe, model call, or live proof was generated.
- Build-input hashes after the package-script addition: worker `415d05e68486d56b875d4693c649558d66393b1d9877038fa2a840730f19aedf`; verifier `ecfd6e9ac299c5a65b6dcbfc3fbc67e6f6840284f91d76341f60d1716946c949`; egress `43652e083c3b43132a4548c9c8e4e48ca3f86481902c3533fb381122822fb644`.
- Independent review: two read-only reviewers found no remaining P0/P1 after correcting drift provenance, PNG freshness, status color, evidence direction, return-path wording, and small-text sizing. The final 1800x1200 render has no clipping or overlap.
- Evidence: partial evidence hash remains `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`); no live evidence was promoted.
- Commit: `058047b89536e820f4bfa197dcf06555cdb55793`.
- Next: checkpoint this asset, then continue independent submission preparation while the live repair capture, immutable Docker images/daemon evidence, credentials, license, deployment, video, URLs, and owner submission actions remain open.

### 2026-07-15 22:11 +09:00 — Concrete Docker supervisor and non-live dynamic gates verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint implements and verifies a concrete Docker lifecycle boundary without wiring a signed live executor, running Docker, contacting OpenAI, or promoting evidence.
- Ownership and execution: Docker v2 derives names and exact labels from request SHA-256, run ID, and a 128-bit nonce. Creation output is only a candidate until independent ID/name/label inspection; all later actions use captured IDs, foreign or ambiguous IDs are never deleted, name preemption fails, and cleanup requires ID plus binding/role absence.
- Closed supervisor configuration: workspace preparation cannot inject a plan. The provider supplies a sealed worker image, verifier/egress image IDs, five request-limit maxima, run identity, repository root, ownership nonce, and external secret paths; the driver builds and revalidates the plan internally before any workspace or Docker operation.
- Resource controls: memory+swap are equal for worker, verifier, egress, and the TLS probe; regular-file writes inherit an `fsize` ceiling; Docker uses the local log driver with the admitted byte ceiling and one file; PID, CPU-rate, tmpfs, output, and execution-deadline limits are fixed and independently inspected. Cumulative CPU-time enforcement remains `UNAVAILABLE_STATIC_DRIVER` and blocks live work.
- Dynamic prerequisites: `worker:verify` owns the internal network and observes worker/verifier isolation, reconstruction, cgroup-v2 membership, process-tree teardown, and dual resource absence. `egress:verify` separately owns internal/outbound networks, proxy, ephemeral secrets, and a non-root TLS 1.3 probe. The probe writes no HTTP; proxy outbound traffic is explicitly `NOT_MEASURED`.
- CLI and observer controls: both dynamic gates require `POLICYTWIN_DOCKER_CLI` as a canonical absolute path and force the platform-local daemon through a closed environment. Supervisor observation closes images, users, entrypoints, working directories, environments, namespaces, devices, security controls, memory+swap, ulimits, log rotation, bind propagation, tmpfs, ports, and required network membership/aliases.
- Regression evidence: 163 unit assertions, the serial integration suite, 22 evals, 3 production Chrome E2E tests, lint, strict typecheck, production build, 321-file clean-copy replay, and 321-file/293-text-file plus Git-history security scan pass. Fake-daemon tests cover normal flow, command/daemon substitution, name preemption, partial and foreign creation, unexpected endpoints, runtime drift, resource-cap drift, sealed image/maxima, and cleanup.
- Full gate: final `pnpm verify` exits 1 after completing through build because the owner-selected project `LICENSE` is absent and `submission:check` has exactly 30 non-final requirements. Every implemented gate passes. `verify:live` fails before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`.
- Dynamic truth: `container:verify`, `worker:verify`, and `egress:verify` fail before Docker at the unset immutable Node base. Worker/egress reports retain `dockerInvoked:false`, `dynamicIsolationVerified:false`, `liveCodexExecuted:false`, and `releaseReady:false`; no proxy TLS probe has actually run.
- Independent review: plan injection, PATH/remote-daemon substitution, foreign resource deletion, incomplete inspect fields, init-PID-only teardown, lifecycle deadline wording, proxy-outbound overclaim, stale submission copy, unbounded swap/file/log surfaces, and unsealed worker image/maxima were corrected and regression-tested. Post-fix code/security and truthfulness reviews report no remaining P0/P1/P2.
- Build-input hashes: worker `2cd3596faf26e299eb65384731b73725823e3431793c36fd9a1ac7cc9aca61dd`; verifier `90ecd378704730365b6ef1a54032cd016d1d637dab3c89a876f2b53f34d773c9`; egress `9a84ece274bb7d5518fca27423c62f23f88c436178ee25fedacf0ba3d4c3ed96`.
- Evidence: partial evidence hash remains `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`); no live proof was generated.
- Commit: `5d9182ca96da7cb093efe1d8c03fd28eb2f8d1fb`.
- Next: continue the remaining independent M7/M9 work from the committed static/fake-daemon boundary; real-Docker and live evidence remain blocked by immutable images, cumulative CPU enforcement, and credentials.

### 2026-07-15 18:20 +09:00 — Static supervisor lifecycle and Responses-only egress boundary verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint prepares a supervisor-owned lifecycle, worker capability authentication, and the egress reverse broker without constructing the SDK, running Docker, contacting OpenAI, or promoting evidence
- Credential boundary: the worker SDK child has an exact environment and uses official command-backed provider authentication to read only a canonical 256-bit per-run capability; the reusable provider credential and TLS private key are permitted only as external read-only proxy mounts
- Egress boundary: a TLS 1.3 entrypoint and non-root UID 10003 image accept only origin-form JSON `POST /v1/responses`, reject CONNECT/absolute/query targets, unsafe/duplicate headers, transfer framing, redirects, compression, non-public DNS sets, expired/wrong/exhausted tokens, and oversized bodies/responses; the upstream connection pins one public IPv4 while preserving `api.openai.com` SNI, certificate identity, and Host
- Availability controls: at most two upstream calls may be active; request/response sizes are 1 MiB/8 MiB, leases are at most 15 minutes/64 dispatched attempts, overall upstream time is 120 seconds, idle time is 15 seconds, and completed-client disconnects abort the upstream; malformed bodies do not consume the lease
- Worker boundary: the copied validate-only entrypoint checks the canonical RPC request, proxy token/CA/output mounts, non-root Linux runtime, and empty fixed `CODEX_HOME`, but can return only `VALIDATED_REQUEST_LIVE_DISABLED`; the host live factory remains rejecting
- Lifecycle boundary: validated requests are recursively frozen, immutable local image IDs and external secret locations are required, Docker create/start/wait/logs/stop/remove order plus failure cleanup order are fixed, aborts propagate, concurrent reuse rejects, and incomplete or timed-out cleanup rejects and permanently poisons that lifecycle instance; the driver remains a test seam rather than kernel attestation
- Truth boundary: schema v4 and every generated report retain `STATIC_PREPARED`, `dynamicIsolationVerified:false`, `liveCodexExecuted:false`, and `releaseReady:false`; driver cleanup booleans are not attestation and the lifecycle is not connected to the mTLS executor seam
- Verified: lint; strict typecheck; latest post-review unit run 127/127; integration 49/49; eval 22/22; production Chrome E2E 3/3; 309-file clean-copy replay; 309-file/281-text-file plus Git-history security scan; static four-image contract; demo reset/run; production build
- Full gate: `pnpm verify` completed with its then-current 126 unit assertions and passes every implemented code/static gate, failing only owner-selected `LICENSE` plus the exact 30-item non-final `submission:check`; the final lifecycle guard raised the latest isolated unit result to 127/127; `pnpm verify:live` fails before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`; `pnpm container:verify` and `pnpm worker:verify` fail before Docker at the unset immutable Node base
- Independent review: cleanup timeout, mutable-request TOCTOU, global lifecycle order, pre-dispatch lease use, upstream deadline/idle/concurrency, completed-client cancellation, and a stale dynamic-report hash were corrected and regression-tested; the refreshed fail-closed worker report carries all three current build-input hashes and no unresolved code P0/P1 remains
- Remaining dynamic risks: no concrete Docker executor, internal-network inspection, exact two-network proxy membership, unpublished-port observation, CA/leaf/key binding, restart-persistent lease count, immutable role image, cgroup/process-tree observation, real Codex header compatibility, DNS/TLS/OpenAI call, or signed live result exists
- Build-input hashes: worker `54038677448c74142cf3d2d9ac7d4b2a7ba984eef324b24b609ee4188df48ffd`; verifier `83d806fe056c6ef335fe2e7e8f6fa092cbb545eb342abee185977ac9e35e5b9c`; egress `0aabf75175b91fe9b5551d44ace5b66102bd2bee1743409a6f6f694de3300d1a`
- Evidence: partial evidence hash remains `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`); no new live proof was generated
- Commit: `4eb2673dc68bd3c36842e90b99bae08c36ef3b8e`
- Next: implement the concrete supervisor-owned Docker executor and a separate dynamic egress gate without weakening host live rejection

### 2026-07-15 16:43 +09:00 — Static split worker/verifier isolation boundary verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint prepares the exact non-root worker and credential-free verifier images and launch contracts, not dynamic kernel isolation, an OS executor, OpenAI-only egress, live Codex repair, deployment, or submission
- Container split: added separate worker UID 10001 and verifier UID 10002 Dockerfiles with read-only roots, no bundled fixture or expected-fixed tree, fixed preflight entrypoints, deterministic Docker build-input hashes, and no externally resolved mutable Dockerfile frontend
- Runtime plan: added bare-local-image-ID enforcement, read-only canonical baseline, exactly two writable repair overlays, bounded request/response/token mounts, internal-only worker network, dropped capabilities, no-new-privileges, PID/memory/CPU/stop limits, bounded tmpfs, and a separate `network=none` verifier with fixed shell-free commands
- Verification binding: reconstructs the verification tree from the exact canonical baseline plus two repair overlay contents and records copied paths plus separate baseline, overlay, and reconstructed SHA-256 bindings
- Path hardening: linked or non-directory repository/`.tmp`/`worker-runs` parents are rejected before run writes; the new direct child is physically revalidated; deletion repeats that validation; a junction cleanup regression test proves an external sentinel is preserved
- Truth boundary: schema v3 keeps web/worker/verifier at `STATIC_PREPARED`, `dynamicVerified:false`, `liveCodexExecuted:false`, and egress proxy `NOT_IMPLEMENTED`; `worker:verify` records no dynamic/live promotion when prerequisites are absent
- Verified: lint; strict typecheck; 113/113 unit; 46/46 integration; 22/22 eval; 3/3 production Chrome E2E; 295-file clean-copy replay; 295-file/268-text-file plus Git-history security scan; demo reset/run; static split-container contract; production build
- Full gate: `pnpm verify` passes every implemented code/static gate and fails only owner-selected `LICENSE` plus the exact 30-item non-final `submission:check`; `pnpm worker:verify` and `pnpm container:verify` fail before Docker at the unset immutable Node base; `pnpm verify:live` fails before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`
- Independent review: the final linked-parent P1 and cleanup-test P2 were corrected; post-fix read-only review reports no remaining P0/P1/P2
- Evidence: worker build-input SHA-256 `b19694b91a07344e19ec7075e187a97f28792493cdb288617c234ae33280c52f`; verifier build-input SHA-256 `83d806fe056c6ef335fe2e7e8f6fa092cbb545eb342abee185977ac9e35e5b9c`; partial evidence hash remains `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`)
- Commit: `702fd1654cb33ccc42da9c4ebdcbb6ee47c5ff72`
- Next: commit this checkpoint, then implement the supervisor-owned OS executor and OpenAI-only egress proxy boundary without enabling host-process live SDK work; immutable base acquisition requires a separately approved registry scope

### 2026-07-15 13:51 +09:00 — Real mTLS supervisor transport and durable replay boundary verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint completes real authenticated transport and supervisor admission/lifecycle controls, not the OS-isolated Codex worker, live repair, dynamic container, deployment, or submission
- Transport change: added TLS 1.3-only mutual authentication with configured CA material, standard server-name verification, exact client/server SHA-256 certificate pins, fixed `policytwin-worker-rpc/1` ALPN, and one bounded `PTQ1`/`PTS1` canonical frame per connection
- Supervisor change: added pre-body 1 MiB/4 MiB declarations, canonical UTF-8/JSON parsing, one active repair, deadline/disconnect/shutdown cancellation, pre-handshake socket tracking, executor-settlement waiting, close-versus-replay-admission rejection, server-owned Ed25519 response construction, and generic diagnostics
- Replay change: added transactional SQLite replay state with absolute non-memory paths, `BEGIN IMMEDIATE`, unique request-ID and nonce constraints, capacity/expiry pruning, full synchronous durability, and reopen verification; the bounded in-memory store is explicitly ephemeral
- Test change: added ephemeral OpenSSL certificate generation with no committed private keys; 15 focused mTLS/replay assertions cover trusted success-to-signed-FAIL, missing/wrong/untrusted identity, name/pin/ALPN, oversized/partial/trailing frames, replay, concurrency, timeout, shutdown, pre-handshake sockets, admission races, durable reopen, path rejection, capacity, and expiry
- Harness recovery: integration tests now run serially because evidence-package tests intentionally rebuild shared `dist`/fixture/evidence outputs; the pre-existing live-attestation test now uses its fixed clock for the missing-trust assertion
- Verified: lint; strict typecheck; 105/105 unit; 46/46 integration; 22/22 eval; 3/3 production Chrome E2E; 286-file clean-copy replay; 261-text-file plus Git-history security scan; demo reset/run; static container contract; production build; truthful fail-closed submission drafts
- Full gate: `pnpm verify` passes every implemented code/static gate and fails only owner-selected `LICENSE` plus the exact 30-item non-final `submission:check`; `pnpm verify:live` fails at missing `OPENAI_API_KEY` and `CODEX_MODEL`; `pnpm container:verify` fails at the unset immutable Node image digest
- Independent audit: no P0/P1 remains in the mTLS/replay checkpoint; it explicitly confirms that worker image, fixture-only mounts, egress proxy, immutable verifier, kernel resource/process-tree enforcement, certificate operations, and live SDK evidence are still missing
- Evidence: partial evidence hash remains `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`); local integration certificates and signing keys are test-only and temporary
- Commit: `b7b3cf94b722a7bc267d0565b43522d73b1527f9`
- Next: implement a separately built non-privileged worker runtime, fixture-only repair mount, OpenAI-only egress proxy contract, and credential-free `--network=none` immutable verification compartment without enabling host live execution

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

`Verify and commit this ledger update, then version the candidate CPU proof with the missing global event transcript and failure/containment evidence without enabling PASS or a live claim.`

## Pause handoff

Fill before `/goal pause` or any handoff.

- Why paused: `not paused; the factory-only Worker RPC v2 transport capability and private TLS-input snapshot are implemented, serially verified, independently reviewed, and committed; only the post-checkpoint ledger commit remains`
- Exact current state: `the concrete v2 TLS factory alone can create a frozen WeakSet-admitted transport; no arbitrary registrar exists; the generic supervisor still refuses PASS and the live gate remains closed because global event and failure/containment evidence plus a real Linux controller are absent`
- Last successful command: `the 06:47 post-snapshot pnpm verify sequence passed every implemented offline gate, including 217 unit, 57 integration, 22 eval, 3 browser, 332-file clean-copy, 332-file/303-text-file security, schema-v7 static container checks, and production build; only LICENSE and the exact 29-item submission gate failed as expected`
- Current failing command: `pnpm container:verify, pnpm worker:verify, and pnpm egress:verify fail before Docker at the unset immutable Node base; pnpm verify:live fails before network at missing OPENAI_API_KEY and CODEX_MODEL`
- Uncommitted files: `only this post-checkpoint PROGRESS.md ledger update before its documentation commit`
- Safe resume command/action: `verify and commit this ledger update, then implement the versioned global event transcript and failure/containment evidence contract while preserving FAIL-only admission`
- One owner action, if any: `none`

## Final completion record

Do not fill until the end.

- Engineering definition of done: `NOT_VERIFIED`
- `pnpm verify`: `FAIL_EXPECTED — final current-worktree sequence completes through build; all implemented gates pass and only owner LICENSE plus the exact 29-item non-final submission gate fail`
- `pnpm verify:live`: `FAIL — host credentials, immutable role images, real-Docker/cumulative-CPU/outbound observations, fresh GPT/Codex evidence, and live wiring are absent; concrete driver and dynamic gate contracts exist only as static/fake-daemon evidence`
- Production deployment: `NOT_VERIFIED`
- Public repository: `NOT_VERIFIED`
- Demo video: `NOT_VERIFIED`
- Challenge submission: `NOT_VERIFIED`
- Final evidence hash: `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`, not final live proof)
- Final commit/tag: `UNSET`
- Final truthful state: `IN_PROGRESS`
