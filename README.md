# PolicyTwin

**Turn policy text into verified product behavior.**

PolicyTwin is an evidence-first policy engineering product for the OpenAI Build Week challenge. It will turn a natural-language SaaS refund policy into a versioned executable contract, compare that contract with a real TypeScript application, use Codex to repair drift, and produce reviewable proof.

## Current implementation status

The offline **M1 — Domain core and seeded fixture** slice is implemented. **M2–M7** have offline checkpoints covering strict `PolicyIR`, deterministic clauses, immutable ambiguity resolution, state transitions, a byte-stable Rego compiler, 41 traceable cases, conflict/minimal-contrast analysis, 47 executed mutants with a 93.62% reference-evaluator kill rate, deterministic before/after differential reports, and a guarded repair-worker contract. The worker foundation creates isolated trusted-fixture copies, exposes only two fixed verification commands, strips model credentials from child environments, bounds repair attempts to two, and blocks proof on high-severity review findings. The buggy fixture produces 16 classified drifts across the accepted corpus while the evaluation-only fixed fixture produces zero drift. The recorded fixtures and M7 backend are explicitly offline test doubles, not live GPT-5.6 or Codex evidence. Generated Rego has not been compiled by OPA. Persistence, product UI, OPA execution, live interpretation, and live Codex repair are not yet implemented.

## Local baseline

Requirements currently verified in this workspace:

- Node.js 22 or newer;
- pnpm 11.7 or newer;
- TypeScript 5.8 available on `PATH` until the project-local dependency is installed under an approved network scope.

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
```

`pnpm demo:run` must report exactly three baseline drifts. `pnpm verify`, `pnpm verify:live`, `pnpm test:e2e`, and `pnpm submission:check` remain fail-closed until their required product capabilities exist. See `PROGRESS.md` for exact evidence and current blockers.

The dependency-free runtime validator is an offline bootstrap, not a substitute for the required project-pinned Zod and strict Responses API integration. Those are added only after the repository's external network scope is approved and current official documentation is verified.

## Product contract

Read `AGENTS.md`, `PLAN.md`, `PROGRESS.md`, `DECISIONS.md`, and `SUBMISSION.md` before implementation. `PLAN.md` contains the complete milestones and acceptance criteria.

PolicyTwin is a software verification aid, not legal advice. Real policy deployment requires human approval.
