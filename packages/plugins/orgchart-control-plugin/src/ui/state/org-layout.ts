import {
  TEAM_PALETTE,
  type OrgChartLayoutState,
  type Point,
  type TeamDefinition,
} from "../../shared/layout.js";

export const CARD_W = 260;
export const CARD_H = 118;
export const GAP_X = 54;
export const GAP_Y = 92;
export const PADDING = 84;

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
}

export interface AgentRecord {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  status: string;
  reportsTo: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  icon?: string | null;
  capabilities?: string | null;
}

export interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x: number;
  y: number;
  children: LayoutNode[];
}

export interface LayoutBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface TeamRegion {
  team: TeamDefinition;
  x: number;
  y: number;
  width: number;
  height: number;
  agentIds: string[];
}

function subtreeWidth(node: OrgNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenWidth = node.reports.reduce((sum, child) => sum + subtreeWidth(child), 0);
  const gaps = Math.max(0, node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenWidth + gaps);
}

function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
  const totalWidth = subtreeWidth(node);
  const children: LayoutNode[] = [];

  if (node.reports.length > 0) {
    const childrenWidth = node.reports.reduce((sum, child) => sum + subtreeWidth(child), 0);
    const gaps = Math.max(0, node.reports.length - 1) * GAP_X;
    let childX = x + (totalWidth - childrenWidth - gaps) / 2;

    for (const child of node.reports) {
      const childWidth = subtreeWidth(child);
      children.push(layoutTree(child, childX, y + CARD_H + GAP_Y));
      childX += childWidth + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    x: x + (totalWidth - CARD_W) / 2,
    y,
    children,
  };
}

export function layoutForest(roots: OrgNode[]): LayoutNode[] {
  let x = PADDING;
  const result: LayoutNode[] = [];
  for (const root of roots) {
    const width = subtreeWidth(root);
    result.push(layoutTree(root, x, PADDING));
    x += width + GAP_X;
  }
  return result;
}

export function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  const walk = (node: LayoutNode) => {
    result.push(node);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return result;
}

export function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  const walk = (node: LayoutNode) => {
    for (const child of node.children) {
      edges.push({ parent: node, child });
      walk(child);
    }
  };
  for (const node of nodes) walk(node);
  return edges;
}

export function applyManualPositions(nodes: LayoutNode[], positions: Record<string, Point>): LayoutNode[] {
  return nodes.map((node) => {
    const position = positions[node.id];
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
}

export function computeBounds(nodes: LayoutNode[]): LayoutBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 900, maxY: 640, width: 900, height: 640 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + CARD_W);
    maxY = Math.max(maxY, node.y + CARD_H);
  }
  minX = Math.min(0, minX - PADDING);
  minY = Math.min(0, minY - PADDING);
  maxX += PADDING;
  maxY += PADDING;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function walkOrg(node: OrgNode, visit: (node: OrgNode) => void) {
  visit(node);
  for (const child of node.reports) walkOrg(child, visit);
}

function subtreeIds(node: OrgNode): string[] {
  const ids: string[] = [];
  walkOrg(node, (entry) => ids.push(entry.id));
  return ids;
}

function slugPart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "team";
}

function teamIdForBranch(node: OrgNode): string {
  return `branch-${slugPart(node.name)}-${node.id}`;
}

function ensureTeam(
  teams: Record<string, TeamDefinition>,
  id: string,
  name: string,
  colorIndex: number,
) {
  if (teams[id]) return;
  teams[id] = {
    id,
    name,
    color: TEAM_PALETTE[colorIndex % TEAM_PALETTE.length] ?? "#4f46e5",
  };
}

export function withDerivedTeams(
  roots: OrgNode[],
  agents: AgentRecord[],
  layout: OrgChartLayoutState,
): OrgChartLayoutState {
  const teams = { ...layout.teams };
  const agentTeams = { ...layout.agentTeams };
  let colorIndex = Object.keys(teams).length;

  ensureTeam(teams, "leadership", "Leadership", colorIndex++);
  ensureTeam(teams, "unassigned", "Unassigned", colorIndex++);

  const assignMissing = (agentId: string, teamId: string) => {
    if (!agentTeams[agentId] && teams[teamId]) agentTeams[agentId] = teamId;
  };

  for (const root of roots) {
    assignMissing(root.id, "leadership");
    if (root.reports.length === 0) continue;
    for (const branch of root.reports) {
      const branchTeamId = teamIdForBranch(branch);
      ensureTeam(teams, branchTeamId, branch.name, colorIndex++);
      for (const agentId of subtreeIds(branch)) assignMissing(agentId, branchTeamId);
    }
  }

  for (const agent of agents) {
    if (!agentTeams[agent.id] || !teams[agentTeams[agent.id]]) {
      agentTeams[agent.id] = "unassigned";
    }
  }

  return {
    ...layout,
    teams,
    agentTeams,
  };
}

export function buildTeamRegions(
  nodes: LayoutNode[],
  layout: OrgChartLayoutState,
): TeamRegion[] {
  const byTeam = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const teamId = layout.agentTeams[node.id];
    if (!teamId || !layout.teams[teamId]) continue;
    const entries = byTeam.get(teamId) ?? [];
    entries.push(node);
    byTeam.set(teamId, entries);
  }

  const regions: TeamRegion[] = [];
  for (const [teamId, entries] of byTeam.entries()) {
    const team = layout.teams[teamId];
    if (!team || entries.length === 0) continue;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;
    for (const node of entries) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + CARD_W);
      maxY = Math.max(maxY, node.y + CARD_H);
    }
    const pad = 24;
    regions.push({
      team,
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      agentIds: entries.map((node) => node.id),
    });
  }

  return regions.sort((a, b) => a.team.name.localeCompare(b.team.name));
}
