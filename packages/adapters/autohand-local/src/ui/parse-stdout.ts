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

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseAutohandStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    return [{ kind: "stdout", ts, text: line }];
  }

  const type = asString(parsed.type);

  if (type === "init") {
    const sessionId = asString(parsed.session_id);
    const model = asString(parsed.model, "autohand");
    return [{ kind: "init", ts, model, sessionId }];
  }

  if (type === "message") {
    const messageType = asString(parsed.messageType);
    const content = asString(parsed.content);
    if (messageType === "reasoning") {
      return content.trim() ? [{ kind: "thinking", ts, text: content }] : [];
    }
    if (messageType === "assistant") {
      return content.trim() ? [{ kind: "assistant", ts, text: content }] : [];
    }
    if (messageType === "usage") {
      const promptTokens = asNumber(parsed.promptTokens);
      const completionTokens = asNumber(parsed.completionTokens);
      return []; // tokens are summarized in result kind, but we can also map here if needed, or ignore
    }
    return [];
  }

  if (type === "tool_call") {
    const name = asString(parsed.name ?? parsed.tool, "tool");
    const input = parsed.input ?? parsed.args ?? parsed.arguments ?? {};
    return [{
      kind: "tool_call",
      ts,
      name,
      input,
    }];
  }

  if (type === "tool_result") {
    const toolUseId = asString(parsed.toolUseId ?? parsed.id ?? "tool_result");
    const content = asString(parsed.content ?? parsed.result ?? parsed.output);
    const isError = parsed.isError === true || parsed.is_error === true;
    return [{
      kind: "tool_result",
      ts,
      toolUseId,
      content,
      isError,
    }];
  }

  if (type === "result") {
    const status = asString(parsed.subtype ?? parsed.status).toLowerCase();
    const isError =
      parsed.isError === true ||
      parsed.is_error === true ||
      status === "error" ||
      status === "failed";
    const errors = isError
      ? [asString(parsed.error ?? parsed.message)].filter(Boolean)
      : [];
    const promptTokens = asNumber(parsed.promptTokens);
    const completionTokens = asNumber(parsed.completionTokens);
    return [{
      kind: "result",
      ts,
      text: asString(parsed.result),
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cachedTokens: 0,
      costUsd: 0, // Autohand doesn't expose cost directly in stream-json usually, or we can read it
      subtype: asString(parsed.subtype, status || "result"),
      isError,
      errors,
    }];
  }

  if (type === "error") {
    const errorMsg = asString(parsed.message ?? parsed.error);
    return [{ kind: "stderr", ts, text: errorMsg || "error" }];
  }

  return [{ kind: "stdout", ts, text: line }];
}
