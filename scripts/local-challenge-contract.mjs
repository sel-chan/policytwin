import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const LOCAL_CHALLENGE_FILES = Object.freeze([
  "integration.diff",
  "local-challenge-run.json",
  "summary.md",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,255}$/u;
const COMMIT_ID = /^[0-9a-f]{40,64}$/u;
const CHANGED_FILES = Object.freeze(["src/refund.ts", "tests/refund.test.mjs"]);
const PHASES = Object.freeze(["cartography", "repair", "review"]);
const CANONICAL_SOURCE_POLICY = readFileSync(
  new URL("../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const CANONICAL_POLICY_IR = JSON.parse(
  readFileSync(new URL("../artifacts/evidence/policy-ir.json", import.meta.url), "utf8"),
);
const CANONICAL_ACCEPTED_CASES = Object.freeze([
  ...JSON.parse(
    readFileSync(new URL("../artifacts/evidence/golden-cases.json", import.meta.url), "utf8"),
  ),
  ...JSON.parse(
    readFileSync(new URL("../artifacts/evidence/generated-cases.json", import.meta.url), "utf8"),
  ),
]);
const CANONICAL_SOURCE_SHA256 = createHash("sha256")
  .update(CANONICAL_SOURCE_POLICY)
  .digest("hex");
const CANONICAL_POLICY_IR_SHA256 = createHash("sha256")
  .update(JSON.stringify(CANONICAL_POLICY_IR))
  .digest("hex");
const CANONICAL_CORPUS_SHA256 = createHash("sha256")
  .update(JSON.stringify(CANONICAL_ACCEPTED_CASES))
  .digest("hex");
const TOP_LEVEL_KEYS = Object.freeze([
  "authentication",
  "claims",
  "commands",
  "completedAt",
  "model",
  "policyVerification",
  "profile",
  "provenance",
  "repair",
  "review",
  "schemaVersion",
  "startedAt",
  "status",
  "surface",
  "tooling",
]);
const SCHEMA = JSON.parse(
  readFileSync(new URL("../schemas/local-challenge-run.v1.schema.json", import.meta.url), "utf8"),
);

function exactKeys(value, expected, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value;
}

function threadId(value, label) {
  if (typeof value !== "string" || !THREAD_ID.test(value)) {
    throw new Error(`${label} must be a bounded Codex thread ID.`);
  }
  return value;
}

function timestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function phaseHashes(value, label) {
  const record = exactKeys(value, PHASES, label);
  for (const phase of PHASES) sha256(record[phase], `${label}.${phase}`);
  return record;
}

function sameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index])
  );
}

export function validateLocalChallengeSchemaContract() {
  if (
    SCHEMA?.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    SCHEMA?.additionalProperties !== false ||
    !sameMembers(SCHEMA.required, TOP_LEVEL_KEYS) ||
    !sameMembers(Object.keys(SCHEMA.properties ?? {}), TOP_LEVEL_KEYS) ||
    SCHEMA.properties?.schemaVersion?.const !== "1" ||
    SCHEMA.properties?.profile?.const !== "LOCAL_CHALLENGE" ||
    SCHEMA.properties?.status?.const !== "LOCAL_CHALLENGE_PASS" ||
    SCHEMA.properties?.model?.const !== "gpt-5.6" ||
    SCHEMA.properties?.surface?.const !== "CODEX_CLI_OUTPUT_SCHEMA" ||
    SCHEMA.properties?.authentication?.properties?.mode?.const !==
      "EXISTING_CODEX_LOGIN_TEMPORARY_AUTH_COPY" ||
    SCHEMA.properties?.tooling?.properties?.sdkVersion?.const !== "0.144.3" ||
    SCHEMA.properties?.tooling?.properties?.bundledCliVersion?.const !== "0.144.3" ||
    !sameMembers(SCHEMA.properties?.repair?.required, [
      "status",
      "cartographyThreadId",
      "repairThreadIds",
      "changedFiles",
      "preCommandTreeSha256",
      "postCommandTreeSha256",
      "diffSha256",
    ]) ||
    !sameMembers(SCHEMA.properties?.commands?.required, [
      "status",
      "orderedIds",
      "receipts",
      "receiptsSha256",
    ]) ||
    !sameMembers(SCHEMA.properties?.policyVerification?.required, [
      "status",
      "total",
      "passed",
      "drift",
      "results",
      "resultsSha256",
    ])
  ) {
    throw new Error("Local challenge JSON Schema and runtime contract are out of sync.");
  }
  return true;
}

export function validateLocalChallengeRun(input) {
  validateLocalChallengeSchemaContract();
  const value = exactKeys(input, TOP_LEVEL_KEYS, "local challenge run");
  if (
    value.schemaVersion !== "1" ||
    value.profile !== "LOCAL_CHALLENGE" ||
    value.status !== "LOCAL_CHALLENGE_PASS" ||
    value.model !== "gpt-5.6" ||
    value.surface !== "CODEX_CLI_OUTPUT_SCHEMA"
  ) {
    throw new Error("Local challenge identity is invalid.");
  }

  const authentication = exactKeys(
    value.authentication,
    [
      "credentialMaterialCaptured",
      "explicitApiKeyProvided",
      "mode",
      "temporaryAuthCopyCreated",
      "temporaryAuthCopyRemovedBeforeEvidence",
      "temporaryAuthDirectoryRestricted",
    ],
    "local challenge authentication",
  );
  if (
    authentication.mode !== "EXISTING_CODEX_LOGIN_TEMPORARY_AUTH_COPY" ||
    authentication.explicitApiKeyProvided !== false ||
    authentication.credentialMaterialCaptured !== false ||
    authentication.temporaryAuthCopyCreated !== true ||
    authentication.temporaryAuthCopyRemovedBeforeEvidence !== true ||
    authentication.temporaryAuthDirectoryRestricted !== true
  ) {
    throw new Error("Local challenge authentication boundary is invalid.");
  }

  const tooling = exactKeys(
    value.tooling,
    ["bundledCliVersion", "externalCliVersion", "sdkVersion"],
    "local challenge tooling",
  );
  if (
    tooling.sdkVersion !== "0.144.3" ||
    tooling.bundledCliVersion !== "0.144.3" ||
    typeof tooling.externalCliVersion !== "string" ||
    !/^0\.144\.[0-9]+$/u.test(tooling.externalCliVersion)
  ) {
    throw new Error("Local challenge tooling versions are invalid.");
  }

  const provenance = exactKeys(
    value.provenance,
    [
      "acceptedCorpusSha256",
      "acceptedPolicyIrSha256",
      "outputSchemaSha256s",
      "promptSha256s",
      "repositoryCommit",
      "runId",
      "sourceInputSha256",
    ],
    "local challenge provenance",
  );
  if (typeof provenance.runId !== "string" || !/^lc_[0-9a-f]{16}$/u.test(provenance.runId)) {
    throw new Error("Local challenge run ID is invalid.");
  }
  if (typeof provenance.repositoryCommit !== "string" || !COMMIT_ID.test(provenance.repositoryCommit)) {
    throw new Error("Local challenge repository commit is invalid.");
  }
  for (const key of ["acceptedCorpusSha256", "acceptedPolicyIrSha256", "sourceInputSha256"]) {
    sha256(provenance[key], `local challenge provenance.${key}`);
  }
  if (
    provenance.sourceInputSha256 !== CANONICAL_SOURCE_SHA256 ||
    provenance.acceptedPolicyIrSha256 !== CANONICAL_POLICY_IR_SHA256 ||
    provenance.acceptedCorpusSha256 !== CANONICAL_CORPUS_SHA256
  ) {
    throw new Error("Local challenge provenance is not bound to the canonical seeded inputs.");
  }
  phaseHashes(provenance.promptSha256s, "local challenge prompt hashes");
  phaseHashes(provenance.outputSchemaSha256s, "local challenge output-schema hashes");

  const repair = exactKeys(
    value.repair,
    [
      "cartographyThreadId",
      "changedFiles",
      "diffSha256",
      "postCommandTreeSha256",
      "preCommandTreeSha256",
      "repairThreadIds",
      "status",
    ],
    "local challenge repair",
  );
  if (
    repair.status !== "PASS" ||
    !Array.isArray(repair.changedFiles) ||
    JSON.stringify(repair.changedFiles) !== JSON.stringify(CHANGED_FILES) ||
    !Array.isArray(repair.repairThreadIds) ||
    repair.repairThreadIds.length < 1 ||
    repair.repairThreadIds.length > 2
  ) {
    throw new Error("Local challenge repair result is invalid.");
  }
  const threadIds = [
    threadId(repair.cartographyThreadId, "local challenge cartography thread"),
    ...repair.repairThreadIds.map((item, index) =>
      threadId(item, `local challenge repair thread ${index + 1}`),
    ),
  ];
  for (const key of ["diffSha256", "postCommandTreeSha256", "preCommandTreeSha256"]) {
    sha256(repair[key], `local challenge repair.${key}`);
  }

  const commands = exactKeys(
    value.commands,
    ["orderedIds", "receipts", "receiptsSha256", "status"],
    "local challenge commands",
  );
  if (
    commands.status !== "PASS" ||
    JSON.stringify(commands.orderedIds) !==
      JSON.stringify(["fixture-typecheck", "fixture-test"])
  ) {
    throw new Error("Local challenge command evidence is invalid.");
  }
  if (!Array.isArray(commands.receipts) || commands.receipts.length !== 2) {
    throw new Error("Local challenge must retain the exact two command receipts.");
  }
  const commandIds = ["fixture-typecheck", "fixture-test"];
  for (const [index, receiptValue] of commands.receipts.entries()) {
    const receipt = exactKeys(
      receiptValue,
      [
        "attempt",
        "commandId",
        "durationMs",
        "exitCode",
        "fixtureTreeAfterSha256",
        "fixtureTreeBeforeSha256",
        "outputTruncated",
        "repairRunId",
        "schemaVersion",
        "stderr",
        "stdout",
        "timedOut",
      ],
      `local challenge command receipt ${index + 1}`,
    );
    if (
      receipt.schemaVersion !== "1" ||
      receipt.commandId !== commandIds[index] ||
      receipt.exitCode !== 0 ||
      receipt.timedOut !== false ||
      receipt.outputTruncated !== false ||
      !Number.isInteger(receipt.durationMs) ||
      receipt.durationMs < 0 ||
      receipt.attempt !== repair.repairThreadIds.length ||
      receipt.repairRunId !== repair.repairThreadIds.at(-1) ||
      typeof receipt.stdout !== "string" ||
      receipt.stdout.length > 4_096 ||
      typeof receipt.stderr !== "string" ||
      receipt.stderr.length > 4_096
    ) {
      throw new Error(`Local challenge command receipt ${index + 1} is invalid.`);
    }
    sha256(receipt.fixtureTreeBeforeSha256, `local challenge command ${index + 1} pre-tree`);
    sha256(receipt.fixtureTreeAfterSha256, `local challenge command ${index + 1} post-tree`);
  }
  if (
    commands.receipts[0].fixtureTreeBeforeSha256 !== repair.preCommandTreeSha256 ||
    commands.receipts[0].fixtureTreeAfterSha256 !==
      commands.receipts[1].fixtureTreeBeforeSha256 ||
    commands.receipts[1].fixtureTreeBeforeSha256 !==
      commands.receipts[1].fixtureTreeAfterSha256 ||
    commands.receipts[1].fixtureTreeAfterSha256 !== repair.postCommandTreeSha256
  ) {
    throw new Error("Local challenge command receipts do not bind the pre/post command trees.");
  }
  sha256(commands.receiptsSha256, "local challenge command receipts");
  if (createHash("sha256").update(JSON.stringify(commands.receipts)).digest("hex") !== commands.receiptsSha256) {
    throw new Error("Local challenge command receipt digest is invalid.");
  }

  const policyVerification = exactKeys(
    value.policyVerification,
    ["drift", "passed", "results", "resultsSha256", "status", "total"],
    "local challenge policy verification",
  );
  if (
    policyVerification.status !== "PASS" ||
    policyVerification.total !== 41 ||
    policyVerification.passed !== 41 ||
    policyVerification.drift !== 0
  ) {
    throw new Error("Local challenge policy verification must be 41/41 with zero drift.");
  }
  if (!Array.isArray(policyVerification.results) || policyVerification.results.length !== 41) {
    throw new Error("Local challenge must retain all 41 policy-verification results.");
  }
  const caseIds = new Set();
  for (const [index, resultValue] of policyVerification.results.entries()) {
    const result = exactKeys(
      resultValue,
      ["actualDecision", "caseId", "error", "expectedDecision", "status"],
      `local challenge policy result ${index + 1}`,
    );
    const canonicalCase = CANONICAL_ACCEPTED_CASES[index];
    if (
      canonicalCase === undefined ||
      typeof result.caseId !== "string" ||
      result.caseId.length < 1 ||
      result.caseId.length > 128 ||
      caseIds.has(result.caseId) ||
      !["ALLOW", "DENY", "REVIEW"].includes(result.expectedDecision) ||
      result.actualDecision !== result.expectedDecision ||
      result.caseId !== canonicalCase.id ||
      result.expectedDecision !== canonicalCase.expectedDecision ||
      result.status !== "PASS" ||
      result.error !== null
    ) {
      throw new Error(`Local challenge policy result ${index + 1} is not the canonical ordered case.`);
    }
    caseIds.add(result.caseId);
  }
  sha256(policyVerification.resultsSha256, "local challenge policy-verification results");
  if (
    createHash("sha256").update(JSON.stringify(policyVerification.results)).digest("hex") !==
    policyVerification.resultsSha256
  ) {
    throw new Error("Local challenge policy-verification digest is invalid.");
  }

  const review = exactKeys(
    value.review,
    ["blockingFindings", "status", "threadId", "verdict"],
    "local challenge review",
  );
  if (
    review.status !== "PASS" ||
    review.verdict !== "APPROVE" ||
    review.blockingFindings !== 0
  ) {
    throw new Error("Local challenge review is not approved.");
  }
  threadIds.push(threadId(review.threadId, "local challenge review thread"));
  if (new Set(threadIds).size !== threadIds.length) {
    throw new Error("Local challenge phases must use distinct Codex thread IDs.");
  }

  const claims = exactKeys(
    value.claims,
    [
      "authoritativeVerifyLive",
      "cgroupV2Verified",
      "liveAttestationPresent",
      "productionIsolationVerified",
      "releaseEvidenceEligible",
      "responsesApiDirectlyVerified",
    ],
    "local challenge claims",
  );
  if (Object.values(claims).some((claim) => claim !== false)) {
    throw new Error("Local challenge evidence cannot promote a production or release claim.");
  }

  const startedAt = timestamp(value.startedAt, "local challenge start time");
  const completedAt = timestamp(value.completedAt, "local challenge completion time");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("Local challenge completion precedes its start.");
  }
  return structuredClone(value);
}

export function renderLocalChallengeSummary(run) {
  return `# PolicyTwin local challenge capture\n\nStatus: **${run.status}**\n\n- Model and surface: \`${run.model}\` through \`${run.surface}\` using the existing login from a temporary config-free, auth-only Codex home.\n- Disposable fixture repair: \`${run.repair.changedFiles.join("\`, \`")}\`.\n- Server-owned verification: **${run.policyVerification.passed}/${run.policyVerification.total}**, zero drift.\n- Independent review: **${run.review.verdict}**, zero blocking findings.\n\nThis is a local Build Week capture. It is not the production \`verify:live\` gate, not release evidence, and does not claim direct Responses API provenance, cgroup-v2 isolation, deployment security, or live attestation.\n`;
}

export function validateLocalChallengeDirectory(directory) {
  const root = resolve(directory);
  const entries = readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  if (
    entries.length !== LOCAL_CHALLENGE_FILES.length ||
    entries.some(
      (entry, index) =>
        entry.name !== LOCAL_CHALLENGE_FILES[index] ||
        !entry.isFile() ||
        entry.isSymbolicLink(),
    )
  ) {
    throw new Error("Local challenge evidence directory must contain the exact three regular files.");
  }
  for (const name of LOCAL_CHALLENGE_FILES) {
    const stat = lstatSync(resolve(root, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024 * 1024) {
      throw new Error(`Local challenge artifact is missing, linked, empty, or too large: ${name}.`);
    }
  }
  const run = validateLocalChallengeRun(
    JSON.parse(readFileSync(resolve(root, "local-challenge-run.json"), "utf8")),
  );
  const diff = readFileSync(resolve(root, "integration.diff"), "utf8");
  if (
    createHash("sha256").update(diff, "utf8").digest("hex") !== run.repair.diffSha256 ||
    (diff.match(/^diff --git /gmu) ?? []).length !== 2 ||
    !diff.includes("diff --git a/src/refund.ts b/src/refund.ts") ||
    !diff.includes("diff --git a/tests/refund.test.mjs b/tests/refund.test.mjs")
  ) {
    throw new Error("Local challenge diff does not match its two-file evidence binding.");
  }
  const summary = readFileSync(resolve(root, "summary.md"), "utf8");
  if (summary !== renderLocalChallengeSummary(run)) {
    throw new Error("Local challenge summary is not the exact run-derived boundary statement.");
  }
  return run;
}
