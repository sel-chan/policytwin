const missingHostConfiguration = ["OPENAI_API_KEY", "CODEX_MODEL"].filter(
  (name) => !process.env[name],
);

if (missingHostConfiguration.length > 0) {
  console.error(
    `verify:live is fail-closed: missing host configuration ${missingHostConfiguration.join(", ")}.`,
  );
} else {
  console.error(
    "verify:live is fail-closed: the Responses adapter, signed RPC transport, prepared worker/verifier/egress images, proxy admission contract, command-backed capability auth, and supervisor lifecycle contracts exist, but immutable images have not run and no Docker driver, observed DNS/TLS/egress, live worker SDK turn, process-tree proof, fresh end-to-end runner, live attestation, or evidence promotion exists.",
  );
}

process.exit(1);
