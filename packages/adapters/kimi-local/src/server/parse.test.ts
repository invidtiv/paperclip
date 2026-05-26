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
    expect(parsed.assistantMessageCount).toBe(2);
    expect(parsed.toolCallCount).toBe(1);
    expect(parsed.toolResultCount).toBe(1);
    expect(parsed.errorMessage).toBeNull();
  });

  it("captures structured and plain auth errors", () => {
    const structured = parseKimiJsonl(JSON.stringify({
      type: "error",
      error: { message: "Authentication required" },
    }));
    const plain = parseKimiJsonl("LLM not set; run kimi login");

    expect(structured.errorMessage).toBe("Authentication required");
    expect(plain.errorMessage).toBe("LLM not set; run kimi login");
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
