// The fixed catalog of node types agents may place on the canvas.
export const NODE_KINDS = ["requirement", "table", "screen", "agent", "note"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  title: string;
  detail?: string;
  by: string; // "you" or the agent that added it
  at: string; // ISO time
}

export interface CanvasState {
  nodes: CanvasNode[];
}

export const EMPTY_CANVAS: CanvasState = { nodes: [] };
export const STORAGE_KEY = "turnkey.canvas.v1";
