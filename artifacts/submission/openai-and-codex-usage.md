# OpenAI and Codex usage

DRAFT_NOT_READY — generated from partial offline evidence; do not submit.

Status: NOT_RUN_LIVE.

The intended live path uses GPT-5.6 through the Responses API for strict semantic interpretation and delegates one complete repair run to an external supervisor whose future transport must enforce mTLS or protected local-socket authentication. The host RPC contract binds a single-use request, declared-length streamed response, fixed write/command/corpus policy, host-known baseline and signed final tree manifests, trusted supervisor signature, separate immutable verification workspace, and teardown receipt. Its current authentication mode is an interface precondition only; no transport or worker exists yet. Current files contain prompts, schemas, offline SDK streams, signed RPC test doubles, and safety controls only. No submission may claim live OpenAI/Codex work until `pnpm verify:live` captures fresh request/run evidence.
