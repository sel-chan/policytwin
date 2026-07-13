# GOAL_PROMPT.md — Ready-to-paste Codex Goal

## Main command

Paste this from the repository root. The official command is singular: `/goal`.

```text
/goal Build, validate, deploy, and submit PolicyTwin for OpenAI Build Week. Treat AGENTS.md as the working contract, PLAN.md as the product/acceptance specification, PROGRESS.md as the persistent checkpoint ledger, DECISIONS.md as the durable decision log, and SUBMISSION.md as the release/submission contract. Read all five files completely before changing code.

Continue autonomously through milestones M0–M10 until the truthful final state is SUBMITTED. Work one verified checkpoint at a time: reproduce the missing/failing condition, implement the smallest coherent slice, run narrow tests, run broader regression gates, inspect UI/evidence directly, update docs and traceability, create a Git checkpoint on the current branch, and update PROGRESS.md with commands, exit codes, artifacts, commit, risks, and next action. Keep offline pnpm verify and fresh-integration pnpm verify:live authoritative and do not record a pass without evidence.

The non-negotiable vertical slice is the seeded SaaS refund-policy flow: GPT-5.6 Responses API with strict Structured Outputs; explicit ambiguity decisions without relabeling clear source semantics as ambiguity; validated PolicyIR and closed PolicyPatch commands; deterministic PolicyIR-to-Rego compiler; real OPA evaluation; golden, boundary, conflict, minimal-contrast, and mutation cases; differential execution against the seeded buggy TypeScript app; real server-side Codex SDK cartography/repair/review in a fresh trusted fixture copy; zero post-repair drift; at least 90% mutation kill rate over non-equivalent mutants, deterministic justification for every equivalent exclusion, and reporting of every surviving non-equivalent mutant; clause→rule→case→code traceability; polished Policy Studio, Decision Queue, Case Lab, Integration, Proof, and change-impact UX; reproducible evidence; security review; clean-checkout verification; containerized live deployment; a submission-compliant repository that is public when required or allowed; demo screenshots; a rule-compliant approximately three-minute demo video with captions; truthful English submission copy; and challenge confirmation.

At the start and before release, obtain the owner approval required by the active environment for the stated network scope, then verify current official OpenAI/Codex documentation and current Build Week rules, deadline, track, required fields, repository/video constraints, and disclosures. Record exact sources and dates. Before approval, continue independent offline work and mark external facts unverified. Adapt implementation details to current official APIs without weakening behavior.

Do not ask routine questions and do not stop because the work is large or crosses sessions. Use safe defaults and record non-obvious choices in DECISIONS.md. Work on the current branch without creating branches or worktrees. Use subagents only for bounded read-only review unless the owner explicitly authorizes a different isolated-writing workflow; keep one writer per file. Do not expand into non-goals before P0 passes. Never fake model calls, Codex repairs, tests, mutation scores, URLs, deployments, uploads, or submission.

When blocked by a secret, login, CAPTCHA, terms acceptance, billing, or other owner-only action, first finish every independent task, record the blocker, provide exactly one concrete owner action, and pause. After the action, resume and verify it. READY_FOR_OWNER_ACTION is allowed only when engineering, deployment, repository, video, copy, screenshots, and form data are complete and exactly one unavoidable owner action remains. Otherwise keep working. Stop only with verified SUBMITTED evidence or that narrowly defined owner-action state.
```

The objective text is **3,712 characters**, below the documented 4,000-character limit.

## First status check

After the goal begins, use:

```text
Give me a compact status recap without interrupting the goal: current milestone, verified evidence, next action, blockers, latest commit, and whether PROGRESS.md is current.
```

## Resume command

When the goal was paused for an owner action:

```text
/goal resume
```

Then send:

```text
The requested owner action is complete. Verify it rather than assuming success, update PROGRESS.md, and continue the existing goal from the next unmet acceptance gate.
```

## Recovery prompt if Codex stops too early

Use this in the same task:

```text
The goal is not complete. Re-read AGENTS.md, PLAN.md, PROGRESS.md, DECISIONS.md, and SUBMISSION.md. Compare the repository and evidence against every unmet gate in M0–M10 and the definitions of engineering done, READY_FOR_OWNER_ACTION, and SUBMITTED. Correct any unsupported PASS state. Resume from the highest-priority unmet P0 gate, keep PROGRESS.md current, and continue until the goal's stopping condition is truly satisfied.
```

## Recovery prompt after a failed external action

```text
Record the failed external action, exact error, and evidence in PROGRESS.md. Do not loop on the same hypothesis. Finish all independent work, choose a safe alternative deployment/publishing path if available, and pause only when exactly one owner-only action remains.
```

## Scope correction prompt

Use this when the work is drifting into extras:

```text
Return to the required PolicyTwin vertical slice in PLAN.md. Freeze or remove P1/P2 work that does not directly improve a currently failing P0 acceptance gate. State the next failing gate and continue with the smallest verified change.
```

## Proof audit prompt

Use before deployment and submission:

```text
Run an adversarial proof audit. Check every UI metric and submission claim against machine-readable evidence; rerun pnpm verify, pnpm verify:live, and pnpm submission:check; inspect the production build and final screenshots; run a focused secret, security, license, and accessibility review; correct unsupported claims; then continue the goal.
```

## Submission completion prompt

Use only after account access is available:

```text
Continue M10. Verify the current official challenge form and rules, publish or update the final repository/deployment/video as needed, populate the form from artifacts/submission, verify every URL signed out, submit when permissions allow, capture confirmation evidence, and update SUBMISSION.md and PROGRESS.md truthfully. Do not claim SUBMITTED without confirmation.
```
