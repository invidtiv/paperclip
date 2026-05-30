import { describe, expect, it } from "vitest";
import { estimateCodexApiCostUsd } from "./execute.js";

describe("estimateCodexApiCostUsd", () => {
  it("computes API-equivalent cost from token usage and per-million rates", () => {
    const cost = estimateCodexApiCostUsd(
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
      {
        inputPerMillionUsd: 1.25,
        cachedInputPerMillionUsd: 0.125,
        outputPerMillionUsd: 10,
      },
    );

    expect(cost).toBeCloseTo(11.375, 8);
  });

  it("rounds to 8 decimal places for stable ledger output", () => {
    const cost = estimateCodexApiCostUsd(
      {
        inputTokens: 12_345,
        cachedInputTokens: 67_890,
        outputTokens: 54_321,
      },
      {
        inputPerMillionUsd: 1.25,
        cachedInputPerMillionUsd: 0.125,
        outputPerMillionUsd: 10,
      },
    );

    expect(cost).toBe(Number(cost.toFixed(8)));
  });
});
