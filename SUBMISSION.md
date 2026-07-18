# SUBMISSION.md — PolicyTwin Build Week Release and Submission Plan

## 0. Truthful status

- Submission status: `NOT_STARTED`
- Last rules check: `2026-07-18 18:37:46 +09:00 — all three official OpenAI and Devpost pages fetched directly; no requirement change found`
- Exact official deadline and timezone: `2026-07-21 17:00 PDT (UTC-07:00)`
- Local deadline: `2026-07-22 09:00 KST (UTC+09:00)`
- Selected category/track: `Developer Tools`
- Live application URL: `UNSET`
- Public repository URL: `UNSET`
- Demo video URL: `UNSET`
- Submission page URL: `UNSET`
- Confirmation ID/URL: `UNSET`
- Confirmation evidence path: `UNSET`

Allowed final states:

- `SUBMITTED`
- `READY_FOR_OWNER_ACTION`

Do not use `SUBMITTED` without a verified confirmation. Do not use `READY_FOR_OWNER_ACTION` while engineering, deployment, recording, or copy work remains.

### Current offline draft

- `artifacts/submission-draft/` contains 21 generated files, including the machine-readable state and explicit `NOT_RUN` checker placeholder.
- `artifacts/demo-draft/` contains a 2:55 draft script, shot list, caption file, and deterministic demo data.
- The generator never deletes or rewrites the final `artifacts/submission/` and `artifacts/demo/` staging directories; their current legacy draft placeholders remain non-final and are rejected by the strict release check.
- Every judge-facing draft remains marked `DRAFT_NOT_READY`; no generated file claims submission readiness.
- `pnpm submission:check` is intentionally fail-closed until live and owner evidence exists. It first runs `pnpm verify` in the same non-recursive invocation, then validates the resulting receipt. The current exact failure count is regenerated after each checker revision. The release gate fixes exact staging/screenshots/38-file evidence sets, distinct reviewable screenshots, substantial SRT coverage synchronized to a two-to-three-minute local video, a 48-hour exact-three-source rule snapshot, cross-file metric claims including README, decoded non-uniform PNGs, Chrome three-point visual/audio/tail verification, full semantic evidence plus release-pinned Ed25519-attestation validation, a raw-byte Git-index/worktree-consistent release-input-bound offline verification receipt, deployment-evidence-bound anonymous live HTTPS and repository Git probes, a YouTube publication receipt, and state-specific owner action or confirmation evidence.
- Normal `pnpm test:e2e` and `pnpm verify` write browser review copies only to ignored `.tmp/playwright-screenshots/`. The tracked release captures are updated only by the explicit `pnpm exec playwright test --config=playwright.screenshots.config.ts` workflow and require direct visual review before commit.
- Owner declarations, live proof, project license, one required live Codex repair capture, video, public URLs, final form fields, and confirmation remain unverified or absent.
- Integration now has a session-bound SQLite repair-run/event ledger, idempotent CSRF-protected creation, resumable SSE, retryable terminal records, terminal-history pruning at session expiry, and a global fail-stop executor latch that retains active or poisoned rows. Its disabled future execution seam binds the local run identity into the signed v2 request, accepts only an exact branded one-use settlement, persists request/binding/completion provenance, and leaves unproved transport or cleanup outcomes `POISONED`. The current product execution port is deliberately unavailable, so browser-tested attempts remain `BLOCKED / NOT_STARTED` and explicitly state that no model or Codex call occurred. This is reusable product scaffolding, not live repair evidence or the required `04-codex-repair.png`.
- The complete evidence download now rereads and content-hashes the exact bounded package on every request, then permits one content-and-validation-policy-bound in-process archive to be reused for at most 15 seconds. Failures and expired live attestations are never cached and responses remain `no-store`; shared public rate limiting is still deployment work, not a current claim.
- PolicyIR structural admission, the checked-in JSON Schema, and the model-owned Responses schema now derive from one strict Zod contract. The official OpenAI helper produces the strict request format without server-owned metadata/input schema, and the returned JSON is checked against the same projection before trusted fields are injected. This is offline structural-contract evidence only; semantic correctness and live GPT-5.6 provider acceptance remain unproved.
- The local Responses contract now stops after one attempt for explicit model refusal, incomplete generation, upstream error, and failed/cancelled/queued/in-progress status, while retaining one bounded retry only for recoverable JSON/schema/semantic output defects. It checks message text against SDK `output_text` when items are present and never exposes refusal or upstream-error text through the protected route. No live response outcome has been observed, so this remains offline contract evidence.
- The partial evaluation scorecard now contains every required offline-measurable acceptance metric: all three seeded ambiguities, zero explicit-semantics mislabels, golden and boundary agreement, seeded drift, mutation, clause and case traceability, and OPA agreement. For only the exact trusted seeded policy ID/version/source hash, complete clause segmentation, ambiguity source links, and closed patch meaning, interpretation substitutes server-owned ambiguity wording/examples; other policies and changed inputs are not rewritten. The evidence validator derives each value, target, and status from PolicyIR, accepted cases, OPA results, differential evidence, mutation output, and traceability; changing and self-rehashing the scorecard no longer passes validation. Live statuses are also exact rather than prefix-matched, so an arbitrary `PASS_*` label cannot be promoted. Live-only Structured Outputs, post-repair, release-security, and browser receipt metrics remain explicitly null/`NOT_RUN`.
- The web, worker, verifier, and egress boundaries remain static/fake-runner evidence only. Every dynamic gate now requires its canonical local Docker CLI bytes to match a separately reviewed contract SHA-256 before use. The web gate additionally forbids base pulling, binds temporary image/volume/container ownership to a 128-bit nonce and exact labels, requires observed identities, and checks `restart=no`, zero restarts, memory/swap, PID, file, and local-log ceilings before start. Its current report still fails before Docker because the immutable Node base is unset; the reviewed release-host CLI hash is also unset, and a cold build would need the already approved pinned pnpm/OPA sources unless cached. The worker/egress path adds proxy-only capability authentication, a request/nonce-bound ID-owned Docker driver, required CPU-controller port, and a TLS-only probe, but only through fake/static tests. The fake CPU ledger aggregates post-baseline egress, worker, and verifier values while explicitly claiming no enforcement, hard limit, bounded overshoot, or containment. The TLS probe writes no HTTP but does not measure proxy outbound traffic. Docker 29.1.5 is running locally with `cgroupfs` and cgroup v1. Missing immutable builder/base/helper identities stop all dynamic gates before workload execution; even after those identities are supplied, this daemon is ineligible for required worker/egress cgroup-v2 evidence. No real CPU enforcement, egress TLS path, or Codex SDK turn has run, and no submission claim may describe them as deployed security evidence.

Worker RPC v2 and CPU evidence schema v2 are now prepared offline with separate signature and mTLS downgrade domains, client execution binding, deterministic role/attempt bindings, distinct live-purpose key material, durable replay, a strictly ordered global monotonic event transcript, and closed success/failure outcomes. The contract recomputes overlap, verifier ordering, role samples, arithmetic, containment state, and evidence hashes; legacy proof v1, static fake objects, nullable `cpuProof` receipts, and contradictory outcomes are rejected. An internal synthetic state-machine producer now derives parsed unsigned candidates and exercises ordering, overage, identity drift, cleanup failure, input-snapshot, abort, and overflow paths. Every candidate is frozen with `liveClaim:false` and `passSigningEligible:false`, and self-declared Linux provenance is rejected. This does not add current live proof: the loopback v2 integration signs only typed pre-execution `FAIL`, every success or observed failure fixture is synthetic, the generic supervisor still refuses PASS, and runtime-observation flags remain false. A concrete private Linux construction path now exists in source, but no Docker/cgroup-v2 execution, `cpu.stat` observation, containment action, finalized evidence, hard cap, bounded overshoot, model call, or Codex repair may be claimed from this checkpoint.

The schema-v15 static container contract retains the hardened non-live observer and separately records a concrete private Linux construction. Lifecycle v3 seals the native-helper artifact image ID, source hash, build-input hash, and binary hash together with the exact role images/configuration. A required digest-pinned compiler stage emits one root-owned `0555` AMD64 static PIE into a scratch artifact image; direct ELF/tar checks reject an interpreter, shared-library dependency, executable stack, wrong architecture/type, oversized output, ownership drift, and mode drift. Two strict local WSL builds were byte-identical, but the compiler is unpinned and the report keeps every image/install/runtime/signing claim false. The dynamic artifact verifier uses no pull or build network and currently stops before Docker because the immutable builder is unset. The Docker owner snapshots the sealed binary hash and the system adapter rejects a different same-FD helper client. The plan otherwise retains owner-created and independently inspected worker-internal/outbound networks, internally derived role plans, independent Docker reobservation/removal/absence receipts, helper sessions, and ordered cleanup. Ambiguous create side effects may recover only one exact-name, exact-label owned resource for cleanup; empty, ambiguous, or foreign observations remain sticky. This is implementation evidence, not Docker or Linux runtime evidence: no immutable role image, helper artifact image, host-installed helper, or real cgroup exercised the path, and no finalized-evidence issuer, signed PASS, or live gate admission exists.

Schema v15 keeps the internal CPU-adapter/final-result identity guard and required lifecycle order while adding helper artifact identity to the factory-issued lifecycle-v3 plan, owner-created private networks, internally derived Docker role plans, owned containers, one-shot bind/removal receipts, helper sessions, the system adapter, and the private lifecycle wrapper. Module-private identity still rejects local-build reports, artifact images alone, raw evidence, harness diagnostics, helper frames, synthetic candidates, non-live observations, copied plans, wrappers, and JSON-round-tripped values; there is deliberately no finalized-evidence issuer. This is not runtime evidence: artifact-image reproducibility, host installation, cgroup-v2 execution, signer capability admission, PASS signing, and the live gate remain disabled.

The v2 client now rejects transport self-declaration: the concrete v2 mTLS client module owns a private capability set, snapshots validated scalar inputs plus defensive copies of CA/certificate/key buffers and arrays, only its actual factory can add a frozen transport, and no arbitrary registrar exists. V1 results, copies, wrappers, and later caller option mutations cannot alter an admitted connection profile, while the internal assertion module is absent from the package root. This is local contract evidence only and does not change the live status.

These files are production scaffolding only. They must be regenerated from live verified evidence before publication or submission.

## 1. Official challenge baseline

Verified on 2026-07-14 from the official rules and challenge pages:

- registration: July 9, 2026 at 10:00 PT through July 21, 2026 at 17:00 PT;
- submissions: July 13, 2026 at 09:00 PT through July 21, 2026 at 17:00 PT;
- submission deadline in Korea: July 22, 2026 at 09:00 KST;
- official-rules judging period: July 22 at 10:00 PT through August 5 at 17:00 PT;
- winners: on or around August 12 at 14:00 PT;
- tracks: Apps for Your Life, Work and Productivity, Developer Tools, and Education;
- PolicyTwin track: **Developer Tools**, because it is a testing and agentic policy-to-code verification tool;
- judging criteria are equally weighted: Technological Implementation, Design, Potential Impact, and Quality of the Idea;
- the Devpost plugin is optional and is not a source of truth; the Official Rules and challenge website prevail.

The OpenAI marketing page lists judging through August 7, while the Official Rules list August 5 at 17:00 PT. The Official Rules control.

Eligibility location context is compatible with the Republic of Korea and current OpenAI API-supported territories, but the owner must still confirm age-of-majority, conflict, representative, and other declarations before registration or submission.

### Verified submission requirements

- working project built with Codex and GPT-5.6 in one track;
- English project description;
- public YouTube demo video shorter than three minutes, with clear audio, showing the project and how Codex and GPT-5.6 were used;
- repository URL that is public with relevant licensing, or private and shared with `testing@devpost.com` and `build-week-event@openai.com`;
- README describing Codex collaboration, acceleration, key decisions, and GPT-5.6/Codex contributions;
- `/feedback` Codex Session ID for the thread where most core functionality was built;
- for developer tools, installation instructions, supported platforms, and a judge-ready demo/sandbox/test path without rebuilding from scratch;
- free, unrestricted project access for judging through the end of the judging period;
- clear evidence separating pre-existing work from meaningful work added during the submission period when applicable;
- authorization and license compliance for third-party components.

Re-check these facts immediately before final publication because the Official Rules allow amendments.

Official entry point:

- https://openai.com/build-week/

Challenge details linked by OpenAI:

- https://openai.devpost.com/
- https://openai.devpost.com/rules

If current rules differ from this file, update this file and follow the current rules. Record the source and timestamp in `PROGRESS.md`.

## 2. Release identity

### Product name

> **TARGET FINAL BEHAVIOR — NOT_RUN_LIVE.** This section is draft copy and must be rewritten from fresh verified evidence before submission.

**PolicyTwin**

### Tagline

**Turn policy text into verified product behavior.**

### One-sentence pitch

PolicyTwin converts a natural-language business policy into an executable contract, tests it against real application behavior, uses Codex to repair policy drift, and produces proof.

### 50-word draft

PolicyTwin turns policy text into verified software behavior. GPT-5.6 extracts explicit rules and ambiguities, a deterministic compiler produces executable Rego, and generated edge cases reveal where a real application disagrees. Codex then repairs the code, reruns regression and mutation tests, and creates a traceable proof package.

Do not finalize this copy until the implemented behavior has been verified.

## 3. Judge-facing story

> **TARGET FINAL BEHAVIOR — NOT_RUN_LIVE.** GPT-5.6 interpretation, Codex repair/review, post-repair proof, and deployment statements below describe the intended final flow, not current evidence.

### Problem

Business policies live in documents, while actual decisions live in code. Small differences—`<` instead of `<=`, missing precedence, stale thresholds—create inconsistent customer outcomes. Policy owners cannot see whether the application follows the policy, and engineers cannot easily trace a sentence to tests and code.

### Solution

PolicyTwin creates a versioned policy twin connecting:

```text
source clause → accepted decision → executable rule → test cases → application behavior → code → proof
```

It refuses to guess material ambiguity, compiles accepted meaning deterministically, compares the policy engine with a real application, and uses Codex to fix the mismatch.

### What makes it different

This is not merely natural-language-to-code generation. PolicyTwin verifies real behavior, measures test quality with mutation testing, repairs drift, and preserves evidence.

### Why GPT-5.6

GPT-5.6 is used for policy-semantic interpretation and adversarial ambiguity/counterexample analysis under a strict model-owned schema projected from the same Zod structure used for runtime admission and checked-in schema generation. It handles meaning and language, while deterministic components still enforce source traceability, references, golden cases, execution, and proof.

### Why Codex

Codex reads the trusted fixture copy, maps policy-related code and tests, repairs the source inside a server-fixed two-file write set, and enables the exact server-owned D01-D03 assertions already present as skipped tests. PolicyTwin retains every fixed typecheck/test attempt with full execution-tree hashes, rejects SDK command events and test-side tree changes, directly replays the exact hash-bound 41-case corpus, and only then performs a separate read-only review. Codex is part of the product workflow, not only the tool used to build it.

## 4. Draft long description

Codex must rewrite this from actual implementation evidence before submission.

> **TARGET FINAL BEHAVIOR — NOT_RUN_LIVE.** Current generated submission artifacts remain explicitly `DRAFT_NOT_READY` and are the truthful source for present claims.

### Inspiration

A policy can say “within 14 days and 20% usage or less,” but production code may implement strict inequalities or the wrong exception order. Those errors are tiny in code and large in customer impact. We wanted a way for policy owners and engineers to share one testable, reviewable source of truth.

### What it does

PolicyTwin accepts a natural-language SaaS refund policy and representative examples. GPT-5.6 converts the text into a strict intermediate representation and surfaces only genuinely unresolved normalization, measurement, or default-outcome questions as explicit decision cards. Clearly stated inclusivity and final-sale precedence become rules and tests, not artificial ambiguities. Once approved, a deterministic compiler produces Rego and OPA evaluates a generated corpus of golden, boundary, conflict, and minimal-contrast cases.

PolicyTwin then runs the same cases against a real TypeScript refund application. Any mismatch appears as policy drift with the input, expected decision, actual decision, source clause, rule, and relevant code. Codex maps the repository, repairs the code in a fresh fixture copy, enables the exact server-owned regression assertions already present in the fixture, and reruns the full verification loop.

The final Proof view reports compilation, golden cases, generated cases, drift before and after, mutation score, regression results, traceability, security review, and an evidence hash.

### How we built it

Draft technology narrative:

- GPT-5.6 through the OpenAI Responses API with strict Structured Outputs;
- TypeScript `PolicyIR` and a deterministic compiler;
- OPA/Rego for policy execution;
- generated boundary and conflict cases;
- mutation testing to measure whether the corpus catches plausible policy defects;
- differential testing against a seeded TypeScript application;
- server-side Codex SDK for repository analysis, code repair, testing, and independent review;
- Next.js workspace UI;
- SQLite and filesystem evidence storage;
- Dockerized deployment;
- Vitest and Playwright verification.

Replace or remove any item not present in the final build.

### Challenges

Expected truthful themes to validate:

- separating semantic interpretation from deterministic execution;
- handling ambiguity without making the UI feel like a questionnaire;
- safely running Codex against a reproducible repository fixture;
- keeping evidence synchronized with UI metrics;
- making a technically deep workflow understandable in three minutes.

### Accomplishments

Only claim verified results, such as:

- detected all three seeded policy/application mismatches;
- repaired them with Codex in a fresh fixture copy;
- reached zero drift across the accepted corpus;
- achieved the measured mutation kill rate;
- created clause-to-rule-to-case-to-code traceability;
- shipped a clean, reproducible live demo.

Replace placeholders with actual numbers.

### What we learned

Potential themes:

- ambiguity is product data, not a prompting failure;
- generated code is less useful than executable evidence;
- mutation testing makes AI-generated cases measurable;
- a narrow vertical slice communicates a platform idea better than broad unsupported claims.

### What's next

Post-challenge directions, not MVP promises:

- additional policy packs;
- customer-owned isolated runners;
- GitHub pull-request workflow;
- policy change approval and audit history;
- more languages and policy engines;
- continuous policy drift monitoring.

## 5. Technical implementation evidence map

Fill with final paths and URLs.

| Judge question | Evidence |
|---|---|
| Where is GPT-5.6 used? | `src/openai/interpreter.ts`, `prompts/interpreter.v1.md`; `artifacts/evidence/gpt-run-summary.json` remains `NOT_RUN` until the fresh gate |
| How is output constrained? | `src/policy-ir/zod-schema.ts`, generated `schemas/policy-ir.v1.schema.json`, and deterministic semantic admission in `src/policy-ir/validate.ts` |
| What is deterministic? | Clause segmentation, PolicyIR validation/patches, Rego compilation, case generation, mutation accounting, differential reports, traceability, and evidence hashing under `src/` |
| Where is OPA used? | `src/opa/runner.ts`, `artifacts/evidence/opa-results.json`, and checksum/version pins in `container-contract.json` |
| How are cases generated? | `src/cases/generate.ts` and `artifacts/evidence/generated-cases.json` |
| How is mutation score calculated? | `src/mutation/` and `artifacts/evidence/mutation-report.json`; current score is explicitly reference-evaluator evidence, not live OPA mutation proof |
| How is application drift measured? | `src/differential/` plus `artifacts/evidence/drift-report-before.json`; post-Codex drift remains unavailable |
| Where is Codex used in-product? | Prepared contracts under `src/codex/`, with phase prompts and external-worker RPC; `artifacts/evidence/codex-run-summary.json` truthfully remains `NOT_RUN_LIVE` |
| How is a repair run followed? | Session-bound routes under `app/api/policies/[policyId]/versions/[version]/repair-runs/`, the SQLite ledger under `src/repair-runs/`, and the Integration SSE timeline; current attempts stop before execution |
| What code did Codex change? | No live Codex change exists yet; the allowed future write set is `fixtures/refund-demo/baseline/src/refund.ts` and `tests/refund.test.mjs` in a disposable copy |
| How is the result verified? | `pnpm verify`, `pnpm verify:live`, source-derived `eval-scorecard.json`, and the 38-file evidence validator/archive |
| What are the safety limits? | `docs/threat-model.md`, `docs/limitations.md`, fixed trusted fixture, closed commands/write set, split worker/verifier, and fail-closed dynamic reports |
| Can the run be reproduced? | `README.md`, `docs/demo-runbook.md`, `pnpm demo:reset`, `pnpm demo:run`, `pnpm verify`, and clean-copy evidence |

## 6. Required public repository contents

Before publishing, verify:

- [ ] `README.md` begins with the problem, a GIF/screenshot, and one-command demo path.
- [ ] Product architecture is visible.
- [ ] OpenAI and Codex usage is explicit.
- [ ] Local setup is tested from a clean checkout.
- [ ] Environment variables are documented in `.env.example`.
- [ ] No secret appears in Git history, current files, logs, screenshots, or evidence.
- [ ] License is present and compatible.
- [ ] `NOTICE.md` or attribution is complete.
- [ ] Seeded bug and repair workflow are documented.
- [ ] Offline `pnpm verify` and fresh-integration `pnpm verify:live` are documented and passing.
- [ ] Deployment path is documented.
- [ ] Limitations and safety boundaries are honest.
- [ ] Generated evidence package is included or reproducible.
- [ ] Challenge-specific files do not contain private account data.
- [ ] Issues/TODOs do not contradict submission claims.
- [ ] Final tag or release is created.

## 7. README structure

The final README should use this order:

1. Hero: name, tagline, screenshot, live demo, video.
2. The 30-second problem.
3. What PolicyTwin does.
4. Three-minute flow.
5. Before/after seeded example.
6. Architecture.
7. GPT-5.6 role.
8. Codex role.
9. Evidence and verification.
10. Local quickstart.
11. Environment variables.
12. Demo reset/run.
13. Tests and evals.
14. Deployment.
15. Security and limitations.
16. Repository structure.
17. Build Week judging map.
18. License and attribution.

## 8. Screenshot checklist

Generate polished PNGs under `artifacts/screenshots/`:

- [x] `01-policy-studio.png`
- [x] `02-decision-queue.png`
- [x] `03-case-lab-drift.png`
- [ ] `04-codex-repair.png`
- [x] `05-proof.png`
- [x] `06-change-impact.png`
- [x] `07-mobile-or-responsive.png`
- [x] `08-architecture.png`

Requirements:

- no browser extensions, personal bookmarks, notifications, API keys, local usernames, or irrelevant tabs;
- readable at submission-page preview size;
- consistent data and timestamps;
- no stale UI claims;
- include captions in `artifacts/submission/screenshots.md`.

## 9. Demo video production

### Target

A clear video strictly shorter than the official three-minute limit. Target 2:55 so encoding and platform metadata cannot turn an exact 3:00 cut into a rules violation.

### Required assets

- [x] `artifacts/demo-draft/demo-script.md` (truthful draft; final live numbers remain blocked)
- [x] `artifacts/demo-draft/shot-list.md` (truthful draft)
- [x] `artifacts/demo-draft/captions.srt` (truthful 2:55 draft)
- [x] `artifacts/demo-draft/demo-data.json` (partial offline provenance)
- [x] deterministic reset command
- [ ] final source recording
- [ ] compressed upload file
- [ ] uploaded public/unlisted URL
- [ ] playback verification in a signed-out browser

### Script draft

> **TARGET VIDEO FLOW — NOT_RECORDED / NOT_RUN_LIVE.** GPT-5.6, Codex repair, post-repair zero drift, and final proof segments cannot be recorded as completed until fresh live evidence exists.

#### 0:00–0:18 — Policy drift

Voice/caption:

> This refund policy includes day 14, includes exactly 20% usage, and says final sale always wins. The application gets all three cases wrong.

Show the three wrong decisions.

#### 0:18–0:45 — Interpret policy

> PolicyTwin uses GPT-5.6 to turn the text into a strict policy model. It links every rule to its source sentence and refuses to guess material ambiguity.

Load/interpret policy and highlight clauses/rules.

#### 0:45–1:08 — Resolve decisions

> Instead of hiding assumptions, PolicyTwin asks focused decisions and shows the cases each choice changes.

Resolve purchase-day counting, usage measurement time, and the default no-match outcome. Day-14 inclusion, 20% inclusion, pending-promotion review, and final-sale precedence remain visible as explicit extracted rules rather than questions.

#### 1:08–1:32 — Generate executable evidence

> A deterministic compiler produces Rego. PolicyTwin generates golden, boundary, conflict, and minimal-contrast cases, then measures their strength with mutation testing.

Show Case Lab and compilation.

#### 1:32–1:52 — Detect drift

> Recorded expectations from the accepted policy corpus and the application run the same inputs. These red rows are exact counterexamples where the software violates that reference; this comparison is not OPA-backed.

Show day 14, 20%, and precedence drift.

#### 1:52–2:20 — Repair with Codex

> Codex maps the repository, finds the eligibility path, makes the smallest repair, and enables the exact server-owned regression assertions. PolicyTwin then runs the fixed verification commands, the complete 41-case corpus, and a separate read-only review.

Show timeline and diff.

#### 2:20–2:42 — Prove

> After repair, drift is zero. Golden and generated cases pass, regression tests are green, and the mutation score shows that the corpus catches plausible mistakes.

Show actual final metrics.

#### 2:42–2:55 — Change impact

> When the policy changes from 14 to 30 days, PolicyTwin shows the rules, cases, and code affected before another change is applied.

Show version impact.

End card:

```text
PolicyTwin
Turn policy text into verified product behavior.
Live demo · Source · Evidence
```

### Recording acceptance

- [ ] voice/captions match actual UI;
- [ ] cursor path is deliberate;
- [ ] no loading gap is confusing;
- [ ] no claim is unsupported;
- [ ] text is legible at 1080p;
- [ ] audio is clear or captions carry the narrative;
- [ ] final URL plays without owner login;
- [ ] duration satisfies current rules.

## 10. Deployment checklist

- [ ] Production provider selected and recorded in `DECISIONS.md`.
- [ ] Environment variables configured through provider secrets.
- [ ] Container or service build succeeds.
- [ ] OPA version matches local.
- [ ] Trusted fixture reset works.
- [ ] Codex worker is server-side and protected from arbitrary repository input.
- [ ] Health endpoint returns success.
- [ ] Database/persistent storage behavior is documented.
- [ ] Recorded verified evidence remains available after restart.
- [ ] Rate-limit and error states are readable.
- [ ] Live URL uses HTTPS.
- [ ] Playwright smoke test passes against live URL.
- [ ] Signed-out browser can access the judge path.
- [ ] No personal admin panel is exposed.
- [ ] Rollback/redeploy steps are documented.

## 11. Security and legal release checklist

- [ ] `OPENAI_API_KEY` and other credentials are absent from client bundles.
- [ ] Secret scan includes Git history where possible.
- [ ] Dependency audit reviewed.
- [ ] License compatibility reviewed.
- [ ] Third-party notices present.
- [ ] Fixture code is owned or properly licensed.
- [ ] Policy text is synthetic.
- [ ] No customer/personal data appears.
- [ ] Product disclaimer is visible.
- [ ] Arbitrary repository execution is disabled in hosted demo.
- [ ] Command allowlist, timeout, and temp cleanup are tested.
- [ ] Logs are redacted.
- [ ] Challenge declarations are answered truthfully.
- [ ] Any use of pre-existing work is disclosed as required.

## 12. Submission artifact directory

`pnpm submission:draft` writes only to `artifacts/submission-draft/` and `artifacts/demo-draft/`; `pnpm submission:draft:check` validates those fail-closed drafts. It never deletes or rewrites the final staging directories below.

Generate final files here only after fresh live evidence exists:

```text
artifacts/submission/
├── title.txt
├── tagline.txt
├── short-description.txt
├── long-description.md
├── inspiration.md
├── what-it-does.md
├── how-we-built-it.md
├── challenges.md
├── accomplishments.md
├── learnings.md
├── whats-next.md
├── technologies.txt
├── openai-and-codex-usage.md
├── judging-evidence-map.md
├── links.json
├── screenshots.md
├── rules-check.md
├── claim-audit.md
└── final-checklist.md
```

Final staging also contains `submission-state.json` and the generated `submission-check-report.json`. After a successful account submission, `SUBMITTED` additionally requires `submission-confirmation.png` and the exact confirmation object; before that action, `READY_FOR_OWNER_ACTION` requires null confirmation and exactly one `SUBMIT_ON_DEVPOST` owner action.

`claim-audit.md` must list every quantitative or capability claim and point to evidence.

## 13. Final form checklist

Replace with exact current fields after checking the challenge form.

- [ ] Project name
- [ ] Tagline
- [ ] Short description
- [ ] Long description
- [ ] Inspiration
- [ ] What it does
- [ ] How it was built
- [ ] Challenges
- [ ] Accomplishments
- [ ] Learnings
- [ ] What's next
- [ ] Technologies
- [ ] GPT-5.6 usage
- [ ] Codex usage
- [ ] `/feedback` Codex Session ID for the primary build task
- [ ] Live URL
- [ ] Repository URL
- [ ] Demo video URL
- [ ] Images
- [ ] Category/track
- [ ] Team members
- [ ] Eligibility declarations
- [ ] Rules/terms acceptance
- [ ] Any AI or prior-work disclosure
- [ ] Final preview
- [ ] Submit
- [ ] Confirmation captured

## 14. Automated `pnpm submission:check`

The script must fail when:

- required artifact file is missing or still contains `UNSET`;
- link JSON is invalid;
- URLs do not use expected schemes;
- proof metrics differ from submission claims;
- README references missing images;
- video URL is absent;
- `/feedback` Codex Session ID is absent or malformed;
- final captions are absent, remain marked as a draft, or end at/after 3:00;
- caption cue numbers, bodies, ordering, or non-overlap are invalid;
- final staging contains an unexpected or non-regular entry;
- the screenshot directory is not the exact reviewed set, captures are duplicated or undersized, or required PNGs do not decode as non-uniform images under the reviewed screenshot profile;
- the MP4 is fragmented, malformed, shorter than 2:00, lacks sampled video or audio, declares 3:00 or longer, cannot be decoded, exposed with audio, visually distinguished at three timeline points, or tail-seeked by Chrome, or disagrees with Chrome duration;
- caption timing is not structurally valid or its tail is not synchronized to the local MP4;
- the owner-reviewed YouTube receipt is missing, stale, or not bound to the public URL and exact local video hash/duration;
- live URL is absent, differs from validated deployment/browser evidence, or does not return anonymous same-origin HTTPS 2xx;
- repository URL is absent, not a supported GitHub/GitLab project URL, or does not expose anonymous Git `HEAD`;
- secret patterns are detected;
- `pnpm verify` has no fresh ordered PASS receipt bound to the current evidence, clean/security reports, raw Git-managed input bytes, index objects, safe index flags, tracked state, index/working modes, tracked self-reports, and zero untracked files;
- the exact 38-file evidence directory has an extra, missing, non-regular, semantically invalid, stale, untrusted, or incorrectly signed entry, or the signing key is not pinned by key ID and SPKI SHA-256 in the reviewed release trust file;
- `pnpm verify:live` has no current fresh trusted GPT/Codex integration evidence and Ed25519 attestation;
- challenge rules check is incomplete, future-dated, or older than 48 hours;
- a recognized case, drift, mutation, or post-repair metric conflicts anywhere in final text;
- `SUBMITTED` lacks the exact confirmation object and decoded confirmation PNG, or `READY_FOR_OWNER_ACTION` does not contain exactly one Devpost submission action;
- submission status is falsely set.

The script cannot prove account-side submission; confirmation evidence remains required.

`pnpm verify` runs the isolated draft generator and `submission:draft:check` as its deterministic submission-safe offline check. The account- and live-evidence-dependent `pnpm submission:check` remains a separate strict release gate, invokes `pnpm verify` itself, and must not be replaced by the draft check. With final live/repository URLs present it performs external network probes, so that exact scope requires owner approval before execution.

## 15. Definition of `READY_FOR_OWNER_ACTION`

All must be true:

- engineering definition of done passes;
- live URL is verified;
- public repository is verified;
- demo video is uploaded and verified;
- every form field is in `artifacts/submission/`;
- screenshots are uploaded or ready;
- rules and claims are audited;
- the challenge form is open at the final owner-only step where possible;
- exactly one action remains, such as CAPTCHA, terms acceptance, or final submit click;
- the action is stated in one sentence in `PROGRESS.md`.

## 16. Definition of `SUBMITTED`

All must be true:

- the challenge platform reports successful submission;
- confirmation ID, confirmation URL, or screenshot is stored;
- the submitted public page is reviewed;
- live, repository, and video links work from a signed-out browser;
- no post-submission field is missing;
- final commit/tag and evidence hash are recorded;
- `PROGRESS.md` and this file show `SUBMITTED`.

## 17. Final verification record

Fill only at completion.

- Rules checked at:
- Exact deadline:
- Selected track:
- `pnpm verify` result:
- `pnpm verify:live` result:
- `pnpm submission:check` result:
- Final commit:
- Final tag/release:
- Evidence hash:
- Live URL:
- Repository URL:
- Video URL:
- Public submission URL:
- Confirmation:
- Final state:
- Remaining limitations:
