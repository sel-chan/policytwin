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

- Stop `pnpm dev`, then run `pnpm demo:reset` to remove only the ignored default `.data/policytwin.sqlite` files and replace `.tmp/refund-demo/current` from the canonical baseline. If `POLICYTWIN_DATABASE_PATH` points to any custom location, the command fails and never deletes that file; unset the variable before resetting the repository-local demo.
- Open Decision Queue to create v2, v3, and v4 through the SQLite-backed API; reload to confirm the ledger persists.
- Open Change Impact to persist the exact 14-to-30 source edit as v5 `DRAFT`; confirm G02 blocks verification and no code repair is claimed.
- If alternate purchase-day or usage-time choices were accepted, confirm Proof labels the mismatch and Change Impact disables v5 instead of reusing the seeded reference evidence.
- Repair runs must use unique safe IDs under `.tmp/refund-demo/repair-runs`.
- Delete no path manually; use repository-owned reset/cleanup helpers.
- If evidence validation fails, rerun `pnpm evidence:offline`, then inspect `artifacts/evidence/evidence-manifest.json`.
- A recorded package must never be presented as a new live run.
- Never store an Ed25519 live-attestation private key in the repository, `.env` examples, logs, screenshots, or evidence payloads.

## Future live flow

After credentials, an owner-selected license, Docker, deployment permission, and an external attestation key are available, the runbook must add the implemented `pnpm verify:live` workflow, application URL, deployed health check, live browser path, Codex diff/review evidence, signing step, and rollback/redeploy commands. Those steps are not currently runnable.
