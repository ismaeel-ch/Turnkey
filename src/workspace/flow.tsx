import { notify } from './core';
import type { ComponentType } from 'react';
import type * as XYFlow from '@xyflow/react';
import type { Edge, Node, ReactFlowInstance, Viewport, XYPosition } from '@xyflow/react';
import type { Dict } from '@/shared/types/workspace';
export interface AgentData {
  v: boolean;
  app: string;
  /** station id, or 'qa' for the Tester */
  st: string;
  sel: boolean;
  status: string;
  active: boolean;
  acc: string;
  icon: string;
  cap: string;
  note: string;
  /** no Customize button (the Tester) */
  noOpt?: boolean;
  name: string;
  tone: string;
  badge: string;
  attempt: number;
  facts: string[];
  tour?: string;
}
export interface GateData {
  v: boolean;
  app: string;
  st: string;
  stName: string;
  /** the Tester's gate, which runs every test */
  all?: boolean;
  state: string;
  checks: number;
  passed: number;
  tests: number;
  ran: number;
  tbad: number;
  busy: boolean;
  canRun: boolean;
  asks: { t: string; on: boolean }[];
  canAdd: boolean;
  title?: string;
  tour?: string;
}
export interface ReviewData {
  v: boolean;
  app: string;
  rid: string;
  sel: boolean;
  state: string;
  name: string;
  icon: string;
  acc: string;
  auto: boolean;
  custom: boolean;
  tone: string;
  badge: string;
  sub: string;
  canRun: boolean;
}
export interface ApprovalData {
  v: boolean;
  app: string;
  st: string;
  held: boolean;
  text: string;
}
export interface TriggerData {
  v: boolean;
  text: string | undefined;
  mode: string;
}
export interface ReadyData {
  v: boolean;
  app: string;
  ok: boolean;
  name: string;
  icon: string;
  acc: string;
  rel: string;
  canRel: boolean;
  lines: string[];
}
export interface AppAgentData {
  v: boolean;
  app: string;
  name: string;
  job: string;
  icon: string;
  acc: string;
  status: string;
}
// `ariaLabel` is a Node field, so only the data needs naming
export type FlowNode =
  | Node<AgentData & Dict<unknown>, 'agent'>
  | Node<GateData & Dict<unknown>, 'gate'>
  | Node<ReviewData & Dict<unknown>, 'review'>
  | Node<ApprovalData & Dict<unknown>, 'approval'>
  | Node<TriggerData & Dict<unknown>, 'trigger'>
  | Node<ReadyData & Dict<unknown>, 'ready'>
  | Node<AppAgentData & Dict<unknown>, 'appagent'>;
export type RouteEdge = Edge<{ cy: number }>;
export interface FlowGraph {
  nodes: FlowNode[];
  edges: RouteEdge[];
  /** how many rows of added steps the canvas holds, which sets its height */
  deep: number;
}
export interface IslandProps {
  graph: FlowGraph;
  sig: string;
  pos: Dict<XYPosition>;
  onMove: (id: string, p: XYPosition) => void;
  onPick: (n: FlowNode) => void;
  dark: boolean;
  v: boolean;
  map: boolean;
  focus: string | null;
  start: Viewport;
  fitKey: string;
  fit: { padding: number; maxZoom: number };
  /** True while the canvas has a size on the page. An animated move on a canvas 0 pixels wide is drawn at NaN. */
  shown: () => boolean;
}
export type FlowInstance = ReactFlowInstance<FlowNode, RouteEdge>;
export interface FlowKit {
  Island: ComponentType<IslandProps>;
}

/* ===== Turnkey prototype · the workflow canvas, drawn with React Flow =====
   The build is a workflow: your request, the agents, a check gate after each one, a send-back arrow when a
   gate fails, the finished app, and (for apps that have them) the app's own agents. React Flow (MIT, by
   xyflow) draws it, so it can be panned, zoomed and rearranged. React Flow is a React library and the rest
   of this page is Preact, so the canvas is a small React island that is handed plain data on every render.
   If the library cannot be loaded, the page falls back to the plain line of stations. */
export const FLOW: { state: 'loading' | 'ready' | 'none'; inst: FlowInstance | null; kit: FlowKit | null } = {
  state: 'loading',
  inst: null,
  kit: null,
};
/** React Flow, loaded with `setFlowAvailable(true)` rather than with the page; the plain line shows until then. */
export let ReactFlow: typeof XYFlow | null = null;
export const setFlowAvailable = (ok: boolean) => {
  const done = (state: 'ready' | 'none') => {
    FLOW.state = state;
    try {
      notify();
    } catch {}
  };
  if (!ok) return done('none');
  if (ReactFlow) return done('ready');
  void import('@xyflow/react').then(
    (m) => {
      ReactFlow = m;
      done('ready');
    },
    () => done('none'),
  );
};
export const isDark = () => {
  const r = document.documentElement,
    a = r.getAttribute('data-app-theme'),
    t = r.getAttribute('data-theme');
  return (
    a === 'dark' ||
    (a !== 'light' && (t === 'dark' || (t !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)))
  );
};
