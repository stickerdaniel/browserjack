import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, join } from "node:path";

export async function resolveExecutable(name: string): Promise<string> {
  const override = process.env[`${name.toUpperCase()}_CLI_PATH`];
  const candidates = override
    ? [override]
    : (process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, name));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      // Continue through PATH.
    }
  }
  throw new Error(`Unable to find executable ${name}`);
}
