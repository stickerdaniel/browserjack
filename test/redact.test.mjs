import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { RedactingTransform } from "../dist/runtime/redact.js";

async function transform(value) {
  const redactor = new RedactingTransform();
  let output = "";
  redactor.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  redactor.end(value);
  await once(redactor, "end");
  return output;
}

test("redacts common token forms", async () => {
  assert.equal(
    await transform("Authorization: Bearer secret-value\napi_key=abc123\n"),
    "Authorization: [REDACTED]\napi_key=[REDACTED]\n",
  );
});

test("redacts quoted JSON secret values", async () => {
  const output = await transform('{"api_key":"abc123","access_token":"xyz"}\n');
  assert.doesNotMatch(output, /abc123/);
  assert.doesNotMatch(output, /xyz/);
  assert.match(output, /"api_key":"\[REDACTED\]"/);
  assert.match(output, /"access_token":"\[REDACTED\]"/);
});

test("does not leak a secret split across chunks", async () => {
  const redactor = new RedactingTransform();
  let output = "";
  redactor.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  redactor.write("Authorization: Bearer sec");
  redactor.write("ret-tail\n");
  redactor.end();
  await once(redactor, "end");
  assert.doesNotMatch(output, /secret-tail/);
  assert.match(output, /Authorization: \[REDACTED\]/);
});

test("flushes a bounded pending buffer without a trailing newline", async () => {
  const redactor = new RedactingTransform();
  let bytes = 0;
  redactor.on("data", (chunk) => {
    bytes += chunk.length;
  });
  redactor.write("x".repeat(200 * 1024));
  redactor.end();
  await once(redactor, "end");
  assert.ok(bytes > 0);
});
