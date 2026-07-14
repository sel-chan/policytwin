# PolicyTwin partial evidence summary

Status: FAIL
Evidence mode: PARTIAL_OFFLINE
Evidence hash: 4b046b707d238da3d5de04e86bcf3e7218af81d301f0f3186e041a5c0b4cdbf1

This package proves deterministic offline contracts and real OPA v1.18.2 execution. It does not prove a GPT-5.6 call, Codex repair, post-repair drift, browser flow, security release review, container, deployment, or submission.

- Accepted OPA corpus: 41/41 cases (6 golden, 35 generated)
- Buggy fixture reference differential: 16 drifts, 0 execution errors
- Evaluation-only fixed fixture: 0 drifts; this is not Codex repair evidence
- Reference mutation score: 44/47 (93.62%); mutation execution is not yet OPA-backed
- Traceability: 4/4 clauses and 4/4 rules covered
- 14→30 impact preview: 8 changed case expectations; blocked by golden case G02
