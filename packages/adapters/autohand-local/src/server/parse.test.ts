import { describe, expect, it } from "vitest";
import { parseAutohandJsonl } from "./parse.js";

describe("parseAutohandJsonl cost aliases", () => {
  it("parses costUsd from method params camelCase alias", () => {
    const stdout = [
      JSON.stringify({
        method: "autohand.turnEnd",
        params: {
          tokensUsed: 42,
          costUsd: 0.0042,
        },
      }),
    ].join("\n");

    const parsed = parseAutohandJsonl(stdout);
    expect(parsed.costUsd).toBeCloseTo(0.0042, 8);
  });

  it("parses costUsd from result event camelCase alias", () => {
    const stdout = [
      JSON.stringify({
        type: "result",
        result: "done",
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.0015,
      }),
    ].join("\n");

    const parsed = parseAutohandJsonl(stdout);
    expect(parsed.costUsd).toBeCloseTo(0.0015, 8);
  });

  it("keeps snake_case precedence over camelCase when both are present", () => {
    const stdout = [
      JSON.stringify({
        type: "result",
        result: "done",
        total_cost_usd: 0.002,
        cost_usd: 0.001,
        costUsd: 0.009,
        cost: 0.5,
      }),
    ].join("\n");

    const parsed = parseAutohandJsonl(stdout);
    expect(parsed.costUsd).toBeCloseTo(0.002, 8);
  });

  it("parses ACP promptComplete and messageDelta events", () => {
    const stdout = [
      JSON.stringify({ event: "messageStart", data: { role: "assistant" } }),
      JSON.stringify({ event: "messageDelta", data: { content: "Hello " } }),
      JSON.stringify({ event: "messageDelta", data: { content: "world" } }),
      JSON.stringify({
        event: "promptComplete",
        data: {
          success: true,
          promptTokens: 10,
          completionTokens: 20,
          total_cost_usd: 0.003
        }
      })
    ].join("\n");

    const parsed = parseAutohandJsonl(stdout);
    expect(parsed.summary).toBe("Hello world");
    expect(parsed.usage.inputTokens).toBe(10);
    expect(parsed.usage.outputTokens).toBe(20);
    expect(parsed.costUsd).toBeCloseTo(0.003, 8);
  });
});
