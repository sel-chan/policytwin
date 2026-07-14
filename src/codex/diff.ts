import { assertSafeRelativePath } from "./safety.js";

const MAX_CANONICAL_DIFF_BYTES = 256 * 1024;

export interface FixtureTextChange {
  path: string;
  before: string;
  after: string;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unifiedLines(content: string): { lines: string[]; hasFinalNewline: boolean } {
  if (content.length === 0) {
    return { lines: [], hasFinalNewline: false };
  }
  const hasFinalNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasFinalNewline) lines.pop();
  return { lines, hasFinalNewline };
}

function prefixedUnifiedLines(prefix: "-" | "+", content: string): string[] {
  const { lines, hasFinalNewline } = unifiedLines(content);
  const result: string[] = [];
  for (const [index, line] of lines.entries()) {
    result.push(`${prefix}${line}`);
    if (index === lines.length - 1 && !hasFinalNewline) {
      result.push("\\ No newline at end of file");
    }
  }
  return result;
}

function unifiedRange(lineCount: number): string {
  return lineCount === 0 ? "0,0" : `1,${lineCount}`;
}

export function createCanonicalFixtureDiff(
  changes: readonly FixtureTextChange[],
): string {
  if (changes.length === 0) {
    throw new Error("A canonical fixture diff requires at least one changed file.");
  }
  const normalized = changes
    .map((change, index) => {
      const path = assertSafeRelativePath(change.path, `fixture diff change ${index}.path`);
      if (typeof change.before !== "string" || typeof change.after !== "string") {
        throw new Error(`Fixture diff change ${path} must contain UTF-8 text.`);
      }
      if (change.before === change.after) {
        throw new Error(`Fixture diff change ${path} does not change file content.`);
      }
      return { path, before: change.before, after: change.after };
    })
    .sort((left, right) => compareText(left.path, right.path));
  if (new Set(normalized.map((change) => change.path)).size !== normalized.length) {
    throw new Error("Canonical fixture diff paths must be unique.");
  }

  const sections = normalized.map(({ path, before, after }) => {
    const beforeLines = unifiedLines(before).lines;
    const afterLines = unifiedLines(after).lines;
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -${unifiedRange(beforeLines.length)} +${unifiedRange(afterLines.length)} @@`,
      ...prefixedUnifiedLines("-", before),
      ...prefixedUnifiedLines("+", after),
    ].join("\n");
  });
  const diff = `${sections.join("\n")}\n`;
  if (Buffer.byteLength(diff, "utf8") > MAX_CANONICAL_DIFF_BYTES) {
    throw new Error("Canonical fixture diff exceeds the byte limit.");
  }
  return diff;
}
