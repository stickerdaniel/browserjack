import { setupBridge, type SetupResult } from "./setup.js";
import { readInstallState } from "./state.js";

export interface UpdateResult extends SetupResult {
  previousVersion: string;
}

export async function updateBridge(): Promise<UpdateResult> {
  const state = await readInstallState();
  if (state === null) {
    throw new Error("browserjack is not installed. Run browserjack setup first.");
  }

  const result = await setupBridge({
    scope: state.mcpScope,
    mcpName: state.mcpName,
    registerMcp: state.mcpRegistered,
    cwd: state.registrationCwd,
  });

  return { ...result, previousVersion: state.version };
}
