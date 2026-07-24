import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(importMetaUrl: string): string {
  return resolve(dirname(fileURLToPath(importMetaUrl)), "../..");
}
