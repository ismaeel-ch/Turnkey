import * as React from 'react';
import { createEagerRoot } from '@/platform/dom';
import { createElement, useEffect, useRef } from 'react';
import { toStyle } from '@/platform/dom';
import { ICONS } from './icons';
import { PHONE, S, U, arr, cx, notify, openDialog } from './core';
import { dbCount } from './db';
import { deriveEndpoints } from './engine';
import { TEAMS } from './team';
import { TESTS, runTests, suiteOf, testStats, testable } from './tests';
import { AGENTS, RUNS, STATIONS } from './line';
import {
  APPROVE_AT,
  FlowChips,
  STEP_AT,
  answerGate,
  flowEdit,
  flowList,
  flowOf,
  reviewNow,
  stName,
  stepAuto,
  stepsAt,
} from './custom';
import { REVIEWERS } from './reviewers';
import { Btn, AgentAv, Icon, STATUS_META } from './ui';
import { useWidth } from './views-b';
import { isDirty, relOf } from './release';
import { LineView } from './shell-a';
import type { ComponentType, CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type * as XYFlow from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeChange, ReactFlowInstance, Viewport, XYPosition } from '@xyflow/react';
import type { Root } from 'react-dom/client';
import type { AppRecord, Dict } from '@/shared/types/workspace';
import type { BriefedDef } from '@/shared/types/app';

/* ---------- what each node of the canvas shows ---------- */
/** The colour of a line: not reached, passed, running now, or sent back. */
type EdgeKind = 'idle' | 'done' | 'live' | 'back';
interface AgentData {
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
interface GateData {
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
interface ReviewData {
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
interface ApprovalData {
  v: boolean;
  app: string;
  st: string;
  held: boolean;
  text: string;
}
interface TriggerData {
  v: boolean;
  text: string | undefined;
  mode: string;
}
interface ReadyData {
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
interface AppAgentData {
  v: boolean;
  app: string;
  name: string;
  job: string;
  icon: string;
  acc: string;
  status: string;
}
// `ariaLabel` is a Node field, so only the data needs naming
type FlowNode =
  | Node<AgentData & Dict<unknown>, 'agent'>
  | Node<GateData & Dict<unknown>, 'gate'>
  | Node<ReviewData & Dict<unknown>, 'review'>
  | Node<ApprovalData & Dict<unknown>, 'approval'>
  | Node<TriggerData & Dict<unknown>, 'trigger'>
  | Node<ReadyData & Dict<unknown>, 'ready'>
  | Node<AppAgentData & Dict<unknown>, 'appagent'>;
/** A node as the island keeps it: with the signature of what it showed last. */
type IslandNode = FlowNode & { sig?: string };
type RouteEdge = Edge<{ cy: number }>;
export interface FlowGraph {
  nodes: FlowNode[];
  edges: RouteEdge[];
  /** how many rows of added steps the canvas holds, which sets its height */
  deep: number;
}
interface IslandProps {
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
type FlowInstance = ReactFlowInstance<FlowNode, RouteEdge>;
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
let ReactFlow: typeof XYFlow | null = null;
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
export const FL = {
  W: 220,
  CW: 262,
  GY: 208,
  RY: 148,
  RH: 124,
  ROW2: 384,
  TEAM: 756,
  VY: 150,
  VSTEP: 364,
}; // RY: a review step sits this far below its gate; RH: the room a row needs for one
export function openCustom(app: AppRecord, stId: string): void {
  // the canvas hands a station to the inspector's Customize tab
  U.sel[app.id] = stId;
  U.follow[app.id] = false;
  U.itab[app.id] = 'custom';
  if (PHONE())
    U.sheet = {
      kind: 'inspector',
      app: app.id,
    };
  else
    setTimeout(() => {
      const el = document.querySelector('.inspector');
      if (el && el.scrollIntoView)
        el.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
    }, 60);
  notify();
}
export function flowGraph(app: AppRecord, v: boolean): FlowGraph {
  // plain data: where every node sits and what it shows. v = narrow screen: one column, each gate under its agent
  const def = app.def,
    L = app.line,
    hand = U.handoff[app.id],
    sel = U.sel[app.id],
    nodes: FlowNode[] = [],
    edges: RouteEdge[] = [],
    W = FL.W,
    ok = testable(app),
    suites = ok ? suiteOf(app) : [],
    T0 = TESTS[app.id],
    res: Dict<{ ok: boolean }> = T0 && T0.rev === app.rev ? T0.res : {},
    running = T0 ? T0.running : null; // the id of the suite running now
  const css = getComputedStyle(document.documentElement),
    col = (n: string) => css.getPropertyValue('--' + n).trim() || '#888',
    C = {
      idle: col('colorNeutralStroke1Hover'),
      done: col('colorStatusSuccessBorder2'),
      live: col('colorBrandStroke1'),
      back: col('colorStatusWarningBorder2'),
    };
  type Added = { kind: 'review'; id: string } | { kind: 'approval' };
  const flow = flowOf(app),
    NS = STATIONS.length,
    chain: Added[][] = STATIONS.map((st) =>
      stepsAt(flow, st.id)
        .map((id): Added => ({ kind: 'review', id }))
        .concat(flow.approve[st.id] ? [{ kind: 'approval' }] : []),
    );
  chain.push([]); // the Tester is the last stop and has nothing after it but the release
  const rowOf = (i: number) => (i < 3 ? 0 : 1),
    colOf2 = (i: number) => (i < 3 ? i + 1 : i - 3),
    deep = (r: number) => Math.max(...chain.map((c, i) => (rowOf(i) === r ? c.length : 0)));
  const rowY = [0, FL.ROW2 + deep(0) * FL.RH],
    teamY = rowY[1] + (FL.TEAM - FL.ROW2) + deep(1) * FL.RH + (deep(1) ? 44 : 0),
    vy: number[] = [];
  let yy = FL.VY;
  chain.forEach((c) => {
    vy.push(yy);
    yy += FL.VSTEP + c.length * FL.RH;
  });
  const at = (i: number, dy: number): XYPosition =>
    v
      ? {
          x: 0,
          y: vy[i] + dy,
        }
      : {
          x: FL.CW * colOf2(i),
          y: rowY[rowOf(i)] + dy,
        };
  const edge = (
    id: string,
    s: string,
    sh: string,
    t: string,
    th: string,
    kind: EdgeKind,
    type?: string,
    more?: Partial<RouteEdge> | null,
  ) =>
    edges.push(
      Object.assign(
        {
          id,
          source: s,
          sourceHandle: sh,
          target: t,
          targetHandle: th,
          type: type || 'default',
          animated: kind === 'live',
          style: {
            stroke: C[kind],
            strokeWidth: 2,
            strokeDasharray: kind === 'back' ? '6 4' : undefined,
          },
          markerEnd: {
            type: 'arrowclosed' as XYFlow.MarkerType, // MarkerType.ArrowClosed, without loading React Flow
            color: C[kind],
            width: 14,
            height: 14,
          },
          focusable: false,
          selectable: false,
        },
        more || {},
      ),
    );
  const onward = (i: number, from: string, kind: EdgeKind) => {
    // from the last node of stop i to the next stop, or to the finished app
    const wrap = !v && (i === 2 || i === NS),
      down = v || wrap,
      to = i === NS ? 'ready' : 'a' + (i + 1),
      cy = i === NS ? teamY - 34 : rowY[1] - 34;
    edge(
      i === NS ? 'e-ready' : 'e-g' + i,
      from,
      down ? 'down' : 'out',
      to,
      down ? 'top' : 'in',
      kind,
      v ? 'straight' : wrap ? 'route' : 'smoothstep',
      wrap
        ? {
            data: {
              cy,
            },
          }
        : null,
    );
  };
  nodes.push({
    id: 'trigger',
    type: 'trigger',
    position: {
      x: 0,
      y: 0,
    },
    width: W,
    ariaLabel: 'Your request',
    data: {
      v,
      text: app.request,
      mode: app.mode === 'live' ? 'Live build' : 'Saved build',
    },
  });
  STATIONS.forEach((st, i) => {
    const S0 = L[st.id],
      a = AGENTS[st.agent],
      meta = STATUS_META[S0.status] || STATUS_META.idle,
      active = S0.status === 'working' || S0.status === 'checking',
      passed = S0.checks.filter((c) => c.ok).length,
      mine = suites.filter((s) => s.station === st.id),
      tn = mine.reduce((n, s) => n + s.tests.length, 0),
      got = mine.flatMap((s) => s.tests.map((x) => res[x.id]).filter(Boolean)),
      tbad = got.filter((x) => !x.ok).length;
    const rules = flow.by[st.id] === 'rules',
      note = flow.notes[st.agent] || '';
    nodes.push({
      id: 'a' + i,
      type: 'agent',
      position: at(i, 0),
      width: W,
      ariaLabel: st.name + ' station, ' + meta.text,
      data: {
        v,
        app: app.id,
        st: st.id,
        sel: sel === st.id,
        status: S0.status,
        active,
        acc: rules ? 'steel' : a.acc,
        icon: rules ? 'code' : a.icon,
        cap: i + 1 + ' · ' + (rules ? 'Built-in rules' : a.name + (st.id === 'walkthrough' ? ' + code' : '')),
        note,
        name: st.name,
        tone: S0.note && S0.status === 'ok' ? 'neutral' : meta.tone,
        badge: S0.note && S0.status === 'ok' ? S0.note : meta.text,
        attempt: S0.attempt,
        facts: S0.facts.length
          ? S0.facts.slice(0, 3)
          : [S0.status === 'working' && U.stream[app.id] ? 'Receiving ' + String(U.stream[app.id]) + ' characters' : st.makes],
        tour: i === 1 ? 'station' : undefined,
      },
    });
    const q = st.id === 'research' && def.brief ? def.brief.question : null,
      dec = def.brief && def.brief.decision;
    const state =
      S0.status === 'checking'
        ? 'live'
        : S0.status === 'sentback' || S0.status === 'failed'
          ? 'bad'
          : S0.status === 'waiting'
            ? 'wait'
            : S0.checks.length
              ? passed === S0.checks.length && !tbad
                ? 'ok'
                : 'bad'
              : 'idle';
    const held = S0.status === 'waiting' && S0.hold === 'approval',
      asks: GateData['asks'] = [];
    if (st.id === 'research')
      asks.push({
        t:
          S0.status === 'waiting' && !held
            ? 'Waiting for your answer'
            : dec && dec.answer
              ? 'You decided: ' + dec.answer
              : q
                ? 'One question for you'
                : 'Asks you one question',
        on: S0.status === 'waiting' && !held,
      });
    nodes.push({
      id: 'g' + i,
      type: 'gate',
      position: at(i, FL.GY),
      width: W,
      ariaLabel: st.name + ' check gate',
      data: {
        v,
        app: app.id,
        st: st.id,
        stName: st.name,
        state,
        checks: S0.checks.length,
        passed,
        tests: tn,
        ran: got.length,
        tbad,
        busy: !!(running && mine.some((s) => s.id === running)),
        canRun: ok && !RUNS[app.id],
        asks,
        canAdd: STEP_AT.includes(st.id) || APPROVE_AT.includes(st.id),
        tour: i === 1 ? 'addstep' : undefined,
      },
    });
    edge('e-a' + i, 'a' + i, 'out', 'g' + i, 'in', S0.status === 'checking' ? 'live' : S0.checks.length ? 'done' : 'idle', 'straight');
    if (S0.attempt > 1 || S0.status === 'sentback')
      edge('e-b' + i, 'g' + i, 'back', 'a' + i, 'back', 'back', 'straight', {
        animated: S0.status === 'sentback',
      });
    const next = hand === i ? 'live' : S0.status === 'ok' ? 'done' : 'idle';
    let last = 'g' + i;
    chain[i].forEach((c, k) => {
      // what the owner added after this gate: agents first, then the approval. The line passes through each one.
      const nid = 'c' + i + '_' + k,
        pos = at(i, FL.GY + FL.RY + k * FL.RH);
      let done: EdgeKind = 'idle';
      if (c.kind === 'review') {
        const rid = c.id,
          rv = REVIEWERS[rid],
          R = (app.reviews || {})[rid],
          auto = stepAuto(flow, rid),
          open = R && R.status === 'ok' ? R.findings.filter((x) => x.state === 'open').length : 0,
          did = R && R.status === 'ok' ? R.findings.filter((x) => x.state === 'applied').length : 0,
          stale = R && R.status === 'ok' && R.rev !== app.rev,
          rs = !R ? 'idle' : R.status === 'working' ? 'working' : R.status === 'failed' ? 'failed' : open ? 'open' : 'ok';
        nodes.push({
          id: nid,
          type: 'review',
          position: pos,
          width: W,
          ariaLabel: rv.name + ', a step after ' + st.name,
          data: {
            v,
            app: app.id,
            rid,
            sel: sel === 'rv_' + rid,
            state: rs,
            name: rv.short,
            icon: rv.icon,
            acc: rv.acc,
            auto,
            custom: !!rv.custom,
            tone: rs === 'working' ? 'info' : rs === 'open' ? 'warning' : rs === 'ok' ? 'success' : rs === 'failed' ? 'danger' : 'neutral',
            badge:
              rs === 'working'
                ? 'Working'
                : rs === 'failed'
                  ? 'Did not finish'
                  : rs === 'open'
                    ? open + ' to look at'
                    : rs === 'ok'
                      ? did
                        ? did + (did === 1 ? ' change applied' : ' changes applied')
                        : R && R.findings.length
                          ? 'All handled'
                          : 'Nothing to change'
                      : 'Waiting',
            sub: stale ? 'The app changed since this step ran' : auto ? 'Applies its changes, each one checked' : 'Advises · you apply',
            canRun: app.status === 'ready' && !RUNS[app.id],
          },
        });
        done = R && R.status === 'working' ? 'live' : R && R.status === 'ok' ? 'done' : 'idle';
      } else {
        nodes.push({
          id: nid,
          type: 'approval',
          position: pos,
          width: W,
          ariaLabel: 'Your approval after ' + st.name,
          data: {
            v,
            app: app.id,
            st: st.id,
            held,
            text: held ? 'Waiting for you' : S0.approved && S0.status === 'ok' ? 'You approved this' : 'The build waits here for you',
          },
        });
        done = held ? 'live' : S0.approved && S0.status === 'ok' ? 'done' : 'idle';
      }
      edge('e-c' + i + '_' + k, last, 'down', nid, 'top', done, 'straight');
      last = nid;
    });
    onward(i, last, next);
  });
  {
    // the Tester: the last stop. It writes test cases, code runs every test, and failures go back for repair.
    const i = NS,
      Q = app.qa,
      cases = arr(def.cases).length,
      st0 = testStats(app),
      stt = !Q ? (cases && L.walkthrough.status === 'ok' ? 'ok' : 'idle') : Q.status,
      active = stt === 'working' || stt === 'checking',
      meta = STATUS_META[stt] || STATUS_META.idle,
      fixes = Q ? Q.rounds.reduce((k, r) => k + r.fixes.filter((f) => f.ok).length, 0) : 0,
      bad = !!(st0 && st0.fresh && st0.failed);
    nodes.push({
      id: 'a' + i,
      type: 'agent',
      position: at(i, 0),
      width: W,
      ariaLabel: 'Tests station, ' + meta.text,
      data: {
        v,
        app: app.id,
        st: 'qa',
        sel: sel === 'qa',
        status: stt,
        active,
        acc: AGENTS.tester.acc,
        icon: AGENTS.tester.icon,
        cap: i + 1 + ' · Tester + code',
        note: '',
        noOpt: true,
        name: 'Tests',
        tone: meta.tone,
        badge: meta.text,
        attempt: Q ? Q.rounds.length : 1,
        facts: cases
          ? [
              cases + ' test cases written',
              fixes ? fixes + (fixes === 1 ? ' repair' : ' repairs') + ' sent back and applied' : 'No repair was needed',
            ]
          : ['Test cases, run and repaired'],
      },
    });
    nodes.push({
      id: 'g' + i,
      type: 'gate',
      position: at(i, FL.GY),
      width: W,
      ariaLabel: 'Test gate',
      data: {
        v,
        app: app.id,
        st: 'qa',
        stName: 'Tests',
        all: true,
        state: stt === 'checking' ? 'live' : st0 && st0.fresh ? (bad ? 'bad' : 'ok') : 'idle',
        checks: 0,
        passed: 0,
        tests: st0 ? st0.total : 0,
        ran: st0 && st0.fresh ? st0.total : 0,
        tbad: st0 && st0.fresh ? st0.failed : 0,
        busy: !!(T0 && T0.running),
        canRun: ok && !RUNS[app.id],
        asks: [],
        canAdd: false,
        title: st0 && st0.fresh ? st0.passed + ' of ' + st0.total + ' tests pass' : 'Test gate',
      },
    });
    edge('e-a' + i, 'a' + i, 'out', 'g' + i, 'in', stt === 'checking' ? 'live' : Q && Q.rounds.length ? 'done' : 'idle', 'straight');
    if (Q && (Q.rounds.length > 1 || stt === 'sentback'))
      edge('e-b' + i, 'g' + i, 'back', 'a' + i, 'back', 'back', 'straight', {
        animated: stt === 'sentback',
      });
    onward(i, 'g' + i, app.status === 'ready' && !RUNS[app.id] ? 'done' : 'idle');
  }
  const ry = yy,
    st0 = testStats(app),
    rel = relOf(app),
    dirty = isDirty(app);
  nodes.push({
    id: 'ready',
    type: 'ready',
    position: v
      ? {
          x: 0,
          y: ry,
        }
      : {
          x: 0,
          y: teamY,
        },
    width: W,
    ariaLabel: app.status === 'ready' ? app.name + ', ready' : 'The app, not ready yet',
    data: {
      v,
      app: app.id,
      ok: app.status === 'ready' && !RUNS[app.id],
      name: app.name,
      icon: app.icon,
      acc: app.accent,
      rel: rel ? (dirty ? 'Draft · version ' + rel.v + ' is out' : 'Version ' + rel.v + ' released') : 'Draft · not released yet',
      canRel: !rel || dirty,
      lines:
        app.status === 'ready'
          ? [
              def.tables.length + ' tables · ' + deriveEndpoints(def as BriefedDef).length + ' endpoints',
              def.screens.length + ' pages' + (st0 ? ' · ' + st0.passed + ' of ' + st0.total + ' tests pass' : ''),
            ].concat(def.team ? [def.team.agents.length + ' agents of its own run inside it'] : [])
          : ['Appears when every gate has passed'],
    },
  });
  edge('e-trig', 'trigger', 'out', 'a0', v ? 'top' : 'in', L.research.status === 'idle' ? 'idle' : 'done', v ? 'straight' : 'smoothstep');
  if (def.team) {
    const T = TEAMS[app.id],
      team = def.team;
    def.team.agents.forEach((a, j) => {
      const s = T ? T.steps[j].status : 'idle',
        wait = !!(T && T.wait && team.pause && team.pause.before === a.id);
      nodes.push({
        id: 't' + j,
        type: 'appagent',
        position: v
          ? {
              x: 0,
              y: ry + 230 + j * 140,
            }
          : {
              x: FL.CW * (j + 1),
              y: teamY,
            },
        width: W,
        ariaLabel: a.name + ", one of the app's own agents",
        data: {
          v,
          app: app.id,
          name: a.name,
          job: a.job,
          icon: a.icon,
          acc: a.acc,
          status: wait ? 'wait' : s,
        },
      });
      if (j === 0) edge('e-t', 'ready', v ? 'down' : 'out', 't0', v ? 'top' : 'in', app.status === 'ready' ? 'done' : 'idle', 'straight');
      else
        edge(
          'e-t' + j,
          't' + (j - 1),
          v ? 'down' : 'out',
          't' + j,
          v ? 'top' : 'in',
          T && T.steps[j - 1].status === 'ok' ? 'done' : s === 'working' ? 'live' : 'idle',
          'straight',
        );
    });
  }
  return {
    nodes,
    edges,
    deep: deep(0) + deep(1),
  };
}
export function flowKit(): FlowKit {
  // the React pieces, made once the libraries have loaded
  if (FLOW.kit) return FLOW.kit;
  if (!ReactFlow) throw new Error('React Flow is not loaded yet'); // only called once FLOW.state is 'ready'
  const R = React,
    RF = ReactFlow,
    e = R.createElement,
    POS: Record<'left' | 'right' | 'top' | 'bottom', XYFlow.Position> = {
      left: RF.Position.Left,
      right: RF.Position.Right,
      top: RF.Position.Top,
      bottom: RF.Position.Bottom,
    };
  const ic = (n: string, s?: string) =>
    e('svg', {
      className: 'ic' + (s ? ' s' + s : ''),
      viewBox: '0 0 20 20',
      fill: 'currentColor',
      'aria-hidden': true,
      dangerouslySetInnerHTML: {
        __html: ICONS[n as keyof typeof ICONS] || ICONS.circle,
      },
    });
  type HandleSpec = [id: string, type: 'source' | 'target', side: keyof typeof POS, style?: CSSProperties | null];
  const hs = (list: HandleSpec[]) =>
    list.map((h) =>
      e(RF.Handle, {
        key: h[0],
        id: h[0],
        type: h[1],
        position: POS[h[2]],
        isConnectable: false,
        style: h[3] || undefined,
      }),
    );
  const appOf = (d: { app: string }) => S.apps[d.app],
    stop = (fn: () => unknown) => (ev: ReactMouseEvent) => {
      ev.stopPropagation();
      fn();
    };
  const Agent = ({ data: d }: { data: AgentData }) =>
    e(
      'div',
      {
        className: cx('fl-node station', 's-' + d.status, d.sel && 'sel', 'acc-' + d.acc),
        'data-tour': d.tour,
      },
      hs([
        [
          'in',
          'target',
          'left',
          {
            top: '34%',
          },
        ],
        ['top', 'target', 'top'],
        ['out', 'source', 'bottom'],
        [
          'back',
          'target',
          'bottom',
          {
            left: '24%',
          },
        ],
      ]),
      d.active
        ? e('span', {
            className: 'pbar',
          })
        : null,
      e(
        'span',
        {
          className: 'st-top',
        },
        e(
          'span',
          {
            className: 'av sq av-sm acc-' + d.acc,
          },
          ic(d.icon, '16'),
        ),
        e(
          'span',
          {
            className: 't-cap muted grow',
          },
          d.cap,
        ),
        d.note
          ? e(
              'span',
              {
                className: 'fl-mark',
                title: 'Standing instruction: ' + d.note,
              },
              ic('note', '12'),
            )
          : null,
        d.noOpt
          ? null
          : e(
              'button',
              {
                className: 'btn subtle icon sm nodrag nopan fl-opt',
                title: 'Customize this step',
                'aria-label': 'Customize the ' + d.name + ' step',
                onClick: stop(() => openCustom(appOf(d), d.st)),
              },
              ic('options', '16'),
            ),
      ),
      e(
        'strong',
        {
          className: 'st-name',
        },
        d.name,
      ),
      e(
        'span',
        {
          className: 'st-status',
        },
        e(
          'span',
          {
            className: 'badge b-' + d.tone,
          },
          d.active
            ? e('span', {
                className: 'spin',
              })
            : null,
          d.badge,
        ),
        d.attempt > 1
          ? e(
              'span',
              {
                className: 'badge b-warning',
                title: 'This station was sent back',
              },
              ic('undo', '12'),
              'try ' + d.attempt,
            )
          : null,
      ),
      e(
        'span',
        {
          className: 'st-facts',
        },
        d.facts.map((f, i) =>
          e(
            'span',
            {
              key: i,
            },
            f,
          ),
        ),
      ),
    );
  const Gate = ({ data: d }: { data: GateData }) =>
    e(
      'div',
      {
        className: cx('fl-node fl-gate', 'g-' + d.state),
        'data-tour': d.tour,
      },
      hs([
        ['in', 'target', 'top'],
        [
          'back',
          'source',
          'top',
          {
            left: '24%',
          },
        ],
        ['out', 'source', 'right'],
        ['down', 'source', 'bottom'],
      ]),
      e(
        'span',
        {
          className: 'fl-gate-h',
        },
        d.state === 'live'
          ? e('span', {
              className: 'spin',
            })
          : ic(d.state === 'bad' ? 'warning' : d.state === 'wait' ? 'questionChat' : d.all ? 'beaker' : 'shield', '16'),
        e(
          'strong',
          {
            className: 'grow',
          },
          d.title || (d.checks ? d.passed + ' of ' + d.checks + ' checks' : 'Check gate'),
        ),
        d.tests
          ? e(
              'button',
              {
                className: 'btn subtle icon sm nodrag nopan',
                title: d.all ? 'Run every test' : 'Run the ' + d.tests + ' tests of this gate',
                'aria-label': d.all ? 'Run every test' : 'Run the ' + d.tests + ' tests of this gate',
                disabled: !d.canRun || d.busy,
                onClick: stop(() => (d.all ? runTests(appOf(d)) : runTests(appOf(d), (s: { station: string }) => s.station === d.st))),
              },
              d.busy
                ? e('span', {
                    className: 'spin',
                  })
                : ic('play', '16'),
            )
          : null,
      ),
      e(
        'span',
        {
          className: cx('t-cap fl-sub', d.tbad && 'bad'),
        },
        d.all
          ? d.tests
            ? d.ran
              ? d.tbad
                ? d.tbad + ' failing · a release waits for these'
                : 'Ready to release'
              : d.tests + ' tests · not run in this session'
            : 'Every test runs here before a release'
          : d.tests
            ? d.tests + ' tests' + (d.ran ? (d.tbad ? ' · ' + d.tbad + ' failing' : ' · all pass') : ' · not run yet')
            : 'Code checks this handoff',
      ),
      d.asks.map((a, i) =>
        e(
          'span',
          {
            key: i,
            className: cx('fl-ask', a.on && 'on'),
          },
          ic('person', '12'),
          e('span', null, a.t),
        ),
      ),
      d.canAdd
        ? e(
            'button',
            {
              className: 'fl-add nodrag nopan',
              title: 'Add a step after ' + d.stName,
              'aria-label': 'Add a step after ' + d.stName,
              onClick: stop(() =>
                openDialog('addstep', {
                  app: d.app,
                  after: d.st,
                }),
              ),
            },
            ic('add', '16'),
          )
        : null,
    );
  const Review = ({ data: d }: { data: ReviewData }) =>
    e(
      'div',
      {
        className: cx('fl-node fl-review', 'r-' + d.state, d.sel && 'sel', 'acc-' + d.acc),
      },
      hs([
        ['top', 'target', 'top'],
        ['out', 'source', 'right'],
        ['down', 'source', 'bottom'],
      ]),
      e(
        'span',
        {
          className: 'fl-cap',
        },
        e(
          'span',
          {
            className: 'av sq av-sm acc-' + d.acc,
          },
          ic(d.icon, '16'),
        ),
        e(
          'strong',
          {
            className: 'grow ellipsis',
          },
          d.name,
        ),
        e(
          'button',
          {
            className: 'btn subtle icon sm nodrag nopan',
            title: 'Run this step now',
            'aria-label': 'Run ' + d.name + ' now',
            disabled: !d.canRun,
            onClick: stop(() => reviewNow(appOf(d), d.rid, false)),
          },
          d.state === 'working'
            ? e('span', {
                className: 'spin',
              })
            : ic('play', '16'),
        ),
        e(
          'button',
          {
            className: 'btn subtle icon sm nodrag nopan',
            title: 'Remove this step',
            'aria-label': 'Remove ' + d.name,
            onClick: stop(() =>
              flowEdit(appOf(d), [
                {
                  tool: 'remove_step',
                  args: {
                    step: d.rid,
                  },
                },
              ]),
            ),
          },
          ic('dismiss', '16'),
        ),
      ),
      e(
        'span',
        {
          className: 'st-status',
        },
        e(
          'span',
          {
            className: 'badge b-' + d.tone,
          },
          d.badge,
        ),
        d.custom
          ? e(
              'span',
              {
                className: 'badge b-outline',
              },
              'Your agent',
            )
          : null,
      ),
      e(
        'span',
        {
          className: 't-cap fl-sub',
        },
        d.auto ? ic('wand', '12') : null,
        d.sub,
      ),
    );
  const Approval = ({ data: d }: { data: ApprovalData }) =>
    e(
      'div',
      {
        className: cx('fl-node fl-approval', d.held && 'on'),
      },
      hs([
        ['top', 'target', 'top'],
        ['out', 'source', 'right'],
        ['down', 'source', 'bottom'],
      ]),
      e(
        'span',
        {
          className: 'fl-cap',
        },
        e(
          'span',
          {
            className: 'av av-sm acc-blue',
          },
          ic('approved', '16'),
        ),
        e(
          'strong',
          {
            className: 'grow ellipsis',
          },
          'Your approval',
        ),
        e(
          'button',
          {
            className: 'btn subtle icon sm nodrag nopan',
            title: 'Remove this approval',
            'aria-label': 'Remove the approval after ' + stName(d.st),
            onClick: stop(() =>
              flowEdit(appOf(d), [
                {
                  tool: 'set_approval',
                  args: {
                    station: d.st,
                    on: false,
                  },
                },
              ]),
            ),
          },
          ic('dismiss', '16'),
        ),
      ),
      e(
        'span',
        {
          className: 't-cap fl-sub',
        },
        d.text,
      ),
      d.held
        ? e(
            'button',
            {
              className: 'btn primary sm nodrag nopan',
              onClick: stop(() => answerGate(appOf(d), true)),
            },
            ic('check', '16'),
            'Approve and continue',
          )
        : null,
    );
  const Trigger = ({ data: d }: { data: TriggerData }) =>
    e(
      'div',
      {
        className: 'fl-node fl-trigger',
      },
      hs([
        [
          'out',
          'source',
          d.v ? 'bottom' : 'right',
          d.v
            ? null
            : {
                top: '56px',
              },
        ],
      ]),
      e(
        'span',
        {
          className: 'fl-cap',
        },
        ic('sparkle', '16'),
        e(
          'strong',
          {
            className: 'grow',
          },
          'Your request',
        ),
        e(
          'span',
          {
            className: 'badge b-outline',
          },
          d.mode,
        ),
      ),
      e(
        'span',
        {
          className: 'fl-text',
        },
        d.text,
      ),
    );
  const Ready = ({ data: d }: { data: ReadyData }) =>
    e(
      'div',
      {
        className: cx('fl-node fl-ready', d.ok && 'ok', 'acc-' + d.acc),
      },
      hs([
        [
          'in',
          'target',
          d.v ? 'top' : 'left',
          d.v
            ? null
            : {
                top: '56px',
              },
        ],
        ['top', 'target', 'top'],
        ['out', 'source', 'right'],
        ['down', 'source', 'bottom'],
      ]),
      e(
        'span',
        {
          className: 'fl-cap',
        },
        e(
          'span',
          {
            className: 'app-badge sm',
          },
          ic(d.icon, '16'),
        ),
        e(
          'strong',
          {
            className: 'ellipsis grow',
          },
          d.ok ? d.name : 'The app',
        ),
      ),
      d.lines.map((l, i) =>
        e(
          'span',
          {
            key: i,
            className: 't-cap fl-sub',
          },
          l,
        ),
      ),
      d.ok
        ? e(
            'span',
            {
              className: 't-cap fl-sub fl-rel',
            },
            ic('rocket', '12'),
            d.rel,
          )
        : null,
      d.ok
        ? e(
            'span',
            {
              className: 'row gap4 wrap',
            },
            e(
              'button',
              {
                className: 'btn primary sm nodrag nopan',
                onClick: stop(() => {
                  U.view[d.app] = 'app';
                  notify();
                }),
              },
              ic('window', '16'),
              'Open the app',
            ),
            d.canRel
              ? e(
                  'button',
                  {
                    className: 'btn sm nodrag nopan fl-release',
                    onClick: stop(() => {
                      U.view[d.app] = 'release';
                      notify();
                    }),
                  },
                  ic('rocket', '16'),
                  'Release',
                )
              : null,
          )
        : null,
    );
  const AppAgent = ({ data: d }: { data: AppAgentData }) =>
    e(
      'div',
      {
        className: cx('fl-node fl-team', 't-' + d.status),
      },
      hs([
        ['in', 'target', d.v ? 'top' : 'left'],
        ['top', 'target', 'top'],
        ['out', 'source', d.v ? 'bottom' : 'right'],
      ]),
      e(
        'span',
        {
          className: 'fl-cap',
        },
        e(
          'span',
          {
            className: 'av sq av-sm acc-' + d.acc,
          },
          ic(d.icon, '16'),
        ),
        e(
          'strong',
          {
            className: 'grow ellipsis',
          },
          d.name,
        ),
        d.status === 'working'
          ? e('span', {
              className: 'spin',
            })
          : d.status === 'ok'
            ? ic('checkCircle', '16')
            : d.status === 'wait'
              ? e(
                  'span',
                  {
                    className: 'badge b-warning',
                  },
                  'Your turn',
                )
              : null,
      ),
      e(
        'span',
        {
          className: 't-cap fl-sub fl-clamp',
        },
        d.job,
      ),
    );
  const Route = (p: EdgeProps<RouteEdge>) => {
    const r = RF.getSmoothStepPath({
      sourceX: p.sourceX,
      sourceY: p.sourceY,
      sourcePosition: p.sourcePosition,
      targetX: p.targetX,
      targetY: p.targetY,
      targetPosition: p.targetPosition,
      borderRadius: 10,
      centerY: p.data && p.data.cy,
    });
    return e(RF.BaseEdge, {
      id: p.id,
      path: r[0],
      labelX: r[1],
      labelY: p.data && p.data.cy != null ? p.data.cy : r[2],
      label: p.label,
      labelStyle: p.labelStyle,
      labelShowBg: p.labelShowBg,
      labelBgStyle: p.labelBgStyle,
      labelBgPadding: p.labelBgPadding,
      labelBgBorderRadius: p.labelBgBorderRadius,
      markerEnd: p.markerEnd,
      style: p.style,
    });
  };
  // React Flow measures where a node's handles are once, when the node first appears. If the node's data changes in the same few frames, that
  // measurement can be dropped and the node's edges are not drawn. So after changes settle, every node is measured again.
  const Sync = ({ sig, ids }: { sig: string; ids: string[] }) => {
    const upd = RF.useUpdateNodeInternals(),
      box = R.useRef<{ t: ReturnType<typeof setTimeout> | 0; dirty: boolean; ids: string[] }>({
        t: 0,
        dirty: false,
        ids,
      });
    R.useEffect(() => {
      // eslint-disable-next-line react-hooks/immutability -- the ref holds the latest ids for the timer below
      box.current.ids = ids;
    });
    R.useEffect(() => {
      const s = box.current;
      const go = () => {
        s.t = setTimeout(() => {
          s.t = 0;
          upd(s.ids);
          if (s.dirty) {
            s.dirty = false;
            go();
          }
        }, 160);
      };
      // eslint-disable-next-line react-hooks/immutability -- a timer is pending: ask it to run once more
      if (s.t) s.dirty = true;
      else go();
    }, [sig]);
    R.useEffect(() => {
      const s = box.current;
      return () => {
        if (s.t) clearTimeout(s.t);
      };
    }, []);
    return null;
  };
  const NODES = {
      agent: Agent,
      gate: Gate,
      review: Review,
      approval: Approval,
      trigger: Trigger,
      ready: Ready,
      appagent: AppAgent,
    },
    EDGES = {
      route: Route,
    };
  const Island = (p: IslandProps) => {
    const st = R.useState<IslandNode[]>(p.graph.nodes),
      nodes = st[0],
      setNodes = st[1],
      inst = R.useRef<FlowInstance | null>(null);
    R.useEffect(() => {
      setNodes((prev) =>
        p.graph.nodes.map((n) => {
          const o = prev.find((x) => x.id === n.id),
            at = p.pos[n.id] || n.position,
            sig = JSON.stringify([at, n.width, n.data]);
          return o && o.type === n.type && o.sig === sig && o.position.x === at.x && o.position.y === at.y
            ? o
            : ({ ...(o && o.type === n.type ? o : null), ...n, position: at, sig });
        }),
      );
    }, [p.sig]); // a node that did not change keeps its object, so React Flow leaves it alone
    R.useEffect(() => {
      const go = (d: number) =>
          setTimeout(
            () => {
              // hidden (another view, a dialog over it, the page going away): d3's animated zoom divides by the
              // canvas size, and the background and the minimap would be drawn at NaN
              if (!inst.current || !p.shown()) return;
              if (p.v)
                void inst.current.setViewport(p.start, {
                  duration: 200,
                });
              else void inst.current.fitView({ duration: d, ...p.fit });
            },
            d ? 90 : 420,
          ),
        t = go(250),
        t2 = p.v ? 0 : go(0);
      return () => {
        clearTimeout(t);
        if (t2) clearTimeout(t2);
      };
    }, [p.fitKey]); /* fitted twice: nodes that were just added are measured a moment later */
    R.useEffect(() => {
      if (!p.v || !p.focus || !inst.current || !p.shown()) return;
      const n = inst.current.getNode(p.focus);
      if (n)
        void inst.current.setCenter(n.position.x + 110, n.position.y + 170, {
          zoom: p.start.zoom,
          duration: 350,
        });
    }, [p.focus, p.v]);
    const onNodesChange = (chs: NodeChange<IslandNode>[]) => {
      chs.forEach((c) => {
        if (c.type === 'position' && c.position && c.dragging) p.onMove(c.id, c.position);
        if (c.type === 'select' && c.selected) {
          const n = p.graph.nodes.find((x) => x.id === c.id);
          if (n && (n.type === 'agent' || n.type === 'gate' || n.type === 'review')) p.onPick(n);
        }
      });
      setNodes((nds) => RF.applyNodeChanges<IslandNode>(chs, nds));
    };
    /* eslint-disable react-hooks/immutability -- React Flow hands over its instance once; the zoom buttons outside the island use it too */
    const onInit = (i: FlowInstance) => {
      inst.current = i;
      FLOW.inst = i;
    };
    return (
      <RF.ReactFlow<IslandNode, RouteEdge>
        nodes={nodes}
        edges={p.graph.edges}
        nodeTypes={NODES}
        edgeTypes={EDGES}
        onNodesChange={onNodesChange}
        onNodeClick={(_ev, n) => p.onPick(n)}
        onInit={onInit}
        fitView={!p.v}
        fitViewOptions={p.fit}
        defaultViewport={p.start}
        colorMode={p.dark ? 'dark' : 'light'}
        nodesConnectable={false}
        edgesFocusable={false}
        selectNodesOnDrag={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={1.6}
        deleteKeyCode={null}
        attributionPosition="bottom-left"
      >
        <RF.Background variant={RF.BackgroundVariant.Dots} gap={18} size={1.4} />
        <Sync sig={p.sig} ids={p.graph.nodes.map((n) => n.id)} />
        {p.map ? (
          <RF.MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeStrokeWidth={3}
            nodeBorderRadius={8}
            ariaLabel="Map of the workflow"
            style={{ width: 150, height: 96 }}
          />
        ) : null}
      </RF.ReactFlow>
    );
    /* eslint-enable react-hooks/immutability */
  };
  return (FLOW.kit = { Island });
}
/** Where the owner dragged the nodes of one canvas; the object is kept, so drags write straight into it. */
function flowPosFor(key: string): Dict<XYPosition> {
  return U.flowPos[key] || (U.flowPos[key] = {});
}
export function FlowView({ app, sel }: { app: AppRecord; sel?: string | null }) {
  // the Preact side: keeps a React root alive and hands it fresh data on every render
  const ref = useRef<HTMLDivElement>(null),
    root = useRef<Root | null>(null),
    w = useWidth(ref),
    ready = FLOW.state === 'ready';
  useEffect(() => {
    if (!ready || !ref.current) return undefined;
    const r = createEagerRoot(ref.current);
    root.current = r;
    notify();
    return () => {
      root.current = null;
      FLOW.inst = null;
      setTimeout(() => {
        try {
          r.unmount();
        } catch {}
      }, 0);
    };
  }, [ready]);
  /* eslint-disable react-hooks/refs -- the canvas's width now, before useWidth has caught up with a resize */
  const wNow = ref.current && ref.current.clientWidth ? ref.current.clientWidth : w,
    v = wNow < 700,
    team = app.def.team ? app.def.team.agents.length : 0,
    fl = flowOf(app),
    nrev = fl.reviewers.length,
    pos = flowPosFor(app.id + (v ? ':v' : '')),
    n = U.flowN || 0,
    map = U.flowMap == null ? !v : U.flowMap;
  /* eslint-enable react-hooks/refs */
  useEffect(() => {
    if (!root.current || !ref.current || !ref.current.clientWidth) return;
    const K = flowKit(),
      graph = flowGraph(app, v),
      live = STATIONS.findIndex((s) => ['working', 'checking', 'sentback', 'waiting'].includes(app.line[s.id].status));
    const pick = (node: FlowNode) => {
      const i = +node.id.slice(1);
      if ((node.type === 'agent' || node.type === 'gate') && node.data.st === 'qa') {
        U.sel[app.id] = 'qa';
        U.follow[app.id] = false;
        if (PHONE())
          U.sheet = {
            kind: 'inspector',
            app: app.id,
          };
        else
          setTimeout(() => {
            const el = document.querySelector('.inspector');
            if (el && el.scrollIntoView)
              el.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
              });
          }, 60);
      } else if (node.type === 'review') {
        U.sel[app.id] = 'rv_' + node.data.rid;
        U.follow[app.id] = false;
        if (PHONE())
          U.sheet = {
            kind: 'inspector',
            app: app.id,
          };
        else
          setTimeout(() => {
            const el = document.querySelector('.inspector');
            if (el && el.scrollIntoView)
              el.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
              });
          }, 60);
      } else if (node.type === 'agent' || node.type === 'gate') {
        U.sel[app.id] = STATIONS[i].id;
        U.follow[app.id] = false;
        U.itab[app.id] =
          node.type === 'gate'
            ? testable(app)
              ? 'tests'
              : 'checks'
            : U.itab[app.id] === 'tests' || U.itab[app.id] === 'checks'
              ? 'out'
              : U.itab[app.id] || 'out';
        if (PHONE())
          U.sheet = {
            kind: 'inspector',
            app: app.id,
          };
        else
          setTimeout(() => {
            const el = document.querySelector('.inspector');
            if (el && el.scrollIntoView)
              el.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
              });
          }, 60);
      } else if (node.type === 'appagent') {
        if (app.status !== 'ready') return;
        U.view[app.id] = 'app';
      } else return;
      notify();
    };
    root.current.render(
      createElement(K.Island, {
        key: v ? 'column' : 'rows',
        graph,
        sig: JSON.stringify(graph.nodes.map((x) => [x.id, x.position, x.width, x.data])) + n,
        pos,
        onMove: (id: string, p: XYPosition) => {
          pos[id] = p;
        },
        onPick: pick,
        dark: isDark(),
        v,
        map,
        focus: live >= 0 ? 'a' + live : null,
        start: (() => {
          const z = Math.max(0.6, Math.min(1, (wNow - 24) / FL.W));
          return {
            x: Math.round((wNow - FL.W * z) / 2),
            y: 12,
            zoom: z,
          };
        })(),
        fitKey:
          app.id +
          '|' +
          v +
          '|' +
          team +
          '|' +
          graph.deep +
          '|' +
          nrev +
          '|' +
          n +
          '|' +
          (app.status === 'ready' && !RUNS[app.id] ? 1 : 0) +
          (v ? '|' + Math.round(wNow / 40) : ''),
        fit: {
          padding: 0.06,
          maxZoom: 1.1,
        },
        shown: () => !!ref.current && ref.current.clientWidth > 0 && ref.current.clientHeight > 0,
      }),
    );
  });
  if (!ready) return <LineView app={app} sel={sel} />;
  const z = (fn: (i: FlowInstance) => unknown) => () => {
      if (FLOW.inst) fn(FLOW.inst);
    },
    deepNow = [0, 1].reduce(
      (n, r) =>
        n + Math.max(...STATIONS.map((st, i) => ((i < 3 ? 0 : 1) === r ? stepsAt(fl, st.id).length + (fl.approve[st.id] ? 1 : 0) : 0))),
      0,
    );
  return (
    <div className="line-wrap flow-wrap" data-tour="line">
      <div
        className={cx('flow-canvas', v && 'narrow')}
        style={toStyle(v ? null : 'height:clamp(460px,calc(100dvh - 330px),' + Math.min(1040, 660 + 96 * deepNow) + 'px)')}
        ref={ref}
        role="group"
        aria-label="The build workflow. Select a node to inspect it, or use its controls to change the workflow."
      />
      <div className="flow-foot">
        <span className="fl-key">
          <i className="k-done" />
          Passed
        </span>
        <span className="fl-key">
          <i className="k-live" />
          Working
        </span>
        <span className="fl-key">
          <i className="k-back" />
          Sent back
        </span>
        <span className="grow" />
        <Btn
          className="btn sm"
          data-tour="customize"
          title="Approvals, added steps, instructions and attempts"
          onClick={() =>
            openDialog('workflow', {
              app: app.id,
            })
          }
        >
          <Icon n="options" s="16" />
          Customize{flowList(fl).length > 0 && <span className="tab-n">{flowList(fl).length}</span>}
        </Btn>
        <div className="btn-group" role="group" aria-label="Zoom the workflow">
          <Btn
            className="btn subtle icon sm"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={z((i) =>
              i.zoomOut({
                duration: 150,
              }),
            )}
          >
            <Icon n="minimize" s="16" />
          </Btn>
          <Btn
            className="btn subtle icon sm"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={z((i) =>
              i.zoomIn({
                duration: 150,
              }),
            )}
          >
            <Icon n="add" s="16" />
          </Btn>
          <Btn
            className="btn subtle sm"
            title="Fit the whole workflow"
            onClick={z((i) =>
              i.fitView({
                padding: 0.06,
                duration: 200,
              }),
            )}
          >
            <Icon n="fit" s="16" />
            <span className="hide-sm">Fit</span>
          </Btn>
        </div>
        <Btn
          className={cx('btn subtle sm hide-sm', map && 'on')}
          aria-pressed={map}
          title="Show or hide the map"
          onClick={() => {
            U.flowMap = !map;
            notify();
          }}
        >
          <Icon n="map" s="16" />
          Map
        </Btn>
        <Btn
          className="btn subtle sm"
          title="Put every node back where it started"
          onClick={() => {
            U.flowPos[app.id + (v ? ':v' : '')] = {};
            U.flowN = n + 1;
            notify();
          }}
        >
          <Icon n="reset" s="16" />
          <span className="hide-md">Reset layout</span>
        </Btn>
      </div>
      <div className="orch">
        <AgentAv id="orchestrator" size="sm" />
        <span>
          <strong>Orchestrator</strong>
          {' is code, not a model. It runs this workflow in order, checks every handoff at its gate, '}
          {fl.attempts === 1
            ? 'gives each station one attempt'
            : 'sends failed work back at most ' + (fl.attempts === 2 ? 'once' : 'twice')}
          {', and after a change re-runs only the stations that change touches. The workflow is yours to extend: press '}
          <strong>+</strong>
          {' on a gate to add an approval or an agent of your own, use the options button on an agent, or ask in chat.'}
        </span>
      </div>
      <FlowChips app={app} empty={undefined} />
    </div>
  );
}
export function BuildSummary({ app }: { app: AppRecord }) {
  // the overview strip above the workflow: what was built, at a glance
  const def = app.def,
    st = testStats(app),
    run = app.runs[app.runs.length - 1],
    go = (v: string) => () => {
      U.view[app.id] = v;
      notify();
    },
    views = Object.values(def.views || {}).reduce((k, list) => k + list.length, 0);
  const tile = (label: string, value: string | number, sub: string, on: (() => void) | null, tone?: string) => (
    <button className={cx('kpi mini', tone)} disabled={!on} onClick={on || undefined}>
      <span className="kpi-l">{label}</span>
      <span className="kpi-v">{value}</span>
      <span className="kpi-s">{sub}</span>
    </button>
  );
  return (
    <div className="kpis build-sum" data-tour="summary">
      {tile(
        'Tables',
        def.tables.length || '–',
        def.tables.length && app.status === 'ready'
          ? def.tables.reduce((k, t) => k + Number(dbCount(app.id, t.name)), 0) + ' rows in SQLite'
          : 'in SQLite',
        def.tables.length ? go('data') : null,
      )}
      {tile('Endpoints', def.process ? deriveEndpoints(def as BriefedDef).length : '–', 'guarded by role', def.process ? go('api') : null)}
      {tile('Views', views || '–', def.dash ? 'plus a dashboard' : 'per table', def.screens.length ? go('app') : null)}
      {tile(
        'Pages',
        def.screens.length || '–',
        def.brief ? 'for ' + def.brief.roles.length + ' roles' : 'per role',
        def.screens.length ? go('app') : null,
      )}
      {tile(
        'Tests',
        st ? st.passed + ' / ' + st.total : '–',
        st ? (st.failed ? st.failed + ' failing' : st.fresh ? 'all pass' : 'run them again') : 'generated when it is built',
        st ? go('tests') : null,
        st && st.failed ? 'bad' : '',
      )}
      {tile(
        'Model calls',
        run ? (run.replayed && !run.calls ? 0 : run.calls) : '–',
        run ? (run.replayed ? run.replayed + ' steps replayed' : run.retries ? run.retries + ' sent back' : 'none sent back') : 'per build',
        null,
      )}
    </div>
  );
}
