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

  const eventName = asString(parsed.event);
  if (eventName) {
    const data = asRecord(parsed.data) ?? {};
    if (eventName === "messageDelta") {
      const content = asString(data.content);
      return content ? [{ kind: "assistant", ts, text: content }] : [];
    }
    if (eventName === "toolStart") {
      const name = asString(data.tool ?? data.name, "tool");
      const toolUseId = asString(data.id ?? data.toolUseId ?? data.toolCallId);
      const input = asRecord(data.input ?? data.args ?? data.arguments) ?? {};
      return [{
        kind: "tool_call",
        ts,
        name,
        toolUseId: toolUseId || undefined,
        input,
      }];
    }
    if (eventName === "toolEnd") {
      const toolUseId = asString(data.id ?? data.toolUseId ?? data.toolCallId ?? "tool_result");
      const content = asString(data.content ?? data.result ?? data.output ?? "");
      const isError = data.success === false || data.isError === true || data.is_error === true;
      return [{
        kind: "tool_result",
        ts,
        toolUseId,
        content,
        isError,
      }];
    }
    if (eventName === "promptComplete") {
      const inputTokens = asNumber(data.promptTokens ?? data.inputTokens, 0);
      const outputTokens = asNumber(data.completionTokens ?? data.outputTokens ?? data.tokensUsed, 0);
      const costUsd = asNumber(data.total_cost_usd ?? data.cost_usd ?? data.cost, 0);
      const isError = data.success === false;
      const status = isError ? "failed" : "success";
      const errors = isError ? [asString(data.error ?? data.message ?? "Prompt failed")].filter(Boolean) : [];
      return [{
        kind: "result",
        ts,
        text: "",
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        costUsd,
        subtype: status,
        isError,
        errors,
      }];
    }
    if (eventName === "messageStart") {
      return [];
    }
    return [];
  }

  const method = asString(parsed.method);
  if (method) {
    const params = asRecord(parsed.params) ?? {};
    if (method === "autohand.agentStart") {
      const sessionId = asString(params.sessionId ?? params.session_id);
      const model = asString(params.model, "autohand");
      return [{ kind: "init", ts, model, sessionId }];
    }

    if (method === "autohand.messageUpdate") {
      const thought = asString(params.thought);
      const delta = asString(params.delta);
      const entries: TranscriptEntry[] = [];
      if (thought.trim()) {
        entries.push({ kind: "thinking", ts, text: thought });
      }
      if (delta.trim()) {
        entries.push({ kind: "assistant", ts, text: delta });
      }
      return entries;
    }

    if (method === "autohand.toolStart") {
      const name = asString(params.name ?? params.tool, "tool");
      const toolUseId = asString(params.toolUseId ?? params.id ?? params.toolCallId);
      const input = asRecord(params.input ?? params.args ?? params.arguments) ?? {};
      return [{
        kind: "tool_call",
        ts,
        name,
        toolUseId: toolUseId || undefined,
        input,
      }];
    }

    if (method === "autohand.toolEnd") {
      const toolUseId = asString(params.toolUseId ?? params.id ?? params.toolCallId ?? "tool_result");
      const content = asString(params.content ?? params.result ?? params.output);
      const isError = params.isError === true || params.is_error === true;
      return [{
        kind: "tool_result",
        ts,
        toolUseId,
        content,
        isError,
      }];
    }

    if (method === "autohand.turnEnd") {
      const tokensUsed = asNumber(params.tokensUsed);
      const costUsd = asNumber(params.total_cost_usd ?? params.cost_usd ?? params.cost);
      return [{
        kind: "result",
        ts,
        text: "",
        inputTokens: 0,
        outputTokens: tokensUsed,
        cachedTokens: 0,
        costUsd,
        subtype: "result",
        isError: false,
        errors: [],
      }];
    }

    if (method === "autohand.error") {
      const errorMsg = asString(params.message ?? params.error ?? params.detail);
      return [{ kind: "stderr", ts, text: errorMsg || "error" }];
    }

    return [];
  }

  if (parsed.error) {
    const errorObj = asRecord(parsed.error) ?? {};
    const errorMsg = asString(errorObj.message ?? errorObj.error ?? parsed.error);
    return [{ kind: "stderr", ts, text: errorMsg || "error" }];
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
      return [];
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
      costUsd: 0,
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
