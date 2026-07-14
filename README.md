# PolicyTwin

**Turn policy text into verified product behavior.**

PolicyTwin is an evidence-first policy engineering product for the OpenAI Build Week challenge. It will turn a natural-language SaaS refund policy into a versioned executable contract, compare that contract with a real TypeScript application, use Codex to repair drift, and produce reviewable proof.

## Current implementation status

The offline **M1 — Domain core and seeded fixture** slice is implemented. **M2–M10** have offline checkpoints covering strict `PolicyIR`, deterministic clauses, immutable ambiguity resolution, state transitions, a byte-stable Rego compiler, 41 traceable cases, conflict/minimal-contrast analysis, 47 executed mutants with a 93.62% reference-evaluator kill rate, deterministic before/after differential reports, a guarded repair-worker contract, 14→30-day impact analysis, complete offline traceability diagnostics, a hashed evidence package, reproducibility/security checks, and fail-closed submission drafts.

The worker foundation creates isolated trusted-fixture copies, exposes only two fixed verification commands, strips model credentials from child environments, bounds repair attempts to two, and blocks proof on high-severity review findings. An offline SQLite repository now persists policy text, golden cases, immutable IR versions, lifecycle state, and decision records across a process-style reopen with strict corruption and stale-write checks. The evidence package is deliberately `FAIL`/`PARTIAL_OFFLINE`, and the submission package is deliberately `DRAFT_NOT_READY`: OPA, live GPT-5.6, live Codex, browser, container, deployment, official rules, media, URLs, license, and confirmation remain unverified. Product UI integration, OPA execution, live interpretation, and live Codex repair are not yet implemented.

## Local baseline

Requirements currently verified in this workspace:

- Node.js 22 or newer;
- pnpm 11.7 or newer;
- TypeScript 5.8 available on `PATH` until the project-local dependency is installed under an approved network scope.

The current persistence adapter uses Node.js 22's built-in experimental `node:sqlite` API behind a narrow repository boundary. It is verified offline but must be checked against current official documentation and the selected production runtime before release.

```powershell
pnpm install --offline
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm eval
pnpm build
pnpm demo:reset
pnpm demo:run
pnpm evidence:offline
pnpm security:check
pnpm clean:check
pnpm container:check
pnpm submission:draft
pnpm submission:check
```

`pnpm demo:run` must report exactly three baseline drifts. `pnpm security:check` scans current files and Git history without printing suspected values. `pnpm clean:check` reproduces implemented gates from an isolated copy without dependencies or model credentials. `pnpm submission:draft` regenerates evidence-derived, visibly non-final copy; `pnpm submission:check` rejects unsupported readiness claims. `pnpm verify` currently fails closed on the owner-required project license, incomplete container, browser E2E, and submission; `pnpm verify:live` also remains fail-closed. See `PROGRESS.md` for exact evidence and current blockers.

The dependency-free runtime validator is an offline bootstrap, not a substitute for the required project-pinned Zod and strict Responses API integration. Those are added only after the repository's external network scope is approved and current official documentation is verified.

## Product contract

Read `AGENTS.md`, `PLAN.md`, `PROGRESS.md`, `DECISIONS.md`, and `SUBMISSION.md` before implementation. `PLAN.md` contains the complete milestones and acceptance criteria.

PolicyTwin is a software verification aid, not legal advice. Real policy deployment requires human approval.
