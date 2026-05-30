import { CARD_H, CARD_W, type LayoutNode } from "./org-layout.js";
import type { Point } from "../../shared/layout.js";

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function normalizeRect(rect: Rect): { x: number; y: number; width: number; height: number } {
  const x = Math.min(rect.x1, rect.x2);
  const y = Math.min(rect.y1, rect.y2);
  return {
    x,
    y,
    width: Math.abs(rect.x2 - rect.x1),
    height: Math.abs(rect.y2 - rect.y1),
  };
}

export function toggleSelection(current: string[], id: string, additive: boolean): string[] {
  if (!additive) return [id];
  const set = new Set(current);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return Array.from(set);
}

export function selectNodesInRect(nodes: LayoutNode[], rect: Rect): string[] {
  const normalized = normalizeRect(rect);
  const selected: string[] = [];
  for (const node of nodes) {
    const centerX = node.x + CARD_W / 2;
    const centerY = node.y + CARD_H / 2;
    if (
      centerX >= normalized.x &&
      centerX <= normalized.x + normalized.width &&
      centerY >= normalized.y &&
      centerY <= normalized.y + normalized.height
    ) {
      selected.push(node.id);
    }
  }
  return selected;
}

export function moveSelectedPositions(
  nodePositions: Record<string, Point>,
  selectedIds: string[],
  delta: Point,
): Record<string, Point> {
  const moved: Record<string, Point> = {};
  for (const id of selectedIds) {
    const start = nodePositions[id];
    if (!start) continue;
    moved[id] = {
      x: Math.round(start.x + delta.x),
      y: Math.round(start.y + delta.y),
    };
  }
  return moved;
}

export function positionMapFromNodes(nodes: LayoutNode[]): Record<string, Point> {
  const map: Record<string, Point> = {};
  for (const node of nodes) {
    map[node.id] = { x: node.x, y: node.y };
  }
  return map;
}
