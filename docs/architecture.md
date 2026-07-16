# PolicyTwin architecture

Status: partial offline implementation. Dashed responsibilities require approved external integration.

```mermaid
flowchart LR
  U["Policy owner"] --> W["Web workspace"]
  W --> O["Policy orchestrator"]
  O -.-> I["GPT-5.6 interpreter (live disabled)"]
  O --> P["Validated PolicyIR"]
  P --> C["Deterministic Rego compiler"]
  C --> R["OPA runner"]
  P --> G["Case and mutation engine"]
  G --> D["Differential runner"]
  R --> D
  D --> Q["Authentication-required single-run RPC"]
  Q -.-> X["External Codex supervisor (live disabled)"]
  X -.-> B["Run-capability Responses broker"]
  B -.-> API["api.openai.com /v1/responses"]
  X -.-> W1["Disposable two-file repair workspace"]
  X -.-> V["Immutable reconstructed verification workspace"]
  E --> A["Evidence validator"]
  A --> T["Deterministic 38-file USTAR archive"]
  A -.-> S["Live Ed25519 attestation (not issued)"]
  O --> E["SQLite + evidence store"]
  P --> E
  C --> E
  G --> E
  D --> E
  X -.-> E
```

Implemented offline:

- strict refund input and `PolicyIR` validation;
- explicit ambiguity patches and state transitions;
- deterministic Rego source generation;
- policy-derived cases, conflicts, contrasts, and mutation execution;
- reference differential reports for canonical and evaluation-only fixtures;
- guarded repair-worker contracts, isolated trusted copies, a pinned server-side Codex SDK-compatible adapter contract, and a Node TLS 1.3 mutual-authentication client/supervisor with fixed CA/name/certificate pins/ALPN, one bounded canonical request/response frame, a durable SQLite request-ID/nonce replay store, single-active-run cancellation, immutable image/baseline/corpus bindings, baseline/final tree-manifest delta validation, and trusted Ed25519 supervisor receipts;
- change impact, traceability, aggregate evidence hashes, semantic cross-checks, a closed byte-deterministic 38-file USTAR download, and a trusted live-attestation boundary;
- SQLite-backed policy, version, lifecycle, golden-case, and decision persistence with restart recovery;
- framework-independent workspace orchestration for current-state reads, immutable text versions, and atomic ambiguity resolution;
- checksum-pinned OPA 1.18.2 compile/evaluation over all 41 accepted cases;
- a six-view Next.js workspace with real versioned decision/source writes, health/evidence/interpret/workspace routes, and local Chrome E2E coverage.
- a fail-closed standalone web Dockerfile contract that excludes the live Codex worker and requires an immutable Node image digest before dynamic build;
- separate static worker/verifier/egress Dockerfiles and deterministic lifecycle contracts that fix non-root users, read-only roots, dropped capabilities, resource ceilings, a read-only baseline plus exactly two writable file overlays, a credential-free `network=none` verifier, and external-only broker secrets;
- a shell-free Docker driver that pins a canonical Docker executable and local daemon, derives per-run names and exact labels from the request plus a 128-bit supervisor nonce, promotes returned 64-hex IDs only after independent identity inspection, performs every later operation by ID, and closes container/network/port/mount/namespace/environment observations. Every process explicitly uses `restart=no`; inspect requires zero restarts, and the driver pins ID/PID/start timestamp then reobserves the same running egress instance around worker execution and before stop. The supervisor seals the worker image and request maxima. Memory and swap are equal; PID, per-file output, and one-file local-log limits plus one prepare/worker/verifier execution deadline are request-bound and independently inspected. Cleanup has a separate bounded grace period. A required CPU-controller port now holds worker/verifier receipts as raw JSON until a fake-only BigInt ledger finalizes one request/binding/identity-bound aggregate over egress, worker, and verifier. Its proof keeps enforcement, hard-limit, overshoot, and containment claims false, and cleanup failure poisons the lifecycle. No real `cpu.stat` sampling, polling, freeze, or kill is implemented. Stateful fake-daemon/controller tests prove ordering and fail-closed cleanup. The separate schema-v10 non-live observer requires an exact Docker cgroup path, cgroup-v2 filesystem, private directory descriptor plus device/inode identity, full uint64 `bigint` samples, `populated=0` subtree quiescence, initial-PID absence, original-cgroup release, and sticky teardown-action results for `worker:verify` and `egress:verify`; it has only offline contract coverage, takes its baseline after start, and is not the private live adapter;
- a contract-only Worker RPC v2 and CPU evidence schema v2. V2 separates protocol/signature/ALPN/frame from v1, requires mutual TLS plus durable replay, and rejects live keys whose Ed25519 material overlaps the general v1 registry. Required `cpuEvidence` binds request/execution/image/policy/corpus and either a global monotonic three-role success transcript or a closed failure outcome. Success is derived from exact lifecycle/sample linkage, egress-worker overlap, verifier ordering, arithmetic, stop, and release; failure branches bind partial attempts, containment actions/results, and remaining processes without inventing a complete Docker binding. An internal synthetic-only producer serializes this state machine and emits frozen unsigned/non-live wrappers whose current signing eligibility is false. It is absent from the package barrel and rejects self-declared Linux provenance; its raw parser-valid evidence is contract data, not provenance or authorization. The generic supervisor remains fail-only, and no capability-bound Linux adapter or dedicated live lifecycle feeds the contract;
- an identity-only v2 transport capability. The concrete v2 mTLS client module owns a private `WeakSet`; its actual factory validates and snapshots scalar options, defensively copies CA/certificate/key buffers and CA arrays, freezes and adds only the resulting transport, and exposes no arbitrary registrar. The client rejects self-declared, v1, copied, and wrapped transports before request construction, while caller mutation after construction cannot change the private connection snapshot. Scripted response-validation fixtures and supervisor integration both use real TLS 1.3 loopback peers plus the concrete factory;
- a prepared worker entrypoint that validates the canonical RPC request, empty fixed `CODEX_HOME`, proxy token, and CA mount but can emit only a non-live disabled receipt; command-backed Codex provider authentication reads a 256-bit per-run capability rather than a provider credential;
- a Responses-only reverse-broker implementation and local fake-upstream integration test. It fixes method/path/authority, request and response byte limits, bounded lease use, header/framing rules, no redirects or compression, public-IPv4 DNS selection, a pinned IP connection, and OpenAI SNI/certificate/Host identity. This remains static/offline evidence until the prepared container and real upstream path run.

Proof and Change Impact are bound to the recorded reference policy by a deterministic semantic fingerprint covering version, clauses, rules, ambiguity selections, defaults, normalization, and the input schema. Opaque per-session IDs and model provenance are excluded from that equality check. A mismatch is shown explicitly and blocks the reference 14-to-30 draft; it never re-labels the static evidence or its archive as proof for a different session policy. The archive route reads no directory listing: it loads exactly `REQUIRED_EVIDENCE_FILES`, validates the full package and any live attestation, rejects sensitive content, and emits fixed USTAR headers and ordering in memory.

Not yet authoritative:

- GPT-5.6 and Codex nodes still require fresh credentialed execution and signed live evidence. The mTLS transport and bounded supervisor are verified on real loopback sockets with ephemeral certificates, but v1 and v2 injected integration executors emit only explicit signed `FAIL` test results. A concrete Docker driver now connects the generic lifecycle to fixed commands and supervisor observations, but only through fake-runner tests; it is not enabled as a signed live executor. The web, worker/verifier, and TLS-only egress dynamic gates all fail before Docker at the unset immutable base. Worker RPC v2 can carry strictly parsed signed CPU evidence v2, and the internal synthetic producer can build only wrappers ineligible for current signing/admission; no real Linux controller produces evidence and the live gate still admits none. The probe writes no HTTP and performs no SDK turn, but proxy outbound traffic is not measured; the host live-backend factory still rejects;
- the 14-to-30 impact candidate is a persisted text-only `DRAFT`; it is not accepted PolicyIR and remains blocked by G02;
- mutation execution remains reference-based rather than OPA-backed;
- the web, worker, verifier, and egress Dockerfiles and daemon-free static checks exist, but their image digests, dynamic container health/isolation, actual TLS probe, live OpenAI/Codex path, live browser run, and deployment do not.

The offline persistence adapter uses Node.js 22's built-in experimental `node:sqlite` API behind `SQLitePolicyRepository`. Each anonymous browser session maps to a hashed internal project ID; only same-origin browser fetches may create a session, expired projects are removed after 24 hours, and a process stores at most 128 active anonymous projects. Public-origin and HTTPS configuration is validated before project creation, and every mutation rechecks server-side expiry before writing. Browser mutations accept only the public seeded policy ID, version path, and closed option/source body; an exact configured production origin, an HttpOnly SameSite session and CSRF cookie, a matching custom header, byte and ten-second body limits, and a single-process write gate protect the route. Production readiness remains unclaimed until authentication, shared quotas, the selected container runtime, backup behavior, distributed coordination, and deployment persistence volume are verified.

The application boundary accepts only the bundled `seeded-refund-demo` fixture for write execution. Policy text is untrusted semantic input; it never becomes executable code directly.
