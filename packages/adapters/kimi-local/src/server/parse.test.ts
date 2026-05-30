import { describe, expect, it } from "vitest";
import {
  detectKimiAuthRequired,
  isKimiUnknownSessionError,
  parseKimiJsonl,
} from "./parse.js";

describe("parseKimiJsonl", () => {
  it("collects assistant text, thinking, and tool counts from stream-json messages", () => {
    const stdout = [
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "think", think: "Plan first." },
          { type: "text", text: "hello" },
        ],
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "Shell", arguments: "{\"cmd\":\"pwd\"}" },
          },
        ],
      }),
      JSON.stringify({
        role: "tool",
        tool_call_id: "call-1",
        content: [{ type: "text", text: "<system>ERROR: command failed</system>" }],
      }),
      JSON.stringify({
        role: "assistant",
        content: "Done.",
      }),
    ].join("\n");

    const parsed = parseKimiJsonl(stdout);

    expect(parsed.summary).toBe("hello\n\nDone.");
    expect(parsed.thought).toBe("Plan first.");
    expect(parsed.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    expect(parsed.costUsd).toBeNull();
    expect(parsed.assistantMessageCount).toBe(2);
    expect(parsed.toolCallCount).toBe(1);
    expect(parsed.toolResultCount).toBe(1);
    expect(parsed.errorMessage).toBeNull();
  });

  it("extracts usage and cost from stream-json aliases", () => {
    const stdout = [
      JSON.stringify({
        role: "assistant",
        content: "Done.",
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          cached_input_tokens: 6,
        },
        cost_usd: 0.00123,
      }),
      JSON.stringify({
        type: "event",
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 44,
          cached_input_tokens: 5,
          total_cost_usd: 0.0009,
        },
      }),
    ].join("\n");

    const parsed = parseKimiJsonl(stdout);
    expect(parsed.usage).toEqual({
      inputTokens: 123,
      outputTokens: 45,
      cachedInputTokens: 6,
    });
    expect(parsed.costUsd).toBeCloseTo(0.0009, 8);
  });

  it("captures structured and plain auth errors", () => {
    const structured = parseKimiJsonl(JSON.stringify({
      type: "error",
      error: { message: "Authentication required" },
    }));
    const plain = parseKimiJsonl("LLM not set; run kimi login");

    expect(structured.errorMessage).toBe("Authentication required");
    expect(structured.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    expect(structured.costUsd).toBeNull();
    expect(plain.errorMessage).toBe("LLM not set; run kimi login");
    expect(plain.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    expect(plain.costUsd).toBeNull();
  });
});

describe("kimi_local error detectors", () => {
  it("detects stale sessions and auth-required failures", () => {
    expect(isKimiUnknownSessionError("", "unknown session id abc")).toBe(true);
    expect(isKimiUnknownSessionError("", "everything fine")).toBe(false);

    expect(detectKimiAuthRequired("", "", "missing api key")).toBe(true);
    expect(detectKimiAuthRequired("", "completed", null)).toBe(false);
  });
});
