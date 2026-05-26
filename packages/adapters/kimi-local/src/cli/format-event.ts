import pc from "picocolors";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : [];
  return parts
    .map((partValue) => {
      const part = asRecord(partValue);
      if (!part) return "";
      const type = asString(part.type);
      if (type === "text") return asString(part.text);
      if (type === "think") return asString(part.think);
      return "";
    })
    .filter(Boolean)
    .join("");
}

export function printKimiStreamEvent(raw: string, debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    console.log(line);
    return;
  }

  const role = asString(parsed.role).trim();
  if (role === "assistant") {
    const text = extractText(parsed.content);
    if (text) console.log(pc.green(`assistant: ${text}`));
    const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
    for (const callValue of toolCalls) {
      const call = asRecord(callValue);
      const fn = asRecord(call?.function);
      const name = asString(fn?.name, "tool");
      console.log(pc.yellow(`tool: ${name}`));
    }
    return;
  }

  if (role === "tool") {
    const toolUseId = asString(parsed.tool_call_id);
    const text = extractText(parsed.content);
    console.log(pc.blue(`tool result${toolUseId ? ` ${toolUseId}` : ""}: ${text || "(empty)"}`));
    return;
  }

  if (role === "user") {
    const text = extractText(parsed.content);
    if (debug && text) console.log(pc.gray(`user: ${text}`));
    return;
  }

  if (role === "system") {
    const text = extractText(parsed.content);
    if (text) console.log(pc.gray(`system: ${text}`));
    return;
  }

  const type = asString(parsed.type).trim();
  console.log(pc.gray(`event: ${type || role || "unknown"} ${debug ? JSON.stringify(parsed) : ""}`.trim()));
}
