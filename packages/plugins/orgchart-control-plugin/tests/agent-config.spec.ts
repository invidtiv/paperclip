import { describe, expect, it } from "vitest";
import {
  buildProviderModelPatch,
  getDefaultCommandForAdapter,
} from "../src/ui/state/agent-config.js";
import type { AgentRecord } from "../src/ui/state/org-layout.js";

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    companyId: "comp-1",
    name: "Backend Engineer",
    role: "general",
    title: null,
    status: "idle",
    reportsTo: null,
    adapterType: "codex_local",
    adapterConfig: {
      model: "gpt-5",
      command: "codex",
      cwd: "/repo",
      env: { NODE_ENV: "test" },
      modelReasoningEffort: "high",
      fastMode: true,
    },
    runtimeConfig: {
      modelProfiles: {
        cheap: {
          enabled: true,
          adapterConfig: { model: "gpt-5-mini" },
        },
      },
      heartbeat: { enabled: true },
    },
    ...overrides,
  };
}

describe("provider/model patch builder", () => {
  it("updates only the model for the current provider while replacing stale model keys cleanly", () => {
    const patch = buildProviderModelPatch(agent(), {
      adapterType: "codex_local",
      model: "gpt-5.4",
    });

    expect(patch).toMatchObject({
      adapterConfig: {
        model: "gpt-5.4",
        command: "codex",
        cwd: "/repo",
        modelReasoningEffort: "high",
      },
      replaceAdapterConfig: true,
    });
    expect(patch).not.toHaveProperty("adapterType");
  });

  it("switches provider by preserving agnostic fields and replacing adapter-specific fields", () => {
    const patch = buildProviderModelPatch(agent(), {
      adapterType: "autohand_local",
      model: "auto",
    });

    expect(patch).toMatchObject({
      adapterType: "autohand_local",
      adapterConfig: {
        model: "auto",
        command: "autohand",
        cwd: "/repo",
        env: { NODE_ENV: "test" },
      },
      replaceAdapterConfig: true,
      runtimeConfig: {
        heartbeat: { enabled: true },
      },
    });
    expect(patch.adapterConfig).not.toHaveProperty("modelReasoningEffort");
    expect(patch.adapterConfig).not.toHaveProperty("fastMode");
    expect(JSON.stringify(patch.runtimeConfig)).not.toContain("cheap");
  });

  it("knows command fields for local providers including Hermes", () => {
    expect(getDefaultCommandForAdapter("codex_local")).toEqual({ key: "command", value: "codex" });
    expect(getDefaultCommandForAdapter("hermes_local")).toEqual({ key: "hermesCommand", value: "hermes" });
  });
});
