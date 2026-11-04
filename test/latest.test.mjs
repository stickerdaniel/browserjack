import assert from "node:assert/strict";
import test from "node:test";

import { createOutdatedAppCheck, isOlderVersion, parseNewestBuild } from "../dist/compat/latest.js";
import { annotateToolError } from "../dist/runtime/tool-errors.js";

// Trimmed from OpenAI's appcast on 2026-11-04; the first item is cut down to
// its delta enclosure to exercise the full-zip requirement.
const appcast = `<rss><channel>
<item>
  <sparkle:shortVersionString>26.1030.10000</sparkle:shortVersionString>
  <sparkle:deltas>
    <enclosure url="https://persistent.oaistatic.com/codex-app-prod/ChatGPT24700-24614-arm64.delta" sparkle:deltaFrom="24614" />
  </sparkle:deltas>
</item>
<item>
  <title>26.1029.61003</title>
  <sparkle:version>24614</sparkle:version>
  <sparkle:shortVersionString>26.1029.61003</sparkle:shortVersionString>
  <enclosure url="https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-arm64-26.1029.61003.zip" length="813396380" type="application/octet-stream" />
</item>
</channel></rss>`;

// The js tool result a goto produced on ChatGPT.app 26.1021 with extension 1.26.1102.
const failedToolLine = JSON.stringify({
  jsonrpc: "2.0",
  id: 3,
  result: {
    content: [{ type: "text", text: "Cannot read properties of undefined (reading 'timeoutMs')" }],
    isError: true,
  },
});

test("takes the newest feed item that has a full arm64 zip", () => {
  assert.deepEqual(parseNewestBuild(appcast), {
    version: "26.1029.61003",
    url: "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-arm64-26.1029.61003.zip",
  });
});

test("compares app versions numerically per component", () => {
  assert.equal(isOlderVersion("26.1021.31345", "26.1029.61003"), true);
  assert.equal(isOlderVersion("26.924.22138", "26.1016.61520"), true);
  assert.equal(isOlderVersion("26.1029.61003", "26.1029.61003"), false);
  assert.equal(isOlderVersion("26.1029.61003", "26.1021.31345"), false);
});

test("names the newer release when the installed app is outdated", async () => {
  const check = createOutdatedAppCheck("26.1021.31345", async () => parseNewestBuild(appcast));
  assert.match(
    (await check()) ?? "",
    /26\.1021\.31345 is older than the newest release 26\.1029\.61003/,
  );
  assert.equal(
    await createOutdatedAppCheck("26.1029.61003", async () => parseNewestBuild(appcast))(),
    null,
  );
});

test("reads the feed once per day and retries a failure after ten minutes", async () => {
  const minute = 60 * 1000;
  let clock = 0;
  let calls = 0;
  const check = createOutdatedAppCheck(
    "26.1021.31345",
    async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("offline");
      }
      return parseNewestBuild(appcast);
    },
    () => clock,
  );
  assert.equal(await check(), null);
  clock = 9 * minute;
  assert.equal(await check(), null);
  assert.equal(calls, 1);
  clock = 10 * minute;
  assert.notEqual(await check(), null);
  clock = 23 * 60 * minute;
  await check();
  assert.equal(calls, 2);
  clock = 10 * minute + 24 * 60 * minute;
  await check();
  assert.equal(calls, 3);
});

test("appends the notice to a failed tool result", async () => {
  const line = await annotateToolError(failedToolLine, async () => "Update ChatGPT.app.");
  const { result } = JSON.parse(line ?? "null");
  assert.equal(result.isError, true);
  assert.deepEqual(result.content.at(-1), {
    type: "text",
    text: "browserjack: Update ChatGPT.app.",
  });
  assert.equal(result.content[0].text, "Cannot read properties of undefined (reading 'timeoutMs')");
});

const unexpectedNotice = async () => assert.fail("notice must not be looked up");

test("leaves successful results alone without looking up a notice", async () => {
  const success = JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    result: { content: [], isError: false },
  });
  assert.equal(await annotateToolError(success, unexpectedNotice), null);
  assert.equal(await annotateToolError("not json", unexpectedNotice), null);
  assert.equal(await annotateToolError(failedToolLine, async () => null), null);
});
