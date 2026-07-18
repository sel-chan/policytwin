import { deflateSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

export function createValidPng(width = 320, height = 200, variant = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rowBytes = width * 3 + 1;
  const rows = Buffer.alloc(height * rowBytes);
  for (let row = 0; row < height; row += 1) {
    rows[row * rowBytes] = 0;
    for (let column = 0; column < width; column += 1) {
      const offset = row * rowBytes + 1 + column * 3;
      rows[offset] = (column + variant * 17) % 256;
      rows[offset + 1] = (row + variant * 29) % 256;
      rows[offset + 2] = (row + column + variant * 43) % 256;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function box(type, ...parts) {
  const payload = Buffer.concat(parts);
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

function durationBox(type, durationMilliseconds) {
  const payload = Buffer.alloc(20);
  payload.writeUInt32BE(1_000, 12);
  payload.writeUInt32BE(durationMilliseconds, 16);
  return box(type, payload);
}

function mediaTrack(handlerType, codec, durationMilliseconds, sampleCount) {
  const handler = Buffer.alloc(12);
  handler.write(handlerType, 8, 4, "ascii");
  const sampleEntry = box(codec, Buffer.alloc(16));
  const sampleDescription = box("stsd", Buffer.alloc(4), u32(1), sampleEntry);
  const sampleSizePayload = Buffer.alloc(12);
  sampleSizePayload.writeUInt32BE(4, 4);
  sampleSizePayload.writeUInt32BE(sampleCount, 8);
  const sampleTable = box("stbl", sampleDescription, box("stsz", sampleSizePayload));
  return box(
    "trak",
    box(
      "mdia",
      durationBox("mdhd", durationMilliseconds),
      box("hdlr", handler),
      box("minf", sampleTable),
    ),
  );
}

export function createValidMp4({
  durationMilliseconds = 179_999,
  includeVideo = true,
  includeAudio = true,
  includeMediaData = true,
  videoSampleCount = 1,
  audioSampleCount = 1,
} = {}) {
  const tracks = [
    ...(includeVideo
      ? [mediaTrack("vide", "avc1", durationMilliseconds, videoSampleCount)]
      : []),
    ...(includeAudio
      ? [mediaTrack("soun", "mp4a", durationMilliseconds, audioSampleCount)]
      : []),
  ];
  const movie = box("moov", durationBox("mvhd", durationMilliseconds), ...tracks);
  const fileType = box("ftyp", Buffer.from("isom\0\0\0\0isom", "binary"));
  return Buffer.concat([
    fileType,
    movie,
    ...(includeMediaData ? [box("mdat", Buffer.from([1, 2, 3, 4]))] : []),
  ]);
}

export function createFragmentedMp4() {
  const run = Buffer.alloc(8);
  run.writeUInt32BE(1, 4);
  return Buffer.concat([
    createValidMp4(),
    box("moof", box("traf", box("trun", run))),
  ]);
}

const BROWSER_DECODABLE_MP4_BASE64 =
  "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My4xMDAAQiAIwRg4AAACVQYF//9R3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOE0gMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0xIGRlYmxvY2s9MDowOjAgYW5hbHlzZT0wOjAgbWU9ZGlhIHN1Ym1lPTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MCBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTAgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9MCB0aHJlYWRzPTYgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MTAgc2NlbmVjdXQ9MCBpbnRyYV9yZWZyZXNoPTAgcmM9Y3JmIG1idHJlZT0wIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTAAgAAAANFliIQ6JigACQLJycnJycnJycnJycnJycnJycnJ1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111114CEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHAAAAAdBmiA2gCCwIRAEYIwcIRAEYIwcIRAEYIwcIRAEYIwcIRAEYIwcAAAAB0GaQDqAILAhEARgjBwhEARgjBwhEARgjBwhEARgjBwhEARgjBwAAAAHQZpgOoAgsCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHAAAAAdBmoA6gCCwIRAEYIwcIRAEYIwcIRAEYIwcIRAEYIwcIRAEYIwcAAAAB0GaoDqAILAhEARgjBwhEARgjBwhEARgjBwhEARgjBwhEARgjBwAAAAHQZrAOoAgsCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHAAAAAdBmuA6gCCwIRAEYIwcIRAEYIwcIRAEYIwcIRAEYIwcIRAEYIwcAAAAB0GbADqAILAhEARgjBwhEARgjBwhEARgjBwhEARgjBwhEARgjBwAAAAHQZsgOoAgsCEQBGCMHCEQBGCMHCEQBGCMHAAAABhtZnJhAAAAEG1mcm8AAAAAAAAAGA==";

export function createBrowserDecodableMp4() {
  return Buffer.from(BROWSER_DECODABLE_MP4_BASE64, "base64");
}
