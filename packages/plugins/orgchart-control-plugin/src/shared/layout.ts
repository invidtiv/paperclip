export const LAYOUT_STATE_KEY = "orgchart-control.layout.v1";
export const LEGACY_POSITIONS_STATE_KEY = "positions";

export const TEAM_PALETTE = [
  "#4f46e5",
  "#059669",
  "#dc2626",
  "#d97706",
  "#0891b2",
  "#7c3aed",
  "#be123c",
  "#65a30d",
] as const;

export interface Point {
  x: number;
  y: number;
}

export interface TeamDefinition {
  id: string;
  name: string;
  color: string;
  collapsed?: boolean;
}

export interface OrgChartViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface OrgChartLayoutState {
  version: 1;
  teams: Record<string, TeamDefinition>;
  agentTeams: Record<string, string>;
  positions: Record<string, Point>;
  viewport?: OrgChartViewport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function createEmptyLayoutState(): OrgChartLayoutState {
  return {
    version: 1,
    teams: {},
    agentTeams: {},
    positions: {},
  };
}

export function normalizeColor(value: unknown, fallbackIndex = 0): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  return TEAM_PALETTE[fallbackIndex % TEAM_PALETTE.length] ?? "#4f46e5";
}

export function normalizePositions(value: unknown): Record<string, Point> {
  if (!isRecord(value)) return {};
  const positions: Record<string, Point> = {};
  for (const [agentId, rawPoint] of Object.entries(value)) {
    if (!agentId || !isRecord(rawPoint)) continue;
    const x = asFiniteNumber(rawPoint.x);
    const y = asFiniteNumber(rawPoint.y);
    if (x === null || y === null) continue;
    positions[agentId] = {
      x: Math.round(x),
      y: Math.round(y),
    };
  }
  return positions;
}

export function normalizeTeams(value: unknown): Record<string, TeamDefinition> {
  if (!isRecord(value)) return {};
  const teams: Record<string, TeamDefinition> = {};
  let index = 0;
  for (const [teamId, rawTeam] of Object.entries(value)) {
    if (!teamId || !isRecord(rawTeam)) continue;
    const id = typeof rawTeam.id === "string" && rawTeam.id.trim() ? rawTeam.id.trim() : teamId;
    const name = typeof rawTeam.name === "string" && rawTeam.name.trim() ? rawTeam.name.trim() : "Team";
    teams[id] = {
      id,
      name,
      color: normalizeColor(rawTeam.color, index),
      ...(typeof rawTeam.collapsed === "boolean" ? { collapsed: rawTeam.collapsed } : {}),
    };
    index += 1;
  }
  return teams;
}

export function normalizeAgentTeams(value: unknown, teams: Record<string, TeamDefinition>): Record<string, string> {
  if (!isRecord(value)) return {};
  const agentTeams: Record<string, string> = {};
  for (const [agentId, rawTeamId] of Object.entries(value)) {
    if (!agentId || typeof rawTeamId !== "string" || !teams[rawTeamId]) continue;
    agentTeams[agentId] = rawTeamId;
  }
  return agentTeams;
}

export function normalizeViewport(value: unknown): OrgChartViewport | undefined {
  if (!isRecord(value)) return undefined;
  const x = asFiniteNumber(value.x);
  const y = asFiniteNumber(value.y);
  const zoom = asFiniteNumber(value.zoom);
  if (x === null || y === null || zoom === null) return undefined;
  return {
    x,
    y,
    zoom: Math.min(Math.max(zoom, 0.15), 2.5),
  };
}

export function normalizeLayoutState(value: unknown, legacyPositions?: unknown): OrgChartLayoutState {
  const state = createEmptyLayoutState();
  if (isRecord(value) && value.version === 1) {
    state.teams = normalizeTeams(value.teams);
    state.agentTeams = normalizeAgentTeams(value.agentTeams, state.teams);
    state.positions = normalizePositions(value.positions);
    state.viewport = normalizeViewport(value.viewport);
  }

  if (Object.keys(state.positions).length === 0) {
    state.positions = normalizePositions(legacyPositions);
  }

  return state;
}

export function mergePositions(
  state: OrgChartLayoutState,
  positions: Record<string, Point>,
): OrgChartLayoutState {
  return {
    ...state,
    positions: {
      ...state.positions,
      ...normalizePositions(positions),
    },
  };
}

export function upsertTeam(state: OrgChartLayoutState, team: TeamDefinition): OrgChartLayoutState {
  const normalized = normalizeTeams({ [team.id]: team })[team.id];
  if (!normalized) return state;
  return {
    ...state,
    teams: {
      ...state.teams,
      [normalized.id]: normalized,
    },
  };
}

export function assignAgentsToTeam(
  state: OrgChartLayoutState,
  agentIds: string[],
  teamId: string,
): OrgChartLayoutState {
  if (!state.teams[teamId]) return state;
  const nextAgentTeams = { ...state.agentTeams };
  for (const agentId of agentIds) {
    if (agentId) nextAgentTeams[agentId] = teamId;
  }
  return {
    ...state,
    agentTeams: nextAgentTeams,
  };
}

export function deleteTeam(state: OrgChartLayoutState, teamId: string): OrgChartLayoutState {
  const nextTeams = { ...state.teams };
  delete nextTeams[teamId];
  const nextAgentTeams: Record<string, string> = {};
  for (const [agentId, assignedTeamId] of Object.entries(state.agentTeams)) {
    if (assignedTeamId !== teamId && nextTeams[assignedTeamId]) {
      nextAgentTeams[agentId] = assignedTeamId;
    }
  }
  return {
    ...state,
    teams: nextTeams,
    agentTeams: nextAgentTeams,
  };
}
