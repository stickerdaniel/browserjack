import { assertCachedClientConsistent } from "../compat/manifest.js";
import { discoverRuntime } from "../discovery/app.js";
import { assertNativeHostsTrusted } from "../discovery/native-host.js";
import type { DiscoveredRuntime } from "../discovery/types.js";

export interface RuntimeLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  runtime: DiscoveredRuntime;
}

function configPath(path: string): string {
  return JSON.stringify(path);
}

function permissionProfile(runtime: DiscoveredRuntime): string {
  const entries = [
    '"/"="read"',
    `${configPath(runtime.codexHome)}="write"`,
    '":tmpdir"="write"',
    '":slash_tmp"="write"',
  ];
  return `permissions.claude_browser_node_repl.filesystem={${entries.join(",")}}`;
}

// Node.js honours these to preload or inject arbitrary code. Never forward them
// into OpenAI's trusted runtime; a caller-set value would otherwise run inside
// the child outside NODE_REPL_TRUSTED_CODE_PATHS.
const DANGEROUS_ENV_VARS = [
  "NODE_OPTIONS",
  "NODE_REPL_EXTERNAL_MODULE",
  "NODE_REPL_EXTERNAL_MODULE_PATH",
] as const;

function sanitizedParentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of DANGEROUS_ENV_VARS) {
    delete env[key];
  }
  return env;
}

function runtimeEnv(runtime: DiscoveredRuntime): Record<string, string> {
  return {
    NODE_REPL_NODE_MODULE_DIRS: runtime.nodeModulesPath,
    NODE_REPL_NODE_PATH: runtime.nodePath,
    NODE_REPL_TRUSTED_CODE_PATHS: runtime.chromePluginPath,
    NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S: runtime.browserClientSha256,
    // ChatGPT.app 26.814+ moved browser control into a trusted RPC service
    // that browser-client.mjs reaches through nodeRepl.rpc("browser", ...).
    ...(runtime.browserServicePath === undefined
      ? {}
      : { NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: runtime.browserServicePath }) }),
    BROWSER_USE_AVAILABLE_BACKENDS: process.env.BROWSER_USE_AVAILABLE_BACKENDS ?? "chrome",
    CODEX_HOME: runtime.codexHome,
    CODEX_CLI_PATH: runtime.codexPath,
  };
}

// codex sandbox applies shell_environment_policy from CODEX_HOME/config.toml
// to the child, and ChatGPT.app writes its own NODE_REPL_* values there. Pin
// the policy so a stale or foreign config cannot replace the runtime env.
function environmentPolicy(env: Record<string, string>): string {
  const entries = Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return `shell_environment_policy={inherit="all",set={${entries.join(",")}}}`;
}

// Pure assembly of the sandbox invocation from an already-verified runtime.
// Kept side-effect free so the env and argument invariants stay testable
// without a real ChatGPT.app.
export function composeLaunch(runtime: DiscoveredRuntime): RuntimeLaunch {
  const env = runtimeEnv(runtime);
  return {
    command: runtime.codexPath,
    args: [
      "sandbox",
      "-c",
      permissionProfile(runtime),
      "-c",
      environmentPolicy(env),
      "-P",
      "claude_browser_node_repl",
      "-C",
      runtime.codexHome,
      "--allow-unix-socket",
      "/tmp/codex-browser-use",
      runtime.nodeReplPath,
      "--disable-sandbox",
    ],
    env: { ...sanitizedParentEnv(), ...env },
    runtime,
  };
}

// Every security check runs here, for every build: app and native-host
// signatures, cache byte-identity, containment. Build *compatibility* is
// established separately (manifest entry or one-time self-test); it gates
// nothing security-relevant.
export async function createRuntimeLaunch(appOverride?: string): Promise<RuntimeLaunch> {
  const runtime = await discoverRuntime(appOverride);
  assertCachedClientConsistent(runtime);
  await assertNativeHostsTrusted(runtime);
  return composeLaunch(runtime);
}
