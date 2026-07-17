import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LINUX_CGROUP_HELPER_OPCODES,
  decodeLinuxCgroupHelperBindResponse,
  decodeLinuxCgroupHelperFrame,
  decodeLinuxCgroupHelperHelloResponse,
  decodeLinuxCgroupHelperSampleResponse,
  encodeLinuxCgroupHelperBindPayload,
  encodeLinuxCgroupHelperFrame,
  encodeLinuxCgroupHelperHandlePayload,
  encodeLinuxCgroupHelperHelloPayload,
  linuxCgroupHelperFrameLength,
} from "../../dist/codex/linux-cgroup-helper-protocol.js";
import {
  assertPrivateLinuxCgroupHelperBoundRole,
  assertPrivateLinuxCgroupHelperClient,
  createPrivateLinuxCgroupHelperClient,
} from "../../dist/codex/linux-cgroup-helper-client.js";

test("fixed binary frame round-trips exact opcode, sequence, and payload", () => {
  const payload = encodeLinuxCgroupHelperBindPayload({
    role: "worker",
    pid: 1234,
    containerId: "a".repeat(64),
  });
  const bytes = encodeLinuxCgroupHelperFrame({
    opcode: LINUX_CGROUP_HELPER_OPCODES.BIND,
    sequence: 9n,
    payload,
  });
  assert.equal(linuxCgroupHelperFrameLength(bytes.subarray(0, 24)), bytes.byteLength);
  const decoded = decodeLinuxCgroupHelperFrame(bytes);
  assert.equal(decoded.opcode, LINUX_CGROUP_HELPER_OPCODES.BIND);
  assert.equal(decoded.sequence, 9n);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(payload.readUInt8(0), 2);
  assert.equal(payload.readUInt32BE(4), 1234);
  assert.equal(payload.subarray(8).toString("hex"), "a".repeat(64));
});

test("protocol decodes handshake, bind identity, sample state, and opaque handles", () => {
  const nonce = Buffer.alloc(32, 7);
  assert.deepEqual(encodeLinuxCgroupHelperHelloPayload(nonce), nonce);
  const hello = Buffer.alloc(40);
  nonce.copy(hello);
  hello.writeBigUInt64BE(0x7fn, 32);
  assert.equal(decodeLinuxCgroupHelperHelloResponse(hello, nonce).capabilityBits, 0x7fn);

  const bind = Buffer.alloc(56);
  bind.writeUInt32BE(3, 0);
  bind.writeUInt8(3, 4);
  [11n, 12n, 13n, 14n, 15n, 16n].forEach((value, index) =>
    bind.writeBigUInt64BE(value, 8 + index * 8),
  );
  assert.deepEqual(decodeLinuxCgroupHelperBindResponse(bind), {
    handle: 3,
    role: "verifier",
    pidStartTicks: 11n,
    cgroupDevice: 12n,
    cgroupInode: 13n,
    cgroupMountId: 14n,
    baselineUsageUsec: 15n,
    monotonicRawNs: 16n,
  });

  const sample = Buffer.alloc(28);
  sample.writeUInt32BE(3, 0);
  sample.writeBigUInt64BE(20n, 4);
  sample.writeBigUInt64BE(21n, 12);
  sample.writeUInt8(1, 20);
  sample.writeUInt8(0, 21);
  sample.writeUInt32BE(4, 24);
  assert.deepEqual(decodeLinuxCgroupHelperSampleResponse(sample), {
    handle: 3,
    monotonicRawNs: 20n,
    usageUsec: 21n,
    populated: true,
    frozen: false,
    directProcessCount: 4,
  });
  assert.equal(encodeLinuxCgroupHelperHandlePayload(3).readUInt32BE(), 3);
});

test("protocol rejects non-canonical length, reserved bits, sequence, role, and identity", () => {
  const valid = encodeLinuxCgroupHelperFrame({
    opcode: LINUX_CGROUP_HELPER_OPCODES.RAW_CLOCK,
    sequence: 1n,
    payload: Buffer.alloc(0),
  });
  for (const corrupt of [
    valid.subarray(0, valid.length - 1),
    Buffer.from(valid).fill(1, 12, 16),
    Buffer.from(valid).fill(0, 16, 24),
  ]) {
    assert.throws(() => decodeLinuxCgroupHelperFrame(corrupt), /frame/u);
  }
  assert.throws(
    () => encodeLinuxCgroupHelperBindPayload({ role: "worker", pid: 0, containerId: "a".repeat(64) }),
    /bind identity/u,
  );
  assert.throws(
    () => encodeLinuxCgroupHelperBindPayload({ role: "worker", pid: 1, containerId: "A".repeat(64) }),
    /bind identity/u,
  );
  assert.throws(
    () =>
      encodeLinuxCgroupHelperBindPayload({
        role: "worker",
        pid: 0x8000_0000,
        containerId: "a".repeat(64),
      }),
    /bind identity/u,
  );
  assert.throws(
    () =>
      encodeLinuxCgroupHelperFrame({
        opcode: LINUX_CGROUP_HELPER_OPCODES.ERROR,
        sequence: 1n,
        payload: Buffer.alloc(0),
      }),
    /frame/u,
  );
  const badRole = Buffer.alloc(56);
  badRole.writeUInt32BE(1, 0);
  badRole.writeUInt8(9, 4);
  [1n, 2n, 3n, 4n, 5n, 6n].forEach((value, index) =>
    badRole.writeBigUInt64BE(value, 8 + index * 8),
  );
  assert.throws(() => decodeLinuxCgroupHelperBindResponse(badRole), /role code/u);
});

test("native helper source declares required Linux primitives and no shell or network surface", async () => {
  const [source, clientSource] = await Promise.all([
    readFile(new URL("../../native/policytwin-linux-cgroup-helper.c", import.meta.url), "utf8"),
    readFile(new URL("../../src/codex/linux-cgroup-helper-client.ts", import.meta.url), "utf8"),
  ]);
  for (const marker of [
    "CLOCK_MONOTONIC_RAW",
    "pidfd_open",
    "openat2",
    "RESOLVE_BENEATH",
    "RESOLVE_NO_SYMLINKS",
    "RESOLVE_NO_MAGICLINKS",
    "CGROUP2_SUPER_MAGIC",
    "cgroup.freeze",
    "cgroup.kill",
    "cpu.stat",
    "cgroup.events",
  ]) {
    assert.ok(source.includes(marker), `missing native helper marker ${marker}`);
  }
  assert.equal(/\bsystem\s*\(|\bpopen\s*\(|AF_INET|SOCK_STREAM/u.test(source), false);
  for (const marker of [
    'shell: false',
    'spawn("/proc/self/fd/3", ["--stdio-v1"]',
    'stdio: ["pipe", "pipe", "pipe", executableHandle.fd]',
    'createHash("sha256")',
    'child.kill("SIGKILL")',
  ]) {
    assert.ok(clientSource.includes(marker), `missing helper client marker ${marker}`);
  }
  await assert.rejects(
    createPrivateLinuxCgroupHelperClient({
      helperPath: "C:\\untrusted-helper.exe",
      expectedHelperSha256: "a".repeat(64),
      runBindingSha256: "b".repeat(64),
      requestTimeoutMs: 1_000,
    }),
    /requires a Linux supervisor/u,
  );
  assert.throws(
    () => assertPrivateLinuxCgroupHelperClient({}),
    /active private capability/u,
  );
  assert.throws(
    () => assertPrivateLinuxCgroupHelperBoundRole({}, {}),
    /private bound role capability/u,
  );
});

test("native actuation short-circuits on identity failure and the client poisons queued work", async () => {
  const [source, clientSource] = await Promise.all([
    readFile(new URL("../../native/policytwin-linux-cgroup-helper.c", import.meta.url), "utf8"),
    readFile(new URL("../../src/codex/linux-cgroup-helper-client.ts", import.meta.url), "utf8"),
  ]);
  for (const opcode of ["OP_FREEZE", "OP_KILL"]) {
    const branchStart = source.indexOf(`request->opcode == ${opcode}`);
    const nextBranch = source.indexOf("request->opcode ==", branchStart + 1);
    const branch = source.slice(branchStart, nextBranch);
    assert.ok(branchStart >= 0, `missing ${opcode} branch`);
    assert.match(branch, /verify_cgroup_fd\(handle, true\) != 0/u);
    assert.match(branch, /return send_error\(request->sequence, request->opcode, ERR_IDENTITY\)/u);
    assert.ok(
      branch.indexOf("ERR_IDENTITY") < branch.indexOf("write_cgroup_control"),
      `${opcode} must reject identity drift before cgroup actuation`,
    );
  }
  for (const marker of [
    "poisonHelperSession",
    "await previous",
    "state.stopped && !allowStopping",
    "bindPrivateLinuxCgroupHelperRole",
    "samplePrivateLinuxCgroupHelperRole",
    "freezePrivateLinuxCgroupHelperRole",
    "killPrivateLinuxCgroupHelperRole",
    "readQuiescentPrivateLinuxCgroupHelperRole",
    "releasePrivateLinuxCgroupHelperRole",
  ]) {
    assert.ok(clientSource.includes(marker), `missing helper client safety marker ${marker}`);
  }
});
