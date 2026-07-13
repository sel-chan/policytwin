# PolicyTwin

**Turn policy text into verified product behavior.**

PolicyTwin is an evidence-first policy engineering product for the OpenAI Build Week challenge. It will turn a natural-language SaaS refund policy into a versioned executable contract, compare that contract with a real TypeScript application, use Codex to repair drift, and produce reviewable proof.

## Current implementation status

The offline **M1 — Domain core and seeded fixture** slice is implemented. The repository contains strict refund-input validation, six golden cases, three exact drift witnesses, a canonical buggy TypeScript fixture, an evaluation-only fixed fixture, and deterministic fresh-copy reset/replay tooling. Product UI, OPA, live GPT-5.6 interpretation, and Codex repair are not yet implemented.

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

## Product contract

Read `AGENTS.md`, `PLAN.md`, `PROGRESS.md`, `DECISIONS.md`, and `SUBMISSION.md` before implementation. `PLAN.md` contains the complete milestones and acceptance criteria.

PolicyTwin is a software verification aid, not legal advice. Real policy deployment requires human approval.
