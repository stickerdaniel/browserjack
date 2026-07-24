import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { DiscoveredRuntime } from "../discovery/types.js";
import { isJsonObject } from "../lib/json.js";
import { packageRoot } from "../lib/package-root.js";
import { createRuntimeLaunch } from "../runtime/launch.js";
import { readLines } from "../runtime/lines.js";

const TIMEOUT_MS = 30_000;

async function packageVersion(): Promise<string> {
  const raw: unknown = JSON.parse(
    await readFile(join(packageRoot(import.meta.url), "package.json"), "utf8"),
  );
  return isJsonObject(raw) && typeof raw.version === "string" ? raw.version : "unknown";
}

function rpc(id: number, method: string, params: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

export async function runLiveProbe(appOverride?: string): Promise<DiscoveredRuntime> {
  const launch = await createRuntimeLaunch(appOverride);
  const browserClientUrl = pathToFileURL(launch.runtime.browserClientPath).href;
  const child = spawn(launch.command, launch.args, {
    cwd: launch.runtime.codexHome,
    env: launch.env,
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const timer = setTimeout(() => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The probe may already have completed.
      }
    }
  }, TIMEOUT_MS);

  try {
    child.stdin.write(
      rpc(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "browserjack-doctor",
          version: await packageVersion(),
        },
      }),
    );

    const sessionId = `bridge-doctor-${randomUUID()}`;
    let initialized = false;
    let toolsListed = false;
    let browserConnected = false;

    for await (const line of readLines(child.stdout, 4 * 1024 * 1024)) {
      let message: unknown;
      try {
        message = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isJsonObject(message)) {
        continue;
      }
      const record = message;
      if (record.id === 1) {
        initialized = true;
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {},
          })}\n`,
        );
        child.stdin.write(rpc(2, "tools/list", {}));
        continue;
      }
      if (record.id === 2) {
        const result = isJsonObject(record.result) ? record.result : undefined;
        const tools = Array.isArray(result?.tools) ? result.tools : [];
        toolsListed = tools.some((tool: unknown) => isJsonObject(tool) && tool.name === "js");
        if (!toolsListed) {
          break;
        }

        child.stdin.write(
          rpc(3, "tools/call", {
            name: "js",
            arguments: {
              code: `var bridgeDoctorClient = await import(${JSON.stringify(
                browserClientUrl,
              )}); await bridgeDoctorClient.setupBrowserRuntime({ globals: globalThis }); var bridgeDoctorBackends = await agent.browsers.list(); bridgeDoctorBackends.length`,
              title: "Verify browser runtime",
            },
            _meta: {
              "x-codex-turn-metadata": {
                installation_id: sessionId,
                session_id: sessionId,
                thread_id: sessionId,
                turn_id: "turn-1",
                request_kind: "agent",
                turn_started_at_unix_ms: Date.now(),
              },
            },
          }),
        );
        continue;
      }
      if (record.id === 3) {
        const result = isJsonObject(record.result) ? record.result : undefined;
        if (record.error !== undefined || result?.isError === true) {
          throw new Error("OpenAI browser runtime handshake failed");
        }
        browserConnected = true;
        break;
      }
    }

    if (!initialized || !toolsListed || !browserConnected) {
      throw new Error("Cold-start probe did not initialize the OpenAI browser runtime");
    }
    return launch.runtime;
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The process may already have exited.
      }
    }
  }
}
