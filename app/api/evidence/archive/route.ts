import {
  createEvidenceArchive,
  type EvidenceArchive,
} from "../../../../dist/evidence/archive.js";
import {
  EVIDENCE_RESPONSE_HEADERS,
  hashEvidenceText,
  loadEvidenceDownloadInput,
} from "../../../lib/evidence-download";

export const dynamic = "force-dynamic";
let activeArchive: Promise<EvidenceArchive> | null = null;

async function buildArchive(): Promise<EvidenceArchive> {
  const input = await loadEvidenceDownloadInput();
  return createEvidenceArchive(input.files, hashEvidenceText, input.validationOptions);
}

async function archiveForRequest(): Promise<EvidenceArchive> {
  if (activeArchive !== null) {
    return activeArchive;
  }
  const run = buildArchive();
  activeArchive = run;
  try {
    return await run;
  } finally {
    if (activeArchive === run) {
      activeArchive = null;
    }
  }
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
