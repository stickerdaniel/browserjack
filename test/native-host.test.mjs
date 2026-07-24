import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectNativeHost } from "../dist/discovery/native-host.js";

const EXTENSION_ID = "hehggadaopoacecdllhhajmbjkdcmajg";
const HOST_NAME = "com.openai.codexextension";

function runtime(codexHome) {
  return {
    extensionId: EXTENSION_ID,
    nativeHostName: HOST_NAME,
    codexHome,
  };
}

async function writeManifest(dir, body) {
  const manifestPath = join(dir, `${HOST_NAME}.json`);
  await writeFile(manifestPath, JSON.stringify(body));
  return manifestPath;
}

test("absent manifest yields absent status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserjack-nh-"));
  const result = await inspectNativeHost(
    { browser: "Helium", manifestPath: join(dir, "missing.json") },
    runtime(dir),
  );
  assert.equal(result.status, "absent");
});

test("wrong native-host name is untrusted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserjack-nh-"));
  const manifestPath = await writeManifest(dir, {
    name: "com.evil.host",
    path: join(dir, "host"),
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  });
  const result = await inspectNativeHost({ browser: "Helium", manifestPath }, runtime(dir));
  assert.equal(result.status, "untrusted");
  assert.match(result.reason, /name/);
});

test("missing extension origin is untrusted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserjack-nh-"));
  const manifestPath = await writeManifest(dir, {
    name: HOST_NAME,
    path: join(dir, "host"),
    allowed_origins: ["chrome-extension://someoneelse/"],
  });
  const result = await inspectNativeHost({ browser: "Helium", manifestPath }, runtime(dir));
  assert.equal(result.status, "untrusted");
  assert.match(result.reason, /origin/);
});

test("a nonexistent configured host is untrusted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserjack-nh-"));
  const manifestPath = await writeManifest(dir, {
    name: HOST_NAME,
    path: join(dir, "does-not-exist"),
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  });
  const result = await inspectNativeHost({ browser: "Helium", manifestPath }, runtime(dir));
  assert.equal(result.status, "untrusted");
  assert.match(result.reason, /does not exist/);
});

test("a cached host escaping the cache root is untrusted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserjack-nh-"));
  const codexHome = join(dir, "codex");
  const cacheDir = join(codexHome, "plugins", "cache", "openai-bundled", "chrome");
  await mkdir(cacheDir, { recursive: true });

  // A real binary outside the cache, reached via a symlink inside the cache.
  const outsideHost = join(dir, "outside-host");
  await writeFile(outsideHost, "#!/bin/sh\n");
  const escapingLink = join(cacheDir, "host");
  await symlink(outsideHost, escapingLink);

  const manifestPath = await writeManifest(dir, {
    name: HOST_NAME,
    path: escapingLink,
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  });
  const result = await inspectNativeHost({ browser: "Helium", manifestPath }, runtime(codexHome));
  assert.equal(result.status, "untrusted");
  assert.match(result.reason, /escapes the Codex cache root/);
});
