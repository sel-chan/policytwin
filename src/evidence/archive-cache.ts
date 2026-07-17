import { Buffer } from "node:buffer";
import { createHash, type Hash } from "node:crypto";
import {
  MAX_EVIDENCE_DOWNLOAD_TOTAL_BYTES,
  type EvidenceArchive,
} from "./archive.js";
import {
  REQUIRED_EVIDENCE_FILES,
  type EvidenceValidationOptions,
} from "./validate.js";

export const EVIDENCE_ARCHIVE_CACHE_TTL_MS = 15_000;
export const MAX_EVIDENCE_ARCHIVE_CACHE_BYTES =
  MAX_EVIDENCE_DOWNLOAD_TOTAL_BYTES + REQUIRED_EVIDENCE_FILES.length * 1_024 + 1_024;

const SHA256 = /^[0-9a-f]{64}$/u;
const CACHE_KEY_DOMAIN = "policytwin-evidence-archive-cache-v1";
const REQUIRED_NAMES: ReadonlySet<string> = new Set<string>(REQUIRED_EVIDENCE_FILES);

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function updateField(hash: Hash, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function validationPolicySnapshot(options: EvidenceValidationOptions): string {
  const now = options.now;
  if (now !== undefined && (!(now instanceof Date) || !Number.isFinite(now.getTime()))) {
    throw new Error("Evidence archive cache received an invalid validation time.");
  }
  for (const [name, value, minimum] of [
    ["future skew", options.maxFutureSkewMs, 0],
    ["attestation age", options.maxAttestationAgeMs, 1],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
      throw new Error(`Evidence archive cache received an invalid ${name} policy.`);
    }
  }

  const trustedKeys = options.trustedLiveAttestationKeys;
  if (
    trustedKeys !== undefined &&
    (typeof trustedKeys !== "object" || trustedKeys === null || Array.isArray(trustedKeys))
  ) {
    throw new Error("Evidence archive cache received invalid attestation keys.");
  }
  const keyEntries = Object.entries(trustedKeys ?? {})
    .map(([keyId, key]) => {
      if (keyId.length === 0 || typeof key !== "string" || key.length === 0) {
        throw new Error("Evidence archive cache received an invalid attestation key entry.");
      }
      return [keyId, key] as const;
    })
    .sort(([left], [right]) => compareUtf8(left, right));

  const trustedOpaExecutables = options.trustedOpaExecutables;
  if (trustedOpaExecutables !== undefined && !Array.isArray(trustedOpaExecutables)) {
    throw new Error("Evidence archive cache received an invalid OPA trust policy.");
  }
  const opaEntries = [...(trustedOpaExecutables ?? [])]
    .map((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof entry.version !== "string" ||
        entry.version.length === 0 ||
        typeof entry.sha256 !== "string" ||
        !SHA256.test(entry.sha256)
      ) {
        throw new Error("Evidence archive cache received an invalid OPA trust entry.");
      }
      return { version: entry.version, sha256: entry.sha256 };
    })
    .sort((left, right) => {
      const version = compareUtf8(left.version, right.version);
      return version === 0 ? compareUtf8(left.sha256, right.sha256) : version;
    });

  return JSON.stringify({
    trustedLiveAttestationKeys: keyEntries,
    trustedOpaExecutables: opaEntries,
    now: now?.toISOString() ?? null,
    maxFutureSkewMs: options.maxFutureSkewMs ?? null,
    maxAttestationAgeMs: options.maxAttestationAgeMs ?? null,
  });
}

export function evidenceArchiveCacheKey(
  files: ReadonlyMap<string, string>,
  options: EvidenceValidationOptions = {},
): string {
  if (files.size !== REQUIRED_EVIDENCE_FILES.length) {
    throw new Error("Evidence archive cache requires the exact required file set.");
  }
  for (const name of files.keys()) {
    if (!REQUIRED_NAMES.has(name)) {
      throw new Error("Evidence archive cache requires the exact required file set.");
    }
  }
  const hash = createHash("sha256");
  updateField(hash, CACHE_KEY_DOMAIN);
  updateField(hash, validationPolicySnapshot(options));
  for (const name of [...REQUIRED_EVIDENCE_FILES].sort(compareUtf8)) {
    const content = files.get(name);
    if (typeof content !== "string") {
      throw new Error("Evidence archive cache requires the exact required file set.");
    }
    updateField(hash, name);
    updateField(hash, content);
  }
  return hash.digest("hex");
}

function readClock(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Evidence archive cache clock is invalid.");
  }
  return value;
}

function copyArchive(value: EvidenceArchive): EvidenceArchive {
  if (!Buffer.isBuffer(value.bytes)) {
    throw new Error("Evidence archive cannot enter the completed cache.");
  }
  if (value.bytes.length > MAX_EVIDENCE_ARCHIVE_CACHE_BYTES) {
    throw new Error("Evidence archive exceeds the cache byte bound.");
  }
  if (
    value.bytes.length < 1 ||
    !SHA256.test(value.archiveSha256) ||
    createHash("sha256").update(value.bytes).digest("hex") !== value.archiveSha256 ||
    !SHA256.test(value.evidenceHash) ||
    !["PARTIAL_OFFLINE", "LIVE_VERIFIED"].includes(value.evidenceMode) ||
    !["PASS", "FAIL"].includes(value.packageStatus) ||
    !Number.isSafeInteger(value.policyVersion) ||
    value.policyVersion < 1 ||
    typeof value.fileName !== "string" ||
    !/^policytwin-[A-Za-z0-9._-]+\.tar$/u.test(value.fileName) ||
    !Array.isArray(value.entryNames) ||
    value.entryNames.length !== REQUIRED_EVIDENCE_FILES.length ||
    new Set(value.entryNames).size !== REQUIRED_EVIDENCE_FILES.length ||
    value.entryNames.some((name) => !REQUIRED_NAMES.has(name)) ||
    (value.evidenceMode === "PARTIAL_OFFLINE" &&
      value.liveAttestationExpiresAtMs !== null) ||
    (value.evidenceMode === "LIVE_VERIFIED" &&
      (!Number.isSafeInteger(value.liveAttestationExpiresAtMs) ||
        (value.liveAttestationExpiresAtMs as number) < 0))
  ) {
    throw new Error("Evidence archive cannot enter the completed cache.");
  }
  return {
    ...value,
    bytes: Buffer.from(value.bytes),
    entryNames: Object.freeze([...value.entryNames]),
  };
}

interface CacheEntry {
  key: string;
  archive: EvidenceArchive;
  ttlExpiresAtMs: number;
}

interface ActiveBuild {
  key: string;
  promise: Promise<CacheEntry>;
}

export interface EvidenceArchiveCache {
  getOrCreate(
    key: string,
    builder: () => Promise<EvidenceArchive>,
  ): Promise<EvidenceArchive>;
}

export function createEvidenceArchiveCache(
  options: {
    ttlMs?: number;
    now?: () => number;
  } = {},
): EvidenceArchiveCache {
  const ttlMs = options.ttlMs ?? EVIDENCE_ARCHIVE_CACHE_TTL_MS;
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > EVIDENCE_ARCHIVE_CACHE_TTL_MS
  ) {
    throw new Error("Evidence archive cache TTL is outside its fixed bound.");
  }
  const now = options.now ?? Date.now;
  let completed: CacheEntry | null = null;
  let active: ActiveBuild | null = null;

  const isUsable = (entry: CacheEntry, currentTime: number) =>
    entry.ttlExpiresAtMs > currentTime &&
    (entry.archive.liveAttestationExpiresAtMs === null ||
      entry.archive.liveAttestationExpiresAtMs >= currentTime);

  const getOrCreate = async (
    key: string,
    builder: () => Promise<EvidenceArchive>,
  ): Promise<EvidenceArchive> => {
    if (!SHA256.test(key)) {
      throw new Error("Evidence archive cache key must be one SHA-256.");
    }
    const currentTime = readClock(now);
    if (completed !== null && completed.key === key && isUsable(completed, currentTime)) {
      return copyArchive(completed.archive);
    }
    if (active !== null) {
      const observed = active;
      try {
        const entry = await observed.promise;
        if (observed.key === key && isUsable(entry, readClock(now))) {
          return copyArchive(entry.archive);
        }
      } catch (error) {
        if (observed.key === key) throw error;
      }
      return getOrCreate(key, builder);
    }

    const promise = Promise.resolve()
      .then(builder)
      .then((value): CacheEntry => {
        const archive = copyArchive(value);
        const builtAtMs = readClock(now);
        if (
          archive.liveAttestationExpiresAtMs !== null &&
          archive.liveAttestationExpiresAtMs < builtAtMs
        ) {
          throw new Error("Live evidence expired before it could be served.");
        }
        const ttlExpiresAtMs = builtAtMs + ttlMs;
        if (!Number.isSafeInteger(ttlExpiresAtMs)) {
          throw new Error("Evidence archive cache TTL overflowed the safe time range.");
        }
        const entry = { key, archive, ttlExpiresAtMs };
        completed = entry;
        return entry;
      });
    const run = { key, promise };
    active = run;
    try {
      const entry = await promise;
      return copyArchive(entry.archive);
    } finally {
      if (active === run) active = null;
    }
  };

  return Object.freeze({ getOrCreate });
}
