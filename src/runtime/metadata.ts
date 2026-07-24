import { randomUUID } from "node:crypto";

import { isJsonObject, type JsonObject } from "../lib/json.js";

export interface TurnState {
  sessionId: string;
  turnCounter: number;
}

export function createTurnState(): TurnState {
  return {
    sessionId: `claude-browser-${randomUUID()}`,
    turnCounter: 0,
  };
}

export function injectTurnMetadata(line: string, state: TurnState): string {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return `${line}\n`;
  }

  if (!isJsonObject(value) || value.method !== "tools/call") {
    return `${line}\n`;
  }

  const params: JsonObject = isJsonObject(value.params) ? value.params : {};
  const metadata: JsonObject = isJsonObject(params._meta) ? params._meta : {};
  if ("x-codex-turn-metadata" in metadata) {
    return `${line}\n`;
  }

  state.turnCounter += 1;
  const turnMetadata = {
    installation_id: state.sessionId,
    session_id: state.sessionId,
    thread_id: state.sessionId,
    turn_id: `turn-${state.turnCounter}`,
    request_kind: "agent",
    turn_started_at_unix_ms: Date.now(),
  };

  return `${JSON.stringify({
    ...value,
    params: {
      ...params,
      _meta: {
        ...metadata,
        "x-codex-turn-metadata": turnMetadata,
      },
    },
  })}\n`;
}
