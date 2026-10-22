// Checks the newest ChatGPT.app build from OpenAI's update feed against the
// built bridge (dist/), so a breaking app release surfaces before users hit it.
// Runs `doctor` with the downloaded bundle, ignoring native-host checks (CI has
// no browser), then the live cold-start probe. Builds already in the bundled
// compatibility manifest are skipped unless FORCE_CHECK is set. Writes a Markdown summary to
// $CHECK_REPORT and sets `version` and `failed` in $GITHUB_OUTPUT.
//
//   npm run build && node scripts/check-chatgpt-build.mjs
//   CHATGPT_APP_PATH=/Applications/ChatGPT.app node scripts/check-chatgpt-build.mjs
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const item = /<item>([\s\S]*?)<\/item>/.exec(await response.text())?.[1] ?? "";
  const version = /<sparkle:shortVersionString>([^<]+)</.exec(item)?.[1];
  const url = /<enclosure[^>]*\burl="([^"]+\.zip)"/.exec(item)?.[1];
  if (!version || !url) {
    throw new Error("Appcast has no ChatGPT.app build with a zip download");
  }
  return { version, url };
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

const manifest = JSON.parse(await readFile(join(root, "compatibility/manifest.json"), "utf8"));
const local = process.env.CHATGPT_APP_PATH;
const build = local ? { version: "local", url: local } : await latestBuild();

if (
  !local &&
  !process.env.FORCE_CHECK &&
  manifest.entries.some((entry) => entry.appVersion === build.version)
) {
  console.log(`ChatGPT.app ${build.version} is already in the compatibility manifest`);
  await output({ version: build.version, failed: false });
  process.exit(0);
}

const appPath = local ?? (await downloadApp(build.url));
const checks = (await doctor(appPath)).filter((check) => !check.id.startsWith("native-host"));
const discovered = checks.every((check) => check.status !== "failure");
if (discovered) {
  checks.push(await liveProbe(appPath));
}

const failed = checks.some((check) => check.status === "failure");
const report = [
  `ChatGPT.app ${build.version} ${failed ? "breaks" : "passes"} the Browserjack build check.`,
  "",
  ...checks.map((check) => `- ${check.status}: ${check.summary}`),
  "",
  `Download: ${build.url}`,
].join("\n");
console.log(report);
if (process.env.CHECK_REPORT) {
  await writeFile(process.env.CHECK_REPORT, `${report}\n`);
}
await output({ version: build.version, failed });
