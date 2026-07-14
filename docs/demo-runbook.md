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
- the package status is `FAIL`; OPA is `PASS`, while GPT-5.6, Codex, live browser, container, and deployment remain `NOT_RUN`;
- `verify` executes local Chrome E2E and all other implemented gates, then fails only on the owner-selected license, real container health, and non-final submission package.

## Recovery

- Run `pnpm demo:reset` to replace only `.tmp/refund-demo/current` from the canonical baseline.
- Repair runs must use unique safe IDs under `.tmp/refund-demo/repair-runs`.
- Delete no path manually; use repository-owned reset/cleanup helpers.
- If evidence validation fails, rerun `pnpm evidence:offline`, then inspect `artifacts/evidence/evidence-manifest.json`.
- A recorded package must never be presented as a new live run.
- Never store an Ed25519 live-attestation private key in the repository, `.env` examples, logs, screenshots, or evidence payloads.

## Future live flow

After credentials, an owner-selected license, Docker, deployment permission, and an external attestation key are available, the runbook must add the implemented `pnpm verify:live` workflow, application URL, deployed health check, live browser path, Codex diff/review evidence, signing step, and rollback/redeploy commands. Those steps are not currently runnable.
