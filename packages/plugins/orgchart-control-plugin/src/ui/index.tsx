import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  useHostContext,
  useHostNavigation,
  usePluginAction,
  usePluginData,
} from "@paperclipai/plugin-sdk/ui";
import {
  createEmptyLayoutState,
  mergePositions,
  normalizeLayoutState,
  type OrgChartLayoutState,
  type Point,
  type TeamDefinition,
} from "../shared/layout.js";
import {
  CARD_H,
  CARD_W,
  applyManualPositions,
  buildTeamRegions,
  collectEdges,
  computeBounds,
  flattenLayout,
  layoutForest,
  withDerivedTeams,
  type AgentRecord,
  type LayoutNode,
  type OrgNode,
} from "./state/org-layout.js";
import {
  moveSelectedPositions,
  normalizeRect,
  positionMapFromNodes,
  selectNodesInRect,
  toggleSelection,
  type Rect,
} from "./state/selection.js";
import {
  buildProviderModelPatch,
  getDefaultCommandForAdapter,
  getDefaultModelForAdapter,
  readAgentModel,
} from "./state/agent-config.js";

const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.2;
const MOVE_THRESHOLD = 3;

interface LiveRun {
  id: string;
  agentId: string;
  status: string;
}

interface AdapterInfo {
  type: string;
  label?: string;
  loaded?: boolean;
  disabled?: boolean;
}

interface AdapterModel {
  id: string;
  label?: string;
}

type DragState =
  | {
      type: "pan";
      pointerId: number;
      startClient: Point;
      startPan: Point;
    }
  | {
      type: "nodes";
      pointerId: number;
      startWorld: Point;
      selectedIds: string[];
      startPositions: Record<string, Point>;
      moved: boolean;
      previewPositions: Record<string, Point>;
    }
  | {
      type: "lasso";
      pointerId: number;
      additive: boolean;
      startWorld: Point;
      currentWorld: Point;
    };

function IconButtonGlyph({ name }: { name: "network" | "gear" | "plus" | "minus" | "fit" | "move" | "target" }) {
  const common = {
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { width: 15, height: 15, display: "block" },
  };
  if (name === "gear") {
    return (
      <svg {...common}>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 1 1-2.98 2.98l-.04-.04A1.8 1.8 0 0 0 14.8 19.6a1.8 1.8 0 0 0-1.08 1.65V21.4a2.1 2.1 0 1 1-4.2 0v-.06A1.8 1.8 0 0 0 8.44 19.7a1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 1 1-2.98-2.98l.04-.04A1.8 1.8 0 0 0 3.84 15a1.8 1.8 0 0 0-1.65-1.08H2.1a2.1 2.1 0 1 1 0-4.2h.09a1.8 1.8 0 0 0 1.65-1.08 1.8 1.8 0 0 0-.36-1.98l-.04-.04a2.1 2.1 0 1 1 2.98-2.98l.04.04a1.8 1.8 0 0 0 1.98.36h.02A1.8 1.8 0 0 0 9.52 2.4V2.1a2.1 2.1 0 1 1 4.2 0v.3a1.8 1.8 0 0 0 1.08 1.64 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 1 1 2.98 2.98l-.04.04a1.8 1.8 0 0 0-.36 1.98v.02a1.8 1.8 0 0 0 1.65 1.06h.85a2.1 2.1 0 1 1 0 4.2h-.85A1.8 1.8 0 0 0 19.4 15Z" />
      </svg>
    );
  }
  if (name === "network") {
    return (
      <svg {...common}>
        <rect x="9" y="3" width="6" height="5" rx="1" />
        <rect x="3" y="16" width="6" height="5" rx="1" />
        <rect x="15" y="16" width="6" height="5" rx="1" />
        <path d="M12 8v4M6 16v-4h12v4" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "minus") {
    return (
      <svg {...common}>
        <path d="M5 12h14" />
      </svg>
    );
  }
  if (name === "fit") {
    return (
      <svg {...common}>
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      </svg>
    );
  }
  if (name === "target") {
    return (
      <svg {...common}>
        <path d="M4 4h6M4 4v6M20 20h-6M20 20v-6M20 4h-6M20 4v6M4 20h6M4 20v-6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M8 7h12m0 0-4-4m4 4-4 4M16 17H4m0 0 4 4m-4-4 4-4" />
    </svg>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function agentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "AG";
}

function statusColor(status: string, running: boolean) {
  if (running) return "#22d3ee";
  if (status === "active") return "#4ade80";
  if (status === "paused" || status === "idle") return "#facc15";
  if (status === "error") return "#f87171";
  if (status === "pending_approval") return "#fb923c";
  if (status === "terminated") return "#a3a3a3";
  return "#a3a3a3";
}

function readableAdapter(adapterType: string) {
  return adapterType.replace(/_local$/, "").replace(/_/g, " ");
}

function makeTeamId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `custom-${slug || "team"}-${Date.now().toString(36)}`;
}

export function SidebarLink() {
  const { linkProps } = useHostNavigation();
  const context = useHostContext();
  if (!context.companyPrefix) return null;

  return (
    <a
      {...linkProps("/interactive-org-chart")}
      className="flex items-center gap-2.5 px-3 py-2 pointer-coarse:py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
    >
      <IconButtonGlyph name="network" />
      <span className="truncate">Interactive Org Chart</span>
    </a>
  );
}

export function InteractiveOrgChartPage() {
  const context = useHostContext();
  const companyId = context.companyId;
  const { navigate } = useHostNavigation();

  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [orgTree, setOrgTree] = useState<OrgNode[]>([]);
  const [liveRuns, setLiveRuns] = useState<LiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<OrgChartLayoutState>(() => createEmptyLayoutState());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lassoMode, setLassoMode] = useState(false);
  const [dragPreviewPositions, setDragPreviewPositions] = useState<Record<string, Point>>({});
  const [lassoRect, setLassoRect] = useState<Rect | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const initializedViewRef = useRef(false);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const { data: savedLayout, refresh: refreshLayout } = usePluginData<OrgChartLayoutState>(
    "layout",
    { companyId },
  );
  const savePositionsBatch = usePluginAction("savePositionsBatch");
  const assignAgentsToTeamAction = usePluginAction("assignAgentsToTeam");
  const upsertTeamAction = usePluginAction("upsertTeam");
  const deleteTeamAction = usePluginAction("deleteTeam");
  const resetLayoutAction = usePluginAction("resetLayout");

  const applyActionLayout = useCallback((result: unknown) => {
    if (!isRecord(result)) return;
    setLayoutDraft(normalizeLayoutState(result.layout));
  }, []);

  const fetchBackendData = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [agentsData, orgData, runsData] = await Promise.all([
        fetchJson<AgentRecord[]>(`/api/companies/${encodeURIComponent(companyId)}/agents`),
        fetchJson<OrgNode[]>(`/api/companies/${encodeURIComponent(companyId)}/org`),
        fetchJson<LiveRun[]>(`/api/companies/${encodeURIComponent(companyId)}/live-runs`),
      ]);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      setOrgTree(Array.isArray(orgData) ? orgData : []);
      setLiveRuns(Array.isArray(runsData) ? runsData : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load org chart data");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void fetchBackendData();
  }, [fetchBackendData]);

  useEffect(() => {
    if (!companyId) return;
    const timer = window.setInterval(() => {
      void fetchJson<LiveRun[]>(`/api/companies/${encodeURIComponent(companyId)}/live-runs`)
        .then((runs) => setLiveRuns(Array.isArray(runs) ? runs : []))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [companyId]);

  useEffect(() => {
    if (savedLayout) setLayoutDraft(normalizeLayoutState(savedLayout));
  }, [savedLayout]);

  const agentMap = useMemo(() => {
    const map = new Map<string, AgentRecord>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const liveRunAgents = useMemo(() => {
    const set = new Set<string>();
    for (const run of liveRuns) {
      if (run.status === "queued" || run.status === "running") set.add(run.agentId);
    }
    return set;
  }, [liveRuns]);

  const effectiveLayout = useMemo(
    () => withDerivedTeams(orgTree, agents, layoutDraft),
    [orgTree, agents, layoutDraft],
  );

  const autoLayout = useMemo(() => layoutForest(orgTree), [orgTree]);
  const autoNodes = useMemo(() => flattenLayout(autoLayout), [autoLayout]);
  const allPositions = useMemo(
    () => ({ ...effectiveLayout.positions, ...dragPreviewPositions }),
    [effectiveLayout.positions, dragPreviewPositions],
  );
  const positionedNodes = useMemo(
    () => applyManualPositions(autoNodes, allPositions),
    [autoNodes, allPositions],
  );
  const nodePositionMap = useMemo(() => positionMapFromNodes(positionedNodes), [positionedNodes]);
  const edges = useMemo(() => collectEdges(autoLayout), [autoLayout]);
  const bounds = useMemo(() => computeBounds(positionedNodes), [positionedNodes]);
  const teamRegions = useMemo(
    () => buildTeamRegions(positionedNodes, effectiveLayout),
    [positionedNodes, effectiveLayout],
  );

  const selectedAgents = useMemo(
    () => selectedIds.map((id) => agentMap.get(id)).filter((agent): agent is AgentRecord => Boolean(agent)),
    [selectedIds, agentMap],
  );

  const pointerToWorld = useCallback((event: ReactPointerEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const fitZoom = Math.min(
      (container.clientWidth - 48) / Math.max(bounds.width, 1),
      (container.clientHeight - 48) / Math.max(bounds.height, 1),
      1,
    );
    setZoom(clampZoom(fitZoom));
    setPan({
      x: (container.clientWidth - bounds.width * fitZoom) / 2 - bounds.minX * fitZoom,
      y: (container.clientHeight - bounds.height * fitZoom) / 2 - bounds.minY * fitZoom,
    });
  }, [bounds]);

  useEffect(() => {
    if (initializedViewRef.current || positionedNodes.length === 0) return;
    initializedViewRef.current = true;
    window.requestAnimationFrame(fitToScreen);
  }, [fitToScreen, positionedNodes.length]);

  const zoomToward = useCallback((nextZoom: number, point: Point) => {
    const clamped = clampZoom(nextZoom);
    const scale = clamped / zoom;
    setPan({
      x: point.x - scale * (point.x - pan.x),
      y: point.y - scale * (point.y - pan.y),
    });
    setZoom(clamped);
  }, [pan, zoom]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomToward(zoom * (event.deltaY < 0 ? 1.1 : 0.9), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }, [zoom, zoomToward]);

  const handleViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-card]") || target.closest("[data-canvas-control]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (lassoMode) {
      const world = pointerToWorld(event);
      dragRef.current = {
        type: "lasso",
        pointerId: event.pointerId,
        additive: event.shiftKey || event.ctrlKey || event.metaKey,
        startWorld: world,
        currentWorld: world,
      };
      setLassoRect({ x1: world.x, y1: world.y, x2: world.x, y2: world.y });
      return;
    }
    dragRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: pan,
    };
  }, [lassoMode, pan, pointerToWorld]);

  const handleNodePointerDown = useCallback((node: LayoutNode, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-settings-button]")) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const nextSelection = additive
      ? toggleSelection(selectedIds, node.id, true)
      : selectedIds.includes(node.id)
        ? selectedIds
        : [node.id];
    setSelectedIds(nextSelection);

    dragRef.current = {
      type: "nodes",
      pointerId: event.pointerId,
      startWorld: pointerToWorld(event),
      selectedIds: nextSelection,
      startPositions: nodePositionMap,
      moved: false,
      previewPositions: {},
    };
  }, [nodePositionMap, pointerToWorld, selectedIds]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.type === "pan") {
      setPan({
        x: drag.startPan.x + event.clientX - drag.startClient.x,
        y: drag.startPan.y + event.clientY - drag.startClient.y,
      });
      return;
    }
    if (drag.type === "lasso") {
      const world = pointerToWorld(event);
      drag.currentWorld = world;
      setLassoRect({
        x1: drag.startWorld.x,
        y1: drag.startWorld.y,
        x2: world.x,
        y2: world.y,
      });
      return;
    }
    const world = pointerToWorld(event);
    const delta = {
      x: world.x - drag.startWorld.x,
      y: world.y - drag.startWorld.y,
    };
    if (Math.hypot(delta.x, delta.y) > MOVE_THRESHOLD) drag.moved = true;
    const preview = moveSelectedPositions(drag.startPositions, drag.selectedIds, delta);
    drag.previewPositions = preview;
    setDragPreviewPositions(preview);
  }, [pointerToWorld]);

  const commitDragPositions = useCallback(async (positions: Record<string, Point>) => {
    if (!companyId || Object.keys(positions).length === 0) return;
    setLayoutDraft((current) => mergePositions(current, positions));
    try {
      const result = await savePositionsBatch({ companyId, positions });
      applyActionLayout(result);
      refreshLayout();
    } catch (error) {
      console.error("Failed to save org chart positions", error);
      refreshLayout();
    }
  }, [applyActionLayout, companyId, refreshLayout, savePositionsBatch]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.type === "nodes") {
      const positions = drag.previewPositions;
      dragRef.current = null;
      setDragPreviewPositions({});
      if (drag.moved) void commitDragPositions(positions);
      return;
    }
    if (drag.type === "lasso") {
      const selected = selectNodesInRect(positionedNodes, {
        x1: drag.startWorld.x,
        y1: drag.startWorld.y,
        x2: drag.currentWorld.x,
        y2: drag.currentWorld.y,
      });
      setSelectedIds((current) => {
        if (!drag.additive) return selected;
        return Array.from(new Set([...current, ...selected]));
      });
      dragRef.current = null;
      setLassoRect(null);
      return;
    }
    dragRef.current = null;
  }, [commitDragPositions, positionedNodes]);

  const handleAssignTeam = useCallback(async (teamId: string) => {
    if (!companyId || selectedIds.length === 0) return;
    try {
      const result = await assignAgentsToTeamAction({ companyId, agentIds: selectedIds, teamId });
      applyActionLayout(result);
      refreshLayout();
    } catch (error) {
      console.error("Failed to assign team", error);
    }
  }, [applyActionLayout, assignAgentsToTeamAction, companyId, refreshLayout, selectedIds]);

  const handleUpsertTeam = useCallback(async (team: TeamDefinition) => {
    if (!companyId) return;
    try {
      const result = await upsertTeamAction({ companyId, team });
      applyActionLayout(result);
      refreshLayout();
    } catch (error) {
      console.error("Failed to save team", error);
    }
  }, [applyActionLayout, companyId, refreshLayout, upsertTeamAction]);

  const handleDeleteTeam = useCallback(async (teamId: string) => {
    if (!companyId) return;
    try {
      const result = await deleteTeamAction({ companyId, teamId });
      applyActionLayout(result);
      refreshLayout();
    } catch (error) {
      console.error("Failed to delete team", error);
    }
  }, [applyActionLayout, companyId, deleteTeamAction, refreshLayout]);

  const handleResetLayout = useCallback(async () => {
    if (!companyId) return;
    setSelectedIds([]);
    setDragPreviewPositions({});
    try {
      const result = await resetLayoutAction({ companyId });
      applyActionLayout(result);
      refreshLayout();
    } catch (error) {
      console.error("Failed to reset org chart layout", error);
    }
  }, [applyActionLayout, companyId, refreshLayout, resetLayoutAction]);

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Select a company.</div>;
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading org chart...</div>;
  }

  if (loadError) {
    return <div className="p-6 text-sm text-destructive">{loadError}</div>;
  }

  if (positionedNodes.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">No agents in this company.</div>;
  }

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  const lassoBox = lassoRect ? normalizeRect(lassoRect) : null;

  return (
    <div className="flex h-[calc(100vh-10rem)] min-h-[560px] flex-col gap-3 md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
              lassoMode
                ? "border-foreground/30 bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setLassoMode((value) => !value)}
          >
            <IconButtonGlyph name="target" />
            Select
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={fitToScreen}
          >
            <IconButtonGlyph name="fit" />
            Fit
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            onClick={handleResetLayout}
          >
            Reset layout
          </button>
          <span className="ml-auto text-xs text-muted-foreground">
            {selectedIds.length === 0 ? "No selection" : `${selectedIds.length} selected`}
          </span>
        </div>

        <div
          ref={containerRef}
          data-testid="orgchart-control-canvas"
          className="relative min-h-0 flex-1 overflow-hidden border border-border bg-muted/20"
          style={{ cursor: lassoMode ? "crosshair" : "grab", touchAction: "none" }}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          <div data-canvas-control className="absolute right-3 top-3 z-30 flex flex-col gap-1.5">
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded border border-border bg-background text-sm transition-colors hover:bg-accent"
              onClick={() => {
                const c = containerRef.current;
                if (c) zoomToward(zoom * 1.2, { x: c.clientWidth / 2, y: c.clientHeight / 2 });
              }}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <IconButtonGlyph name="plus" />
            </button>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded border border-border bg-background text-sm transition-colors hover:bg-accent"
              onClick={() => {
                const c = containerRef.current;
                if (c) zoomToward(zoom * 0.8, { x: c.clientWidth / 2, y: c.clientHeight / 2 });
              }}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <IconButtonGlyph name="minus" />
            </button>
          </div>

          <svg className="absolute inset-0 pointer-events-none h-full w-full">
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {edges.map(({ parent, child }) => {
                const parentPosition = nodePositionMap[parent.id] ?? parent;
                const childPosition = nodePositionMap[child.id] ?? child;
                const x1 = parentPosition.x + CARD_W / 2;
                const y1 = parentPosition.y + CARD_H;
                const x2 = childPosition.x + CARD_W / 2;
                const y2 = childPosition.y;
                const midY = (y1 + y2) / 2;
                return (
                  <path
                    key={`${parent.id}-${child.id}`}
                    d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={1.4}
                  />
                );
              })}
            </g>
          </svg>

          <div className="absolute inset-0" style={{ transform, transformOrigin: "0 0" }}>
            {teamRegions.map((region) => (
              <div
                key={region.team.id}
                className="absolute pointer-events-none border bg-background/30"
                style={{
                  left: region.x,
                  top: region.y,
                  width: region.width,
                  height: region.height,
                  borderColor: `${region.team.color}88`,
                  backgroundColor: `${region.team.color}12`,
                }}
              >
                <div
                  className="absolute left-3 top-2 rounded border bg-background/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style={{ borderColor: `${region.team.color}88`, color: region.team.color }}
                >
                  {region.team.name}
                </div>
              </div>
            ))}

            {positionedNodes.map((node) => {
              const agent = agentMap.get(node.id);
              const team = effectiveLayout.teams[effectiveLayout.agentTeams[node.id] ?? ""];
              const selected = selectedIds.includes(node.id);
              const running = liveRunAgents.has(node.id);
              const color = team?.color ?? "#737373";
              const style: CSSProperties = {
                left: node.x,
                top: node.y,
                width: CARD_W,
                minHeight: CARD_H,
                borderColor: selected ? color : "var(--border)",
                boxShadow: selected ? `0 0 0 2px ${color}55` : undefined,
              };
              return (
                <div
                  key={node.id}
                  data-node-card
                  className="absolute select-none border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow] hover:border-foreground/30"
                  style={style}
                  onPointerDown={(event) => handleNodePointerDown(node, event)}
                >
                  <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: color }} />
                  <button
                    type="button"
                    data-settings-button
                    className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      navigate(`/agents/${node.id}`);
                    }}
                    aria-label={`Open ${node.name} settings`}
                    title="Open agent settings"
                  >
                    <IconButtonGlyph name="gear" />
                  </button>
                  <div className="flex gap-3 px-4 py-3 pl-5">
                    <div className="relative shrink-0">
                      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground/75">
                        {agentInitials(node.name)}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card ${running ? "animate-pulse" : ""}`}
                        style={{ backgroundColor: statusColor(node.status, running) }}
                      />
                    </div>
                    <div className="min-w-0 flex-1 pr-7">
                      <div className="truncate text-sm font-semibold leading-tight">{node.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {agent?.title || node.role}
                      </div>
                      {agent && (
                        <div className="mt-2 min-w-0 space-y-0.5 font-mono text-[10px] leading-tight text-muted-foreground/75">
                          <div className="truncate">{readableAdapter(agent.adapterType)}</div>
                          <div className="truncate">{readAgentModel(agent) || "default model"}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {lassoBox && (
              <div
                className="absolute border border-foreground/50 bg-foreground/10"
                style={{
                  left: lassoBox.x,
                  top: lassoBox.y,
                  width: lassoBox.width,
                  height: lassoBox.height,
                }}
              />
            )}
          </div>
        </div>
      </div>

      <InspectorPanel
        companyId={companyId}
        agents={agents}
        selectedAgents={selectedAgents}
        layout={effectiveLayout}
        onSelectAgents={setSelectedIds}
        onAssignTeam={handleAssignTeam}
        onUpsertTeam={handleUpsertTeam}
        onDeleteTeam={handleDeleteTeam}
        onAgentsChanged={fetchBackendData}
      />
    </div>
  );
}

function InspectorPanel({
  companyId,
  agents,
  selectedAgents,
  layout,
  onSelectAgents,
  onAssignTeam,
  onUpsertTeam,
  onDeleteTeam,
  onAgentsChanged,
}: {
  companyId: string;
  agents: AgentRecord[];
  selectedAgents: AgentRecord[];
  layout: OrgChartLayoutState;
  onSelectAgents: (ids: string[]) => void;
  onAssignTeam: (teamId: string) => void | Promise<void>;
  onUpsertTeam: (team: TeamDefinition) => void | Promise<void>;
  onDeleteTeam: (teamId: string) => void | Promise<void>;
  onAgentsChanged: () => void | Promise<void>;
}) {
  const teams = Object.values(layout.teams).sort((a, b) => a.name.localeCompare(b.name));
  const singleAgent = selectedAgents.length === 1 ? selectedAgents[0] : null;
  const selectedTeamId =
    selectedAgents.length > 0
      ? layout.agentTeams[selectedAgents[0]!.id] ?? ""
      : "";

  return (
    <aside className="flex max-h-[45%] w-full shrink-0 flex-col border border-border bg-background/70 md:max-h-none md:w-[340px]">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-semibold">Org Control</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {selectedAgents.length === 0 ? `${agents.length} agents` : `${selectedAgents.length} selected`}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <section className="border-b border-border px-4 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Selection</div>
          {selectedAgents.length === 0 ? (
            <div className="text-sm text-muted-foreground">Select agents on the canvas.</div>
          ) : (
            <div className="space-y-2">
              <div className="max-h-32 space-y-1 overflow-auto">
                {selectedAgents.map((agent) => {
                  const team = layout.teams[layout.agentTeams[agent.id] ?? ""];
                  return (
                    <button
                      type="button"
                      key={agent.id}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent/50"
                      onClick={() => onSelectAgents([agent.id])}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: team?.color ?? "#737373" }} />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    </button>
                  );
                })}
              </div>
              <select
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                value={selectedTeamId}
                onChange={(event) => void onAssignTeam(event.target.value)}
              >
                <option value="" disabled>Assign team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          )}
        </section>

        {singleAgent && (
          <section className="border-b border-border px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider</div>
            <ProviderModelControls
              key={singleAgent.id}
              agent={singleAgent}
              companyId={companyId}
              onSaved={onAgentsChanged}
            />
          </section>
        )}

        <TeamEditor
          teams={teams}
          agentCountByTeam={agents.reduce<Record<string, number>>((counts, agent) => {
            const teamId = layout.agentTeams[agent.id];
            if (teamId) counts[teamId] = (counts[teamId] ?? 0) + 1;
            return counts;
          }, {})}
          onSelectTeam={(teamId) => {
            const ids = agents.filter((agent) => layout.agentTeams[agent.id] === teamId).map((agent) => agent.id);
            onSelectAgents(ids);
          }}
          onUpsertTeam={onUpsertTeam}
          onDeleteTeam={onDeleteTeam}
        />
      </div>
    </aside>
  );
}

function ProviderModelControls({
  agent,
  companyId,
  onSaved,
}: {
  agent: AgentRecord;
  companyId: string;
  onSaved: () => void | Promise<void>;
}) {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [adapterType, setAdapterType] = useState(agent.adapterType);
  const [models, setModels] = useState<AdapterModel[]>([]);
  const [model, setModel] = useState(readAgentModel(agent));
  const [customModel, setCustomModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setAdapterType(agent.adapterType);
    setModel(readAgentModel(agent));
    setCustomModel("");
  }, [agent]);

  useEffect(() => {
    void fetchJson<AdapterInfo[]>("/api/adapters")
      .then((data) => setAdapters(Array.isArray(data) ? data : []))
      .catch((error) => setStatus(error instanceof Error ? error.message : "Failed to load adapters"));
  }, []);

  useEffect(() => {
    setStatus(null);
    void fetchJson<AdapterModel[]>(
      `/api/companies/${encodeURIComponent(companyId)}/adapters/${encodeURIComponent(adapterType)}/models`,
    )
      .then((data) => setModels(Array.isArray(data) ? data : []))
      .catch((error) => {
        setModels([]);
        setStatus(error instanceof Error ? error.message : "Failed to load models");
      });
  }, [adapterType, companyId]);

  const adapterOptions = useMemo(
    () => adapters.filter((adapter) => adapter.type === adapterType || (adapter.loaded !== false && adapter.disabled !== true)),
    [adapters, adapterType],
  );
  const selectedModel = customModel.trim() || model;
  const currentCommand = getDefaultCommandForAdapter(adapterType);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const patch = buildProviderModelPatch(agent, { adapterType, model: selectedModel });
      await fetchJson<AgentRecord>(`/api/agents/${encodeURIComponent(agent.id)}?companyId=${encodeURIComponent(companyId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setStatus("Saved");
      await onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-xs text-muted-foreground">Provider</span>
        <select
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          value={adapterType}
          onChange={(event) => {
            const nextType = event.target.value;
            setAdapterType(nextType);
            setModel(getDefaultModelForAdapter(nextType));
            setCustomModel("");
          }}
        >
          {adapterOptions.map((adapter) => (
            <option key={adapter.type} value={adapter.type}>
              {adapter.label || adapter.type}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted-foreground">Model</span>
        <select
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm"
          value={customModel ? "__custom__" : model}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "__custom__") {
              setCustomModel(model);
              return;
            }
            setCustomModel("");
            setModel(value);
          }}
        >
          <option value="">Adapter default</option>
          {models.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label || entry.id}</option>
          ))}
          {model && !models.some((entry) => entry.id === model) && (
            <option value={model}>{model}</option>
          )}
          <option value="__custom__">Custom model...</option>
        </select>
      </label>

      {customModel !== "" && (
        <input
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm"
          value={customModel}
          onChange={(event) => setCustomModel(event.target.value)}
          placeholder="provider/model"
        />
      )}

      {currentCommand && (
        <div className="rounded border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">Command </span>
          <span className="font-mono">{currentCommand.key}: {currentCommand.value}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {status && <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{status}</span>}
      </div>
    </div>
  );
}

function TeamEditor({
  teams,
  agentCountByTeam,
  onSelectTeam,
  onUpsertTeam,
  onDeleteTeam,
}: {
  teams: TeamDefinition[];
  agentCountByTeam: Record<string, number>;
  onSelectTeam: (teamId: string) => void;
  onUpsertTeam: (team: TeamDefinition) => void | Promise<void>;
  onDeleteTeam: (teamId: string) => void | Promise<void>;
}) {
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState("#4f46e5");

  return (
    <section className="px-4 py-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Teams</div>
      <div className="space-y-2">
        {teams.map((team) => (
          <TeamRow
            key={team.id}
            team={team}
            count={agentCountByTeam[team.id] ?? 0}
            onSelectTeam={onSelectTeam}
            onUpsertTeam={onUpsertTeam}
            onDeleteTeam={onDeleteTeam}
          />
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.target.value)}
            placeholder="New team"
          />
          <input
            className="h-8 w-10 rounded border border-border bg-background p-1"
            type="color"
            value={newTeamColor}
            onChange={(event) => setNewTeamColor(event.target.value)}
            aria-label="New team color"
          />
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
            disabled={!newTeamName.trim()}
            onClick={() => {
              const name = newTeamName.trim();
              if (!name) return;
              void onUpsertTeam({ id: makeTeamId(name), name, color: newTeamColor });
              setNewTeamName("");
            }}
          >
            Add
          </button>
        </div>
      </div>
    </section>
  );
}

function TeamRow({
  team,
  count,
  onSelectTeam,
  onUpsertTeam,
  onDeleteTeam,
}: {
  team: TeamDefinition;
  count: number;
  onSelectTeam: (teamId: string) => void;
  onUpsertTeam: (team: TeamDefinition) => void | Promise<void>;
  onDeleteTeam: (teamId: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(team.name);
  const [color, setColor] = useState(team.color);

  useEffect(() => {
    setName(team.name);
    setColor(team.color);
  }, [team]);

  const changed = name.trim() !== team.name || color !== team.color;

  return (
    <div className="space-y-1 rounded border border-border p-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => onSelectTeam(team.id)}
      >
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{team.name}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </button>
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="h-7 w-9 rounded border border-border bg-background p-1"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          aria-label={`${team.name} color`}
        />
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-60"
          disabled={!changed || !name.trim()}
          onClick={() => void onUpsertTeam({ ...team, name: name.trim(), color })}
        >
          Save
        </button>
        {!team.id.startsWith("branch-") && team.id !== "leadership" && team.id !== "unassigned" && (
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => void onDeleteTeam(team.id)}
          >
            Del
          </button>
        )}
      </div>
    </div>
  );
}
