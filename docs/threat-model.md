# PolicyTwin threat model

## Scope and assets

Protected assets are OpenAI/Codex credentials, repository contents, accepted policy meaning, golden cases, the canonical buggy fixture, generated evidence, command output, and submission claims.

The hosted MVP will accept policy text and structured refund cases. It will execute writes only in a fresh copy of the bundled trusted fixture. Arbitrary repositories, arbitrary shell commands, and production auto-deployment are outside scope.

## Trust boundaries

1. Browser to server: policy text, ambiguity choices, and case inputs are untrusted.
2. Server to model: prompts include untrusted policy prose under a strict schema contract.
3. Server to OPA: only deterministically compiled Rego and strictly validated integer/boolean input may cross.
4. Server to repair worker: only a fresh trusted fixture copy, accepted evidence, relative paths, and closed command IDs may cross.
5. Worker to child process: model credentials are removed; output is bounded and redacted.
6. Evidence to UI/submission: every claim must map to a hash-covered artifact with explicit provenance; `LIVE_VERIFIED` additionally requires a trusted Ed25519 attestation bound to the evidence hash, run ID, and timestamp.

## Threats and controls

| Threat | Current control | Remaining work |
|---|---|---|
| Prompt injection in policy text | Interpreter prompts treat policy as data; outputs use a closed IR and strict validation | Verify current Responses API Structured Outputs live |
| Cross-site, replayed, or storage-exhausting workspace access | Seeded policy scope, anonymous hashed project IDs, same-origin-only session creation, exact configured production origin, HttpOnly SameSite session/CSRF cookies, matching custom header, strict version paths/bodies, ten-second body limits, optimistic concurrency, replay-safe identical writes, 24-hour cleanup, and a 128-project process cap | Add authenticated identity, shared quotas/rate limiting, and coordinated cleanup before multi-instance hosting |
| Static reference evidence shown for different accepted choices | Proof compares a deterministic PolicyIR meaning fingerprint; Change Impact blocks v5 when the current validated meaning differs from the seeded reference | Generate and attest session-specific evidence after live interpretation/verification exists |
| Model emits executable code | `PolicyIR` has no code field; deterministic compiler owns Rego | Live schema conformance evidence |
| Path traversal or canonical fixture modification | Relative and absolute SDK event paths normalize only within the managed root; repair copies live under one checked `.tmp` root; every phase snapshots bounded UTF-8 files and directories; read-only changes fail; cartography line ranges are checked; canonical hash is rechecked | SDK sandbox is not a read jail—mount only the fixture in the required external OS sandbox and verify teardown receipts |
| Arbitrary command execution | SDK phases disable agent network/web search and approvals, receive bounded file contents in the request, and reject every SDK `command_execution` event; the server fixes writes to the refund source and one test file; only the orchestrator runs typecheck then test; every successful result or runner/evidence error is retained with repair/tree bindings; the host live-backend factory and local live runner both reject | Build the external non-networked, non-privileged worker RPC with fixture-only mounts, CPU/memory/PID/output limits, process-tree termination, immutable witness harness, and full 41-case rerun before enabling any real SDK turn |
| Credential or sensitive-data leakage into a model, fixture, command receipt, or proof | Every prompt context and canonical NUL-free UTF-8 fixture file is scanned before an SDK turn; SDK CLI environment construction is allowlisted; verification commands use a separate credential-free environment; command output, model fields, diffs, and archives reject or redact credential-shaped and personal-path content | Re-verify the same controls inside the external worker and release platform logs |
| Failed repair stream leaves unreviewed writes | Any repair error poisons the disposable workspace, clears the review receipt, snapshots the observable delta when safe, and blocks every later phase on that backend | External worker must terminate the entire process tree and delete the mounted workspace on every exit path |
| Test weakening or evidence edits | Actual filesystem deltas define changed files; the accepted corpus must equal the exact server-owned 41-case digest; the exact two-file repair set cannot be model-expanded or narrowed; the test file must match the digest of the server-owned D01-D03 assertions with all three skips removed; model-reported regression links are excluded; test execution must preserve the typechecked tree's content, structure, modes, and mtimes; each command-passing attempt receives a PolicyIR/corpus/tree-bound receipt and only final 41/41 reaches review; live evidence cross-checks the complete command history, generated `dist` allowlist, prompt/schema hashes, final receipt, and a canonical diff reconstructed byte-for-byte from the attested before/after contents | The same immutable runner must execute inside the external OS sandbox for live work because arbitrary model-authored tests and host execution are not proof |
| Attacker rewrites all evidence and recomputes hashes | Validator derives Rego, OPA agreement, differential counts, mutation score, and traceability from source artifacts; `LIVE_VERIFIED` requires a trusted detached Ed25519 signature | Provision and rotate the live signing key outside Git/hosting logs |
| Secret or transient file enters a downloadable archive | Archive input is the exact 38-file required allowlist, never a directory listing; semantic validation, attestation checks, byte caps, credential/private-key/bearer/personal-path rejection, and deterministic USTAR generation run before response | Re-run the same guard against fresh live receipts and release-platform logs |
| Recorded evidence shown as fresh | Mandatory execution modes; `PARTIAL_OFFLINE` package is `FAIL`; post-repair drift remains null | UI labels and freshness checks |
| Denial of service | Per-command 30-second timeout and 2 MiB process buffer; at most two repair attempts; each SDK phase has abort, event-count, event-byte, final-response, prompt, file-count, file-byte, and review-patch limits; the adapter awaits abort-aware stream teardown | SDK stderr/single-JSONL-line hard limits, shared request rate limits, and externally enforced CPU/memory/PID/process-tree termination remain mandatory |
| Supply-chain compromise | Exact dependency lock, production audit, reviewed install scripts, and checksum-pinned OPA binary | Re-run release-platform license/audit checks and pin the container base digest |
| Secret in Git history | Current/history scanner reports only file/commit context and uses test sentinels | Run again before publication and after live artifacts |

## Security invariants

- No model or user text selects a filesystem path or executable directly.
- `expected-fixed` is evaluation-only and never enters repair context.
- The canonical buggy fixture remains reproducible.
- `ALLOW`, `DENY`, and `REVIEW` are the only decisions.
- A missing external gate cannot be converted to `PASS` by documentation.
- A self-generated SHA-256 manifest cannot authenticate a live run; the private attestation key remains outside the repository.
- Logs, screenshots, and proof packages must not contain credentials or personal absolute paths.

## Residual risk

This is not a completed release security review. SQLite restart behavior, browser-session isolation, same-origin/CSRF mutation rejection, expired-token POST rejection, bounded body reads, reference-policy mismatch blocking, checksum-pinned local OPA, the production Next build, deterministic archive construction, local Chrome E2E, dependency audit, static secret/history scans, and fake-stream Codex adapter controls are tested. The isolated-worker factory constructs the actual SDK offline without starting a turn. The web process has no live repair route, and the host command runner rejects live mode. The session TTL and capacity bound prevent unbounded local growth but are process-local and are not authentication. Production storage permissions, backup/restore, authenticated identity, shared distributed quotas, the external Codex worker, live SDK/sandbox behavior, attestation-key custody, container runtime, hosting, and deployment secrets remain untested. `artifacts/evidence/security-review.md` therefore stays `NOT_RUN`, and the partial proof package remains `FAIL`.
