import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  captionEndMilliseconds,
  inspectCaptionTimeline,
  inspectSubmissionDraft,
} from "../../scripts/submission-draft-check.mjs";

async function copyDraftFixture() {
  const root = await mkdtemp(join(tmpdir(), "policytwin-submission-draft-"));
  for (const directory of [
    "artifacts/submission-draft",
    "artifacts/demo-draft",
    "artifacts/evidence",
    "artifacts/security",
    "config",
  ]) {
    await cp(resolve(directory), resolve(root, directory), { recursive: true });
  }
  return root;
}

test("isolated drafts remain fail-closed, current, and shorter than three minutes", async () => {
  const root = await copyDraftFixture();
  try {
    assert.deepEqual(inspectSubmissionDraft(root), []);

    const linksPath = resolve(root, "artifacts", "submission-draft", "links.json");
    const links = JSON.parse(await readFile(linksPath, "utf8"));
    links.feedbackSessionId = "fabricated-session";
    await writeFile(linksPath, `${JSON.stringify(links, null, 2)}\n`, "utf8");
    assert.equal(
      inspectSubmissionDraft(root).includes(
        "Draft link field must be explicitly null: feedbackSessionId",
      ),
      true,
    );

    links.feedbackSessionId = null;
    await writeFile(linksPath, `${JSON.stringify(links, null, 2)}\n`, "utf8");
    const statePath = resolve(root, "artifacts", "submission-draft", "submission-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.rulesStatus = "STALE";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    assert.equal(
      inspectSubmissionDraft(root).includes(
        "Draft submission state is stale or overclaims readiness.",
      ),
      true,
    );
    state.rulesStatus = "VERIFIED_OFFICIAL_SOURCES";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const reportPath = resolve(
      root,
      "artifacts",
      "submission-draft",
      "submission-check-report.json",
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.checkedDemoDraftFiles = 3;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    assert.equal(
      inspectSubmissionDraft(root).includes(
        "Draft checker report must remain an explicit NOT_RUN placeholder.",
      ),
      true,
    );
    report.checkedDemoDraftFiles = 4;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    const captionsPath = resolve(root, "artifacts", "demo-draft", "captions.srt");
    const captions = await readFile(captionsPath, "utf8");
    await writeFile(
      captionsPath,
      captions.replace("00:02:55,000", "00:03:00,000"),
      "utf8",
    );
    assert.equal(
      inspectSubmissionDraft(root).includes(
        "Demo draft captions must end at 02:55, strictly below three minutes.",
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caption duration validation rejects three-minute, malformed, and out-of-order cues", () => {
  assert.equal(
    captionEndMilliseconds("1\n00:00:00,000 --> 00:02:59,999\nValid\n"),
    179_999,
  );
  assert.deepEqual(
    inspectCaptionTimeline(
      "1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond\n",
    ),
    {
      cueCount: 2,
      firstStartMilliseconds: 0,
      endMilliseconds: 4_000,
      coveredMilliseconds: 3_000,
      maximumGapMilliseconds: 1_000,
    },
  );
  assert.equal(
    captionEndMilliseconds("1\n00:00:00,000 --> 00:03:00,000\nToo long\n"),
    180_000,
  );
  assert.equal(
    captionEndMilliseconds(
      "1\n00:00:00,000 --> 00:03:10,000\nToo long\n\n2\n00:02:40,000 --> 00:02:55,000\nBackwards\n",
    ),
    null,
  );
  assert.equal(
    captionEndMilliseconds("1\n00:00:61,000 --> 00:00:62,000\nMalformed\n"),
    null,
  );
  assert.equal(captionEndMilliseconds("1\n00:00:00,000 --> 00:00:01,000\n"), null);
  assert.equal(
    captionEndMilliseconds("2\n00:00:00,000 --> 00:00:01,000\nSkipped index\n"),
    null,
  );
  assert.equal(
    captionEndMilliseconds(
      "1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:00:01,000 --> 00:00:03,000\nOverlap\n",
    ),
    null,
  );
  assert.equal(
    captionEndMilliseconds("1\nnot a timestamp\nCaption body\n"),
    null,
  );
});
