---
name: doctor
description: Diagnose the local ChatGPT browser runtime bridge without reading browser content
---

Run the installed bridge doctor and explain every failure without weakening security checks:

```bash
"$HOME/Library/Application Support/browserjack/bin/browserjack" doctor --live
```

Do not inspect tabs, page content, cookies, browser history, login databases, or OpenAI authentication files. Do not recommend trusting an unknown ChatGPT.app build. If compatibility fails, recommend installing a bridge release that explicitly supports the installed app build.
