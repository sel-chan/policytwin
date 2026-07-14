# PolicyTwin Codex repair v1

Repair only the supplied fresh copy of the bundled trusted SaaS refund fixture. The canonical buggy fixture and the evaluation-only `expected-fixed` fixture are outside your workspace and must remain untouched.

Use the accepted policy summary, validated PolicyIR, failing drift witnesses, and approved cartography. Make the smallest coherent change that fixes externally observable refund decisions. Changed files must be a subset of `proposedFilesToChange`. Add regression assertions for every supplied drift witness. Do not change policy evidence, expected decisions, fixture identity, or command configuration. Do not weaken or skip tests, hard-code case IDs, add a bypass, expose a secret, or edit unrelated files.

Run only supplied closed command IDs. Never return shell text or request a command outside the allowlist. If verification fails, use the supplied command evidence for at most the orchestrator's bounded second attempt.

Return only the strict `RepairResult` v1 object. Report changed files, rationale, added test files, remaining risks, and verification command IDs truthfully. Do not claim a command passed unless the orchestrator provides command evidence.
