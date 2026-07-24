#!/usr/bin/env node

import { runDoctor, printDoctorReport } from "./doctor/checks.js";
import { runLiveProbe } from "./doctor/live.js";
import { setupBridge } from "./install/setup.js";
import { collectStatus, printStatusReport } from "./install/status.js";
import { uninstallBridge } from "./install/uninstall.js";
import { updateBridge } from "./install/update.js";
import { runBridge } from "./runtime/server.js";

const HELP = `browserjack

Usage:
  browserjack run
  browserjack doctor [--json] [--live]
  browserjack status [--json]
  browserjack setup [--client claude|plugin] [--scope user|local|project] [--mcp-name NAME]
  browserjack update
  browserjack uninstall [--keep-state]

Options:
  --app PATH             Use a specific ChatGPT.app bundle (run and doctor)

Environment:
  CHATGPT_APP_PATH       Override ChatGPT.app discovery
  CODEX_HOME             Override ~/.codex
  BROWSERJACK_HOME            Override the installation root
`;

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function parseScope(value: string | undefined): "user" | "local" | "project" {
  if (!value) {
    return "user";
  }
  if (value === "user" || value === "local" || value === "project") {
    return value;
  }
  throw new Error(`Invalid scope ${value}`);
}

async function main(): Promise<number> {
  const [command = "help", ...args] = process.argv.slice(2);
  const appOverride = valueAfter(args, "--app");

  switch (command) {
    case "run":
      return await runBridge(appOverride);
    case "doctor": {
      const report = await runDoctor(appOverride);
      if (args.includes("--live") && report.ready) {
        try {
          await runLiveProbe(appOverride);
          report.checks.push({
            id: "live",
            status: "pass",
            summary: "Fresh MCP startup initialized the OpenAI browser runtime",
          });
        } catch (error) {
          report.ready = false;
          report.checks.push({
            id: "live",
            status: "failure",
            summary: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (args.includes("--json")) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        printDoctorReport(report);
      }
      return report.ready ? 0 : 2;
    }
    case "setup": {
      const client = valueAfter(args, "--client") ?? "claude";
      if (client !== "claude" && client !== "plugin") {
        throw new Error(`Invalid client ${client}`);
      }
      const result = await setupBridge({
        scope: parseScope(valueAfter(args, "--scope")),
        mcpName: valueAfter(args, "--mcp-name") ?? "browserjack",
        registerMcp: client === "claude",
      });
      process.stdout.write(
        `Installed ${result.version}\nRuntime: ${result.releasePath}\nMCP: ${result.mcp}\n`,
      );
      return 0;
    }
    case "status": {
      const report = await collectStatus();
      if (args.includes("--json")) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        printStatusReport(report);
      }
      return report.installed && report.healthy ? 0 : 2;
    }
    case "update": {
      const result = await updateBridge();
      process.stdout.write(
        result.previousVersion === result.version
          ? `Already on ${result.version}\nRuntime: ${result.releasePath}\n`
          : `Updated ${result.previousVersion} -> ${result.version}\nRuntime: ${result.releasePath}\n`,
      );
      return 0;
    }
    case "uninstall":
      await uninstallBridge(args.includes("--keep-state"));
      process.stdout.write("Uninstalled browserjack\n");
      return 0;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      throw new Error(`Unknown command ${command}\n\n${HELP}`);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`browserjack: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
