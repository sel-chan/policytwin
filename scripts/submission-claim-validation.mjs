function entries(texts) {
  return texts instanceof Map ? [...texts] : Object.entries(texts ?? {});
}

function eachMatch(texts, pattern, visit) {
  for (const [name, text] of entries(texts)) {
    if (typeof text !== "string") continue;
    for (const line of text.split(/\r?\n/u)) {
      for (const match of line.matchAll(pattern)) visit(name, match);
    }
  }
}

export function collectSubmissionClaimFailures(texts, evidence) {
  const failures = [];
  const expected = {
    cases: evidence.golden.total + evidence.generated.total,
    goldenPassed: evidence.golden.passed,
    goldenTotal: evidence.golden.total,
    generatedPassed: evidence.generated.passed,
    generatedTotal: evidence.generated.total,
    driftBefore: evidence.driftBefore,
    mutationKilled: evidence.mutation.killed,
    mutationTotal: evidence.mutation.total,
    mutationPercent: Number((evidence.mutation.killRate * 100).toFixed(2)),
  };

  eachMatch(
    texts,
    /\b(\d+)\s+(?:accepted\s+(?:policy\s+)?cases|traceable\s+cases|policy\s+cases)\b/giu,
    (name, match) => {
      if (Number(match[1]) !== expected.cases) {
        failures.push(`Case-count claim conflicts with evidence in ${name}: ${match[0]}`);
      }
    },
  );
  eachMatch(
    texts,
    /\b(?:corpus|suite)\s+(?:contains|has|includes|covers)\s+(\d+)\s+(?:accepted\s+)?cases\b/giu,
    (name, match) => {
      if (Number(match[1]) !== expected.cases) {
        failures.push(`Case-count claim conflicts with evidence in ${name}: ${match[0]}`);
      }
    },
  );
  eachMatch(texts, /\b(\d+)[- ]case\s+(?:accepted\s+)?corpus\b/giu, (name, match) => {
    if (Number(match[1]) !== expected.cases) {
      failures.push(`Case-count claim conflicts with evidence in ${name}: ${match[0]}`);
    }
  });
  for (const [label, passed, total] of [
    ["golden", expected.goldenPassed, expected.goldenTotal],
    ["generated", expected.generatedPassed, expected.generatedTotal],
  ]) {
    eachMatch(texts, new RegExp(`\\b(\\d+)\\/(\\d+)\\s+${label}\\b`, "giu"), (name, match) => {
      if (Number(match[1]) !== passed || Number(match[2]) !== total) {
        failures.push(`${label} case claim conflicts with evidence in ${name}: ${match[0]}`);
      }
    });
  }
  eachMatch(
    texts,
    /\b(\d+)\s+(?:(?:buggy-fixture|reference-expectation)(?:\s+corpus)?|accepted-corpus)\s+drifts?\b/giu,
    (name, match) => {
      if (Number(match[1]) !== expected.driftBefore) {
        failures.push(`Pre-repair drift claim conflicts with evidence in ${name}: ${match[0]}`);
      }
    },
  );
  eachMatch(
    texts,
    /\bmutation\s+(?:score|kill rate)[^\d%\r\n]{0,12}(\d+(?:\.\d+)?)%/giu,
    (name, match) => {
      if (Math.abs(Number(match[1]) - expected.mutationPercent) > 0.005) {
        failures.push(`Mutation-rate claim conflicts with evidence in ${name}: ${match[0]}`);
      }
    },
  );
  eachMatch(
    texts,
    /\b(?:detects?|exposes?)\s+(\d+)\s+mismatches?\s+in\s+(?:a\s+)?(?:deliberately\s+)?buggy\b/giu,
    (name, match) => {
      if (Number(match[1]) !== expected.driftBefore) {
        failures.push(`Buggy-fixture mismatch claim conflicts with evidence in ${name}: ${match[0]}`);
      }
    },
  );
  eachMatch(texts, /\b(\d+)\/(\d+)\s+mutants?\b/giu, (name, match) => {
    if (
      Number(match[1]) !== expected.mutationKilled ||
      Number(match[2]) !== expected.mutationTotal
    ) {
      failures.push(`Mutation claim conflicts with evidence in ${name}: ${match[0]}`);
    }
  });
  eachMatch(texts, /\bexecutes?\s+(\d+)\s+(?:policy\s+)?mutants?\b/giu, (name, match) => {
    if (Number(match[1]) !== expected.mutationTotal) {
      failures.push(`Mutation-total claim conflicts with evidence in ${name}: ${match[0]}`);
    }
  });
  eachMatch(texts, /(?<![/\d])\b(\d+)\s+(?:policy\s+)?mutants?\s+(?:are\s+|were\s+)?killed\b/giu, (name, match) => {
    if (Number(match[1]) !== expected.mutationKilled) {
      failures.push(`Killed-mutant claim conflicts with evidence in ${name}: ${match[0]}`);
    }
  });
  eachMatch(
    texts,
    /\b(\d+(?:\.\d+)?)%\)?(?:\s+[A-Za-z-]+){0,4}\s+mutation(?:\s+score)?\b/giu,
    (name, match) => {
      if (Math.abs(Number(match[1]) - expected.mutationPercent) > 0.005) {
        failures.push(`Mutation-rate claim conflicts with evidence in ${name}: ${match[0]}`);
      }
    },
  );

  if (expected.mutationKilled !== expected.mutationTotal) {
    eachMatch(texts, /\b(?:all\s+(?:policy\s+)?mutants?\s+(?:are\s+|were\s+)?killed|100%\s+mutation|mutation\s+(?:score|kill rate)\s*(?:is|=|:)?\s*100%)\b/giu, (name, match) => {
      failures.push(`Perfect-mutation claim conflicts with evidence in ${name}: ${match[0]}`);
    });
  }
  if (evidence.driftAfter !== 0) {
    for (const [name, text] of entries(texts)) {
      if (typeof text !== "string") continue;
      for (const line of text.split(/\r?\n/u)) {
        const patterns = [
          /\bpost[- ]repair[^.]{0,48}\b(?:zero|0)\s+drift\b/giu,
          /\b(?:zero|0)\s+post[- ]repair[^.]{0,32}\bdrift\b/giu,
          /\bdrift[^.]{0,32}\b(?:falls|drops|goes|is)\s+(?:to\s+)?(?:zero|0)\b[^.]{0,24}\bafter\s+(?:the\s+)?repair\b/giu,
          /\bafter\s+(?:the\s+)?repair\b[^.]{0,32}\bdrift\b[^.]{0,16}\b(?:zero|0)\b/giu,
        ];
        const conflicting = patterns.some((pattern) => pattern.test(line));
        if (conflicting) {
          failures.push(`Post-repair zero-drift claim lacks live evidence in ${name}.`);
        }
      }
    }
  }

  const claimAudit = entries(texts).find(([name]) => name === "claim-audit.md")?.[1] ?? "";
  for (const requiredClaim of [
    `${expected.cases} accepted policy cases`,
    `${expected.driftBefore} buggy-fixture corpus drifts`,
    `${expected.mutationKilled}/${expected.mutationTotal} mutants killed`,
  ]) {
    if (!claimAudit.includes(requiredClaim)) {
      failures.push(`Claim audit does not match current evidence: ${requiredClaim}`);
    }
  }
  return [...new Set(failures)].sort();
}
