import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { runCommand } from "../lib/command.js";
import { isJsonObject, readJsonFile } from "../lib/json.js";
import { expectedOpenAiIdentity } from "./app.js";
import type { DiscoveredRuntime } from "./types.js";

const CODESIGN = "/usr/bin/codesign";

export interface BrowserNativeHost {
  browser: string;
  manifestPath: string;
}

export function supportedNativeHostManifests(hostName: string): BrowserNativeHost[] {
  return [
    {
      browser: "Google Chrome",
      manifestPath: join(
        homedir(),
        "Library/Application Support/Google/Chrome/NativeMessagingHosts",
        `${hostName}.json`,
      ),
    },
    {
      browser: "Helium",
      manifestPath: join(
        homedir(),
        "Library/Application Support/net.imput.helium/NativeMessagingHosts",
        `${hostName}.json`,
      ),
    },
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hostTeamId(hostPath: string): Promise<string | null> {
  const verification = await runCommand(CODESIGN, ["--verify", "--strict", hostPath], {
    allowNonZero: true,
  });
  if (verification.code !== 0) {
    return null;
  }
  const details = await runCommand(CODESIGN, ["-dv", "--verbose=4", hostPath], {
    allowNonZero: true,
  });
  return /^TeamIdentifier=(.+)$/mu.exec(`${details.stdout}\n${details.stderr}`)?.[1] ?? null;
}

export type NativeHostStatus = "absent" | "trusted" | "untrusted";

export interface NativeHostResult {
  browser: string;
  manifestPath: string;
  status: NativeHostStatus;
  hostPath: string | null;
  teamId: string | null;
  reason?: string;
}

function withinCodexCache(hostPath: string, codexHome: string): boolean {
  const cacheRoot = join(codexHome, "plugins", "cache");
  const containment = relative(cacheRoot, hostPath);
  return !(
    containment.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    containment === ".." ||
    isAbsolute(containment)
  );
}

export async function inspectNativeHost(
  manifest: BrowserNativeHost,
  runtime: DiscoveredRuntime,
): Promise<NativeHostResult> {
  const base: Omit<NativeHostResult, "status"> = {
    browser: manifest.browser,
    manifestPath: manifest.manifestPath,
    hostPath: null,
    teamId: null,
  };

  if (!(await exists(manifest.manifestPath))) {
    return { ...base, status: "absent" };
  }

  let value: unknown;
  try {
    value = await readJsonFile(manifest.manifestPath);
  } catch (error) {
    return {
      ...base,
      status: "untrusted",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!isJsonObject(value)) {
    return { ...base, status: "untrusted", reason: "manifest is not a JSON object" };
  }

  const configuredPath = typeof value.path === "string" ? value.path : null;
  const allowedOrigins = Array.isArray(value.allowed_origins) ? value.allowed_origins : [];
  const expectedOrigin = `chrome-extension://${runtime.extensionId}/`;

  if (value.name !== runtime.nativeHostName) {
    return { ...base, status: "untrusted", reason: "unexpected native-host name" };
  }
  if (!allowedOrigins.includes(expectedOrigin)) {
    return { ...base, status: "untrusted", reason: "extension origin is not allowed" };
  }
  if (configuredPath === null) {
    return { ...base, status: "untrusted", reason: "manifest has no host path" };
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(configuredPath);
  } catch {
    return {
      ...base,
      hostPath: configuredPath,
      status: "untrusted",
      reason: "configured native host does not exist",
    };
  }

  // A host under the writable Codex cache must resolve within it (no symlink escape).
  if (
    withinCodexCache(configuredPath, runtime.codexHome) &&
    !withinCodexCache(resolvedPath, runtime.codexHome)
  ) {
    return {
      ...base,
      hostPath: resolvedPath,
      status: "untrusted",
      reason: "native host escapes the Codex cache root",
    };
  }

  const teamId = await hostTeamId(resolvedPath);
  if (teamId !== expectedOpenAiIdentity.teamId) {
    return {
      ...base,
      hostPath: resolvedPath,
      teamId,
      status: "untrusted",
      reason: "native host is not OpenAI-signed",
    };
  }

  return { ...base, hostPath: resolvedPath, teamId, status: "trusted" };
}

export async function inspectNativeHosts(runtime: DiscoveredRuntime): Promise<NativeHostResult[]> {
  const manifests = supportedNativeHostManifests(runtime.nativeHostName);
  return await Promise.all(manifests.map((manifest) => inspectNativeHost(manifest, runtime)));
}

// Launch-time guard: the browser executes whatever native host its manifest
// configures, so any present-but-untrusted manifest must abort the launch.
export async function assertNativeHostsTrusted(runtime: DiscoveredRuntime): Promise<void> {
  const results = await inspectNativeHosts(runtime);
  const untrusted = results.find((result) => result.status === "untrusted");
  if (untrusted) {
    throw new Error(
      `${untrusted.browser} native-messaging host is not trusted (${untrusted.reason ?? "verification failed"}): ${untrusted.hostPath ?? untrusted.manifestPath}`,
    );
  }
}
