import { asNumber, asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export interface ParsedKimiJsonl {
  summary: string;
  thought: string;
  usage: UsageSummary;
  costUsd: number | null;
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

function readUsageFromRecord(record: Record<string, unknown>): UsageSummary {
  const usage = parseObject(record.usage);
  const usageMeta = parseObject(record.usage_metadata);
  const tokenUsage = parseObject(record.token_usage);

  const inputTokens = asNumber(
    usage.input_tokens,
    asNumber(usage.inputTokens, asNumber(usage.prompt_tokens, asNumber(tokenUsage.input_tokens, asNumber(usageMeta.input_tokens, 0)))),
  );
  const outputTokens = asNumber(
    usage.output_tokens,
    asNumber(usage.outputTokens, asNumber(usage.completion_tokens, asNumber(tokenUsage.output_tokens, asNumber(usageMeta.output_tokens, 0)))),
  );
  const cachedInputTokens = asNumber(
    usage.cached_input_tokens,
    asNumber(usage.cachedInputTokens, asNumber(usage.cache_read_input_tokens, asNumber(tokenUsage.cached_input_tokens, asNumber(usageMeta.cached_input_tokens, 0)))),
  );

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };
}

function mergeUsage(previous: UsageSummary, next: UsageSummary): UsageSummary {
  return {
    inputTokens: Math.max(previous.inputTokens, next.inputTokens),
    outputTokens: Math.max(previous.outputTokens, next.outputTokens),
    cachedInputTokens: Math.max(previous.cachedInputTokens, next.cachedInputTokens),
  };
}

function readCostUsd(record: Record<string, unknown>): number | null {
  const usage = parseObject(record.usage);
  const usageMeta = parseObject(record.usage_metadata);
  const tokenUsage = parseObject(record.token_usage);

  const parsed = asNumber(
    record.total_cost_usd,
    asNumber(
      record.cost_usd,
      asNumber(
        record.costUsd,
        asNumber(
          usage.total_cost_usd,
          asNumber(usage.cost_usd, asNumber(usage.costUsd, asNumber(tokenUsage.total_cost_usd, asNumber(usageMeta.total_cost_usd, Number.NaN)))),
        ),
      ),
    ),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseKimiJsonl(stdout: string): ParsedKimiJsonl {
  const summaryParts: string[] = [];
  const thoughtParts: string[] = [];
  const nonJsonLines: string[] = [];
  let usage: UsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };
  let costUsd: number | null = null;
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
    usage = mergeUsage(usage, readUsageFromRecord(parsed));
    const lineCostUsd = readCostUsd(parsed);
    if (lineCostUsd != null) {
      costUsd = lineCostUsd;
    }

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
    usage,
    costUsd,
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
