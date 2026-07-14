# Claim audit

DRAFT_NOT_READY — generated from partial offline evidence; do not submit.

| Claim | Evidence | Allowed wording |
|---|---|---|
| 41 accepted policy cases | `artifacts/evidence/opa-results.json`, `artifacts/evidence/verification-summary.json` | Real local OPA 1.18.2 execution |
| 16 buggy-fixture corpus drifts | `artifacts/evidence/drift-report-before.json` | OPA-backed expected decisions |
| 44/47 mutants killed | `artifacts/evidence/mutation-report.json` | Reference evaluator, not OPA |
| Evaluation-only fixed fixture has zero drift | `artifacts/evidence/drift-report-after.json` | Never call post-repair |
| Live GPT-5.6 interpretation | Missing | Must not claim |
| Live Codex repair/review | Missing | Must not claim |
| Browser/deployment/submission | Missing | Must not claim |
