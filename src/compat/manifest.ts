import { join } from "node:path";

import { isJsonObject, readJsonFile, requireString } from "../lib/json.js";
import { packageRoot } from "../lib/package-root.js";
import type { DiscoveredRuntime } from "../discovery/types.js";

export interface CompatibilityEntry {
  bundleId: string;
  appVersion: string;
  pluginVersion: string;
  teamId: string;
  architectures: string[];
  browserClientSha256: string;
}

interface CompatibilityManifest {
  schemaVersion: 1;
  generatedAt: string;
  entries: CompatibilityEntry[];
}

function parseStringArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${source} must be an array of strings`);
  }
  return value;
}

function parseEntry(value: unknown, source: string): CompatibilityEntry {
  if (!isJsonObject(value)) {
    throw new Error(`${source} must be a JSON object`);
  }
  return {
    bundleId: requireString(value, "bundleId", source),
    appVersion: requireString(value, "appVersion", source),
    pluginVersion: requireString(value, "pluginVersion", source),
    teamId: requireString(value, "teamId", source),
    architectures: parseStringArray(value.architectures, `${source}.architectures`),
    browserClientSha256: requireString(value, "browserClientSha256", source),
  };
}

async function loadManifest(): Promise<CompatibilityManifest> {
  const path = join(packageRoot(import.meta.url), "compatibility", "manifest.json");
  const value = await readJsonFile(path);
  if (!isJsonObject(value) || value.schemaVersion !== 1) {
    throw new Error(`${path} has an unsupported schema`);
  }
  if (!Array.isArray(value.entries)) {
    throw new TypeError(`${path} is missing entries`);
  }
  return {
    schemaVersion: 1,
    generatedAt: requireString(value, "generatedAt", path),
    entries: value.entries.map((entry, index) => parseEntry(entry, `${path}.entries[${index}]`)),
  };
}

// Security check, independent of any build knowledge: the cached client in the
// writable Codex cache must be byte-identical to the one inside the verified,
// signed app bundle. This holds for every build, known or not.
export function assertCachedClientConsistent(
  runtime: Pick<DiscoveredRuntime, "browserClientSha256" | "cachedBrowserClientSha256">,
): void {
  if (
    runtime.cachedBrowserClientSha256 &&
    runtime.cachedBrowserClientSha256 !== runtime.browserClientSha256
  ) {
    throw new Error(
      "The cached Chrome browser client differs from the verified ChatGPT.app client",
    );
  }
}

export async function findCompatibilityEntry(
  runtime: Pick<
    DiscoveredRuntime,
    "bundleId" | "appVersion" | "pluginVersion" | "teamId" | "architecture" | "browserClientSha256"
  >,
): Promise<CompatibilityEntry | null> {
  const manifest = await loadManifest();
  return (
    manifest.entries.find(
      (candidate) =>
        candidate.bundleId === runtime.bundleId &&
        candidate.appVersion === runtime.appVersion &&
        candidate.pluginVersion === runtime.pluginVersion &&
        candidate.teamId === runtime.teamId &&
        candidate.architectures.includes(runtime.architecture) &&
        candidate.browserClientSha256 === runtime.browserClientSha256,
    ) ?? null
  );
}
