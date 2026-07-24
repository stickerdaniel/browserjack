import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isJsonObject } from "../lib/json.js";
import { installationPaths } from "../install/paths.js";
import type { DiscoveredRuntime } from "../discovery/types.js";

// Builds that passed the one-time runtime self-test on this machine. This is a
// compatibility record, not a security boundary: signatures and byte-identity
// are re-verified on every launch regardless of what is recorded here.
interface VerifiedBuild {
  appVersion: string;
  pluginVersion: string;
  architecture: string;
  browserClientSha256: string;
  verifiedAt: string;
}

type RuntimeKey = Pick<
  DiscoveredRuntime,
  "appVersion" | "pluginVersion" | "architecture" | "browserClientSha256"
>;

function storePath(): string {
  return join(installationPaths().root, "verified-builds.json");
}

function matches(build: VerifiedBuild, runtime: RuntimeKey): boolean {
  return (
    build.appVersion === runtime.appVersion &&
    build.pluginVersion === runtime.pluginVersion &&
    build.architecture === runtime.architecture &&
    build.browserClientSha256 === runtime.browserClientSha256
  );
}

async function readStore(): Promise<VerifiedBuild[]> {
  let raw: string;
  try {
    raw = await readFile(storePath(), "utf8");
  } catch {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!isJsonObject(value) || !Array.isArray(value.builds)) {
    return [];
  }
  return value.builds.filter(
    (build: unknown): build is VerifiedBuild =>
      isJsonObject(build) &&
      typeof build.appVersion === "string" &&
      typeof build.pluginVersion === "string" &&
      typeof build.architecture === "string" &&
      typeof build.browserClientSha256 === "string" &&
      typeof build.verifiedAt === "string",
  );
}

export async function findVerifiedBuild(runtime: RuntimeKey): Promise<VerifiedBuild | null> {
  const builds = await readStore();
  return builds.find((build) => matches(build, runtime)) ?? null;
}

export async function recordVerifiedBuild(runtime: RuntimeKey): Promise<void> {
  const path = storePath();
  await mkdir(installationPaths().root, { recursive: true, mode: 0o700 });
  const builds = (await readStore()).filter((build) => !matches(build, runtime));
  builds.push({
    appVersion: runtime.appVersion,
    pluginVersion: runtime.pluginVersion,
    architecture: runtime.architecture,
    browserClientSha256: runtime.browserClientSha256,
    verifiedAt: new Date().toISOString(),
  });
  const temporary = `${path}.next-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, builds }, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}
