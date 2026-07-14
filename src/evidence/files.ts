import { Buffer } from "node:buffer";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";
import {
  MAX_EVIDENCE_DOWNLOAD_FILE_BYTES,
  MAX_EVIDENCE_DOWNLOAD_TOTAL_BYTES,
} from "./archive.js";
import { REQUIRED_EVIDENCE_FILES } from "./validate.js";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

async function readBoundedEvidenceFile(
  path: string,
  remainingBytes: number,
): Promise<{ content: string; bytes: number }> {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0 ||
    metadata.size > MAX_EVIDENCE_DOWNLOAD_FILE_BYTES ||
    metadata.size > remainingBytes
  ) {
    throw new Error("Evidence download file violates the bounded regular-file contract.");
  }

  const handle = await open(path, "r");
  try {
    const openedMetadata = await handle.stat();
    if (!openedMetadata.isFile() || openedMetadata.size !== metadata.size) {
      throw new Error("Evidence download file changed before it could be read.");
    }
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) {
        throw new Error("Evidence download file was truncated while being read.");
      }
      offset += result.bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new Error("Evidence download file grew while being read.");
    }
    return { content: UTF8_DECODER.decode(bytes), bytes: bytes.length };
  } finally {
    await handle.close();
  }
}

export async function readEvidenceFilesBounded(
  directory: string,
): Promise<ReadonlyMap<string, string>> {
  if (!isAbsolute(directory)) {
    throw new Error("Evidence download directory must be absolute.");
  }
  const root = resolve(directory);
  const files = new Map<string, string>();
  let totalBytes = 0;
  for (const file of REQUIRED_EVIDENCE_FILES) {
    const path = resolve(root, file);
    if (relative(root, path).startsWith("..")) {
      throw new Error("Evidence download path escapes its trusted directory.");
    }
    const result = await readBoundedEvidenceFile(
      path,
      MAX_EVIDENCE_DOWNLOAD_TOTAL_BYTES - totalBytes,
    );
    totalBytes += result.bytes;
    files.set(file, result.content);
  }
  return files;
}
