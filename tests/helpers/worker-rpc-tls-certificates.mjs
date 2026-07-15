import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function findOpenSsl() {
  const candidates = [
    process.env.OPENSSL_PATH,
    "openssl",
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
      : undefined,
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe"
      : undefined,
    process.platform !== "win32" ? "/usr/bin/openssl" : undefined,
    process.platform !== "win32" ? "/usr/local/bin/openssl" : undefined,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) return candidate;
  }
  throw new Error(
    "OpenSSL is required for ephemeral mTLS integration certificates. Set OPENSSL_PATH when it is not on PATH.",
  );
}

function runOpenSsl(executable, cwd, args) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Ephemeral OpenSSL certificate generation failed at ${args[0]}.`);
  }
}

async function createCa(executable, directory, name) {
  const key = `${name}-key.pem`;
  const cert = `${name}-cert.pem`;
  runOpenSsl(executable, directory, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-subj",
    `/CN=PolicyTwin ${name} Test CA`,
    "-days",
    "2",
    "-sha256",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  return { key, cert };
}

async function createLeaf(
  executable,
  directory,
  ca,
  name,
  commonName,
  serial,
  kind,
) {
  const key = `${name}-key.pem`;
  const csr = `${name}.csr`;
  const cert = `${name}-cert.pem`;
  const extensions = `${name}.ext`;
  const extendedKeyUsage = kind === "server" ? "serverAuth" : "clientAuth";
  const subjectAltName =
    kind === "server"
      ? `DNS:${commonName}`
      : `URI:spiffe://policytwin.test/${commonName}`;
  await writeFile(
    join(directory, extensions),
    [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      `extendedKeyUsage=${extendedKeyUsage}`,
      `subjectAltName=${subjectAltName}`,
      "",
    ].join("\n"),
    "utf8",
  );
  runOpenSsl(executable, directory, [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    csr,
    "-subj",
    `/CN=${commonName}`,
    "-sha256",
  ]);
  runOpenSsl(executable, directory, [
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    ca.cert,
    "-CAkey",
    ca.key,
    "-set_serial",
    String(serial),
    "-out",
    cert,
    "-days",
    "2",
    "-sha256",
    "-extfile",
    extensions,
  ]);
  return { key, cert };
}

async function material(directory, names) {
  const cert = await readFile(join(directory, names.cert));
  const key = await readFile(join(directory, names.key));
  const fingerprintSha256 = new X509Certificate(cert).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
  return { cert, key, fingerprintSha256 };
}

export async function createEphemeralWorkerRpcTlsCertificates() {
  const executable = findOpenSsl();
  const directory = await mkdtemp(join(tmpdir(), "policytwin-worker-mtls-"));
  try {
    const trustedCaNames = await createCa(executable, directory, "trusted");
    const untrustedCaNames = await createCa(executable, directory, "untrusted");
    const serverNames = await createLeaf(
      executable,
      directory,
      trustedCaNames,
      "server",
      "worker.policytwin.test",
      1001,
      "server",
    );
    const clientNames = await createLeaf(
      executable,
      directory,
      trustedCaNames,
      "client",
      "host-client",
      1002,
      "client",
    );
    const otherClientNames = await createLeaf(
      executable,
      directory,
      trustedCaNames,
      "other-client",
      "other-host-client",
      1003,
      "client",
    );
    const untrustedClientNames = await createLeaf(
      executable,
      directory,
      untrustedCaNames,
      "untrusted-client",
      "untrusted-host-client",
      2001,
      "client",
    );
    return {
      ca: await readFile(join(directory, trustedCaNames.cert)),
      server: await material(directory, serverNames),
      client: await material(directory, clientNames),
      otherClient: await material(directory, otherClientNames),
      untrustedClient: await material(directory, untrustedClientNames),
      async cleanup() {
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
