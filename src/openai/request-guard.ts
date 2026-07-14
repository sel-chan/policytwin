export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured byte limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readUtf8BodyLimited(request: Request, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Request body byte limit must be a positive safe integer.");
  }
  if (request.body === null) {
    return "";
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export class SingleRunGate {
  #active = 0;

  tryAcquire(): (() => void) | null {
    if (this.#active !== 0) {
      return null;
    }
    this.#active = 1;
    let released = false;
    return () => {
      if (released) {
        throw new Error("Run gate lease was released more than once.");
      }
      released = true;
      this.#active = 0;
    };
  }
}
