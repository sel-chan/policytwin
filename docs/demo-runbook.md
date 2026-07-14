# Demo runbook

## Current offline diagnostic flow

From the repository root:

The offline commands below assume this machine already has the exact pnpm store, verified OPA binary, and Chrome described in `README.md`. A new computer must use the network-enabled installation procedure in the README first.

```powershell
pnpm install --offline --frozen-lockfile
pnpm demo:reset
pnpm demo:run
pnpm evidence:offline
pnpm container:check
pnpm verify
```

Expected current behavior:

- `demo:run` reports D01, D02, and D03 as drift;
- `evidence:offline` regenerates a deterministic `PARTIAL_OFFLINE` package;
- the package status is `FAIL`; OPA is `PASS`, while GPT-5.6, Codex, live browser, container, and deployment remain `NOT_RUN`;
- `container:check` validates the daemon-free web-image contract and confirms the live Codex worker is absent;
- `verify` executes local Chrome E2E and all other implemented offline gates, while the owner-selected license and non-final submission package still fail. Dynamic container health remains a separate release gate.

## Future dynamic container verification

`pnpm container:verify` requires a verified immutable `node:22.22.2-<variant>@sha256:<digest>` value in `container-contract.json` and a running Docker Linux daemon. The Dockerfile also rejects mutable build-argument references if the wrapper is bypassed. The verifier initializes the named `/data` volume ownership in a short root-only setup container, then runs the application as `node` with a read-only root filesystem. It verifies OPA version/checksum and health, creates a real versioned workspace decision through the application API, restarts the container, and reads the same SQLite state back. Normal completion, handled errors, `SIGINT`, and `SIGTERM` trigger idempotent removal of the tracked temporary container, volume, and image; a removal error fails the normal gate and is reported on signal paths. Forced process termination such as `SIGKILL` cannot provide that guarantee. The command does not verify or enable the separate Codex worker.

## Recovery

- Stop `pnpm dev`, then run `pnpm demo:reset` to remove only the ignored default `.data/policytwin.sqlite` files and replace `.tmp/refund-demo/current` from the canonical baseline. If `POLICYTWIN_DATABASE_PATH` points to any custom location, the command fails and never deletes that file; unset the variable before resetting the repository-local demo.
- Open Decision Queue to create v2, v3, and v4 through the SQLite-backed API; reload to confirm the ledger persists.
- Open Change Impact to persist the exact 14-to-30 source edit as v5 `DRAFT`; confirm G02 blocks verification and no code repair is claimed.
- If alternate purchase-day or usage-time choices were accepted, confirm Proof labels the mismatch and Change Impact disables v5 instead of reusing the seeded reference evidence.
- Repair runs must use unique safe IDs under `.tmp/refund-demo/repair-runs`.
- Delete no path manually; use repository-owned reset/cleanup helpers.
- If evidence validation fails, rerun `pnpm evidence:offline`, then inspect `artifacts/evidence/evidence-manifest.json`.
- In Proof, download the complete reference archive and confirm its filename includes `v4`, `partial-offline`, `fail`, and the evidence-hash prefix. The route returns exactly 38 manifest-validated USTAR entries and never writes the archive into `artifacts/evidence/`.
- A recorded package must never be presented as a new live run.
- Never store an Ed25519 live-attestation private key in the repository, `.env` examples, logs, screenshots, or evidence payloads.

## Future live flow

After credentials, an owner-selected license, Docker, deployment permission, and an external attestation key are available, the runbook must add the implemented `pnpm verify:live` workflow, application URL, deployed health check, live browser path, Codex diff/review evidence, signing step, and rollback/redeploy commands. Those steps are not currently runnable.
