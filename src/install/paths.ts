import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface InstallationPaths {
  root: string;
  releases: string;
  current: string;
  bin: string;
  shim: string;
  state: string;
}

export function installationPaths(): InstallationPaths {
  const root = resolve(
    process.env.BROWSERJACK_HOME ?? join(homedir(), "Library/Application Support/browserjack"),
  );
  const bin = join(root, "bin");
  return {
    root,
    releases: join(root, "releases"),
    current: join(root, "current"),
    bin,
    shim: join(bin, "browserjack"),
    state: join(root, "state.json"),
  };
}
