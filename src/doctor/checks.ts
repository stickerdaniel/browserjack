import { assertCachedClientConsistent, findCompatibilityEntry } from "../compat/manifest.js";
import { findVerifiedBuild } from "../compat/verified.js";
import { discoverRuntime } from "../discovery/app.js";
import { inspectNativeHosts } from "../discovery/native-host.js";
import type { DiscoveredRuntime } from "../discovery/types.js";

export type CheckStatus = "pass" | "warning" | "failure";

export interface CheckResult {
  id: string;
  status: CheckStatus;
  summary: string;
  details?: Record<string, unknown>;
  remediation?: string;
}

export interface DoctorReport {
  ready: boolean;
  checks: CheckResult[];
}

function slug(browser: string): string {
  return `native-host-${browser.toLowerCase().replaceAll(" ", "-")}`;
}

async function nativeManifestChecks(runtime: DiscoveredRuntime): Promise<CheckResult[]> {
  const results = await inspectNativeHosts(runtime);
  const checks: CheckResult[] = results.map((result) => {
    if (result.status === "absent") {
      return {
        id: slug(result.browser),
        status: "warning",
        summary: `${result.browser} has no ${runtime.nativeHostName} manifest`,
        details: { path: result.manifestPath },
      };
    }
    if (result.status === "trusted") {
      return {
        id: slug(result.browser),
        status: "pass",
        summary: `${result.browser} uses an OpenAI-signed native host`,
        details: { path: result.manifestPath, hostPath: result.hostPath, teamId: result.teamId },
      };
    }
    return {
      id: slug(result.browser),
      status: "failure",
      summary: `${result.browser} native host is not trusted: ${result.reason ?? "verification failed"}`,
      details: {
        path: result.manifestPath,
        hostPath: result.hostPath,
        teamId: result.teamId,
      },
    };
  });

  if (results.length > 0 && results.every((result) => result.status === "absent")) {
    checks.push({
      id: "native-host",
      status: "failure",
      summary: `No supported browser has the ${runtime.nativeHostName} native host installed`,
      remediation:
        "Install the ChatGPT/Codex extension in Chrome or Helium, then run doctor again.",
    });
  }

  return checks;
}

export async function runDoctor(appOverride?: string): Promise<DoctorReport> {
  const checks: CheckResult[] = [
    {
      id: "platform",
      status: process.platform === "darwin" ? "pass" : "failure",
      summary:
        process.platform === "darwin"
          ? `macOS ${process.arch} is supported`
          : `Unsupported platform ${process.platform}`,
    },
    {
      id: "node",
      status: Number(process.versions.node.split(".")[0]) >= 22 ? "pass" : "failure",
      summary: `Node.js ${process.versions.node}`,
      details: { executable: process.execPath },
    },
  ];

  try {
    const runtime = await discoverRuntime(appOverride);
    checks.push({
      id: "chatgpt-app",
      status: "pass",
      summary: `ChatGPT.app ${runtime.appVersion} is signed by OpenAI`,
      details: {
        path: runtime.appPath,
        bundleId: runtime.bundleId,
        buildVersion: runtime.buildVersion,
        teamId: runtime.teamId,
      },
    });
    checks.push({
      id: "runtime",
      status: "pass",
      summary: "OpenAI Codex and node_repl runtime resources are present",
      details: {
        codex: runtime.codexPath,
        nodeRepl: runtime.nodeReplPath,
        chromePlugin: runtime.chromePluginPath,
        nativeHost: runtime.nativeHostPath,
      },
    });

    try {
      assertCachedClientConsistent(runtime);
      checks.push({
        id: "cache-integrity",
        status: "pass",
        summary: "Cached browser client matches the verified ChatGPT.app client",
        details: { browserClientSha256: runtime.browserClientSha256 },
      });
    } catch (error) {
      checks.push({
        id: "cache-integrity",
        status: "failure",
        summary: error instanceof Error ? error.message : String(error),
        remediation:
          "The writable Codex cache diverges from the signed app bundle. Remove the cache or reinstall ChatGPT.app.",
      });
    }

    if (await findCompatibilityEntry(runtime)) {
      checks.push({
        id: "compatibility",
        status: "pass",
        summary: `ChatGPT.app ${runtime.appVersion} is covered by the bundled compatibility manifest`,
        details: {
          pluginVersion: runtime.pluginVersion,
          browserClientSha256: runtime.browserClientSha256,
        },
      });
    } else {
      const verified = await findVerifiedBuild(runtime);
      checks.push(
        verified
          ? {
              id: "compatibility",
              status: "pass",
              summary: `ChatGPT.app ${runtime.appVersion} passed the runtime self-test on this machine`,
              details: { verifiedAt: verified.verifiedAt },
            }
          : {
              id: "compatibility",
              status: "warning",
              summary: `ChatGPT.app ${runtime.appVersion} is not yet verified; the first run performs a one-time self-test`,
              details: {
                pluginVersion: runtime.pluginVersion,
                browserClientSha256: runtime.browserClientSha256,
              },
              remediation: "Run doctor --live to verify this build now.",
            },
      );
    }

    checks.push(...(await nativeManifestChecks(runtime)));
  } catch (error) {
    checks.push({
      id: "chatgpt-app",
      status: "failure",
      summary: error instanceof Error ? error.message : String(error),
      remediation: "Install or update the official ChatGPT.app, then run doctor again.",
    });
  }

  return {
    ready: checks.every((check) => check.status !== "failure"),
    checks,
  };
}

export function printDoctorReport(report: DoctorReport): void {
  for (const check of report.checks) {
    const marker = check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "✗";
    process.stdout.write(`${marker} ${check.summary}\n`);
    if (check.remediation) {
      process.stdout.write(`  ${check.remediation}\n`);
    }
  }
  process.stdout.write(`\n${report.ready ? "Ready" : "Not ready"}\n`);
}
