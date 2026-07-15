# OpenAI and Codex usage

DRAFT_NOT_READY — generated from partial offline evidence; do not submit.

Status: NOT_RUN_LIVE.

The intended live path uses GPT-5.6 through the Responses API for strict semantic interpretation and delegates one complete repair run to an external supervisor. Its concrete TLS 1.3 transport mutually authenticates CA-chained and certificate-pinned peers, fixes the server name and ALPN, bounds one canonical request/response frame, and persists one-use request-ID/nonce state in SQLite. The host RPC contract additionally binds the fixed write/command/corpus policy, host-known baseline and signed final tree manifests, trusted supervisor signature, separate immutable verification workspace, and teardown receipt. Current transport tests use an explicit signed `FAIL` executor double; no OS-isolated worker or live Codex turn exists. No submission may claim live OpenAI/Codex work until `pnpm verify:live` captures fresh request/run evidence.
