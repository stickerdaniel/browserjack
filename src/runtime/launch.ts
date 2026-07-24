import { assertCompatible } from "../compat/manifest.js";
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

export async function createRuntimeLaunch(appOverride?: string): Promise<RuntimeLaunch> {
  const runtime = await discoverRuntime(appOverride);
  await assertCompatible(runtime);
  await assertNativeHostsTrusted(runtime);

  return {
    command: runtime.codexPath,
    args: [
      "sandbox",
      "-c",
      permissionProfile(runtime),
      "-P",
      "claude_browser_node_repl",
      "-C",
      runtime.codexHome,
      "--allow-unix-socket",
      "/tmp/codex-browser-use",
      runtime.nodeReplPath,
      "--disable-sandbox",
    ],
    env: {
      ...sanitizedParentEnv(),
      NODE_REPL_NODE_MODULE_DIRS: runtime.nodeModulesPath,
      NODE_REPL_NODE_PATH: runtime.nodePath,
      NODE_REPL_TRUSTED_CODE_PATHS: runtime.chromePluginPath,
      NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S: runtime.browserClientSha256,
      BROWSER_USE_AVAILABLE_BACKENDS: process.env.BROWSER_USE_AVAILABLE_BACKENDS ?? "chrome",
      CODEX_HOME: runtime.codexHome,
      CODEX_CLI_PATH: runtime.codexPath,
    },
    runtime,
  };
}
