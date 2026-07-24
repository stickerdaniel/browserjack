import { findCompatibilityEntry } from "./manifest.js";
import { findVerifiedBuild, recordVerifiedBuild } from "./verified.js";
import type { DiscoveredRuntime } from "../discovery/types.js";

export type BuildTrustSource = "manifest" | "verified-store" | "self-test";

export interface BuildCompatibility {
  source: BuildTrustSource;
  verifiedAt?: string;
}

// Establishes that this exact build (version + plugin + arch + client hash)
// works with the bridge. Order: shipped manifest, then the local record of
// past self-tests, then a live self-test of the runtime handshake. The
// self-test runs at most once per build; signatures and cache byte-identity
// are enforced on every launch independently of this.
export async function ensureBuildCompatible(
  runtime: DiscoveredRuntime,
  selfTest: () => Promise<void>,
): Promise<BuildCompatibility> {
  if (await findCompatibilityEntry(runtime)) {
    return { source: "manifest" };
  }

  const verified = await findVerifiedBuild(runtime);
  if (verified) {
    return { source: "verified-store", verifiedAt: verified.verifiedAt };
  }

  try {
    await selfTest();
  } catch (error) {
    throw new Error(
      `ChatGPT.app build ${runtime.appVersion} failed the runtime self-test: ${
        error instanceof Error ? error.message : String(error)
      }. OpenAI may have changed the interface; check for a Browserjack update.`,
      { cause: error },
    );
  }
  await recordVerifiedBuild(runtime);
  return { source: "self-test" };
}
