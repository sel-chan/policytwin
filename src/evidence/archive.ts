import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertSafeRelativePath } from "../codex/safety.js";
import {
  DEFAULT_EVIDENCE_MAX_ATTESTATION_AGE_MS,
  REQUIRED_EVIDENCE_FILES,
  validateEvidencePackage,
  type EvidenceValidationOptions,
  type TextHasher,
} from "./validate.js";

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
export const MAX_EVIDENCE_DOWNLOAD_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_EVIDENCE_DOWNLOAD_TOTAL_BYTES = 16 * 1024 * 1024;
const REQUIRED_NAMES = new Set<string>(REQUIRED_EVIDENCE_FILES);
const PRIVATE_KEY_BLOCK = new RegExp(
  ["-----BEGIN ", "[A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?", "-----"].join(""),
  "u",
);
const BEARER_CREDENTIAL = /\bBearer\s+([A-Za-z0-9._~+/=-]+)/giu;
const OPENAI_CREDENTIAL = /\bsk-[A-Za-z0-9_-]{16,}/u;
const CREDENTIAL_URL =
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/u;
const WINDOWS_ABSOLUTE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n\s]+/u;
const UNC_PATH = /(?<!:)(?:\\\\|\/\/)[^\\/\r\n\s]+[\\/][^\\/\r\n\s]+/u;
const FILE_URI = /\bfile:\/\/[^\r\n\s]+/iu;
const POSIX_PERSONAL_PATH = /\/(?:home|users)\/[^/\r\n\s]+|\/root(?:\/[^\r\n\s]*)?/iu;
const SAFE_ASSIGNMENT_VALUES = new Set([
  "[redacted]",
  "[redacted_home]",
  "null",
  "undefined",
  "unset",
]);

export interface EvidenceArchive {
  bytes: Buffer;
  archiveSha256: string;
  evidenceHash: string;
  evidenceMode: "PARTIAL_OFFLINE" | "LIVE_VERIFIED";
  packageStatus: "PASS" | "FAIL";
  policyVersion: number;
  fileName: string;
  entryNames: readonly string[];
  liveAttestationExpiresAtMs: number | null;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertClosedEvidenceFiles(files: ReadonlyMap<string, string>): void {
  if (files.size !== REQUIRED_EVIDENCE_FILES.length) {
    throw new Error("Evidence archive input must contain exactly the required files.");
  }
  for (const name of files.keys()) {
    const normalized = assertSafeRelativePath(name, "evidence archive entry");
    if (
      normalized !== name ||
      normalized.includes("/") ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/u.test(normalized) ||
      !REQUIRED_NAMES.has(normalized)
    ) {
      throw new Error(`Evidence archive entry is not allowed: ${name}`);
    }
  }
}

function isCredentialKeyCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    value === "_" ||
    value === "-"
  );
}

function isAssignmentWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function isSensitiveCredentialKey(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll("_", "").replaceAll("-", "");
  return [
    "apikey",
    "accesstoken",
    "authtoken",
    "clientsecret",
    "connectionstring",
    "connectionuri",
    "databaseuri",
    "databaseurl",
    "mongodburi",
    "mongodburl",
    "mongouri",
    "password",
    "postgresqluri",
    "postgresqlurl",
    "postgresuri",
    "postgresurl",
    "privatekey",
    "redisuri",
    "redisurl",
    "secret",
    "secretaccesskey",
    "secretkey",
    "token",
  ].some((suffix) => normalized.endsWith(suffix));
}

function hasSensitiveAssignment(content: string): boolean {
  for (let separator = 0; separator < content.length; separator += 1) {
    if (content[separator] !== "=" && content[separator] !== ":") {
      continue;
    }
    let keyEnd = separator;
    while (keyEnd > 0 && isAssignmentWhitespace(content[keyEnd - 1])) {
      keyEnd -= 1;
    }
    if (keyEnd > 0 && (content[keyEnd - 1] === '"' || content[keyEnd - 1] === "'")) {
      keyEnd -= 1;
    }
    let keyStart = keyEnd;
    while (keyStart > 0 && isCredentialKeyCharacter(content[keyStart - 1] as string)) {
      keyStart -= 1;
    }
    if (keyStart === keyEnd || !isSensitiveCredentialKey(content.slice(keyStart, keyEnd))) {
      continue;
    }

    let valueStart = separator + 1;
    while (
      valueStart < content.length &&
      isAssignmentWhitespace(content[valueStart])
    ) {
      valueStart += 1;
    }
    if (content[valueStart] === '"' || content[valueStart] === "'") {
      valueStart += 1;
    }
    let valueEnd = valueStart;
    while (
      valueEnd < content.length &&
      valueEnd - valueStart < 4096 &&
      !/["'\r\n\s,;}]/u.test(content[valueEnd] as string)
    ) {
      valueEnd += 1;
    }
    const value = content.slice(valueStart, valueEnd);
    if (value.length > 0 && !SAFE_ASSIGNMENT_VALUES.has(value.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function hasBearerCredential(content: string): boolean {
  for (const match of content.matchAll(BEARER_CREDENTIAL)) {
    const value = match[1] ?? "";
    if (value.length > 0 && !SAFE_ASSIGNMENT_VALUES.has(value.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function assertNoSensitiveContent(name: string, content: string): void {
  if (PRIVATE_KEY_BLOCK.test(content)) {
    throw new Error(`Evidence archive rejected private-key material in ${name}.`);
  }
  if (hasSensitiveAssignment(content)) {
    throw new Error(`Evidence archive rejected a credential-shaped assignment in ${name}.`);
  }
  if (
    hasBearerCredential(content) ||
    OPENAI_CREDENTIAL.test(content) ||
    CREDENTIAL_URL.test(content)
  ) {
    throw new Error(`Evidence archive rejected credential-shaped content in ${name}.`);
  }
  if (
    WINDOWS_ABSOLUTE_PATH.test(content) ||
    UNC_PATH.test(content) ||
    FILE_URI.test(content) ||
    POSIX_PERSONAL_PATH.test(content)
  ) {
    throw new Error(`Evidence archive rejected a personal or absolute filesystem path in ${name}.`);
  }
}

interface PreparedEvidenceEntry {
  name: string;
  bytes: Buffer;
}

function prepareEvidenceEntries(
  files: ReadonlyMap<string, string>,
): PreparedEvidenceEntry[] {
  assertClosedEvidenceFiles(files);
  const names = [...REQUIRED_EVIDENCE_FILES].sort(compareUtf8);
  const entries: PreparedEvidenceEntry[] = [];
  let totalInputBytes = 0;
  for (const name of names) {
    const content = files.get(name);
    if (content === undefined) {
      throw new Error(`Evidence archive input is missing ${name}.`);
    }
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > MAX_EVIDENCE_DOWNLOAD_FILE_BYTES) {
      throw new Error(`Evidence archive entry exceeds the byte limit: ${name}`);
    }
    totalInputBytes += bytes.length;
    if (totalInputBytes > MAX_EVIDENCE_DOWNLOAD_TOTAL_BYTES) {
      throw new Error("Evidence archive input exceeds the aggregate byte limit.");
    }
    assertNoSensitiveContent(name, content);
    entries.push({ name, bytes });
  }
  return entries;
}

export function validateEvidenceDownloadPackage(
  files: ReadonlyMap<string, string>,
  hashText: TextHasher,
  options: EvidenceValidationOptions = {},
) {
  prepareEvidenceEntries(files);
  return validateEvidencePackage(files, hashText, options);
}

function writeAscii(header: Buffer, offset: number, length: number, value: string): void {
  const encoded = Buffer.from(value, "ascii");
  if (encoded.length > length) {
    throw new Error("USTAR header value exceeds its fixed field.");
  }
  encoded.copy(header, offset);
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("USTAR numeric field is invalid.");
  }
  const octal = value.toString(8);
  if (octal.length > length - 1) {
    throw new Error("USTAR numeric field exceeds its fixed field.");
  }
  writeAscii(header, offset, length, `${octal.padStart(length - 1, "0")}\0`);
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  writeAscii(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeAscii(header, 156, 1, "0");
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8);
  if (checksumText.length > 6) {
    throw new Error("USTAR checksum exceeds its fixed field.");
  }
  writeAscii(header, 148, 8, `${checksumText.padStart(6, "0")}\0 `);
  return header;
}

function verificationPolicyVersion(content: string): number {
  const value = JSON.parse(content) as { policyVersion?: unknown };
  if (!Number.isSafeInteger(value.policyVersion) || (value.policyVersion as number) < 1) {
    throw new Error("Verified evidence lacks a valid policy version.");
  }
  return value.policyVersion as number;
}

export function createEvidenceArchive(
  files: ReadonlyMap<string, string>,
  hashText: TextHasher,
  options: EvidenceValidationOptions = {},
): EvidenceArchive {
  const entries = prepareEvidenceEntries(files);
  const manifest = validateEvidencePackage(files, hashText, options);
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry.name, entry.bytes.length), entry.bytes);
    const padding =
      (TAR_BLOCK_BYTES - (entry.bytes.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(TAR_END_BYTES));
  const bytes = Buffer.concat(chunks);
  const policyVersion = verificationPolicyVersion(
    files.get("verification-summary.json") as string,
  );
  const mode = manifest.evidenceMode.toLowerCase().replaceAll("_", "-");
  const status = manifest.packageStatus.toLowerCase();
  const liveAttestationExpiresAtMs = (() => {
    if (manifest.evidenceMode !== "LIVE_VERIFIED") return null;
    const issuedAtMs = Date.parse(manifest.liveAttestation?.issuedAt ?? "");
    const maxAgeMs =
      options.maxAttestationAgeMs ?? DEFAULT_EVIDENCE_MAX_ATTESTATION_AGE_MS;
    const expiresAtMs = issuedAtMs + maxAgeMs;
    if (!Number.isSafeInteger(issuedAtMs) || !Number.isSafeInteger(expiresAtMs)) {
      throw new Error("Live evidence cache expiry is outside the safe time range.");
    }
    return expiresAtMs;
  })();
  return {
    bytes,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    evidenceHash: manifest.evidenceHash,
    evidenceMode: manifest.evidenceMode,
    packageStatus: manifest.packageStatus,
    policyVersion,
    fileName: `policytwin-evidence-v${policyVersion}-${mode}-${status}-${manifest.evidenceHash.slice(0, 12)}.tar`,
    entryNames: entries.map((entry) => entry.name),
    liveAttestationExpiresAtMs,
  };
}
