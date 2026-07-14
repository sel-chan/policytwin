import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  REQUIRED_EVIDENCE_FILES,
  validateEvidencePackage,
} from "../../../../dist/evidence/validate.js";

const ALLOWED = new Set([
  "policy-ir.json",
  "compiled-policy.rego",
  "gpt-run-summary.json",
  "opa-results.json",
  "drift-report-before.json",
  "codex-run-summary.json",
  "codex-command-receipts.json",
  "mutation-report.json",
  "mutation-run-summary.json",
  "mutation-opa-results.json",
  "traceability.json",
  "impact-report.json",
  "browser-run-summary.json",
  "browser-run-details.json",
  "container-run-summary.json",
  "container-run-details.json",
  "deployment-run-summary.json",
  "deployment-health-response.json",
  "security-report.json",
  "verification-summary.json",
]);
const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

interface ManifestEntry {
  file: string;
  bytes: number;
  sha256: string;
}

function hashText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function trustedAttestationKeys(): Readonly<Record<string, string>> | undefined {
  const raw = process.env.POLICYTWIN_ATTESTATION_PUBLIC_KEYS_JSON;
  if (!raw) {
    return undefined;
  }
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Attestation public key configuration must be an object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, key]) => typeof key !== "string" || key.length === 0)) {
    throw new Error("Attestation public key configuration contains an invalid key.");
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!ALLOWED.has(name)) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: RESPONSE_HEADERS });
  }
  try {
    const directory = resolve(process.cwd(), "artifacts", "evidence");
    const evidenceFiles = new Map<string, string>(
      await Promise.all(
        REQUIRED_EVIDENCE_FILES.map(async (file) => [
          file,
          await readFile(resolve(directory, file), "utf8"),
        ] as const),
      ),
    );
    const trustedKeys = trustedAttestationKeys();
    validateEvidencePackage(
      evidenceFiles,
      hashText,
      trustedKeys === undefined ? {} : { trustedLiveAttestationKeys: trustedKeys },
    );
    const content = evidenceFiles.get(name) as string;
    const manifestText = evidenceFiles.get("evidence-manifest.json") as string;
    const manifest = JSON.parse(manifestText) as { entries?: ManifestEntry[] };
    const entry = manifest.entries?.find((candidate) => candidate.file === name);
    const sha256 = hashText(content);
    if (
      entry === undefined ||
      entry.bytes !== Buffer.byteLength(content, "utf8") ||
      entry.sha256 !== sha256
    ) {
      return Response.json(
        { error: "EVIDENCE_INTEGRITY_ERROR" },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }
    return new Response(content, {
      headers: {
        ...RESPONSE_HEADERS,
        "content-type": name.endsWith(".json")
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        etag: `"${sha256}"`,
      },
    });
  } catch {
    return Response.json(
      { error: "EVIDENCE_UNAVAILABLE" },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
}
