// Checks the newest ChatGPT.app build from OpenAI's update feed against the
// built bridge (dist/), so a breaking app release surfaces before users hit it.
// Runs `doctor` with the downloaded bundle, ignoring native-host checks (CI has
// no browser), then the live cold-start probe. Writes a Markdown summary to
// $CHECK_REPORT, sets `version` and `outcome` (pass, breaks or error) in
// $GITHUB_OUTPUT, and exits 1 unless the build passes.
//
//   npm run build && node scripts/check-chatgpt-build.mjs
//   CHATGPT_APP_PATH=/Applications/ChatGPT.app node scripts/check-chatgpt-build.mjs
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const APPCAST = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml";
const root = join(import.meta.dirname, "..");
const run = promisify(execFile);

async function latestBuild() {
  const response = await fetch(APPCAST);
  if (!response.ok) {
    throw new Error(`Appcast request failed: HTTP ${response.status}`);
  }
  // Items are newest first; take the newest with a full arm64 zip.
  for (const [, item] of (await response.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const version = /<sparkle:shortVersionString>([^<]+)</.exec(item)?.[1];
    const url = /<enclosure[^>]*\burl="([^"]+arm64[^"]*\.zip)"/.exec(item)?.[1];
    if (version && !/^\d+(\.\d+)+$/.test(version)) {
      throw new Error(`Appcast has an unexpected version string: ${JSON.stringify(version)}`);
    }
    if (version && url) {
      return { version, url };
    }
  }
  throw new Error("Appcast has no ChatGPT.app build with an arm64 zip download");
}

async function downloadApp(url) {
  const dir = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "chatgpt-"));
  const zip = join(dir, "ChatGPT.zip");
  await run("/usr/bin/curl", ["--fail", "--silent", "--show-error", "--location", "-o", zip, url]);
  await run("/usr/bin/ditto", ["-x", "-k", zip, dir]);
  return join(dir, "ChatGPT.app");
}

async function doctor(appPath) {
  // doctor exits 2 when not ready; its JSON report is still on stdout.
  const result = await run(process.execPath, [
    join(root, "dist/cli.js"),
    "doctor",
    "--json",
    "--app",
    appPath,
  ]).catch((error) => error);
  return JSON.parse(result.stdout).checks;
}

async function liveProbe(appPath) {
  await mkdir(process.env.CODEX_HOME ?? join(homedir(), ".codex"), { recursive: true });
  const { runLiveProbe } = await import(join(root, "dist/doctor/live.js"));
  try {
    await runLiveProbe(appPath);
    return {
      id: "live",
      status: "pass",
      summary: "Fresh MCP startup initialized the OpenAI browser runtime",
    };
  } catch (error) {
    return {
      id: "live",
      status: "failure",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

async function output(values) {
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`);
    await appendFile(process.env.GITHUB_OUTPUT, lines.join(""));
  }
}

async function report(lines) {
  const text = lines.join("\n");
  console.log(text);
  if (process.env.CHECK_REPORT) {
    await writeFile(process.env.CHECK_REPORT, `${text}\n`);
  }
}

const local = process.env.CHATGPT_APP_PATH;
let build = { version: "unknown", url: "" };
try {
  build = local ? { version: "local", url: local } : await latestBuild();
  const appPath = local ?? (await downloadApp(build.url));
  const checks = (await doctor(appPath)).filter((check) => !check.id.startsWith("native-host"));
  // Discovery falls back to installed copies when --app does not resolve, so
  // confirm the report describes the bundle under test.
  const app = checks.find((check) => check.id === "chatgpt-app");
  if (app?.status === "pass" && app.details?.path !== (await realpath(appPath))) {
    throw new Error(`doctor inspected ${app.details?.path} instead of ${appPath}`);
  }
  if (checks.every((check) => check.status !== "failure")) {
    checks.push(await liveProbe(appPath));
  }

  const failed = checks.some((check) => check.status === "failure");
  await report([
    `ChatGPT.app ${build.version} ${failed ? "breaks" : "passes"} the Browserjack build check.`,
    "",
    ...checks.map((check) => `- ${check.status}: ${check.summary}`),
    "",
    `Download: ${build.url}`,
  ]);
  await output({ version: build.version, outcome: failed ? "breaks" : "pass" });
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  // A feed or download problem is not evidence that the build breaks Browserjack.
  await report([
    `The Browserjack build check could not evaluate ChatGPT.app ${build.version}.`,
    "",
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  ]);
  await output({ version: build.version, outcome: "error" });
  process.exitCode = 1;
}
