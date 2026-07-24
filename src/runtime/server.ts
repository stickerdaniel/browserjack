import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import { ensureBuildCompatible } from "../compat/ensure.js";
import { runLiveProbe } from "../doctor/live.js";
import { isJsonObject } from "../lib/json.js";
import { createRuntimeLaunch } from "./launch.js";
import { readLines } from "./lines.js";
import { createTurnState, injectTurnMetadata } from "./metadata.js";
import { RedactingTransform } from "./redact.js";

const MAX_MCP_LINE_BYTES = 16 * 1024 * 1024;

async function writeWithBackpressure(stream: NodeJS.WritableStream, value: string): Promise<void> {
  if (stream.write(value)) {
    return;
  }
  await once(stream, "drain");
}

function forwardSignal(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The child may already have exited.
  }
}

function addBrowserRuntimeInstructions(line: string, browserClientUrl: string): string {
  let message: unknown;
  try {
    message = JSON.parse(line) as unknown;
  } catch {
    return `${line}\n`;
  }
  if (!isJsonObject(message) || !isJsonObject(message.result)) {
    return `${line}\n`;
  }
  const instructions = message.result.instructions;
  if (typeof instructions !== "string") {
    return `${line}\n`;
  }

  const bridgeInstructions = [
    "This bridge uses OpenAI's verified browser client from:",
    browserClientUrl,
    "Import that exact URL and call setupBrowserRuntime({ globals: globalThis }) before using agent.browsers.",
  ].join(" ");

  return `${JSON.stringify({
    ...message,
    result: {
      ...message.result,
      instructions: `${instructions}\n\n${bridgeInstructions}`,
    },
  })}\n`;
}

async function forwardChildOutput(output: Readable, browserClientUrl: string): Promise<void> {
  for await (const line of readLines(output, MAX_MCP_LINE_BYTES)) {
    await writeWithBackpressure(
      process.stdout,
      addBrowserRuntimeInstructions(line, browserClientUrl),
    );
  }
}

export async function runBridge(appOverride?: string): Promise<number> {
  const launch = await createRuntimeLaunch(appOverride);
  const compatibility = await ensureBuildCompatible(launch.runtime, async () => {
    await runLiveProbe(appOverride);
  });
  if (compatibility.source === "self-test") {
    process.stderr.write(
      `browserjack: verified ChatGPT.app build ${launch.runtime.appVersion} via runtime self-test\n`,
    );
  }
  const child = spawn(launch.command, launch.args, {
    cwd: launch.runtime.codexHome,
    env: launch.env,
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const onSigint = (): void => forwardSignal(child.pid, "SIGINT");
  const onSigterm = (): void => forwardSignal(child.pid, "SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const browserClientUrl = pathToFileURL(launch.runtime.browserClientPath).href;
  let stdoutFailure: unknown;
  const stdoutForwarding = forwardChildOutput(child.stdout, browserClientUrl);
  void stdoutForwarding.catch((error: unknown) => {
    // A forwarding failure (e.g. an oversized MCP line) must tear down the child,
    // otherwise the bridge would linger with a dead stdout while the child runs.
    stdoutFailure = error;
    forwardSignal(child.pid, "SIGTERM");
  });
  const redactor = new RedactingTransform();
  child.stderr.pipe(redactor).pipe(process.stderr, { end: false });
  const stderrForwarding = finished(redactor);

  const state = createTurnState();
  let inputFailure: unknown;
  const inputForwarding = (async (): Promise<void> => {
    try {
      for await (const line of readLines(process.stdin, MAX_MCP_LINE_BYTES)) {
        await writeWithBackpressure(child.stdin, injectTurnMetadata(line, state));
      }
    } finally {
      child.stdin.end();
    }
  })();
  void inputForwarding.catch((error: unknown) => {
    inputFailure = error;
    forwardSignal(child.pid, "SIGTERM");
  });

  const exitEvent: unknown[] = await once(child, "exit");
  const code = typeof exitEvent[0] === "number" ? exitEvent[0] : null;
  const signal = typeof exitEvent[1] === "string" ? exitEvent[1] : null;
  process.stdin.pause();

  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);

  await Promise.allSettled([stdoutForwarding, stderrForwarding]);
  if (stdoutFailure) {
    throw stdoutFailure;
  }
  if (inputFailure) {
    throw inputFailure;
  }

  if (signal) {
    return 128 + (signal === "SIGINT" ? 2 : 15);
  }
  return code ?? 1;
}
