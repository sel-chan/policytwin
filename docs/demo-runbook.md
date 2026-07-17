# Demo runbook

## Current offline diagnostic flow

From the repository root:

The offline commands below assume this machine already has the exact pnpm store, verified OPA binary, and Chrome described in `README.md`. A new computer must use the network-enabled installation procedure in the README first.

```powershell
pnpm install --offline --frozen-lockfile
pnpm demo:reset
pnpm demo:run
pnpm evidence:offline
pnpm helper:build:local
pnpm container:check
pnpm verify
```

Expected current behavior:

- `demo:run` reports D01, D02, and D03 as drift;
- `evidence:offline` regenerates a deterministic `PARTIAL_OFFLINE` package;
- the package status is `FAIL`; OPA is `PASS`, while GPT-5.6, Codex, live browser, container, and deployment remain `NOT_RUN`;
- `helper:build:local` recompiles the native helper twice and requires byte-identical AMD64 static-PIE output, but explicitly records the compiler as unpinned and every image/runtime/signing claim as false;
- `container:check` validates the daemon-free split images, lifecycle-v3/Docker-v3 ownership contract, native-helper artifact contract, ID-only supervisor driver, and separate TLS-only gate while confirming every live/dynamic flag remains false;
- `verify` executes local Chrome E2E and all other implemented offline gates, while the owner-selected license and non-final submission package still fail. Dynamic container health remains a separate release gate.

## Future dynamic container verification

`pnpm container:verify` requires a verified immutable `node:22.22.2-<variant>@sha256:<digest>` value in `container-contract.json` and a running Docker Linux daemon. The Dockerfile also rejects mutable build-argument references if the wrapper is bypassed. The verifier initializes the named `/data` volume ownership in a short root-only setup container, then runs the application as `node` with a read-only root filesystem. It verifies OPA version/checksum and health, creates a real versioned workspace decision through the application API, restarts the container, and reads the same SQLite state back. Normal completion, handled errors, `SIGINT`, and `SIGTERM` trigger idempotent removal of the tracked temporary container, volume, and image; a removal error fails the normal gate and is reported on signal paths. Forced process termination such as `SIGKILL` cannot provide that guarantee. The command does not verify or enable the separate Codex worker.

`pnpm helper:verify` first requires a digest-pinned compiler image that is already present locally. It passes `--pull=false` and `--network=none`, builds the scratch artifact, extracts but never starts the helper, validates one root-owned `0555` AMD64 static PIE, and compares the observed image/binary identities with the contract. It currently fails before Docker because that builder is unset. `pnpm worker:verify` separately requires the exact worker/verifier/egress build-input hashes, an immutable Node base already present in the daemon, and `POLICYTWIN_DOCKER_CLI` set to the canonical absolute CLI path. It forces the platform-local daemon through a closed environment, creates a fresh request/nonce-bound internal network with exact labels, treats create output as a candidate until ID/name/label inspection succeeds, and inspects memory+swap, file/log ceilings, `restart=no`, zero restart count, entrypoint, environment, namespaces, tmpfs, mounts, ports, and membership. The supervisor seals the worker image and maximum request limits, pins each running ID/PID/start timestamp, reobserves egress before and after worker execution and before stop, runs the static worker plus reconstructed verifier, and cleans only inspected-owned IDs. On Linux it also requires Docker-ID-bound cgroup v2 membership, initial-PID absence, an empty/released process set, independent ID plus binding/role absence, and role-local post-exit CPU comparisons. Those comparisons exclude egress and do not enforce one cumulative request budget. The prepared lifecycle separately requires a CPU-controller port; its current fake controller aggregates post-baseline egress, worker, and verifier values and blocks receipt validation until a request/binding/identity-bound static proof finalizes. That proof cannot satisfy the live gate and does not demonstrate real `cpu.stat` sampling, polling, freeze, kill, containment, or bounded overshoot. Worker RPC v2 now requires CPU evidence schema v2: request/client-execution/image/policy/corpus bindings, exact Docker or partial-attempt role bindings, one globally ordered `CLOCK_MONOTONIC_RAW_NS` transcript, recomputed success ordering/arithmetic, and closed typed failure/containment outcomes. An internal synthetic-only producer exercises this state machine and emits a frozen unsigned/non-live wrapper with current signing eligibility false; its raw parser-valid evidence is contract data, not provenance or authorization. It is not a Linux adapter and is not consumed by any dynamic gate. Legacy proof v1 and nullable failure receipts are rejected. The current mTLS v2 integration signs only typed pre-execution `FAIL`; observed success and failure fixtures remain synthetic, and no dynamic gate consumes a PASS result. `pnpm egress:verify` is a second non-live gate with the same ownership/resource/teardown rules and now requires the sealed helper identity carried by lifecycle v3. It builds worker/proxy images, owns fresh internal/outbound networks and the proxy, generates private ephemeral CA/leaf/key/lease/dummy-provider material outside the repository, and runs a non-root internal TLS 1.3 probe with restart disabled. That probe validates the `policytwin-egress` certificate and closes without writing HTTP. It does not measure proxy outbound traffic, so upstream absence is not a gate result. The dynamic reports currently fail before Docker because immutable image inputs are unset. None proves cumulative CPU-time enforcement, a model call, or a Codex run.

In schema v10, “empty/released process set” is checked as separate facts rather than one broad reap claim. The non-live observer admits only `/docker/<id>` or final `docker-<id>.scope` membership, pins a private cgroup-v2 directory descriptor/device/inode, bounds no-follow reads, parses `usage_usec` as uint64 `bigint`, requires `populated=0` before the final sample, and then separately verifies initial-PID absence and original-cgroup release. Stop or network-disconnect failure remains a cleanup failure even if forced removal later succeeds. These paths have only Windows/offline contract coverage; the selected Linux daemon, post-removal descriptor behavior, and path forms remain unverified, and the post-start baseline cannot be used as live cumulative evidence.

Schema v15 retains those checks and adds a separate private construction whose lifecycle-v3 plan also seals the helper artifact image/source/build/binary identities. The owner snapshots the binary hash and the adapter rejects a different same-FD helper client. The normal path still encodes owned-networks-observed → barrier-held → Docker-observed → helper-bound-and-baseline-captured → Docker-reobserved → cached-baseline-accepted → barrier-released, followed by serial samples, containment, quiescent final samples, and per-role Docker removal → cgroup release. After every role, the helper stops and both owned networks are removed before the barrier and owner close. Emergency helper termination requires all Docker roles and networks absent. Side-effect-ambiguous create failures can recover only one exact-name, exact-label owned resource through an independent cleanup deadline; an empty or ambiguous observation remains sticky. The older static entrypoints still bypass this path and the helper has not run against cgroup v2. Do not substitute the local build report, artifact image, construction, harness, native source, synthetic producer, non-live observer, or parser-valid object for runtime evidence. A future run must dynamically demonstrate the exact sequence on immutable Linux containers before a private finalized-evidence issuer may be added.

Before any future v2 client run, construct its transport only with `createMutualTlsWorkerRpcV2Transport`. The client rejects plain objects, v1 transports, shallow copies, and wrappers by frozen object identity before it creates a request. The factory module owns the private capability set, snapshots validated scalar inputs and private copies of in-memory TLS material, and exposes no arbitrary registration API; mutating the caller's options afterward cannot change the connection.

## Recovery

- Stop `pnpm dev`, then run `pnpm demo:reset` to remove only the ignored default `.data/policytwin.sqlite` files and replace `.tmp/refund-demo/current` from the canonical baseline. If `POLICYTWIN_DATABASE_PATH` points to any custom location, the command fails and never deletes that file; unset the variable before resetting the repository-local demo.
- Open Decision Queue to create v2, v3, and v4 through the SQLite-backed API; reload to confirm the ledger persists.
- Open Change Impact to persist the exact 14-to-30 source edit as v5 `DRAFT`; confirm G02 blocks verification and no code repair is claimed.
- If alternate purchase-day or usage-time choices were accepted, confirm Proof labels the mismatch and Change Impact disables v5 instead of reusing the seeded reference evidence.
- Repair runs must use unique safe IDs under `.tmp/refund-demo/repair-runs`.
- Delete no path manually; use repository-owned reset/cleanup helpers.
- If evidence validation fails, rerun `pnpm evidence:offline`, then inspect `artifacts/evidence/evidence-manifest.json`.
- In Proof, download the complete reference archive and confirm its filename includes `v4`, `partial-offline`, `fail`, and the evidence-hash prefix. The route returns exactly 38 manifest-validated USTAR entries and never writes the archive into `artifacts/evidence/`.
- Repeated unchanged downloads may reuse one validated in-process archive for up to 15 seconds, but each request still rereads and hashes the bounded source package and the browser response remains `no-store`. Do not describe this as shared or edge rate limiting.
- A recorded package must never be presented as a new live run.
- Never store an Ed25519 live-attestation private key in the repository, `.env` examples, logs, screenshots, or evidence payloads.

## Future live flow

After credentials, an owner-selected license, Docker, deployment permission, and external live-purpose/attestation keys are available, the runbook must add the implemented `pnpm verify:live` workflow, dynamically exercise the private Linux cgroup-v2 construction to produce fresh Worker RPC v2 CPU evidence, cover deliberate under-budget, over-budget, identity, controller, containment, and cleanup-failure runs, and add dynamic evidence-v2 validation, a private final-result issuer, application URL, deployed health check, live browser path, Codex diff/review evidence, signing step, and rollback/redeploy commands. Those steps are not currently runnable.
