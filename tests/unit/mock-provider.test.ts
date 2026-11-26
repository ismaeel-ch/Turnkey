import { describe, expect, it } from 'vitest';
import { mockProvider } from '@/server/llm/providers/mock';
import type { ChatChunk, ChatRequest } from '@/server/llm/types';

async function collect(stream: AsyncIterable<ChatChunk>) {
  const out: ChatChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}
const textOf = (chunks: ChatChunk[]) => chunks.map((c) => (c.type === 'delta' ? c.text : '')).join('');
const request = (content: string, tier: ChatRequest['tier'] = 'default'): ChatRequest => ({
  messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content }],
  tier,
});

describe('mock provider', () => {
  it('needs no key and names a model per tier', () => {
    const p = mockProvider();
    expect(p.id).toBe('mock');
    expect(p.model('default')).toBe('mock-default');
    expect(p.model('quick')).toBe('mock-quick');
  });

  it('answers with a JSON echo of the last message, streamed in pieces, then done', async () => {
    const chunks = await collect(mockProvider().stream(request('Build a stock tracker')));
    expect(JSON.parse(textOf(chunks))).toEqual({ mock: true, echo: 'Build a stock tracker' });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.slice(0, -1).every((c) => c.type === 'delta' && c.text.length > 0)).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ type: 'done', truncated: false });
  });

  it('echoes at most 80 characters of the message', async () => {
    const long = 'x'.repeat(200);
    const text = textOf(await collect(mockProvider().stream(request(long))));
    expect(JSON.parse(text).echo).toBe('x'.repeat(80));
  });

  it('reports rough token counts in the done event', async () => {
    const chunks = await collect(mockProvider().stream(request('abcdefgh')));
    const done = chunks.at(-1);
    expect(done).toMatchObject({ usage: { input: 2 } });
    expect(done && 'usage' in done ? done.usage?.output : undefined).toBeGreaterThan(0);
  });

  it('streams whatever the reply function returns, and hands it the request', async () => {
    const seen: ChatRequest[] = [];
    const p = mockProvider((r) => {
      seen.push(r);
      return '[{"title":"Hello"}]';
    });
    const chunks = await collect(p.stream(request('ignored', 'quick')));
    expect(textOf(chunks)).toBe('[{"title":"Hello"}]');
    expect(seen[0].tier).toBe('quick');
    expect(seen[0].messages[0].role).toBe('system');
  });

  it('answers an empty reply with an empty stream and a done event', async () => {
    const chunks = await collect(mockProvider(() => '').stream(request('x')));
    expect(chunks).toEqual([{ type: 'done', truncated: false, usage: { input: 1, output: 0 } }]);
  });
});
