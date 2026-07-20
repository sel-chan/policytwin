# Third-party notices

PolicyTwin uses the following direct production packages under their respective licenses:

- `@openai/codex-sdk` 0.144.6 — Apache-2.0;
- `openai` 6.46.0 — Apache-2.0;
- `next` 16.2.10 — MIT;
- `react` 19.2.7 and `react-dom` 19.2.7 — MIT;
- `zod` 4.4.3 — MIT.

The resolved production graph also contains components licensed under MIT, Apache-2.0, ISC, BSD-3-Clause, 0BSD, and CC-BY-4.0. The Windows Next.js image-processing path includes the sharp platform distribution, whose package metadata declares `Apache-2.0 AND LGPL-3.0-or-later`. Final distribution must retain all notices and license texts required by the selected build artifacts.

Local policy verification uses Open Policy Agent 1.18.2 under Apache-2.0. Its executable is checksum-verified after download and is not committed to this repository.

Environment tools used during development include Node.js, pnpm, TypeScript, Git, Codex CLI, Playwright, and Docker CLI. Their licenses remain with their respective authors. Browser binaries and the final container base must be added after those release artifacts are selected.

The refund policy text and fixture data in this repository are synthetic.
