# Demo runbook

## Current offline diagnostic flow

From the repository root:

```powershell
pnpm install --offline --frozen-lockfile
pnpm demo:reset
pnpm demo:run
pnpm evidence:offline
pnpm verify
```

Expected current behavior:

- `demo:run` reports D01, D02, and D03 as drift;
- `evidence:offline` regenerates a deterministic `PARTIAL_OFFLINE` package;
- the package status is `FAIL` and external gates are `NOT_RUN`;
- `verify` executes all implemented gates and then fails on browser E2E, license, and submission until those capabilities exist.

## Recovery

- Run `pnpm demo:reset` to replace only `.tmp/refund-demo/current` from the canonical baseline.
- Repair runs must use unique safe IDs under `.tmp/refund-demo/repair-runs`.
- Delete no path manually; use repository-owned reset/cleanup helpers.
- If evidence validation fails, rerun `pnpm evidence:offline`, then inspect `artifacts/evidence/evidence-manifest.json`.
- A recorded package must never be presented as a new live run.

## Future live flow

After approved dependencies, credentials, OPA, and Docker are available, the runbook must add `pnpm verify:live`, the application URL, health check, browser happy path, Codex diff/review evidence, and rollback/redeploy commands. Those steps are not currently runnable.
