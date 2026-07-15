import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT } from "./process.mjs";

const submissionDirectory = resolve(ROOT, "artifacts", "submission");
const demoDirectory = resolve(ROOT, "artifacts", "demo");
for (const [directory, expected] of [
  [submissionDirectory, resolve(ROOT, "artifacts", "submission")],
  [demoDirectory, resolve(ROOT, "artifacts", "demo")],
]) {
  if (directory !== expected || relative(ROOT, directory).startsWith("..")) {
    throw new Error(`Refusing to replace unmanaged artifact directory: ${directory}`);
  }
}

function jsonFile(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
}

function write(directory, name, content) {
  writeFileSync(join(directory, name), content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const verification = jsonFile("artifacts/evidence/verification-summary.json");
const manifest = jsonFile("artifacts/evidence/evidence-manifest.json");
const security = jsonFile("artifacts/security/security-report.json");
const clean = jsonFile("artifacts/security/clean-checkout-report.json");
const challengeRules = jsonFile("config/build-week-rules.v1.json");
const mutationRate = (verification.mutation.killRate * 100).toFixed(2);
const draft = "DRAFT_NOT_READY — generated from partial offline evidence; do not submit.";

rmSync(submissionDirectory, { recursive: true, force: true });
rmSync(demoDirectory, { recursive: true, force: true });
mkdirSync(submissionDirectory, { recursive: true });
mkdirSync(demoDirectory, { recursive: true });

write(submissionDirectory, "title.txt", `PolicyTwin\n${draft}`);
write(submissionDirectory, "tagline.txt", `Turn policy text into verified product behavior.\n${draft}`);
write(
  submissionDirectory,
  "short-description.txt",
  `${draft}\nPolicyTwin is an evidence-first policy engineering prototype that structures SaaS refund rules, generates executable Rego and edge cases, verifies them with checksum-pinned OPA 1.18.2, exposes drift in a TypeScript fixture, and prepares a guarded Codex repair workflow. The six-view Next.js workspace, persisted decision flow, blocked change-impact draft, byte-deterministic 38-file proof archive, and local Chrome E2E flow are verified; live GPT-5.6 and Codex repair/review, real-Docker isolation and egress evidence, and deployment evidence remain unavailable.`,
);
write(
  submissionDirectory,
  "long-description.md",
  `# PolicyTwin\n\n${draft}\n\nBusiness policies live in prose while customer decisions live in code. PolicyTwin is designed to connect a policy sentence to an explicit decision, deterministic rule, edge cases, application behavior, code location, and reviewable proof.\n\nThe current offline build validates strict PolicyIR, resolves genuine ambiguity through closed persisted patches, generates byte-stable Rego, verifies 41 traceable cases with checksum-pinned OPA 1.18.2, detects 16 mismatches in a deliberately buggy refund fixture, executes 47 policy mutants, maps a blocked 14-to-30 change into a text-only v5 draft, renders a six-view web workspace, passes local Chrome E2E checks, and produces a hash-covered, semantically validated evidence package with a deterministic 38-file USTAR download.\n\nThe critical challenge path is not complete. The package status is **FAIL / PARTIAL_OFFLINE** because fresh GPT-5.6, live Codex repair/review, dynamic Docker isolation and egress health, deployment, video, and submission have not run. A live package additionally requires a trusted Ed25519 attestation.`,
);
write(
  submissionDirectory,
  "inspiration.md",
  `# Inspiration\n\n${draft}\n\nA policy can say “including day 14” while code uses \`< 14\`. It can say final sale always wins while an earlier approval branch bypasses that rule. These tiny implementation differences create inconsistent customer outcomes. PolicyTwin explores how policy owners and engineers can share executable evidence rather than relying on prose or generated code alone.`,
);
write(
  submissionDirectory,
  "what-it-does.md",
  `# What it does\n\n${draft}\n\nPolicyTwin interprets a refund policy into a constrained intermediate representation, records unresolved decisions, compiles accepted meaning deterministically, generates boundary/conflict/contrast cases, compares those cases with a trusted TypeScript fixture, and prepares a guarded Codex repair and independent-review workflow. Policy Studio, Decision Queue, Case Lab, Integration/Drift, Proof, and Change Impact views expose the current offline evidence without presenting it as a live repair.`,
);
write(
  submissionDirectory,
  "how-we-built-it.md",
  `# How we built it\n\n${draft}\n\nImplemented: strict TypeScript contracts, deterministic clause segmentation and Rego generation, checksum-pinned OPA 1.18.2 compilation and evaluation, reference mutation execution, deterministic trusted-fixture overlay contracts, closed repair command IDs, SQLite-backed immutable policy/version persistence with restart recovery, versioned same-origin/CSRF-protected decision and source routes, a server-only GPT-5.6 Responses adapter contract, a real TLS 1.3 mutually authenticated external-worker transport, bounded supervisor, durable request-ID/nonce replay store, signed RPC client contract with exact tree-manifest delta validation, split non-root worker, verifier, and egress Dockerfiles and static launch contracts with explicit restart=no; a shell-free supervisor Docker driver constrained to a canonical local CLI, request/nonce-bound resource IDs, supervisor-owned inspect and cleanup checks, zero-restart enforcement, and pinned container ID/PID/start-time reobservation around worker execution; Linux cgroup-v2 observation requirements; and a TLS 1.3-only probe that sends no HTTP. These Docker controls are verified only by static checks and a fake daemon. The repository also includes a six-view Next.js workspace, Chrome E2E checks, blocked impact/traceability reports, SHA-256 evidence manifests, semantic claim recomputation, a closed and sensitive-content-guarded 38-file USTAR archive, a trusted Ed25519 live-attestation boundary, security/history scans, and clean-copy replay.\n\nNot yet verified: a fresh GPT-5.6 response; immutable image builds and runtime identity on a real Docker daemon; observed worker, verifier, and egress isolation, cgroup teardown, restart behavior, and the TLS-only probe; proxy outbound traffic and OpenAI DNS/SNI/header behavior; live Codex SDK repair and review; production SQLite container persistence; live attestation signing; and deployment.`,
);
write(
  submissionDirectory,
  "challenges.md",
  `# Challenges\n\n${draft}\n\nThe core challenge is preserving truth across boundaries: model interpretation cannot become executable code, golden cases cannot be overwritten, evaluation fixtures cannot impersonate a repair, and recorded results cannot impersonate fresh work. The offline implementation therefore keeps every unavailable external gate explicit and failing.`,
);
write(
  submissionDirectory,
  "accomplishments.md",
  `# Accomplishments\n\n${draft}\n\nCurrent offline evidence only:\n\n- ${verification.golden.passed}/${verification.golden.total} golden and ${verification.generated.passed}/${verification.generated.total} generated cases pass real OPA 1.18.2 evaluation.\n- The buggy fixture exposes ${verification.driftBefore} reference-expectation corpus drifts (not OPA-backed), including all three seeded defects.\n- ${verification.mutation.killed}/${verification.mutation.total} mutants are killed (${mutationRate}%) under the reference mutation evaluator; mutation execution has not yet moved to OPA.\n- ${verification.traceability.clausesCovered}/${verification.traceability.clausesTotal} clauses and ${verification.traceability.rulesCovered}/${verification.traceability.rulesTotal} rules are linked.\n- The evaluation-only fixed fixture has zero drift, but this is not a Codex repair claim.`,
);
write(
  submissionDirectory,
  "learnings.md",
  `# Learnings\n\n${draft}\n\nAmbiguity is versioned product data, not a prompting failure. Generated code is not proof. Mutation testing makes a case corpus measurable. Most importantly, provenance labels and failing gates are part of the product: a missing model call or repair cannot be repaired with persuasive copy.`,
);
write(
  submissionDirectory,
  "whats-next.md",
  `# What's next\n\n${draft}\n\nComplete a fresh GPT-5.6 run; provide verified immutable image digests and a canonical Docker CLI on a Linux cgroup-v2 host; run the prepared worker/verifier and TLS-only egress gates on a real daemon; observe proxy outbound and OpenAI upstream behavior; then execute and verify a live Codex SDK repair/review behind the authenticated supervisor transport. After that, connect live run state to the six-screen workspace, finish deployment, select a project license, record the demo, complete owner eligibility declarations, and submit. Post-challenge expansion remains outside the MVP.`,
);
write(
  submissionDirectory,
  "technologies.txt",
  `${draft}\nImplemented offline: TypeScript, Node.js, pnpm, Next.js 16, React 19, Playwright with Chrome, Node.js built-in SQLite persistence and durable RPC replay state, OpenAI Responses adapter contract, TLS 1.3 mutual-authentication transport, bounded signed external-worker supervisor/RPC contract, Rego source generation, OPA 1.18.2, split non-root worker/verifier/egress Dockerfiles, a shell-free canonical-local-Docker supervisor driver, fake-daemon ID/inspect/cleanup and no-restart running-instance tests, cgroup-v2 observer requirements, a TLS 1.3-only no-HTTP probe, and Git.\nPlanned/unverified: fresh GPT-5.6 Structured Output, immutable image build and execution on a real Docker daemon, dynamic isolation, restart behavior, and cgroup teardown, a real egress TLS probe, measured proxy outbound/OpenAI traffic, live Codex SDK work, dynamic SQLite container persistence, and deployment.`,
);
write(
  submissionDirectory,
  "openai-and-codex-usage.md",
  `# OpenAI and Codex usage\n\n${draft}\n\nStatus: NOT_RUN_LIVE.\n\nThe intended live path uses GPT-5.6 through the Responses API for strict semantic interpretation and delegates one complete repair run to an external supervisor. Its concrete TLS 1.3 transport mutually authenticates CA-chained and certificate-pinned peers, fixes the server name and ALPN, bounds one canonical request/response frame, and persists one-use request-ID/nonce state in SQLite. The host RPC contract additionally binds the fixed write/command/corpus policy, host-known baseline and signed final tree manifests, trusted supervisor signature, separate immutable verification workspace, and teardown receipt. The repository also contains non-root worker, verifier, and egress images; a shell-free supervisor Docker driver restricted to a canonical local CLI and request-bound resource IDs; supervisor-owned inspect and cleanup rules; explicit restart=no, zero restart counts, and pinned container ID/PID/start-time reobservation around worker execution; Linux cgroup-v2 observation requirements; and a TLS 1.3-only internal probe that writes no HTTP. The mTLS transport tests still use a signed \`FAIL\` executor double, while the separate Docker driver is tested only against a fake daemon and is not wired to a live mTLS result. Both real-Docker gates currently stop before daemon use because the immutable Node base is unset. No immutable role image, real restart/network/cgroup/teardown observation, egress TLS probe, proxy outbound measurement, OpenAI upstream request, or live Codex SDK turn has occurred. No submission may claim live OpenAI/Codex work until \`pnpm verify:live\` captures fresh request/run evidence.`,
);
write(
  submissionDirectory,
  "judging-evidence-map.md",
  `# Judging evidence map\n\n${draft}\n\n| Criterion | Current evidence | Status |\n|---|---|---|\n| Technical implementation | \`artifacts/evidence/\`, real OPA execution, compiler/case/mutation/differential/worker contracts | PARTIAL_OFFLINE |\n| Design and UX | Six Next.js views, seven local Chrome captures, and a truthful architecture image in \`artifacts/screenshots/\` | LOCAL_BROWSER_PASS |\n| Potential impact | Persisted policy decisions, blocked 14-to-30 draft, drift narrative, and counterexamples | DRAFT |\n| Quality of idea | Evidence-first separation of semantics, execution, repair, and proof | DRAFT |`,
);
write(
  submissionDirectory,
  "links.json",
  json({
    schemaVersion: "1",
    status: "NOT_READY",
    liveUrl: null,
    repositoryUrl: null,
    videoUrl: null,
    submissionUrl: null,
  }),
);
write(
  submissionDirectory,
  "screenshots.md",
  `# Screenshots\n\n${draft}\n\nLocal captures completed:\n\n- \`01-policy-studio.png\`\n- \`02-decision-queue.png\`\n- \`03-case-lab-drift.png\`\n- \`04-integration-drift.png\` (baseline drift view; not the required live Codex repair capture)\n- \`05-proof.png\`\n- \`06-change-impact.png\` (blocked reference preview; not a fresh OPA/Codex run)\n- \`07-mobile-or-responsive.png\`\n- \`08-architecture.png\` (repository-native architecture snapshot; live paths are explicitly not run)\n\nSubmission-required capture still missing: \`04-codex-repair.png\`.`,
);
write(
  submissionDirectory,
  "rules-check.md",
  `# Official rules check\n\n${draft}\n\nStatus: ${challengeRules.status}\nChecked at: ${challengeRules.checkedAt}\n\nOfficial deadline: ${challengeRules.dates.submissionDeadlinePacific} (${challengeRules.dates.submissionDeadlineKorea}).\n\nSelected track: ${challengeRules.selectedTrack} — ${challengeRules.selectedTrackRationale}\n\nOwner eligibility declarations remain pending; verified location context: ${challengeRules.eligibility.location}\n\n## Submission requirements\n\n${challengeRules.submissionRequirements.map((item) => `- ${item}`).join("\n")}\n\n## Source precedence and discrepancy\n\n${challengeRules.sourcePriority}\n\n${challengeRules.knownDiscrepancies.map((item) => `- ${item}`).join("\n")}\n\n## Official sources\n\n${challengeRules.sources.map((source) => `- ${source.title}: ${source.url} (${source.result})`).join("\n")}\n\nThe Devpost Hackathons plugin is optional and is not the source of truth.`,
);
write(
  submissionDirectory,
  "claim-audit.md",
  `# Claim audit\n\n${draft}\n\n| Claim | Evidence | Allowed wording |\n|---|---|---|\n| 41 accepted policy cases | \`artifacts/evidence/opa-results.json\`, \`artifacts/evidence/verification-summary.json\` | Real local OPA 1.18.2 execution |\n| 16 buggy-fixture corpus drifts | \`artifacts/evidence/drift-report-before.json\` | Reference expectations from the accepted policy corpus, not OPA-backed |\n| ${verification.mutation.killed}/${verification.mutation.total} mutants killed | \`artifacts/evidence/mutation-report.json\` | Reference evaluator, not OPA |\n| Evaluation-only fixed fixture has zero drift | \`artifacts/evidence/drift-report-after.json\` | Never call post-repair |\n| Deterministic 38-file USTAR archive | \`src/evidence/archive.ts\`, integration and browser tests | Recorded reference package only |\n| Six-view browser flow with v1-v5 persistence | \`tests/e2e/workspace.spec.ts\`, \`artifacts/screenshots/\` | Local Chrome E2E only; impact is reference preview |\n| Docker supervisor and egress isolation | \`container-contract.json\`, \`tests/unit/supervisor-docker-driver.test.mjs\`, worker/egress container reports | Static and fake-daemon verification only; real Docker, immutable images, cgroup/TLS/upstream traffic, and Codex remain unverified |\n| Live GPT-5.6 interpretation | Missing | Must not claim |\n| Live Codex repair/review | Missing | Must not claim |\n| Deployment/submission | Missing | Must not claim |`,
);
write(
  submissionDirectory,
  "final-checklist.md",
  `# Final checklist\n\n${draft}\n\n- [x] Official rules verified on ${challengeRules.checkedAt}\n- [ ] Owner-selected LICENSE present\n- [ ] \`pnpm verify\` passes\n- [ ] \`pnpm verify:live\` passes with fresh evidence\n- [ ] Browser screenshots complete\n- [ ] Live, repository, and video URLs verified signed out\n- [ ] Video satisfies official duration/format\n- [ ] Claim audit has no missing proof\n- [ ] Submission confirmation captured`,
);
write(
  submissionDirectory,
  "submission-state.json",
  json({
    schemaVersion: "1",
    status: "NOT_READY",
    evidenceHash: manifest.evidenceHash,
    evidenceStatus: verification.status,
    staticSecurityStatus: security.status,
    cleanCopyStatus: clean.status,
    rulesStatus: challengeRules.status,
    confirmation: null,
  }),
);
write(
  submissionDirectory,
  "submission-check-report.json",
  json({
    schemaVersion: "1",
    status: "NOT_RUN",
    checkedSubmissionFiles: 20,
    checkedDemoDraftFiles: 4,
    requiredScreenshots: 8,
    failures: ["Submission checker has not run after draft generation."],
  }),
);

write(
  demoDirectory,
  "demo-script.md",
  `# Three-minute demo script\n\n${draft}\n\n0:00–0:20 — Show D01–D03 and explain policy drift.\n0:20–0:50 — Show strict GPT-5.6 interpretation and clause links. NOT YET RUN.\n0:50–1:15 — Resolve the three genuine ambiguity decisions.\n1:15–1:40 — Show deterministic Rego, 41 cases, and qualified ${mutationRate}% reference mutation score.\n1:40–2:00 — Show the three seeded counterexamples.\n2:00–2:30 — Show live Codex cartography, patch, tests, and review. NOT YET RUN.\n2:30–2:50 — Show actual post-repair zero drift and proof. NOT YET RUN.\n2:50–3:00 — Show 14→30 impact and the G02 contradiction block.`,
);
write(
  demoDirectory,
  "shot-list.md",
  `# Shot list\n\n${draft}\n\n1. Policy Studio and source clauses — local browser capture complete.\n2. Persisted Decision Queue — local browser capture complete.\n3. Case Lab with D01–D03 — local browser capture complete.\n4. Codex repair timeline and diff — missing live run/UI.\n5. Proof view and deterministic archive download — partial FAIL view captured; live proof missing.\n6. Blocked 14-to-30 Change Impact — local browser capture complete.\n7. Responsive view — local 390px capture complete.\n8. End card with verified URLs — missing.`,
);
write(
  demoDirectory,
  "captions.srt",
  `1\n00:00:00,000 --> 00:00:20,000\n[DRAFT — not recorded] This policy includes day 14, exactly 20 percent usage, and final-sale precedence.\n\n2\n00:00:20,000 --> 00:00:50,000\nPolicyTwin is intended to use GPT-5.6 to create a strict, traceable policy model. Live call not yet verified.\n\n3\n00:00:50,000 --> 00:01:15,000\nMaterial ambiguity becomes an explicit versioned decision instead of a hidden guess.\n\n4\n00:01:15,000 --> 00:01:40,000\nA deterministic compiler and OPA 1.18.2 verify 41 accepted policy cases.\n\n5\n00:01:40,000 --> 00:02:00,000\nThe reference-expectation comparison, which is not OPA-backed, exposes the three seeded defects.\n\n6\n00:02:00,000 --> 00:02:30,000\nThe intended Codex repair path is not yet verified and must be replaced with a real run before recording.\n\n7\n00:02:30,000 --> 00:02:50,000\nPost-repair proof is not yet available; the evaluation-only fixed fixture cannot substitute.\n\n8\n00:02:50,000 --> 00:03:00,000\nA 14-to-30-day change updates rules and cases, while a contradictory golden case blocks verification.`,
);
write(
  demoDirectory,
  "demo-data.json",
  json({
    schemaVersion: "1",
    status: "DRAFT_NOT_RECORDED",
    evidenceHash: manifest.evidenceHash,
    caseCount: verification.golden.total + verification.generated.total,
    driftBefore: verification.driftBefore,
    postRepairDrift: null,
    evaluationOnlyFixedFixtureDrift: verification.evaluationOnlyFixedFixtureDrift,
    mutation: verification.mutation,
    externalGates: verification.externalGates,
  }),
);

console.log(`Generated NOT_READY submission and demo drafts for evidence ${manifest.evidenceHash}.`);
