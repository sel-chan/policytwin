# Testing instructions

Requirements: Node.js 22+, pnpm 11.7+, and the checksum-pinned OPA 1.18.2 binary described in the README.

```powershell
pnpm install --frozen-lockfile
pnpm opa:install
pnpm demo:run
pnpm dev
```

Open `http://localhost:3000` and review Policy Studio, Decision Queue, Case Lab, Integration / Drift, Proof, and Change Impact. The deterministic demo must report exactly three seeded defects, the Case Lab must show OPA 41/41, and the Integration view must show 16 drift witnesses.

For the complete offline verification suite, run `pnpm verify`. The stricter production live gate is intentionally separate and must not be treated as a prerequisite for the locally reproducible challenge walkthrough.

To validate the checked-in GPT-5.6/Codex challenge capture, run `pnpm challenge:check`, then inspect `artifacts/challenge-evidence/summary.md` and `artifacts/challenge-evidence/integration.diff`. The expected result is `LOCAL_CHALLENGE_PASS`, regression tests 7/7, policy cases 41/41, zero drift, and review `APPROVE`.
