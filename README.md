# Browserjack

[![CI](https://github.com/stickerdaniel/browserjack/actions/workflows/ci.yml/badge.svg)](https://github.com/stickerdaniel/browserjack/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/browserjack.svg)](https://www.npmjs.com/package/browserjack)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Use the ChatGPT browser extension from Claude Code. Browserjack is an experimental macOS bridge that exposes the browser runtime already installed with the official ChatGPT.app and ChatGPT/Codex Chrome extension as a local MCP server, so Claude Code can drive an authenticated Chrome or Helium session.

Browserjack does not replace OpenAI's native host, modify the extension, or redistribute proprietary OpenAI components. It starts OpenAI's bundled `node_repl` through the OpenAI-signed `codex sandbox` and exposes that runtime as a local stdio MCP server.

> [!WARNING]
> Experimental. Browserjack relies on undocumented, build-specific OpenAI interfaces and can control authenticated browser sessions. It supports one verified ChatGPT.app build at a time and fails closed on everything else. Treat it as a developer tool, not a supported product.

## Architecture

```text
Claude Code
  → browserjack (stdio/JSONL metadata proxy)
  → OpenAI-signed codex sandbox
  → OpenAI node_repl and browser-client
  → official OpenAI native host
  → official ChatGPT/Codex extension
  → Chrome or Helium profile
```

Browserjack deliberately contains no navigation, screenshot, upload, Playwright, or CDP implementation. Those capabilities remain in OpenAI's installed browser runtime, which Browserjack only launches and speaks MCP to.

## Requirements

- macOS on Apple Silicon or Intel
- Node.js 20 or newer
- Official ChatGPT.app with the ChatGPT/Codex Chrome extension installed
- Claude Code

The current compatibility manifest supports ChatGPT.app `26.715.72359` on arm64 only. Other builds are rejected until the manifest is extended (see [Compatibility](#compatibility)).

## Install

```bash
npx browserjack setup --client claude --scope user
```

This installs an immutable, versioned runtime under `~/Library/Application Support/browserjack/` and registers a stable shim as a Claude Code MCP server. The MCP entry points at the installed shim, never at `npx` or `@latest`, so a later `npx` cache change cannot alter what Claude Code runs.

Verify the installation:

```bash
npx browserjack doctor
```

Then restart Claude Code and ask it to use the `browserjack` MCP server for a browser task.

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

## Claude Code plugin

`plugin/` contains a thin, disabled-by-default Claude Code plugin. It contributes setup, doctor, and browser skills and delegates MCP startup to the stable installed shim; it does not bundle a second runtime. Install the runtime in plugin mode to avoid registering a second MCP server:

```bash
npx browserjack setup --client plugin --scope user
```

## Compatibility

Browserjack pins one verified ChatGPT.app build. Its browser client is matched byte-for-byte by SHA-256, and both ChatGPT.app and the native hosts are checked for the OpenAI Team ID `2DC432GLL2`. When ChatGPT.app updates, `doctor` fails closed until the manifest is extended. Update Browserjack rather than trusting an unreviewed local hash. To request support for a new build, open a compatibility issue with your `doctor --json` output.

## Sandbox scope

Browserjack launches OpenAI's runtime through `codex sandbox`. That runtime currently needs read-only filesystem access starting from `/` to start reliably and to support user-selected file uploads, so Browserjack requests it. Write access stays limited to `CODEX_HOME` and temporary directories, and trusted code is limited to the verified Chrome plugin directory. Narrowing the read scope is tracked as future work; see [`docs/security.md`](docs/security.md).

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

**How is this different from Playwright MCP or a browser-use server?** Those drive a browser they launch and control themselves. Browserjack reuses OpenAI's already-installed, already-authenticated browser runtime and its native host, so it works against your logged-in profiles without a separate automation stack.

**Does this modify or reverse-engineer OpenAI's software?** No binaries are modified, patched, or redistributed. Browserjack launches the OpenAI-signed `codex sandbox`, which starts OpenAI's own `node_repl`, and speaks the runtime's existing MCP protocol.

**Does it read my browsing data?** Browserjack itself does not log browser content, cookies, tokens, or form data, and has no telemetry. Content that Claude Code requests through the runtime does enter your Claude conversation; see [`docs/privacy.md`](docs/privacy.md).

## Development

```bash
npm install
npm run verify   # typecheck + lint + format check + tests
```

Cold-start probe against a supported ChatGPT.app:

```bash
npm run build
node dist/cli.js doctor --live
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: keep the runtime dependency-free, never weaken signature or compatibility checks, and never contribute extracted OpenAI files.

## Non-affiliation

Unofficial and not affiliated with or endorsed by OpenAI or Anthropic. ChatGPT, Codex, Claude, Chrome, and Helium are referenced descriptively. No vendor logos or proprietary files are included.

## License

MIT for this project's original code. OpenAI components remain governed by their own terms and licenses.
