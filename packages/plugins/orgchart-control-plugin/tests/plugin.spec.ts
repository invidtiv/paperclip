import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import {
  LEGACY_POSITIONS_STATE_KEY,
  LAYOUT_STATE_KEY,
  type OrgChartLayoutState,
} from "../src/shared/layout.js";

describe("Org Chart Control Plugin", () => {
  it("declares page and sidebar slots", () => {
    expect(manifest.ui?.slots?.some((slot) => slot.type === "page")).toBe(true);
    expect(manifest.ui?.slots?.some((slot) => slot.type === "sidebar")).toBe(true);
  });

  it("migrates legacy positions into the versioned layout state", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);

    await harness.ctx.state.set({
      scopeKind: "company",
      scopeId: "comp-1",
      stateKey: LEGACY_POSITIONS_STATE_KEY,
    }, {
      "agent-1": { x: 10.2, y: 20.8 },
    });

    const layout = await harness.getData<OrgChartLayoutState>("layout", { companyId: "comp-1" });
    expect(layout.version).toBe(1);
    expect(layout.positions["agent-1"]).toEqual({ x: 10, y: 21 });
    expect(harness.getState({
      scopeKind: "company",
      scopeId: "comp-1",
      stateKey: LAYOUT_STATE_KEY,
    })).toMatchObject({
      version: 1,
      positions: { "agent-1": { x: 10, y: 21 } },
    });
  });

  it("saves grouped position changes as a batch", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);

    await harness.performAction("savePositionsBatch", {
      companyId: "comp-1",
      positions: {
        "agent-1": { x: 100, y: 200 },
        "agent-2": { x: 300, y: 400 },
      },
    });

    const layout = await harness.getData<OrgChartLayoutState>("layout", { companyId: "comp-1" });
    expect(layout.positions).toEqual({
      "agent-1": { x: 100, y: 200 },
      "agent-2": { x: 300, y: 400 },
    });
  });

  it("upserts teams and assigns selected agents", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);

    await harness.performAction("upsertTeam", {
      companyId: "comp-1",
      team: { id: "team-crm", name: "CRM", color: "#059669" },
    });
    await harness.performAction("assignAgentsToTeam", {
      companyId: "comp-1",
      teamId: "team-crm",
      agentIds: ["agent-1", "agent-2"],
    });

    const layout = await harness.getData<OrgChartLayoutState>("layout", { companyId: "comp-1" });
    expect(layout.teams["team-crm"]).toEqual({ id: "team-crm", name: "CRM", color: "#059669" });
    expect(layout.agentTeams).toMatchObject({
      "agent-1": "team-crm",
      "agent-2": "team-crm",
    });
  });

  it("resets versioned and legacy layout state", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);

    await harness.performAction("savePositionsBatch", {
      companyId: "comp-1",
      positions: { "agent-1": { x: 10, y: 20 } },
    });
    await harness.ctx.state.set({
      scopeKind: "company",
      scopeId: "comp-1",
      stateKey: LEGACY_POSITIONS_STATE_KEY,
    }, { "agent-legacy": { x: 1, y: 2 } });

    await harness.performAction("resetLayout", { companyId: "comp-1" });

    expect(harness.getState({
      scopeKind: "company",
      scopeId: "comp-1",
      stateKey: LAYOUT_STATE_KEY,
    })).toBeUndefined();
    expect(harness.getState({
      scopeKind: "company",
      scopeId: "comp-1",
      stateKey: LEGACY_POSITIONS_STATE_KEY,
    })).toBeUndefined();
  });
});
