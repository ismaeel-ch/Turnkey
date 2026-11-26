// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StoppedError, createRun, defaultWorkflow, workflowFromFlow } from '@/platform/orchestrator';
import type { Ports } from '@/platform/orchestrator';

/** The workspace's own stop error (`Stopped` in src/workspace/line.ts) is a subclass, thrown from inside a port. */
class Stopped extends StoppedError {}

function ports(over: Partial<Ports> = {}): { ports: Ports; events: string[] } {
  const events: string[] = [];
  const p: Ports = {
    emit: (type) => events.push(type),
    async runStation() {},
    async runGate() {
      return { issues: [], passed: 1, total: 1 };
    },
    async sentBack() {},
    async stationDone() {},
    async runStep() {},
    owner: { question: async () => null, answered: async () => {}, decided: async () => {} },
    async ready() {},
    tester: { write: async () => {}, run: async () => ({ total: 1, failed: 0 }), repair: async () => ({ progress: false }), done: async () => {} },
    async wrapUp() {},
    ...over,
  };
  return { ports: p, events };
}

describe('workflow graph, as the workspace drives it', () => {
  it('treats a stop thrown from inside a port as a stop, not a failure', async () => {
    const h = ports({
      async runStation({ station }) {
        if (station.id === 'backend') throw new Stopped();
      },
    });
    const r = await createRun(defaultWorkflow(), h.ports).start();
    expect(r.status).toBe('stopped');
    expect(h.events).not.toContain('RUN_ERROR');
    expect(h.events.at(-1)).toBe('RUN_FINISHED');
  });

  it('builds the definition from the owner workflow: attempts, approvals, rules and added steps', () => {
    const def = workflowFromFlow(
      {
        attempts: 2,
        approve: { database: true },
        by: { views: 'rules' },
        reviewers: ['security'],
        at: { security: 'views' },
        auto: {},
      },
      (id) => (id === 'security' ? { name: 'Security reviewer', after: 'backend' } : undefined),
      'backend',
    );
    expect(def.attempts).toBe(2);
    expect(def.approvals).toEqual(['database']);
    expect(def.stations.find((s) => s.id === 'views')?.byRules).toBe(true);
    expect(def.steps).toEqual([{ id: 'security', name: 'Security reviewer', after: 'views', mode: 'advise' }]);
    expect(def.from).toBe('backend');
  });
});
