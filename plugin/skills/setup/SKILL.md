---
name: setup
description: Install the local ChatGPT browser runtime bridge for Claude Code
---

Explain the trust boundary before installation: the bridge can control authenticated browser sessions, uses undocumented local OpenAI interfaces, and is currently an experimental macOS developer preview.

For a published release, install an exact reviewed version:

```bash
npx --yes browserjack@0.1.0 setup --client plugin --scope user
```

For a source checkout, run:

```bash
npm run build
node dist/cli.js setup --client plugin --scope user
```

Do not use `@latest` for a reviewed or reproducible installation. Do not enable global all-sites, file-upload, file-URL, or raw node_repl approval as part of setup.
