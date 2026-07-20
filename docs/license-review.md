# License review

Status: `OWNER_DECISION_REQUIRED`

The repository now has six direct production dependencies locked to exact versions: `@openai/codex-sdk` 0.144.6, `next` 16.2.10, `openai` 6.46.0, `react` 19.2.7, `react-dom` 19.2.7, and `zod` 4.4.3. The official OPA 1.18.2 executable is downloaded into ignored `.tools/` for local verification and is not committed.

Resolved package metadata reports the direct OpenAI packages under Apache-2.0 and Next.js, React, React DOM, and Zod under MIT. The resolved graph also includes MIT, Apache-2.0, ISC, BSD-3-Clause, 0BSD, CC-BY-4.0, and the Windows sharp distribution's declared `Apache-2.0 AND LGPL-3.0-or-later` licensing. OPA is Apache-2.0. This is an inventory, not legal advice or a grant of a project license.

A project license has not been selected because accepting a license is an owner decision under `AGENTS.md`. MIT is a common permissive candidate for a public challenge repository, but this document does not grant that license.

Before publication:

1. the owner selects/accepts the project license;
2. `LICENSE` is added with the correct copyright holder;
3. the final production-only dependency graph, browser distribution, OPA, and container base are re-inventoried on the release platform;
4. any required license texts and attributions are included in the distributed artifact;
5. `NOTICE.md` is refreshed from the final resolved graph;
6. `pnpm license:check` passes.

Current evidence commands:

```text
pnpm list --prod --depth 0
pnpm licenses list --prod --json
pnpm license:check
```
