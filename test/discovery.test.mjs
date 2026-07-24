import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findChatGptApp } from "../dist/discovery/app.js";

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
