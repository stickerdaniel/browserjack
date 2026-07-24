# Troubleshooting

Start with a cold inspection:

```bash
browserjack doctor --json
```

Doctor inspects ChatGPT.app, its code signature, the bundled runtime, the Chrome plugin, the cached browser client, the compatibility entry, and the Chrome and Helium native-host manifests. `browserjack status` separately reports whether the local installation itself is healthy.

## Doctor fails the compatibility check

Browserjack refuses unknown ChatGPT.app builds by design. This is expected right after a ChatGPT.app update. Update Browserjack to a release that supports your build rather than trusting an unreviewed local hash. If no release supports it yet, open a compatibility issue with your `doctor --json` output.

## A connected server stops working after a ChatGPT.app update

A running `run` process can survive an app update, so a connected status from an old process does not prove that a fresh start will work. Restart Claude Code after every app update; the new process runs doctor's checks again on startup.

## status reports a broken Node.js path

The installed shim pins the exact Node.js executable used at install time. A Homebrew or nvm upgrade can move or remove it. Run `browserjack setup` (or `browserjack update`) again to rewrite the shim against the current Node.js.

## No browser backends are connected

`doctor --live` verifies that the runtime starts and that `agent.browsers.list()` works; zero connected backends is not a runtime failure. Make sure the ChatGPT/Codex extension is installed and enabled in the browser profile you intend to use, and that ChatGPT.app is running.

## The browser asks for site or automation permission

OpenAI's extension has its own permission layer, independent of Claude Code's permission mode. When a site prompts, choose `Allow for this site` to persist an origin-specific entry. Avoid `Allow for all sites` or any global never-ask setting; Browserjack does not enable those and you should not either.

## File uploads are blocked

File upload requires the Chromium extension toggle **Allow access to file URLs** for the ChatGPT/Codex extension. OpenAI's browser client enforces this before an upload. Enable it on the specific extension, not globally.

## Helium profiles

On Helium the extension and native-host manifest are installed per profile. If a profile cannot reach the native host, confirm the extension is enabled in that specific profile and that `doctor` reports Helium using an OpenAI-signed native host.

## Nothing prints on stdout

`run` reserves stdout for MCP protocol traffic. Diagnostics go to stderr. If you are running the server by hand to debug, watch stderr, not stdout.
