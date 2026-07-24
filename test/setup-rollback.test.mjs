import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setupBridge } from "../dist/install/setup.js";

async function withEnv(run) {
  const root = await mkdtemp(join(tmpdir(), "browserjack-rollback-"));
  const bridgeHome = join(root, "bridge-home");
  const claudeStub = join(root, "claude-stub");
  const calls = join(root, "calls.log");
  const marker = join(root, "mcp-marker");
  const shimPath = join(bridgeHome, "bin", "browserjack");

  const previousBridgeHome = process.env.BROWSERJACK_HOME;
  const previousClaudePath = process.env.CLAUDE_CLI_PATH;
  const previousMarker = process.env.MCP_MARKER;
  process.env.BROWSERJACK_HOME = bridgeHome;
  process.env.CLAUDE_CLI_PATH = claudeStub;
  process.env.MCP_MARKER = marker;

  try {
    await run({ root, bridgeHome, claudeStub, calls, marker, shimPath });
  } finally {
    for (const [key, value] of [
      ["BROWSERJACK_HOME", previousBridgeHome],
      ["CLAUDE_CLI_PATH", previousClaudePath],
      ["MCP_MARKER", previousMarker],
    ]) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function writeStub(path, body) {
  await writeFile(path, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CALLS_LOG"\n${body}\n`);
  await chmod(path, 0o755);
}

test("setup restores prior state when MCP registration fails", async () => {
  await withEnv(async ({ bridgeHome, claudeStub, calls }) => {
    process.env.CALLS_LOG = calls;
    // First install: no MCP, produces a baseline shim + state.
    await writeStub(claudeStub, `exit 0`);
    await setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: false });
    const baselineState = await readFile(join(bridgeHome, "state.json"), "utf8");
    const baselineTarget = await readlink(join(bridgeHome, "current"));

    // Second install: registration fails on add-json.
    await writeStub(
      claudeStub,
      `if [ "$1 $2" = "mcp get" ]; then exit 1; fi\nif [ "$1 $2" = "mcp add-json" ]; then exit 1; fi\nexit 0`,
    );
    await assert.rejects(
      setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: true }),
    );

    assert.equal(await readFile(join(bridgeHome, "state.json"), "utf8"), baselineState);
    assert.equal(await readlink(join(bridgeHome, "current")), baselineTarget);
    await access(join(bridgeHome, "bin", "browserjack"));
    delete process.env.CALLS_LOG;
  });
});

test("setup undoes a created MCP entry when the state write fails", async () => {
  await withEnv(async ({ bridgeHome, claudeStub, calls, shimPath }) => {
    process.env.CALLS_LOG = calls;
    // Stateful stub: add-json creates a marker, get reports ownership once the marker exists.
    await writeStub(
      claudeStub,
      [
        `if [ "$1 $2" = "mcp get" ]; then`,
        `  if [ -f "$MCP_MARKER" ]; then printf 'name:\\n  Command: ${shimPath}\\n  Args: run\\n'; exit 0; fi`,
        `  exit 1`,
        `fi`,
        `if [ "$1 $2" = "mcp add-json" ]; then : > "$MCP_MARKER"; exit 0; fi`,
        `if [ "$1 $2" = "mcp remove" ]; then rm -f "$MCP_MARKER"; exit 0; fi`,
        `exit 0`,
      ].join("\n"),
    );

    // Force the state write to fail by turning state.json into a directory.
    await mkdir(bridgeHome, { recursive: true });
    await mkdir(join(bridgeHome, "state.json"), { recursive: true });

    await assert.rejects(
      setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: true }),
    );

    const recorded = await readFile(calls, "utf8");
    assert.match(recorded, /mcp add-json --scope user browserjack-test/);
    assert.match(recorded, /mcp remove --scope user browserjack-test/);
    delete process.env.CALLS_LOG;
  });
});
