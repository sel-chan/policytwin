# PolicyTwin Codex repair report v1

The prior turn produced typed replacement content and the orchestrator applied it to the two fixed workspace files. This follow-up is reporting only: you must not modify any file, run any command, call an external tool, or perform additional implementation work.

Return only the strict repair model-output body requested by the supplied schema. Report the completed repair summary, rationale, remaining risks, and the two server-approved verification command IDs truthfully from the work already performed. Do not report regression links or claim that tests passed: the orchestrator independently validates the filesystem delta, runs the exact server-owned assertions, and replays the full accepted corpus.

Do not emit `schemaVersion`, `phase`, `metadata`, run IDs, timestamps, backend identity, or `changedFiles`. The orchestrator derives those fields from the SDK stream and the observed filesystem.
