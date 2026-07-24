---
name: browser
description: Use the installed OpenAI ChatGPT browser runtime through its node_repl MCP server
---

Use the plugin-provided `js` MCP tool for browser tasks. The MCP initialization instructions contain the exact verified browser-client URL for the installed ChatGPT.app. Import that URL before using `agent.browsers`.

For the standard `/Applications/ChatGPT.app` installation:

```js
var browserClient =
  await import("file:///Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/chrome/scripts/browser-client.mjs");
await browserClient.setupBrowserRuntime({ globals: globalThis });
var availableBackends = await agent.browsers.list();
```

When the initialization instructions provide a different URL, use that exact URL instead.

Use OpenAI's browser abstractions rather than implementing CDP, navigation, screenshots, or file uploads yourself. Respect OpenAI's site and upload confirmations. Never bypass browser safety policy through raw CDP or alternative browser interfaces.

Do not print cookies, tokens, form values, private page content, or browser-profile data. Get explicit user approval immediately before an irreversible or externally visible action.
