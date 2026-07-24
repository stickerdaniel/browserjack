import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { readLines } from "../dist/runtime/lines.js";

async function collect(input, maximum = 1024) {
  const lines = [];
  for await (const line of readLines(Readable.from(input), maximum)) {
    lines.push(line);
  }
  return lines;
}

test("reads lines across chunk boundaries", async () => {
  assert.deepEqual(await collect([Buffer.from("one\ntw"), Buffer.from("o\nthree")]), [
    "one",
    "two",
    "three",
  ]);
});

test("rejects oversized lines", async () => {
  await assert.rejects(collect([Buffer.from("12345")], 4), /exceeds 4 bytes/);
});
