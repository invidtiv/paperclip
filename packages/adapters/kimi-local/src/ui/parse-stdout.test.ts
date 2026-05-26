import { describe, expect, it } from "vitest";
import { parseKimiStdoutLine } from "./parse-stdout.js";

const ts = "2026-05-26T10:00:00.000Z";

describe("parseKimiStdoutLine", () => {
  it("renders assistant content and tool calls", () => {
    const entries = parseKimiStdoutLine(
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "think", think: "Inspect repo." },
          { type: "text", text: "I will run tests." },
        ],
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "Shell", arguments: "{\"cmd\":\"pnpm test\"}" },
          },
        ],
      }),
      ts,
    );

    expect(entries).toEqual([
      { kind: "thinking", ts, text: "Inspect repo." },
      { kind: "assistant", ts, text: "I will run tests." },
      {
        kind: "tool_call",
        ts,
        name: "Shell",
        input: { cmd: "pnpm test" },
        toolUseId: "call-1",
      },
    ]);
  });

  it("renders tool results and plain stdout", () => {
    expect(
      parseKimiStdoutLine(
        JSON.stringify({
          role: "tool",
          tool_call_id: "call-1",
          content: [{ type: "text", text: "<system>ERROR: failed</system>" }],
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "tool_result",
        ts,
        toolUseId: "call-1",
        content: "<system>ERROR: failed</system>",
        isError: true,
      },
    ]);

    expect(parseKimiStdoutLine("not json", ts)).toEqual([
      { kind: "stdout", ts, text: "not json" },
    ]);
  });
});
