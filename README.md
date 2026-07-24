# Browserjack: OpenAI Codex browser bridge for MCP

[![CI](https://github.com/stickerdaniel/browserjack/actions/workflows/ci.yml/badge.svg)](https://github.com/stickerdaniel/browserjack/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/browserjack.svg)](https://www.npmjs.com/package/browserjack)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Browserjack lets Claude Code and other MCP clients reuse the browser runtime that OpenAI's ChatGPT.app already installed on your Mac. If the ChatGPT/Codex Chrome extension is set up, your agent gets a persistent Node.js REPL that drives your real, signed-in Chrome or Helium profile through OpenAI's own signed components. Nothing extra is injected into the browser and no second automation extension is installed.

> [!WARNING]
> Experimental. Browserjack relies on undocumented, build-specific OpenAI interfaces and can control authenticated browser sessions. It supports one verified ChatGPT.app build at a time and fails closed on everything else. Treat it as a developer tool, not a supported product.

Local stdio · zero runtime dependencies · npm provenance · OpenAI signature checks · fail-closed compatibility

## Requirements

- macOS on Apple Silicon (the current release supports ChatGPT.app `26.715.72359` on arm64; other builds are rejected until the manifest is extended, see [Compatibility](#compatibility))
- Node.js 22 or newer
- Official ChatGPT.app with the ChatGPT/Codex Chrome extension set up in Chrome or Helium
- An MCP client; the built-in setup targets Claude Code

## Quickstart

```bash
npx browserjack setup --client claude --scope user
npx browserjack doctor --live
```

Setup installs an immutable, versioned runtime under `~/Library/Application Support/browserjack/` and registers a stable shim as a Claude Code MCP server. The MCP entry points at the installed shim, never at `npx` or `@latest`, so a later `npx` cache change cannot alter what Claude Code runs. `doctor --live` cold-starts the runtime and verifies the browser handshake end to end.

Then restart Claude Code and try:

```text
Use the browserjack MCP server to open https://example.com and return the page title.
```

Claude runs JavaScript in the bridged runtime and answers with `Example Domain`. If anything fails, run `npx browserjack doctor` and see [docs/troubleshooting.md](docs/troubleshooting.md).

## What it is, and is not

Browserjack is a thin launcher and stdio proxy: all browser capabilities live in OpenAI's installed runtime, exposed as a persistent `node_repl` MCP surface. It contains no Playwright, CDP, or navigation code of its own and does not modify or redistribute any OpenAI component.

Unlike Playwright MCP, Browser MCP, or Claude Code's [official Chrome integration](https://code.claude.com/docs/en/chrome) — the supported cross-platform default if you have a direct Anthropic plan — Browserjack installs no extension of its own. It reuses the OpenAI stack already on your Mac, exposes a persistent Node REPL (including macOS computer use) instead of a fixed tool list, works with any stdio MCP client, and needs no Anthropic plan; the price is macOS-only support and build-specific maintenance.

## Commands

```text
browserjack run          Start the stdio MCP server (invoked by Claude Code)
browserjack doctor       Inspect ChatGPT.app, signatures, runtime, and compatibility
       --json            Machine-readable report
       --live            Additionally cold-start the runtime and verify the browser handshake
browserjack status       Report installation health (version, shim, current link, Node path)
browserjack setup        Install the runtime and register the MCP server
       --client          claude (direct MCP) or plugin (runtime only)
       --scope           user | local | project
       --mcp-name NAME   MCP server name (default: browserjack)
browserjack update       Reinstall this package version, reusing the recorded MCP identity
browserjack uninstall    Remove the installation and the owned MCP entry
       --keep-state      Keep releases and state, remove only the active link and shim
```

### Exit codes

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| 0    | Success                                                          |
| 1    | Invalid arguments or an unexpected error                         |
| 2    | Not ready or unhealthy (`doctor`/`status` found a failing check) |
| 130  | Interrupted (SIGINT), from `run`                                 |

## Claude Code plugin (preview)

`plugin/` contains a thin, disabled-by-default Claude Code plugin that contributes setup, doctor, and browser skills and delegates MCP startup to the installed shim. It is not yet distributed through a marketplace; today it is a source-checkout preview. The runtime half of it installs with:

```bash
npx browserjack setup --client plugin --scope user
```

## Compatibility

Browserjack pins one verified ChatGPT.app build: the cached browser client must match the app-bundled one byte for byte, and unknown builds are rejected. When ChatGPT.app updates, `doctor` fails closed until a Browserjack release supports the new build. To request support, open a compatibility issue with your `doctor --json` output (redact your username in paths first).

## Architecture

```text
MCP client (e.g. Claude Code)
  → browserjack (stdio/JSONL metadata proxy)
  → OpenAI-signed codex sandbox
  → OpenAI node_repl and browser-client
  → official OpenAI native host
  → official ChatGPT/Codex extension
  → Chrome or Helium profile
```

## Security and privacy

Every launch verifies ChatGPT.app and the configured native hosts against OpenAI's code-signing identity, and the runtime starts inside OpenAI's `codex sandbox` with read-only filesystem access from `/` (needed for reliable startup and user-selected uploads) and write access limited to `CODEX_HOME` and temporary directories. Details, trust boundaries, and known limitations: [docs/security.md](docs/security.md).

Browserjack has no telemetry and does not log browser content, cookies, tokens, or form data. What the connected MCP client requests does enter that client's conversation: [docs/privacy.md](docs/privacy.md).

Vulnerability reports: [SECURITY.md](SECURITY.md).

## Environment

| Variable                         | Purpose                        |
| -------------------------------- | ------------------------------ |
| `CHATGPT_APP_PATH`               | Override ChatGPT.app discovery |
| `CODEX_HOME`                     | Override `~/.codex`            |
| `BROWSERJACK_HOME`               | Override the installation root |
| `BROWSER_USE_AVAILABLE_BACKENDS` | Defaults to `chrome`           |

## FAQ

**Why macOS only?** Browserjack drives the browser runtime bundled with the macOS ChatGPT.app and its code-signed native hosts. There is no equivalent local runtime to reuse on Windows or Linux.

**Why only one ChatGPT.app version?** The OpenAI interfaces are undocumented and change between builds. Pinning one verified build and its exact browser-client hash is what keeps the trust boundary honest; a floating match would defeat the point.

**What happens after a ChatGPT.app update?** `doctor` fails the compatibility check and Browserjack refuses to start until the manifest is updated. A long-lived `run` process can survive an app update, so restart Claude Code after updating ChatGPT.app.

**Does Browserjack modify or redistribute OpenAI software?** No. It launches the OpenAI-signed `codex sandbox`, which starts OpenAI's own `node_repl`, and speaks the runtime's existing MCP protocol. No binaries are modified, patched, or redistributed.

**Is this supported by OpenAI?** No. The interfaces are undocumented and build-specific, and they can change without notice. Browserjack is unofficial and fails closed when they do.

**Is "browserjack" a hijacker?** No — the name means jack as in connector. It is a local bridge to components you installed yourself; it injects nothing into the browser and installs no extension.

## Development

```bash
npm install
npm run verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full pipeline, the live probe, and the contribution rules specific to this project.

## Non-affiliation

Unofficial and not affiliated with or endorsed by OpenAI or Anthropic. ChatGPT, Codex, Claude, Chrome, and Helium are referenced descriptively. No vendor logos or proprietary files are included.

## License

MIT for this project's original code. OpenAI components remain governed by their own terms and licenses.
