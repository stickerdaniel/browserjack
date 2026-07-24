import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setupBridge } from "../dist/install/setup.js";
import { uninstallBridge } from "../dist/install/uninstall.js";

async function withEnvironment(stubBody, run) {
  const root = await mkdtemp(join(tmpdir(), "browserjack-uninstall-"));
  const bridgeHome = join(root, "bridge-home");
  const claudeStub = join(root, "claude-stub");
  const calls = join(root, "calls.log");
  await writeFile(
    claudeStub,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n${stubBody}\n`,
  );
  await chmod(claudeStub, 0o755);

  const previousBridgeHome = process.env.BROWSERJACK_HOME;
  const previousClaudePath = process.env.CLAUDE_CLI_PATH;
  process.env.BROWSERJACK_HOME = bridgeHome;
  process.env.CLAUDE_CLI_PATH = claudeStub;
  try {
    await run({ bridgeHome, calls });
  } finally {
    if (previousBridgeHome === undefined) {
      delete process.env.BROWSERJACK_HOME;
    } else {
      process.env.BROWSERJACK_HOME = previousBridgeHome;
    }
    if (previousClaudePath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = previousClaudePath;
    }
  }
}

test("uninstall removes the installation root and the owned MCP entry", async () => {
  let shimPath = "";
  const stub = `if [ "$1 $2" = "mcp get" ]; then
  if [ -f "$HOME_SENTINEL" ]; then cat "$HOME_SENTINEL"; exit 0; fi
  exit 1
fi
exit 0`;
  await withEnvironment(stub, async ({ bridgeHome, calls }) => {
    const result = await setupBridge({
      scope: "user",
      mcpName: "browserjack-test",
      registerMcp: true,
    });
    shimPath = result.shimPath;

    const sentinel = join(bridgeHome, "mcp-definition.txt");
    await writeFile(sentinel, `name:\n  Command: ${shimPath}\n  Args: run\n`);
    process.env.HOME_SENTINEL = sentinel;
    try {
      await uninstallBridge(false);
    } finally {
      delete process.env.HOME_SENTINEL;
    }

    await assert.rejects(access(bridgeHome));
    const recorded = await readFile(calls, "utf8");
    assert.match(recorded, /mcp remove --scope user browserjack-test/);
  });
});

test("uninstall skips MCP removal when registration was skipped", async () => {
  await withEnvironment(
    `if [ "$1 $2" = "mcp get" ]; then exit 1; fi\nexit 0`,
    async ({ bridgeHome, calls }) => {
      await setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: false });
      await uninstallBridge(false);

      await assert.rejects(access(bridgeHome));
      const recorded = await readFile(calls, "utf8").catch(() => "");
      assert.doesNotMatch(recorded, /mcp remove/);
    },
  );
});

test("uninstall --keep-state preserves releases and state", async () => {
  await withEnvironment(
    `if [ "$1 $2" = "mcp get" ]; then exit 1; fi\nexit 0`,
    async ({ bridgeHome }) => {
      const result = await setupBridge({
        scope: "user",
        mcpName: "browserjack-test",
        registerMcp: false,
      });
      await uninstallBridge(true);

      await access(result.releasePath);
      await access(join(bridgeHome, "state.json"));
      await assert.rejects(access(join(bridgeHome, "current")));
      await assert.rejects(access(result.shimPath));
    },
  );
});
