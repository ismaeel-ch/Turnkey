import { describe, expect, it } from 'vitest';
import { QUICK_ROLES_DEFAULT, quickRoles, tierFor } from '@/server/graph/step/tiers';
import { createStepGraph } from '@/server/graph/step/graph';
import type { ChatRequest, Provider } from '@/server/llm';

describe('model tier per builder role', () => {
  it('keeps the design roles on the default tier and sends the rest to the quick one', () => {
    for (const r of ['research', 'database', 'backend'] as const) expect(tierFor(r, 'default', {})).toBe('default');
    for (const r of QUICK_ROLES_DEFAULT) expect(tierFor(r, 'default', {})).toBe('quick');
  });
  it('a quick build stays quick for every role', () => {
    expect(tierFor('database', 'quick', {})).toBe('quick');
  });
  it('LLM_QUICK_ROLES changes the list, ignores unknown names, and `none` keeps everything on default', () => {
    expect([...quickRoles({ LLM_QUICK_ROLES: 'tester, nonsense ,views' })].sort()).toEqual(['tester', 'views']);
    expect(tierFor('views', 'default', { LLM_QUICK_ROLES: 'none' })).toBe('default');
  });
  it('the step graph calls the model on the tier its role maps to', async () => {
    const seen: string[] = [];
    const provider: Provider = {
      id: 'fake',
      nativeTools: false,
      model: () => 'fake',
      async *stream(req: ChatRequest) {
        seen.push(req.tier ?? '');
        yield { type: 'delta', text: '{"ok":true}' };
        yield { type: 'done', truncated: false };
      },
    } as unknown as Provider; // only stream and tier matter here
    const graph = createStepGraph({ provider });
    await graph.invoke({ input: { prompt: 'Say hello', role: 'any', tier: 'default' } });
    expect(seen).toEqual(['default']);
    seen.length = 0;
    await graph.invoke({ input: { prompt: 'Say hello', role: 'tester', tier: 'default' } }); // fails the Tester's shape, so it repairs: every attempt quick
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['quick']));
  });
});
