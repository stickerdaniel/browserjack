# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-24

### Changed

- Repositioned the package as a bridge to OpenAI's installed Codex browser runtime for any MCP client; rewrote the README around a copy-paste quickstart and added a fair comparison with Claude Code's official Chrome integration
- Raised the minimum Node.js version to 22 (Node 20 reached end of life in April 2026)
- Declared arm64-only in npm platform metadata to match the compatibility manifest, so unsupported Intel installs fail at install time instead of at first run
- Slimmed the npm package to runtime files (`dist`, `compatibility`, docs); the TypeScript sources ship via the repository
- Installed releases now contain only what the shim executes (`dist`, `compatibility`, `package.json`, `LICENSE`)
- Consolidated the security prose: canonical details live in `docs/security.md`, the README keeps a summary

### Added

- `prepack` build and a tarball installation smoke test (`pack:check`), so a publish can no longer produce a package without its compiled CLI
- `verify:versions` release check keeping the plugin manifest and pinned setup command in lockstep with the package version

### Fixed

- The live probe now reports the real package version during the MCP handshake instead of a hardcoded one
- Removed the contradictory Intel support claim from the requirements

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

[Unreleased]: https://github.com/stickerdaniel/browserjack/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/stickerdaniel/browserjack/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/stickerdaniel/browserjack/releases/tag/v0.1.0
