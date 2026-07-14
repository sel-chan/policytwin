# PolicyTwin

**Turn policy text into verified product behavior.**

PolicyTwin is an evidence-first policy engineering product for OpenAI Build Week. It turns a natural-language SaaS refund policy into a versioned executable contract, exposes ambiguity and application drift, and produces reviewable proof.

## Current status

The repository now includes:

- strict `PolicyIR`, clause traceability, immutable ambiguity decisions, and SQLite-backed versions;
- a deterministic PolicyIR-to-Rego compiler and checksum-pinned OPA 1.18.2 execution over 41 accepted cases;
- boundary, conflict, contrast, differential, and mutation checks that expose all three seeded TypeScript defects;
- a server-only GPT-5.6 Responses adapter contract with strict structured output, full-source traceability, golden-case contradiction blocking, bounded retries, and a token-gated HTTP route;
- Policy Studio, an anonymous-session-isolated SQLite Decision Queue, Case Lab, Integration/Drift, Proof, and blocked Change Impact views in Next.js;
- Chrome E2E coverage for all six views, browser-session isolation, versioned decision/source writes, CSRF rejection, golden-conflict blocking, complete evidence downloads, keyboard navigation, and a 390px mobile layout;
- a complete, hash-covered `PARTIAL_OFFLINE` evidence package, adversarial semantic validation, a byte-deterministic 38-file USTAR download, and fail-closed submission drafts.

The repository is **not submission-ready**. Fresh GPT-5.6 and Codex runs, actual Codex repair evidence, container health, deployment, video, repository/submission URLs, an owner-selected project license, and confirmation are still missing. The evidence package therefore remains `FAIL / PARTIAL_OFFLINE` by design.

## Architecture

```mermaid
flowchart LR
  A["Refund policy + golden cases"] --> B["GPT-5.6 interpretation"]
  B --> C["Validated PolicyIR"]
  C --> D["Versioned ambiguity decisions"]
  D --> E["Deterministic Rego compiler"]
  E --> F["OPA + generated cases"]
  F --> G["TypeScript differential runner"]
  G --> H["Codex repair in trusted copy"]
  H --> I["Regression + mutation + review"]
  I --> J["Hash-covered proof package"]
  J --> K["Trusted live attestation"]
```

Model output never becomes the final executable policy. The validated IR is compiled deterministically, every rule traces to source clauses, and golden-case contradictions fail closed.

## Local setup

Requirements:

- Node.js 22 or newer;
- pnpm 11.7 or newer;
- Chrome for E2E tests;
- OPA 1.18.2 at `.tools/opa/1.18.2/opa.exe` on Windows, or an explicit `OPA_PATH`.

```powershell
pnpm install --frozen-lockfile
pnpm opa:install
pnpm evidence:offline
pnpm dev
```

Open `http://localhost:3000`. Package installation and `pnpm opa:install` require network access on a new machine; the OPA installer downloads and verifies the official pinned binary. If the exact pnpm store is already populated, `pnpm install --offline --frozen-lockfile` is the deterministic offline alternative. If OPA is already installed, set `OPA_PATH` instead.

Copy `.env.example` to a local ignored environment file when exercising live integrations or overriding the local SQLite path:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Server-side Responses API access; never expose to the browser |
| `OPENAI_MODEL` | Configurable model, default `gpt-5.6` |
| `POLICYTWIN_RUN_TOKEN` | High-entropy token required by `POST /api/interpret` |
| `POLICYTWIN_ATTESTATION_PUBLIC_KEYS_JSON` | Trusted Ed25519 public-key map used to verify live evidence downloads; never a private key |
| `NEXT_PUBLIC_SITE_URL` | Absolute site URL used for metadata |
| `POLICYTWIN_PUBLIC_ORIGIN` | Exact browser-facing origin for workspace mutation checks; HTTPS is mandatory in production |
| `OPA_PATH` | Optional verified OPA executable override |
| `POLICYTWIN_DATABASE_PATH` | Optional absolute SQLite file path; defaults to ignored `.data/policytwin.sqlite` |

Without `POLICYTWIN_RUN_TOKEN`, the live interpretation route returns `LIVE_RUN_DISABLED`. No live model claim is made from recorded fixtures.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm eval
pnpm build
pnpm demo:reset
pnpm demo:run
pnpm evidence:offline
pnpm security:check
pnpm clean:check
pnpm verify
pnpm verify:live
pnpm container:check
pnpm submission:check
```

`pnpm demo:reset` removes only the default ignored demo SQLite file and restores the trusted fixture; stop the development server first on Windows. It fails closed when `POLICYTWIN_DATABASE_PATH` points elsewhere and never deletes that custom file. Browser sessions receive separate seeded projects; new sessions require same-origin fetch metadata, expire after 24 hours, and are capped at 128 per process. This is bounded demo isolation, not user authentication or a multi-instance storage design. `pnpm demo:run` must report exactly three seeded drifts. `pnpm verify` is the deterministic offline gate; it currently fails only on explicitly incomplete owner/external release gates. `pnpm verify:live` must capture fresh GPT-5.6 and Codex evidence before completion.

Browser evidence is under `artifacts/screenshots/`. Machine-readable proof is under `artifacts/evidence/`; every unavailable live result is labeled `NOT_RUN` rather than simulated. The evidence API exposes every required artifact individually, and the Proof view builds `/api/evidence/archive` in memory from the exact 38-file allowlist, so transient files are never collected.

The downloadable USTAR package proves the seeded reference choices (`purchase day 0`, request-time usage, and default denial). It is byte-stable for the same package, uses the archive SHA-256 as its ETag, keeps the semantic evidence hash in a separate response header, and fails closed on missing, extra, tampered, credential-shaped, or personal-path content. Proof compares the browser session's validated PolicyIR meaning with that reference before showing a match, and Change Impact refuses to create v5 when the choices differ.

The SHA-256 manifest detects payload changes but is not an authenticity credential by itself. A future `LIVE_VERIFIED` package must also carry a fresh Ed25519 attestation over its evidence hash, run ID, and timestamp from a trusted `verify:live` key held outside the repository; the default verification window is 24 hours. The validator independently recomputes the compiler output, accepted-case OPA agreement, differential records, mutation score, traceability, Codex command evidence, and structured GPT/browser/container/deployment/security proofs.

`pnpm clean:check` validates a source-only copy against the current machine's existing pnpm store, verified OPA path, and Chrome installation. It is not a claim that a network-disconnected fresh machine already has those prerequisites.

## Safety boundary

Only the bundled trusted refund fixture may be executed or modified. Uploaded or arbitrary repositories are never executed by the hosted flow. Secrets, absolute personal paths, and live credentials are excluded from evidence and screenshots.

Self-rehashing an edited evidence package cannot promote it to `LIVE_VERIFIED`: live status requires both semantic consistency and a trusted detached signature. No private attestation key belongs in this repository.

PolicyTwin is a software verification aid, not legal advice. Real policy deployment requires human approval.

Read `AGENTS.md`, `PLAN.md`, `PROGRESS.md`, `DECISIONS.md`, and `SUBMISSION.md` before changing the implementation.
