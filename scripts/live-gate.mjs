const missingCredentials = ["OPENAI_API_KEY", "CODEX_API_KEY"].filter(
  (name) => !process.env[name],
);

if (missingCredentials.length > 0) {
  console.error(`verify:live is fail-closed: missing ${missingCredentials.join(", ")}.`);
} else {
  console.error("verify:live is fail-closed: fresh GPT-5.6 and Codex integration is not implemented yet.");
}

process.exit(1);
