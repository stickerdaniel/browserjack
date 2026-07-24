import { access, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { runCommand } from "../lib/command.js";
import { sha256File } from "../lib/hash.js";
import { isJsonObject, readJsonFile, requireString } from "../lib/json.js";
import type { DiscoveredRuntime } from "./types.js";

const EXPECTED_BUNDLE_ID = "com.openai.codex";
const EXPECTED_TEAM_ID = "2DC432GLL2";
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const CODESIGN = "/usr/bin/codesign";

interface CuaManifest {
  nodePath: string;
  nodeModules: string;
  nodeReplPath: string;
}

interface ChromePluginMetadata {
  version: string;
}

interface ExtensionMetadata {
  extensionId: string;
  extensionHostName: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function plistValue(plistPath: string, key: string): Promise<string> {
  const result = await runCommand(PLIST_BUDDY, ["-c", `Print :${key}`, plistPath]);
  return result.stdout.trim();
}

function parseCuaManifest(value: unknown, source: string): CuaManifest {
  if (!isJsonObject(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  return {
    nodePath: requireString(value, "node_path", source),
    nodeModules: requireString(value, "node_modules", source),
    nodeReplPath: requireString(value, "node_repl_path", source),
  };
}

function parsePluginMetadata(value: unknown, source: string): ChromePluginMetadata {
  if (!isJsonObject(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  return { version: requireString(value, "version", source) };
}

function parseExtensionMetadata(value: unknown, source: string): ExtensionMetadata {
  if (!isJsonObject(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  return {
    extensionId: requireString(value, "extensionId", source),
    extensionHostName: requireString(value, "extensionHostName", source),
  };
}

function parseCodesignDetails(output: string): {
  identifier: string;
  teamId: string;
} {
  const identifier = /^Identifier=(.+)$/m.exec(output)?.[1];
  const teamId = /^TeamIdentifier=(.+)$/m.exec(output)?.[1];
  if (!identifier || !teamId) {
    throw new Error("Unable to read ChatGPT.app code-signing identity");
  }
  return { identifier, teamId };
}

async function findNativeHost(chromePluginPath: string): Promise<string> {
  const root = join(chromePluginPath, "extension-host", "macos");
  const architectures = await readdir(root, { withFileTypes: true });
  const candidates: string[] = [];

  for (const architecture of architectures) {
    if (!architecture.isDirectory()) {
      continue;
    }
    const candidate = join(root, architecture.name, "ChatGPT for Chrome");
    if (await exists(candidate)) {
      candidates.push(await realpath(candidate));
    }
  }

  const [nativeHost] = candidates;
  if (nativeHost === undefined || candidates.length !== 1) {
    throw new Error(`Expected one OpenAI native host, found ${candidates.length}`);
  }
  return nativeHost;
}

function assertContained(root: string, candidate: string): void {
  const containment = relative(root, candidate);
  if (
    containment.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    containment === ".." ||
    isAbsolute(containment)
  ) {
    throw new Error("Chrome plugin cache symlink escapes its cache root");
  }
}

async function resolveOptionalCache(
  codexHome: string,
): Promise<
  Pick<
    DiscoveredRuntime,
    "cachedPluginPath" | "cachedBrowserClientPath" | "cachedBrowserClientSha256"
  >
> {
  const cacheBase = join(codexHome, "plugins", "cache", "openai-bundled", "chrome");
  const latest = join(cacheBase, "latest");
  if (!(await exists(latest))) {
    return {};
  }

  const realBase = await realpath(cacheBase);
  const cachedPluginPath = await realpath(latest);
  assertContained(realBase, cachedPluginPath);

  const linkedBrowserClient = join(cachedPluginPath, "scripts", "browser-client.mjs");
  if (!(await exists(linkedBrowserClient))) {
    throw new Error("Cached Chrome plugin has no browser-client.mjs");
  }

  const cachedBrowserClientPath = await realpath(linkedBrowserClient);
  assertContained(realBase, cachedBrowserClientPath);

  return {
    cachedPluginPath,
    cachedBrowserClientPath,
    cachedBrowserClientSha256: await sha256File(cachedBrowserClientPath),
  };
}

export async function findChatGptApp(override?: string): Promise<string> {
  const candidates = [
    override,
    process.env.CHATGPT_APP_PATH,
    "/Applications/ChatGPT.app",
    join(homedir(), "Applications", "ChatGPT.app"),
    "/Applications/Codex.app",
    join(homedir(), "Applications", "Codex.app"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    try {
      if ((await stat(absolute)).isDirectory()) {
        return await realpath(absolute);
      }
    } catch {
      // Continue through the ordered candidates.
    }
  }

  throw new Error(
    "ChatGPT.app was not found in /Applications or ~/Applications. Set CHATGPT_APP_PATH to override discovery.",
  );
}

export async function discoverRuntime(appOverride?: string): Promise<DiscoveredRuntime> {
  if (process.platform !== "darwin") {
    throw new Error("This bridge currently supports macOS only");
  }

  const appPath = await findChatGptApp(appOverride);
  const infoPlist = join(appPath, "Contents", "Info.plist");
  const [bundleId, appVersion, buildVersion] = await Promise.all([
    plistValue(infoPlist, "CFBundleIdentifier"),
    plistValue(infoPlist, "CFBundleShortVersionString"),
    plistValue(infoPlist, "CFBundleVersion"),
  ]);

  if (bundleId !== EXPECTED_BUNDLE_ID) {
    throw new Error(`Unexpected ChatGPT.app bundle ID: ${bundleId}`);
  }

  await runCommand(CODESIGN, ["--verify", "--strict", appPath]);
  const signature = await runCommand(CODESIGN, ["-dv", "--verbose=4", appPath]);
  const identity = parseCodesignDetails(`${signature.stdout}\n${signature.stderr}`);
  if (identity.identifier !== EXPECTED_BUNDLE_ID) {
    throw new Error(`Unexpected ChatGPT.app signing identifier: ${identity.identifier}`);
  }
  if (identity.teamId !== EXPECTED_TEAM_ID) {
    throw new Error(`Unexpected ChatGPT.app Team ID: ${identity.teamId}`);
  }

  const resourcesRoot = join(appPath, "Contents", "Resources");
  const cuaRoot = join(resourcesRoot, "cua_node");
  const cuaManifestPath = join(cuaRoot, "manifest.json");
  const cuaManifest = parseCuaManifest(await readJsonFile(cuaManifestPath), cuaManifestPath);

  const chromePluginPath = join(resourcesRoot, "plugins", "openai-bundled", "plugins", "chrome");
  const pluginMetadataPath = join(chromePluginPath, ".codex-plugin", "plugin.json");
  const pluginMetadata = parsePluginMetadata(
    await readJsonFile(pluginMetadataPath),
    pluginMetadataPath,
  );
  const extensionMetadataPath = join(chromePluginPath, "scripts", "extension-id.json");
  const extensionMetadata = parseExtensionMetadata(
    await readJsonFile(extensionMetadataPath),
    extensionMetadataPath,
  );

  const browserClientPath = join(chromePluginPath, "scripts", "browser-client.mjs");
  const codexHome = resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const cached = await resolveOptionalCache(codexHome);

  return {
    appPath,
    bundleId,
    appVersion,
    buildVersion,
    teamId: identity.teamId,
    architecture: process.arch,
    resourcesRoot,
    codexPath: await realpath(join(resourcesRoot, "codex")),
    nodePath: await realpath(join(cuaRoot, cuaManifest.nodePath)),
    nodeReplPath: await realpath(join(cuaRoot, cuaManifest.nodeReplPath)),
    nodeModulesPath: await realpath(join(cuaRoot, cuaManifest.nodeModules)),
    chromePluginPath: await realpath(chromePluginPath),
    pluginVersion: pluginMetadata.version,
    extensionId: extensionMetadata.extensionId,
    nativeHostName: extensionMetadata.extensionHostName,
    nativeHostPath: await findNativeHost(chromePluginPath),
    browserClientPath: await realpath(browserClientPath),
    browserClientSha256: await sha256File(browserClientPath),
    ...cached,
    codexHome,
  };
}

export const expectedOpenAiIdentity = {
  bundleId: EXPECTED_BUNDLE_ID,
  teamId: EXPECTED_TEAM_ID,
} as const;
