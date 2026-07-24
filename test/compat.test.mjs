import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureBuildCompatible } from "../dist/compat/ensure.js";
import { assertCachedClientConsistent, findCompatibilityEntry } from "../dist/compat/manifest.js";
import { findVerifiedBuild, recordVerifiedBuild } from "../dist/compat/verified.js";

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

async function withTemporaryHome(t) {
  const home = await mkdtemp(join(tmpdir(), "bj-verified-"));
  const previous = process.env.BROWSERJACK_HOME;
  process.env.BROWSERJACK_HOME = home;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.BROWSERJACK_HOME;
    } else {
      process.env.BROWSERJACK_HOME = previous;
    }
  });
  return home;
}

test("finds the exact bundled compatibility entry", async () => {
  const runtime = await supportedRuntime();
  const entry = await findCompatibilityEntry(runtime);
  assert.equal(entry?.appVersion, runtime.appVersion);
});

for (const [field, value] of [
  ["bundleId", "com.example.fake"],
  ["appVersion", "0.0.1"],
  ["pluginVersion", "0.0.1"],
  ["teamId", "AAAAAAAAAA"],
  ["architecture", "riscv64"],
  ["browserClientSha256", "0".repeat(64)],
]) {
  test(`does not match the manifest on mismatched ${field}`, async () => {
    const runtime = await supportedRuntime();
    runtime[field] = value;
    assert.equal(await findCompatibilityEntry(runtime), null);
  });
}

test("fails closed when the cached browser client diverges", async () => {
  const runtime = await supportedRuntime();
  runtime.cachedBrowserClientSha256 = "f".repeat(64);
  assert.throws(() => assertCachedClientConsistent(runtime), /cached Chrome browser client/);
});

test("accepts a matching cached browser client", async () => {
  const runtime = await supportedRuntime();
  runtime.cachedBrowserClientSha256 = runtime.browserClientSha256;
  assert.doesNotThrow(() => assertCachedClientConsistent(runtime));
});

test("verified-build store round-trips and self-test runs once per build", async (t) => {
  await withTemporaryHome(t);
  const unknown = {
    ...(await supportedRuntime()),
    appVersion: "99.1.1",
    pluginVersion: "99.1.1",
    browserClientSha256: "a".repeat(64),
  };

  assert.equal(await findVerifiedBuild(unknown), null);

  let selfTests = 0;
  const first = await ensureBuildCompatible(unknown, async () => {
    selfTests += 1;
  });
  assert.equal(first.source, "self-test");
  assert.equal(selfTests, 1);

  const second = await ensureBuildCompatible(unknown, async () => {
    selfTests += 1;
  });
  assert.equal(second.source, "verified-store");
  assert.equal(selfTests, 1);

  const stored = await findVerifiedBuild(unknown);
  assert.equal(stored?.appVersion, "99.1.1");
});

test("manifest-covered builds skip the self-test entirely", async (t) => {
  await withTemporaryHome(t);
  const runtime = await supportedRuntime();
  const result = await ensureBuildCompatible(runtime, async () => {
    throw new Error("self-test must not run for manifest builds");
  });
  assert.equal(result.source, "manifest");
});

test("a failing self-test blocks the build and records nothing", async (t) => {
  await withTemporaryHome(t);
  const unknown = {
    ...(await supportedRuntime()),
    appVersion: "99.2.2",
    browserClientSha256: "b".repeat(64),
  };

  await assert.rejects(
    ensureBuildCompatible(unknown, async () => {
      throw new Error("handshake failed");
    }),
    /failed the runtime self-test/,
  );
  assert.equal(await findVerifiedBuild(unknown), null);
});

test("recordVerifiedBuild replaces an existing entry for the same build", async (t) => {
  const home = await withTemporaryHome(t);
  const runtime = {
    ...(await supportedRuntime()),
    appVersion: "99.3.3",
    browserClientSha256: "c".repeat(64),
  };
  await recordVerifiedBuild(runtime);
  await recordVerifiedBuild(runtime);

  const raw = JSON.parse(await readFile(join(home, "verified-builds.json"), "utf8"));
  assert.equal(raw.builds.filter((b) => b.appVersion === "99.3.3").length, 1);
});
