# PolicyTwin architecture

Status: partial offline implementation. Dashed responsibilities require approved external integration.

```mermaid
flowchart LR
  U["Policy owner"] --> W["Web workspace"]
  W --> O["Policy orchestrator"]
  O --> I["GPT-5.6 interpreter"]
  O --> P["Validated PolicyIR"]
  P --> C["Deterministic Rego compiler"]
  C --> R["OPA runner"]
  P --> G["Case and mutation engine"]
  G --> D["Differential runner"]
  R --> D
  D --> F["Trusted fixture copy"]
  D --> X["Codex repair worker"]
  X --> F
  E --> A["Evidence validator"]
  A --> S["Live Ed25519 attestation"]
  O --> E["SQLite + evidence store"]
  P --> E
  C --> E
  G --> E
  D --> E
  X --> E
```

Implemented offline:

- strict refund input and `PolicyIR` validation;
- explicit ambiguity patches and state transitions;
- deterministic Rego source generation;
- policy-derived cases, conflicts, contrasts, and mutation execution;
- reference differential reports for canonical and evaluation-only fixtures;
- guarded repair-worker contracts and isolated trusted copies;
- change impact, traceability, aggregate evidence hashes, semantic cross-checks, and a trusted live-attestation boundary;
- SQLite-backed policy, version, lifecycle, golden-case, and decision persistence with restart recovery;
- framework-independent workspace orchestration for current-state reads, immutable text versions, and atomic ambiguity resolution;
- checksum-pinned OPA 1.18.2 compile/evaluation over all 41 accepted cases;
- a five-view Next.js workspace, health/evidence/interpret routes, and local Chrome E2E coverage.

Not yet authoritative:

- GPT-5.6 and Codex nodes still require fresh credentialed runs and signed live evidence;
- the Decision Queue UI is evidence-backed but not yet wired to persisted write APIs;
- mutation execution remains reference-based rather than OPA-backed;
- the application container, deployed health check, live browser run, and deployment do not exist.

The offline persistence adapter uses Node.js 22's built-in experimental `node:sqlite` API behind `SQLitePolicyRepository`. Production readiness remains unclaimed until the current official API contract, selected container runtime, backup behavior, and deployment persistence volume are verified.

The application boundary accepts only the bundled `seeded-refund-demo` fixture for write execution. Policy text is untrusted semantic input; it never becomes executable code directly.
