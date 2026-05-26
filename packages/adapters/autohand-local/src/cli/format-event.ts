import pc from "picocolors";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function printAutohandStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    console.log(line);
    return;
  }

  const type = asString(parsed.type);

  if (type === "init") {
    const sessionId = asString(parsed.session_id);
    const model = asString(parsed.model);
    const details = [
      sessionId ? `session: ${sessionId}` : "",
      model ? `model: ${model}` : "",
    ].filter(Boolean).join(", ");
    console.log(pc.blue(`Autohand init${details ? ` (${details})` : ""}`));
    return;
  }

  if (type === "message") {
    const messageType = asString(parsed.messageType);
    const content = asString(parsed.content);
    if (messageType === "reasoning") {
      if (content.trim()) {
        console.log(pc.gray(`thinking: ${content.trim()}`));
      }
      return;
    }
    if (messageType === "assistant") {
      if (content.trim()) {
        console.log(pc.green(`assistant: ${content.trim()}`));
      }
      return;
    }
    if (messageType === "usage") {
      const promptTokens = asNumber(parsed.promptTokens);
      const completionTokens = asNumber(parsed.completionTokens);
      console.log(
        pc.blue(
          `tokens: prompt=${promptTokens} completion=${completionTokens}`
        )
      );
      return;
    }
    return;
  }

  if (type === "tool_call") {
    const name = asString(parsed.name ?? parsed.tool);
    console.log(pc.yellow(`tool_call: ${name}`));
    const input = parsed.input ?? parsed.args ?? parsed.arguments;
    if (input) {
      console.log(pc.gray(JSON.stringify(input, null, 2)));
    }
    return;
  }

  if (type === "tool_result") {
    const isError = parsed.isError === true || parsed.is_error === true;
    const content = asString(parsed.content ?? parsed.result ?? parsed.output);
    console.log(
      (isError ? pc.red : pc.cyan)(
        `tool_result${isError ? " (error)" : ""}`
      )
    );
    if (content) {
      console.log((isError ? pc.red : pc.gray)(content));
    }
    return;
  }

  if (type === "result") {
    const status = asString(parsed.subtype ?? parsed.status).toLowerCase();
    const isError =
      parsed.isError === true ||
      parsed.is_error === true ||
      status === "error" ||
      status === "failed";
    const resultText = asString(parsed.result);
    console.log(
      (isError ? pc.red : pc.blue)(
        `result: status=${status} is_error=${isError}`
      )
    );
    if (resultText) {
      console.log(resultText);
    }
    return;
  }

  if (type === "error") {
    const errorMsg = asString(parsed.message ?? parsed.error);
    if (errorMsg) {
      console.log(pc.red(`error: ${errorMsg}`));
    }
    return;
  }

  // Fallback for other line logs
  console.log(line);
}
