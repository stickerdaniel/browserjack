import { isJsonObject } from "../lib/json.js";

// OpenAI reports an unavailable browser when discovery cannot match its ID or
// family. The error alone says nothing about app/runtime compatibility.
const NO_AVAILABLE_BROWSER =
  /^(?:Error: )?(?:Browser is not available: [^\r\n]+|No browser is available)$/m;

export function browserUnavailableNotice(errorText: string): string | null {
  return NO_AVAILABLE_BROWSER.test(errorText)
    ? "The runtime could not find the requested browser. A disconnected extension or an unavailable browser ID can cause this error. This error alone does not establish that ChatGPT.app is incompatible."
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
    .map((item) =>
      isJsonObject(item) && item.type === "text" && typeof item.text === "string" ? item.text : "",
    )
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
