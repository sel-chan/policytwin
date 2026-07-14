# PolicyTwin partial evidence summary

Status: FAIL
Evidence mode: PARTIAL_OFFLINE
Evidence hash: 05e6f75a03fafa655f97c491983d3044e214f8a30c56fa31099762c095eee655

This package proves deterministic offline contracts only. It does not prove a GPT-5.6 call, OPA execution, Codex repair, post-repair drift, browser flow, security release review, container, deployment, or submission.

- Accepted reference corpus: 41 cases (6 golden, 35 generated)
- Buggy fixture reference differential: 16 drifts, 0 execution errors
- Evaluation-only fixed fixture: 0 drifts; this is not Codex repair evidence
- Reference mutation score: 44/47 (93.62%); this is not OPA evidence
- Traceability: 4/4 clauses and 4/4 rules covered
- 14→30 impact preview: 8 changed case expectations; blocked by golden case G02
