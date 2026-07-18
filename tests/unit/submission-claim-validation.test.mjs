import assert from "node:assert/strict";
import test from "node:test";
import { collectSubmissionClaimFailures } from "../../scripts/submission-claim-validation.mjs";

const evidence = {
  golden: { passed: 6, total: 6 },
  generated: { passed: 35, total: 35 },
  driftBefore: 16,
  driftAfter: null,
  mutation: { killed: 44, total: 47, killRate: 44 / 47 },
};

function validTexts() {
  return new Map([
    [
      "claim-audit.md",
      "41 accepted policy cases\n16 buggy-fixture corpus drifts\n44/47 mutants killed",
    ],
    [
      "accomplishments.md",
      "6/6 golden and 35/35 generated cases pass. 16 reference-expectation corpus drifts. 44/47 mutants killed (93.62%) under the reference mutation evaluator.",
    ],
    [
      "demo-script.md",
      "Post-repair drift is NOT_RUN; no result is claimed. The build executes 47 policy mutants.",
    ],
  ]);
}

test("submission claim audit accepts evidence-matched metrics and explicit non-claims", () => {
  assert.deepEqual(collectSubmissionClaimFailures(validTexts(), evidence), []);
});

test("submission claim audit finds conflicting metrics anywhere in final text", () => {
  const texts = validTexts();
  texts.set(
    "long-description.md",
    "50 accepted policy cases; 47/47 mutants killed; 15 buggy-fixture drifts; zero post-repair drift; all policy mutants were killed.",
  );
  const failures = collectSubmissionClaimFailures(texts, evidence);
  assert.equal(failures.some((failure) => failure.startsWith("Case-count claim conflicts")), true);
  assert.equal(failures.some((failure) => failure.startsWith("Mutation claim conflicts")), true);
  assert.equal(failures.some((failure) => failure.startsWith("Pre-repair drift claim conflicts")), true);
  assert.equal(failures.some((failure) => failure.startsWith("Post-repair zero-drift claim")), true);
  assert.equal(failures.some((failure) => failure.startsWith("Perfect-mutation claim")), true);

  const reverseOrder = validTexts();
  reverseOrder.set(
    "README.md",
    "The corpus contains 50 cases. The mutation score is 100%. Drift falls to 0 after repair.",
  );
  const reverseFailures = collectSubmissionClaimFailures(reverseOrder, evidence);
  assert.equal(reverseFailures.some((failure) => failure.startsWith("Case-count claim")), true);
  assert.equal(reverseFailures.some((failure) => failure.startsWith("Mutation-rate claim")), true);
  assert.equal(reverseFailures.some((failure) => failure.startsWith("Post-repair zero-drift")), true);

  const negationSuffix = validTexts();
  negationSuffix.set(
    "demo-script.md",
    "Post-repair zero drift is live now; the screenshot is not yet attached. After the repair, drift is 0, but the proof is missing from this paragraph.",
  );
  const negationFailures = collectSubmissionClaimFailures(negationSuffix, evidence);
  assert.equal(
    negationFailures.some((failure) => failure.startsWith("Post-repair zero-drift")),
    true,
  );
});

test("final numeric targets cannot exempt themselves from evidence comparison", () => {
  const texts = validTexts();
  texts.set(
    "whats-next.md",
    "[FUTURE_TARGET_NOT_CURRENT_EVIDENCE: 50-case corpus]\n[FUTURE_TARGET_NOT_CURRENT_EVIDENCE: mutation score of 100% in production today]",
  );
  const failures = collectSubmissionClaimFailures(texts, evidence);
  assert.equal(failures.some((failure) => failure.startsWith("Case-count claim")), true);
  assert.equal(failures.some((failure) => failure.startsWith("Mutation-rate claim")), true);
});

test("prospective vocabulary cannot hide a current conflicting claim", () => {
  const texts = validTexts();
  texts.set(
    "long-description.md",
    "Our next-generation product currently verifies 999 accepted policy cases. The target dashboard already shows a mutation score of 100%. Our target achieved 999 accepted policy cases. The shipped plan delivers 999 accepted policy cases. Our target is 999 accepted policy cases, already achieved in production. We plan to execute 999 policy mutants, and that capability is live now.",
  );
  const failures = collectSubmissionClaimFailures(texts, evidence);
  assert.equal(failures.some((failure) => failure.startsWith("Case-count claim")), true);
  assert.equal(failures.some((failure) => failure.startsWith("Mutation-rate claim")), true);
});
