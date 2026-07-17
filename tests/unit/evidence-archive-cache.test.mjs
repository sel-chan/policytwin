import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  MAX_EVIDENCE_ARCHIVE_CACHE_BYTES,
  createEvidenceArchiveCache,
  evidenceArchiveCacheKey,
} from "../../dist/evidence/archive-cache.js";
import { REQUIRED_EVIDENCE_FILES } from "../../dist/evidence/validate.js";

function evidenceFiles(value = "baseline") {
  return new Map(
    REQUIRED_EVIDENCE_FILES.map((name) => [name, `${name}:${value}\n`]),
  );
}

function archive(value, liveAttestationExpiresAtMs = null) {
  const bytes = Buffer.from(`archive:${value}`, "utf8");
  return {
    bytes,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    evidenceHash: "b".repeat(64),
    evidenceMode:
      liveAttestationExpiresAtMs === null ? "PARTIAL_OFFLINE" : "LIVE_VERIFIED",
    packageStatus: liveAttestationExpiresAtMs === null ? "FAIL" : "PASS",
    policyVersion: 4,
    fileName: `policytwin-${value}.tar`,
    entryNames: [...REQUIRED_EVIDENCE_FILES],
    liveAttestationExpiresAtMs,
  };
}

test("evidence archive cache keys bind every file byte and validation-policy input", () => {
  const files = evidenceFiles();
  const reversed = new Map([...files.entries()].reverse());
  const options = {
    trustedLiveAttestationKeys: { z: "key-z", a: "key-a" },
    trustedOpaExecutables: [
      { version: "2", sha256: "2".repeat(64) },
      { version: "1", sha256: "1".repeat(64) },
    ],
    maxFutureSkewMs: 1_000,
    maxAttestationAgeMs: 2_000,
  };
  const reorderedOptions = {
    ...options,
    trustedLiveAttestationKeys: { a: "key-a", z: "key-z" },
    trustedOpaExecutables: [...options.trustedOpaExecutables].reverse(),
  };
  assert.equal(
    evidenceArchiveCacheKey(files, options),
    evidenceArchiveCacheKey(reversed, reorderedOptions),
  );

  const changed = new Map(files);
  changed.set(REQUIRED_EVIDENCE_FILES[0], `${changed.get(REQUIRED_EVIDENCE_FILES[0])}changed`);
  assert.notEqual(
    evidenceArchiveCacheKey(files, options),
    evidenceArchiveCacheKey(changed, options),
  );
  assert.notEqual(
    evidenceArchiveCacheKey(files, options),
    evidenceArchiveCacheKey(files, { ...options, maxAttestationAgeMs: 2_001 }),
  );

  const missing = new Map(files);
  missing.delete(REQUIRED_EVIDENCE_FILES[0]);
  assert.throws(() => evidenceArchiveCacheKey(missing, options), /exact required file set/u);
  const extra = new Map(files);
  extra.set("extra.json", "{}\n");
  assert.throws(() => evidenceArchiveCacheKey(extra, options), /exact required file set/u);
});

test("same-key requests coalesce, reuse one completed entry, and receive defensive copies", async () => {
  let now = 1_000;
  let builds = 0;
  const cache = createEvidenceArchiveCache({ ttlMs: 100, now: () => now });
  const builder = async () => {
    builds += 1;
    await Promise.resolve();
    return archive(`build-${builds}`);
  };
  const [first, second] = await Promise.all([
    cache.getOrCreate("1".repeat(64), builder),
    cache.getOrCreate("1".repeat(64), builder),
  ]);
  assert.equal(builds, 1);
  assert.deepEqual(first.bytes, second.bytes);
  assert.notEqual(first.bytes, second.bytes);
  first.bytes.fill(0);

  now = 1_050;
  const cached = await cache.getOrCreate("1".repeat(64), builder);
  assert.equal(builds, 1);
  assert.equal(cached.bytes.toString("utf8"), "archive:build-1");
});

test("TTL, content-key changes, and the one-entry bound force a rebuild", async () => {
  let now = 10_000;
  let builds = 0;
  const cache = createEvidenceArchiveCache({ ttlMs: 100, now: () => now });
  const builder = async () => archive(`build-${++builds}`);

  await cache.getOrCreate("2".repeat(64), builder);
  now = 10_101;
  await cache.getOrCreate("2".repeat(64), builder);
  assert.equal(builds, 2);

  await cache.getOrCreate("3".repeat(64), builder);
  assert.equal(builds, 3);
  await cache.getOrCreate("2".repeat(64), builder);
  assert.equal(builds, 4);
});

test("different-key requests keep at most one archive build active", async () => {
  let builds = 0;
  let activeBuilds = 0;
  let maximumActiveBuilds = 0;
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const cache = createEvidenceArchiveCache({ ttlMs: 100, now: () => 15_000 });
  const build = async (value, gate) => {
    builds += 1;
    activeBuilds += 1;
    maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
    if (gate) {
      markFirstStarted();
      await gate;
    }
    activeBuilds -= 1;
    return archive(value);
  };

  const first = cache.getOrCreate("7".repeat(64), () => build("first", firstGate));
  await firstStarted;
  const second = cache.getOrCreate("8".repeat(64), () => build("second"));
  await Promise.resolve();
  assert.equal(builds, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(builds, 2);
  assert.equal(maximumActiveBuilds, 1);
});

test("live-attestation expiry is never extended by the process cache", async () => {
  let now = 20_000;
  let builds = 0;
  const cache = createEvidenceArchiveCache({ ttlMs: 1_000, now: () => now });
  const builder = async () => {
    builds += 1;
    return archive(`live-${builds}`, builds === 1 ? 20_050 : 21_000);
  };

  await cache.getOrCreate("4".repeat(64), builder);
  now = 20_050;
  await cache.getOrCreate("4".repeat(64), builder);
  assert.equal(builds, 1);
  now = 20_051;
  await cache.getOrCreate("4".repeat(64), builder);
  assert.equal(builds, 2);
});

test("builder failures and expired build results are never cached", async () => {
  let now = 30_000;
  let builds = 0;
  const cache = createEvidenceArchiveCache({ ttlMs: 100, now: () => now });
  const failingBuilder = async () => {
    builds += 1;
    throw new Error("expected build failure");
  };
  const results = await Promise.allSettled([
    cache.getOrCreate("5".repeat(64), failingBuilder),
    cache.getOrCreate("5".repeat(64), failingBuilder),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(builds, 1);

  await assert.rejects(
    cache.getOrCreate("5".repeat(64), async () => archive("stale", now - 1)),
    /expired before it could be served/u,
  );
  const recovered = await cache.getOrCreate(
    "5".repeat(64),
    async () => archive("recovered", now + 100),
  );
  assert.equal(recovered.bytes.toString("utf8"), "archive:recovered");
});

test("oversized archive values cannot enter the completed cache", async () => {
  const cache = createEvidenceArchiveCache({ ttlMs: 100, now: () => 40_000 });
  await assert.rejects(
    cache.getOrCreate("6".repeat(64), async () => ({
      ...archive("oversized"),
      bytes: Buffer.alloc(MAX_EVIDENCE_ARCHIVE_CACHE_BYTES + 1),
    })),
    /cache byte bound/u,
  );
  await assert.rejects(
    cache.getOrCreate("6".repeat(64), async () => ({
      ...archive("invalid-mode"),
      evidenceMode: "UNVERIFIED",
    })),
    /cannot enter the completed cache/u,
  );
  await assert.rejects(
    cache.getOrCreate("6".repeat(64), async () => ({
      ...archive("invalid-hash"),
      archiveSha256: "0".repeat(64),
    })),
    /cannot enter the completed cache/u,
  );
  const recovered = await cache.getOrCreate(
    "6".repeat(64),
    async () => archive("bounded"),
  );
  assert.equal(recovered.bytes.toString("utf8"), "archive:bounded");
});
