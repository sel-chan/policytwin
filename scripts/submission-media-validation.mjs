import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
export const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_PNG_DECODED_BYTES = 256 * 1024 * 1024;
export const MAX_MP4_BYTES = 256 * 1024 * 1024;
const MAX_DEMO_DURATION_MILLISECONDS = 180_000;
const VIDEO_SAMPLE_ENTRY_TYPES = new Set([
  "av01",
  "avc1",
  "avc3",
  "hev1",
  "hvc1",
  "mp4v",
  "vp08",
  "vp09",
]);
const AUDIO_SAMPLE_ENTRY_TYPES = new Set(["Opus", "ac-3", "ec-3", "fLaC", "mp4a"]);

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

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

export function inspectPng(buffer) {
  const failures = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 57 || buffer.length > MAX_PNG_BYTES) {
    return { valid: false, failures: ["PNG byte length is outside the allowed range."] };
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { valid: false, failures: ["PNG signature is invalid."] };
  }

  let offset = 8;
  let chunkIndex = 0;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  const compressed = [];
  while (offset < buffer.length) {
    if (buffer.length - offset < 12) {
      failures.push("PNG contains a truncated chunk header.");
      break;
    }
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > buffer.length) {
      failures.push("PNG contains a truncated chunk payload.");
      break;
    }
    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (!/^[A-Za-z]{4}$/u.test(type)) failures.push("PNG contains an invalid chunk type.");
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      failures.push(`PNG ${type} chunk CRC is invalid.`);
    }

    if (chunkIndex === 0 && type !== "IHDR") failures.push("PNG IHDR must be the first chunk.");
    if (type === "IHDR") {
      if (chunkIndex !== 0 || length !== 13 || width !== 0) {
        failures.push("PNG must contain exactly one valid IHDR chunk.");
      } else {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
          failures.push("PNG must use standard compression, filtering, and non-interlaced rows.");
        }
      }
    } else if (type === "IDAT") {
      if (imageDataEnded) failures.push("PNG IDAT chunks must be contiguous.");
      sawImageData = true;
      if (length > 0) compressed.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || end !== buffer.length) failures.push("PNG IEND must terminate the file.");
      sawEnd = true;
    } else {
      if (sawImageData) imageDataEnded = true;
      if (/^[A-Z]/u.test(type)) failures.push(`PNG contains unsupported critical chunk ${type}.`);
    }
    offset = end;
    chunkIndex += 1;
    if (type === "IEND") break;
  }

  if (!sawEnd) failures.push("PNG IEND chunk is absent.");
  if (width < 320 || height < 200 || width > 10_000 || height > 10_000) {
    failures.push("PNG dimensions are outside the submission screenshot range.");
  }
  if (bitDepth !== 8 || colorType !== 2) {
    failures.push("PNG must use the reviewed 8-bit RGB Playwright screenshot profile.");
  }
  if (!sawImageData || compressed.length === 0) {
    failures.push("PNG contains no image data.");
  } else if (failures.length === 0) {
    const rowBytes = width * 3;
    const expectedLength = height * (rowBytes + 1);
    if (expectedLength > MAX_PNG_DECODED_BYTES) {
      failures.push("PNG decoded image exceeds the allowed memory bound.");
    } else {
      try {
        const decoded = inflateSync(Buffer.concat(compressed), {
          maxOutputLength: MAX_PNG_DECODED_BYTES,
        });
        if (decoded.length !== expectedLength) {
          failures.push("PNG decoded row length is inconsistent with IHDR.");
        } else {
          const pixels = Buffer.alloc(height * rowBytes);
          let decodedOffset = 0;
          let minimumChannel = 255;
          let maximumChannel = 0;
          for (let row = 0; row < height; row += 1) {
            const filter = decoded[decodedOffset];
            decodedOffset += 1;
            if (filter > 4) {
              failures.push("PNG contains an invalid row filter.");
              break;
            }
            const rowOffset = row * rowBytes;
            for (let column = 0; column < rowBytes; column += 1) {
              const encoded = decoded[decodedOffset];
              decodedOffset += 1;
              const left = column >= 3 ? pixels[rowOffset + column - 3] : 0;
              const up = row > 0 ? pixels[rowOffset - rowBytes + column] : 0;
              const upperLeft =
                row > 0 && column >= 3
                  ? pixels[rowOffset - rowBytes + column - 3]
                  : 0;
              const predictor =
                filter === 0
                  ? 0
                  : filter === 1
                    ? left
                    : filter === 2
                      ? up
                      : filter === 3
                        ? Math.floor((left + up) / 2)
                        : paeth(left, up, upperLeft);
              const value = (encoded + predictor) & 0xff;
              pixels[rowOffset + column] = value;
              minimumChannel = Math.min(minimumChannel, value);
              maximumChannel = Math.max(maximumChannel, value);
            }
          }
          if (failures.length === 0 && maximumChannel - minimumChannel < 16) {
            failures.push("PNG is visually uniform and cannot serve as review evidence.");
          }
        }
      } catch {
        failures.push("PNG image data cannot be decompressed.");
      }
    }
  }
  return { valid: failures.length === 0, width, height, failures };
}

function parseBoxes(buffer, start, end) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) return null;
    let size = BigInt(buffer.readUInt32BE(offset));
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (!/^[\x20-\x7e]{4}$/u.test(type)) return null;
    if (size === 1n) {
      if (end - offset < 16) return null;
      size = buffer.readBigUInt64BE(offset + 8);
      headerSize = 16;
    } else if (size === 0n) {
      size = BigInt(end - offset);
    }
    if (size < BigInt(headerSize) || size > BigInt(end - offset)) return null;
    const boxEnd = offset + Number(size);
    boxes.push({ type, start: offset, dataStart: offset + headerSize, end: boxEnd });
    offset = boxEnd;
  }
  return offset === end ? boxes : null;
}

function childBoxes(buffer, box) {
  return parseBoxes(buffer, box.dataStart, box.end);
}

function child(boxes, type) {
  return boxes?.find((box) => box.type === type);
}

function parseFullBoxDuration(buffer, box) {
  const length = box.end - box.dataStart;
  const version = buffer[box.dataStart];
  if (version === 0 && length >= 20) {
    return {
      timescale: BigInt(buffer.readUInt32BE(box.dataStart + 12)),
      duration: BigInt(buffer.readUInt32BE(box.dataStart + 16)),
    };
  }
  if (version === 1 && length >= 32) {
    return {
      timescale: BigInt(buffer.readUInt32BE(box.dataStart + 20)),
      duration: buffer.readBigUInt64BE(box.dataStart + 24),
    };
  }
  return null;
}

function durationUnderLimit(value) {
  return (
    value !== null &&
    value.timescale > 0n &&
    value.duration > 0n &&
    value.duration * 1_000n <
      value.timescale * BigInt(MAX_DEMO_DURATION_MILLISECONDS)
  );
}

function inspectMediaTrack(buffer, track, expectedHandler, codecs) {
  const trackChildren = childBoxes(buffer, track);
  const media = child(trackChildren, "mdia");
  if (!media) return null;
  const mediaChildren = childBoxes(buffer, media);
  const handler = child(mediaChildren, "hdlr");
  if (!handler || handler.end - handler.dataStart < 12) return null;
  if (
    buffer.subarray(handler.dataStart + 8, handler.dataStart + 12).toString("ascii") !==
    expectedHandler
  ) {
    return null;
  }
  const mediaHeader = child(mediaChildren, "mdhd");
  const mediaInformation = child(mediaChildren, "minf");
  const sampleTable = mediaInformation
    ? child(childBoxes(buffer, mediaInformation), "stbl")
    : null;
  const sampleTableChildren = sampleTable ? childBoxes(buffer, sampleTable) : null;
  const sampleDescription = child(sampleTableChildren, "stsd");
  const sampleSize = child(sampleTableChildren, "stsz") ?? child(sampleTableChildren, "stz2");
  if (!mediaHeader || !sampleDescription || !sampleSize) return { metadataValid: false };

  const descriptionLength = sampleDescription.end - sampleDescription.dataStart;
  if (descriptionLength < 8) return { metadataValid: false };
  const entryCount = buffer.readUInt32BE(sampleDescription.dataStart + 4);
  const entries = parseBoxes(buffer, sampleDescription.dataStart + 8, sampleDescription.end);
  const codec = entries?.find((entry) => codecs.has(entry.type))?.type;
  if (!codec || entryCount !== entries.length || entryCount === 0) {
    return { metadataValid: false };
  }

  const sampleSizeLength = sampleSize.end - sampleSize.dataStart;
  let sampleCount = 0;
  if (sampleSize.type === "stsz" && sampleSizeLength >= 12) {
    sampleCount = buffer.readUInt32BE(sampleSize.dataStart + 8);
  } else if (sampleSize.type === "stz2" && sampleSizeLength >= 12) {
    sampleCount = buffer.readUInt32BE(sampleSize.dataStart + 8);
  }
  const duration = parseFullBoxDuration(buffer, mediaHeader);
  return {
    metadataValid: true,
    sampleCount,
    codec,
    duration,
  };
}

export function inspectMp4(buffer) {
  const failures = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.length > MAX_MP4_BYTES) {
    return { valid: false, failures: ["MP4 byte length is outside the allowed range."] };
  }
  const topLevel = parseBoxes(buffer, 0, buffer.length);
  if (!topLevel) return { valid: false, failures: ["MP4 box structure is malformed."] };
  const fileType = child(topLevel, "ftyp");
  const movie = child(topLevel, "moov");
  const mediaData = topLevel.filter((box) => box.type === "mdat");
  if (!fileType || fileType.end - fileType.dataStart < 8) failures.push("MP4 ftyp box is absent or invalid.");
  if (!movie) failures.push("MP4 moov box is absent.");
  if (mediaData.length === 0 || mediaData.every((box) => box.end === box.dataStart)) {
    failures.push("MP4 contains no media payload.");
  }
  if (!movie) return { valid: false, failures };

  const movieChildren = childBoxes(buffer, movie);
  const movieHeader = child(movieChildren, "mvhd");
  const movieDuration = movieHeader ? parseFullBoxDuration(buffer, movieHeader) : null;
  const isFragmented = topLevel.some((box) => box.type === "moof");
  if (isFragmented) {
    failures.push("Fragmented MP4 is not accepted because its bounded duration is not statically provable.");
  }
  if (!durationUnderLimit(movieDuration)) {
    failures.push("MP4 movie duration must be positive and strictly below three minutes.");
  }
  const videoTracks = (movieChildren ?? [])
    .filter((box) => box.type === "trak")
    .map((track) => inspectMediaTrack(buffer, track, "vide", VIDEO_SAMPLE_ENTRY_TYPES))
    .filter((track) => track !== null);
  const audioTracks = (movieChildren ?? [])
    .filter((box) => box.type === "trak")
    .map((track) => inspectMediaTrack(buffer, track, "soun", AUDIO_SAMPLE_ENTRY_TYPES))
    .filter((track) => track !== null);
  if (videoTracks.length === 0) {
    failures.push("MP4 contains no video track.");
  } else if (
    videoTracks.some(
      (track) =>
        !track.metadataValid ||
        track.sampleCount <= 0 ||
        !durationUnderLimit(track.duration),
    )
  ) {
    failures.push("MP4 video track lacks valid samples, codec metadata, or a sub-three-minute duration.");
  }
  if (audioTracks.length === 0) {
    failures.push("MP4 contains no audio track.");
  } else if (
    audioTracks.some(
      (track) =>
        !track.metadataValid ||
        track.sampleCount <= 0 ||
        !durationUnderLimit(track.duration),
    )
  ) {
    failures.push("MP4 audio track lacks valid samples, codec metadata, or a sub-three-minute duration.");
  }
  const durationMilliseconds = durationUnderLimit(movieDuration)
    ? Number((movieDuration.duration * 1_000n + movieDuration.timescale - 1n) / movieDuration.timescale)
    : null;
  return {
    valid: failures.length === 0,
    durationMilliseconds,
    fragmented: isFragmented,
    codecs: videoTracks.map((track) => track.codec).filter(Boolean),
    audioCodecs: audioTracks.map((track) => track.codec).filter(Boolean),
    failures,
  };
}
