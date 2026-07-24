import { readFile } from "node:fs/promises";

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function requireString(object: JsonObject, key: string, source: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source} is missing string field ${key}`);
  }
  return value;
}
