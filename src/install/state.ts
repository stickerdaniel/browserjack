import { readFile } from "node:fs/promises";

import { isJsonObject } from "../lib/json.js";
import { installationPaths } from "./paths.js";

export type McpScope = "user" | "local" | "project";

export interface InstallState {
  packageName: string;
  version: string;
  nodePath: string;
  mcpName: string;
  mcpScope: McpScope;
  mcpRegistered: boolean;
  registrationCwd: string;
}

function parseScope(value: unknown): McpScope | undefined {
  return value === "user" || value === "local" || value === "project" ? value : undefined;
}

export async function readInstallState(): Promise<InstallState | null> {
  const paths = installationPaths();
  let value: unknown;
  try {
    value = JSON.parse(await readFile(paths.state, "utf8"));
  } catch {
    return null;
  }
  if (!isJsonObject(value) || value.schemaVersion !== 1) {
    return null;
  }
  const scope = parseScope(value.mcpScope);
  if (
    typeof value.packageName !== "string" ||
    typeof value.version !== "string" ||
    typeof value.nodePath !== "string" ||
    typeof value.mcpName !== "string" ||
    scope === undefined ||
    typeof value.mcpRegistered !== "boolean"
  ) {
    return null;
  }
  return {
    packageName: value.packageName,
    version: value.version,
    nodePath: value.nodePath,
    mcpName: value.mcpName,
    mcpScope: scope,
    mcpRegistered: value.mcpRegistered,
    // Older states predate registrationCwd; fall back to the current directory.
    registrationCwd:
      typeof value.registrationCwd === "string" ? value.registrationCwd : process.cwd(),
  };
}
