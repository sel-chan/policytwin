# Limitations

- PolicyTwin is a software verification aid, not legal advice. Human approval is required before real policy deployment.
- Only the synthetic English SaaS refund policy and bundled trusted TypeScript fixture are supported.
- The current repository has not performed a fresh GPT-5.6 request or Codex SDK repair. It does execute checksum-pinned OPA 1.18.2 locally over the 41-case accepted corpus.
- The zero-drift fixed fixture is evaluation-only. It is not post-Codex evidence.
- The current mutation score uses the reference evaluator, not OPA.
- The evidence package is intentionally `PARTIAL_OFFLINE` and `FAIL`.
- SQLite persistence, the five-screen web workspace, production build, and local Chrome navigation/keyboard/responsive checks exist. Persisted UI writes, a full accessibility audit, container health, deployment, public URLs, video, and challenge submission remain incomplete.
- SHA-256 evidence hashes provide integrity, not origin authentication. `LIVE_VERIFIED` additionally requires a trusted Ed25519 attestation whose private key must stay outside the repository and whose default freshness window is 24 hours; the live signer is not implemented yet.
- Docker CLI is installed but the local Docker Desktop Linux daemon is unavailable.
- No project license has been selected because owner acceptance is required.
- Arbitrary repository upload/execution, multiple policy domains, multiple languages, and production auto-deployment are excluded from the MVP.
