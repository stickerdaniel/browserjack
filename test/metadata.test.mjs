import assert from "node:assert/strict";
import test from "node:test";

import { injectTurnMetadata } from "../dist/runtime/metadata.js";

test("injects Codex turn metadata into tools/call", () => {
  const state = { sessionId: "test-session", turnCounter: 0 };
  const result = JSON.parse(
    injectTurnMetadata(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "js", arguments: { code: "1 + 1" } },
      }),
      state,
    ),
  );

  assert.equal(state.turnCounter, 1);
  assert.deepEqual(result.params._meta["x-codex-turn-metadata"], {
    installation_id: "test-session",
    session_id: "test-session",
    thread_id: "test-session",
    turn_id: "turn-1",
    request_kind: "agent",
    turn_started_at_unix_ms: result.params._meta["x-codex-turn-metadata"].turn_started_at_unix_ms,
  });
  assert.equal(
    typeof result.params._meta["x-codex-turn-metadata"].turn_started_at_unix_ms,
    "number",
  );
});

test("preserves existing metadata", () => {
  const state = { sessionId: "test-session", turnCounter: 0 };
  const existing = { session_id: "upstream" };
  const result = JSON.parse(
    injectTurnMetadata(
      JSON.stringify({
        method: "tools/call",
        params: {
          _meta: { "x-codex-turn-metadata": existing },
        },
      }),
      state,
    ),
  );

  assert.deepEqual(result.params._meta["x-codex-turn-metadata"], existing);
  assert.equal(state.turnCounter, 0);
});

test("passes malformed and unrelated lines through", () => {
  const state = { sessionId: "test-session", turnCounter: 0 };
  assert.equal(injectTurnMetadata("not-json", state), "not-json\n");
  assert.equal(injectTurnMetadata('{"method":"tools/list"}', state), '{"method":"tools/list"}\n');
});
