import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { registerClaudeMcp, removeClaudeMcpIfOwned } from "../dist/install/mcp.js";

async function withClaudeStub(stubBody, run) {
  const root = await mkdtemp(join(tmpdir(), "browserjack-mcp-"));
  const claudeStub = join(root, "claude-stub");
  const calls = join(root, "calls.log");
  await writeFile(
    claudeStub,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n${stubBody}\n`,
  );
  await chmod(claudeStub, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = claudeStub;
  try {
    await run({ calls });
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = previous;
    }
  }
}

test("refuses to overwrite a foreign MCP definition", async () => {
  await withClaudeStub(
    `if [ "$1 $2" = "mcp get" ]; then printf 'name:\\n  Command: /somewhere/else\\n  Args: run\\n'; exit 0; fi\nexit 0`,
    async () => {
      await assert.rejects(
        registerClaudeMcp("browserjack", "/opt/browserjack/bin/browserjack", "user", process.cwd()),
        /not owned by this installation/,
      );
    },
  );
});

test("keeps an already-owned MCP definition unchanged", async () => {
  await withClaudeStub(
    `if [ "$1 $2" = "mcp get" ]; then printf 'name:\\n  Command: /opt/browserjack/bin/browserjack\\n  Args: run\\n'; exit 0; fi\nexit 0`,
    async ({ calls }) => {
      const result = await registerClaudeMcp(
        "browserjack",
        "/opt/browserjack/bin/browserjack",
        "user",
        process.cwd(),
      );
      assert.equal(result, "unchanged");
      const recorded = await readFile(calls, "utf8");
      assert.doesNotMatch(recorded, /add-json/);
    },
  );
});

test("refuses to remove a foreign MCP definition", async () => {
  await withClaudeStub(
    `if [ "$1 $2" = "mcp get" ]; then printf 'name:\\n  Command: /somewhere/else\\n  Args: run\\n'; exit 0; fi\nexit 0`,
    async () => {
      await assert.rejects(
        removeClaudeMcpIfOwned(
          "browserjack",
          "/opt/browserjack/bin/browserjack",
          "user",
          process.cwd(),
        ),
        /Refusing to remove/,
      );
    },
  );
});

test("removes an owned MCP definition", async () => {
  await withClaudeStub(
    `if [ "$1 $2" = "mcp get" ]; then printf 'name:\\n  Command: /opt/browserjack/bin/browserjack\\n  Args: run\\n'; exit 0; fi\nexit 0`,
    async ({ calls }) => {
      const removed = await removeClaudeMcpIfOwned(
        "browserjack",
        "/opt/browserjack/bin/browserjack",
        "user",
        process.cwd(),
      );
      assert.equal(removed, true);
      const recorded = await readFile(calls, "utf8");
      assert.match(recorded, /mcp remove --scope user browserjack/);
    },
  );
});

test("reports nothing to remove when the server is absent", async () => {
  await withClaudeStub(`if [ "$1 $2" = "mcp get" ]; then exit 1; fi\nexit 0`, async () => {
    const removed = await removeClaudeMcpIfOwned(
      "browserjack",
      "/opt/browserjack/bin/browserjack",
      "user",
      process.cwd(),
    );
    assert.equal(removed, false);
  });
});
