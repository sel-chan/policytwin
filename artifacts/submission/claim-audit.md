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
| Worker RPC v2 CPU evidence contract | `src/codex/live-linux-cgroup-cpu-evidence-v2.ts`, `tests/unit/live-linux-cgroup-cpu-evidence-v2.test.mjs`, v2 client/mTLS tests | Parser/signature/binding/tamper/replay/downgrade tests only; synthetic PASS fixtures and loopback signed FAIL are not Linux, Docker, CPU-enforcement, model, or Codex evidence |
| Live GPT-5.6 interpretation | Missing | Must not claim |
| Live Codex repair/review | Missing | Must not claim |
| Deployment/submission | Missing | Must not claim |

Worker RPC v2 transport admission is factory-identity-bound: the concrete v2 mTLS client module owns a private WeakSet, snapshots validated scalar options plus defensive copies of CA/certificate/key buffers and arrays, only its actual factory freezes and adds an admissible object, and no arbitrary registrar exists. The client rejects self-declared, v1, copied, or wrapped transports, while later caller mutation cannot redirect or corrupt the admitted connection profile; scripted response and option-mutation tests use the concrete factory over TLS 1.3 loopback. This is offline host-boundary evidence only; the supervisor remains FAIL-only and no live transport, Linux CPU proof, model call, or Codex repair is claimed.

CPU evidence v2 now has an internal synthetic-only state-machine producer. It snapshots Docker identity inputs, serializes the three-role transcript, recomputes bindings and unsigned-64 arithmetic, records overage and cleanup failures, and returns only a frozen UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE wrapper with liveClaim=false and passSigningEligible=false. It rejects a port that self-declares Linux provenance and is not exported from the package root. The enclosed raw evidence remains parser-valid contract data and is not provenance or signer authorization. This is contract evidence only: no kernel adapter, Docker start barrier, bounded independent cleanup lifecycle, PASS signer, cpu.stat observation, or real containment exists.

The schema-v10 non-live cgroup observer contract now requires an exact Docker cgroup component, cgroup-v2 filesystem, a private O_DIRECTORY/O_NOFOLLOW directory descriptor with device/inode identity, bounded descriptor-relative reads, full uint64 BigInt CPU arithmetic, descendant populated=0, explicit sample failure, initial-PID absence, original-cgroup release, and sticky normal/recovery cleanup-action failures. Offline parser and source-tamper tests cover this boundary. It has not run on Linux or Docker, still takes a post-start baseline, is not the private live adapter, and cannot authorize signing or live admission.
