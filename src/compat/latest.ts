// Reads OpenAI's public Sparkle feed for ChatGPT.app. OpenAI's browser extension
// updates from the Web Store on its own schedule, so an app that lags behind it
// can break browser commands with errors that do not name the cause.
const APPCAST_URL = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml";
const VERSION = /^\d+(\.\d+)+$/;

export interface AppcastBuild {
  version: string;
  url: string;
}

// Items are newest first; returns the newest one with a full arm64 zip.
export function parseNewestBuild(xml: string): AppcastBuild {
  for (const [, item = ""] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const version = /<sparkle:shortVersionString>([^<]+)</.exec(item)?.[1];
    const url = /<enclosure[^>]*\burl="([^"]+arm64[^"]*\.zip)"/.exec(item)?.[1];
    if (version && !VERSION.test(version)) {
      throw new Error(`Appcast has an unexpected version string: ${JSON.stringify(version)}`);
    }
    if (version && url) {
      return { version, url };
    }
  }
  throw new Error("Appcast has no ChatGPT.app build with an arm64 zip download");
}

export async function fetchNewestBuild(timeoutMs = 10_000): Promise<AppcastBuild> {
  const response = await fetch(APPCAST_URL, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Appcast request failed: HTTP ${response.status}`);
  }
  return parseNewestBuild(await response.text());
}

// Compares dotted numeric versions such as 26.1021.31345 and 26.1029.61003.
export function isOlderVersion(installed: string, newest: string): boolean {
  const a = installed.split(".").map(Number);
  const b = newest.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference < 0;
    }
  }
  return false;
}

export function outdatedAppNotice(installed: string, newest: string): string {
  return `ChatGPT.app ${installed} is older than the newest release ${newest}. OpenAI's browser extension updates on its own and can require a newer app. Update ChatGPT.app, open it once, then restart this MCP server.`;
}

const SUCCESS_CACHE_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 10 * 60 * 1000;

// Returns a cached lookup for a long-running bridge process: a successful feed
// read is reused for 24 hours, a failed one for 10 minutes, so a stalled feed
// delays at most one failed tool result by the short default timeout. Resolves
// to a notice when the installed app is outdated, otherwise to null.
export function createOutdatedAppCheck(
  installed: string,
  fetchNewest: () => Promise<AppcastBuild> = () => fetchNewestBuild(3_000),
  now: () => number = Date.now,
): () => Promise<string | null> {
  let cached: { until: number; notice: string | null } | undefined;
  return async () => {
    if (cached && now() < cached.until) {
      return cached.notice;
    }
    try {
      const { version } = await fetchNewest();
      const notice = isOlderVersion(installed, version)
        ? outdatedAppNotice(installed, version)
        : null;
      cached = { until: now() + SUCCESS_CACHE_MS, notice };
    } catch {
      cached = { until: now() + FAILURE_CACHE_MS, notice: null };
    }
    return cached.notice;
  };
}
