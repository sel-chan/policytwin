const missingCredentials = ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_MODEL"].filter(
  (name) => !process.env[name],
);

if (missingCredentials.length > 0) {
  console.error(`verify:live is fail-closed: missing ${missingCredentials.join(", ")}.`);
} else {
  console.error(
    "verify:live is fail-closed: the server-side Responses and Codex SDK adapters exist, but the fresh end-to-end runner, post-repair 41-case receipts, live attestation, and evidence promotion are not implemented yet.",
  );
}

process.exit(1);
