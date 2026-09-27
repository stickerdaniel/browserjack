import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findChatGptApp, readExtensionMetadata } from "../dist/discovery/app.js";

async function pluginWith(file, body) {
  const plugin = await mkdtemp(join(tmpdir(), "browserjack-plugin-"));
  await mkdir(join(plugin, "scripts"));
  await writeFile(join(plugin, "scripts", file), JSON.stringify(body));
  return plugin;
}

test("reads every extension ID from extension-ids.json", async () => {
  const plugin = await pluginWith("extension-ids.json", {
    extensionIds: ["hehggadaopoacecdllhhajmbjkdcmajg", "odlomjlbamekndcpllcnffbgeohgkmjh"],
    extensionHostName: "com.openai.codexextension",
  });
  assert.deepEqual(await readExtensionMetadata(plugin), {
    extensionIds: ["hehggadaopoacecdllhhajmbjkdcmajg", "odlomjlbamekndcpllcnffbgeohgkmjh"],
    extensionHostName: "com.openai.codexextension",
  });
});

test("falls back to the legacy extension-id.json", async () => {
  const plugin = await pluginWith("extension-id.json", {
    extensionId: "hehggadaopoacecdllhhajmbjkdcmajg",
    extensionHostName: "com.openai.codexextension",
  });
  assert.deepEqual((await readExtensionMetadata(plugin)).extensionIds, [
    "hehggadaopoacecdllhhajmbjkdcmajg",
  ]);
});

test("rejects an empty extensionIds array", async () => {
  const plugin = await pluginWith("extension-ids.json", {
    extensionIds: [],
    extensionHostName: "com.openai.codexextension",
  });
  await assert.rejects(readExtensionMetadata(plugin), /extensionIds/);
});

test("prefers the explicit override over the environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "browserjack-discovery-"));
  const overrideApp = join(root, "Override.app");
  const envApp = join(root, "Env.app");
  await mkdir(overrideApp);
  await mkdir(envApp);

  const previous = process.env.CHATGPT_APP_PATH;
  process.env.CHATGPT_APP_PATH = envApp;
  try {
    assert.equal(await findChatGptApp(overrideApp), await realpath(overrideApp));
    assert.equal(await findChatGptApp(), await realpath(envApp));
  } finally {
    if (previous === undefined) {
      delete process.env.CHATGPT_APP_PATH;
    } else {
      process.env.CHATGPT_APP_PATH = previous;
    }
  }
});

test("falls back past a missing override to the environment candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "browserjack-discovery-"));
  const envApp = join(root, "Env.app");
  await mkdir(envApp);

  const previous = process.env.CHATGPT_APP_PATH;
  process.env.CHATGPT_APP_PATH = envApp;
  try {
    assert.equal(await findChatGptApp(join(root, "DoesNotExist.app")), await realpath(envApp));
  } finally {
    if (previous === undefined) {
      delete process.env.CHATGPT_APP_PATH;
    } else {
      process.env.CHATGPT_APP_PATH = previous;
    }
  }
});
