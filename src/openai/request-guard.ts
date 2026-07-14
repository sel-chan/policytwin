export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured byte limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

export class RequestBodyTimeoutError extends Error {
  constructor() {
    super("Request body did not complete within the configured time limit.");
    this.name = "RequestBodyTimeoutError";
  }
}

export async function readUtf8BodyLimited(
  request: Request,
  maxBytes: number,
  timeoutMs?: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Request body byte limit must be a positive safe integer.");
  }
  if (request.body === null) {
    return "";
  }
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("Request body timeout must be a positive safe integer.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  let releaseDeferred = false;
  const releaseReader = () => {
    try {
      reader.releaseLock();
    } catch {
      // A timed-out read releases its lock after the pending read settles.
    }
  };
  try {
    while (true) {
      const readPromise = reader.read();
      pendingRead = readPromise;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await (deadline === null
          ? readPromise
          : Promise.race([
              readPromise,
              new Promise<never>((_resolve, reject) => {
                const remaining = deadline - Date.now();
                if (remaining <= 0) {
                  reject(new RequestBodyTimeoutError());
                  return;
                }
                timeout = setTimeout(() => reject(new RequestBodyTimeoutError()), remaining);
              }),
            ]));
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
      pendingRead = null;
      const { done, value } = readResult;
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new RequestBodyTooLargeError();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    const unsettledRead = pendingRead;
    void reader.cancel().catch(() => undefined);
    if (unsettledRead !== null) {
      releaseDeferred = true;
      void unsettledRead.then(releaseReader, releaseReader);
    }
    throw error;
  } finally {
    if (!releaseDeferred) {
      releaseReader();
    }
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
