# AGENTS.md

## Mission

Build and submit **PolicyTwin**, an evidence-first AI policy engineering product for OpenAI Build Week.

PolicyTwin turns a natural-language SaaS refund policy into a versioned executable contract, finds ambiguity and policy drift, tests the contract against a real TypeScript application, uses Codex to repair the application, and produces reviewable proof.

The core product promise is:

> Change a policy sentence, and the rules, tests, application behavior, traceability, and proof update together.

Do not use personal memory, unrelated prior projects, or unstated user preferences. Work only from this repository, current official documentation, and evidence produced during the run.

## Instruction precedence

Use this order when instructions conflict:

1. safety, platform, and account-permission requirements;
2. this `AGENTS.md`;
3. `PLAN.md`;
4. `SUBMISSION.md`;
5. `DECISIONS.md`;
6. `PROGRESS.md`;
7. existing repository conventions that do not conflict with the above.

Do not silently weaken acceptance criteria. Record any necessary deviation in `DECISIONS.md` with reason, impact, and recovery path.

## Required reading at the start of every goal or resumed session

Read completely:

- `AGENTS.md`
- `PLAN.md`
- `PROGRESS.md`
- `DECISIONS.md`
- `SUBMISSION.md`

Then inspect the repository, Git state, environment, available tools, and current test baseline. Update `PROGRESS.md` before making substantive changes.

## Autonomy contract

Work independently through the milestones. Do not stop merely because the work is large, unfamiliar, or spans multiple sessions.

Use the simplest robust decision that preserves the product promise and acceptance criteria. Record non-obvious choices in `DECISIONS.md`.

Do not ask the owner routine implementation questions. Ask or pause only when one of these is genuinely required:

- a secret or account login that is not available;
- legal terms, contest declarations, or license choices requiring owner acceptance;
- payment, billing, domain purchase, or irreversible external action;
- a destructive operation outside the repository;
- two materially different product choices with no safe default and different submission claims.

Before pausing, complete all independent work and provide exactly one concrete unblock action.

## Scope discipline

The required vertical slice is:

1. a natural-language **SaaS refund policy**;
2. user-provided golden cases;
3. GPT-5.6 interpretation into strict `PolicyIR`;
4. explicit ambiguity decisions;
5. deterministic compilation to Rego;
6. OPA evaluation;
7. generated boundary, conflict, contrast, and mutation cases;
8. differential execution against a seeded TypeScript refund application;
9. Codex SDK analysis and repair of that application;
10. regression verification and a proof package;
11. polished web UI;
12. reproducible deployment and submission assets.

Do not expand into legal advice, general compliance, PDF ingestion, arbitrary repositories, multiple languages, organization administration, or production auto-deployment until the vertical slice is complete and verified.

## Engineering defaults

Unless the repository already has an equally good compatible setup, use:

- Node.js 20 LTS or a newer supported LTS;
- TypeScript in strict mode;
- `pnpm` workspaces;
- Next.js for the web application;
- server-side OpenAI Responses API integration;
- `@openai/codex-sdk` for the in-product code-repair worker;
- Zod plus JSON Schema for runtime contracts;
- OPA/Rego for executable policy evaluation;
- Vitest for unit and integration tests;
- Playwright for browser tests and screenshots;
- SQLite for local persisted state;
- Docker for reproducible local and hosted execution;
- Server-Sent Events for run progress unless a simpler existing mechanism is already proven.

Prefer small, explicit modules over framework-heavy abstractions. Avoid speculative infrastructure.

All user-visible product copy and challenge submission copy should be in clear English unless a localization layer is intentionally added after the English flow is complete.

## Dependency policy

Before adding a production dependency:

1. confirm it is necessary;
2. prefer an actively maintained package with a clear license;
3. pin or lock the resolved version;
4. record unusual dependencies in `DECISIONS.md`;
5. include attribution where required.

Never add a dependency solely to avoid writing a small deterministic function.

## Required repository scripts

Create and keep these root scripts working:

```text
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm eval
pnpm build
pnpm verify
pnpm verify:live
pnpm demo:reset
pnpm demo:run
pnpm submission:check
```

`pnpm verify` is the authoritative offline local gate. It must run formatting or lint checks, type checking, deterministic tests and fixture-backed evals, build, and submission-safe static checks in a deterministic order without requiring network access, account credentials, or a fresh model response.

`pnpm verify:live` is the authoritative live integration gate. It must perform fresh GPT-5.6 and Codex work, capture request/run evidence, and validate the resulting live artifacts. Both `pnpm verify` and `pnpm verify:live` must pass before engineering or submission can be declared complete. Recorded fixtures may support `pnpm verify`, but never substitute for the fresh live gate.

If a command cannot run in the current environment, record the exact reason and provide an equivalent verified command. Do not mark the gate passed without evidence.

## Work loop

For every milestone:

1. read the milestone and acceptance gate in `PLAN.md`;
2. inspect relevant code and tests;
3. write or update a narrow execution checklist in `PROGRESS.md`;
4. establish or reproduce the failing condition;
5. implement one coherent slice;
6. run the smallest relevant test;
7. run broader regression checks;
8. inspect artifacts directly, including UI screenshots when applicable;
9. update documentation, traceability, and evidence;
10. commit a checkpoint with a descriptive message when Git is available;
11. update `PROGRESS.md` with command results, artifact paths, commit hash, remaining risk, and next milestone.

Never leave `PROGRESS.md` more than one completed checkpoint behind reality.

## Planning and recovery

Treat `PLAN.md` as the product contract, not a frozen implementation recipe. Improve implementation details when evidence supports it, but preserve the behavior and proof requirements.

If a step fails:

1. capture the error and reproduction command;
2. classify it as code, environment, dependency, permission, external service, or specification;
3. try the safest local fix;
4. retry with a bounded alternative;
5. record the result;
6. continue with independent work;
7. pause only for a true owner-only blocker.

Do not repeatedly retry the same failing external action without changing the hypothesis.

## Git and checkpoints

- Keep the working tree understandable.
- Do not rewrite unrelated history.
- Do not delete user work.
- Prefer small milestone commits.
- Work on the current branch; do not create branches or worktrees unless the owner explicitly changes this rule.
- Before risky changes, create a checkpoint commit on the current branch.
- Never let two agents edit the same files concurrently.
- A read-only exploration or review agent may run in parallel with the main writer.
- Run a final diff review before every milestone commit.
- Run a dedicated final review against the baseline before publishing.

Local Git initialization and commits are allowed when requested by the owner. Pushing, publishing the challenge repository, deploying the application, and submitting the challenge require the connected account, platform permission, and explicit approval for the relevant external network scope. Never expose secrets or private repository content while doing so.

## External network boundary

- Any external network call or command requires the owner's explicit approval for a stated scope before execution.
- Until approval is available, continue all independent offline work and mark official facts or integrations as unverified rather than guessing.
- Package installation, official-document lookup, Git push, deployment, upload, and challenge submission are network actions under this rule.
- Do not repeatedly request approval for the same scope; record the approved scope and use it only for the stated purpose.

## Subagents

Use subagents only for bounded work with explicit outputs, such as:

- repository mapping;
- test-gap analysis;
- accessibility review;
- security review;
- submission-copy critique;
- independent diff review.

The main agent owns architecture, integration, file writes, evidence, and final decisions. Under the current single-branch rule, subagents are read-only reviewers. Parallel writers or worktrees require explicit owner authorization and non-overlapping file ownership.

## OpenAI integration rules

- After the required network scope is approved, check current official OpenAI documentation before implementing API- or Codex-specific behavior.
- Use the Responses API for new GPT-5.6 model calls.
- Use strict Structured Outputs for `PolicyIR`, ambiguity, and generated-case contracts.
- Keep the model name configurable through environment variables.
- Never treat model confidence or prose as proof.
- Store prompt versions and schema versions with each policy run.
- Validate every model output before use.
- Retry only bounded, recoverable schema failures.
- Never place `OPENAI_API_KEY`, Codex credentials, or access tokens in the repository, logs, browser bundle, screenshots, fixtures, or proof package.
- Use the Codex SDK server-side only.
- The critical demo path must perform real model and Codex work. A recorded-evidence fallback may exist only if clearly labeled.

## Policy-engineering invariants

These are non-negotiable:

- The model may interpret policy meaning but may not emit arbitrary executable code for the final policy.
- A deterministic compiler converts validated `PolicyIR` to Rego.
- Every rule traces to one or more source clauses.
- Every ambiguity is explicit; unstated boundary or precedence choices are not silently guessed.
- Every accepted ambiguity decision is versioned.
- Exact numeric boundaries use integers. Percentages use basis points.
- Date arithmetic is normalized before policy evaluation.
- `ALLOW`, `DENY`, and `REVIEW` are the only MVP decisions.
- `final_sale` is an explicit highest-priority denial in the seeded demo.
- User golden cases are authoritative evidence. A contradiction blocks verification.
- Policy-engine results and application results are compared case by case.
- Mutation score must be computed from actual killed and surviving mutants.
- No generated proof file may claim a test, model call, Codex repair, deployment, or submission that did not occur.

## Testing requirements

Write tests before or with behavior. Required coverage includes:

- `PolicyIR` schema validation;
- parser output fixtures;
- clause-to-rule traceability;
- ambiguity detection;
- deterministic compiler snapshots;
- OPA compile and evaluation;
- exact boundary cases;
- rule conflicts and precedence;
- metamorphic or minimal-contrast cases;
- mutation operators and kill-rate calculation;
- differential application behavior;
- Codex repair worker contract;
- regression tests for the seeded bugs;
- API input validation and failure states;
- browser happy path;
- keyboard navigation and basic accessibility;
- demo reset and replay;
- production build and container health check.

Prefer behavioral assertions over coverage percentages. Coverage reports are supporting evidence, not the acceptance condition.

## UI quality bar

Do not ship a generic chat interface.

The required workspace includes:

- Policy Studio;
- Decision Queue;
- Case Lab;
- Integration/Drift view;
- Proof view.

The primary demo flow must be understandable without narration. Show clear loading, empty, error, blocked, and success states. Use semantic HTML, keyboard-operable controls, readable contrast, responsive layout, and stable visual hierarchy.

Use Playwright to capture and inspect final screenshots at common desktop and mobile sizes. Fix obvious layout defects before submission.

## Security and privacy

- Treat repository contents and uploaded policy text as untrusted input.
- The MVP supports only the bundled trusted fixture for write execution.
- Do not execute arbitrary uploaded repositories in the hosted demo.
- Use a fresh temporary copy for every repair run.
- Restrict commands, runtime, CPU, memory, filesystem scope, and network access where feasible.
- Redact secrets and absolute personal paths from logs.
- Add `.env*`, credentials, transient worktrees, run logs, and generated secrets to `.gitignore`.
- Run dependency audit, secret scan, license check, and a focused security review before publishing.
- Do not collect personal data that is not required for the demo.
- Include clear disclaimers that PolicyTwin is not legal advice and requires human approval for real policy deployment.

## Evidence requirements

Write machine-readable artifacts under `artifacts/evidence/`, including at minimum:

```text
policy-ir.json
compiled-policy.rego
golden-cases.json
generated-cases.json
opa-results.json
app-results-before.json
drift-report-before.json
codex-run-summary.json
integration.diff
app-results-after.json
drift-report-after.json
mutation-report.json
traceability.json
verification-summary.json
```

Also create a human-readable `artifacts/evidence/summary.md`.

Every top-level metric in the UI must link or map to evidence.

## Documentation requirements

Keep these current:

- root `README.md`;
- architecture diagram;
- local setup;
- environment variables;
- exact verification commands;
- demo reset/run instructions;
- threat model and limitations;
- license and third-party notices;
- `PROGRESS.md`;
- `DECISIONS.md`;
- `SUBMISSION.md`.

The README must let a fresh reviewer run the seeded demo without guessing.

## Submission behavior

At the start and again before final publishing:

1. verify the current official Build Week rules, exact deadline, track options, eligibility, repository visibility requirements, video constraints, and required form fields;
2. update `SUBMISSION.md` with sources and exact dates;
3. never rely on an older copied rule when the official challenge page differs.

Prepare truthful final materials based on the built product, not the plan. Required deliverables include:

- live demo or clearly documented runnable deployment;
- public source repository when rules permit;
- polished README;
- architecture image or Mermaid diagram;
- three-minute demo video and captions;
- screenshots;
- final project description;
- technology list;
- judging-criteria evidence map;
- license and attribution;
- submission confirmation evidence.

## Definition of engineering done

Engineering is done only when all of the following are true:

- the core flow works from a clean checkout;
- `pnpm verify` passes;
- the seeded three application bugs are detected;
- Codex repairs the bugs in a fresh fixture copy;
- all golden and generated policy cases pass after repair;
- application drift is zero for the accepted corpus;
- mutation kill rate over non-equivalent mutants is at least 90%; every equivalent exclusion has a deterministic justification, and every surviving non-equivalent mutant is reported;
- all rules have clause, case, and code traceability;
- no critical or high-severity security finding remains;
- the production container builds and passes a health check;
- the deployed flow is tested with Playwright or equivalent;
- evidence artifacts are reproducible;
- documentation and submission assets match actual behavior.

## Definition of goal done

The goal is done only when engineering is done and `SUBMISSION.md` is marked:

- `SUBMITTED` with verified URLs and confirmation evidence; or
- `READY_FOR_OWNER_ACTION` because exactly one unavoidable owner-only external action remains.

Do not stop at “MVP complete,” “tests mostly pass,” “ready to deploy,” or “submission draft prepared.”
