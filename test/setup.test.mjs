import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setupBridge } from "../dist/install/setup.js";

test("installs an immutable release and registers a stable shim", async () => {
  const root = await mkdtemp(join(tmpdir(), "browserjack-setup-"));
  const bridgeHome = join(root, "bridge-home");
  const claudeStub = join(root, "claude-stub");
  const calls = join(root, "calls.log");

  await writeFile(
    claudeStub,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nif [ "$1 $2" = "mcp get" ]; then exit 1; fi\nexit 0\n`,
  );
  await chmod(claudeStub, 0o755);

  const previousBridgeHome = process.env.BROWSERJACK_HOME;
  const previousClaudePath = process.env.CLAUDE_CLI_PATH;
  process.env.BROWSERJACK_HOME = bridgeHome;
  process.env.CLAUDE_CLI_PATH = claudeStub;

  try {
    const result = await setupBridge({
      scope: "user",
      mcpName: "browserjack-test",
      registerMcp: true,
    });

    await access(result.releasePath);
    await access(result.shimPath);
    assert.equal(result.mcp, "created");

    const shim = await readFile(result.shimPath, "utf8");
    assert.match(shim, /current\/dist\/cli\.js/);

    const recorded = await readFile(calls, "utf8");
    assert.match(recorded, /mcp get browserjack-test/);
    assert.match(recorded, /mcp add-json --scope user browserjack-test/);
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
});
