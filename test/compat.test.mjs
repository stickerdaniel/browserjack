import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertCompatible } from "../dist/compat/manifest.js";

const manifestPath = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "compatibility",
  "manifest.json",
);

async function supportedRuntime() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry = manifest.entries[0];
  return {
    bundleId: entry.bundleId,
    appVersion: entry.appVersion,
    pluginVersion: entry.pluginVersion,
    teamId: entry.teamId,
    architecture: entry.architectures[0],
    browserClientSha256: entry.browserClientSha256,
  };
}

test("accepts the exact bundled compatibility entry", async () => {
  const runtime = await supportedRuntime();
  const result = await assertCompatible(runtime);
  assert.equal(result.entry.appVersion, runtime.appVersion);
});

for (const [field, value] of [
  ["bundleId", "com.example.fake"],
  ["appVersion", "0.0.1"],
  ["pluginVersion", "0.0.1"],
  ["teamId", "AAAAAAAAAA"],
  ["architecture", "riscv64"],
  ["browserClientSha256", "0".repeat(64)],
]) {
  test(`fails closed on mismatched ${field}`, async () => {
    const runtime = await supportedRuntime();
    runtime[field] = value;
    await assert.rejects(assertCompatible(runtime), /Unsupported ChatGPT\.app build/);
  });
}

test("fails closed when the cached browser client diverges", async () => {
  const runtime = await supportedRuntime();
  runtime.cachedBrowserClientSha256 = "f".repeat(64);
  await assert.rejects(assertCompatible(runtime), /cached Chrome browser client differs/);
});

test("accepts a matching cached browser client", async () => {
  const runtime = await supportedRuntime();
  runtime.cachedBrowserClientSha256 = runtime.browserClientSha256;
  await assert.doesNotReject(assertCompatible(runtime));
});
