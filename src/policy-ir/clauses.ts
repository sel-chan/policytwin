import type { PolicyClause } from "./types.js";

export function normalizeClauseText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function stableTextHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function segmentPolicyClauses(policyText: string): PolicyClause[] {
  const clauses: PolicyClause[] = [];
  const occurrences = new Map<string, number>();
  const sentencePattern = /[^.!?]+(?:[.!?]+|$)/gu;

  for (const match of policyText.matchAll(sentencePattern)) {
    const rawText = match[0];
    const leadingLength = rawText.length - rawText.trimStart().length;
    const trailingLength = rawText.length - rawText.trimEnd().length;
    const startOffset = (match.index ?? 0) + leadingLength;
    const endOffset = (match.index ?? 0) + rawText.length - trailingLength;
    const text = policyText.slice(startOffset, endOffset);
    const normalizedText = normalizeClauseText(text);
    if (normalizedText.length === 0) {
      continue;
    }

    const hash = stableTextHash(normalizedText);
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    clauses.push({
      id: occurrence === 1 ? `clause-${hash}` : `clause-${hash}-${occurrence}`,
      text,
      startOffset,
      endOffset,
      normalizedText,
    });
  }

  return clauses;
}
