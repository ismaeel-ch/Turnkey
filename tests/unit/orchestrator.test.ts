// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRun, defaultWorkflow } from '@/platform/orchestrator';
import type { GateResult, Ports, Question, StepDef, TestRound, WorkflowDefinition } from '@/platform/orchestrator';

interface Script {
  /** station id -> list of gate results, one per attempt. Missing means pass. */
  gates?: Record<string, string[][]>;
  fallback?: Record<string, boolean>;
  question?: Question | null;
  late?: StepDef[];
  /** Tester rounds: failures per run. */
  tests?: number[];
  repairProgress?: boolean[];
  unusable?: Record<string, string[][]>;
  onStation?: (id: string, attempt: number) => void;
}

function harness(script: Script = {}) {
  const log: string[] = [];
  const events: { type: string; name?: string; step?: string; value?: unknown }[] = [];
  const gateCalls: Record<string, number> = {};
  const feedbacks: Record<string, (string[] | null)[]> = {};
  let testRun = 0;
  let repairs = 0;
  let q = script.question ?? null;
  const flags = { stop: false };
  const ports: Ports = {
    emit: (type, p) => events.push({ type, name: p.name as string | undefined, step: p.stepName as string | undefined, value: p.value }),
    async runStation({ station, attempt, feedback }) {
      log.push(`station:${station.id}#${attempt}`);
      (feedbacks[station.id] ??= []).push(feedback);
      script.onStation?.(station.id, attempt);
      const u = script.unusable?.[station.id]?.[attempt - 1];
      if (u) return { issues: u };
    },
    async runGate({ station }) {
      const n = (gateCalls[station.id] = (gateCalls[station.id] ?? 0) + 1);
      const issues = script.gates?.[station.id]?.[n - 1] ?? [];
      log.push(`gate:${station.id}#${n}:${issues.length ? 'fail' : 'pass'}`);
      return { issues, passed: 3 - issues.length, total: 3 } satisfies GateResult;
    },
    async fallback({ station }) {
      log.push(`fallback:${station.id}`);
      const ok = script.fallback?.[station.id] ?? false;
      return { ok, issues: ok ? [] : ['the safe default failed too'] };
    },
    async sentBack({ station, attempt, issues }) {
      log.push(`sentback:${station.id}#${attempt}:${issues.length}`);
    },
    async stationDone({ station }) {
      log.push(`done:${station.id}`);
    },
    async handoff({ station }) {
      log.push(`handoff:${station.id}`);
    },
    async runStep({ step, station }) {
      log.push(`step:${step.id}@${station}`);
    },
    async lateSteps() {
      return script.late ?? [];
    },
    owner: {
      async question() {
        return q;
      },
      async answered({ index }) {
        log.push(`answered:${index}`);
        q = null;
      },
      async decided({ station, approved }) {
        log.push(`decided:${station.id}:${approved}`);
      },
    },
    async ready() {
      log.push('ready');
    },
    tester: {
      async write() {
        log.push('tests:write');
      },
      async run({ round }) {
        const failed = script.tests?.[testRun++] ?? 0;
        log.push(`tests:run#${round}:${failed}`);
        return { total: 10, failed } satisfies TestRound;
      },
      async repair({ round }) {
        const progress = script.repairProgress?.[repairs++] ?? true;
        log.push(`tests:repair#${round}:${progress}`);
        return { progress };
      },
      async done({ status }) {
        log.push(`tests:done:${status}`);
      },
    },
    async wrapUp({ qa, retries }) {
      log.push(`wrapup:${qa}:${retries}`);
    },
    stopped: () => flags.stop,
  };
  return { ports, log, events, feedbacks, flags };
}

const defaults = (over: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({ ...defaultWorkflow(), ...over });
const IDS = ['research', 'database', 'backend', 'views', 'screens', 'walkthrough'];
const happy = (ids = IDS) =>
  ids.flatMap((id, i) => [`station:${id}#1`, `gate:${id}#1:pass`, `done:${id}`, ...(i < ids.length - 1 ? [`handoff:${id}`] : [])]);

describe('workflow graph', () => {
  it('a clean run goes through every station in order, then the Tester, then wraps up', async () => {
    const h = harness();
    const r = await createRun(defaults(), h.ports, { app: 'app1', runId: 'run_1' }).start();
    expect(r.status).toBe('ok');
    expect(h.log).toEqual([...happy(), 'ready', 'tests:write', 'tests:run#1:0', 'tests:done:ok', 'wrapup:ok:0']);
    expect(r.qa).toBe('ok');
    const types = h.events.map((e) => (e.type === 'CUSTOM' ? `CUSTOM:${e.name}` : e.step ? `${e.type}:${e.step}` : e.type));
    expect(types[0]).toBe('RUN_STARTED');
    expect(types.at(-1)).toBe('RUN_FINISHED');
    expect(types.slice(1, 5)).toEqual(['STEP_STARTED:research', 'CUSTOM:checks', 'STEP_FINISHED:research', 'STEP_STARTED:database']);
    expect(types.filter((t) => t === 'CUSTOM:checks')).toHaveLength(6);
    expect(types).toContain('STEP_STARTED:tests');
  });

  it('sends work back with the failures and recovers on the next attempt', async () => {
    const h = harness({ gates: { backend: [['no access rule for managers', 'a table has no owner']] } });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('ok');
    const i = h.log.indexOf('station:backend#1');
    expect(h.log.slice(i, i + 6)).toEqual([
      'station:backend#1',
      'gate:backend#1:fail',
      'sentback:backend#1:2',
      'station:backend#2',
      'gate:backend#2:pass',
      'done:backend',
    ]);
    expect(h.feedbacks.backend).toEqual([null, ['no access rule for managers', 'a table has no owner']]);
    expect(r.retries).toBe(1);
    expect(h.events.some((e) => e.type === 'CUSTOM' && e.name === 'sent_back')).toBe(true);
    expect(h.log.at(-1)).toBe('wrapup:ok:1');
  });

  it('treats an unusable answer as a failed check without calling the gate', async () => {
    const h = harness({ unusable: { database: [['the answer was not valid JSON']] } });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('ok');
    expect(h.log).toContain('sentback:database#1:1');
    expect(h.log).not.toContain('gate:database#1:fail');
  });

  it('fails with the reason when attempts run out and there is no safe default', async () => {
    const bad = ['it does not mount'];
    const h = harness({ gates: { database: [bad, bad, bad] } });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('Database did not pass its checks after three attempts. it does not mount');
    expect(h.log.filter((l) => l.startsWith('station:database'))).toHaveLength(3);
    expect(h.log).not.toContain('station:backend#1');
    expect(h.log).not.toContain('tests:write');
    expect(h.events.map((e) => e.type)).toContain('RUN_ERROR');
    expect(h.events.at(-1)?.type).toBe('RUN_FINISHED');
  });

  it('respects fewer attempts', async () => {
    const bad = ['x'];
    const h = harness({ gates: { database: [bad, bad, bad] } });
    const r = await createRun(defaults({ attempts: 2 }), h.ports).start();
    expect(r.reason).toBe('Database did not pass its checks after two attempts. x');
    expect(h.log.filter((l) => l.startsWith('station:database'))).toHaveLength(2);
  });

  it('uses the safe default on the last attempt when it passes', async () => {
    const bad = ['screens do not mount'];
    const h = harness({ gates: { screens: [bad, bad, bad] }, fallback: { screens: true } });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('ok');
    expect(h.log).toContain('fallback:screens');
    expect(h.log).toContain('done:screens');
  });

  it('fails when the safe default fails too', async () => {
    const bad = ['x'];
    const h = harness({ gates: { views: [bad, bad, bad] }, fallback: { views: false } });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('failed');
    expect(r.reason).toContain('Views did not pass its checks after three attempts.');
  });

  it('gives a station to the rules: one attempt, no send-back, no safe default', async () => {
    const def = defaults();
    def.stations = def.stations.map((s) => (s.id === 'backend' ? { ...s, byRules: true } : s));
    const h = harness({ gates: { backend: [['x']] }, fallback: { backend: true } });
    const r = await createRun(def, h.ports).start();
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('Backend could not be built by the rules. x');
    expect(h.log).not.toContain('fallback:backend');
    expect(h.log.filter((l) => l.startsWith('station:backend'))).toHaveLength(1);
  });

  it('pauses on the Researcher question and resumes with the answer', async () => {
    const h = harness({ question: { text: 'Who approves?', options: ['Manager', 'Anyone'], recommended: 0 } });
    const run = createRun(defaults(), h.ports);
    const first = await run.start();
    expect(first.status).toBe('waiting');
    expect(first.ask).toMatchObject({ reason: 'question', station: 'research', text: 'Who approves?' });
    expect(h.log).toEqual(['station:research#1', 'gate:research#1:pass', 'done:research']);
    expect(h.events.some((e) => e.type === 'CUSTOM' && e.name === 'interrupt')).toBe(true);
    expect(h.events.some((e) => e.type === 'RUN_FINISHED')).toBe(false);
    const done = await run.resume(1);
    expect(done.status).toBe('ok');
    expect(h.log.slice(0, 5)).toEqual(['station:research#1', 'gate:research#1:pass', 'done:research', 'answered:1', 'handoff:research']);
    const resume = h.events.find((e) => e.type === 'CUSTOM' && e.name === 'resume');
    expect(resume?.value).toEqual({ answer: 'Anyone' });
  });

  it('does not ask when there is no question', async () => {
    const h = harness({ question: null });
    expect((await createRun(defaults(), h.ports).start()).status).toBe('ok');
  });

  it('pauses for an approval after a station, and goes on when approved', async () => {
    const h = harness();
    const run = createRun(defaults({ approvals: ['backend'] }), h.ports);
    const first = await run.start();
    expect(first.status).toBe('waiting');
    expect(first.ask).toEqual({ reason: 'approval', station: 'backend' });
    expect(h.log.at(-1)).toBe('done:backend');
    expect(h.log).not.toContain('station:views#1');
    const done = await run.resume(true);
    expect(done.status).toBe('ok');
    expect(h.log).toContain('decided:backend:true');
    expect(h.log.indexOf('decided:backend:true')).toBeLessThan(h.log.indexOf('station:views#1'));
    expect(h.events.find((e) => e.name === 'resume')?.value).toEqual({ approved: true, station: 'backend' });
  });

  it('stops the run when the owner refuses an approval', async () => {
    const h = harness();
    const run = createRun(defaults({ approvals: ['database'] }), h.ports);
    await run.start();
    const r = await run.resume(false);
    expect(r.status).toBe('stopped');
    expect(h.log).toContain('decided:database:false');
    expect(h.log).not.toContain('station:backend#1');
    expect(h.log).not.toContain('tests:write');
    expect(h.events.at(-1)?.type).toBe('RUN_FINISHED');
  });

  it("runs an added step and the owner's own agent right after their station, before the approval", async () => {
    const steps: StepDef[] = [
      { id: 'security', name: 'Security review', after: 'backend', mode: 'advise' },
      { id: 'xmarketer', name: 'Marketer', after: 'backend', mode: 'apply', custom: true },
      { id: 'style', name: 'UI stylist', after: 'screens', mode: 'apply' },
    ];
    const h = harness();
    const run = createRun(defaults({ steps, approvals: ['backend'] }), h.ports);
    expect((await run.start()).status).toBe('waiting');
    expect(h.log.slice(-3)).toEqual(['done:backend', 'step:security@backend', 'step:xmarketer@backend']);
    await run.resume(true);
    const at = (s: string) => h.log.indexOf(s);
    expect(at('step:style@screens')).toBeGreaterThan(at('done:screens'));
    expect(at('step:style@screens')).toBeLessThan(at('station:walkthrough#1'));
    const names = h.events.filter((e) => e.step?.startsWith('review_')).map((e) => `${e.type}:${e.step}`);
    expect(names).toContain('STEP_STARTED:review_security');
    expect(names).toContain('STEP_FINISHED:review_style');
  });

  it('runs steps added after their station had passed, once the stations are done', async () => {
    const h = harness({ late: [{ id: 'data', name: 'Data review', after: 'database', mode: 'advise' }] });
    await createRun(defaults(), h.ports).start();
    const i = h.log.indexOf('step:data@database');
    expect(i).toBeGreaterThan(h.log.indexOf('done:walkthrough'));
    expect(i).toBeLessThan(h.log.indexOf('ready'));
  });

  it('repairs failing tests and runs everything again', async () => {
    const h = harness({ tests: [3, 1, 0] });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('ok');
    expect(r.qa).toBe('ok');
    expect(h.log.slice(h.log.indexOf('tests:write'))).toEqual([
      'tests:write',
      'tests:run#1:3',
      'tests:repair#1:true',
      'tests:run#2:1',
      'tests:repair#2:true',
      'tests:run#3:0',
      'tests:done:ok',
      'wrapup:ok:2',
    ]);
    expect(r.rounds.map((x) => x.failed)).toEqual([3, 1, 0]);
  });

  it('stops repairing after three runs, and the run still succeeds with failing tests', async () => {
    const h = harness({ tests: [2, 2, 2, 2] });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('ok');
    expect(r.qa).toBe('failed');
    expect(h.log.filter((l) => l.startsWith('tests:run'))).toHaveLength(3);
    expect(h.log).toContain('tests:done:failed');
  });

  it('stops repairing when nothing could be repaired', async () => {
    const h = harness({ tests: [2, 2], repairProgress: [false] });
    const r = await createRun(defaults(), h.ports).start();
    expect(r.qa).toBe('failed');
    expect(h.log.filter((l) => l.startsWith('tests:run'))).toHaveLength(1);
  });

  it('starts at a chosen station and keeps the ones before it', async () => {
    const h = harness();
    await createRun(defaults({ from: 'views' }), h.ports).start();
    expect(h.log.slice(0, 2)).toEqual(['station:views#1', 'gate:views#1:pass']);
    expect(h.log.some((l) => l.startsWith('station:database'))).toBe(false);
  });

  it('stops a run in progress', async () => {
    const h = harness({
      onStation: (id) => {
        if (id === 'backend') h.flags.stop = true;
      },
    });
    const run = createRun(defaults(), h.ports);
    const r = await run.start();
    expect(r.status).toBe('stopped');
    expect(h.log).not.toContain('station:views#1');
    expect(h.log).not.toContain('tests:write');
    expect(h.events.at(-1)?.type).toBe('RUN_FINISHED');
    expect(h.events.some((e) => e.type === 'RUN_ERROR')).toBe(false);
  });

  it('stops a run that is waiting for the owner', async () => {
    const h = harness({ question: { text: 'Q?', options: ['a', 'b'] } });
    const run = createRun(defaults(), h.ports);
    await run.start();
    run.stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.events.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
    await expect(run.resume(0)).rejects.toThrow();
    expect(h.log).not.toContain('station:database#1');
  });

  it('reports a thrown error as a failed run with its message', async () => {
    const h = harness();
    h.ports.runStation = async () => {
      throw new Error('The model call failed: rate limited');
    };
    const r = await createRun(defaults(), h.ports).start();
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('The model call failed: rate limited');
  });

  it('attaches the app and run ids to events', async () => {
    const h = harness();
    const seen: Record<string, unknown>[] = [];
    h.ports.emit = (_t, p) => seen.push(p);
    await createRun(defaults(), h.ports, { app: 'app_9', runId: 'run_4' }).start();
    expect(seen.every((p) => p.app === 'app_9')).toBe(true);
    expect(seen.find((p) => p.stepName === 'research')).toMatchObject({ runId: 'run_4' });
  });
});

describe('mermaid diagram', () => {
  it('matches the committed drawing of the default workflow', async () => {
    const { readFileSync } = await import('node:fs');
    const { diagram } = await import('@/platform/orchestrator/diagram');
    expect(diagram()).toBe(readFileSync('src/platform/orchestrator/default-workflow.mmd', 'utf8'));
  });
  it('draws approvals and added steps at their positions', async () => {
    const { diagram } = await import('@/platform/orchestrator/diagram');
    const text = diagram({ approvals: ['backend'], steps: [{ id: 'security', name: 'Security', after: 'backend', mode: 'advise' }] });
    expect(text).toContain('st_backend_step_security');
    expect(text).toContain('st_backend_approve');
  });
});
