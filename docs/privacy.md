# Privacy

Browserjack has no telemetry. Its only network request is a plain GET of OpenAI's public ChatGPT.app update feed (`persistent.oaistatic.com/codex-app-prod/appcast.xml`). `doctor` sends it on every run; `run` sends it after a failed tool call to tell the agent when ChatGPT.app is outdated. Each `run` process reuses a successful answer for 24 hours and a failed request for 10 minutes; a restart starts without a cached answer. The request carries no Browserjack data. It must not log browser payloads, cookies, tokens, file contents, or form values; stderr diagnostics additionally pass through a secret-redaction filter.

The bridge does not request or export browser credentials, but it acts through your existing authenticated browser sessions. What that means in practice:

- Page text, screenshots, accessibility data, and tool results that the connected MCP client requests enter that client's conversation and are processed under that provider's terms (for Claude Code: Anthropic's).
- Files you approve for upload are read by OpenAI's runtime and sent to the target website.
- OpenAI's extension, native host, and local runtime remain subject to OpenAI's policies.

When sharing diagnostics publicly (for example `doctor --json` output in an issue), redact your macOS username from filesystem paths first.

Security model and trust boundaries: [security.md](security.md).
