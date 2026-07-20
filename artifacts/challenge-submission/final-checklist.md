# Devpost handoff checklist

- [x] Project title, tagline, descriptions, build narrative, OpenAI/Codex usage, and testing instructions are prepared.
- [x] Primary Codex `/feedback` session ID is recorded.
- [x] Local 2:48 public-upload candidate is 1920×1080 with an AAC audio track and synchronized captions.
- [x] Deterministic judge path is `pnpm demo:run`; full offline gate is `pnpm verify`.
- [x] Owner authorizes the bounded logged-in Codex GPT-5.6 challenge run.
- [x] MIT project license is present with `Copyright (c) 2026 CHAN`.
- [x] Run and validate the approved bounded GPT-5.6 local challenge capture; treat outputs only as a structurally consistent non-production capture.
- [x] Repository is public and anonymously readable, and `links.json` is updated.
- [x] The exact reviewed MP4 is public on YouTube, and `links.json` is updated.
- [x] Anonymous repository and YouTube oEmbed checks, browser audio/video decoding, and the public Devpost entry check pass.
- [x] The public Devpost page shows PolicyTwin submitted to OpenAI Build Week.
- [ ] Capture the strict Devpost confirmation screenshot/object required by the separate production submission ledger.

The production `verify:live` gate is a separate, stricter security target and is not represented as completed by this challenge handoff.
