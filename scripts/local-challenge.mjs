import { Codex } from "@openai/codex-sdk";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  lstatSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import {
  validateLocalChallengeDirectory,
  validateLocalChallengeRun,
  validateLocalChallengeSchemaContract,
  renderLocalChallengeSummary,
} from "./local-challenge-contract.mjs";
import {
  assertCanonicalFixtureUnchanged,
  createRepairWorkspace,
  removeRepairWorkspace,
} from "./repair-workspace.mjs";
import {
  buildSanitizedEnvironment,
  repairFixtureTreeHash,
  runRepairCommand,
} from "./repair-command.mjs";
import {
  withLocalChallengeRunLock,
  withLocalChallengeRunLockSync,
} from "./local-challenge-lock.mjs";
import { ROOT, run } from "./process.mjs";

const FINAL_DIRECTORY = resolve(ROOT, "artifacts", "challenge-evidence");
const MODEL = "gpt-5.6";
const SDK_VERSION = "0.144.3";
const ENVIRONMENT_ALLOWLIST = new Set([
  "APPDATA",
  "CI",
  "CODEX_HOME",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(value, null, 2);
}

function expectedChallengeTestContents() {
  const baselineTest = readFileSync(
    resolve(ROOT, "fixtures", "refund-demo", "baseline", "tests", "refund.test.mjs"),
    "utf8",
  );
  const skippedTests = baselineTest.match(/test\.skip\(/gu) ?? [];
  if (skippedTests.length !== 3) {
    throw new Error("Trusted local challenge regression-test baseline is invalid.");
  }
  return baselineTest.replaceAll("test.skip(", "test(");
}

function assertSafeRefundSource(source) {
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) {
    throw new Error("Local challenge refund source exceeds the reviewed size bound.");
  }
  if (/@ts-(?:no)?check|@ts-ignore|@ts-expect-error/iu.test(source)) {
    throw new Error("Local challenge refund source cannot suppress TypeScript diagnostics.");
  }
  const sourceFile = ts.createSourceFile(
    "refund.ts",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length !== 0 || sourceFile.statements.length !== 3) {
    throw new Error("Local challenge refund source must preserve the reviewed three-declaration shape.");
  }
  const baselineSource = readFileSync(
    resolve(ROOT, "fixtures", "refund-demo", "baseline", "src", "refund.ts"),
    "utf8",
  );
  const baselineFile = ts.createSourceFile(
    "refund.ts",
    baselineSource,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  for (const index of [0, 1]) {
    if (sourceFile.statements[index].getText(sourceFile) !== baselineFile.statements[index].getText(baselineFile)) {
      throw new Error("Local challenge refund source changed the reviewed type or input interface.");
    }
  }

  const declaration = sourceFile.statements[2];
  if (
    !ts.isFunctionDeclaration(declaration) ||
    declaration.name?.text !== "decideRefund" ||
    declaration.asteriskToken !== undefined ||
    declaration.typeParameters !== undefined ||
    declaration.parameters.length !== 1 ||
    declaration.parameters[0].name.getText(sourceFile) !== "input" ||
    declaration.parameters[0].type?.getText(sourceFile) !== "RefundPolicyInput" ||
    declaration.parameters[0].initializer !== undefined ||
    declaration.parameters[0].questionToken !== undefined ||
    declaration.parameters[0].dotDotDotToken !== undefined ||
    (declaration.parameters[0].modifiers?.length ?? 0) !== 0 ||
    declaration.type?.getText(sourceFile) !== "Decision" ||
    declaration.body === undefined ||
    declaration.modifiers?.length !== 1 ||
    declaration.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword
  ) {
    throw new Error("Local challenge refund function signature is outside the reviewed contract.");
  }

  const inputProperties = new Set([
    "daysSincePurchase",
    "usageBasisPoints",
    "promotionalPurchase",
    "finalSale",
    "managerApproved",
    "planType",
  ]);
  const localNames = new Set(["withinWindow", "withinUsage"]);
  const declaredLocals = new Set();
  const allowedBinaryOperators = new Set([
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ]);
  let inspectedNodes = 0;
  const countNode = () => {
    inspectedNodes += 1;
    if (inspectedNodes > 256) {
      throw new Error("Local challenge refund function exceeds the reviewed AST bound.");
    }
  };

  const inspectExpression = (node) => {
    countNode();
    if (ts.isParenthesizedExpression(node)) {
      inspectExpression(node.expression);
      return;
    }
    if (ts.isIdentifier(node)) {
      if (node.text !== "input" && !localNames.has(node.text)) {
        throw new Error(`Local challenge refund expression uses a forbidden identifier: ${node.text}.`);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (
        !ts.isIdentifier(node.expression) ||
        node.expression.text !== "input" ||
        !inputProperties.has(node.name.text)
      ) {
        throw new Error("Local challenge refund expression uses forbidden property access.");
      }
      return;
    }
    if (ts.isStringLiteral(node)) {
      if (!["ALLOW", "DENY", "REVIEW"].includes(node.text)) {
        throw new Error("Local challenge refund expression uses a forbidden string literal.");
      }
      return;
    }
    if (ts.isNumericLiteral(node)) {
      if (node.text !== "14" && node.text !== "2000") {
        throw new Error("Local challenge refund expression uses a forbidden numeric literal.");
      }
      return;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return;
    if (ts.isPrefixUnaryExpression(node)) {
      if (node.operator !== ts.SyntaxKind.ExclamationToken) {
        throw new Error("Local challenge refund expression uses a forbidden unary operator.");
      }
      inspectExpression(node.operand);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (!allowedBinaryOperators.has(node.operatorToken.kind)) {
        throw new Error("Local challenge refund expression uses a forbidden binary operator.");
      }
      inspectExpression(node.left);
      inspectExpression(node.right);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      inspectExpression(node.condition);
      inspectExpression(node.whenTrue);
      inspectExpression(node.whenFalse);
      return;
    }
    throw new Error(`Local challenge refund expression kind is forbidden: ${ts.SyntaxKind[node.kind]}.`);
  };

  const inspectStatement = (node) => {
    countNode();
    if (ts.isBlock(node)) {
      for (const statement of node.statements) inspectStatement(statement);
      return;
    }
    if (ts.isVariableStatement(node)) {
      if (
        (node.declarationList.flags & ts.NodeFlags.Const) === 0 ||
        node.declarationList.declarations.length !== 1
      ) {
        throw new Error("Local challenge refund function permits only one-name const declarations.");
      }
      const variable = node.declarationList.declarations[0];
      if (
        !ts.isIdentifier(variable.name) ||
        !localNames.has(variable.name.text) ||
        declaredLocals.has(variable.name.text) ||
        variable.initializer === undefined
      ) {
        throw new Error("Local challenge refund function contains a forbidden local declaration.");
      }
      declaredLocals.add(variable.name.text);
      inspectExpression(variable.initializer);
      return;
    }
    if (ts.isIfStatement(node)) {
      inspectExpression(node.expression);
      inspectStatement(node.thenStatement);
      if (node.elseStatement !== undefined) inspectStatement(node.elseStatement);
      return;
    }
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      inspectExpression(node.expression);
      return;
    }
    throw new Error(`Local challenge refund statement kind is forbidden: ${ts.SyntaxKind[node.kind]}.`);
  };

  inspectStatement(declaration.body);
}

export function assertSafeLocalChallengeRepair(fixtureRoot) {
  const actualSource = readFileSync(resolve(fixtureRoot, "src", "refund.ts"), "utf8");
  const actualTest = readFileSync(resolve(fixtureRoot, "tests", "refund.test.mjs"), "utf8");
  assertSafeRefundSource(actualSource);
  if (actualTest !== expectedChallengeTestContents()) {
    throw new Error(
      "Local challenge test execution permits only the baseline file with exactly three reviewed skips enabled.",
    );
  }
  return Object.freeze({
    sourceSha256: sha256(actualSource),
    testSha256: sha256(actualTest),
  });
}

export function buildLocalChallengeEnvironment(source = process.env, codexHomeOverride = null) {
  const result = {};
  for (const [name, value] of Object.entries(source)) {
    if (ENVIRONMENT_ALLOWLIST.has(name.toUpperCase()) && typeof value === "string") {
      result[name.toUpperCase()] = value;
    }
  }
  if (!result.CODEX_HOME && result.USERPROFILE) {
    result.CODEX_HOME = resolve(result.USERPROFILE, ".codex");
  }
  if (codexHomeOverride !== null) result.CODEX_HOME = resolve(codexHomeOverride);
  return result;
}

function createIsolatedCodexHome() {
  cleanupStaleIsolatedCodexHomes();
  const existingHome = buildLocalChallengeEnvironment().CODEX_HOME;
  if (typeof existingHome !== "string") {
    throw new Error("The existing Codex home could not be resolved.");
  }
  const sourceAuth = resolve(existingHome, "auth.json");
  if (!existsSync(sourceAuth)) throw new Error("The existing Codex login file is unavailable.");
  const sourceStat = lstatSync(sourceAuth);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size < 1 || sourceStat.size > 64 * 1024) {
    throw new Error("The existing Codex login file is not a bounded regular file.");
  }
  const isolatedHome = mkdtempSync(join(tmpdir(), "policytwin-codex-home-"));
  secureIsolatedCodexHome(isolatedHome);
  const authBytes = readFileSync(sourceAuth);
  try {
    writeFileSync(resolve(isolatedHome, "auth.json"), authBytes, {
      flag: "wx",
      mode: 0o600,
    });
    const copiedStat = lstatSync(resolve(isolatedHome, "auth.json"));
    if (
      !copiedStat.isFile() ||
      copiedStat.isSymbolicLink() ||
      copiedStat.size !== sourceStat.size ||
      (copiedStat.dev === sourceStat.dev && copiedStat.ino === sourceStat.ino)
    ) {
      throw new Error("The isolated Codex login must be a distinct bounded regular file.");
    }
  } catch (error) {
    removeIsolatedCodexHome(isolatedHome);
    throw new Error("Could not create a distinct auth-only isolated Codex home.", {
      cause: error,
    });
  } finally {
    authBytes.fill(0);
  }
  return isolatedHome;
}

function secureIsolatedCodexHome(path) {
  if (process.platform !== "win32") {
    chmodSync(path, 0o700);
    return;
  }
  const whoami = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  });
  const sid = whoami.stdout?.match(/S-1-[0-9-]+/u)?.[0];
  if (whoami.error !== undefined || whoami.status !== 0 || sid === undefined) {
    removeIsolatedCodexHome(path);
    throw new Error("Could not resolve the current Windows identity for the isolated Codex home.");
  }
  const acl = spawnSync(
    "icacls.exe",
    [path, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 10_000,
    },
  );
  if (acl.error !== undefined || acl.status !== 0) {
    removeIsolatedCodexHome(path);
    throw new Error("Could not restrict the isolated Codex home to the current Windows identity.");
  }
}

function removeIsolatedCodexHome(path) {
  const resolved = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  const relativePath = relative(temporaryRoot, resolved);
  if (
    relativePath.startsWith("..") ||
    resolve(temporaryRoot, relativePath) !== resolved ||
    !basename(resolved).startsWith("policytwin-codex-home-")
  ) {
    throw new Error("Refusing to remove an unrecognized isolated Codex home.");
  }
  if (!existsSync(resolved)) return;
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Refusing to remove an isolated Codex home that is not a real directory.");
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 40,
    retryDelay: 250,
  });
}

function cleanupStaleIsolatedCodexHomes() {
  const temporaryRoot = resolve(tmpdir());
  const staleBefore = Date.now() - 2 * 60 * 60_000;
  for (const entry of readdirSync(temporaryRoot, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !/^policytwin-codex-home-[A-Za-z0-9_-]{6,64}$/u.test(entry.name)
    ) {
      continue;
    }
    const candidate = resolve(temporaryRoot, entry.name);
    const stat = lstatSync(candidate);
    const authenticationPresent = existsSync(resolve(candidate, "auth.json"));
    if (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mtimeMs <= staleBefore || !authenticationPresent)
    ) {
      removeIsolatedCodexHome(candidate);
    }
  }
}

function commandOutput(command, args) {
  const executable = process.platform === "win32" && command === "codex" ? "codex.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    env: buildLocalChallengeEnvironment(),
    encoding: "utf8",
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Local challenge prerequisite failed: ${command} ${args.join(" ")}.`);
  }
  return `${result.stdout}\n${result.stderr}`.trim();
}

function recoverInterruptedChallengeEvidence() {
  const temporaryRoot = resolve(ROOT, ".tmp");
  if (!existsSync(temporaryRoot)) return;
  const backups = readdirSync(temporaryRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^challenge-evidence-backup-lc_[0-9a-f]{16}$/u.test(entry.name),
    )
    .map((entry) => resolve(temporaryRoot, entry.name));
  if (backups.length === 0) return;
  if (existsSync(FINAL_DIRECTORY) || backups.length !== 1) {
    throw new Error("Interrupted challenge evidence requires manual recovery; backups were preserved.");
  }
  const backup = backups[0];
  const stat = lstatSync(backup);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Interrupted challenge evidence backup is not a real directory.");
  }
  validateLocalChallengeDirectory(backup);
  mkdirSync(dirname(FINAL_DIRECTORY), { recursive: true });
  renameSync(backup, FINAL_DIRECTORY);
  validateLocalChallengeDirectory(FINAL_DIRECTORY);
}

function installedVersions() {
  const external = commandOutput("codex", ["--version"]);
  const match = external.match(/(?:codex-cli\s+)?(0\.144\.[0-9]+)/u);
  if (!match) throw new Error("The installed Codex CLI version is not recognized.");
  const sdkPackage = JSON.parse(
    readFileSync(resolve(ROOT, "node_modules", "@openai", "codex-sdk", "package.json"), "utf8"),
  );
  const bundledPackage = JSON.parse(
    readFileSync(resolve(ROOT, "node_modules", "@openai", "codex", "package.json"), "utf8"),
  );
  if (sdkPackage.version !== SDK_VERSION || bundledPackage.version !== SDK_VERSION) {
    throw new Error("The local challenge requires the reviewed Codex SDK and bundled CLI 0.144.3.");
  }
  const loginStatus = commandOutput("codex", ["login", "status"]);
  if (!/logged in using ChatGPT/iu.test(loginStatus)) {
    throw new Error("The local challenge requires an active existing Codex ChatGPT login.");
  }
  return {
    sdkVersion: sdkPackage.version,
    bundledCliVersion: bundledPackage.version,
    externalCliVersion: match[1],
  };
}

async function buildInputs() {
  const sourcePolicy = readFileSync(
    resolve(ROOT, "fixtures", "interpreter", "seeded-refund-policy.txt"),
    "utf8",
  );
  const acceptedPolicyIr = JSON.parse(
    readFileSync(resolve(ROOT, "artifacts", "evidence", "policy-ir.json"), "utf8"),
  );
  const goldenCases = JSON.parse(
    readFileSync(resolve(ROOT, "artifacts", "evidence", "golden-cases.json"), "utf8"),
  );
  const generatedCases = JSON.parse(
    readFileSync(resolve(ROOT, "artifacts", "evidence", "generated-cases.json"), "utf8"),
  );
  const driftCases = JSON.parse(
    readFileSync(
      resolve(ROOT, "fixtures", "refund-demo", "cases", "seeded-drift-cases.json"),
      "utf8",
    ),
  );
  const actualByCase = { D01: "DENY", D02: "DENY", D03: "ALLOW" };
  const defectsByCase = {
    D01: ["DAY_14_INCLUSIVE"],
    D02: ["USAGE_2000_INCLUSIVE"],
    D03: ["FINAL_SALE_PRECEDENCE"],
  };
  const acceptedCases = [...goldenCases, ...generatedCases];
  return {
    sourcePolicy,
    acceptedPolicyIr,
    acceptedCases,
    repairInput: {
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
      maxRepairAttempts: 2,
    },
  };
}

async function verifyCorpus(fixtureRoot, acceptedCases, input, context) {
  assertSafeLocalChallengeRepair(fixtureRoot);
  const treeBeforeSha256 = repairFixtureTreeHash(fixtureRoot);
  if (treeBeforeSha256 !== context.fixtureTreeSha256) {
    throw new Error("Local challenge corpus verification did not receive the command-bound tree.");
  }
  mkdirSync(resolve(ROOT, ".tmp"), { recursive: true });
  const runnerPath = resolve(
    ROOT,
    ".tmp",
    `local-challenge-corpus-${randomBytes(8).toString("hex")}.mjs`,
  );
  if (existsSync(runnerPath)) {
    throw new Error("Local challenge corpus runner path is unexpectedly occupied.");
  }
  const moduleUrl = pathToFileURL(resolve(fixtureRoot, "dist", "refund.js")).href;
  const source = `import { decideRefund } from ${JSON.stringify(moduleUrl)};\nconst cases = ${JSON.stringify(
    acceptedCases,
  )};\nconst results = cases.map((policyCase) => {\n  try {\n    const actualDecision = decideRefund(policyCase.input);\n    return { caseId: policyCase.id, expectedDecision: policyCase.expectedDecision, actualDecision, status: actualDecision === policyCase.expectedDecision ? "PASS" : "FAIL", error: null };\n  } catch {\n    return { caseId: policyCase.id, expectedDecision: policyCase.expectedDecision, actualDecision: null, status: "ERROR", error: "Fixture evaluation failed." };\n  }\n});\nprocess.stdout.write(JSON.stringify(results));\n`;
  let results;
  try {
    writeFileSync(runnerPath, source, { encoding: "utf8", flag: "wx" });
    const evaluation = spawnSync(process.execPath, [runnerPath], {
      cwd: fixtureRoot,
      env: buildSanitizedEnvironment(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    });
    if (evaluation.error !== undefined || evaluation.status !== 0) {
      throw new Error("Local challenge corpus evaluator did not exit successfully.");
    }
    results = JSON.parse(evaluation.stdout);
  } finally {
    rmSync(runnerPath, { force: true });
  }
  const treeAfterSha256 = repairFixtureTreeHash(fixtureRoot);
  if (treeAfterSha256 !== treeBeforeSha256) {
    throw new Error("Local challenge corpus execution changed the command-bound fixture tree.");
  }
  if (!Array.isArray(results) || results.length !== acceptedCases.length) {
    throw new Error("Local challenge corpus evaluator returned an invalid result set.");
  }
  const passed = results.filter((result) => result.status === "PASS").length;
  return {
    evidence: {
      schemaVersion: "1",
      executionMode: "SERVER_OWNED_CORPUS",
      attempt: context.attempt,
      repairRunId: context.repairRunId,
      fixtureTreeSha256: treeAfterSha256,
      acceptedCorpusSha256: context.acceptedCorpusSha256,
      policyIrSha256: context.policyIrSha256,
      status: passed === results.length ? "PASS" : "FAIL",
      total: results.length,
      passed,
      results,
    },
    input,
  };
}

export async function runLocalChallenge({
  approved = process.env.POLICYTWIN_LOCAL_CHALLENGE_APPROVED === "1",
  now = () => new Date(),
} = {}) {
  if (!approved) {
    throw new Error(
      "Set POLICYTWIN_LOCAL_CHALLENGE_APPROVED=1 only after approving the bounded GPT-5.6/Codex model calls.",
    );
  }
  if (process.env.CODEX_MODEL && process.env.CODEX_MODEL !== MODEL) {
    throw new Error("LOCAL_CHALLENGE requires CODEX_MODEL=gpt-5.6 when CODEX_MODEL is set.");
  }
  return withLocalChallengeRunLock(ROOT, () => runLocalChallengeLocked({ now }));
}

async function runLocalChallengeLocked({ now }) {
  const buildStatus = run(process.execPath, ["scripts/build-core.mjs"]);
  if (buildStatus !== 0) {
    throw new Error(`Local challenge core build failed with exit code ${buildStatus}.`);
  }
  validateLocalChallengeSchemaContract();
  recoverInterruptedChallengeEvidence();
  const versions = installedVersions();
  const repositoryCommit = commandOutput("git", ["rev-parse", "HEAD"]);
  if (commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
    throw new Error("LOCAL_CHALLENGE requires a clean committed worktree before any model call.");
  }
  const {
    CARTOGRAPHY_MODEL_OUTPUT_SCHEMA,
    REPAIR_MODEL_OUTPUT_SCHEMA,
    REVIEW_MODEL_OUTPUT_SCHEMA,
  } = await import("../dist/codex/sdk-output-schemas.js");
  const { createLocalChallengeCodexSdkBackend } = await import(
    "../dist/codex/sdk-adapter.js"
  );
  const { createCanonicalFixtureDiff, orchestrateRepair } = await import("../dist/index.js");

  const startedAt = now().toISOString();
  const runId = `lc_${randomBytes(8).toString("hex")}`;
  const workspace = createRepairWorkspace(runId);
  let isolatedCodexHome = null;
  let preserveEvidenceBackup = false;
  let promoted = false;
  try {
    const prompts = {
      cartographer: readFileSync(resolve(ROOT, "prompts", "cartographer.v1.md"), "utf8"),
      repair: `${readFileSync(resolve(ROOT, "prompts", "repair.v1.md"), "utf8")}\n\nLOCAL_CHALLENGE safety contract: do not run commands. Change only the two planned files. Preserve the exported types, input interface, and decideRefund signature. Keep decideRefund pure: use only input property reads, const declarations, comparisons, boolean logic, conditionals, if blocks, and decision returns; imports, calls, assignments, loops, exceptions, computed properties, and global identifiers are forbidden. In tests/refund.test.mjs, change only the three existing test.skip( tokens to test(. Derive the source repair from the supplied policy, accepted cases, and drift witnesses; no expected-fixed implementation is available to the repair agent.\n`,
      reviewer: readFileSync(resolve(ROOT, "prompts", "reviewer.v1.md"), "utf8"),
    };
    const inputs = await buildInputs();
    isolatedCodexHome = createIsolatedCodexHome();
    const codex = new Codex({
      env: buildLocalChallengeEnvironment(process.env, isolatedCodexHome),
      config: {
        model_provider: "openai",
        model_providers: {},
        mcp_servers: {},
        web_search: "disabled",
        approval_policy: "never",
        sandbox_workspace_write: { network_access: false },
      },
    });
    const backend = createLocalChallengeCodexSdkBackend({
      acknowledgedNonProduction: true,
      client: codex,
      fixtureRoot: workspace.fixtureRoot,
      model: MODEL,
      modelReasoningEffort: "high",
      prompts,
      timeouts: {
        cartographyMs: 10 * 60_000,
        repairMs: 10 * 60_000,
        reviewMs: 10 * 60_000,
      },
    });
    let latestVerification = null;
    const report = await orchestrateRepair(
      inputs.repairInput,
      backend,
      async (commandId) => {
        try {
          assertSafeLocalChallengeRepair(workspace.fixtureRoot);
        } catch {
          const treeSha256 = repairFixtureTreeHash(workspace.fixtureRoot);
          return {
            schemaVersion: "1",
            commandId,
            exitCode: 1,
            timedOut: false,
            durationMs: 0,
            stdout: "",
            stderr:
              "LOCAL_CHALLENGE refused execution because the repair left the reviewed pure-AST/test-change safety subset.",
            outputTruncated: false,
            fixtureTreeBeforeSha256: treeSha256,
            fixtureTreeAfterSha256: treeSha256,
          };
        }
        return runRepairCommand(workspace.fixtureRoot, commandId, "OFFLINE_TEST_DOUBLE");
      },
      async (input, context) => {
        const verified = await verifyCorpus(
          workspace.fixtureRoot,
          inputs.acceptedCases,
          input,
          context,
        );
        latestVerification = verified.evidence;
        return verified.evidence;
      },
    );
    removeIsolatedCodexHome(isolatedCodexHome);
    isolatedCodexHome = null;
    if (report.status !== "PASS" || report.cartography === null || report.review === null) {
      const failureCode = report.failure?.code ?? "UNKNOWN";
      const failureMessage = report.failure?.message ?? "No safe diagnostic was retained.";
      throw new Error(`Local challenge repair did not pass: ${failureCode}. ${failureMessage}`);
    }
    const finalRepair = report.repairAttempts.at(-1);
    const finalVerification = report.policyVerificationAttempts.at(-1);
    const finalCommands = report.commandEvidence.filter(
      (item) => item.attempt === report.attempts,
    );
    if (
      finalRepair === undefined ||
      finalVerification === undefined ||
      latestVerification === null ||
      finalCommands.length !== 2 ||
      finalVerification.status !== "PASS" ||
      finalVerification.total !== 41 ||
      finalVerification.passed !== 41 ||
      report.review.verdict !== "APPROVE"
    ) {
      throw new Error("Local challenge terminal evidence is incomplete.");
    }
    const changedFiles = [...finalRepair.changedFiles].sort();
    if (JSON.stringify(changedFiles) !== JSON.stringify(["src/refund.ts", "tests/refund.test.mjs"])) {
      throw new Error("Local challenge repair did not change the exact two-file allowlist.");
    }
    const changes = changedFiles.map((path) => ({
      path,
      before: readFileSync(resolve(ROOT, "fixtures", "refund-demo", "baseline", path), "utf8"),
      after: readFileSync(resolve(workspace.fixtureRoot, path), "utf8"),
    }));
    const diff = createCanonicalFixtureDiff(changes);
    const run = validateLocalChallengeRun({
      schemaVersion: "1",
      profile: "LOCAL_CHALLENGE",
      status: "LOCAL_CHALLENGE_PASS",
      model: MODEL,
      surface: "CODEX_CLI_OUTPUT_SCHEMA",
      authentication: {
        mode: "EXISTING_CODEX_LOGIN_TEMPORARY_AUTH_COPY",
        explicitApiKeyProvided: false,
        credentialMaterialCaptured: false,
        temporaryAuthCopyCreated: true,
        temporaryAuthCopyRemovedBeforeEvidence: true,
        temporaryAuthDirectoryRestricted: true,
      },
      tooling: versions,
      provenance: {
        runId,
        repositoryCommit,
        sourceInputSha256: sha256(inputs.sourcePolicy),
        acceptedPolicyIrSha256: sha256(JSON.stringify(inputs.acceptedPolicyIr)),
        acceptedCorpusSha256: sha256(JSON.stringify(inputs.acceptedCases)),
        promptSha256s: {
          cartography: report.cartography.metadata.promptTemplateSha256,
          repair: finalRepair.metadata.promptTemplateSha256,
          review: report.review.metadata.promptTemplateSha256,
        },
        outputSchemaSha256s: {
          cartography: sha256(JSON.stringify(CARTOGRAPHY_MODEL_OUTPUT_SCHEMA)),
          repair: sha256(JSON.stringify(REPAIR_MODEL_OUTPUT_SCHEMA)),
          review: sha256(JSON.stringify(REVIEW_MODEL_OUTPUT_SCHEMA)),
        },
      },
      repair: {
        status: "PASS",
        cartographyThreadId: report.cartography.metadata.runId,
        repairThreadIds: report.repairAttempts.map((item) => item.metadata.runId),
        changedFiles,
        preCommandTreeSha256: finalCommands[0].fixtureTreeBeforeSha256,
        postCommandTreeSha256: finalCommands[1].fixtureTreeAfterSha256,
        diffSha256: sha256(diff),
      },
      commands: {
        status: "PASS",
        orderedIds: finalCommands.map((item) => item.commandId),
        receipts: finalCommands,
        receiptsSha256: sha256(JSON.stringify(finalCommands)),
      },
      policyVerification: {
        status: "PASS",
        total: finalVerification.total,
        passed: finalVerification.passed,
        drift: finalVerification.total - finalVerification.passed,
        results: finalVerification.results,
        resultsSha256: sha256(JSON.stringify(finalVerification.results)),
      },
      review: {
        status: "PASS",
        threadId: report.review.metadata.runId,
        verdict: report.review.verdict,
        blockingFindings: report.review.findings.filter(
          (finding) => finding.severity === "HIGH" || finding.severity === "CRITICAL",
        ).length,
      },
      claims: {
        productionIsolationVerified: false,
        authoritativeVerifyLive: false,
        releaseEvidenceEligible: false,
        responsesApiDirectlyVerified: false,
        cgroupV2Verified: false,
        liveAttestationPresent: false,
      },
      startedAt,
      completedAt: now().toISOString(),
    });

    if (
      commandOutput("git", ["rev-parse", "HEAD"]) !== repositoryCommit ||
      commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
    ) {
      throw new Error("LOCAL_CHALLENGE repository provenance changed during the model run.");
    }

    const temporaryDirectory = resolve(ROOT, ".tmp", `challenge-evidence-${runId}`);
    rmSync(temporaryDirectory, { recursive: true, force: true });
    mkdirSync(temporaryDirectory, { recursive: true });
    writeFileSync(resolve(temporaryDirectory, "integration.diff"), diff, "utf8");
    writeFileSync(
      resolve(temporaryDirectory, "local-challenge-run.json"),
      `${canonicalJson(run)}\n`,
      "utf8",
    );
    writeFileSync(resolve(temporaryDirectory, "summary.md"), renderLocalChallengeSummary(run), "utf8");
    validateLocalChallengeDirectory(temporaryDirectory);
    mkdirSync(dirname(FINAL_DIRECTORY), { recursive: true });
    const backupDirectory = resolve(ROOT, ".tmp", `challenge-evidence-backup-${runId}`);
    rmSync(backupDirectory, { recursive: true, force: true });
    if (existsSync(FINAL_DIRECTORY)) renameSync(FINAL_DIRECTORY, backupDirectory);
    let newFinalValidated = false;
    try {
      renameSync(temporaryDirectory, FINAL_DIRECTORY);
      validateLocalChallengeDirectory(FINAL_DIRECTORY);
      newFinalValidated = true;
      rmSync(backupDirectory, { recursive: true, force: true });
    } catch (error) {
      preserveEvidenceBackup = existsSync(backupDirectory);
      if (newFinalValidated) throw error;
      try {
        rmSync(FINAL_DIRECTORY, { recursive: true, force: true });
      } catch (removeError) {
        throw new AggregateError(
          [error, removeError],
          `Challenge evidence rollback could not remove the invalid new directory; the previous backup was preserved at ${backupDirectory}.`,
        );
      }
      if (existsSync(backupDirectory)) {
        try {
          renameSync(backupDirectory, FINAL_DIRECTORY);
          preserveEvidenceBackup = false;
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `Challenge evidence restoration failed; the previous validated backup was preserved at ${backupDirectory}.`,
          );
        }
      }
      throw error;
    }
    promoted = true;
    return run;
  } finally {
    try {
      assertCanonicalFixtureUnchanged(workspace.baselineHashBefore);
    } finally {
      try {
        removeRepairWorkspace(runId);
      } finally {
        try {
          if (isolatedCodexHome !== null) removeIsolatedCodexHome(isolatedCodexHome);
        } finally {
          if (!promoted) {
            rmSync(resolve(ROOT, ".tmp", `challenge-evidence-${runId}`), {
              recursive: true,
              force: true,
            });
          }
          if (!preserveEvidenceBackup) {
            rmSync(resolve(ROOT, ".tmp", `challenge-evidence-backup-${runId}`), {
              recursive: true,
              force: true,
            });
          }
        }
      }
    }
  }
}

export function checkLocalChallenge() {
  return withLocalChallengeRunLockSync(ROOT, () =>
    validateLocalChallengeDirectory(FINAL_DIRECTORY),
  );
}

async function main() {
  const mode = process.argv[2];
  if (mode === "run") {
    const run = await runLocalChallenge();
    console.log(canonicalJson(run));
    return;
  }
  if (mode === "check") {
    const run = checkLocalChallenge();
    console.log(`Local challenge evidence verified: ${run.status}.`);
    return;
  }
  throw new Error("Usage: node scripts/local-challenge.mjs <run|check>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
