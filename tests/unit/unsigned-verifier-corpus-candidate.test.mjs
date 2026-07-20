import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as policyTwin from "../../dist/index.js";
import {
  executeUnsignedVerifierCorpusCandidate,
} from "../../dist/codex/unsigned-verifier-corpus-candidate.js";
import {
  acceptedCorpusSha256,
  consumeValidatedExternalWorkerV2Run,
  evaluatePolicyIRReference,
  parsePolicyVerificationEvidence,
  parseWorkerRpcV2Request,
  parseWorkerRpcV2Response,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
  workerRpcV2ExecutionBindingSha256,
} from "../../dist/index.js";

const sourcePolicy = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const acceptedPolicyIr = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/policy-ir.json", import.meta.url), "utf8"),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/golden-cases.json", import.meta.url), "utf8"),
);
const generatedCases = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/generated-cases.json", import.meta.url), "utf8"),
);
const driftCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url),
    "utf8",
  ),
);

const acceptedCases = [...goldenCases, ...generatedCases];
const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
const defectsByCase = {
  D01: ["DAY_14_INCLUSIVE"],
  D02: ["USAGE_2000_INCLUSIVE"],
  D03: ["FINAL_SALE_PRECEDENCE"],
};
const input = {
  policyId: acceptedPolicyIr.policyId,
  policyVersion: 4,
  fixtureId: "seeded-refund-demo",
  sourcePolicy,
  policySummary: "Inclusive day 14 and 20% usage; final sale has highest priority.",
  acceptedPolicyIr,
  acceptedCases,
  failingCaseIds: ["D01", "D02", "D03"],
  failingDriftWitnesses: driftCases.map((policyCase) => ({
    caseId: policyCase.id,
    input: policyCase.input,
    expectedDecision: policyCase.expectedDecision,
    actualDecision: actualByCase[policyCase.id],
    defectIds: defectsByCase[policyCase.id],
    relatedClauseIds: policyCase.relatedClauseIds,
    relatedRuleIds: policyCase.relatedRuleIds,
  })),
  allowedCommandIds: ["fixture-typecheck", "fixture-test"],
  maxRepairAttempts: 1,
};

const baselineTreeManifest = {
  schemaVersion: "1",
  entries: [
    {
      path: ".",
      kind: "directory",
      mode: 16_877,
      mtimeMs: 1_700_000_000_000,
      sha256: null,
    },
    {
      path: "src",
      kind: "directory",
      mode: 16_877,
      mtimeMs: 1_700_000_000_001,
      sha256: null,
    },
    {
      path: "src/refund.ts",
      kind: "file",
      mode: 33_188,
      mtimeMs: 1_700_000_000_002,
      sha256: "1".repeat(64),
    },
    {
      path: "tests",
      kind: "directory",
      mode: 16_877,
      mtimeMs: 1_700_000_000_003,
      sha256: null,
    },
    {
      path: "tests/refund.test.mjs",
      kind: "file",
      mode: 33_188,
      mtimeMs: 1_700_000_000_004,
      sha256: "2".repeat(64),
    },
  ],
};

function requestAt(
  issuedAt = "2026-07-18T10:00:00.000Z",
  expiresAt = "2026-07-18T10:05:00.000Z",
) {
  const policy = {
    schemaVersion: "1",
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: "3".repeat(64),
    baselineExecutionTreeSha256: workerRpcExecutionTreeSha256(baselineTreeManifest),
    baselineExecutionTreeManifest: baselineTreeManifest,
    acceptedCorpusSha256: acceptedCorpusSha256(input),
    workerImageDigest: `sha256:${"4".repeat(64)}`,
    sdkPackage: "@openai/codex-sdk",
    sdkVersion: "0.144.6",
    writablePaths: ["src/refund.ts", "tests/refund.test.mjs"],
    commandIds: ["fixture-typecheck", "fixture-test"],
    repairWorkspace: "DISPOSABLE_TWO_FILE_WRITESET",
    verificationWorkspace: "IMMUTABLE_RECONSTRUCTED",
    rootFilesystem: "READ_ONLY",
    codexApiEgress: "SUPERVISOR_OPENAI_PROXY_ONLY",
    fixtureProcessNetwork: "DISABLED",
    nonPrivileged: true,
    limits: {
      wallTimeMs: 300_000,
      cpuTimeMs: 120_000,
      memoryBytes: 1_073_741_824,
      pids: 64,
      outputBytes: 4_194_304,
    },
  };
  const requestId = "5".repeat(32);
  const runNonce = Buffer.alloc(32, 6).toString("base64url");
  const model = "gpt-codex-test";
  const inputSha256 = workerRpcSha256(input);
  const policySha256 = workerRpcSha256(policy);
  return parseWorkerRpcV2Request({
    schemaVersion: "2",
    protocol: "policytwin.codex.repair.v2",
    action: "RUN_REPAIR",
    requestId,
    runNonce,
    sequence: 1,
    issuedAt,
    expiresAt,
    model,
    modelReasoningEffort: "high",
    inputSha256,
    policySha256,
    executionBindingSha256: workerRpcV2ExecutionBindingSha256({
      requestId,
      runNonce,
      model,
      inputSha256,
      policySha256,
    }),
    policy,
    input,
  });
}

function reboundRequest(request, mutateInput) {
  const changed = structuredClone(request);
  mutateInput(changed.input);
  changed.inputSha256 = workerRpcSha256(changed.input);
  changed.policy.acceptedCorpusSha256 = acceptedCorpusSha256(changed.input);
  changed.policySha256 = workerRpcSha256(changed.policy);
  changed.executionBindingSha256 = workerRpcV2ExecutionBindingSha256({
    requestId: changed.requestId,
    runNonce: changed.runNonce,
    model: changed.model,
    inputSha256: changed.inputSha256,
    policySha256: changed.policySha256,
  });
  return changed;
}

function command(commandId, overrides = {}) {
  const builtTreeSha256 = "8".repeat(64);
  return {
    schemaVersion: "1",
    commandId,
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    stdout: "ok",
    stderr: "",
    outputTruncated: false,
    fixtureTreeBeforeSha256: builtTreeSha256,
    fixtureTreeAfterSha256: builtTreeSha256,
    attempt: 1,
    repairRunId: "repair-run-1",
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    schemaVersion: "1",
    attempt: 1,
    repairRunId: "repair-run-1",
    commandEvidence: [command("fixture-typecheck"), command("fixture-test")],
    ...overrides,
  };
}

function referenceDecision(policy, policyInput) {
  return evaluatePolicyIRReference(policy, policyInput).decision;
}

const fixedNow = () => new Date("2026-07-18T10:01:00.000Z");

function ports(evaluate, overrides = {}) {
  return { evaluate, now: fixedNow, ...overrides };
}

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("exact accepted corpus produces only a deeply frozen unverified candidate", async () => {
  const request = requestAt();
  const commandBinding = binding();
  const candidate = await executeUnsignedVerifierCorpusCandidate(
    request,
    commandBinding,
    ports((policyInput) => {
      return referenceDecision(request.input.acceptedPolicyIr, policyInput);
    }),
  );

  assert.equal(candidate.schemaVersion, "1");
  assert.equal(candidate.kind, "UNSIGNED_VERIFIER_CORPUS_CANDIDATE");
  assert.equal(candidate.provenance, "UNVERIFIED_INJECTED_EVALUATOR");
  assert.equal(candidate.outcome, "UNVERIFIED_ALL_CASES_MATCH");
  assert.equal(candidate.total, 41);
  assert.equal(candidate.matched, 41);
  assert.equal(candidate.results.length, 41);
  assert.deepEqual(
    candidate.results.map((result) => result.caseId),
    request.input.acceptedCases.map((policyCase) => policyCase.id),
  );
  assert.equal(candidate.requestSha256, workerRpcSha256(request));
  assert.equal(candidate.acceptedCorpusSha256, request.policy.acceptedCorpusSha256);
  assert.equal(candidate.preTypecheckTreeSha256, "8".repeat(64));
  assert.equal(candidate.callerObservedStableTreeSha256, "8".repeat(64));
  assert.equal(candidate.commandTranscriptAuthority, "UNVERIFIED_CALLER_SUPPLIED");
  assert.equal(candidate.treeObservationAuthority, "UNVERIFIED_CALLER_SUPPLIED");
  assert.equal(candidate.attemptRunAuthority, "UNVERIFIED_CALLER_SUPPLIED");
  assert.equal(candidate.timeObservationAuthority, "UNVERIFIED_CALLER_SUPPLIED");
  assert.equal(candidate.policyIrSha256, workerRpcSha256(request.input.acceptedPolicyIr));
  assert.equal(
    candidate.commandTranscriptSha256,
    workerRpcSha256(commandBinding.commandEvidence),
  );
  assert.equal(candidate.resultsSha256, workerRpcSha256(candidate.results));
  const expectedInputBindingSha256 = workerRpcSha256({
    domain: "policytwin.verifier.corpus.unverified-input-binding.v1",
    contractSha256: candidate.contractSha256,
    requestId: request.requestId,
    requestSha256: candidate.requestSha256,
    inputSha256: request.inputSha256,
    policySha256: request.policySha256,
    executionBindingSha256: request.executionBindingSha256,
    attempt: 1,
    repairRunId: "repair-run-1",
    preTypecheckTreeSha256: "8".repeat(64),
    callerObservedStableTreeSha256: "8".repeat(64),
    acceptedCorpusSha256: request.policy.acceptedCorpusSha256,
    policyIrSha256: candidate.policyIrSha256,
    commandTranscriptSha256: candidate.commandTranscriptSha256,
  });
  assert.equal(candidate.unverifiedInputBindingSha256, expectedInputBindingSha256);
  assert.equal(
    candidate.unverifiedResultBindingSha256,
    workerRpcSha256({
      domain: "policytwin.verifier.corpus.unverified-result-binding.v1",
      unverifiedInputBindingSha256: expectedInputBindingSha256,
      resultsSha256: candidate.resultsSha256,
      outcome: candidate.outcome,
      total: candidate.total,
      matched: candidate.matched,
    }),
  );
  assert.equal(candidate.liveClaim, false);
  assert.equal(candidate.passSigningEligible, false);
  assert.equal(candidate.externalSettlementEligible, false);
  assertDeepFrozen(candidate);
  assert.equal("executeUnsignedVerifierCorpusCandidate" in policyTwin, false);
  assert.throws(() => parsePolicyVerificationEvidence(candidate));
  assert.throws(() => parseWorkerRpcV2Response(candidate));
  assert.throws(() => consumeValidatedExternalWorkerV2Run(candidate));
});

test("request, attempt, run, command order, and tree transcript tampering fail before evaluation", async () => {
  const request = requestAt();
  const invalidRequest = structuredClone(request);
  invalidRequest.input.policySummary = "changed";
  const requestIdTamper = structuredClone(request);
  requestIdTamper.requestId = "6".repeat(32);
  const inputHashTamper = structuredClone(request);
  inputHashTamper.inputSha256 = "a".repeat(64);
  const policyHashTamper = structuredClone(request);
  policyHashTamper.policySha256 = "b".repeat(64);
  const executionBindingTamper = structuredClone(request);
  executionBindingTamper.executionBindingSha256 = "c".repeat(64);
  const reorderedCorpus = reboundRequest(request, (changedInput) => {
    [changedInput.acceptedCases[0], changedInput.acceptedCases[1]] = [
      changedInput.acceptedCases[1],
      changedInput.acceptedCases[0],
    ];
  });
  const changedExpectedDecision = reboundRequest(request, (changedInput) => {
    changedInput.acceptedCases[0].expectedDecision =
      changedInput.acceptedCases[0].expectedDecision === "ALLOW" ? "DENY" : "ALLOW";
  });
  const variants = [
    [invalidRequest, binding()],
    [requestIdTamper, binding()],
    [inputHashTamper, binding()],
    [policyHashTamper, binding()],
    [executionBindingTamper, binding()],
    [reorderedCorpus, binding()],
    [changedExpectedDecision, binding()],
    [request, binding({ attempt: 2 })],
    [
      request,
      binding({
        attempt: 2,
        commandEvidence: [
          command("fixture-typecheck", { attempt: 2 }),
          command("fixture-test", { attempt: 2 }),
        ],
      }),
    ],
    [request, binding({ repairRunId: "repair-run-2" })],
    [
      request,
      binding({
        commandEvidence: [command("fixture-test"), command("fixture-typecheck")],
      }),
    ],
    [
      request,
      binding({
        commandEvidence: [command("fixture-typecheck", { exitCode: 1 }), command("fixture-test")],
      }),
    ],
    [
      request,
      binding({
        commandEvidence: [
          command("fixture-typecheck", { timedOut: true }),
          command("fixture-test"),
        ],
      }),
    ],
    [
      request,
      binding({
        commandEvidence: [
          command("fixture-typecheck", { outputTruncated: true }),
          command("fixture-test"),
        ],
      }),
    ],
    [
      request,
      binding({
        commandEvidence: [
          command("fixture-typecheck", { fixtureTreeBeforeSha256: "7".repeat(64) }),
          command("fixture-test"),
        ],
      }),
    ],
    [
      request,
      binding({
        commandEvidence: [
          command("fixture-typecheck", {
            fixtureTreeBeforeSha256: "9".repeat(64),
            fixtureTreeAfterSha256: "9".repeat(64),
          }),
          command("fixture-test"),
        ],
      }),
    ],
    [
      request,
      binding({
        commandEvidence: [
          command("fixture-typecheck"),
          command("fixture-test", { fixtureTreeAfterSha256: "9".repeat(64) }),
        ],
      }),
    ],
  ];

  for (const [requestValue, bindingValue] of variants) {
    let calls = 0;
    await assert.rejects(
      executeUnsignedVerifierCorpusCandidate(
        requestValue,
        bindingValue,
        ports(() => {
          calls += 1;
          return "ALLOW";
        }),
      ),
    );
    assert.equal(calls, 0);
  }
});

test("request and binding mutation during evaluation fail closed", async () => {
  const request = requestAt();
  let calls = 0;
  await assert.rejects(
    executeUnsignedVerifierCorpusCandidate(
      request,
      binding(),
      ports((policyInput) => {
        calls += 1;
        if (calls === 1) request.input.policySummary = "mutated during evaluation";
        return referenceDecision(acceptedPolicyIr, policyInput);
      }),
    ),
    /changed during unsigned verifier evaluation/u,
  );
  assert.equal(calls, 1);

  const secondRequest = requestAt();
  const mutableBinding = binding();
  calls = 0;
  await assert.rejects(
    executeUnsignedVerifierCorpusCandidate(
      secondRequest,
      mutableBinding,
      ports((policyInput) => {
        calls += 1;
        if (calls === 1) mutableBinding.commandEvidence[0].stdout = "changed";
        return referenceDecision(acceptedPolicyIr, policyInput);
      }),
    ),
    /changed during unsigned verifier evaluation/u,
  );
  assert.equal(calls, 1);
});

test("future and expired requests reject before evaluation", async () => {
  const requests = [
    requestAt("2026-07-18T10:02:00.000Z", "2026-07-18T10:05:00.000Z"),
    requestAt("2026-07-18T09:55:00.000Z", "2026-07-18T10:01:00.000Z"),
  ];
  for (const request of requests) {
    let calls = 0;
    await assert.rejects(
      executeUnsignedVerifierCorpusCandidate(
        request,
        binding(),
        ports(() => {
          calls += 1;
          return "ALLOW";
        }),
      ),
      /not active yet|expired/u,
    );
    assert.equal(calls, 0);
  }
});

test("a request-authorized second repair attempt remains unverified", async () => {
  const request = parseWorkerRpcV2Request(
    reboundRequest(requestAt(), (changedInput) => {
      changedInput.maxRepairAttempts = 2;
    }),
  );
  const secondBinding = binding({
    attempt: 2,
    repairRunId: "repair-run-2",
    commandEvidence: [
      command("fixture-typecheck", { attempt: 2, repairRunId: "repair-run-2" }),
      command("fixture-test", { attempt: 2, repairRunId: "repair-run-2" }),
    ],
  });
  const candidate = await executeUnsignedVerifierCorpusCandidate(
    request,
    secondBinding,
    ports((policyInput) => referenceDecision(request.input.acceptedPolicyIr, policyInput)),
  );
  assert.equal(candidate.attempt, 2);
  assert.equal(candidate.repairRunId, "repair-run-2");
  assert.equal(candidate.outcome, "UNVERIFIED_ALL_CASES_MATCH");
  assert.equal(candidate.passSigningEligible, false);
});

test("invalid and throwing decisions become generic non-sensitive ERROR results", async () => {
  const request = requestAt();
  let calls = 0;
  const candidate = await executeUnsignedVerifierCorpusCandidate(
    request,
    binding(),
    ports((policyInput) => {
      calls += 1;
      if (calls === 1) return "MAYBE";
      if (calls === 2) throw new Error("C:\\Users\\private-user\\secret.txt");
      return referenceDecision(request.input.acceptedPolicyIr, policyInput);
    }),
  );
  const referenceCandidate = await executeUnsignedVerifierCorpusCandidate(
    request,
    binding(),
    ports((policyInput) => referenceDecision(request.input.acceptedPolicyIr, policyInput)),
  );

  assert.equal(candidate.outcome, "UNVERIFIED_MISMATCH_OR_ERROR");
  assert.equal(candidate.matched, 39);
  assert.equal(candidate.results[0].status, "ERROR");
  assert.equal(candidate.results[1].status, "ERROR");
  assert.equal(candidate.results[0].actualDecision, null);
  assert.equal(candidate.results[1].actualDecision, null);
  assert.notEqual(candidate.resultsSha256, referenceCandidate.resultsSha256);
  assert.notEqual(
    candidate.unverifiedResultBindingSha256,
    referenceCandidate.unverifiedResultBindingSha256,
  );
  assert.doesNotMatch(JSON.stringify(candidate), /private-user|secret\.txt/iu);
});

test("extra authority ports and sensitive command output are rejected", async () => {
  const request = requestAt();
  await assert.rejects(
    executeUnsignedVerifierCorpusCandidate(
      request,
      binding(),
      ports(() => {
        return "ALLOW";
      }, { signer: () => "forbidden" }),
    ),
    /unknown fields/u,
  );
  await assert.rejects(
    executeUnsignedVerifierCorpusCandidate(
      request,
      binding({
        commandEvidence: [
          command("fixture-typecheck", { stdout: "OPENAI_API_KEY=must-not-pass" }),
          command("fixture-test"),
        ],
      }),
      ports(() => {
          return "ALLOW";
      }),
    ),
    /sensitive|personal-path/u,
  );
});

test("unsigned verifier module has only the exact allowlisted contract dependencies", async () => {
  const source = await readFile(
    new URL("../../src/codex/unsigned-verifier-corpus-candidate.ts", import.meta.url),
    "utf8",
  );
  const sourceFile = ts.createSourceFile(
    "unsigned-verifier-corpus-candidate.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const dependencies = new Set();
  const unapprovedLoaders = new Set();
  function addSpecifier(node) {
    if (node !== undefined && ts.isStringLiteralLike(node)) dependencies.add(node.text);
    else unapprovedLoaders.add("NON_LITERAL_MODULE_REFERENCE");
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) addSpecifier(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addSpecifier(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments.length === 1) addSpecifier(node.arguments[0]);
      else unapprovedLoaders.add("NON_LITERAL_MODULE_REFERENCE");
    }
    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === "require") ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "require") ||
      (ts.isIdentifier(node) && node.text === "createRequire")
    ) {
      unapprovedLoaders.add("INDIRECT_MODULE_LOADER");
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "require" &&
      !(
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      )
    ) {
      unapprovedLoaders.add("INDIRECT_MODULE_LOADER");
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.deepEqual([...dependencies].sort(), [
    "../domain/decision.js",
    "../domain/refund.js",
    "./safety.js",
    "./types.js",
    "./validate.js",
    "./worker-rpc-contract.js",
  ]);
  assert.deepEqual([...unapprovedLoaders], []);
  assert.doesNotMatch(
    source,
    /worker-rpc-mtls|worker-rpc-client|coordinator|validated-result|finalized|docker|codex-sdk|OPENAI_API_KEY/u,
  );
});
