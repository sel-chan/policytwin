# Devpost handoff checklist

- [x] Project title, tagline, descriptions, build narrative, OpenAI/Codex usage, and testing instructions are prepared.
- [x] Primary Codex `/feedback` session ID is recorded.
- [x] Local 2:48 public-upload candidate is 1920×1080 with an AAC audio track and synchronized captions.
- [x] Deterministic judge path is `pnpm demo:run`; full offline gate is `pnpm verify`.
- [x] Owner authorizes the bounded logged-in Codex GPT-5.6 challenge run.
- [x] MIT project license is present with `Copyright (c) 2026 CHAN`.
- [ ] Run and validate the approved bounded GPT-5.6 local challenge capture; treat outputs only as a structurally consistent non-production capture.
- [ ] Repository is published or privately shared according to the official rules, and `links.json` is updated.
- [ ] The exact local MP4 is uploaded to public YouTube, and `links.json` is updated.
- [ ] Signed-out repository and video checks pass.
- [ ] Devpost declarations, terms, preview, and final submit are completed by the owner.

The production `verify:live` gate is a separate, stricter security target and is not represented as completed by this challenge handoff.
