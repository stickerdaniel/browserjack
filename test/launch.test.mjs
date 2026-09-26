import assert from "node:assert/strict";
import test from "node:test";

// composeLaunch is the pure assembly step behind createRuntimeLaunch (which
// additionally runs discovery and signature checks against a real
// ChatGPT.app). These tests pin the env and sandbox-argument invariants that
// a refactor must never silently lose.
import { composeLaunch } from "../dist/runtime/launch.js";

const runtime = {
  appPath: "/Applications/ChatGPT.app",
  bundleId: "com.openai.codex",
  appVersion: "1.0.0",
  buildVersion: "1",
  teamId: "2DC432GLL2",
  architecture: "arm64",
  resourcesRoot: "/Applications/ChatGPT.app/Contents/Resources",
  codexPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
  nodePath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/node",
  nodeReplPath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/node_repl",
  nodeModulesPath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/node_modules",
  chromePluginPath: "/Applications/ChatGPT.app/Contents/Resources/plugins/chrome",
  pluginVersion: "1.0.0",
  extensionIds: ["abcdefghijklmnop"],
  nativeHostName: "com.openai.chatgpt",
  nativeHostPath: "/Applications/ChatGPT.app/host",
  browserClientPath: "/Applications/ChatGPT.app/scripts/browser-client.mjs",
  browserClientSha256: "d".repeat(64),
  browserServicePath: "/Applications/ChatGPT.app/scripts/browser-service.mjs",
  codexHome: "/Users/example/.codex",
};

test("strips Node.js code-injection variables from the child env", (t) => {
  t.after(() => {
    delete process.env.NODE_OPTIONS;
    delete process.env.NODE_REPL_EXTERNAL_MODULE;
    delete process.env.NODE_REPL_EXTERNAL_MODULE_PATH;
  });
  process.env.NODE_OPTIONS = "--require /tmp/evil.js";
  process.env.NODE_REPL_EXTERNAL_MODULE = "/tmp/evil.mjs";
  process.env.NODE_REPL_EXTERNAL_MODULE_PATH = "/tmp";

  const launch = composeLaunch(runtime);
  assert.equal(launch.env.NODE_OPTIONS, undefined);
  assert.equal(launch.env.NODE_REPL_EXTERNAL_MODULE, undefined);
  assert.equal(launch.env.NODE_REPL_EXTERNAL_MODULE_PATH, undefined);
});

test("trusts only the verified plugin directory and client hash", () => {
  const launch = composeLaunch(runtime);
  assert.equal(launch.env.NODE_REPL_TRUSTED_CODE_PATHS, runtime.chromePluginPath);
  assert.equal(launch.env.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S, runtime.browserClientSha256);
  assert.equal(launch.env.CODEX_HOME, runtime.codexHome);
});

function configOverrides(launch) {
  return launch.args.flatMap((arg, index) => (launch.args[index - 1] === "-c" ? [arg] : []));
}

test("serves the verified browser service from the plugin directory", () => {
  const launch = composeLaunch(runtime);
  assert.deepEqual(JSON.parse(launch.env.NODE_REPL_TRUSTED_SERVICES), {
    browser: runtime.browserServicePath,
  });
  const { browserServicePath: _omitted, ...legacy } = runtime;
  assert.equal(composeLaunch(legacy).env.NODE_REPL_TRUSTED_SERVICES, undefined);
});

test("pins the runtime env over any shell_environment_policy in config.toml", () => {
  const launch = composeLaunch(runtime);
  const policy = configOverrides(launch).find((arg) => arg.startsWith("shell_environment_policy="));
  assert.ok(policy, "missing shell_environment_policy override");
  for (const key of [
    "NODE_REPL_TRUSTED_CODE_PATHS",
    "NODE_REPL_TRUSTED_SERVICES",
    "BROWSER_USE_AVAILABLE_BACKENDS",
    "CODEX_HOME",
  ]) {
    assert.ok(policy.includes(`${key}=${JSON.stringify(launch.env[key])}`), `${key} is not pinned`);
  }
});

test("sandbox profile limits writes to CODEX_HOME and temp dirs", () => {
  const launch = composeLaunch(runtime);
  const profile = configOverrides(launch).find((arg) => arg.startsWith("permissions."));
  assert.match(profile, /"\/"="read"/);
  assert.ok(profile.includes(`${JSON.stringify(runtime.codexHome)}="write"`));
  assert.match(profile, /":tmpdir"="write"/);
  assert.match(profile, /":slash_tmp"="write"/);
  assert.doesNotMatch(profile, /"\/"="write"/);
});

test("launches OpenAI's own binaries via codex sandbox", () => {
  const launch = composeLaunch(runtime);
  assert.equal(launch.command, runtime.codexPath);
  assert.equal(launch.args[0], "sandbox");
  assert.ok(launch.args.includes(runtime.nodeReplPath));
});
