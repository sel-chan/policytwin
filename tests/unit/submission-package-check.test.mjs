import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  REQUIRED_DEMO_TEXT_FILES,
  REQUIRED_SCREENSHOTS,
  REQUIRED_SUBMISSION_FILES,
  inspectSubmissionPackage,
} from "../../scripts/submission-package-check.mjs";
import {
  createValidMp4,
  createValidPng,
} from "../helpers/submission-media-fixtures.mjs";

const LIVE_EVIDENCE = {
  status: "PASS",
  evidenceMode: "LIVE_VERIFIED",
  evidenceHash: "live-evidence-hash",
  golden: { passed: 6, total: 6 },
  generated: { passed: 35, total: 35 },
  driftBefore: 16,
  driftAfter: 0,
  mutation: {
    killed: 44,
    total: 47,
    excludedEquivalent: 0,
    killRate: 44 / 47,
    executionMode: "OPA_CLI",
  },
};
const LIVE_URL = "https://policytwin.dev";
const REPOSITORY_URL = "https://github.com/openai/policytwin";
const VALID_VIDEO_PROBE = {
  valid: true,
  durationMilliseconds: 175_000,
  width: 1280,
  height: 720,
  audioTrackCount: 1,
  sampledFrameCount: 3,
  distinctFrameCount: 3,
  failures: [],
};
const VALID_CAPTIONS = [
  "1\n00:00:00,000 --> 00:00:20,000\nOpening.",
  "2\n00:00:20,000 --> 00:00:40,000\nPolicy interpretation.",
  "3\n00:00:40,000 --> 00:01:00,000\nAmbiguity decisions.",
  "4\n00:01:00,000 --> 00:01:20,000\nDeterministic Rego.",
  "5\n00:01:20,000 --> 00:01:40,000\nCase comparison.",
  "6\n00:01:40,000 --> 00:02:05,000\nCodex repair.",
  "7\n00:02:05,000 --> 00:02:30,000\nRegression proof.",
  "8\n00:02:30,000 --> 00:02:54,000\nChange impact.",
].join("\n\n");

function admittedOptions(overrides = {}) {
  return {
    probeVideo: async () => VALID_VIDEO_PROBE,
    probePublicLinks: async ({ liveUrl, repositoryUrl }) => ({
      valid: true,
      liveUrl,
      liveFinalUrl: liveUrl,
      liveStatusCode: 200,
      repositoryUrl,
      repositoryHead: "a".repeat(40),
      anonymousAccess: true,
      failures: [],
    }),
    validateEvidence: async () => ({
      manifest: {
        packageStatus: "PASS",
        evidenceMode: "LIVE_VERIFIED",
        evidenceHash: LIVE_EVIDENCE.evidenceHash,
      },
      verification: LIVE_EVIDENCE,
      files: new Map([
        [
          "deployment-run-summary.json",
          JSON.stringify({ status: "PASS", url: LIVE_URL }),
        ],
      ]),
    }),
    validateVerifyReceipt: () => [],
    ...overrides,
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createValidPackage() {
  const root = await mkdtemp(join(tmpdir(), "policytwin-final-package-"));
  for (const directory of [
    "artifacts/submission",
    "artifacts/demo",
    "artifacts/screenshots",
    "artifacts/evidence",
    "artifacts/security",
    "config",
  ]) {
    await mkdir(resolve(root, directory), { recursive: true });
  }
  for (const name of REQUIRED_SUBMISSION_FILES) {
    await writeFile(resolve(root, "artifacts/submission", name), "Final verified content.\n", "utf8");
  }
  for (const name of REQUIRED_DEMO_TEXT_FILES) {
    await writeFile(resolve(root, "artifacts/demo", name), "Final verified demo content.\n", "utf8");
  }
  await writeJson(resolve(root, "artifacts/submission/links.json"), {
    schemaVersion: "1",
    status: "SUBMITTED",
    liveUrl: LIVE_URL,
    repositoryUrl: REPOSITORY_URL,
    videoUrl: "https://youtube.com/watch?v=verified",
    submissionUrl: "https://devpost.com/software/policytwin",
    feedbackSessionId: "019c0def-1234-7abc-8def-0123456789ab",
  });
  await writeJson(resolve(root, "artifacts/submission/submission-state.json"), {
    schemaVersion: "1",
    status: "SUBMITTED",
    evidenceHash: "live-evidence-hash",
    evidenceStatus: "PASS",
    staticSecurityStatus: "PASS",
    cleanCopyStatus: "PASS",
    rulesStatus: "VERIFIED_OFFICIAL_SOURCES",
    confirmation: {
      type: "DEVPOST_SUBMISSION_CONFIRMATION",
      file: "submission-confirmation.json",
    },
    ownerAction: null,
  });
  await writeFile(
    resolve(root, "artifacts/submission/claim-audit.md"),
    "41 accepted policy cases\n16 buggy-fixture corpus drifts\n44/47 mutants killed\n",
    "utf8",
  );
  await writeFile(
    resolve(root, "artifacts/submission/rules-check.md"),
    "Status: VERIFIED_OFFICIAL_SOURCES\nChecked at: 2026-07-18T00:00:00.000Z\nhttps://openai.com/build-week/\nhttps://openai.devpost.com/\nhttps://openai.devpost.com/rules\n",
    "utf8",
  );
  await writeFile(
    resolve(root, "artifacts/demo/captions.srt"),
    `${VALID_CAPTIONS}\n`,
    "utf8",
  );
  await writeJson(resolve(root, "artifacts/demo/demo-data.json"), {
    schemaVersion: "1",
    status: "LIVE_VERIFIED",
    evidenceHash: LIVE_EVIDENCE.evidenceHash,
    caseCount: 41,
    driftBefore: 16,
    postRepairDrift: 0,
    mutation: LIVE_EVIDENCE.mutation,
  });
  const video = createValidMp4({
    durationMilliseconds: 175_000,
    videoSampleCount: 175,
    audioSampleCount: 175,
  });
  await writeFile(resolve(root, "artifacts/demo/policytwin-demo.mp4"), video);
  await writeJson(resolve(root, "artifacts/demo/video-publication-receipt.json"), {
    schemaVersion: "1",
    status: "VERIFIED_OWNER_REVIEWED",
    platform: "YOUTUBE",
    videoUrl: "https://youtube.com/watch?v=verified",
    localFile: "policytwin-demo.mp4",
    localSha256: createHash("sha256").update(video).digest("hex"),
    durationMilliseconds: 175_000,
    checkedAt: "2026-07-18T01:00:00.000Z",
    signedOutPlayback: true,
    audioReviewed: true,
  });
  for (const [index, name] of REQUIRED_SCREENSHOTS.entries()) {
    await writeFile(
      resolve(root, "artifacts/screenshots", name),
      createValidPng(640, 360, index + 1),
    );
  }
  const confirmationPng = createValidPng(1280, 720, 99);
  await writeFile(
    resolve(root, "artifacts/submission/submission-confirmation.png"),
    confirmationPng,
  );
  await writeJson(resolve(root, "artifacts/submission/submission-confirmation.json"), {
    schemaVersion: "1",
    status: "VERIFIED_OWNER_REVIEWED",
    submissionUrl: "https://devpost.com/software/policytwin",
    confirmationId: "policytwin-confirmed-001",
    capturedAt: "2026-07-18T01:00:00.000Z",
    screenshotFile: "submission-confirmation.png",
    screenshotSha256: createHash("sha256").update(confirmationPng).digest("hex"),
    ownerReviewed: true,
  });
  await writeJson(
    resolve(root, "artifacts/evidence/verification-summary.json"),
    LIVE_EVIDENCE,
  );
  await writeJson(resolve(root, "config/build-week-rules.v1.json"), {
    status: "VERIFIED_OFFICIAL_SOURCES",
    checkedAt: "2026-07-18T00:00:00.000Z",
    sources: [
      { url: "https://openai.com/build-week/", result: "VERIFIED" },
      { url: "https://openai.devpost.com/", result: "VERIFIED" },
      { url: "https://openai.devpost.com/rules", result: "VERIFIED" },
    ],
  });
  for (const name of ["security-report.json", "clean-checkout-report.json", "container-report.json"]) {
    await writeJson(resolve(root, "artifacts/security", name), { status: "PASS" });
  }
  await writeJson(resolve(root, "artifacts/security/offline-verify-report.json"), {});
  await writeFile(resolve(root, "README.md"), "# PolicyTwin\n", "utf8");
  await writeFile(resolve(root, "LICENSE"), "Owner-selected test license.\n", "utf8");
  return root;
}

test("final package surface admits independently validated evidence and rejects staging/media/claim tampering", async () => {
  const root = await createValidPackage();
  try {
    const now = Date.parse("2026-07-18T12:00:00.000Z");
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.some((failure) =>
        failure.startsWith("Authoritative evidence package validation failed:"),
      ),
      false,
    );
    assert.deepEqual((await inspectSubmissionPackage(root, now, admittedOptions())).failures, []);

    assert.equal(
      (
        await inspectSubmissionPackage(
          root,
          now,
          admittedOptions({
            probeVideo: async () => ({ ...VALID_VIDEO_PROBE, distinctFrameCount: 1 }),
          }),
        )
      ).failures.includes(
        "Final demo must expose decoded audio and visually distinct frames across its timeline.",
      ),
      true,
    );

    const optionalScreenshotPath = resolve(
      root,
      "artifacts/screenshots/04-integration-drift.png",
    );
    await writeFile(
      optionalScreenshotPath,
      await readFile(resolve(root, "artifacts/submission/submission-confirmation.png")),
    );
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions())
      ).failures.includes(
        "Submission confirmation PNG must be a distinct reviewed capture at least 640x360.",
      ),
      true,
    );
    await rm(optionalScreenshotPath);

    const confirmationManifestPath = resolve(
      root,
      "artifacts/submission/submission-confirmation.json",
    );
    const confirmationManifest = JSON.parse(
      await readFile(confirmationManifestPath, "utf8"),
    );
    confirmationManifest.screenshotSha256 = "0".repeat(64);
    await writeJson(confirmationManifestPath, confirmationManifest);
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.includes(
        "Submission confirmation manifest is missing, stale, unreviewed, or unbound.",
      ),
      true,
    );
    confirmationManifest.screenshotSha256 = createHash("sha256")
      .update(await readFile(resolve(root, "artifacts/submission/submission-confirmation.png")))
      .digest("hex");
    await writeJson(confirmationManifestPath, confirmationManifest);

    assert.equal(
      (
        await inspectSubmissionPackage(root, now, {
          probeVideo: async () => VALID_VIDEO_PROBE,
          probePublicLinks: admittedOptions().probePublicLinks,
          validateVerifyReceipt: () => [],
        })
      ).failures.some((failure) =>
        failure.startsWith("Authoritative evidence package validation failed:"),
      ),
      true,
    );

    const statePath = resolve(root, "artifacts/submission/submission-state.json");
    const linksPath = resolve(root, "artifacts/submission/links.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const links = JSON.parse(await readFile(linksPath, "utf8"));
    links.liveUrl = "https://wrong-deployment.dev";
    await writeJson(linksPath, links);
    assert.equal(
      (await inspectSubmissionPackage(root, now, admittedOptions())).failures.includes(
        "Submission live URL does not match validated deployment evidence.",
      ),
      true,
    );
    links.liveUrl = LIVE_URL;
    await writeJson(linksPath, links);
    state.status = "READY_FOR_OWNER_ACTION";
    state.confirmation = null;
    state.ownerAction = { id: "SUBMIT_ON_DEVPOST", remainingActions: 1 };
    links.status = "READY_FOR_OWNER_ACTION";
    links.submissionUrl = null;
    await writeJson(statePath, state);
    await writeJson(linksPath, links);
    await rm(resolve(root, "artifacts/submission/submission-confirmation.png"));
    await rm(resolve(root, "artifacts/submission/submission-confirmation.json"));
    assert.deepEqual(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures,
      [],
    );

    await writeFile(resolve(root, "artifacts/submission/unexpected-secret.txt"), "secret", "utf8");
    assert.equal(
      (await inspectSubmissionPackage(root, now, admittedOptions({ probeVideo: async () => VALID_VIDEO_PROBE }))).failures.includes(
        "Unexpected submission staging entry: unexpected-secret.txt",
      ),
      true,
    );
    await rm(resolve(root, "artifacts/submission/unexpected-secret.txt"));

    await writeFile(
      resolve(root, "artifacts/screenshots/private-notes.txt"),
      "private",
      "utf8",
    );
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.includes("Unexpected screenshot staging entry: private-notes.txt"),
      true,
    );
    await rm(resolve(root, "artifacts/screenshots/private-notes.txt"));

    const demoDataPath = resolve(root, "artifacts/demo/demo-data.json");
    const demoData = JSON.parse(await readFile(demoDataPath, "utf8"));
    demoData.postRepairDrift = 999;
    await writeJson(demoDataPath, demoData);
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.includes("Final demo data does not match the live verified evidence summary."),
      true,
    );
    demoData.postRepairDrift = 0;
    await writeJson(demoDataPath, demoData);

    links.status = "SUBMITTED";
    await writeJson(linksPath, links);
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.includes("Submission links and state statuses disagree."),
      true,
    );
    links.status = "READY_FOR_OWNER_ACTION";
    await writeJson(linksPath, links);

    await writeFile(resolve(root, "artifacts/demo/policytwin-demo.mp4"), "not an mp4", "utf8");
    assert.equal(
      (await inspectSubmissionPackage(root, now, admittedOptions({ probeVideo: async () => VALID_VIDEO_PROBE }))).failures.some((failure) =>
        failure.startsWith("Invalid final demo MP4:"),
      ),
      true,
    );
    const validVideo = createValidMp4({
      durationMilliseconds: 175_000,
      videoSampleCount: 175,
      audioSampleCount: 175,
    });
    await writeFile(resolve(root, "artifacts/demo/policytwin-demo.mp4"), validVideo);

    const firstScreenshot = resolve(root, "artifacts/screenshots/01-policy-studio.png");
    const secondScreenshot = resolve(root, "artifacts/screenshots/02-decision-queue.png");
    await writeFile(secondScreenshot, await readFile(firstScreenshot));
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions())
      ).failures.includes("Required submission screenshots must be distinct reviewed captures."),
      true,
    );
    await writeFile(secondScreenshot, createValidPng(640, 360, 2));

    const shortVideo = createValidMp4({ durationMilliseconds: 119_999 });
    await writeFile(resolve(root, "artifacts/demo/policytwin-demo.mp4"), shortVideo);
    assert.equal(
      (await inspectSubmissionPackage(root, now, admittedOptions())).failures.includes(
        "Final demo video is too short to be the required substantive walkthrough.",
      ),
      true,
    );
    await writeFile(resolve(root, "artifacts/demo/policytwin-demo.mp4"), validVideo);

    const captionsPath = resolve(root, "artifacts/demo/captions.srt");
    await writeFile(
      captionsPath,
      "1\n00:00:00,000 --> 00:01:00,000\nToo short for the video.\n",
      "utf8",
    );
    assert.equal(
      (await inspectSubmissionPackage(root, now, admittedOptions())).failures.includes(
        "Final demo captions are not synchronized with the local video duration.",
      ),
      true,
    );
    await writeFile(
      captionsPath,
      "1\n00:02:53,000 --> 00:02:54,000\nA single tail cue.\n",
      "utf8",
    );
    assert.equal(
      (await inspectSubmissionPackage(root, now, admittedOptions())).failures.includes(
        "Final demo captions do not provide substantive timeline coverage.",
      ),
      true,
    );
    await writeFile(
      captionsPath,
      `${VALID_CAPTIONS}\n`,
      "utf8",
    );

    await writeFile(
      resolve(root, "artifacts/submission/long-description.md"),
      "The product verifies 50 accepted policy cases.\n",
      "utf8",
    );
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.some((failure) =>
        failure.startsWith("Case-count claim conflicts with evidence"),
      ),
      true,
    );
    await writeFile(
      resolve(root, "artifacts/submission/long-description.md"),
      "PolicyTwin can create a draft policy version without claiming release readiness.\n",
      "utf8",
    );
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.some((failure) => failure.startsWith("Draft marker remains")),
      false,
    );
    await writeFile(
      resolve(root, "README.md"),
      "# PolicyTwin\n\nThe corpus contains 50 cases.\n",
      "utf8",
    );
    assert.equal(
      (
        await inspectSubmissionPackage(root, now, admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.some((failure) =>
        failure.startsWith("Case-count claim conflicts with evidence in README.md"),
      ),
      true,
    );
    assert.equal(
      (
        await inspectSubmissionPackage(root, Date.parse("2026-07-21T00:00:00.001Z"), admittedOptions({
          probeVideo: async () => VALID_VIDEO_PROBE,
        }))
      ).failures.includes(
        "Official rules have not been verified.",
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
