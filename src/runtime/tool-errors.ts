import { isJsonObject } from "../lib/json.js";

// OpenAI's browser service throws these while no browser extension is connected
// to ChatGPT.app, for example `Browser is not available: chrome`.
const NO_CONNECTED_BROWSER = /Browser is not available: |No browser is available/;

// The extension retries its native-host connection every 5 seconds and, while
// its service worker sleeps, on a 30-second alarm.
export function noConnectedBrowserNotice(errorText: string): string | null {
  return NO_CONNECTED_BROWSER.test(errorText)
    ? "The requested browser has no extension connected to ChatGPT.app yet. The extension reconnects within 30 seconds after the browser starts, ChatGPT.app restarts or the Mac wakes. Retry the same call every 5 seconds for up to 30 seconds. If it still fails, confirm that the browser is running and the ChatGPT extension is enabled in it."
    : null;
}

// Appends Browserjack notices to a failed tools/call result, so the agent sees
// the likely cause next to OpenAI's error text. `notices` receives the result's
// joined text and runs only for failed results. Resolves to null for every
// other line and when there are no notices.
export async function annotateToolError(
  line: string,
  notices: (errorText: string) => Promise<string[]>,
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
  const errorText = message.result.content
    .map((item) => (isJsonObject(item) && typeof item.text === "string" ? item.text : ""))
    .join("\n");
  const texts = await notices(errorText);
  if (texts.length === 0) {
    return null;
  }
  const content = [
    ...message.result.content,
    ...texts.map((text) => ({ type: "text", text: `browserjack: ${text}` })),
  ];
  return `${JSON.stringify({ ...message, result: { ...message.result, content } })}\n`;
}
