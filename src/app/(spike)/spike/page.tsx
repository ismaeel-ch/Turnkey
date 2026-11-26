'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { CopilotKit, CopilotSidebar, useAgent, UseAgentUpdate, useFrontendTool } from '@copilotkit/react-core/v2';
import { EMPTY_CANVAS, NODE_KINDS, STORAGE_KEY, type CanvasNode, type CanvasState } from '@/lib/canvas';

export default function Page() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="default">
      <Workspace />
    </CopilotKit>
  );
}

function loadCanvas(): CanvasState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as CanvasState;
  } catch {}
  return EMPTY_CANVAS;
}

function Workspace() {
  const { agent } = useAgent({ agentId: 'default', updates: [UseAgentUpdate.OnStateChanged] });
  // React holds the rendered canvas; agent.setState mirrors it into AG-UI
  // shared state so the agent sees it on every run. agent.setState alone
  // does not re-render subscribers, so both are updated together.
  const [canvas, setCanvas] = useState<CanvasState>(EMPTY_CANVAS);
  const canvasRef = useRef(canvas);
  const commit = useCallback(
    (next: CanvasState) => {
      canvasRef.current = next;
      setCanvas(next);
      agent.setState(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
    },
    [agent],
  );

  // Restore from localStorage once per agent instance.
  const seeded = useRef<unknown>(null);
  useEffect(() => {
    if (seeded.current === agent) return;
    seeded.current = agent;
    // useAgent can swap in a new agent instance after /info; keep what we have.
    commit(canvasRef.current.nodes.length ? canvasRef.current : loadCanvas());
  }, [agent, commit]);

  // Agent-side state events (STATE_SNAPSHOT / STATE_DELTA) flow back in here.
  const agentNodes = (agent.state as CanvasState | undefined)?.nodes;
  useEffect(() => {
    if (!agentNodes || JSON.stringify(agentNodes) === JSON.stringify(canvasRef.current.nodes)) return;
    const next = { ...canvasRef.current, nodes: agentNodes };
    canvasRef.current = next;
    setCanvas(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, [agentNodes]);

  // The spike: one tool call from the model that updates canvas state.
  useFrontendTool({
    name: 'add_canvas_node',
    description: 'Add one building block of the app to the shared canvas.',
    parameters: z.object({
      kind: z.enum(NODE_KINDS).describe('Type of block, from the fixed catalog'),
      title: z.string().describe('Short title, under 6 words'),
      detail: z.string().optional().describe('One short sentence'),
    }),
    handler: async ({ kind, title, detail }) => {
      const current = canvasRef.current.nodes;
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        kind,
        title,
        detail,
        by: 'Architect',
        at: new Date().toISOString(),
      };
      commit({ ...canvasRef.current, nodes: [...current, node] });
      return { ok: true, id: node.id, total: current.length + 1 };
    },
  });

  const addManual = () => {
    const current = canvasRef.current.nodes;
    commit({
      ...canvasRef.current,
      nodes: [...current, { id: crypto.randomUUID(), kind: 'note', title: 'My note', by: 'you', at: new Date().toISOString() }],
    });
  };

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Turnkey</h1>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>spike: tool call → shared canvas state</span>
        <div className="spacer" />
        <button className="btn" onClick={addManual}>
          Add note
        </button>
        <button className="btn" onClick={() => commit(EMPTY_CANVAS)}>
          Clear
        </button>
      </header>
      <main className="canvas" data-testid="canvas">
        {canvas.nodes.length === 0 && <div className="empty">Describe an app in the chat, for example “a clinic appointments app”.</div>}
        {canvas.nodes.map((n) => (
          <div key={n.id} className={`node k-${n.kind}`} data-testid="node">
            <div className="kind">{n.kind}</div>
            <div className="title">{n.title}</div>
            {n.detail && <div className="detail">{n.detail}</div>}
            <div className="by">Added by {n.by}</div>
          </div>
        ))}
      </main>
      <CopilotSidebar defaultOpen />
    </div>
  );
}
