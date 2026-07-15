import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const SVG_PATH = resolve("docs", "assets", "policytwin-architecture.svg");
const PNG_PATH = resolve("artifacts", "screenshots", "08-architecture.png");

function runRenderer(relativeOutput) {
  // Security-reviewed test boundary: fixed local Node executable and repository script,
  // no shell, managed artifact output, 30-second timeout, and 64 KiB output bounds.
  const result = spawnSync(
    process.execPath,
    ["scripts/render-architecture.mjs", "--output", relativeOutput],
    {
      cwd: resolve("."),
      shell: false,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("architecture source is self-contained and preserves the truthful live boundary", async () => {
  const svg = await readFile(SVG_PATH, "utf8");
  const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
  assert.match(svg, /width="1800" height="1200" viewBox="0 0 1800 1200"/u);
  assert.equal((svg.match(/id="node-/gu) ?? []).length, 12);
  for (const required of [
    "PARTIAL_OFFLINE · FAIL",
    "LIVE NOT RUN",
    "IMPLEMENTED AND LOCALLY EXECUTED",
    "REAL DOCKER NOT RUN",
    "NO OPENAI REQUEST",
    "Outbound traffic NOT_MEASURED",
    "No live attestation has been issued.",
    "No Codex repair, post-repair drift",
    "Reference-expectation differential",
    "16 drifts; not OPA-backed.",
    "Signed result → Proof · NOT RETURNED",
    "Two-file write set · rerun → Drift",
    "Verifier network = none",
    "EVIDENCE COLLECTION → PROOF",
  ]) {
    assert.ok(svg.includes(required), `Architecture SVG must contain ${required}.`);
  }
  assert.doesNotMatch(withoutNamespace, /<script\b|https?:\/\/|xlink:href|<image\b/iu);
  assert.doesNotMatch(svg, /LIVE_VERIFIED|SUBMITTED|REAL DOCKER PASS|LIVE CODEX PASS/iu);
});

test("architecture PNG is the exact submission canvas", async () => {
  const png = await readFile(PNG_PATH);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1800);
  assert.equal(png.readUInt32BE(20), 1200);
  assert.ok(png.byteLength > 100_000 && png.byteLength < 4 * 1024 * 1024);
});

test("architecture renderer is local-only and the submission workflow refreshes clean evidence", async () => {
  const renderer = await readFile(resolve("scripts", "render-architecture.mjs"), "utf8");
  const verify = await readFile(resolve("scripts", "verify.mjs"), "utf8");
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["submission:architecture"],
    "node scripts/render-architecture.mjs",
  );
  assert.match(renderer, /pathToFileURL\(source\)\.href/u);
  assert.match(renderer, /channel: "chrome"/u);
  assert.doesNotMatch(renderer, /page\.goto\(["']https?:/u);
  assert.match(renderer, /stat\.isSymbolicLink\(\)/u);
  assert.match(renderer, /path: temporaryOutput/u);
  assert.ok(
    renderer.indexOf("const outputParent = prepareManagedOutput(output)") <
      renderer.indexOf("path: temporaryOutput"),
  );
  assert.ok(renderer.indexOf("renameSync(temporaryOutput, output)") > 0);
  assert.ok(verify.indexOf('"clean:check"') < verify.indexOf('"submission:draft"'));
  assert.ok(verify.indexOf('"submission:draft"') < verify.indexOf('"submission:check"'));
});

test("architecture PNG is reproducible from the checked-in SVG", async () => {
  const relativeOutput = `artifacts/.architecture-test/${process.pid}-${randomBytes(8).toString("hex")}.png`;
  const output = resolve(relativeOutput);
  try {
    const result = runRenderer(relativeOutput);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const [checkedIn, regenerated] = await Promise.all([readFile(PNG_PATH), readFile(output)]);
    assert.ok(checkedIn.equals(regenerated), "Checked-in architecture PNG is stale.");
  } finally {
    await rm(resolve("artifacts", ".architecture-test"), { recursive: true, force: true });
  }
});
