const missingHostConfiguration = ["OPENAI_API_KEY", "CODEX_MODEL"].filter(
  (name) => !process.env[name],
);

if (missingHostConfiguration.length > 0) {
  console.error(
    `verify:live is fail-closed: missing host configuration ${missingHostConfiguration.join(", ")}.`,
  );
} else {
  console.error(
    "verify:live is fail-closed: the Responses adapter and signed external-worker RPC client contract exist, but the authentication-enforcing transport, supervisor/worker image, worker-only Codex credential, immutable verification workspace, fresh end-to-end runner, live attestation, and evidence promotion are not implemented yet.",
  );
}

process.exit(1);
