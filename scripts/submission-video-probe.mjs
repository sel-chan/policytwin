import { chromium } from "@playwright/test";
import { createReadStream, lstatSync } from "node:fs";
import { createServer } from "node:http";

const PROBE_TIMEOUT_MILLISECONDS = 30_000;

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function streamVideo(request, response, videoPath, size) {
  const range = request.headers.range;
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range !== undefined) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` });
      response.end();
      return;
    }
    start = Number(match[1]);
    end = match[2] === "" ? end : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` });
      response.end();
      return;
    }
    status = 206;
  }
  response.writeHead(status, {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": String(end - start + 1),
    "Content-Type": "video/mp4",
    "X-Content-Type-Options": "nosniff",
    ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });
  const stream = createReadStream(videoPath, { start, end });
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

export async function probeMp4WithChrome(videoPath) {
  const failures = [];
  let stat;
  try {
    stat = lstatSync(videoPath);
  } catch {
    return { valid: false, failures: ["Chrome probe video file is absent."] };
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    return { valid: false, failures: ["Chrome probe requires a non-empty regular video file."] };
  }

  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/") {
      const html =
        "<!doctype html><meta charset=utf-8><title>PolicyTwin media probe</title><video id=demo muted preload=auto src=/video.mp4></video>";
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": String(Buffer.byteLength(html)),
        "Content-Security-Policy": "default-src 'none'; media-src 'self'",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(html);
      return;
    }
    if (request.url === "/video.mp4") {
      streamVideo(request, response, videoPath, stat.size);
      return;
    }
    response.writeHead(404).end();
  });

  let browser;
  try {
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback probe address is invalid.");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--disable-background-networking", "--disable-sync", "--no-first-run"],
    });
    const context = await browser.newContext();
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) await route.continue();
      else await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "load", timeout: PROBE_TIMEOUT_MILLISECONDS });
    const observation = await page.evaluate(async (timeout) => {
      const video = document.querySelector("video");
      function waitFor(eventName) {
        return new Promise((resolveEvent, reject) => {
          const timer = setTimeout(() => reject(new Error(`${eventName} timeout`)), timeout);
          video.addEventListener(
            eventName,
            () => {
              clearTimeout(timer);
              resolveEvent();
            },
            { once: true },
          );
          video.addEventListener(
            "error",
            () => {
              clearTimeout(timer);
              reject(new Error(`media error ${video.error?.code ?? "unknown"}`));
            },
            { once: true },
          );
        });
      }
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor("loadeddata");
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth, 160);
      canvas.height = Math.min(video.videoHeight, 90);
      const rendering = canvas.getContext("2d", { willReadFrequently: true });
      async function seek(target) {
        if (Math.abs(video.currentTime - target) <= 0.005) return;
        const seeked = waitFor("seeked");
        video.currentTime = target;
        await seeked;
      }
      const targets = [
        Math.min(0.05, video.duration / 10),
        video.duration / 2,
        Math.max(0, video.duration - 0.05),
      ];
      const frameSamples = [];
      for (const target of targets) {
        await seek(target);
        rendering.drawImage(video, 0, 0, canvas.width, canvas.height);
        rendering.getImageData(0, 0, 1, 1);
        frameSamples.push(canvas.toDataURL("image/png"));
      }
      const captured =
        typeof video.captureStream === "function" ? video.captureStream() : null;
      const audioTrackCount = captured?.getAudioTracks().length ?? 0;
      for (const track of captured?.getTracks() ?? []) track.stop();
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime,
        audioTrackCount,
        frameSamples,
      };
    }, 10_000);
    if (!Number.isFinite(observation.duration) || observation.duration <= 0 || observation.duration >= 180) {
      failures.push("Chrome reports a non-positive, non-finite, or three-minute demo duration.");
    }
    if (observation.width < 160 || observation.height < 90) {
      failures.push("Chrome reports video dimensions below the demo minimum.");
    }
    if (observation.readyState < 2) failures.push("Chrome did not decode a current video frame.");
    if (observation.audioTrackCount < 1) failures.push("Chrome did not expose a decoded audio track.");
    const distinctFrameCount = new Set(observation.frameSamples).size;
    await context.close();
    return {
      valid: failures.length === 0,
      durationMilliseconds: Math.ceil(observation.duration * 1_000),
      width: observation.width,
      height: observation.height,
      audioTrackCount: observation.audioTrackCount,
      sampledFrameCount: observation.frameSamples.length,
      distinctFrameCount,
      failures,
    };
  } catch (error) {
    return {
      valid: false,
      failures: [`Chrome could not demux and decode the demo MP4: ${error.message}`],
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
  }
}
