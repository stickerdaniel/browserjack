import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";

import { isJsonObject } from "../lib/json.js";
import { packageRoot } from "../lib/package-root.js";
import { registerClaudeMcp, removeClaudeMcpIfOwned } from "./mcp.js";
import { installationPaths } from "./paths.js";

interface PackageMetadata {
  name: string;
  version: string;
}

export interface SetupOptions {
  scope: "user" | "local" | "project";
  mcpName: string;
  registerMcp: boolean;
  // Directory Claude Code runs `mcp` commands in. Matters for local/project scope.
  cwd?: string;
}

export interface SetupResult {
  version: string;
  releasePath: string;
  shimPath: string;
  mcp: "created" | "unchanged" | "skipped";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function readPackageMetadata(root: string): Promise<PackageMetadata> {
  const value: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!isJsonObject(value) || typeof value.name !== "string" || typeof value.version !== "string") {
    throw new TypeError("package.json has no name or version");
  }
  return { name: value.name, version: value.version };
}

async function currentTarget(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink() ? await readlink(path) : null;
  } catch {
    return null;
  }
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function restoreSymlink(path: string, target: string | null, pid: number): Promise<void> {
  if (target === null) {
    await rm(path, { force: true });
    return;
  }
  const temporary = `${path}.restore-${pid}`;
  await rm(temporary, { force: true });
  await symlink(target, temporary);
  await rename(temporary, path);
}

async function restoreFile(path: string, content: string | null): Promise<void> {
  if (content === null) {
    await rm(path, { force: true, recursive: true });
    return;
  }
  await rm(path, { force: true, recursive: true });
  await writeFile(path, content, { mode: 0o600 });
}

async function installRelease(sourceRoot: string, releasePath: string): Promise<void> {
  try {
    await lstat(releasePath);
    return;
  } catch {
    // Install the missing immutable release.
  }

  const staging = `${releasePath}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  // The shim only ever runs dist/cli.js against the compatibility manifest;
  // everything else would be dead weight duplicated into every release.
  for (const entry of ["dist", "compatibility", "package.json", "LICENSE"]) {
    await cp(join(sourceRoot, entry), join(staging, entry), {
      recursive: true,
      force: false,
    });
  }
  await rename(staging, releasePath);
}

export async function setupBridge(options: SetupOptions): Promise<SetupResult> {
  const sourceRoot = packageRoot(import.meta.url);
  const metadata = await readPackageMetadata(sourceRoot);
  const paths = installationPaths();
  const releasePath = join(paths.releases, metadata.version);

  await mkdir(paths.releases, { recursive: true, mode: 0o700 });
  await mkdir(paths.bin, { recursive: true, mode: 0o700 });
  await installRelease(sourceRoot, releasePath);

  const previousTarget = await currentTarget(paths.current);
  const previousShim = await readFileOrNull(paths.shim);
  const previousState = await readFileOrNull(paths.state);

  const nextTarget = relative(paths.root, releasePath);
  const temporaryLink = `${paths.current}.next-${process.pid}`;
  await rm(temporaryLink, { force: true });
  await symlink(nextTarget, temporaryLink);
  await rename(temporaryLink, paths.current);

  const shim = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(
    join(paths.current, "dist", "cli.js"),
  )} "$@"\n`;
  await writeFile(paths.shim, shim, { mode: 0o755 });
  await chmod(paths.shim, 0o755);

  const registrationCwd = options.cwd ?? process.cwd();
  let mcp: "created" | "unchanged" | "skipped" = "skipped";
  try {
    mcp = options.registerMcp
      ? await registerClaudeMcp(options.mcpName, paths.shim, options.scope, registrationCwd)
      : "skipped";
    await writeFile(
      paths.state,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          packageName: metadata.name,
          version: metadata.version,
          nodePath: process.execPath,
          mcpName: options.mcpName,
          mcpScope: options.scope,
          mcpRegistered: options.registerMcp,
          registrationCwd,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    return {
      version: metadata.version,
      releasePath,
      shimPath: paths.shim,
      mcp,
    };
  } catch (error) {
    if (mcp === "created") {
      await removeClaudeMcpIfOwned(
        options.mcpName,
        paths.shim,
        options.scope,
        registrationCwd,
      ).catch(() => {
        // Best-effort undo of the registration created in this run.
      });
    }
    await restoreFile(paths.state, previousState);
    await restoreFile(paths.shim, previousShim);
    if (previousShim !== null) {
      await chmod(paths.shim, 0o755).catch(() => {});
    }
    await restoreSymlink(paths.current, previousTarget, process.pid);
    throw error;
  }
}
