import type { Readable } from "node:stream";

export async function* readLines(input: Readable, maxLineBytes: number): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);

  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    pending = Buffer.concat([pending, buffer]);

    for (;;) {
      const newline = pending.indexOf(0x0a);
      if (newline === -1) {
        break;
      }
      if (newline > maxLineBytes) {
        throw new Error(`MCP input line exceeds ${maxLineBytes} bytes`);
      }
      const line = pending.subarray(0, newline).toString("utf8");
      pending = pending.subarray(newline + 1);
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
    }

    if (pending.length > maxLineBytes) {
      throw new Error(`MCP input line exceeds ${maxLineBytes} bytes`);
    }
  }

  if (pending.length > 0) {
    yield pending.toString("utf8");
  }
}
