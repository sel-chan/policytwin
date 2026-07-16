const FRAME_MAGIC = Buffer.from("PTLC", "ascii");
const FRAME_VERSION = 1;
const FRAME_HEADER_BYTES = 24;
const MAX_PAYLOAD_BYTES = 256;
const UINT64_MAX = (1n << 64n) - 1n;
const SHA256 = /^[0-9a-f]{64}$/u;

export const LINUX_CGROUP_HELPER_PROTOCOL_VERSION = "1" as const;

export const LINUX_CGROUP_HELPER_OPCODES = Object.freeze({
  HELLO: 0x0001,
  RAW_CLOCK: 0x0002,
  BIND: 0x0003,
  SAMPLE: 0x0004,
  FREEZE: 0x0005,
  KILL: 0x0006,
  QUIESCENT: 0x0007,
  RELEASE: 0x0008,
  CLOSE: 0x0009,
  STOP: 0x000a,
  RESPONSE_BIT: 0x8000,
  ERROR: 0xffff,
} as const);

export type LinuxCgroupHelperRole = "egress" | "worker" | "verifier";

export interface LinuxCgroupHelperFrame {
  readonly opcode: number;
  readonly sequence: bigint;
  readonly payload: Buffer;
}

function validUint64(value: bigint) {
  return typeof value === "bigint" && value >= 0n && value <= UINT64_MAX;
}

function validOpcode(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 0xffff;
}

function validRequestOpcode(value: number) {
  return Number.isInteger(value) && value >= 1 && value < LINUX_CGROUP_HELPER_OPCODES.RESPONSE_BIT;
}

export function encodeLinuxCgroupHelperFrame(frame: LinuxCgroupHelperFrame) {
  if (
    !validRequestOpcode(frame.opcode) ||
    !validUint64(frame.sequence) ||
    frame.sequence === 0n ||
    !Buffer.isBuffer(frame.payload) ||
    frame.payload.byteLength > MAX_PAYLOAD_BYTES
  ) {
    throw new Error("The Linux cgroup helper frame is invalid.");
  }
  const output = Buffer.alloc(FRAME_HEADER_BYTES + frame.payload.byteLength);
  FRAME_MAGIC.copy(output, 0);
  output.writeUInt16BE(FRAME_VERSION, 4);
  output.writeUInt16BE(frame.opcode, 6);
  output.writeUInt32BE(frame.payload.byteLength, 8);
  output.writeUInt32BE(0, 12);
  output.writeBigUInt64BE(frame.sequence, 16);
  frame.payload.copy(output, FRAME_HEADER_BYTES);
  return output;
}

export function decodeLinuxCgroupHelperFrame(bytes: Buffer): LinuxCgroupHelperFrame {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.byteLength < FRAME_HEADER_BYTES ||
    !bytes.subarray(0, 4).equals(FRAME_MAGIC) ||
    bytes.readUInt16BE(4) !== FRAME_VERSION ||
    bytes.readUInt32BE(12) !== 0
  ) {
    throw new Error("The Linux cgroup helper frame header is invalid.");
  }
  const opcode = bytes.readUInt16BE(6);
  const payloadLength = bytes.readUInt32BE(8);
  const sequence = bytes.readBigUInt64BE(16);
  if (
    !validOpcode(opcode) ||
    sequence === 0n ||
    payloadLength > MAX_PAYLOAD_BYTES ||
    bytes.byteLength !== FRAME_HEADER_BYTES + payloadLength
  ) {
    throw new Error("The Linux cgroup helper frame length or identity is invalid.");
  }
  return Object.freeze({
    opcode,
    sequence,
    payload: Buffer.from(bytes.subarray(FRAME_HEADER_BYTES)),
  });
}

export function linuxCgroupHelperFrameLength(header: Buffer) {
  if (
    !Buffer.isBuffer(header) ||
    header.byteLength !== FRAME_HEADER_BYTES ||
    !header.subarray(0, 4).equals(FRAME_MAGIC) ||
    header.readUInt16BE(4) !== FRAME_VERSION ||
    header.readUInt32BE(12) !== 0
  ) {
    throw new Error("The Linux cgroup helper stream header is invalid.");
  }
  const payloadLength = header.readUInt32BE(8);
  if (payloadLength > MAX_PAYLOAD_BYTES) {
    throw new Error("The Linux cgroup helper stream payload is too large.");
  }
  return FRAME_HEADER_BYTES + payloadLength;
}

export function encodeLinuxCgroupHelperHelloPayload(controllerNonce: Buffer) {
  if (!Buffer.isBuffer(controllerNonce) || controllerNonce.byteLength !== 32) {
    throw new Error("The Linux cgroup helper controller nonce is invalid.");
  }
  return Buffer.from(controllerNonce);
}

export function decodeLinuxCgroupHelperHelloResponse(payload: Buffer, controllerNonce: Buffer) {
  if (
    !Buffer.isBuffer(payload) ||
    payload.byteLength !== 40 ||
    !payload.subarray(0, 32).equals(controllerNonce)
  ) {
    throw new Error("The Linux cgroup helper handshake response is invalid.");
  }
  return Object.freeze({
    controllerNonce: Buffer.from(payload.subarray(0, 32)),
    capabilityBits: payload.readBigUInt64BE(32),
  });
}

function roleCode(role: LinuxCgroupHelperRole) {
  if (role === "egress") return 1;
  if (role === "worker") return 2;
  if (role === "verifier") return 3;
  throw new Error("The Linux cgroup helper role is invalid.");
}

function codeRole(code: number): LinuxCgroupHelperRole {
  if (code === 1) return "egress";
  if (code === 2) return "worker";
  if (code === 3) return "verifier";
  throw new Error("The Linux cgroup helper role code is invalid.");
}

export function encodeLinuxCgroupHelperBindPayload(options: {
  role: LinuxCgroupHelperRole;
  pid: number;
  containerId: string;
}) {
  if (
    !Number.isSafeInteger(options.pid) ||
    options.pid < 1 ||
    options.pid > 0x7fff_ffff ||
    !SHA256.test(options.containerId)
  ) {
    throw new Error("The Linux cgroup helper bind identity is invalid.");
  }
  const payload = Buffer.alloc(40);
  payload.writeUInt8(roleCode(options.role), 0);
  payload.writeUInt32BE(options.pid, 4);
  Buffer.from(options.containerId, "hex").copy(payload, 8);
  return payload;
}

export function decodeLinuxCgroupHelperBindResponse(payload: Buffer) {
  if (
    !Buffer.isBuffer(payload) ||
    payload.byteLength !== 56 ||
    payload.readUInt8(5) !== 0 ||
    payload.readUInt8(6) !== 0 ||
    payload.readUInt8(7) !== 0
  ) {
    throw new Error("The Linux cgroup helper bind response is invalid.");
  }
  const handle = payload.readUInt32BE(0);
  if (handle < 1) throw new Error("The Linux cgroup helper handle is invalid.");
  return Object.freeze({
    handle,
    role: codeRole(payload.readUInt8(4)),
    pidStartTicks: payload.readBigUInt64BE(8),
    cgroupDevice: payload.readBigUInt64BE(16),
    cgroupInode: payload.readBigUInt64BE(24),
    cgroupMountId: payload.readBigUInt64BE(32),
    baselineUsageUsec: payload.readBigUInt64BE(40),
    monotonicRawNs: payload.readBigUInt64BE(48),
  });
}

export function encodeLinuxCgroupHelperHandlePayload(handle: number) {
  if (!Number.isInteger(handle) || handle < 1 || handle > 0xffff_ffff) {
    throw new Error("The Linux cgroup helper handle is invalid.");
  }
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(handle, 0);
  return payload;
}

export function decodeLinuxCgroupHelperSampleResponse(payload: Buffer) {
  if (
    !Buffer.isBuffer(payload) ||
    payload.byteLength !== 28 ||
    payload.readUInt8(22) !== 0 ||
    payload.readUInt8(23) !== 0
  ) {
    throw new Error("The Linux cgroup helper sample response is invalid.");
  }
  const handle = payload.readUInt32BE(0);
  const populated = payload.readUInt8(20);
  const frozen = payload.readUInt8(21);
  if (handle < 1 || populated > 1 || frozen > 1) {
    throw new Error("The Linux cgroup helper sample fields are invalid.");
  }
  return Object.freeze({
    handle,
    monotonicRawNs: payload.readBigUInt64BE(4),
    usageUsec: payload.readBigUInt64BE(12),
    populated: populated === 1,
    frozen: frozen === 1,
    directProcessCount: payload.readUInt32BE(24),
  });
}

export function decodeLinuxCgroupHelperRawClockResponse(payload: Buffer) {
  if (!Buffer.isBuffer(payload) || payload.byteLength !== 8) {
    throw new Error("The Linux cgroup helper RAW clock response is invalid.");
  }
  return payload.readBigUInt64BE(0);
}

export function decodeLinuxCgroupHelperAckResponse(payload: Buffer, expectedHandle: number) {
  if (
    !Buffer.isBuffer(payload) ||
    payload.byteLength !== 4 ||
    payload.readUInt32BE(0) !== expectedHandle
  ) {
    throw new Error("The Linux cgroup helper acknowledgement is invalid.");
  }
  return expectedHandle;
}

export function decodeLinuxCgroupHelperError(payload: Buffer) {
  if (!Buffer.isBuffer(payload) || payload.byteLength !== 4) {
    throw new Error("The Linux cgroup helper error frame is invalid.");
  }
  return Object.freeze({
    failedOpcode: payload.readUInt16BE(0),
    errorCode: payload.readUInt16BE(2),
  });
}
