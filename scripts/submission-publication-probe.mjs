import { spawnSync } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PROBE_TIMEOUT_MILLISECONDS = 30_000;
const SPECIAL_PURPOSE_IPV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
]) {
  SPECIAL_PURPOSE_IPV6.addSubnet(address, prefix, "ipv6");
}

function publicRepositoryUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !["github.com", "gitlab.com"].includes(url.hostname)
  ) {
    throw new Error("Repository URL is not a supported anonymous Git host URL.");
  }
  const segments = url.pathname.replace(/\.git$/u, "").split("/").filter(Boolean);
  if (
    segments.length !== 2 ||
    segments.some((segment) => !/^[A-Za-z0-9._-]{1,128}$/u.test(segment))
  ) {
    throw new Error("Repository URL must identify one owner and repository.");
  }
  return `${url.origin}/${segments[0]}/${segments[1]}.git`;
}

export function gitProbeEnvironment(directory, emptyConfigPath) {
  const environment = {
    GIT_CEILING_DIRECTORIES: dirname(directory),
    GIT_CONFIG_GLOBAL: emptyConfigPath,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    HOME: directory,
    USERPROFILE: directory,
    XDG_CONFIG_HOME: directory,
  };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "ComSpec", "TEMP", "TMP"]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  return environment;
}

export function isPublicIpAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [first, second, third] = parts;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && [0, 2].includes(third)) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 192 && second === 168) ||
      (first === 198 && [18, 19].includes(second)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113)
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPublicIpAddress(normalized.slice("::ffff:".length));
    }
    return /^[23]/u.test(normalized) && !SPECIAL_PURPOSE_IPV6.check(normalized, "ipv6");
  }
  return false;
}

async function resolvePublicAddress(hostname) {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, "");
  if (isIP(normalizedHostname)) {
    if (!isPublicIpAddress(normalizedHostname)) {
      throw new Error("Live URL IP address is not public.");
    }
    return { address: normalizedHostname, family: isIP(normalizedHostname) };
  }
  const results = await Promise.allSettled([resolve4(normalizedHostname), resolve6(normalizedHostname)]);
  const addresses = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new Error("Live URL DNS did not resolve exclusively to public addresses.");
  }
  const address = addresses[0];
  return { address, family: isIP(address) };
}

function probePinnedHttps(url, resolved) {
  return new Promise((resolveProbe, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const probe = request(
      {
        protocol: "https:",
        hostname,
        port: 443,
        family: resolved.family,
        autoSelectFamily: false,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Connection: "close",
          Host: url.host,
          "User-Agent": "PolicyTwin-release-verifier/1",
        },
        lookup: (_lookupHostname, _options, callback) =>
          callback(null, resolved.address, resolved.family),
        rejectUnauthorized: true,
        servername: isIP(hostname) ? undefined : hostname,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        response.destroy();
        resolveProbe(statusCode);
      },
    );
    probe.setTimeout(PROBE_TIMEOUT_MILLISECONDS, () =>
      probe.destroy(new Error("Live URL HTTPS probe timed out.")),
    );
    probe.once("error", reject);
    probe.end();
  });
}

export async function probePublicSubmissionLinks({ liveUrl, repositoryUrl }) {
  const failures = [];
  let liveStatusCode = null;
  let liveFinalUrl = null;
  let repositoryHead = null;
  try {
    const requestedLiveUrl = new URL(liveUrl);
    if (
      requestedLiveUrl.protocol !== "https:" ||
      requestedLiveUrl.username !== "" ||
      requestedLiveUrl.password !== "" ||
      requestedLiveUrl.port !== "" ||
      requestedLiveUrl.hash !== ""
    ) {
      throw new Error("Live URL must be a credential-free default-port HTTPS URL.");
    }
    const resolved = await resolvePublicAddress(requestedLiveUrl.hostname);
    liveStatusCode = await probePinnedHttps(requestedLiveUrl, resolved);
    liveFinalUrl = requestedLiveUrl.href;
    if (liveStatusCode < 200 || liveStatusCode >= 300) {
      failures.push("Live URL is not anonymously reachable at its declared HTTPS origin.");
    }
  } catch (error) {
    failures.push(`Live URL probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const gitUrl = publicRepositoryUrl(repositoryUrl);
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "policytwin-public-git-probe-")),
    );
    let result;
    try {
      const emptyConfigPath = join(directory, "empty.gitconfig");
      writeFileSync(emptyConfigPath, "", "utf8");
      const environment = gitProbeEnvironment(directory, emptyConfigPath);
      const repositoryContext = spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: directory,
        encoding: "utf8",
        env: environment,
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: PROBE_TIMEOUT_MILLISECONDS,
        windowsHide: true,
      });
      if (repositoryContext.error) {
        throw new Error("Git isolation preflight could not execute.");
      }
      if (repositoryContext.status === 0) {
        throw new Error("Git probe directory unexpectedly inherited a repository context.");
      }
      result = spawnSync(
        "git",
        ["-c", "credential.helper=", "ls-remote", "--exit-code", gitUrl, "HEAD"],
        {
          cwd: directory,
          encoding: "utf8",
          env: environment,
          maxBuffer: 1024 * 1024,
          shell: false,
          timeout: PROBE_TIMEOUT_MILLISECONDS,
          windowsHide: true,
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\s+HEAD\s*$/u.exec(result.stdout);
    if (result.status !== 0 || !match) {
      failures.push("Repository URL is not anonymously readable through Git HEAD discovery.");
    } else {
      repositoryHead = match[1];
    }
  } catch (error) {
    failures.push(
      `Repository URL probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    valid: failures.length === 0,
    liveUrl,
    liveFinalUrl,
    liveStatusCode,
    repositoryUrl,
    repositoryHead,
    anonymousAccess: failures.length === 0,
    failures,
  };
}
