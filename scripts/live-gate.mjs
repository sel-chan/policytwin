const missingHostConfiguration = ["OPENAI_API_KEY", "CODEX_MODEL"].filter(
  (name) => !process.env[name],
);

if (missingHostConfiguration.length > 0) {
  console.error(
    `verify:live is fail-closed: missing host configuration ${missingHostConfiguration.join(", ")}.`,
  );
} else {
  console.error(
    "verify:live is fail-closed: the Responses adapter, signed RPC client, real mTLS transport, bounded supervisor, and durable replay store exist, but the OS-isolated worker image, worker-only Codex credential, OpenAI-only egress proxy, immutable no-network verification workspace, fresh end-to-end runner, live attestation, and evidence promotion are not implemented yet.",
  );
}

process.exit(1);
