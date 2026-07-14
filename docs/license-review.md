# License review

Status: `OWNER_DECISION_REQUIRED`

The repository currently has no project runtime dependencies and no bundled third-party binary. Node.js, pnpm, Git, TypeScript, Codex CLI, and Docker are environment tools rather than redistributed project assets at this checkpoint.

A project license has not been selected because accepting a license is an owner decision under `AGENTS.md`. MIT is a common permissive candidate for a public challenge repository, but this document does not grant that license.

Before publication:

1. the owner selects/accepts the project license;
2. `LICENSE` is added with the correct copyright holder;
3. every installed package and the pinned OPA/container distribution are inventoried;
4. `NOTICE.md` is updated from resolved licenses;
5. `pnpm license:check` passes.
