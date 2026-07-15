# Claim audit

DRAFT_NOT_READY — generated from partial offline evidence; do not submit.

| Claim | Evidence | Allowed wording |
|---|---|---|
| 41 accepted policy cases | `artifacts/evidence/opa-results.json`, `artifacts/evidence/verification-summary.json` | Real local OPA 1.18.2 execution |
| 16 buggy-fixture corpus drifts | `artifacts/evidence/drift-report-before.json` | OPA-backed expected decisions |
| 44/47 mutants killed | `artifacts/evidence/mutation-report.json` | Reference evaluator, not OPA |
| Evaluation-only fixed fixture has zero drift | `artifacts/evidence/drift-report-after.json` | Never call post-repair |
| Deterministic 38-file USTAR archive | `src/evidence/archive.ts`, integration and browser tests | Recorded reference package only |
| Six-view browser flow with v1-v5 persistence | `tests/e2e/workspace.spec.ts`, `artifacts/screenshots/` | Local Chrome E2E only; impact is reference preview |
| Docker supervisor and egress isolation | `container-contract.json`, `tests/unit/supervisor-docker-driver.test.mjs`, worker/egress container reports | Static and fake-daemon verification only; real Docker, immutable images, cgroup/TLS/upstream traffic, and Codex remain unverified |
| Live GPT-5.6 interpretation | Missing | Must not claim |
| Live Codex repair/review | Missing | Must not claim |
| Deployment/submission | Missing | Must not claim |
