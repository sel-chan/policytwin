# OpenAI and Codex usage

Codex was the primary build environment for architecture, implementation, testing, security review, documentation, and deadline triage. The primary collaboration task ID for the required `/feedback` submission field is `019f5dcf-0233-7a80-9147-af10c7bbfb28`.

The challenge runner is pinned to `gpt-5.6` and uses `@openai/codex-sdk` plus bundled CLI 0.144.6 with the existing Codex login. It is disabled unless `POLICYTWIN_LOCAL_CHALLENGE_APPROVED=1` is set. The runner rejects provider API-key inheritance, disables web search and network tools inside the fixture task, permits changes only to `src/refund.ts` and `tests/refund.test.mjs`, runs fixed server-owned commands, checks all 41 accepted cases, and requires a distinct read-only Codex review.

This local challenge evidence is not the production `pnpm verify:live` gate. It does not claim direct Responses API evidence, cgroup-v2 isolation, deployment security, or a trusted production attestation. Those claims remain explicitly false unless their separate authoritative gates run.
