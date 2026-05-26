import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function extractContentEntries(content: unknown, ts: string, role: string): TranscriptEntry[] {
  if (typeof content === "string") {
    if (!content) return [];
    if (role === "user") return [{ kind: "user", ts, text: content }];
    if (role === "system") return [{ kind: "system", ts, text: content }];
    return [{ kind: "assistant", ts, text: content }];
  }

  const entries: TranscriptEntry[] = [];
  const parts = Array.isArray(content) ? content : [];
  for (const partValue of parts) {
    const part = asRecord(partValue);
    if (!part) continue;
    const type = asString(part.type).trim();
    if (type === "text") {
      const text = asString(part.text);
      if (!text) continue;
      if (role === "user") entries.push({ kind: "user", ts, text });
      else if (role === "system") entries.push({ kind: "system", ts, text });
      else entries.push({ kind: "assistant", ts, text });
      continue;
    }
    if (type === "think") {
      const text = asString(part.think);
      if (text) entries.push({ kind: "thinking", ts, text });
      continue;
    }
    const fallback = compactJson(partValue);
    if (fallback) entries.push({ kind: "stdout", ts, text: fallback });
  }
  return entries;
}

function parseToolArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toolCallEntries(toolCalls: unknown, ts: string): TranscriptEntry[] {
  if (!Array.isArray(toolCalls)) return [];
  const entries: TranscriptEntry[] = [];
  for (const callValue of toolCalls) {
    const call = asRecord(callValue);
    if (!call) continue;
    const fn = asRecord(call.function);
    const name = asString(fn?.name, "tool");
    const input = parseToolArguments(fn?.arguments);
    const toolUseId = asString(call.id, "");
    entries.push({
      kind: "tool_call",
      ts,
      name,
      input,
      ...(toolUseId ? { toolUseId } : {}),
    });
  }
  return entries;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : [];
  return parts
    .map((partValue) => {
      const part = asRecord(partValue);
      if (!part) return "";
      if (asString(part.type) === "text") return asString(part.text);
      if (asString(part.type) === "think") return asString(part.think);
      return compactJson(partValue);
    })
    .filter(Boolean)
    .join("");
}

export function parseKimiStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    return [{ kind: "stdout", ts, text: line }];
  }

  const role = asString(parsed.role).trim();
  if (role === "assistant") {
    return [
      ...extractContentEntries(parsed.content, ts, role),
      ...toolCallEntries(parsed.tool_calls, ts),
    ];
  }

  if (role === "tool") {
    const content = extractText(parsed.content);
    const toolUseId = asString(parsed.tool_call_id, "");
    return [{
      kind: "tool_result",
      ts,
      toolUseId,
      content,
      isError: /<system>\s*ERROR:/i.test(content),
    }];
  }

  if (role === "user" || role === "system") {
    return extractContentEntries(parsed.content, ts, role);
  }

  const type = asString(parsed.type).trim();
  if (type === "error") {
    const text = asString(parsed.message) || asString(parsed.error) || asString(parsed.detail) || "Kimi error";
    return [{ kind: "stderr", ts, text }];
  }

  return [{ kind: "system", ts, text: `event: ${type || role || "unknown"}` }];
}
