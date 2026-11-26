import { describe, expect, it } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { graphAgent } from '@/server/agui/graph-agent';
import { meterCalls, recordUsage, withUsage, type CallUsage } from '@/server/llm/usage';
import type { Provider, Usage } from '@/server/llm/types';

const input: RunAgentInput = { threadId: 't', runId: 'r', messages: [], tools: [], context: [], state: {}, forwardedProps: {} };
const env = { LLM_LOG_USAGE: '0' };

/** A provider that answers "ok" and reports the given usage. */
const fake = (usage?: Usage): Provider => ({
  id: 'fake',
  model: () => 'claude-haiku-5-5',
  async *stream() {
    yield { type: 'delta', text: 'ok' };
    yield { type: 'done', truncated: false, usage };
  },
});

describe('meterCalls', () => {
  it('passes every call made inside it, even after an await, and none outside it', async () => {
    const seen: CallUsage[] = [];
    await meterCalls(
      (c) => seen.push(c),
      async () => {
        await Promise.resolve();
        recordUsage(
          {
            provider: 'p',
            model: 'm',
            tier: 'quick',
            effort: 'low',
            usage: { input: 10, output: 5, cacheRead: 30, costUsd: 0.0012345678 },
            ms: 7,
          },
          env,
        );
      },
    );
    recordUsage({ provider: 'p', model: 'm', tier: 'quick', effort: 'low', usage: { input: 1 }, ms: 1 }, env);
    expect(seen).toEqual([
      { model: 'm', tier: 'quick', input: 10, output: 5, cacheRead: 30, cacheWrite: 0, costUsd: 0.001235, ms: 7, estimated: false },
    ]);
  });

  it('a meter that throws does not break the call', () => {
    expect(() =>
      meterCalls(
        () => {
          throw new Error('broken');
        },
        () => recordUsage({ provider: 'p', model: 'm', tier: 'default', effort: 'x', usage: {}, ms: 0 }, env),
      ),
    ).not.toThrow();
  });

  it('an unpriced call reports a null cost', () => {
    const seen: CallUsage[] = [];
    meterCalls(
      (c) => seen.push(c),
      () => recordUsage({ provider: 'p', model: 'm', tier: 'default', effort: 'x', usage: { input: 3 }, ms: 0 }, env),
    );
    expect(seen[0].costUsd).toBeNull();
  });
});

describe('GraphAgent usage events', () => {
  it('each model call in a run becomes a CUSTOM usage event with tokens and cost', async () => {
    const provider = withUsage(fake({ input: 100, output: 20, cacheRead: 300 }), env);
    const agent = graphAgent(async () => {
      for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'hi' }], tier: 'quick' })) void chunk;
    });
    const events = await lastValueFrom(agent.run(input).pipe(toArray()));
    const usage = events.filter((e: BaseEvent) => e.type === EventType.CUSTOM) as unknown as { name: string; value: CallUsage }[];
    expect(usage).toHaveLength(1);
    expect(usage[0].name).toBe('usage');
    expect(usage[0].value).toMatchObject({
      model: 'claude-haiku-5-5',
      tier: 'quick',
      input: 100,
      output: 20,
      cacheRead: 300,
      estimated: false,
    });
    expect(typeof usage[0].value.costUsd).toBe('number');
    expect(usage[0].value.costUsd).toBeGreaterThan(0);
    expect(JSON.stringify(usage[0].value)).not.toMatch(/hi|ok/); // never the prompt or the answer
  });

  it('a call cut short is reported as an estimate', async () => {
    const provider = withUsage(fake({ input: 1 }), env);
    const agent = graphAgent(async () => {
      for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'x'.repeat(400) }], tier: 'quick' })) {
        void chunk;
        break; // leave after the first piece of text, before usage arrives
      }
    });
    const events = await lastValueFrom(agent.run(input).pipe(toArray()));
    const usage = events.find((e) => e.type === EventType.CUSTOM) as unknown as { value: CallUsage };
    expect(usage.value).toMatchObject({ estimated: true, input: 100 });
  });
});
