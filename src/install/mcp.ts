import { runCommand } from "../lib/command.js";
import { resolveExecutable } from "./executable.js";

const RUN_ARG = "run";

interface McpDefinition {
  command: string | null;
  args: string[];
}

export type McpOwnership = "absent" | "owned" | "foreign";

function parseMcpGet(output: string): McpDefinition {
  let command: string | null = null;
  const args: string[] = [];
  for (const rawLine of output.split("\n")) {
    const commandMatch = /^\s*Command:\s*(.+?)\s*$/u.exec(rawLine);
    if (commandMatch?.[1] !== undefined) {
      command = commandMatch[1];
      continue;
    }
    const argsMatch = /^\s*Args:\s*(.*?)\s*$/u.exec(rawLine);
    if (argsMatch?.[1] !== undefined && argsMatch[1].length > 0) {
      args.push(...argsMatch[1].split(/\s+/u));
    }
  }
  return { command, args };
}

function isOwnedBy(output: string, shimPath: string): boolean {
  const definition = parseMcpGet(output);
  return definition.command === shimPath && definition.args.includes(RUN_ARG);
}

export async function inspectClaudeMcp(
  name: string,
  shimPath: string,
  cwd: string,
): Promise<McpOwnership> {
  const claude = await resolveExecutable("claude");
  const existing = await runCommand(claude, ["mcp", "get", name], {
    allowNonZero: true,
    cwd,
  });
  if (existing.code !== 0) {
    return "absent";
  }
  return isOwnedBy(`${existing.stdout}\n${existing.stderr}`, shimPath) ? "owned" : "foreign";
}

export async function registerClaudeMcp(
  name: string,
  shimPath: string,
  scope: "user" | "local" | "project",
  cwd: string,
): Promise<"created" | "unchanged"> {
  const claude = await resolveExecutable("claude");
  const ownership = await inspectClaudeMcp(name, shimPath, cwd);

  if (ownership === "owned") {
    return "unchanged";
  }
  if (ownership === "foreign") {
    throw new Error(`MCP server ${name} already exists and is not owned by this installation`);
  }

  const definition = JSON.stringify({
    type: "stdio",
    command: shimPath,
    args: [RUN_ARG],
  });
  await runCommand(claude, ["mcp", "add-json", "--scope", scope, name, definition], { cwd });
  return "created";
}

export async function removeClaudeMcpIfOwned(
  name: string,
  shimPath: string,
  scope: "user" | "local" | "project",
  cwd: string,
): Promise<boolean> {
  const claude = await resolveExecutable("claude");
  const ownership = await inspectClaudeMcp(name, shimPath, cwd);
  if (ownership === "absent") {
    return false;
  }
  if (ownership === "foreign") {
    throw new Error(
      `Refusing to remove MCP server ${name} because it is not owned by this installation`,
    );
  }
  await runCommand(claude, ["mcp", "remove", "--scope", scope, name], { cwd });
  return true;
}
