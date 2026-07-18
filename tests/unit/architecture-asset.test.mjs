import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { inflateSync } from "node:zlib";

const SVG_PATH = resolve("docs", "assets", "policytwin-architecture.svg");
const PNG_PATH = resolve("artifacts", "screenshots", "08-architecture.png");

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodeRgbPng(png) {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let offset = 8;
  let width;
  let height;
  const compressed = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8, 13)], [8, 2, 0, 0, 0]);
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  assert.ok(width && height && compressed.length > 0);
  const scanlines = inflateSync(Buffer.concat(compressed));
  const stride = width * 3;
  assert.equal(scanlines.length, height * (stride + 1));
  const pixels = Buffer.alloc(height * stride);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = scanlines[inputOffset];
    inputOffset += 1;
    assert.ok(filter >= 0 && filter <= 4, `Unsupported PNG filter ${filter}.`);
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const encoded = scanlines[inputOffset];
      inputOffset += 1;
      const left = column >= 3 ? pixels[rowOffset + column - 3] : 0;
      const up = row > 0 ? pixels[rowOffset - stride + column] : 0;
      const upperLeft = row > 0 && column >= 3 ? pixels[rowOffset - stride + column - 3] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upperLeft);
      pixels[rowOffset + column] = (encoded + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function describePixelDifference(firstPng, secondPng) {
  const first = decodeRgbPng(firstPng);
  const second = decodeRgbPng(secondPng);
  assert.deepEqual(
    { width: first.width, height: first.height },
    { width: second.width, height: second.height },
  );
  let changedPixels = 0;
  let changedChannels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  for (let offset = 0; offset < first.pixels.length; offset += 3) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(first.pixels[offset + channel] - second.pixels[offset + channel]);
      if (delta > 0) {
        pixelChanged = true;
        changedChannels += 1;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        totalChannelDelta += delta;
      }
    }
    if (pixelChanged) changedPixels += 1;
  }
  return {
    changedPixels,
    totalPixels: first.width * first.height,
    changedChannels,
    maxChannelDelta,
    totalChannelDelta,
  };
}

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
  for (const stableRenderingArgument of [
    "--disable-gpu",
    "--disable-lcd-text",
    "--font-render-hinting=none",
  ]) {
    assert.ok(renderer.includes(stableRenderingArgument));
  }
  assert.match(renderer, /document\.fonts\.ready/u);
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
    const checkedInHash = createHash("sha256").update(checkedIn).digest("hex");
    const regeneratedHash = createHash("sha256").update(regenerated).digest("hex");
    const pixelDifference = describePixelDifference(checkedIn, regenerated);
    assert.ok(
      checkedIn.equals(regenerated),
      `Checked-in architecture PNG is stale: ${checkedInHash} != ${regeneratedHash}; ${JSON.stringify(pixelDifference)}.`,
    );
  } finally {
    await rm(resolve("artifacts", ".architecture-test"), { recursive: true, force: true });
  }
});
