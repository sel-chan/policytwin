# Claim audit

DRAFT_NOT_READY — generated from partial offline evidence; do not submit.

| Claim | Evidence | Allowed wording |
|---|---|---|
| 41 accepted policy cases | `artifacts/evidence/opa-results.json`, `artifacts/evidence/verification-summary.json` | Real local OPA 1.18.2 execution |
| 16 buggy-fixture corpus drifts | `artifacts/evidence/drift-report-before.json` | Reference expectations from the accepted policy corpus, not OPA-backed |
| 44/47 mutants killed | `artifacts/evidence/mutation-report.json` | Reference evaluator, not OPA |
| Evaluation-only fixed fixture has zero drift | `artifacts/evidence/drift-report-after.json` | Never call post-repair |
| Deterministic 38-file USTAR archive | `src/evidence/archive.ts`, integration and browser tests | Recorded reference package only |
| Six-view browser flow with v1-v5 persistence | `tests/e2e/workspace.spec.ts`, `artifacts/screenshots/` | Local Chrome E2E only; impact is reference preview |
| Docker supervisor and egress isolation | `container-contract.json`, `tests/unit/supervisor-docker-driver.test.mjs`, worker/egress container reports | Static and fake-daemon verification only; real Docker, immutable images, cgroup/TLS/upstream traffic, and Codex remain unverified |
| Fake-only three-role aggregate CPU budget ledger | `src/codex/cpu-budget-contract.ts`, `tests/unit/cpu-budget-contract.test.mjs`, `tests/unit/supervisor-docker-driver.test.mjs` | Static and fake-controller proof only; no real Linux cgroup sampling, polling, containment, cumulative enforcement, hard limit, or overshoot bound |
| Worker RPC v2 candidate live-CPU envelope | `src/codex/live-linux-cgroup-cpu-proof.ts`, v2 contract/client/mTLS tests | Parser/signature/binding/tamper/replay/downgrade tests only; synthetic PASS fixtures and loopback signed FAIL are not Linux, Docker, CPU-enforcement, model, or Codex evidence |
| Live GPT-5.6 interpretation | Missing | Must not claim |
| Live Codex repair/review | Missing | Must not claim |
| Deployment/submission | Missing | Must not claim |

Worker RPC v2 transport admission is factory-identity-bound: the concrete v2 mTLS client module owns a private WeakSet, snapshots validated scalar options plus defensive copies of CA/certificate/key buffers and arrays, only its actual factory freezes and adds an admissible object, and no arbitrary registrar exists. The client rejects self-declared, v1, copied, or wrapped transports, while later caller mutation cannot redirect or corrupt the admitted connection profile; scripted response and option-mutation tests use the concrete factory over TLS 1.3 loopback. This is offline host-boundary evidence only; the supervisor remains FAIL-only and no live transport, Linux CPU proof, model call, or Codex repair is claimed.
