# SUBMISSION.md — PolicyTwin Build Week Release and Submission Plan

## 0. Truthful status

- Submission status: `NOT_STARTED`
- Last rules check: `NOT_RUN — external network approval required`
- Exact official deadline and timezone: `UNSET`
- Local deadline: `UNSET`
- Selected category/track: `UNSET`
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

- `artifacts/submission/` contains 21 generated files, including the machine-readable state and latest checker report.
- `artifacts/demo/` contains a draft script, shot list, caption file, and deterministic demo data.
- Every judge-facing draft remains marked `DRAFT_NOT_READY`; no generated file claims submission readiness.
- `pnpm submission:check` currently fails with 37 explicit unmet requirements.
- Official rules, live proof, project license, screenshots, video, public URLs, form fields, and confirmation remain unverified or absent.

These files are production scaffolding only. They must be regenerated from live verified evidence before publication or submission.

## 1. Official challenge baseline

As of the creation of this file, the official OpenAI Build Week page states:

- challenge opens July 13, 2026;
- submission deadline July 21, 2026;
- judging is based on technical implementation, design and user experience, potential impact, and quality of the idea;
- strong entries should demonstrate thoughtful use of GPT-5.6 and Codex and clearly communicate the problem, solution, and approach;
- submission should include a project description, demo video, code repository, and any additional judging materials.

Before implementation begins and again before final submission, verify the exact rules, deadline time/timezone, eligibility, track, team rules, repository visibility, video constraints, required form fields, allowed prior work, licenses, and use-of-AI disclosures on the current official challenge pages.

Official entry point:

- https://openai.com/build-week/

Challenge details linked by OpenAI:

- https://openai.devpost.com/

If current rules differ from this file, update this file and follow the current rules. Record the source and timestamp in `PROGRESS.md`.

## 2. Release identity

### Product name

**PolicyTwin**

### Tagline

**Turn policy text into verified product behavior.**

### One-sentence pitch

PolicyTwin converts a natural-language business policy into an executable contract, tests it against real application behavior, uses Codex to repair policy drift, and produces proof.

### 50-word draft

PolicyTwin turns policy text into verified software behavior. GPT-5.6 extracts explicit rules and ambiguities, a deterministic compiler produces executable Rego, and generated edge cases reveal where a real application disagrees. Codex then repairs the code, reruns regression and mutation tests, and creates a traceable proof package.

Do not finalize this copy until the implemented behavior has been verified.

## 3. Judge-facing story

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

GPT-5.6 is used for policy-semantic interpretation and adversarial ambiguity/counterexample analysis under strict structured schemas. It handles meaning and language, while deterministic components handle execution and proof.

### Why Codex

Codex reads the real fixture repository, maps policy-related code and tests, applies the smallest repair, runs commands, and returns a reviewable diff and evidence. Codex is part of the product workflow, not only the tool used to build it.

## 4. Draft long description

Codex must rewrite this from actual implementation evidence before submission.

### Inspiration

A policy can say “within 14 days and 20% usage or less,” but production code may implement strict inequalities or the wrong exception order. Those errors are tiny in code and large in customer impact. We wanted a way for policy owners and engineers to share one testable, reviewable source of truth.

### What it does

PolicyTwin accepts a natural-language SaaS refund policy and representative examples. GPT-5.6 converts the text into a strict intermediate representation and surfaces only genuinely unresolved normalization, measurement, or default-outcome questions as explicit decision cards. Clearly stated inclusivity and final-sale precedence become rules and tests, not artificial ambiguities. Once approved, a deterministic compiler produces Rego and OPA evaluates a generated corpus of golden, boundary, conflict, and minimal-contrast cases.

PolicyTwin then runs the same cases against a real TypeScript refund application. Any mismatch appears as policy drift with the input, expected decision, actual decision, source clause, rule, and relevant code. Codex maps the repository, repairs the code in a fresh fixture copy, adds regression tests, and reruns the full verification loop.

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
| Where is GPT-5.6 used? | `UNSET` |
| How is output constrained? | `UNSET` |
| What is deterministic? | `UNSET` |
| Where is OPA used? | `UNSET` |
| How are cases generated? | `UNSET` |
| How is mutation score calculated? | `UNSET` |
| How is application drift measured? | `UNSET` |
| Where is Codex used in-product? | `UNSET` |
| What code did Codex change? | `UNSET` |
| How is the result verified? | `UNSET` |
| What are the safety limits? | `UNSET` |
| Can the run be reproduced? | `UNSET` |

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

- [ ] `01-policy-studio.png`
- [ ] `02-decision-queue.png`
- [ ] `03-case-lab-drift.png`
- [ ] `04-codex-repair.png`
- [ ] `05-proof.png`
- [ ] `06-change-impact.png`
- [ ] `07-mobile-or-responsive.png`
- [ ] `08-architecture.png`

Requirements:

- no browser extensions, personal bookmarks, notifications, API keys, local usernames, or irrelevant tabs;
- readable at submission-page preview size;
- consistent data and timestamps;
- no stale UI claims;
- include captions in `artifacts/submission/screenshots.md`.

## 9. Demo video production

### Target

A clear video no longer than the current official limit. Aim for approximately three minutes unless current rules require otherwise.

### Required assets

- [ ] `artifacts/demo/demo-script.md`
- [ ] `artifacts/demo/shot-list.md`
- [ ] `artifacts/demo/captions.srt`
- [ ] `artifacts/demo/demo-data.json`
- [ ] deterministic reset command
- [ ] final source recording
- [ ] compressed upload file
- [ ] uploaded public/unlisted URL
- [ ] playback verification in a signed-out browser

### Script draft

#### 0:00–0:20 — Policy drift

Voice/caption:

> This refund policy includes day 14, includes exactly 20% usage, and says final sale always wins. The application gets all three cases wrong.

Show the three wrong decisions.

#### 0:20–0:50 — Interpret policy

> PolicyTwin uses GPT-5.6 to turn the text into a strict policy model. It links every rule to its source sentence and refuses to guess material ambiguity.

Load/interpret policy and highlight clauses/rules.

#### 0:50–1:15 — Resolve decisions

> Instead of hiding assumptions, PolicyTwin asks focused decisions and shows the cases each choice changes.

Resolve purchase-day counting, usage measurement time, and the default no-match outcome. Day-14 inclusion, 20% inclusion, pending-promotion review, and final-sale precedence remain visible as explicit extracted rules rather than questions.

#### 1:15–1:40 — Generate executable evidence

> A deterministic compiler produces Rego. PolicyTwin generates golden, boundary, conflict, and minimal-contrast cases, then measures their strength with mutation testing.

Show Case Lab and compilation.

#### 1:40–2:00 — Detect drift

> The policy engine and application run the same inputs. These red rows are exact counterexamples where the software violates the accepted policy.

Show day 14, 20%, and precedence drift.

#### 2:00–2:30 — Repair with Codex

> Codex maps the repository, finds the eligibility path, makes the smallest repair, adds regression tests, and runs the project commands.

Show timeline and diff.

#### 2:30–2:50 — Prove

> After repair, drift is zero. Golden and generated cases pass, regression tests are green, and the mutation score shows that the corpus catches plausible mistakes.

Show actual final metrics.

#### 2:50–3:00 — Change impact

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

Generate final files here:

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
- live URL is absent;
- repository URL is absent;
- secret patterns are detected;
- `pnpm verify` has no current passing offline evidence;
- `pnpm verify:live` has no current fresh GPT/Codex integration evidence;
- challenge rules check is stale;
- submission status is falsely set.

The script cannot prove account-side submission; confirmation evidence remains required.

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
