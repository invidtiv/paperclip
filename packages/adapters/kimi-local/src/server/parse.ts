import { asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

export interface ParsedKimiJsonl {
  summary: string;
  thought: string;
  errorMessage: string | null;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  nonJsonLines: string[];
}

const KIMI_ERROR_RE =
  /(LLM\s+not\s+set|LLM\s+not\s+supported|provider\s+error|authentication|unauthorized|invalid\s+(?:api\s+)?key|quota\s+exceeded|membership\s+expired|max\s+steps\s+reached|interrupted\s+by\s+user|unknown\s+error|no\s+previous\s+session|invalid\s+configuration|config\s+file)/i;

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function extractContent(value: unknown): { text: string; thought: string } {
  if (typeof value === "string") return { text: value, thought: "" };

  const textParts: string[] = [];
  const thoughtParts: string[] = [];
  const parts = Array.isArray(value) ? value : [];

  for (const partValue of parts) {
    const part = parseObject(partValue);
    const type = asString(part.type, "").trim();
    if (type === "text") {
      const text = asString(part.text, "");
      if (text) textParts.push(text);
      continue;
    }
    if (type === "think") {
      const thought = asString(part.think, "");
      if (thought) thoughtParts.push(thought);
      continue;
    }
    if (type === "image_url" || type === "audio_url" || type === "video_url") {
      textParts.push(`[${type}]`);
      continue;
    }
    const fallback = compactJson(partValue);
    if (fallback) textParts.push(fallback);
  }

  return {
    text: textParts.join(""),
    thought: thoughtParts.join(""),
  };
}

function extractErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = parseObject(value);
  return (
    asString(record.message, "").trim() ||
    asString(record.error, "").trim() ||
    asString(record.detail, "").trim() ||
    asString(record.code, "").trim() ||
    compactJson(record)
  );
}

function readToolCallCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function looksLikeErrorLine(line: string): boolean {
  return KIMI_ERROR_RE.test(line);
}

export function parseKimiJsonl(stdout: string): ParsedKimiJsonl {
  const summaryParts: string[] = [];
  const thoughtParts: string[] = [];
  const nonJsonLines: string[] = [];
  let errorMessage: string | null = null;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let toolResultCount = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsed = parseJson(line);
    if (!parsed) {
      nonJsonLines.push(line);
      if (!errorMessage && looksLikeErrorLine(line)) errorMessage = line;
      continue;
    }

    const role = asString(parsed.role, "").trim();
    const type = asString(parsed.type, "").trim();

    if (role === "assistant") {
      assistantMessageCount += 1;
      const content = extractContent(parsed.content);
      if (content.text) summaryParts.push(content.text);
      if (content.thought) thoughtParts.push(content.thought);
      toolCallCount += readToolCallCount(parsed.tool_calls);
      continue;
    }

    if (role === "tool") {
      toolResultCount += 1;
      continue;
    }

    if (type === "error" || role === "error") {
      const text = extractErrorText(parsed.error ?? parsed.message ?? parsed.detail ?? parsed.data).trim();
      if (text) errorMessage = text;
      continue;
    }
  }

  if (!errorMessage && summaryParts.length === 0) {
    const firstErrorLine = nonJsonLines.find(looksLikeErrorLine);
    if (firstErrorLine) errorMessage = firstErrorLine;
  }

  return {
    summary: summaryParts.join("\n\n").trim(),
    thought: thoughtParts.join("\n\n").trim(),
    errorMessage,
    assistantMessageCount,
    toolCallCount,
    toolResultCount,
    nonJsonLines,
  };
}

export function isKimiUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return /unknown\s+session|session(?:\s+.*)?\s+not\s+found|no\s+previous\s+session|invalid\s+session/i.test(haystack);
}

export function detectKimiAuthRequired(stdout: string, stderr: string, parsedError?: string | null): boolean {
  const haystack = [stdout, stderr, parsedError ?? ""].join("\n");
  return /(LLM\s+not\s+set|login\s+to\s+your\s+Kimi|not\s+logged\s+in|authentication\s+required|unauthorized|invalid\s+(?:api\s+)?key|missing\s+api\s+key)/i.test(haystack);
}
