const missingHostConfiguration = ["OPENAI_API_KEY", "CODEX_MODEL"].filter(
  (name) => !process.env[name],
);

if (missingHostConfiguration.length > 0) {
  console.error(
    `verify:live is fail-closed: missing host configuration ${missingHostConfiguration.join(", ")}.`,
  );
} else {
  console.error(
    "verify:live is fail-closed: the Responses adapter, signed RPC client, real mTLS transport, bounded supervisor, durable replay store, and static worker/verifier image contracts exist, but immutable images have not run and the OS executor, worker-only Codex credential, OpenAI-only egress proxy, process-tree enforcement, fresh end-to-end runner, live attestation, and evidence promotion are not implemented yet.",
  );
}

process.exit(1);
