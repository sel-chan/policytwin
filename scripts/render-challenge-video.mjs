import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./process.mjs";

const narrationPath = resolve(ROOT, "artifacts", "demo", "narration.json");
const captionsPath = resolve(ROOT, "artifacts", "demo", "captions.srt");
const sourceVideo = resolve(ROOT, ".tmp", "challenge-video", "source.webm");
const workingDirectory = resolve(ROOT, ".tmp", "challenge-video", "audio");
const outputVideo = resolve(ROOT, "artifacts", "demo", "policytwin-demo.mp4");
const outputManifest = resolve(ROOT, "artifacts", "demo", "video-manifest.json");

function regularExecutable(candidates, label) {
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const stat = lstatSync(candidate);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0) return resolve(candidate);
  }
  throw new Error(`${label} executable is unavailable; set the documented PolicyTwin media path.`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    timeout: 15 * 60_000,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
  return result.stdout;
}

const ffmpeg = regularExecutable(
  [
    process.env.POLICYTWIN_FFMPEG_PATH,
    "C:/Program Files/DownloadHelper CoApp/ffmpeg.exe",
    "C:/Program Files/net.downloadhelper.coapp/converter/build/win/64/ffmpeg.exe",
  ],
  "ffmpeg",
);
const ffprobe = regularExecutable(
  [
    process.env.POLICYTWIN_FFPROBE_PATH,
    "C:/Program Files/DownloadHelper CoApp/ffprobe.exe",
    "C:/Program Files/net.downloadhelper.coapp/converter/build/win/64/ffprobe.exe",
  ],
  "ffprobe",
);
if (!existsSync(sourceVideo) || !lstatSync(sourceVideo).isFile()) {
  throw new Error("Challenge source video is missing; run the dedicated Playwright capture first.");
}

const narrationBytes = readFileSync(narrationPath);
const captionsBytes = readFileSync(captionsPath);
const narration = JSON.parse(narrationBytes.toString("utf8"));
if (
  narration.schemaVersion !== "1" ||
  narration.totalDurationMilliseconds !== 168_000 ||
  !Array.isArray(narration.segments) ||
  narration.segments.length !== 8
) {
  throw new Error("Challenge narration contract is invalid.");
}
let expectedStart = 0;
for (const [index, segment] of narration.segments.entries()) {
  if (
    segment.id !== index + 1 ||
    segment.startMilliseconds !== expectedStart ||
    !Number.isInteger(segment.endMilliseconds) ||
    segment.endMilliseconds <= segment.startMilliseconds ||
    typeof segment.text !== "string" ||
    segment.text.length < 20
  ) {
    throw new Error(`Challenge narration segment ${index + 1} is invalid.`);
  }
  expectedStart = segment.endMilliseconds;
}
if (expectedStart !== narration.totalDurationMilliseconds) {
  throw new Error("Challenge narration timeline is not contiguous.");
}

rmSync(workingDirectory, { recursive: true, force: true });
mkdirSync(workingDirectory, { recursive: true });
run(
  "powershell",
  [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    resolve(ROOT, "scripts", "synthesize-demo-audio.ps1"),
    "-NarrationPath",
    narrationPath,
    "-OutputDirectory",
    workingDirectory,
  ],
  "Narration synthesis",
);

const paddedSegments = [];
for (const segment of narration.segments) {
  const identifier = String(segment.id).padStart(2, "0");
  const raw = resolve(workingDirectory, `segment-${identifier}-raw.wav`);
  const padded = resolve(workingDirectory, `segment-${identifier}.wav`);
  const durationSeconds = (segment.endMilliseconds - segment.startMilliseconds) / 1_000;
  const rawDurationSeconds = Number(
    run(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        raw,
      ],
      `Narration segment ${segment.id} duration probe`,
    ).trim(),
  );
  if (!Number.isFinite(rawDurationSeconds) || rawDurationSeconds > durationSeconds) {
    throw new Error(
      `Narration segment ${segment.id} is ${rawDurationSeconds.toFixed(3)} seconds but its slot is ${durationSeconds.toFixed(3)} seconds.`,
    );
  }
  run(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      raw,
      "-af",
      `apad=pad_dur=${durationSeconds},atrim=0:${durationSeconds}`,
      "-ar",
      "48000",
      "-ac",
      "2",
      padded,
    ],
    `Narration segment ${segment.id}`,
  );
  paddedSegments.push(padded);
}

const narrationAudio = resolve(workingDirectory, "narration.wav");
const audioInputs = paddedSegments.flatMap((path) => ["-i", path]);
const audioPads = paddedSegments.map((_, index) => `[${index}:a]`).join("");
run(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...audioInputs,
    "-filter_complex",
    `${audioPads}concat=n=${paddedSegments.length}:v=0:a=1[a]`,
    "-map",
    "[a]",
    narrationAudio,
  ],
  "Narration assembly",
);

run(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourceVideo,
    "-i",
    narrationAudio,
    "-filter_complex",
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf4f6f2,fps=30,tpad=stop_mode=clone:stop_duration=30[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    "168",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputVideo,
  ],
  "Challenge MP4 render",
);

const probe = JSON.parse(
  run(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height",
      "-of",
      "json",
      outputVideo,
    ],
    "Challenge MP4 probe",
  ),
);
const duration = Number(probe.format?.duration);
const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
if (
  !Number.isFinite(duration) ||
  duration < 167 ||
  duration >= 180 ||
  !videoStream ||
  videoStream.width !== 1920 ||
  videoStream.height !== 1080 ||
  !audioStream
) {
  throw new Error("Rendered challenge MP4 failed the local duration or stream contract.");
}
const videoBytes = readFileSync(outputVideo);
const manifest = {
  schemaVersion: "1",
  profile: "LOCAL_CHALLENGE_VIDEO",
  status: "VIDEO_READY",
  fileName: "policytwin-demo.mp4",
  sha256: createHash("sha256").update(videoBytes).digest("hex"),
  sizeBytes: videoBytes.byteLength,
  durationMilliseconds: Math.round(duration * 1_000),
  width: videoStream.width,
  height: videoStream.height,
  videoCodec: videoStream.codec_name,
  audioCodec: audioStream.codec_name,
  captionsFile: "captions.srt",
  captionsSha256: createHash("sha256").update(captionsBytes).digest("hex"),
  narrationSha256: createHash("sha256").update(narrationBytes).digest("hex"),
  claims: {
    productionVerifyLive: false,
    productionIsolation: false,
    directResponsesApi: false,
  },
};
const temporaryManifest = `${outputManifest}.tmp`;
writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
renameSync(temporaryManifest, outputManifest);
console.log(`Rendered ${outputVideo} (${duration.toFixed(3)} seconds).`);
