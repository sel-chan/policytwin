import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLinuxCgroupSubtreeQuiescent,
  canonicalLinuxDockerCgroupRelativePath,
  isLinuxCgroupCpuUsageWithinBudget,
  parseLinuxCgroupCpuUsageUsec,
  parseLinuxCgroupPopulated,
  readBoundedLinuxCgroupText,
  readLinuxCgroupCpuUsageUsec,
  validateLinuxCgroupV2SupervisorPreflight,
} from "../../scripts/linux-cgroup-observer.mjs";

const CONTAINER_ID = "a".repeat(64);

test("supervisor preflight requires one canonical Linux cgroup v2 hierarchy", () => {
  const valid = {
    platform: "linux",
    cgroupRootRealPath: "/sys/fs/cgroup",
    cgroupFileSystemType: 0x6367_7270n,
    supervisorMembership: "0::/user.slice/policytwin.scope\n",
  };
  assert.equal(validateLinuxCgroupV2SupervisorPreflight(valid), true);
  for (const [change, pattern] of [
    [{ platform: "win32" }, /Linux supervisor/u],
    [{ cgroupRootRealPath: "/mnt/cgroup" }, /root is not canonical/u],
    [{ cgroupFileSystemType: 0x0102_1994n }, /cgroup v2 filesystem/u],
    [{ supervisorMembership: "2:cpu:/\n" }, /single cgroup v2 hierarchy/u],
    [{ supervisorMembership: "0::/a\n0::/b\n" }, /single cgroup v2 hierarchy/u],
    [{ supervisorMembership: "0::/a/../b\n" }, /single cgroup v2 hierarchy/u],
  ]) {
    assert.throws(
      () => validateLinuxCgroupV2SupervisorPreflight({ ...valid, ...change }),
      pattern,
    );
  }
});

test("Docker cgroup membership requires one exact engine-owned identity segment", () => {
  assert.equal(
    canonicalLinuxDockerCgroupRelativePath(
      `/system.slice/docker-${CONTAINER_ID}.scope`,
      CONTAINER_ID,
    ),
    `/system.slice/docker-${CONTAINER_ID}.scope`,
  );
  assert.equal(
    canonicalLinuxDockerCgroupRelativePath(`/docker/${CONTAINER_ID}`, CONTAINER_ID),
    `/docker/${CONTAINER_ID}`,
  );

  for (const path of [
    `/system.slice/not-docker-${CONTAINER_ID}.scope`,
    `/docker/prefix-${CONTAINER_ID}`,
    `/docker/${CONTAINER_ID}0`,
    `/not-docker/${CONTAINER_ID}`,
    `/docker-${CONTAINER_ID}.scope/child`,
    `/docker/${CONTAINER_ID}/docker-${CONTAINER_ID}.scope`,
    `/docker//${CONTAINER_ID}`,
    `/docker/${CONTAINER_ID}/`,
    `/docker/../${CONTAINER_ID}`,
    `/docker\\${CONTAINER_ID}`,
  ]) {
    assert.throws(
      () => canonicalLinuxDockerCgroupRelativePath(path, CONTAINER_ID),
      /not bound|invalid/u,
      path,
    );
  }
});

test("pseudo-file reads enforce the actual 64 KiB byte limit", () => {
  const exact = Buffer.alloc(64 * 1024, 0x61);
  let exactOffset = 0;
  assert.equal(
    readBoundedLinuxCgroupText((target) => {
      const bytesRead = exact.copy(target, 0, exactOffset);
      exactOffset += bytesRead;
      return bytesRead;
    }).length,
    exact.length,
  );

  const oversized = Buffer.alloc(64 * 1024 + 1, 0x61);
  let oversizedOffset = 0;
  assert.throws(
    () =>
      readBoundedLinuxCgroupText((target) => {
        const bytesRead = oversized.copy(target, 0, oversizedOffset);
        oversizedOffset += bytesRead;
        return bytesRead;
      }),
    /is unsafe/u,
  );
});

test("cpu.stat usage_usec is parsed as the full unsigned 64-bit domain", () => {
  assert.equal(parseLinuxCgroupCpuUsageUsec("usage_usec 0\nuser_usec 0\n"), 0n);
  assert.equal(
    parseLinuxCgroupCpuUsageUsec("usage_usec 18446744073709551615\n"),
    18_446_744_073_709_551_615n,
  );

  for (const text of [
    "usage_usec 18446744073709551616\n",
    "usage_usec 01\n",
    "usage_usec -1\n",
    "usage_usec 1\nusage_usec 2\n",
    "user_usec 1\n",
  ]) {
    assert.throws(() => parseLinuxCgroupCpuUsageUsec(text), /CPU usage is invalid/u);
  }
});

test("CPU budget comparison is exact and fails closed on regression", () => {
  const initial = 9_007_199_254_740_993n;
  assert.equal(isLinuxCgroupCpuUsageWithinBudget(initial, initial + 1_000n, 1), true);
  assert.equal(isLinuxCgroupCpuUsageWithinBudget(initial, initial + 1_001n, 1), false);
  assert.equal(isLinuxCgroupCpuUsageWithinBudget(initial, initial - 1n, 1), false);
  assert.throws(
    () => isLinuxCgroupCpuUsageWithinBudget(initial, initial + 1n, -1),
    /CPU budget is invalid/u,
  );
});

test("cgroup.events populated is a strict descendant-tree signal", () => {
  assert.equal(parseLinuxCgroupPopulated("populated 0\nfrozen 0\n"), false);
  assert.equal(parseLinuxCgroupPopulated("populated 1\nfrozen 0\n"), true);
  for (const text of [
    "frozen 0\n",
    "populated 2\n",
    "populated 0\npopulated 1\n",
    "populated 00\n",
  ]) {
    assert.throws(() => parseLinuxCgroupPopulated(text), /cgroup populated state is invalid/u);
  }
});

test("follow-up operations reject caller-forged observation paths before filesystem access", () => {
  const forged = Object.freeze({
    schemaVersion: "2",
    containerId: CONTAINER_ID,
    initialPid: 1,
    path: "/etc",
    initialProcessIds: Object.freeze([1]),
    initialCpuUsageUsec: 0n,
  });
  assert.throws(
    () => readLinuxCgroupCpuUsageUsec(forged),
    /not issued by this observer/u,
  );
  assert.throws(
    () => assertLinuxCgroupSubtreeQuiescent(forged),
    /not issued by this observer/u,
  );
});
