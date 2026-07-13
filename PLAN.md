# PLAN.md — PolicyTwin Product and Execution Plan

## 0. Document contract

This document is the source of truth for what must be built. `AGENTS.md` defines how Codex works; this file defines the product, architecture, milestones, evidence, and acceptance criteria.

- Project: **PolicyTwin**
- Challenge: **OpenAI Build Week**
- Prepared: **2026-07-13**
- Primary domain: **SaaS refund eligibility**
- Primary audience: operations/policy owners, product managers, and application engineers
- Product language for v1 and submission: **English**
- Implementation status at creation: not assumed; inspect the repository
- Deadline: verify the exact official deadline and timezone at the start of execution and record it in `SUBMISSION.md`

## 1. Executive summary

Policy documents and production code drift apart. A policy owner writes “within 14 days and at or below 20% usage,” while application code may implement `< 14`, `< 20%`, or precedence in the wrong order. Existing natural-language-to-code tools can generate rules, but generation alone does not prove that the application follows them.

**PolicyTwin** is an evidence-first AI policy engineer. It:

1. interprets a natural-language refund policy into strict, versioned `PolicyIR`;
2. surfaces ambiguity instead of guessing;
3. deterministically compiles accepted policy meaning to Rego;
4. generates boundary, conflict, and minimal-contrast cases;
5. executes the same corpus against OPA and a real TypeScript application;
6. shows policy drift with exact counterexamples;
7. uses Codex to analyze and repair the application;
8. reruns all tests and produces a traceable proof package.

Core promise:

> Change a policy sentence, and the rules, tests, application behavior, traceability, and proof update together.

## 2. Why this project should win

The Build Week judging criteria are technical implementation, design and user experience, potential impact, and quality of idea. PolicyTwin addresses all four:

### Technical implementation

- GPT-5.6 through the Responses API;
- strict Structured Outputs;
- deterministic `PolicyIR` compiler;
- OPA/Rego evaluation;
- generated test corpora;
- differential testing;
- mutation testing;
- Codex SDK repository analysis and repair;
- reproducible evidence artifacts.

### Design and user experience

The product is a visual policy workspace, not a chatbot. It connects source clauses, resolved decisions, executable rules, cases, application code, and proof.

### Potential impact

Every organization has policies that become application conditions. Drift creates customer harm, operational cost, inconsistent decisions, and audit risk.

### Quality of idea

The product does not stop at “natural language to code.” It verifies whether real software behaves like the accepted policy and repairs the mismatch with evidence.

## 3. Product boundary

### 3.1 Required MVP

Build one excellent vertical slice:

- one English SaaS refund policy;
- one bundled TypeScript refund application fixture;
- three decisions: `ALLOW`, `DENY`, `REVIEW`;
- one deterministic `PolicyIR`;
- one Rego compiler;
- one OPA runtime;
- one generated case corpus;
- one Codex-driven repair flow;
- one evidence package;
- one polished web workspace;
- one deployable demo.

### 3.2 Explicit non-goals

Do not build these before the required MVP is verified:

- legal advice or regulatory certification;
- PDF/DOCX/OCR ingestion;
- arbitrary user repository execution in hosted production;
- GitHub OAuth or private repository support;
- multi-tenant organizations and RBAC;
- multiple policy engines;
- multiple programming languages;
- visual drag-and-drop rule authoring;
- production auto-merge or auto-deploy;
- broad policy domains such as lending, healthcare, insurance, or employment;
- mobile native applications;
- real customer billing.

### 3.3 Safety positioning

PolicyTwin is a software verification aid, not legal advice. Real policy deployment requires human approval. The hosted demo executes only the bundled trusted fixture.

## 4. Seeded demonstration contract

The demo must be deterministic and resettable.

### 4.1 Natural-language policy

Use this baseline policy, or a semantically equivalent polished version:

```text
Customers are eligible for a full refund when the request is made no later than 14 calendar days after purchase, including exactly day 14, and usage is 20% or less.

Promotional purchases require manager approval before a refund can be granted. Until a manager decides, the request must be reviewed.

Final-sale purchases are never refundable, even when another rule would otherwise allow a refund.
```

### 4.2 Explicit semantics and required ambiguity decisions

The seeded policy explicitly states these facts. The interpreter must extract them as rules and must not present them as ambiguities:

- exactly day 14 is included;
- exactly 20.00% usage is included;
- an eligible promotional purchase remains `REVIEW` until a manager decides;
- final sale overrides every otherwise allowing rule and is `DENY`.

The seeded policy leaves only these material questions unresolved, so the Decision Queue must ask them:

1. Is the purchase day counted as day 0?
2. Is usage measured at request time or decision time?
3. What is the default result when no eligibility rule matches?

For the seeded demo, accepted ambiguity decisions are:

- purchase day is day 0;
- usage is measured at request time;
- default result is `DENY`.

The interpreter may surface additional ambiguity only when it cites genuinely unresolved source text. A clear statement may produce a conflict or boundary test, but never a Decision Queue card merely to make the demo interactive.

### 4.3 Required seeded application bugs

The initial fixture must contain at least these three real behavioral defects:

```ts
const withinWindow = daysSincePurchase < 14;
const withinUsage = usageBasisPoints < 2000;

if (promotionalPurchase && managerApproved) {
  return "ALLOW";
}

if (finalSale) {
  return "DENY";
}
```

Required drift:

1. exact day 14 incorrectly returns `DENY`;
2. exact 20.00% usage incorrectly returns `DENY`;
3. promotional + final sale + manager approved incorrectly returns `ALLOW`.

The original buggy state must remain reproducible through `pnpm demo:reset`.

### 4.4 Required golden cases

At minimum:

| ID | Days | Usage bps | Promo | Final sale | Manager approved | Expected |
|---|---:|---:|---|---|---|---|
| G01 | 3 | 500 | false | false | false | ALLOW |
| G02 | 20 | 0 | false | false | false | DENY |
| G03 | 2 | 0 | true | false | false | REVIEW |
| G04 | 2 | 0 | true | false | true | ALLOW |
| G05 | 2 | 0 | false | true | false | DENY |
| G06 | 2 | 0 | true | true | true | DENY |

### 4.5 Required boundary cases

At minimum:

- days: 13, 14, 15;
- usage basis points: 1999, 2000, 2001;
- each manager state for promotional eligibility;
- final-sale combinations with otherwise eligible inputs;
- one no-match default-deny case.

### 4.6 Three-minute demo arc

The final video and live demo should follow this arc:

1. **0:00–0:20 — Problem:** show the existing application getting three edge cases wrong.
2. **0:20–0:50 — Interpret:** paste or load the policy; show clauses and structured rules.
3. **0:50–1:15 — Decide:** resolve ambiguity cards.
4. **1:15–1:40 — Test:** generate cases and compile policy.
5. **1:40–2:00 — Detect:** show three application drift rows in red.
6. **2:00–2:30 — Repair:** run Codex; show located code, patch, and tests.
7. **2:30–2:50 — Prove:** show zero drift, regression pass, and mutation score.
8. **2:50–3:00 — Change:** edit 14 days to 30 days and show impact analysis.

## 5. User personas and jobs

### 5.1 Policy owner / operations lead

Job: write and approve business policy without translating it into code.

Needs:

- clauses and decisions in plain language;
- ambiguity surfaced as choices;
- representative examples;
- proof that application behavior matches the approved policy.

### 5.2 Product or engineering lead

Job: understand the implementation impact of a policy change.

Needs:

- rule-to-code traceability;
- deterministic tests;
- drift report;
- safe, reviewable Codex patch;
- regression evidence.

### 5.3 Reviewer / judge

Job: understand the value and technical depth in minutes.

Needs:

- obvious before/after mismatch;
- visible GPT-5.6 interpretation;
- visible Codex repair;
- evidence, not unsupported claims;
- a polished, reliable demo.

## 6. Primary user journey

### Step A — Load policy

The user enters policy text and optionally golden cases. The seeded demo loads with one click.

### Step B — Interpret policy

GPT-5.6 returns strict `PolicyIR`, source clauses, candidate rules, assumptions that are safe and explicit ambiguities.

### Step C — Resolve ambiguity

The Decision Queue asks one decision at a time, shows source text, options, examples, and impact.

### Step D — Compile and generate cases

The deterministic compiler produces Rego. Case generation produces boundary, conflict, minimal-contrast, and regression cases.

### Step E — Compare with application

The same corpus runs against OPA and the fixture. Drift rows show input, expected decision, actual decision, source clause, rule, and code path where available.

### Step F — Repair with Codex

The user starts a repair. Codex maps the fixture, changes only the necessary code/tests, and returns a diff plus command evidence.

### Step G — Verify and prove

PolicyTwin reruns the corpus, regression suite, mutation suite, and traceability checks. The Proof screen provides downloadable evidence.

### Step H — Change impact

The user edits a policy threshold. PolicyTwin creates a new version and shows affected rules, cases, and code before applying another repair.

## 7. Functional requirements

### FR-01 — Policy workspace

The system must:

- create a policy project;
- accept plain-text English policy;
- accept or load golden cases;
- version policy text and decisions;
- show run status and errors;
- load/reset the seeded demo.

Acceptance:

- a fresh seeded project is available in at most two clicks;
- policy text and golden cases survive a server restart;
- changing policy text creates a new version instead of silently mutating proof.

### FR-02 — Clause segmentation and traceability

The system must segment source text into stable clauses with offsets.

Each clause includes:

```ts
interface PolicyClause {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  normalizedText: string;
}
```

Acceptance:

- every generated rule references at least one valid clause;
- selecting a rule highlights its source clause;
- offsets remain correct for the stored policy version.

### FR-03 — GPT-5.6 interpretation

Use the current OpenAI Responses API and strict Structured Outputs.

The model must produce:

- normalized field definitions;
- rules;
- default decision;
- explicit ambiguities;
- no arbitrary executable code;
- no policy facts absent from the source or accepted decisions.

Acceptance:

- output passes JSON Schema validation;
- invalid output is rejected, not coerced;
- prompt version, model, schema version, request ID where available, and timestamp are stored;
- user golden-case contradictions are surfaced.

### FR-04 — Decision Queue

`PolicyPatch` is a closed, versioned command union. It is not JSON Patch and may not contain arbitrary object paths or executable code:

```ts
type BoundaryField = "daysSincePurchase" | "usageBasisPoints";

type PolicyPatch =
  | {
      op: "SET_NORMALIZATION";
      field: "purchaseDayIndex";
      value: 0 | 1;
    }
  | {
      op: "SET_NORMALIZATION";
      field: "usageMeasuredAt";
      value: "REQUEST_TIME" | "DECISION_TIME";
    }
  | {
      op: "SET_BOUNDARY_OPERATOR";
      ruleId: string;
      field: BoundaryField;
      value: "lt" | "lte" | "gt" | "gte";
    }
  | {
      op: "SET_RULE_DECISION";
      ruleId: string;
      value: Decision;
    }
  | {
      op: "SET_PRECEDENCE";
      higherRuleId: string;
      lowerRuleId: string;
    }
  | {
      op: "SET_DEFAULT_DECISION";
      value: Decision;
    };
```

Category-to-operation mapping is fixed:

- `BOUNDARY` → `SET_BOUNDARY_OPERATOR`;
- `PRECEDENCE` → `SET_PRECEDENCE`;
- `DEFAULT` → `SET_DEFAULT_DECISION`;
- `MEASUREMENT` → `SET_NORMALIZATION`;
- `MISSING_OUTCOME` → `SET_RULE_DECISION`;
- `OTHER` requires a schema-versioned union extension before it can be resolved.

Each ambiguity must include:

```ts
interface PolicyAmbiguity {
  id: string;
  sourceClauseIds: string[];
  category:
    | "BOUNDARY"
    | "PRECEDENCE"
    | "DEFAULT"
    | "MEASUREMENT"
    | "MISSING_OUTCOME"
    | "OTHER";
  question: string;
  rationale: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    policyPatch: PolicyPatch;
    exampleImpacts: Array<{
      input: RefundPolicyInput;
      result: Decision;
    }>;
  }>;
  status: "OPEN" | "RESOLVED";
  selectedOptionId?: string;
}
```

Acceptance:

- unresolved required ambiguity blocks `VERIFIED`;
- choosing an option creates a versioned decision record;
- the server rejects a patch whose operation does not match the ambiguity category;
- referenced rule IDs must exist, and a boundary target must resolve to exactly one comparison predicate for the named field;
- applying a patch is idempotent, produces a new candidate IR version, and reruns full schema and golden-case validation;
- free-form paths, rule insertion/deletion, source-clause edits, and executable fragments are rejected;
- the UI shows affected rules and cases;
- the user can revisit a decision and create a new policy version.

### FR-05 — PolicyIR

Use a limited intermediate representation. A recommended v1 shape is:

```ts
type Decision = "ALLOW" | "DENY" | "REVIEW";

type Scalar = string | number | boolean;

type Predicate =
  | {
      type: "compare";
      field: keyof RefundPolicyInput;
      operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
      value: Scalar;
    }
  | {
      type: "in";
      field: keyof RefundPolicyInput;
      values: Scalar[];
    }
  | {
      type: "and" | "or";
      children: Predicate[];
    }
  | {
      type: "not";
      child: Predicate;
    };

interface PolicyRule {
  id: string;
  sourceClauseIds: string[];
  title: string;
  description: string;
  when: Predicate;
  decision: Decision;
  priority: number;
  explanationTemplate: string;
}

interface PolicyIR {
  id: string;
  policyId: string;
  version: number;
  schemaVersion: "1";
  domain: "saas_refund";
  clauses: PolicyClause[];
  rules: PolicyRule[];
  ambiguities: PolicyAmbiguity[];
  defaultDecision: Decision;
  normalization: {
    purchaseDayIndex: 0 | 1;
    usageMeasuredAt: "REQUEST_TIME" | "DECISION_TIME";
  };
  inputSchema: JsonSchema;
  metadata: {
    model: string;
    promptVersion: string;
    createdAt: string;
  };
}
```

Acceptance:

- no free-form code;
- supported operators are exhaustively validated;
- referenced fields exist;
- priorities are unique or ties are explicitly safe;
- all rule IDs and clause IDs are stable within a version.

### FR-06 — Refund input normalization

Use:

```ts
interface RefundPolicyInput {
  daysSincePurchase: number;
  usageBasisPoints: number;
  promotionalPurchase: boolean;
  finalSale: boolean;
  managerApproved: boolean;
  planType: "MONTHLY" | "ANNUAL" | "ENTERPRISE";
}
```

Rules:

- percentages are integer basis points;
- `20% = 2000`;
- date/time conversion occurs in an adapter before policy evaluation;
- `daysSincePurchase` is a non-negative integer;
- manager approval is meaningful only for promotional purchases but remains a valid boolean input;
- validation rejects NaN, Infinity, negative usage, and unknown fields where strict mode applies.

### FR-07 — Deterministic compiler

Implement a pure compiler from validated `PolicyIR` to:

1. Rego source;
2. a compiler manifest containing rule/line mappings;
3. deterministic snapshot output.

The compiler, not GPT-5.6, writes executable policy.

Required semantics:

- evaluate rules in descending priority;
- return the first matching rule;
- otherwise return `defaultDecision`;
- include rule ID and explanation in the result;
- encode input validation or validate before OPA;
- final-sale denial has the highest seeded priority.

Recommended result:

```ts
interface PolicyDecisionResult {
  decision: Decision;
  matchedRuleId: string | null;
  explanation: string;
  policyVersion: number;
}
```

Acceptance:

- same `PolicyIR` produces byte-stable Rego except documented metadata;
- OPA compiles the result;
- compiler snapshots cover every predicate type;
- invalid IR fails before Rego generation.

### FR-08 — OPA runner

The system must execute Rego against cases and capture structured results.

Acceptance:

- an OPA version is pinned;
- local and container runs use the same version;
- timeout and malformed-output failures are explicit;
- evaluation output records policy hash and case hash;
- no shell interpolation uses untrusted values.

### FR-09 — Case Lab

Support these case sources:

```ts
type CaseSource =
  | "USER_GOLDEN"
  | "BOUNDARY"
  | "CONFLICT"
  | "MINIMAL_CONTRAST"
  | "GENERATED"
  | "REGRESSION"
  | "MUTATION_WITNESS";
```

Case shape:

```ts
interface PolicyCase {
  id: string;
  title: string;
  input: RefundPolicyInput;
  expectedDecision: Decision;
  source: CaseSource;
  relatedRuleIds: string[];
  relatedClauseIds: string[];
  rationale: string;
}
```

Generation strategy:

1. deterministic boundary generator for numeric comparisons;
2. deterministic boolean combination generator bounded to relevant rules;
3. model-assisted semantic or missing-case suggestions;
4. deduplication by canonical input hash;
5. expected result derived from the accepted policy engine, except golden cases;
6. golden cases checked against policy engine, never overwritten.

Acceptance:

- at least 30 unique cases in the seeded accepted corpus;
- exact threshold neighbors are present;
- every rule has at least one positive and one negative witness where meaningful;
- minimal contrasts differ by one field whenever possible;
- generated cases are reviewable and traceable.

### FR-10 — Conflict detection

Detect:

- overlapping rules with different decisions;
- unreachable lower-priority rules;
- missing default outcome;
- contradictory golden cases;
- unresolved precedence;
- field values outside schema.

Acceptance:

- seeded promotion/final-sale overlap is recognized;
- accepted final-sale precedence resolves the conflict;
- deliberately removing priority causes verification failure.

### FR-11 — Mutation testing

Implement policy mutations, at minimum:

- `lte` ↔ `lt`;
- `gte` ↔ `gt`;
- `and` ↔ `or`;
- predicate deletion;
- boolean inversion;
- threshold ±1;
- priority swap;
- rule deletion;
- default decision change.

For each mutant:

1. create mutated IR or compiled policy;
2. run accepted case corpus;
3. mark killed if any expected decision differs;
4. store witness cases;
5. report survivors.

Metric:

```text
mutation_kill_rate = killed_mutants / non_equivalent_mutants
```

Equivalent mutants may be excluded only with a documented deterministic reason.

Acceptance:

- target kill rate ≥ 90%;
- every surviving non-equivalent mutant is listed;
- falling below 90% fails verification; documenting a non-equivalent survivor is not a waiver;
- score is computed from actual execution;
- no fabricated or model-estimated score.

### FR-12 — Differential application runner

Run each case against:

1. OPA expected result;
2. fixture application actual result.

Drift record:

```ts
interface DriftRecord {
  caseId: string;
  input: RefundPolicyInput;
  expected: PolicyDecisionResult;
  actual: PolicyDecisionResult;
  relatedClauseIds: string[];
  relatedRuleIds: string[];
  status: "MATCH" | "DRIFT" | "ERROR";
  error?: string;
}
```

Acceptance:

- before repair, all three seeded bugs produce drift;
- after repair, accepted corpus drift is zero;
- process errors are not treated as matches;
- reports are stored as evidence.

### FR-13 — Codex repository cartography

Before writing, Codex must analyze the trusted fixture in read-only mode and return strict structured findings:

- relevant entry points;
- policy logic locations;
- data transformation path;
- relevant tests;
- risks;
- proposed files to change;
- commands to verify.

Acceptance:

- cartography output is stored;
- no fixture file is changed in this phase;
- identified files include the seeded eligibility implementation and tests.

### FR-14 — Codex repair worker

Use the current server-side Codex SDK. Each run operates on a fresh temporary copy of the trusted fixture.

Repair contract:

1. provide source policy, accepted `PolicyIR`, failing drift cases, repository map, and allowed commands;
2. ask Codex to make the smallest correct patch;
3. require tests for every drift witness;
4. run the fixture test suite;
5. rerun differential cases;
6. permit a bounded repair iteration if tests fail;
7. store final diff, commands, exit codes, and Codex summary;
8. never modify the canonical buggy fixture.

Acceptance:

- repairs the three seeded bugs;
- fresh reset and rerun works;
- changed files are limited to justified code/tests/config;
- failure is visible and recoverable;
- secrets are not passed into the fixture process.

### FR-15 — Independent review

After repair, run an independent read-only review, using a separate Codex thread or deterministic review step, focused on:

- policy-rule omission;
- bypass paths;
- unrelated edits;
- insufficient tests;
- error handling;
- secret leakage;
- unsafe command execution.

Acceptance:

- review artifact is stored;
- high-severity findings block proof;
- fixes trigger another verification cycle.

### FR-16 — Proof package

Generate the evidence files listed in `AGENTS.md`, plus:

```text
run-metadata.json
prompt-manifest.json
compiler-manifest.json
codex-cartography.json
codex-review.json
test-command-log.json
security-review.md
```

`verification-summary.json` should include:

```ts
interface VerificationSummary {
  status: "PASS" | "FAIL";
  policyVersion: number;
  golden: { passed: number; total: number };
  generated: { passed: number; total: number };
  driftBefore: number;
  driftAfter: number;
  mutation: {
    killed: number;
    total: number;
    excludedEquivalent: number;
    killRate: number;
  };
  regression: { passed: number; total: number };
  traceability: {
    clausesCovered: number;
    clausesTotal: number;
    rulesCovered: number;
    rulesTotal: number;
    unlinkedCodeLocations: number;
  };
  security: {
    critical: number;
    high: number;
  };
  evidenceHash: string;
  createdAt: string;
}
```

Acceptance:

- human summary matches machine summary;
- hashes change when evidence changes;
- downloadable archive excludes secrets and transient logs;
- UI metrics match evidence.

### FR-17 — Policy version impact

When a threshold changes from 14 to 30:

- create a new version;
- compare clauses;
- compare IR;
- identify changed rules;
- regenerate cases;
- show changed expected decisions;
- show potentially impacted code mapping.

Acceptance:

- original proof remains accessible;
- impact view lists changed rule and affected cases;
- no automatic production code change occurs without a repair run.

## 8. Prompt contracts

Create versioned prompt files under `prompts/`.

### 8.1 Interpreter prompt requirements

System intent:

```text
You are a policy semantics interpreter. Convert only the supplied policy and accepted decisions into the supplied PolicyIR schema. Never write executable code. Never invent an exception, boundary, precedence, field, or outcome. When text is materially ambiguous, create an ambiguity item instead of guessing. Every rule must cite source clause IDs. User golden cases are evidence: report contradictions rather than rewriting them.
```

Inputs:

- policy clauses;
- input field catalog;
- supported operators;
- allowed decisions;
- accepted decisions;
- golden cases;
- schema version.

Output: strict `PolicyIRCandidate`.

### 8.2 Skeptic prompt requirements

System intent:

```text
Act as an adversarial policy reviewer. Find ambiguity, overlap, unreachable rules, boundary errors, missing defaults, and minimal counterexamples. Stay within the supplied input schema. Return structured findings and candidate cases. Do not change the accepted policy.
```

Output:

- ambiguity findings;
- conflict findings;
- candidate cases;
- rationale and related rule/clause IDs.

### 8.3 Codex cartographer prompt requirements

```text
Read only. Map how refund eligibility flows through this fixture. Identify relevant files, functions, transformations, tests, and commands. Use the provided drift witnesses to focus the search. Do not edit files. Return the requested JSON shape.
```

### 8.4 Codex repair prompt requirements

```text
Repair this trusted fixture so its externally observable refund decisions match the supplied accepted policy corpus. Make the smallest coherent change. Add regression tests for every failing witness. Do not change expected policy evidence. Do not bypass tests, weaken assertions, hard-code case IDs, or edit unrelated files. Run the required commands and return a structured summary of changed files, rationale, tests, and remaining risk.
```

### 8.5 Prompt evals

Create an eval set containing at least:

- the seeded policy;
- inclusive/exclusive threshold variants;
- missing precedence;
- conflicting golden case;
- missing outcome;
- irrelevant prose;
- adversarial instruction embedded in policy text;
- unsupported field request.

Acceptance:

- schema pass rate 100% on the eval set;
- no executable-code leakage;
- ambiguity recall for seeded labeled cases meets the target documented in `pnpm eval`;
- regressions block `pnpm verify`.

## 9. Architecture

Recommended architecture:

```text
┌───────────────────────────────────────────────────────────┐
│ Next.js Web                                               │
│ Policy Studio · Decision Queue · Case Lab · Drift · Proof │
└───────────────────────────┬───────────────────────────────┘
                            │ typed HTTP/SSE
┌───────────────────────────▼───────────────────────────────┐
│ Application API / Orchestrator                            │
│ versioning · state machine · evidence · run coordination  │
└──────────────┬──────────────────────┬─────────────────────┘
               │                      │
┌──────────────▼─────────────┐  ┌─────▼─────────────────────┐
│ Policy pipeline            │  │ Codex repair worker       │
│ GPT-5.6 interpreter        │  │ trusted fixture copy      │
│ ambiguity critic           │  │ cartography               │
│ deterministic compiler     │  │ patch + tests             │
│ OPA runner                 │  │ independent review        │
│ case/mutation engine       │  │ command/evidence capture  │
└──────────────┬─────────────┘  └─────┬─────────────────────┘
               │                      │
               └──────────┬───────────┘
                          ▼
┌───────────────────────────────────────────────────────────┐
│ SQLite + filesystem evidence store                        │
│ policies · versions · runs · cases · diffs · proof packs  │
└───────────────────────────────────────────────────────────┘
```

### 9.1 State machine

A policy version should move through explicit states:

```text
DRAFT
→ INTERPRETING
→ NEEDS_DECISION
→ READY_TO_COMPILE
→ COMPILED
→ DRIFT_DETECTED
→ REPAIRING
→ VERIFYING
→ VERIFIED
```

Failure states:

```text
INTERPRETATION_FAILED
COMPILATION_FAILED
EXECUTION_FAILED
REPAIR_FAILED
VERIFICATION_FAILED
```

Transitions must be validated server-side.

### 9.2 Deployment shape

Prefer a single containerized deployment for the hackathon if it can safely include:

- Next.js server;
- OPA binary;
- trusted fixture;
- Codex SDK worker;
- SQLite or persistent volume.

If the selected host cannot support long-running worker processes, split web and worker but keep the interface small.

The deployment choice must be based on available credentials and documented in `DECISIONS.md`. Do not force a provider before inspecting the environment.

### 9.3 Live and recorded evidence modes

The core path is live. For demo resilience, the UI may display the most recent successful proof package when live services are unavailable, but it must be labeled **Recorded verified run** with timestamp and evidence hash.

Never present recorded evidence as a newly executed run.

## 10. Suggested repository structure

Codex may refine names while preserving boundaries.

```text
policytwin/
├── AGENTS.md
├── PLAN.md
├── PROGRESS.md
├── DECISIONS.md
├── SUBMISSION.md
├── README.md
├── LICENSE
├── NOTICE.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── docker-compose.yml
├── Dockerfile
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── tests/
│   └── worker/
│       ├── src/
│       └── tests/
├── packages/
│   ├── domain/
│   ├── policy-ir/
│   ├── policy-interpreter/
│   ├── policy-compiler/
│   ├── opa-runner/
│   ├── case-generator/
│   ├── mutation-engine/
│   ├── differential-runner/
│   ├── codex-integration/
│   ├── evidence-pack/
│   └── test-support/
├── fixtures/
│   └── refund-demo/
│       ├── baseline/
│       ├── expected-fixed/
│       ├── scripts/
│       └── seeded-bugs.md
├── prompts/
│   ├── interpreter.v1.md
│   ├── skeptic.v1.md
│   ├── cartographer.v1.md
│   ├── repair.v1.md
│   └── reviewer.v1.md
├── schemas/
│   ├── policy-ir.v1.schema.json
│   ├── ambiguity.v1.schema.json
│   ├── cases.v1.schema.json
│   └── codex-results.v1.schema.json
├── evals/
│   ├── interpreter/
│   ├── cases/
│   └── expected/
├── artifacts/
│   ├── evidence/
│   ├── screenshots/
│   ├── demo/
│   └── submission/
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   ├── limitations.md
│   └── demo-runbook.md
└── scripts/
    ├── verify.mjs
    ├── demo-reset.mjs
    ├── demo-run.mjs
    ├── submission-check.mjs
    └── secret-scan.mjs
```

## 11. API design

The implementation may use server actions or route handlers, but preserve these contracts conceptually.

### Create project

```http
POST /api/policies
```

```json
{
  "title": "SaaS Refund Policy",
  "text": "...",
  "goldenCases": []
}
```

### Interpret

```http
POST /api/policies/:policyId/versions/:version/interpret
```

Returns run ID and streams progress.

### Resolve ambiguity

```http
POST /api/policies/:policyId/versions/:version/ambiguities/:id/resolve
```

```json
{
  "selectedOptionId": "INCLUSIVE"
}
```

### Compile

```http
POST /api/policies/:policyId/versions/:version/compile
```

### Generate cases

```http
POST /api/policies/:policyId/versions/:version/cases/generate
```

### Compare application

```http
POST /api/policies/:policyId/versions/:version/drift/run
```

### Repair fixture

```http
POST /api/policies/:policyId/versions/:version/repair
```

### Verify

```http
POST /api/policies/:policyId/versions/:version/verify
```

### Evidence

```http
GET /api/policies/:policyId/versions/:version/evidence
```

### Progress

```http
GET /api/runs/:runId/events
```

SSE event names:

```text
run.started
interpretation.started
interpretation.completed
decision.required
compile.started
compile.completed
case_generation.completed
drift.started
drift.completed
cartography.completed
repair.started
repair.command
repair.completed
review.completed
verification.started
verification.completed
run.failed
```

## 12. UI specification

### 12.1 Global shell

- product name and one-line promise;
- seeded-demo reset;
- current policy version and state;
- run progress;
- evidence/download access;
- no distracting global navigation.

### 12.2 Policy Studio

Layout:

- source policy on the left;
- rules and decision summary on the right;
- clause/rule hover linkage;
- version selector;
- interpret action;
- clear pending-decision badge.

Required states:

- pristine seeded policy;
- interpreting;
- schema failure;
- needs decisions;
- ready to compile;
- compiled.

### 12.3 Decision Queue

One decision card at a time:

- quoted source clause;
- concise question;
- why it matters;
- two or three options;
- example impacts;
- affected rule/case count;
- choose and continue.

Avoid a dense form.

### 12.4 Case Lab

Table columns:

- case title;
- source;
- compact input;
- expected decision;
- OPA result;
- app result;
- status;
- linked rule/clause.

Filters:

- `ALLOW`;
- `DENY`;
- `REVIEW`;
- `DRIFT`;
- source type.

Include a focused comparison drawer.

### 12.5 Drift and Integration view

Show:

- before/after drift counts;
- failing witness;
- source clause;
- rule;
- actual code location;
- Codex timeline;
- diff;
- test commands and exit status;
- independent review result.

The user must be able to understand why the application was wrong.

### 12.6 Proof view

Required cards:

```text
OPA compilation
Golden cases
Generated cases
Application drift
Regression tests
Mutation score
Traceability
Security review
Evidence hash
```

Each card opens supporting evidence. Avoid model confidence scores.

### 12.7 Change impact view

For 14 → 30 days:

- textual diff;
- rule diff;
- cases whose expected result changed;
- code mapping;
- new verification state.

### 12.8 Accessibility and responsiveness

- semantic landmarks;
- visible focus;
- full keyboard path for the demo;
- labels for status icons;
- no status communicated by color alone;
- usable at 1280×720 and common laptop resolutions;
- mobile view does not need full table density but must remain navigable.

## 13. Evidence and evaluation

### 13.1 Authoritative offline verification command

`pnpm verify` must fail on any required offline gate. It must not require network access, account credentials, fresh GPT output, or a fresh Codex run. Versioned fixtures and recorded response contracts may be used only for deterministic regression coverage.

Recommended sequence:

1. lockfile/install consistency check;
2. format/lint;
3. typecheck;
4. unit tests;
5. integration tests;
6. fixture-backed prompt/schema evals;
7. compiler/OPA tests;
8. mutation test threshold;
9. deterministic differential seeded run against the bundled before/expected fixtures;
10. browser tests;
11. production build;
12. container health check where supported;
13. secret and license checks;
14. submission artifact static consistency.

### 13.2 Authoritative live integration command

`pnpm verify:live` must fail unless the current run performs and captures fresh external work:

1. GPT-5.6 interpretation through the Responses API with strict Structured Outputs;
2. schema, prompt-version, request/run metadata, and golden-contradiction checks;
3. live Codex cartography, repair, and review in a fresh trusted fixture copy;
4. post-repair regression and differential execution;
5. evidence hashing and freshness validation.

The live gate may run only after the required network scope and credentials are available. Recorded evidence cannot pass this gate. Engineering completion and submission require both `pnpm verify` and `pnpm verify:live`.

### 13.3 Eval scorecard

Create `artifacts/evidence/eval-scorecard.json` with:

| Area | Target |
|---|---:|
| Structured-output schema pass | 100% |
| Seeded material ambiguity labels found | 100% |
| Explicit seeded semantics mislabeled as ambiguity | 0 |
| Golden case agreement | 100% |
| Boundary case agreement | 100% |
| Seeded drift bugs detected | 3/3 |
| Post-repair drift | 0 |
| Mutation kill rate | ≥ 90% |
| Rule-to-clause traceability | 100% |
| Rule-to-case traceability | 100% |
| Critical/high security findings | 0 |
| Browser happy-path pass | 100% |

If a target is not met, the Proof status is `FAIL`.

### 13.4 Judge-facing evidence map

The submission must map:

- **technical implementation** → architecture, OpenAI calls, compiler, OPA, mutation, Codex repair;
- **design/UX** → five workspace screens and browser evidence;
- **impact** → policy drift problem and before/after result;
- **idea quality** → difference between code generation and behavior proof.

## 14. Milestone execution plan

Milestones are sequential gates, not estimates. Do not proceed with a broken foundation unless parallel independent work is clearly safe.

### M0 — Preflight and baseline

Tasks:

- inspect repository and tools;
- verify Git state;
- verify Node/pnpm/Docker/OPA availability;
- verify Codex Goal mode and SDK feasibility;
- verify current official OpenAI and Build Week documentation;
- update exact deadline and rules in `SUBMISSION.md`;
- create initial architecture and risk notes;
- establish package manager and root scripts;
- define separate `pnpm verify` offline and `pnpm verify:live` fresh-integration gates;
- create or confirm baseline commit.

Gate:

- `PROGRESS.md` has environment, assumptions, deadline, baseline commands, and commit;
- repository installs;
- a minimal root test and build command execute;
- no secret is committed.

### M1 — Domain core and seeded fixture

Tasks:

- implement domain types and validation;
- create buggy fixture;
- create golden cases;
- implement reset/copy utilities;
- write fixture tests that expose behavior without already correcting bugs;
- create canonical expected-fixed fixture only for evaluation, not for the repair agent.

Gate:

- `pnpm demo:reset` reproduces all three bugs;
- deterministic tests confirm the expected three drifts;
- fixture is isolated from the main app.

### M2 — PolicyIR and interpretation

Tasks:

- create schemas and Zod types;
- segment clauses;
- implement GPT-5.6 Responses API call;
- implement strict output validation;
- create interpreter prompt;
- store run metadata;
- build prompt eval fixtures.

Gate:

- seeded policy produces valid candidate IR;
- ambiguous decisions are surfaced;
- malicious text cannot override system contract;
- schema/eval tests pass.

### M3 — Decision Queue and versioning

Tasks:

- implement policy/version persistence;
- implement ambiguity resolution patches;
- implement state machine;
- build Decision Queue UI;
- add golden contradiction handling.

Gate:

- seeded decisions can be resolved from UI;
- policy version and decision records persist;
- unresolved decisions block compilation.

### M4 — Compiler and OPA

Tasks:

- implement deterministic compiler;
- pin/install OPA;
- implement runner;
- create rule mappings and snapshots;
- build compilation UI status.

Gate:

- OPA compiles seeded Rego;
- golden cases pass;
- compiler output is deterministic;
- invalid IR fails safely.

### M5 — Case generation, conflicts, and mutation

Tasks:

- deterministic boundary generation;
- conflict and reachability checks;
- minimal-contrast generation;
- optional model-assisted candidate suggestions;
- mutation engine;
- score and witness evidence;
- Case Lab UI.

Gate:

- accepted corpus has at least 30 unique cases;
- required boundaries and overlap cases exist;
- mutation kill rate is at least 90% or iteration continues;
- every equivalent exclusion is deterministically justified and every non-equivalent survivor is reported;
- all cases are traceable.

### M6 — Differential runner and drift UX

Tasks:

- implement fixture adapter;
- run corpus against OPA and app;
- create drift report;
- map evidence to UI;
- show seeded three drift rows.

Gate:

- exactly or at least the intended three seeded defects are visible and reproducible;
- execution errors are separate from drift;
- evidence files are written.

### M7 — Codex cartography, repair, and review

Tasks:

- integrate current Codex SDK server-side;
- run read-only cartography;
- run repair in fresh fixture copy;
- capture commands and diff;
- rerun tests and differential cases;
- run independent review;
- retry bounded fixes if necessary;
- build Integration UI.

Gate:

- three seeded defects repaired in a fresh copy;
- post-repair drift is zero;
- fixture regression tests pass;
- review has no blocking finding;
- canonical buggy fixture remains unchanged.
- `pnpm verify:live` passes using a fresh GPT/Codex evidence run.

### M8 — Proof, impact, and product polish

Tasks:

- generate proof package and archive;
- implement Proof screen;
- implement 14 → 30 impact flow;
- add error/empty/loading states;
- accessibility pass;
- responsive pass;
- visual inspection with screenshots;
- ensure recorded evidence is clearly labeled.

Gate:

- complete happy path from reset to proof;
- proof metrics match files;
- browser tests pass;
- screenshots show no obvious defects.

### M9 — Security, reproducibility, and deployment

Tasks:

- threat model;
- command allowlist and timeouts;
- secret redaction;
- dependency/license/secret scan;
- clean-checkout test;
- Docker build;
- health endpoint;
- select and configure host;
- deploy;
- run browser smoke test against deployed URL;
- document rollback/redeploy.

Gate:

- no critical/high finding;
- clean checkout reaches demo;
- production container starts;
- live URL is healthy;
- live happy path or an explicitly documented hosted limitation is verified.

### M10 — Submission package

Tasks:

- update README from actual product;
- create architecture diagram;
- create final screenshots;
- create three-minute demo recording and captions;
- generate final English submission copy;
- verify all claims;
- publish source repository if allowed;
- publish demo video;
- complete challenge form;
- capture confirmation.

Gate:

- `pnpm submission:check` passes;
- all URLs resolve;
- demo video is within official constraints;
- no secret/private data appears;
- submission confirmation is stored;
- `SUBMISSION.md` status is truthful.

## 15. Scope priority under deadline pressure

Never cut the evidence-backed vertical slice.

### P0 — Cannot cut

- seeded policy and fixture;
- GPT-5.6 strict interpretation;
- ambiguity queue;
- deterministic compiler;
- OPA;
- case corpus;
- seeded drift;
- Codex repair;
- zero post-repair drift;
- mutation score;
- polished core UI;
- reproducible evidence;
- deployment/demo/submission.

### P1 — Cut only after documenting

- model-assisted case suggestions beyond deterministic cases;
- mobile-specific polish beyond functional responsiveness;
- multiple saved projects;
- advanced animation;
- extra impact visualizations;
- additional policy examples.

### P2 — Exclude

Everything listed in non-goals.

## 16. Failure and fallback strategies

### OpenAI model call unavailable

- keep API integration intact;
- show an explicit service error;
- allow loading the last verified run as recorded evidence;
- do not mark a new run successful;
- continue local deterministic work and retry later.

### Codex SDK API changes or incompatibility

- consult current official docs;
- adapt to current server-side SDK;
- if the SDK is genuinely unavailable, use the current supported Codex CLI/app-server/MCP path as a documented implementation decision;
- the repair must still be real and evidence-captured.

### OPA deployment difficulty

- pin the official OPA binary in the Docker image;
- do not replace OPA with a fake evaluator solely to pass the demo;
- a TypeScript reference evaluator may supplement tests but not impersonate OPA evidence.

### Hosting lacks required worker capabilities

- select a container/VM host with filesystem and process execution;
- split web and worker if needed;
- preserve a stable live read-only recorded proof view while the live repair endpoint remains access-controlled;
- document the limitation accurately.

### Demo recording difficulty

- use Playwright to execute a deterministic script;
- capture clean screen recording with available OS/browser tools;
- create captions and voiceover script;
- if automated voiceover is unavailable, use concise on-screen captions;
- never delay repository and submission copy work while recording is blocked.

### External submission blocker

- complete and validate every artifact;
- write exact field values to `artifacts/submission/`;
- open the correct page when tools allow;
- pause only for the single owner-only action;
- resume to verify confirmation.

## 17. Acceptance matrix

| Requirement | Proof |
|---|---|
| Policy text interpreted | stored Responses API metadata + valid IR |
| Ambiguity not guessed | Decision Queue records |
| Executable policy deterministic | compiler snapshots + Rego hash |
| OPA actually used | command/output/version evidence |
| Boundaries covered | generated case corpus |
| Conflicts covered | conflict report + witnesses |
| Test quality measured | mutation report |
| Real app drift detected | pre-repair differential report |
| Codex repairs code | SDK run summary + diff + command log |
| Repair is correct | post-repair differential and regression reports |
| Traceability complete | traceability graph/report |
| UX works | Playwright test + screenshots |
| Deployment works | live health and browser smoke evidence |
| Claims truthful | submission consistency check |
| Submission finished | verified confirmation evidence |

## 18. Definition of done

All of the following must be true:

1. A fresh checkout can install, build, and run using documented commands.
2. The seeded demo can reset from any previous run.
3. GPT-5.6 returns schema-valid policy interpretation.
4. Required ambiguities are resolved explicitly.
5. The deterministic compiler produces valid Rego.
6. OPA agrees with every accepted golden and generated case.
7. The corpus contains at least 30 unique cases with required boundaries.
8. Mutation kill rate over non-equivalent mutants is at least 90%; equivalent exclusions are deterministically justified and every non-equivalent survivor is reported.
9. The buggy application shows all three required drift failures.
10. Codex repairs the application in a fresh copy.
11. Post-repair drift is zero.
12. Existing and added tests pass.
13. Traceability from clause → rule → case → code is complete for the demo.
14. No critical/high security finding remains.
15. The UI is polished, keyboard-operable, responsive, and browser-tested.
16. Evidence files and summary agree and are downloadable.
17. The production deployment is healthy and verified.
18. README, screenshots, video, captions, and submission copy match actual behavior.
19. Repository and video URLs are published when required.
20. Both `pnpm verify` and `pnpm verify:live` pass with current evidence.
21. The challenge submission is confirmed, or exactly one unavoidable owner-only action remains and every artifact is ready.

## 19. Official references to re-check during implementation

OpenAI:

- Build Week: https://openai.com/build-week/
- Goal mode: https://developers.openai.com/codex/use-cases/follow-goals/
- Slash commands: https://developers.openai.com/codex/cli/slash-commands
- AGENTS.md: https://developers.openai.com/codex/guides/agents-md
- Best practices: https://developers.openai.com/codex/learn/best-practices
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Model guidance: https://developers.openai.com/api/docs/guides/latest-model
- Codex SDK: https://developers.openai.com/codex/codex-sdk
- Subagents: https://developers.openai.com/codex/subagents
- Long-running work: https://developers.openai.com/codex/long-running-work

Other implementation references should be official upstream documentation where possible, especially for OPA, Next.js, Docker, and the selected deployment provider.
