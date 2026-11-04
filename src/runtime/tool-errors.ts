import { isJsonObject } from "../lib/json.js";

// Appends a Browserjack notice to a failed tools/call result, so the agent sees
// the likely cause next to OpenAI's error text. Resolves to null for every other
// line and when there is no notice, and only then looks the notice up.
export async function annotateToolError(
  line: string,
  notice: () => Promise<string | null>,
): Promise<string | null> {
  let message: unknown;
  try {
    message = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (
    !isJsonObject(message) ||
    !isJsonObject(message.result) ||
    message.result.isError !== true ||
    !Array.isArray(message.result.content)
  ) {
    return null;
  }
  const text = await notice();
  if (text === null) {
    return null;
  }
  const content = [...message.result.content, { type: "text", text: `browserjack: ${text}` }];
  return `${JSON.stringify({ ...message, result: { ...message.result, content } })}\n`;
}
