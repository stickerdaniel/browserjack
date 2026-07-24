# Contributing

Thanks for helping improve Browserjack. This project bridges Claude Code to proprietary OpenAI components, so a few rules are stricter than usual.

## Development

```bash
npm install
npm run verify   # typecheck + lint + format check + tests
```

`npm run verify` must pass before every pull request. CI runs tests and CLI smoke checks on macOS with Node.js 22 and 24, plus quality and package checks on Node.js 24.

Individual steps:

```bash
npm run check         # tsc --noEmit
npm run lint          # oxlint --type-aware
npm run format        # oxfmt
npm test              # build + node --test
node dist/cli.js doctor --live   # requires a supported ChatGPT.app
```

## What we do not accept

- Extracted, decompiled, or re-hosted OpenAI files, including `browser-client.mjs`, `node_repl`, or native-host binaries
- Compatibility-manifest entries for builds you have not verified locally against an OpenAI-signed ChatGPT.app
- Changes that weaken signature verification, the fail-closed manifest, or the sandbox write scope
- Workarounds that bypass OpenAI's site, upload, or file-URL confirmations
- New runtime dependencies without prior discussion (the runtime is intentionally dependency-free)

## Adding a compatibility entry

New ChatGPT.app builds verify themselves through the one-time runtime self-test, so most updates need no manifest change. Manifest entries remain useful as pre-verified defaults: to propose one, open an issue with the `doctor --json` output (redact your username in paths). Maintainers verify the new browser-client hash against an OpenAI-signed installation before extending the manifest.

## Pull requests

Keep PRs small and single-purpose. Describe the problem, the change, and how you verified it on your machine. Test files live in `test/` and use the Node.js test runner; new install/runtime behaviour needs a test.
