import "server-only";

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { validateEvidenceDownloadPackage } from "../../dist/evidence/archive.js";
import { readEvidenceFilesBounded } from "../../dist/evidence/files.js";
import {
  type EvidenceManifest,
  type EvidenceValidationOptions,
} from "../../dist/evidence/validate.js";

export const EVIDENCE_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export function hashEvidenceText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function evidenceValidationOptions(): EvidenceValidationOptions {
  const raw = process.env.POLICYTWIN_ATTESTATION_PUBLIC_KEYS_JSON;
  if (!raw) {
    return {};
  }
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Attestation public key configuration must be an object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(
      ([keyId, key]) =>
        !/^[A-Za-z0-9._-]{1,128}$/u.test(keyId) ||
        typeof key !== "string" ||
        key.length === 0,
    )
  ) {
    throw new Error("Attestation public key configuration contains an invalid entry.");
  }
  return {
    trustedLiveAttestationKeys: Object.fromEntries(entries) as Readonly<Record<string, string>>,
  };
}

export interface EvidenceDownloadSnapshot {
  files: ReadonlyMap<string, string>;
  manifest: EvidenceManifest;
  validationOptions: EvidenceValidationOptions;
}

export interface EvidenceDownloadInput {
  files: ReadonlyMap<string, string>;
  validationOptions: EvidenceValidationOptions;
}

export async function loadEvidenceDownloadInput(): Promise<EvidenceDownloadInput> {
  const directory = resolve(process.cwd(), "artifacts", "evidence");
  const files = await readEvidenceFilesBounded(directory);
  const validationOptions = evidenceValidationOptions();
  return { files, validationOptions };
}

export async function loadEvidenceDownloadSnapshot(): Promise<EvidenceDownloadSnapshot> {
  const input = await loadEvidenceDownloadInput();
  const { files, validationOptions } = input;
  const manifest = validateEvidenceDownloadPackage(files, hashEvidenceText, validationOptions);
  return { files, manifest, validationOptions };
}
