import { Transform, type TransformCallback } from "node:stream";

const SECRET_KEY = "authorization|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password";

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // JSON string form: "api_key":"value" -> keep structure, redact the value.
  [new RegExp(`("(?:${SECRET_KEY})"\\s*:\\s*")[^"]*(")`, "giu"), "$1[REDACTED]$2"],
  // authorization header form: redact the whole value to end of line (covers "Bearer <token>").
  [/(authorization\s*[:=]\s*)(?!")[^\n]+/giu, "$1[REDACTED]"],
  // key=value / key: value form (single unquoted token).
  [new RegExp(`((?:${SECRET_KEY})\\s*[:=]\\s*)(?!")[^\\s,;"']+`, "giu"), "$1[REDACTED]"],
  // Bearer tokens anywhere.
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/giu, "$1[REDACTED]"],
];

// Cap the buffered, not-yet-flushed line so a newline-free stderr stream cannot
// grow memory without bound. 64 KiB is far larger than any real diagnostic line.
const MAX_PENDING_BYTES = 64 * 1024;

function redactLine(value: string): string {
  return SECRET_PATTERNS.reduce((output, [pattern, replacement]) => {
    pattern.lastIndex = 0;
    return output.replace(pattern, replacement);
  }, value);
}

export class RedactingTransform extends Transform {
  #pending = "";

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#pending += chunk.toString("utf8");
    const lines = this.#pending.split("\n");
    this.#pending = lines.pop() ?? "";
    for (const line of lines) {
      this.push(`${redactLine(line)}\n`);
    }
    if (Buffer.byteLength(this.#pending, "utf8") > MAX_PENDING_BYTES) {
      this.push(redactLine(this.#pending));
      this.#pending = "";
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    if (this.#pending) {
      this.push(redactLine(this.#pending));
    }
    callback();
  }
}
