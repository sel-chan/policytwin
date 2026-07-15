# PolicyTwin Codex Goal Pack — Start Here

This pack is designed to let Codex build **PolicyTwin** from an empty or partial repository, validate it, deploy it, and prepare the OpenAI Build Week submission.

## Important command name

The official command is **`/goal`**, not `/goals`.

A `/goal` objective is intentionally short. The full product definition and working rules live in this repository so Codex can keep them across a long-running task.

## Files in this pack

| File | Purpose |
|---|---|
| `AGENTS.md` | Durable repository rules Codex loads automatically |
| `PLAN.md` | Product specification, architecture, milestones, tests, and definition of done |
| `PROGRESS.md` | Persistent checkpoint and evidence log Codex must maintain |
| `DECISIONS.md` | Durable record of technical and product decisions |
| `SUBMISSION.md` | Deployment, demo, judging, and challenge-submission checklist |
| `GOAL_PROMPT.md` | Ready-to-paste `/goal` command plus recovery prompts |
| `START_HERE_KO.md` | Concise Korean setup and recovery guide |

## Recommended setup

1. Create or open the repository that will contain PolicyTwin.
2. Copy every file in this pack to the repository root.
3. Initialize Git if needed and create a baseline commit on the current branch. Do not create another branch or worktree unless the owner explicitly changes that rule.
4. Start Codex from the repository root.
5. Make sure Goal mode is available.
6. Allow local edits and tests as appropriate. Separately approve a clearly stated external network scope before dependency installation, official-document lookup, Git push, deployment, upload, or submission. Keep account logins and destructive actions reviewable.
7. Add secrets through the environment or a secret manager, never by committing them:
   - `OPENAI_API_KEY` for GPT-5.6 Responses API calls
   - the current supported Codex CLI/SDK authentication; the prepared worker uses command-backed authentication to obtain only a per-run proxy capability, while the provider credential stays outside the worker
   - optional deployment-provider credentials
   - optional GitHub authentication
8. Open `GOAL_PROMPT.md`, copy the main command, and paste it into Codex.

If `/goal` is missing, use one of these official options:

```bash
codex features enable goals
```

or add this to `~/.codex/config.toml`:

```toml
[features]
goals = true
```

Restart Codex after changing configuration.

## Before starting the goal

Run this once inside Codex:

```text
Summarize the active repository instructions and confirm that you loaded AGENTS.md, PLAN.md, PROGRESS.md, DECISIONS.md, and SUBMISSION.md. Do not implement anything yet.
```

The expected response should mention the product scope, required verification loop, progress logging, and submission end state.

## Verification gates

- `pnpm verify` is the deterministic offline gate. It must not require credentials, network access, or fresh model output.
- `pnpm container:verify`, `pnpm worker:verify`, and `pnpm egress:verify` are separate non-live Docker prerequisites for web health, worker/verifier isolation, and the TLS-only egress path. The latter two require inspected-ID ownership and Linux cgroup v2 teardown. The TLS probe writes no HTTP, but proxy outbound traffic is not measured. A fake-only three-role CPU ledger now proves static aggregation and receipt-validation order, while explicitly claiming no enforcement or hard limit. The live gate rejects that proof and any unbound boolean until a signed real-Linux cgroup proof exists.
- Worker RPC v2 now defines a separate candidate envelope for a future real-Linux three-role CPU result: client execution binding, request-and-role-derived Docker binding, structured live-purpose trust with distinct key material, durable replay, separate mTLS ALPN/frame, exact role arithmetic, and cleanup. The generic v2 supervisor is fail-only; the candidate still lacks a signed global event transcript and CPU-failure evidence union. Current loopback integration signs `FAIL`, synthetic unit proofs are not runtime evidence, and the live gate rejects every available result.
- `pnpm verify:live` is the fresh GPT-5.6 and Codex integration gate. It requires the approved network scope and safe credentials.
- The offline and live authoritative gates, plus every required dynamic prerequisite, must pass before engineering or submission is complete; recorded evidence cannot replace `pnpm verify:live`.

## During the run

Use these commands without starting a new thread:

```text
/goal
```

Shows the current goal.

```text
Give me a compact status recap: current milestone, verified evidence, next action, blockers, and the latest commit.
```

```text
/goal pause
/goal resume
/goal edit
/goal clear
```

Use pause before disconnecting or before an external account action that needs manual review.

## External-account boundary

Codex can complete the repository, tests, deployment configuration, screenshots, demo script, and submission copy offline where possible. Actual documentation lookup, publishing, deployment, upload, and submission begin only after the owner approves the corresponding network scope and the environment exposes the required browser/account access.

It must **not** claim that GitHub, hosting, video upload, or Devpost submission succeeded without verifiable URLs or confirmation evidence. When a login, terms acceptance, payment, CAPTCHA, or owner-only action is unavoidable, Codex must:

1. finish every independent task first;
2. record the blocker in `PROGRESS.md`;
3. present one exact owner action;
4. pause the goal;
5. resume immediately after that action.

## Success state

The run is complete only when `SUBMISSION.md` reaches one of these truthful states:

- **SUBMITTED** — live app, public repository, demo video, and challenge confirmation are verified; or
- **READY_FOR_OWNER_ACTION** — every artifact is finished and exactly one unavoidable account action remains.

`READY_FOR_OWNER_ACTION` is not permission to leave unfinished engineering work.

## Official references

- Goal mode: https://developers.openai.com/codex/use-cases/follow-goals/
- Slash commands: https://developers.openai.com/codex/cli/slash-commands
- `AGENTS.md`: https://developers.openai.com/codex/guides/agents-md
- Codex best practices: https://developers.openai.com/codex/learn/best-practices
- OpenAI Build Week: https://openai.com/build-week/
