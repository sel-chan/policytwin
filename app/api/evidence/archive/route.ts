import {
  createEvidenceArchive,
  type EvidenceArchive,
} from "../../../../dist/evidence/archive.js";
import {
  createEvidenceArchiveCache,
  evidenceArchiveCacheKey,
} from "../../../../dist/evidence/archive-cache.js";
import {
  EVIDENCE_RESPONSE_HEADERS,
  hashEvidenceText,
  loadEvidenceDownloadInput,
} from "../../../lib/evidence-download";

export const dynamic = "force-dynamic";
const archiveCache = createEvidenceArchiveCache();

async function buildArchive(
  input: Awaited<ReturnType<typeof loadEvidenceDownloadInput>>,
): Promise<EvidenceArchive> {
  return createEvidenceArchive(input.files, hashEvidenceText, input.validationOptions);
}

async function archiveForRequest(): Promise<EvidenceArchive> {
  const input = await loadEvidenceDownloadInput();
  const key = evidenceArchiveCacheKey(input.files, input.validationOptions);
  return archiveCache.getOrCreate(key, () => buildArchive(input));
}

export async function GET() {
  try {
    const archive = await archiveForRequest();
    const body = new Uint8Array(archive.bytes.length);
    body.set(archive.bytes);
    return new Response(body.buffer, {
      headers: {
        ...EVIDENCE_RESPONSE_HEADERS,
        "content-type": "application/x-tar",
        "content-disposition": `attachment; filename="${archive.fileName}"`,
        "content-length": String(archive.bytes.length),
        etag: `"${archive.archiveSha256}"`,
        "x-policytwin-evidence-hash": archive.evidenceHash,
        "x-policytwin-evidence-mode": archive.evidenceMode,
        "x-policytwin-package-status": archive.packageStatus,
      },
    });
  } catch {
    return Response.json(
      { error: "EVIDENCE_UNAVAILABLE" },
      { status: 503, headers: EVIDENCE_RESPONSE_HEADERS },
    );
  }
}
