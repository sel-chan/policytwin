# PROGRESS.md — PolicyTwin Goal Ledger

> Codex must keep this file current. Update it at the beginning of a run, after every milestone checkpoint, before pausing, and before declaring completion. Never record a pass without command or artifact evidence.

## Current status

- Overall state: `IN_PROGRESS`
- Current milestone: `M2/M9 — single-source PolicyIR Zod and Structured Outputs schema verified offline`
- Goal state: `IN_PROGRESS`
- Submission state: `DRAFT_NOT_READY`
- Last updated: `2026-07-17 12:28 +09:00`
- Latest checkpoint commit: `ccc8c00236d02bf8beda97a5424a22b979bae359`
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
| pnpm | 11.9.0 | `pnpm --version` | Available globally; rechecked at this continuation |
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
| M2 PolicyIR and interpretation | IN_PROGRESS | one strict Zod structure now drives runtime admission, deterministic checked-in JSON Schema, and the official-helper Responses projection; exact request/source/golden semantic checks, bounded cancellation/retry, and offline tests pass | pending | credentials and a fresh GPT-5.6 response/evidence remain; live provider acceptance is not claimed |
| M3 Decision Queue and versioning | PASS | anonymous-session-isolated SQLite v1-v5, closed replay-safe HTTP writes, one-card Decision Queue, revisit, golden contradiction, restart, expiry, and production Chrome checks pass | `16c06fc` | authenticated multi-user identity and distributed coordination remain M9 release work, not an M3 gate |
| M4 Compiler and OPA | PASS | official OPA 1.18.2 strict compile/evaluation, deterministic compiler, invalid-input rejection, 41/41 accepted cases, and compilation status UI pass | pending | none for the milestone gate; live package still depends on later milestones |
| M5 Case generation/conflict/mutation | PASS | 41 unique traceable cases, required boundaries/overlaps, 3 conflicts, 36 contrasts, 44/47 killed reference mutants (93.62%), and Case Lab UI pass | pending | mutation provenance remains explicitly reference-based rather than OPA |
| M6 Differential runner and drift UX | PASS | full 41-record report has 25 matches, 16 classified drifts, 0 errors, D01–D03 witnesses, evidence contract validation, and Integration/Drift UI | pending | actual post-Codex evidence remains M7 work |
| M7 Codex repair and review | IN_PROGRESS | pinned SDK-compatible phase adapter, signed v1 RPC client, real TLS 1.3 mTLS transport, durable replay rejection, Worker RPC v2 CPU evidence schema v2, and schema-v15 lifecycle-v3 Docker/helper construction plus exact helper-artifact identity binding pass offline contracts | `447f077` | no immutable helper artifact has been built, installed, or run on Linux Docker/cgroup v2; finalized-result issuance, v2 PASS signing, fresh SDK repair, zero live post-repair drift, live review, and signed live evidence remain absent |
| M8 Proof, impact, and polish | IN_PROGRESS | reference-bound Proof UI, blocked 14-to-30 v5 draft, semantic mismatch guard, deterministic guarded 38-file USTAR download, responsive six-view navigation, seven inspected product screenshots plus a reviewed architecture asset, and 3/3 production Chrome E2E checks pass | `5fecdde` | live signer/receipts, actual Codex proof, and the truthful live Codex repair capture remain |
| M9 Security, reproducibility, deployment | IN_PROGRESS | schema-v15 helper-artifact/lifecycle-v3 boundaries, bounded evidence cache, and single-source PolicyIR structure pass 326 unit, 57 integration, 22 eval, static container, 340-text-file security, and 370-file clean-copy gates | pending | shared public admission/rate limiting, digest-pinned compiler/Node/role images, Docker daemon, artifact-image/host-install/runtime proof, Linux cgroup-v2 execution, cross-UID barrier/FD proof, dynamic PASS, measured upstream behavior, signed evidence, owner license, and deployment remain |
| M10 Submission package | IN_PROGRESS | official rules/dates/track/requirements verified; reproducible 1800x1200 architecture SVG/PNG reviewed; generated draft remains fail-closed with 29 unmet requirements | `130c355` | live Codex repair screenshot, owner declarations/license, live/repo/video/submission URLs, final media/form, and confirmation remain unavailable |

## Current checkpoint

### Objective

Close the explicit D-010 structural-contract divergence risk by defining one strict `PolicyIR` Zod structure, using its model-output projection through the official OpenAI Zod helper, deriving the checked-in JSON Schema deterministically, and requiring runtime structural admission before the existing semantic validator. Cross-reference, field/value compatibility, unique identity, patch-target, golden-case, and exact input-schema checks remain deterministic application semantics rather than being weakened into model-schema claims.

### Starting failing condition

Starting HEAD is clean `main` at ledger commit `8df0c311a1b1e8a2b301d0a4df68fa330cb783a6`. The current baseline passes 322/322 unit tests. Zod 4.4.3 validates only interpreter inputs and the Responses envelope; `schemas/policy-ir.v1.schema.json` is handwritten, `src/openai/interpreter.ts` mutates and strictifies that file independently, and `src/policy-ir/validate.ts` separately implements runtime shape plus semantic checks. No deterministic freshness check proves those three surfaces agree. The approved official-document scope was used to re-fetch the current Structured Outputs guide and `/v1/responses` OpenAPI description: the guide recommends native Zod support or schema auto-generation to avoid type/schema divergence, keeps Responses `text.format` with `type: json_schema` and `strict: true`, and still requires application-side semantic guardrails. Docker Desktop remains stopped and all live/API settings remain unset; no API/model call occurred.

### Planned actions

- [x] Re-read all required control documents; confirm clean `main`, 322/322 unit baseline, stopped Docker service/daemon, unset live settings, current submission failures, and the exact Zod/JSON Schema/runtime divergence risk.
- [x] Re-check the official OpenAI Structured Outputs guide and Responses API schema within the already approved official-document scope; record only the constraints relevant to this checkpoint.
- [x] Add failing tests proving the checked-in schema is not generated from a shared runtime contract and that provider/runtime structural acceptance has no common Zod source.
- [x] Implement one dependency-free-of-new-packages Zod structure contract, deterministic full JSON Schema rendering/freshness gate, official `zodTextFormat` Responses projection, and runtime structural admission without weakening semantic issue coverage.
- [x] Run focused tests, lint, typecheck, full unit/integration/eval/browser/build/security/clean-copy/static-container gates, and expected fail-closed live/submission commands.
- [x] Inspect generated schema, request schema, reports, screenshots, and final diff; update D-048, README/architecture/limitations/submission wording, and this ledger.
- [ ] Commit the verified checkpoint on current `main`, then record the commit hash in this ledger.

This checkpoint may prove structural single-sourcing and deterministic schema freshness only. It cannot prove live provider acceptance, GPT-5.6 semantic correctness, fresh interpretation, Codex work, deployment, or submission; `verify:live` and the evidence package must remain fail closed.

### Completion evidence

- Starting HEAD: clean `main` at `8df0c311a1b1e8a2b301d0a4df68fa330cb783a6`; implementation parent `ccc8c00236d02bf8beda97a5424a22b979bae359`.
- Initial environment: Docker CLI 29.1.5 cannot reach `dockerDesktopLinuxEngine`; `com.docker.service` is stopped/manual; `OPENAI_API_KEY`, `CODEX_MODEL`, `POLICYTWIN_DOCKER_CLI`, `POLICYTWIN_RUN_TOKEN`, `POLICYTWIN_PUBLIC_ORIGIN`, `POLICYTWIN_NODE_BASE_IMAGE`, and `POLICYTWIN_NATIVE_HELPER_BUILDER_IMAGE` are unset.
- Official source check: current OpenAI Structured Outputs documentation and the Responses OpenAPI entry were fetched on 2026-07-17 under the recorded official-document approval. They confirm strict `text.format` JSON Schema, native Zod support, and the recommendation to prevent schema/type divergence through Zod or automatic generation. No broader network scope is inferred.
- Failing condition reproduced: after registering `tests/unit/policy-ir-zod-schema.test.mjs`, the focused run failed with `ERR_MODULE_NOT_FOUND` for the absent common contract. After initial implementation, exact freshness intentionally failed against the handwritten schema. The first full eval then exposed a stale hard-coded `$defs` assumption and the external `ambiguity.v1` reference dependency; explicit Zod schema IDs restored stable `$defs/ambiguity`, and the eval now follows local references.
- Implementation: `src/policy-ir/zod-schema.ts` defines strict reusable clauses, predicates, rules, patches, examples, ambiguities, metadata, runtime PolicyIR, and model-output contracts. `zodTextFormat` produces the strict Responses `text.format`; the interpreter locally admits the returned JSON before removing nullable selections and injecting trusted server fields. Runtime validation first runs the same structural contract, then preserves the existing deterministic semantic checks and issue codes. `pnpm schema:write` generates the checked-in draft-2020-12 schema and `pnpm schema:check` plus unit tests require byte-exact freshness.
- Focused evidence: 16/16 PolicyIR schema/validation/interpreter tests pass. The new structural gate rejects duplicate trace entries and model-provided `metadata`/`inputSchema`; the request schema is byte-structure-equal to the official-helper projection, every model-owned object is strict with all properties required, and `selectedOptionId` is required nullable only at that boundary.
- Regression evidence: lint, strict typecheck, `pnpm schema:check`, 326/326 unit, 57/57 integration, 22/22 eval, 3/3 production Chrome, Next.js build, schema-v15 static container, 340-text-file plus Git-history security, and 370-file clean-copy reproduction pass. `pnpm verify` completed every implemented gate and remained fail-closed only for the absent owner `LICENSE` and exact 29-item submission gate.
- Container evidence: final build inputs are worker `b802e6bd…`, verifier `23cb93c6…`, egress `01040160…`, and helper `520e550d…`. Static inspection passes; helper/web/worker/egress dynamic gates all record `dockerInvoked:false` or equivalent and fail before Docker at the unset immutable builder/base/helper identities.
- External truth boundary: `pnpm verify:live` fails before dynamic gates or network at missing `OPENAI_API_KEY` and `CODEX_MODEL`. No GPT-5.6 response, provider acceptance, Codex SDK repair, Docker/Linux runtime, deployment, upload, or submission occurred. `pnpm submission:check` still reports exactly 29 unmet requirements.

## Quality gates

Record latest actual result.

| Gate | Status | Command | Evidence/artifact | Last run |
|---|---|---|---|---|
| Document contract validation | PASS | PowerShell manifest/hash/fence/milestone validator | 10 manifest entries and 11 root Markdown files | 2026-07-14 11:50 +09:00 |
| Install/lockfile | PASS | `pnpm install --offline --frozen-lockfile` with `npm_config_store_dir=C:\tmp\policytwin-pnpm-store-fresh` | exact 469-entry lock graph passes supply-chain policy; root and clean-copy dependency trees hydrate fully from the fresh NTFS store | 2026-07-17 09:12 +09:00 |
| Lint | PASS | `pnpm lint` | shared PolicyIR schema/generator, interpreter, validation, schema-v15 packaging, and repository static checks pass | 2026-07-17 12:28 +09:00 |
| Typecheck | PASS | `pnpm typecheck` | strict TypeScript 6.0.3 covers the shared Zod recursion/projections, application, sealed helper lifecycle, v1/v2 RPC, and policy-engine boundaries | 2026-07-17 12:28 +09:00 |
| Native helper local build | PASS_LOCAL_ONLY | `pnpm helper:build:local` | repeated compilation remains byte-identical at 841,656-byte AMD64 static PIE with SHA-256 `906214d0489875ebbc718d934397fb2e43b00b5af825391c247b1efb112abdef`; compiler is explicitly unpinned, stale success evidence is removed on failure, and no image/runtime claim follows | 2026-07-17 10:54 +09:00 |
| Unit tests | PASS | `pnpm test` | 326/326 pass, including exact schema freshness, runtime/model projection separation, all-object strictness, duplicate trace rejection, and existing archive/Docker/cgroup/RPC coverage | 2026-07-17 12:28 +09:00 |
| Integration tests | PASS | `pnpm test:integration` | 57/57 serial fixture, mTLS v1/v2, OPA, evidence, persistence, and exact partial/live archive-expiry assertions pass | 2026-07-17 12:28 +09:00 |
| Browser tests | PASS | `pnpm test:e2e` | 3/3 production standalone Chrome tests; six views, complete archive download, v1-v5 writes, isolation/capacity/expiry, focus, and 390px layout pass | 2026-07-17 12:28 +09:00 |
| Prompt/eval suite | PASS | `pnpm eval` | 22/22 offline/recorded evals pass, including stable external ambiguity-schema reference and generated executable-union checks | 2026-07-17 12:28 +09:00 |
| Production build | PASS | `pnpm build` | Next.js 16 Turbopack standalone build and strict TypeScript pass with the shared schema imported through runtime validation and server interpretation | 2026-07-17 12:28 +09:00 |
| Offline full verification | FAIL_EXPECTED | `pnpm verify` | every implemented gate passes: 326 unit, 57 integration, 22 eval, 3 browser, 370-file clean copy, 340-text-file security plus Git history, static container, demo, and build; exit 1 is only owner `LICENSE` plus exact 29-item submission gate | 2026-07-17 12:28 +09:00 |
| Fresh live integration | FAIL | `pnpm verify:live` | fail-closed before dynamic gates/network at missing `OPENAI_API_KEY` and `CODEX_MODEL`; no model or Codex call occurred | 2026-07-17 12:28 +09:00 |
| Clean-copy reproduction | PASS | `pnpm clean:check` | 370 source files; frozen offline install, lint, typecheck, 326 unit, 57 integration, 22 eval, build, 3 browser, demo replay, and evidence generation pass | 2026-07-17 12:28 +09:00 |
| Static container contract | PASS | `pnpm container:check` | schema-v15 validates worker `b802e6bd…`, verifier `23cb93c6…`, egress `01040160…`, and helper `520e550d…` inputs while all runtime/finalization/PASS claims remain false | 2026-07-17 12:28 +09:00 |
| Dynamic helper artifact | FAIL | `pnpm helper:verify` | immutable builder image is unset; verifier records `dockerInvoked:false`, no image/binary identity, and all install/cgroup/signing claims false | 2026-07-17 12:28 +09:00 |
| Dynamic container health | FAIL | `pnpm container:verify` | immutable Node 22.22.2 base is unset, so Docker build/runtime/SQLite restart checks did not run | 2026-07-17 12:28 +09:00 |
| Dynamic worker/verifier smoke | FAIL | `pnpm worker:verify` | final role hashes match; fails before Docker only at the unset immutable Node base with no runtime evidence | 2026-07-17 12:28 +09:00 |
| Dynamic TLS-only egress smoke | FAIL | `pnpm egress:verify` | final role hashes match; fails before Docker at the unset immutable Node base and sealed helper artifact identities; outbound remains `NOT_MEASURED` | 2026-07-17 12:28 +09:00 |
| Secret scan | PASS | credential-shaped `rg` scan | no matches | 2026-07-14 08:20 +09:00 |
| Dependency/license review | FAIL | `pnpm license:check`; prior `pnpm audit --prod --json` | 6 production dependencies inventoried, audit 0 vulnerabilities, NOTICE present; owner-selected project LICENSE absent with `OWNER_DECISION_REQUIRED` | 2026-07-17 12:28 +09:00 |
| Security review | PASS | `pnpm security:check` | 340 text files plus Git history scanned; fixed local-compiler and pinned-Docker child-process boundaries reviewed; no findings | 2026-07-17 12:28 +09:00 |
| Submission consistency | FAIL | `pnpm submission:check` | exactly 29 unmet requirements; single-source-schema notes remain non-final and no fabricated URL, video, license, confirmation, or Codex capture exists | 2026-07-17 12:28 +09:00 |

## Product proof metrics

Never fill from estimates.

| Metric | Target | Current actual | Evidence |
|---|---:|---:|---|
| Structured-output schema pass | 100% | 100% shared offline structural contract and exact request projection; live provider result UNSET | `tests/unit/policy-ir-zod-schema.test.mjs`, `tests/unit/openai-interpreter.test.mjs` |
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

### 2026-07-17 11:35 +09:00 — Content-bound evidence archive cache verified offline

- Milestones: M8 and M9 remain `IN_PROGRESS`; this checkpoint closes repeated same-process semantic-validation/archive-construction work for unchanged proof downloads without claiming client throttling, shared admission control, live evidence, deployment, or release readiness.
- Cache contract: each request rereads the exact bounded 38-file package, then hashes every length-delimited filename/content byte plus trusted live keys, trusted OPA identities, and explicit freshness settings. One active build is allowed; one completed archive may be reused for at most 15 seconds. Different content/policy, TTL expiry, live-attestation expiry, invalid metadata/hash/size, or builder failure rebuilds or fails closed.
- Integrity and memory: cache entries must match their declared archive SHA-256, stay below the exact USTAR overhead cap over the existing 16 MiB aggregate input limit, preserve the exact evidence entry set, and return separate buffer/name-array copies. Failures are not cached and live expiry is never extended. HTTP remains `no-store`.
- Route behavior: `/api/evidence/archive` preserves bounded reads, semantic/sensitive-content validation on misses, deterministic bytes, semantic and archive response hashes, filename, and truthful 503 behavior. Disk reads and content hashing remain per request by design.
- Verification: lint, strict typecheck, 322/322 unit, 57/57 integration, 22/22 eval, 3/3 browser, 337-text-file security plus Git history, 367-file clean-copy replay, static container, demo, and production Next.js build pass. `pnpm verify` exits only for the owner-selected `LICENSE` and exact 29-item non-final submission gate.
- Dynamic boundary: `verify:live` stops before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`; helper, web, worker, and egress gates stop before Docker at unset immutable identities. No model call, Codex repair, Docker workload, live signer, deployment, publication, or submission occurred.
- Build-input bindings: worker `9afd2ef3d42ff6ef9da8159c7ee58fa7c5134c73ebcc75b7885d2527fc1b1ef3`; verifier `f688fa01fc35b377c91578e404506eb47ccf6a2eaf6c2c4a3f2162856710c3a3`; egress `ae096b8fdebedb8d6d998175f7681f6db1d9229d8c0d2f5d32a616c13eebcbfc`; helper `2c4b74f1126fb25244f449dd9ded6ad166c01d678de138bfc5b3337b0aea2d2d`.
- Documentation: D-047, README, threat model, limitations, demo runbook, submission draft, and this ledger state the cache's exact guarantees and process-local limitation. The regenerated Policy Studio screenshot was directly inspected with no visible layout defect.
- Checkpoint commit: `ccc8c00236d02bf8beda97a5424a22b979bae359` (`feat: bound evidence archive regeneration`).
- Next: with explicit Docker registry scope and a running local Linux daemon, select reviewed digest-pinned compiler and Node bases, build/discover/pin the helper and role identities, then run artifact, web, worker, egress, and private Linux cgroup-v2 failure-injection gates. Add shared edge/admission rate limits before a public multi-replica deployment.

### 2026-07-17 10:54 +09:00 — Schema-v15 native-helper artifact and lifecycle-v3 identity checkpoint

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint packages and binds the helper artifact contract without claiming an immutable image build, host installation, cgroup runtime, finalization, PASS, or live work.
- Artifact recipe: `Dockerfile.cgroup-helper` requires an externally selected digest-pinned builder, downloads or installs nothing, compiles stdin with fixed strict C17/static-PIE hardening arguments, and copies one root-owned `0555` file into `scratch`. Static checks hash the fixed source/build inputs and reject Dockerfile weakening.
- Binary validation: direct ELF parsing requires little-endian AMD64 `ET_DYN`, an executable load segment, no interpreter, no `DT_NEEDED`, a declared non-executable GNU stack, and a 4 MiB limit. Docker tar extraction requires the exact path, regular type, UID/GID `0:0`, mode `0555`, and a valid header checksum.
- Local evidence: `pnpm helper:build:local` performs two builds per invocation. Two consecutive invocations produced four byte-identical 841,656-byte static PIE files with SHA-256 `906214d0489875ebbc718d934397fb2e43b00b5af825391c247b1efb112abdef`. The WSL compiler is not pinned, so the report remains `PASS_LOCAL_TOOLCHAIN_NOT_IMAGE_BOUND` with image/install/cgroup/signing claims false. A Windows `0555` overwrite `EPERM` exposed an idempotency defect; deleting the old ignored temporary binary before replacement fixed it, and consecutive reruns pass.
- Sealed authority: container schema v15 and supervisor lifecycle v3 bind helper artifact image, source, build-input, and binary hashes. The private Docker owner snapshots the sealed binary hash; the Docker/cgroup adapter rejects any helper client whose same-FD executable hash differs. `verify:live` now requires the helper artifact gate before worker and egress gates and rejects stale or overclaiming helper reports.
- Dynamic boundary: `pnpm helper:verify` uses `--pull=false` and `--network=none`, never starts the helper, and compares extracted image/binary identities with the contract. It currently fails before Docker because the immutable builder is unset. Web/worker gates fail at the unset immutable Node base; egress also requires the sealed helper identities. `verify:live` stops before all dynamic gates and network at missing `OPENAI_API_KEY` and `CODEX_MODEL`.
- Final-review recovery: a new regression first reproduced that fully pinned helper identities made the offline static gate fail. Static admission now permits only all-unset, pinned-builder/bootstrap, or fully pinned builder/image/binary states, preserving live-gate compatibility without promoting runtime claims. A second regression requires failed local compilation to remove stale success evidence.
- Verification: 315/315 unit, 57/57 integration, 22/22 eval, 3/3 browser, 335-text-file security plus Git history, 365-file clean-copy replay, static container, demo, and production build pass. `pnpm verify` exits only for the owner-selected `LICENSE` and exact 29-item non-final submission gate.
- Build-input bindings: worker `91839f30c2ce65c6c93db149507143dc371170369daacb8bfe402b3e441988c6`; verifier `f688fa01fc35b377c91578e404506eb47ccf6a2eaf6c2c4a3f2162856710c3a3`; egress `dd359a1723d06218ecf6cd9a7966423f6adbd5265aac5392d8d3bdc1cc945a21`; helper `2c4b74f1126fb25244f449dd9ded6ad166c01d678de138bfc5b3337b0aea2d2d`; source `bfcd860b0e7771130b91ef89fc8762b11c87aadf48b128c0a9d2cc75dbad9e23`.
- Decision: D-046 records the artifact-only scratch image, local-versus-pinned proof distinction, lifecycle identity binding, and remaining dynamic requirements.
- Checkpoint commit: `447f077797fdaf712f1d75d4a632a4a5c2a1b847` (`feat: bind immutable native helper artifact`).
- Next: with explicit Docker registry scope and a running local Linux daemon, select already-reviewed digest-pinned compiler and Node bases, build/discover/pin the helper and role image IDs, then run artifact, web, worker, egress, and private Linux cgroup-v2 failure-injection gates. Do not add a finalized-result issuer or PASS signer before those gates pass.

### 2026-07-17 09:24 +09:00 — Schema-v14 sealed lifecycle and owned-network checkpoint verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint closes caller-shaped Docker configuration and ambiguous create cleanup paths but does not claim Linux/Docker/cgroup-v2 runtime execution.
- Construction: only one recursively frozen supervisor-factory lifecycle plan is admissible. The concrete owner creates and independently observes worker-internal and outbound networks, derives the three exact role plans internally, binds the prepared barrier identities, and rejects copied plans or caller-selected images, networks, mounts, environment, labels, limits, or run bindings.
- Ambiguous side effects: container and network create calls become unresolved before Docker invocation. Throws, timeouts, aborts, empty/malformed/foreign results, and exact-name zero matches remain sticky; an independent cleanup signal may acquire cleanup-only authority over one exact-name, exact-label observed resource, never execution authority. Completion requires container and network ID/name absence.
- Lifecycle order: held receipt -> first Docker observation -> helper bind and baseline capture -> second Docker observation -> cached-baseline admission -> barrier release -> serial sampling/containment -> quiescent final sample -> per-role Docker removal -> cgroup release -> helper stop -> owned-network removal. Emergency helper termination requires all roles and networks absent.
- Review: the final independent runtime-boundary and schema-v14 truth reviews reported no P0/P1. They confirmed that every dynamic/runtime/native-helper/finalized-evidence/PASS/live flag remains false and the generated submission notes do not overclaim.
- Verification: `pnpm verify` passed lint, typecheck, 309/309 unit, 57/57 integration, security over 329 text files plus Git history, schema-v14 static container, 358-file clean-copy replay, 22/22 eval, demo replay, 3/3 production Chrome, and the Next.js build. Its only failures were the owner-selected `LICENSE` and the exact 29-item non-final submission gate.
- Recovery evidence: the global pnpm store lacked complete offline tarballs, and an F: fresh store could not create pnpm links; a fresh NTFS store at `C:\tmp\policytwin-pnpm-store-fresh` hydrated 469 locked entries and made clean replay deterministic. A stale architecture PNG then failed 1/309 in the clean copy; regeneration produced the same SHA-256 from both repository and C: diagnostic paths. The submission eval was narrowed to accept only truthful `NOT_RUN` or checked `FAIL`, never PASS.
- Native compile: direct WSL source access failed because `/mnt/f` was unavailable; streaming the same repository source to WSL `cc` passed C17 with `-Wall -Wextra -Werror -Wpedantic`, fortify, stack protection, and PIE after removing the duplicate command-line `_GNU_SOURCE` definition already present in source.
- Dynamic fail-closed checks: `verify:live` stopped before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`; container, worker, and egress verification stopped before Docker at the unset immutable Node 22.22.2 base. No model call, Codex repair, Docker workload, deployment, or submission occurred.
- Build-input bindings: worker `06b8b69f4727e493fc760ac2aa9aeb082afdbeb7938a25efed2a595760b4123f`; verifier `a573de25b0e9d33214a6c2275051eaf282ff8bc3e8dc17106db07f251dc148d3`; egress `5f382c953b9a9c69262dcfefde99d40f5bd56632077fc26f7f84d0a9667207fd`.
- Decision: D-045 records sealed plan admission, owner-created networks, and cleanup-only ambiguous-create recovery. Checkpoint commit: `995b12c9bc9e1207ee5cda6b5bc31e55db47861e`.
- Next: package and digest-bind the native helper/supervisor and immutable role images, then exercise the exact schema-v14 construction on Linux Docker/cgroup v2 before adding any finalized-result issuer or PASS signer.

### 2026-07-17 08:42 +09:00 — Schema-v14 final gate replay resumed

- Milestone: M7/M9 (offline structural checkpoint; runtime and live gates remain closed)
- Current state: sealed factory-issued lifecycle plans, owner-created/observed Docker networks, cleanup-only recovery for ambiguous create side effects, and sticky exact-name uncertainty are implemented and documented as schema v14
- Verified before resume: 309/309 unit tests, 57/57 integration tests, typecheck, lint, static container contract, architecture generation, security/history scan, and two independent P0/P1 reviews passed
- In progress: replaying the authoritative offline gate with a freshly hydrated NTFS pnpm store; the latest clean-copy report installed, linted, and typechecked successfully but failed at its unit-test step, so no clean-copy or full-gate pass is claimed yet
- Truth boundary: dynamic Linux/Docker/cgroup-v2 runtime, native-helper runtime, finalized evidence issuance, PASS signing, live admission, fresh GPT-5.6/Codex work, deployment, and submission all remain false or unverified
- Next: diagnose the clean-copy unit failure, replay all offline gates, then record expected owner-license and live/container blockers before diff review and current-branch checkpoint commits

### 2026-07-16 20:00 +09:00 — Schema-v13 private Docker-owned Linux construction verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint implements the private runtime construction but deliberately does not claim that it has run on Linux Docker/cgroup v2 or produced live/final evidence.
- Construction: exact factory-issued role plans close the barrier command, numeric user, `/opt/policytwin` work directory, bind targets, tmpfs, labels, resources, and security options. A real private Docker CLI owner preflights names, creates without starting, independently verifies ownership/runtime identity, connects networks, starts held roles, issues single-use reobservation receipts, and confirms removal through inspect/list absence. The helper client now binds only those receipts and owns serial sample/freeze/kill/quiescence/release state with one session-global RAW clock. The private system adapter orders held receipt, Docker observation, helper bind, Docker reobservation, baseline, release, serial sampling, containment, quiescent final sample, Docker removal, cgroup release, and controller stop. A copied or structural adapter cannot enter the dedicated lifecycle.
- Native safety: the C helper rechecks pidfd/cgroup identity before actuation, uses SIGINT/SIGTERM/SIGHUP plus parent-death handling, and keeps pinned-pidfd containment independent from best-effort cgroup writes. Helper poison closes stdin first; SIGTERM/SIGKILL are allowed only after an opaque all-Docker-roles-absent receipt.
- Review and recovery: hostile read-only reviews found forged role plans/mounts, cross-run binding, pre-actuation identity drift, unsafe helper termination, partial-start cleanup, nonzero Docker wait, malformed create recovery, and concurrency risks; each was fixed. Final review found one P1 where a valid-but-foreign create stdout ID could orphan the actual exact-name container. Recovery now discards the candidate, admits only one independently ownership-verified exact-name ID for removal, and leaves a sticky unresolved-side-effect failure otherwise. Follow-up reports no P0/P1. The regression is registered in the authoritative unit suite.
- Verification: strict C17/PIE/fortify compilation passes. `pnpm verify` passes lint, TypeScript, 308/308 unit, 57/57 integration, 22/22 eval, schema-v13 static container, 358-file clean-copy, 329-text-file plus Git-history security, deterministic demo/evidence, 3/3 production Chrome, and Next.js production build; it exits 1 only for owner `LICENSE` and the exact 29-item non-final submission gate.
- Dynamic boundary: `container:verify`, `worker:verify`, and `egress:verify` fail before Docker because the immutable Node base is unset. `verify:live` fails before network because `OPENAI_API_KEY` and `CODEX_MODEL` are absent. WSL still exposes tmpfs rather than cgroup v2. No helper runtime transcript, cross-UID barrier/FD observation, containment measurement, finalized-result issuer, signer admission, PASS, fresh GPT/Codex work, deployment, or submission exists.
- Decision: D-044 records the private authority and cleanup design. Schema v13 marks only source construction facts true; every dynamic/runtime/final/PASS/live flag remains false.
- Commit: pending final diff review and current-branch checkpoint commit.
- Next: reproducibly build and digest-bind the helper/supervisor image, provide the immutable role base, and dynamically exercise the exact private construction on Linux Docker/cgroup v2 before adding any finalized-result issuer.

### 2026-07-16 16:44 +09:00 — Schema-v12 start barrier and native Linux helper boundary prepared

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint prepares a one-shot role barrier, a non-privileged lifecycle harness, and a native Linux helper boundary without connecting them to live admission or evidence signing.
- Implementation: the three role images bundle a strict barrier launcher while retaining their existing default entrypoints. Private host identities control held receipts and one-shot releases. A separate harness enforces the required stage order, serial samples, teardown-tail accounting, independent cleanup, and no-result fail-stop for unsettled cleanup. A fixed-frame C helper plus private client prepare RAW clock, pidfd, descriptor-pinned cgroup identity, freeze/kill/quiescence/release, and same-FD hash/exec boundaries.
- Truth boundary: schema v12 marks only implemented source/protocol/harness facts true. Docker barrier integration, native-helper runtime, Linux system adapter, finalized evidence, signer admission, Worker RPC v2 PASS, dynamic verification, and live Codex work remain false.
- Regression: acceptance reviews identified cross-UID receipt ownership, concurrent release, and publish-before-final-mode defects. Host-owned non-replaceable payload/commit slots, a `RELEASING` transition, publish-last rename, and sticky prepublish/nonce failure now pass 20/20 focused plus 300/300 full unit tests. The authoritative post-fix replay also passes 57/57 integration, 22/22 eval, 3/3 browser, 352-file clean-copy, security, static container, demo, and build, and exits 1 only for owner `LICENSE` plus the exact 29-item submission gate. The C helper still has only strict WSL compile evidence because that environment exposes tmpfs rather than cgroup v2. Final read-only re-review reports no remaining P0/P1.
- Build hermeticity: a full integration replay exposed global TypeScript 5.8.3 selection on Windows. Repository-local command shims now take precedence, the selected compiler is project TypeScript 6.0.3, and both focused and full fixture regressions pass.
- Expected blockers: immutable Node/role images and a Linux Docker/cgroup-v2 runtime are absent; dynamic gates fail before Docker. Live verification fails before network for missing model credentials. Owner LICENSE and exactly 29 final-submission requirements remain.
- Commit: `2668e9a22a8b0e3276c2f86963c04c47662b7a49` (`feat: prepare Linux CPU barrier and helper boundary`).
- Next: implement the separate Docker-owned Linux adapter and dynamically verify the barrier/helper lifecycle without enabling PASS early.

### 2026-07-16 12:17 +09:00 — Non-live cgroup observer hardened without live promotion

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint hardens only the role-local dynamic-smoke observer and advances the static container contract to schema v10.
- Identity/read boundary: only canonical `/docker/<id>` or final `docker-<id>.scope` memberships are accepted. A cgroup-v2 directory descriptor is bound to its canonical path, `/proc/self/fd` target, device, and inode in module-private `WeakMap` state. Follow-up reads are allowlisted, no-follow, fatal-UTF-8, and actually byte-bounded; forged/finalized handles fail closed.
- CPU/teardown semantics: `usage_usec` covers the full uint64 range as `bigint`; final values must not regress and budget/observation failure now enters the report failure set. Final sampling requires `cgroup.events populated=0` plus an empty direct process list. Subtree quiescence, initial-PID absence, original-cgroup release, Docker absence, and normal/recovery cleanup actions are separate sticky facts.
- Regression evidence: the new focused file first failed on missing observer-contract exports, then 6/6 focused cases passed. The authoritative suite passes 271/271 unit, 57/57 integration, 22/22 eval, 3/3 Chrome, schema-v10 static checks, 339-file clean-copy replay, 339-file/310-text-file plus Git-history security, demo reset/run, and production build.
- Review: one read-only gap review identified descendant, forged-path, precision, and TOCTOU risks. Independent final code review found unavailable `O_CLOEXEC`, report-status, and normal-cleanup stickiness defects; all were fixed, and its follow-up found no remaining P0/P1/P2. A separate truth review found and drove current-ledger and v2 claim-audit corrections; no live/Docker/OpenAI/Codex/signing overclaim remains.
- Expected blockers: `pnpm verify` exits 1 only for the owner-selected project `LICENSE` and exact 29-item submission gate. All three Docker gates fail before daemon use at the unset immutable Node base. `pnpm verify:live` fails before network at missing `OPENAI_API_KEY` and `CODEX_MODEL`.
- Truth boundary: no Linux cgroup filesystem, Docker daemon, raw monotonic clock, start barrier, containment action, OpenAI request, Codex repair, signing, deployment, or live proof occurred. The observer still takes a post-start baseline and is not the D-040 private live adapter or signer authorization.
- Commit: `c9802210b0d8b7bd26caed50fdc30aad744ad164` (`feat: harden non-live cgroup observation`).

### 2026-07-16 11:22 +09:00 — Synthetic CPU evidence v2 producer verified without live promotion

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint implements only the internal synthetic producer state machine and advances the static container contract to schema v9.
- Producer: one serialized queue snapshots request/system/Docker inputs, enforces egress-worker-verifier order, derives role/attempt/Docker/transcript/evidence hashes with `bigint`, and self-validates within-budget, non-CPU, controller, overage-contained, and containment-incomplete candidates through the canonical parser.
- Fail-closed behavior: missing overlap, counter regression, identity drift, first aggregate overage, failed or transient cleanup actions, missing release/process/controller-stop proof, post-bind invalidity, in-flight abort, aggregate overflow, duplicate identities, and non-advancing clocks cannot produce a signable success. Schema and parser now permit truthful incomplete cleanup when actions succeeded but release/stop proof failed, or actions failed but later cleanup recovered.
- Provenance boundary: the only accepted wrapper provenance is `SYNTHETIC_CONTRACT`; the module is absent from the root export and every frozen wrapper is `UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE` with `liveClaim:false` and `passSigningEligible:false`. Raw parser-valid evidence is not authorization. Generic Worker RPC v2 PASS signing and `verify:live` admission remain disabled.
- Verification: lint, strict typecheck, 265/265 unit, 57/57 integration, 22/22 eval, 3/3 production Chrome, build, schema-v9 static checks, 338-file clean-copy replay, and 338-file/309-text-file plus Git-history security pass. Final `pnpm verify` exits 1 only for owner-selected `LICENSE` and the exact 29-item non-final submission gate.
- Review: two independent truth/code reviews found and drove fixes for containment/schema mismatch, fake Linux provenance, transient cleanup recovery, observation/input getter TOCTOU, parser-failure reuse, overlap omission, stale handoff text, and overstrong signing language. The final latest-diff review reports no remaining P0/P1/P2 merge blocker.
- Dynamic truth: no Docker daemon, Linux raw clock/cgroup adapter, start barrier, bounded independent cleanup lifecycle, `cpu.stat` observation, containment, OpenAI request, Codex repair, deployment, or live proof occurred.
- Decision: D-040 requires a separate private-capability Linux adapter and dedicated finalize-after-cleanup lifecycle; neither the synthetic wrapper nor its raw parser-valid fixture is live provenance or signer authorization.
- Commit: `43b04198e72b3c5f6f9158e3a3a6f63716acfefd` (`feat: add synthetic CPU evidence producer`).

### 2026-07-16 09:29 +09:00 — Signed CPU evidence v2 contract verified offline

- Milestones: M7 and M9 remain `IN_PROGRESS`; this checkpoint versions the unreleased Worker RPC v2 CPU slot without enabling a live producer or PASS signer.
- Contract: one strict `CLOCK_MONOTONIC_RAW_NS` transcript binds all egress, worker, and verifier events; six closed outcomes distinguish within-budget success, non-CPU failure, pre-execution rejection, controller failure, contained overage, and incomplete containment.
- Binding: request, nonce, execution identity, image, policy, corpus, budget, role/Docker-or-attempt identity, transcript, result hash, and signature are cross-checked. Legacy proof v1, static fake, nullable evidence, key-purpose reuse, replay, and protocol downgrade cannot promote a result.
- Hardening: canonical hashing is bounded to 64 levels, 50,000 nodes, and 1,024 UTF-8 bytes per string; mTLS parses evidence before numeric comparisons; schema v2 closes failure stage/code and observed-role/Docker parity.
- Verification: lint, strict typecheck, 249/249 unit, 57/57 integration, 22/22 eval, 3/3 production Chrome, build, schema-v8 static checks, 336-file clean-copy replay, and 336-file/307-text-file plus Git-history security pass. `pnpm verify` exits 1 only for owner-selected `LICENSE` and the exact 29-item non-final submission gate.
- Truth boundary: no Docker daemon, Linux cgroup observation, containment, OpenAI request, Codex repair, deployment, or live proof occurred; generic Worker RPC v2 PASS signing remains disabled.
- Commits: implementation `c675662fc32f6d311a9624466bb6bc422c8bfb5d`; ledger `cbcf37cc5ae8553831b4ea69fbce99d21b52e97a`.

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
| Hosted worker restrictions | Medium | High | Keep final-result issuance and live admission disabled; package and dynamically verify the fixture-only private Docker/cgroup construction with hard limits and teardown receipts | Codex / open |
| Codex SDK/live adapter mismatch | Medium | High | Current package/docs are pinned; validate the real adapter with fresh SDK evidence | Codex / open |
| Live attestation key custody | Medium | High | Keep private key outside Git/logs/evidence; inject only trusted public keys into verification | Codex / open |
| Repeated evidence-download pressure | Low locally / Medium when public | Medium | Exact 4 MiB/16 MiB bounds plus one active and one 15-second content/policy-bound completed archive are verified; add shared edge rate limiting/admission control before public multi-replica deployment | Local cache closed / deployment open |
| Docker daemon unavailable | High | Medium | Continue non-container gates; start Docker Desktop before the container gate | Owner/Codex / open |
| Offline validator/Zod duplication | Low | Medium | One Zod structure now generates the checked-in schema and model projection and runs before deterministic semantic validation; exact freshness is gated | Closed by D-048; live provider acceptance remains open separately |
| Demo recording/account blocker | Medium | Medium | Prepare script, captions, screenshots, and exact owner action | Codex / open |

## Decisions pending

Link to IDs in `DECISIONS.md`.

- Project license selection requires owner acceptance; see D-013 and `docs/license-review.md`.

## Next action

`With explicit Docker registry approval and a running local Linux daemon, select digest-pinned compiler and Node bases, build/discover/pin the helper and role image identities, and exercise the schema-v15 lifecycle-v3 construction on real cgroup v2 before enabling finalization, PASS, or live admission.`

## Pause handoff

Fill before `/goal pause` or any handoff.

- Why paused: `not paused; the single-source PolicyIR checkpoint is verified and being committed before the next independent risk is selected`
- Exact current state: `PolicyIR runtime admission, checked-in JSON Schema, and the model-owned Responses projection now share one strict Zod source while deterministic semantic checks remain authoritative; no live provider/model claim was added`
- Last successful command: `the final pnpm verify completed every implemented step with 326/326 unit, 57/57 integration, 22/22 eval, 3/3 browser, 370-file clean-copy, 340-text-file security/history, static container, demo, and build passing, then remained fail-closed only for owner LICENSE and the exact 29-item submission gate`
- Current failing command: `pnpm helper:verify fails before Docker at the unset immutable builder; web/worker fail at the unset Node base; egress also lacks sealed helper IDs; pnpm verify:live fails before dynamic gates/network at missing OPENAI_API_KEY and CODEX_MODEL`
- Uncommitted files: `the verified single-source PolicyIR checkpoint is pending its current-branch commit`
- Safe resume command/action: `after the owner supplies the exact Docker/registry prerequisites, confirm clean main and run the helper artifact gate first`
- One owner action, if any: `start the Docker Desktop Linux engine, then reply with explicit approval to pull the selected digest-pinned compiler and Node images`

## Final completion record

Do not fill until the end.

- Engineering definition of done: `NOT_VERIFIED`
- `pnpm verify`: `FAIL_EXPECTED; every implemented schema-v15/cache gate passed and only the owner LICENSE plus the exact 29-item non-final submission gate failed`
- `pnpm verify:live`: `FAIL_CLOSED_BEFORE_DYNAMIC_GATES_OR_NETWORK; OPENAI_API_KEY and CODEX_MODEL are absent, while helper/role images, real-Docker/cumulative-CPU/outbound observations, finalized evidence, fresh GPT/Codex evidence, and signer/live admission do not exist`
- Production deployment: `NOT_VERIFIED`
- Public repository: `NOT_VERIFIED`
- Demo video: `NOT_VERIFIED`
- Challenge submission: `NOT_VERIFIED`
- Final evidence hash: `4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1` (`PARTIAL_OFFLINE/FAIL`, not final live proof)
- Final commit/tag: `UNSET`
- Final truthful state: `IN_PROGRESS`
