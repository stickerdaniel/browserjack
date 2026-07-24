import { rm } from "node:fs/promises";

import { removeClaudeMcpIfOwned } from "./mcp.js";
import { installationPaths } from "./paths.js";
import { readInstallState } from "./state.js";

export async function uninstallBridge(keepState: boolean): Promise<void> {
  const paths = installationPaths();
  const state = await readInstallState();
  const mcpName = state?.mcpName ?? "browserjack";
  const scope = state?.mcpScope ?? "user";
  const mcpRegistered = state?.mcpRegistered ?? true;
  const registrationCwd = state?.registrationCwd ?? process.cwd();

  if (mcpRegistered) {
    await removeClaudeMcpIfOwned(mcpName, paths.shim, scope, registrationCwd);
  }
  if (keepState) {
    await rm(paths.current, { force: true });
    await rm(paths.shim, { force: true });
    return;
  }
  await rm(paths.root, { recursive: true, force: true });
}
