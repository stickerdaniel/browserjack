# Security model

This project is an experimental compatibility bridge. It starts OpenAI components already installed with ChatGPT.app and does not redistribute or modify them.

## Trust boundaries

- Claude Code starts this package as a local stdio MCP server.
- The bridge starts the OpenAI-signed `codex sandbox`, which directly starts OpenAI's bundled `node_repl`.
- OpenAI's browser client communicates with the official native host and browser extension.
- Browser actions can access authenticated sessions and sensitive page content.

## Defaults

- Unknown ChatGPT.app builds fail closed.
- ChatGPT.app must have bundle ID `com.openai.codex` and Team ID `2DC432GLL2`.
- The cached browser client must match the verified app-bundled browser client byte-for-byte.
- Before every launch, the native-messaging host that each installed browser (Chrome, Helium) is actually configured to run is resolved and code-signature verified against OpenAI Team ID `2DC432GLL2`. A host configured under the writable Codex cache must resolve within that cache. Any present-but-untrusted browser manifest aborts the launch, so this check is enforced on the `run` path, not only in `doctor`.
- Trusted code paths are restricted to the verified Chrome plugin directory, not all of `~/.codex`.
- Node.js code-injection variables (`NODE_OPTIONS` and external-module loaders) are stripped from the environment handed to OpenAI's runtime.
- The current OpenAI sandbox profile requires read-only filesystem access from `/` to start reliably and support user-selected file uploads. Write access remains limited to `CODEX_HOME` and temporary directories. Narrowing this read scope is tracked as future work.
- stdout is reserved for MCP protocol traffic. Diagnostics use stderr.
- The bridge does not log tool arguments, browser content, cookies, tokens, or form data.

## Known limitations

The OpenAI interfaces used here are undocumented and may change without notice. The bundled compatibility manifest is authenticated through the npm package (and its provenance attestation) but is not yet independently signed. Read scope is broad (see below), and only one ChatGPT.app build is supported at a time.

Do not enable global all-sites access, global upload approval, or raw `node_repl` approval as a distribution default.
