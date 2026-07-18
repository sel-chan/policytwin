import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectMp4,
  inspectPng,
} from "../../scripts/submission-media-validation.mjs";
import {
  createValidMp4,
  createValidPng,
  createBrowserDecodableMp4,
  createFragmentedMp4,
} from "../helpers/submission-media-fixtures.mjs";
import { probeMp4WithChrome } from "../../scripts/submission-video-probe.mjs";

test("submission PNG validation decodes bounded image rows and verifies chunk integrity", () => {
  const png = createValidPng();
  assert.deepEqual(inspectPng(png), {
    valid: true,
    width: 320,
    height: 200,
    failures: [],
  });

  const corrupted = Buffer.from(png);
  corrupted[corrupted.length - 5] ^= 0xff;
  assert.equal(inspectPng(corrupted).valid, false);
  assert.equal(inspectPng(Buffer.from("not png")).valid, false);
  assert.equal(inspectPng(createValidPng(1, 1)).valid, false);
});

test("submission MP4 validation requires a sampled video stream and strict sub-three-minute duration", () => {
  const fragmented = inspectMp4(createBrowserDecodableMp4());
  assert.equal(fragmented.valid, true);
  assert.equal(fragmented.fragmented, false);
  const rejectedFragment = inspectMp4(createFragmentedMp4());
  assert.equal(rejectedFragment.valid, false);
  assert.equal(rejectedFragment.fragmented, true);
  const valid = inspectMp4(createValidMp4());
  assert.equal(valid.valid, true);
  assert.equal(valid.durationMilliseconds, 179_999);
  assert.deepEqual(valid.codecs, ["avc1"]);
  assert.deepEqual(valid.audioCodecs, ["mp4a"]);

  assert.equal(inspectMp4(createValidMp4({ durationMilliseconds: 180_000 })).valid, false);
  assert.equal(inspectMp4(createValidMp4({ includeVideo: false })).valid, false);
  assert.equal(inspectMp4(createValidMp4({ includeAudio: false })).valid, false);
  assert.equal(inspectMp4(createValidMp4({ includeMediaData: false })).valid, false);
  assert.equal(inspectMp4(createValidMp4({ videoSampleCount: 0 })).valid, false);
  assert.equal(inspectMp4(createValidMp4({ audioSampleCount: 0 })).valid, false);
  assert.equal(inspectMp4(Buffer.from("not an mp4")).valid, false);

  const truncated = createValidMp4().subarray(0, -1);
  assert.equal(inspectMp4(truncated).valid, false);
});

test("Chrome independently decodes audio and samples three timeline frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-media-probe-"));
  const path = join(directory, "probe.mp4");
  try {
    await writeFile(path, createBrowserDecodableMp4());
    const observation = await probeMp4WithChrome(path);
    assert.equal(observation.valid, true, observation.failures.join(" "));
    assert.equal(observation.audioTrackCount >= 1, true);
    assert.equal(observation.sampledFrameCount, 3);
    assert.equal(observation.distinctFrameCount >= 1, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
