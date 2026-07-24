# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-24

### Added

- Stdio MCP bridge that launches OpenAI's bundled `node_repl` through the OpenAI-signed `codex sandbox` and injects `x-codex-turn-metadata` into `tools/call` requests
- Fail-closed compatibility manifest for ChatGPT.app 26.715.72359 (arm64)
- Code-signature verification of ChatGPT.app and, on every launch, of the native-messaging host each installed browser is configured to run (bundle ID and OpenAI Team ID), with Codex-cache containment
- Stripping of Node.js code-injection variables (`NODE_OPTIONS`, external-module loaders) from the runtime environment
- `doctor` with cold inspection and `--live` end-to-end browser-runtime probe
- `setup` with immutable versioned releases, an atomic `current` symlink, a stable shim, and Claude Code MCP registration (`--client claude|plugin`)
- `status` reporting installation health, including a stale shim Node.js path
- `update` reusing the recorded MCP identity transactionally
- `uninstall` that only removes an MCP entry owned by this installation
- Disabled-by-default Claude Code plugin with setup, doctor, and browser skills
- stderr secret redaction and strict stdout protocol purity

[Unreleased]: https://github.com/stickerdaniel/browserjack/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stickerdaniel/browserjack/releases/tag/v0.1.0
