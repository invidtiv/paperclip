import { asNumber, asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

function readSessionId(event: Record<string, unknown>): string | null {
  return (
    asString(event.session_id, "").trim() ||
    asString(event.sessionId, "").trim() ||
    asString(event.sessionID, "").trim() ||
    asString(event.checkpoint_id, "").trim() ||
    asString(event.thread_id, "").trim() ||
    null
  );
}

function asErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = parseObject(value);
  const message =
    asString(rec.message, "") ||
    asString(rec.error, "") ||
    asString(rec.code, "") ||
    asString(rec.detail, "");
  if (message) return message;
  try {
    return JSON.stringify(rec);
  } catch {
    return "";
  }
}

export function parseAutohandJsonl(stdout: string) {
  let sessionId: string | null = null;
  const messages: string[] = [];
  let errorMessage: string | null = null;
  let costUsd: number | null = null;
  let resultEvent: Record<string, unknown> | null = null;
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const foundSessionId = readSessionId(event);
    if (foundSessionId) sessionId = foundSessionId;

    const type = asString(event.type, "").trim();

    if (type === "message") {
      const messageType = asString(event.messageType, "").trim().toLowerCase();
      const content = asString(event.content, "").trim();
      if (messageType === "assistant" && content) {
        messages.push(content);
      }
      if (messageType === "usage") {
        usage.inputTokens += asNumber(event.promptTokens, 0);
        usage.outputTokens += asNumber(event.completionTokens, 0);
      }
      continue;
    }

    if (type === "result") {
      resultEvent = event;
      usage.inputTokens = asNumber(event.promptTokens, usage.inputTokens);
      usage.outputTokens = asNumber(event.completionTokens, usage.outputTokens);
      
      const resultText = asString(event.result, "").trim();
      if (resultText && messages.length === 0) {
        messages.push(resultText);
      }

      costUsd = asNumber(event.total_cost_usd, asNumber(event.cost_usd, asNumber(event.cost, costUsd ?? 0))) || costUsd;

      const status = asString(event.subtype ?? event.status, "").toLowerCase();
      const isError =
        event.isError === true ||
        event.is_error === true ||
        status === "error" ||
        status === "failed";
      if (isError) {
        const text = asErrorText(event.error ?? event.message ?? event.result).trim();
        if (text) errorMessage = text;
      }
      continue;
    }

    if (type === "error") {
      const text = asErrorText(event.error ?? event.message ?? event.detail).trim();
      if (text) errorMessage = text;
      continue;
    }
  }

  return {
    sessionId,
    summary: messages.join("\n\n").trim(),
    usage,
    costUsd,
    errorMessage,
    resultEvent,
  };
}

export function isAutohandUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return /unknown\s+session|session\s+.*\s+not\s+found|resume\s+.*\s+not\s+found|checkpoint\s+.*\s+not\s+found|cannot\s+resume|failed\s+to\s+resume/i.test(
    haystack,
  );
}

export function describeAutohandFailure(parsed: Record<string, unknown>): string | null {
  const status = asString(parsed.status ?? parsed.subtype, "");
  const errorMsg = asString(parsed.error ?? parsed.message, "").trim();

  const parts = ["Autohand run failed"];
  if (status) parts.push(`status=${status}`);
  if (errorMsg) parts.push(errorMsg);
  return parts.length > 1 ? parts.join(": ") : null;
}
