import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  LEGACY_POSITIONS_STATE_KEY,
  LAYOUT_STATE_KEY,
  assignAgentsToTeam,
  createEmptyLayoutState,
  deleteTeam,
  mergePositions,
  normalizeLayoutState,
  normalizePositions,
  normalizeTeams,
  upsertTeam,
  type OrgChartLayoutState,
  type TeamDefinition,
} from "./shared/layout.js";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeSingleTeam(value: unknown): TeamDefinition | null {
  return Object.values(normalizeTeams({ candidate: value }))[0] ?? null;
}

async function loadLayout(ctx: PluginContext, companyId: string) {
  const current = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: LAYOUT_STATE_KEY,
  });
  const legacyPositions = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: LEGACY_POSITIONS_STATE_KEY,
  });
  const layout = normalizeLayoutState(current, legacyPositions);

  if (!current && Object.keys(layout.positions).length > 0) {
    await ctx.state.set({
      scopeKind: "company",
      scopeId: companyId,
      stateKey: LAYOUT_STATE_KEY,
    }, layout);
  }

  return layout;
}

async function saveLayoutState(
  ctx: PluginContext,
  companyId: string,
  layout: OrgChartLayoutState,
) {
  await ctx.state.set({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: LAYOUT_STATE_KEY,
  }, normalizeLayoutState(layout));
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Org chart control plugin setup");

    ctx.data.register("health", async () => {
      return { status: "ok", checkedAt: new Date().toISOString() };
    });

    ctx.data.register("layout", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId.trim() : "";
      if (!companyId) return createEmptyLayoutState();
      return await loadLayout(ctx, companyId);
    });

    ctx.actions.register("saveLayout", async (params) => {
      const companyId = requiredString(params.companyId, "companyId");
      const layout = normalizeLayoutState(params.layout);
      await saveLayoutState(ctx, companyId, layout);
      return { success: true, layout };
    });

    ctx.actions.register("savePositionsBatch", async (params) => {
      const companyId = requiredString(params.companyId, "companyId");
      const positions = normalizePositions(params.positions);
      const layout = mergePositions(await loadLayout(ctx, companyId), positions);
      await saveLayoutState(ctx, companyId, layout);
      return { success: true, layout };
    });

    ctx.actions.register("upsertTeam", async (params) => {
      const companyId = requiredString(params.companyId, "companyId");
      const teamInput = normalizeSingleTeam(params.team);
      if (!teamInput) throw new Error("team is required");
      const layout = upsertTeam(await loadLayout(ctx, companyId), teamInput);
      await saveLayoutState(ctx, companyId, layout);
      return { success: true, layout };
    });

    ctx.actions.register("assignAgentsToTeam", async (params) => {
      const companyId = requiredString(params.companyId, "companyId");
      const teamId = requiredString(params.teamId, "teamId");
      const agentIds = stringArray(params.agentIds);
      let layout = await loadLayout(ctx, companyId);
      const teamInput = normalizeSingleTeam(params.team);
      if (teamInput) {
        layout = upsertTeam(layout, teamInput);
      }
      if (!layout.teams[teamId]) throw new Error("team does not exist");
      layout = assignAgentsToTeam(layout, agentIds, teamId);
      await saveLayoutState(ctx, companyId, layout);
      return { success: true, layout };
    });

    ctx.actions.register("deleteTeam", async (params) => {
      const companyId = requiredString(params.companyId, "companyId");
      const teamId = requiredString(params.teamId, "teamId");
      const layout = deleteTeam(await loadLayout(ctx, companyId), teamId);
      await saveLayoutState(ctx, companyId, layout);
      return { success: true, layout };
    });

    ctx.actions.register("resetLayout", async (params) => {
      const companyId = requiredString(params.companyId, "companyId");
      await ctx.state.delete({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: LAYOUT_STATE_KEY,
      });
      await ctx.state.delete({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: LEGACY_POSITIONS_STATE_KEY,
      });
      return { success: true, layout: createEmptyLayoutState() };
    });
  },

  async onHealth() {
    return { status: "ok", message: "Org chart control plugin worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
