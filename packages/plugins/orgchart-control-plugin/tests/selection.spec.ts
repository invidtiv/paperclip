import { describe, expect, it } from "vitest";
import {
  moveSelectedPositions,
  selectNodesInRect,
  toggleSelection,
} from "../src/ui/state/selection.js";
import type { LayoutNode } from "../src/ui/state/org-layout.js";

function node(id: string, x: number, y: number): LayoutNode {
  return {
    id,
    name: id,
    role: "general",
    status: "idle",
    x,
    y,
    children: [],
  };
}

describe("selection and group movement", () => {
  it("supports additive card selection", () => {
    expect(toggleSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a", true)).toEqual(["b"]);
    expect(toggleSelection(["a", "b"], "c", false)).toEqual(["c"]);
  });

  it("selects nodes by lasso rectangle", () => {
    expect(selectNodesInRect([
      node("a", 0, 0),
      node("b", 320, 0),
      node("c", 800, 0),
    ], {
      x1: -20,
      y1: -20,
      x2: 650,
      y2: 180,
    })).toEqual(["a", "b"]);
  });

  it("moves selected nodes as one batch", () => {
    expect(moveSelectedPositions({
      a: { x: 0, y: 0 },
      b: { x: 300, y: 0 },
      c: { x: 900, y: 0 },
    }, ["a", "b"], { x: 12.4, y: 19.6 })).toEqual({
      a: { x: 12, y: 20 },
      b: { x: 312, y: 20 },
    });
  });
});
