import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setupBridge } from "../dist/install/setup.js";
import { collectStatus } from "../dist/install/status.js";
import { updateBridge } from "../dist/install/update.js";

async function withInstallation(run) {
  const root = await mkdtemp(join(tmpdir(), "browserjack-status-"));
  const bridgeHome = join(root, "bridge-home");
  const claudeStub = join(root, "claude-stub");
  const calls = join(root, "calls.log");
  const marker = join(root, "mcp-marker");
  const shimPath = join(bridgeHome, "bin", "browserjack");

  // Stateful stub: `add-json` creates a marker; `get` then reports ownership by
  // echoing the recorded shim path, so status can verify the MCP registration.
  await writeFile(
    claudeStub,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(calls)}`,
      'if [ "$1 $2" = "mcp get" ]; then',
      `  if [ -f ${JSON.stringify(marker)} ]; then printf 'name:\\n  Command: ${shimPath}\\n  Args: run\\n'; exit 0; fi`,
      "  exit 1",
      "fi",
      `if [ "$1 $2" = "mcp add-json" ]; then : > ${JSON.stringify(marker)}; exit 0; fi`,
      `if [ "$1 $2" = "mcp remove" ]; then rm -f ${JSON.stringify(marker)}; exit 0; fi`,
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(claudeStub, 0o755);

  const previousBridgeHome = process.env.BROWSERJACK_HOME;
  const previousClaudePath = process.env.CLAUDE_CLI_PATH;
  process.env.BROWSERJACK_HOME = bridgeHome;
  process.env.CLAUDE_CLI_PATH = claudeStub;

  try {
    await run({ root, bridgeHome, calls, marker });
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

test("status reports not installed without state", async () => {
  await withInstallation(async () => {
    const report = await collectStatus();
    assert.equal(report.installed, false);
    assert.equal(report.healthy, false);
    assert.equal(report.checks[0].id, "state");
    assert.equal(report.checks[0].status, "failure");
  });
});

test("status reports a healthy installation", async () => {
  await withInstallation(async () => {
    await setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: true });
    const report = await collectStatus();
    assert.equal(report.installed, true);
    assert.equal(report.healthy, true);
    assert.equal(report.installedVersion, report.packageVersion);
    const ids = report.checks.map((check) => check.id);
    assert.deepEqual(ids, ["state", "current", "shim", "node", "mcp"]);
    assert.equal(report.checks.find((check) => check.id === "mcp").status, "pass");
  });
});

test("status flags a missing MCP registration", async () => {
  await withInstallation(async ({ marker }) => {
    await setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: true });
    await rm(marker); // Claude no longer knows the server.

    const report = await collectStatus();
    assert.equal(report.healthy, false);
    const mcpCheck = report.checks.find((check) => check.id === "mcp");
    assert.equal(mcpCheck.status, "failure");
  });
});

test("status detects a broken current symlink", async () => {
  await withInstallation(async ({ bridgeHome }) => {
    await setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: true });
    const current = join(bridgeHome, "current");
    await rm(current);
    await symlink("releases/does-not-exist", current);

    const report = await collectStatus();
    assert.equal(report.healthy, false);
    const currentCheck = report.checks.find((check) => check.id === "current");
    assert.equal(currentCheck.status, "failure");
  });
});

test("status detects a missing shim node path", async () => {
  await withInstallation(async ({ bridgeHome }) => {
    await setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: true });
    const statePath = join(bridgeHome, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.nodePath = join(bridgeHome, "missing-node");
    await writeFile(statePath, JSON.stringify(state));

    const report = await collectStatus();
    assert.equal(report.healthy, false);
    const nodeCheck = report.checks.find((check) => check.id === "node");
    assert.equal(nodeCheck.status, "failure");
    assert.match(nodeCheck.summary, /no longer exists/);
  });
});

test("update refuses without an existing installation", async () => {
  await withInstallation(async () => {
    await assert.rejects(updateBridge(), /not installed/);
  });
});

test("update reuses the recorded MCP identity", async () => {
  await withInstallation(async ({ calls }) => {
    await setupBridge({ scope: "local", mcpName: "browserjack-custom", registerMcp: true });
    const result = await updateBridge();
    assert.equal(result.previousVersion, result.version);

    const recorded = await readFile(calls, "utf8");
    assert.match(recorded, /mcp add-json --scope local browserjack-custom/);
  });
});

test("update preserves an unregistered MCP choice", async () => {
  await withInstallation(async ({ calls }) => {
    await setupBridge({ scope: "user", mcpName: "browserjack-test", registerMcp: false });
    await updateBridge();

    const recorded = await readFile(calls, "utf8").catch(() => "");
    assert.doesNotMatch(recorded, /mcp add-json/);
  });
});
