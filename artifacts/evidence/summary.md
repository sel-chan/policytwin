# PolicyTwin partial evidence summary

Status: FAIL
Evidence mode: PARTIAL_OFFLINE
Evidence hash: 99f8da5a9c28356d0b6eef4a92e0ae5f8460de14a9f35a80197a98f1c3f588b9

This package proves deterministic offline contracts and real OPA v1.18.2 execution. It does not prove a GPT-5.6 call, Codex repair, post-repair drift, browser flow, security release review, container, deployment, or submission.

- Accepted OPA corpus: 41/41 cases (6 golden, 35 generated)
- Buggy fixture reference differential: 16 drifts, 0 execution errors
- Evaluation-only fixed fixture: 0 drifts; this is not Codex repair evidence
- Reference mutation score: 44/47 (93.62%); mutation execution is not yet OPA-backed
- Traceability: 4/4 clauses and 4/4 rules covered
- 14→30 impact preview: 8 changed case expectations; blocked by golden case G02
