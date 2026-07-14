import { REQUIRED_EVIDENCE_FILES } from "../../../../dist/evidence/validate.js";
import {
  EVIDENCE_RESPONSE_HEADERS,
  hashEvidenceText,
  loadEvidenceDownloadSnapshot,
} from "../../../lib/evidence-download";

const ALLOWED = new Set<string>(REQUIRED_EVIDENCE_FILES);

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!ALLOWED.has(name)) {
    return Response.json(
      { error: "NOT_FOUND" },
      { status: 404, headers: EVIDENCE_RESPONSE_HEADERS },
    );
  }
  try {
    const snapshot = await loadEvidenceDownloadSnapshot();
    const content = snapshot.files.get(name) as string;
    const entry = snapshot.manifest.entries.find((candidate) => candidate.file === name);
    const sha256 = hashEvidenceText(content);
    if (
      name !== "evidence-manifest.json" &&
      (entry === undefined ||
        entry.bytes !== Buffer.byteLength(content, "utf8") ||
        entry.sha256 !== sha256)
    ) {
      return Response.json(
        { error: "EVIDENCE_INTEGRITY_ERROR" },
        { status: 409, headers: EVIDENCE_RESPONSE_HEADERS },
      );
    }
    return new Response(content, {
      headers: {
        ...EVIDENCE_RESPONSE_HEADERS,
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
      { status: 503, headers: EVIDENCE_RESPONSE_HEADERS },
    );
  }
}
