import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = join(fileURLToPath(new URL("..", import.meta.url)), "dist", "cli.js");

async function runCli(args, env = {}) {
  try {
    const result = await run(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("help exits zero and documents every command", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  for (const command of ["run", "doctor", "status", "setup", "update", "uninstall"]) {
    assert.match(result.stdout, new RegExp(`browserjack ${command}`, "u"));
  }
});

test("an unknown command fails with usage guidance", async () => {
  const result = await runCli(["frobnicate"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown command frobnicate/);
  assert.match(result.stderr, /Usage:/);
});

test("setup rejects an invalid scope", async () => {
  const result = await runCli(["setup", "--scope", "global"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Invalid scope global/);
});

test("setup rejects an invalid client", async () => {
  const result = await runCli(["setup", "--client", "vscode"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Invalid client vscode/);
});

test("status without an installation exits 2 with valid JSON", async () => {
  const home = await mkdtemp(join(tmpdir(), "browserjack-cli-"));
  const result = await runCli(["status", "--json"], { BROWSERJACK_HOME: home });
  assert.equal(result.code, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.installed, false);
});

test("update without an installation fails with setup guidance", async () => {
  const home = await mkdtemp(join(tmpdir(), "browserjack-cli-"));
  const result = await runCli(["update"], { BROWSERJACK_HOME: home });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Run browserjack setup first/);
});
