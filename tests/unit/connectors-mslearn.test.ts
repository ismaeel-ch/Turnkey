import { describe, expect, it } from 'vitest';
import { MCP_URL, itemsFrom, msLearn, readRpc } from '@/server/connectors/mslearn';
import { fakeFetch, jsonResponse } from './connectors.helpers';

// Made-up answers in the shape the MCP streamable HTTP transport uses. No network is used.
const hits = [
  {
    title: 'Reset a user password',
    content: 'Admins can reset a password from the admin center.',
    contentUrl: 'https://learn.microsoft.com/en-us/microsoft-365/admin/add-users/reset-passwords',
  },
  { title: 'Elsewhere', content: 'Not a Learn page.', contentUrl: 'https://example.com/page' },
];
const sse = (body: unknown) =>
  new Response('event: message\ndata: ' + JSON.stringify(body) + '\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'abc' },
  });

function server(answerAs: 'json' | 'sse', toolText = JSON.stringify(hits)) {
  return fakeFetch((_url, init) => {
    const body = JSON.parse(String(init.body)) as { id?: number; method: string };
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result =
      body.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'learn', version: '1' } }
        : { content: [{ type: 'text', text: toolText }] };
    const msg = { jsonrpc: '2.0', id: body.id, result };
    return answerAs === 'sse' ? sse(msg) : jsonResponse(msg);
  });
}

describe('Microsoft Learn MCP connector', () => {
  it('starts a session, sends the notice, calls microsoft_docs_search, and keeps only Learn links', async () => {
    const { doFetch, calls } = server('json');
    const r = await msLearn.search('reset password json', { fetch: doFetch });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ title: 'Reset a user password', source: 'Microsoft Learn' });
    expect(calls.map((c) => JSON.parse(String(c.init.body)).method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    expect(calls.every((c) => c.url === MCP_URL)).toBe(true);
    expect(JSON.parse(String(calls[2].init.body)).params).toEqual({
      name: 'microsoft_docs_search',
      arguments: { query: 'reset password json' },
    });
  });

  it('reads event-stream answers and sends the session id back', async () => {
    const { doFetch, calls } = server('sse');
    const r = await msLearn.search('reset password stream', { fetch: doFetch });
    expect(r.ok).toBe(true);
    expect((calls[2].init.headers as Record<string, string>)['mcp-session-id']).toBe('abc');
  });

  it('says plainly when the server cannot be reached or answers an error', async () => {
    const down = fakeFetch(() => new Response('', { status: 404 }));
    const r = await msLearn.search('anything down', { fetch: down.doFetch });
    expect(r).toMatchObject({ ok: false, code: 'upstream' });
    const refused = fakeFetch((_u, init) =>
      jsonResponse({ jsonrpc: '2.0', id: JSON.parse(String(init.body)).id, error: { code: -32601, message: 'no' } }),
    );
    expect(await msLearn.search('anything refused', { fetch: refused.doFetch })).toMatchObject({ ok: false, code: 'upstream' });
  });

  it('turns plain tool text into one item, and nothing into not_found', async () => {
    expect(itemsFrom(['Some passage about Teams.'], 3)).toEqual([
      expect.objectContaining({ text: 'Some passage about Teams.', url: 'https://learn.microsoft.com/' }),
    ]);
    const empty = server('json', JSON.stringify([]));
    expect(await msLearn.search('nothing here', { fetch: empty.doFetch })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('matches the answer to its request id and skips other messages in a stream', () => {
    const text =
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n';
    expect(readRpc(text, 'text/event-stream', 7)?.result).toEqual({ ok: 1 });
    expect(readRpc('not json', 'application/json', 1)).toBeNull();
  });

  it('refuses an empty query before any request', async () => {
    const { doFetch, calls } = server('json');
    expect(await msLearn.search('  ', { fetch: doFetch })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });
});
