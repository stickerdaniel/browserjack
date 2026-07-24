import { access, lstat, readFile, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";

import { isJsonObject } from "../lib/json.js";
import { packageRoot } from "../lib/package-root.js";
import { inspectClaudeMcp } from "./mcp.js";
import { installationPaths } from "./paths.js";
import { readInstallState } from "./state.js";

export interface StatusCheck {
  id: string;
  status: "pass" | "warn" | "failure";
  summary: string;
}

export interface StatusReport {
  installed: boolean;
  healthy: boolean;
  installedVersion?: string;
  packageVersion: string;
  checks: StatusCheck[];
}

async function readOwnVersion(): Promise<string> {
  const path = join(packageRoot(import.meta.url), "package.json");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isJsonObject(value) || typeof value.version !== "string") {
    throw new TypeError(`${path} has no version`);
  }
  return value.version;
}

export async function collectStatus(): Promise<StatusReport> {
  const paths = installationPaths();
  const packageVersion = await readOwnVersion();
  const state = await readInstallState();
  const checks: StatusCheck[] = [];

  if (state === null) {
    return {
      installed: false,
      healthy: false,
      packageVersion,
      checks: [
        {
          id: "state",
          status: "failure",
          summary: `No installation state at ${paths.state}. Run browserjack setup.`,
        },
      ],
    };
  }

  checks.push({
    id: "state",
    status: "pass",
    summary: `Installed version ${state.version} (MCP ${state.mcpRegistered ? state.mcpName : "not registered"})`,
  });

  let healthy = true;

  try {
    const linkInfo = await lstat(paths.current);
    if (!linkInfo.isSymbolicLink()) {
      throw new Error(`${paths.current} is not a symlink`);
    }
    const target = await readlink(paths.current);
    const resolved = await realpath(paths.current);
    await access(join(resolved, "dist", "cli.js"));
    checks.push({
      id: "current",
      status: "pass",
      summary: `current -> ${target}`,
    });
  } catch (error) {
    healthy = false;
    checks.push({
      id: "current",
      status: "failure",
      summary: `Broken current release link: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  try {
    await access(paths.shim);
    checks.push({ id: "shim", status: "pass", summary: `Shim at ${paths.shim}` });
  } catch {
    healthy = false;
    checks.push({
      id: "shim",
      status: "failure",
      summary: `Missing shim at ${paths.shim}. Run browserjack setup.`,
    });
  }

  try {
    await access(state.nodePath);
    checks.push({
      id: "node",
      status: "pass",
      summary: `Shim Node.js at ${state.nodePath}`,
    });
  } catch {
    healthy = false;
    checks.push({
      id: "node",
      status: "failure",
      summary: `Shim Node.js path ${state.nodePath} no longer exists (Node was updated or removed). Run browserjack setup to repair.`,
    });
  }

  if (state.mcpRegistered) {
    try {
      const ownership = await inspectClaudeMcp(state.mcpName, paths.shim, state.registrationCwd);
      if (ownership === "owned") {
        checks.push({
          id: "mcp",
          status: "pass",
          summary: `Claude Code MCP server ${state.mcpName} (${state.mcpScope}) points at this installation`,
        });
      } else if (ownership === "absent") {
        healthy = false;
        checks.push({
          id: "mcp",
          status: "failure",
          summary: `Claude Code MCP server ${state.mcpName} is missing. Run browserjack setup.`,
        });
      } else {
        healthy = false;
        checks.push({
          id: "mcp",
          status: "failure",
          summary: `Claude Code MCP server ${state.mcpName} exists but no longer points at this installation.`,
        });
      }
    } catch (error) {
      checks.push({
        id: "mcp",
        status: "warn",
        summary: `Could not query Claude Code MCP registration: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (state.version !== packageVersion) {
    checks.push({
      id: "version",
      status: "warn",
      summary: `Installed ${state.version} differs from this package ${packageVersion}. Run browserjack update.`,
    });
  }

  return {
    installed: true,
    healthy,
    installedVersion: state.version,
    packageVersion,
    checks,
  };
}

export function printStatusReport(report: StatusReport): void {
  for (const check of report.checks) {
    const marker = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
    process.stdout.write(`${marker} ${check.summary}\n`);
  }
  process.stdout.write(`\n${report.installed && report.healthy ? "Healthy" : "Needs attention"}\n`);
}
