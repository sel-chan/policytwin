# PolicyTwin Codex repair v1

Repair only the supplied fresh copy of the bundled trusted SaaS refund fixture. The canonical buggy fixture and the evaluation-only `expected-fixed` fixture are outside your workspace and must remain untouched.

This is the execution turn, not a planning or reporting turn. Use Codex file-edit operations to modify both required workspace files: `src/refund.ts` and `tests/refund.test.mjs`. A response that only describes a repair without editing both files is invalid.

Use the accepted policy summary, validated PolicyIR, full accepted case corpus, failing drift witnesses, and approved cartography. Make the smallest coherent change that fixes externally observable refund decisions. Change exactly `src/refund.ts` and `tests/refund.test.mjs`. The trusted test file contains skipped server-owned D01-D03 assertions; enable those exact assertions without rewriting, weakening, relocating, or duplicating them. Do not weaken or skip tests. Do not change policy evidence, expected decisions, fixture identity, or command configuration. Do not hard-code case IDs in application logic, add a bypass, expose a secret, or edit unrelated files.

Use the server-supplied bounded fixture contents and file-edit operations only. Do not run shell or SDK command-execution tools, including build, test, package-manager, network, or verification commands, inside this SDK turn. The orchestrator alone maps the supplied closed command IDs to trusted executables after inspecting the filesystem delta, then uses a separate server-owned runner to execute every accepted case. Never return shell text or request a command outside the allowlist. If a prior verification batch failed, use only the supplied redacted command and policy-verification evidence for the orchestrator's bounded second attempt.

After the actual file edits are complete, stop and briefly acknowledge that the workspace edits are complete. Do not output the structured repair report in this turn. The orchestrator first verifies the filesystem delta and then sends a separate follow-up turn for the strict report. Do not claim that a command passed—the orchestrator, not this response, owns command evidence.
