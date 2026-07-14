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
6. Evidence to UI/submission: every claim must map to a hashed artifact with explicit provenance.

## Threats and controls

| Threat | Current control | Remaining work |
|---|---|---|
| Prompt injection in policy text | Interpreter prompts treat policy as data; outputs use a closed IR and strict validation | Verify current Responses API Structured Outputs live |
| Model emits executable code | `PolicyIR` has no code field; deterministic compiler owns Rego | Live schema conformance evidence |
| Path traversal or canonical fixture modification | Relative paths reject absolute/`.`/`..`/control characters; repair copies live under one checked `.tmp` root; canonical hash checked | Exercise through live SDK adapter |
| Arbitrary command execution | Two fixed command IDs map to fixed executable/arguments/timeouts; no user shell strings | Add OS/container resource limits |
| Credential leakage into fixture | Child environment allowlist excludes API/Codex keys; output redacts credential assignments, bearer tokens, and home paths | Validate server and browser bundles after app exists |
| Test weakening or evidence edits | Repair write set must match cartography; prompts forbid weakening; review can block; evidence hashes reject tampering | Live independent review and Git diff capture |
| Recorded evidence shown as fresh | Mandatory execution modes; `PARTIAL_OFFLINE` package is `FAIL`; post-repair drift remains null | UI labels and freshness checks |
| Denial of service | Per-command 30-second timeout and 2 MiB process buffer; at most two repair attempts | Request rate limits, CPU/memory limits, job cancellation |
| Supply-chain compromise | No project runtime dependencies yet; lockfile is empty | Pin application dependencies, audit, licenses, and container digests after approved install |
| Secret in Git history | Current/history scanner reports only file/commit context and uses test sentinels | Run again before publication and after live artifacts |

## Security invariants

- No model or user text selects a filesystem path or executable directly.
- `expected-fixed` is evaluation-only and never enters repair context.
- The canonical buggy fixture remains reproducible.
- `ALLOW`, `DENY`, and `REVIEW` are the only decisions.
- A missing external gate cannot be converted to `PASS` by documentation.
- Logs, screenshots, and proof packages must not contain credentials or personal absolute paths.

## Residual risk

This is not a completed release security review. OPA, the web server, SQLite, the live SDK adapter, container runtime, hosting, rate limits, browser bundle, dependency graph, and deployment secrets remain untested. `artifacts/evidence/security-review.md` therefore stays `NOT_RUN`, and the partial proof package remains `FAIL`.
