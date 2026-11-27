/**
 * Microsoft Learn: search Microsoft's official documentation through its public MCP server. No key is needed.
 *
 * This is Turnkey's first MCP connection. It speaks the MCP "streamable HTTP" transport by hand, because a search is
 * three small JSON-RPC requests: `initialize`, the `notifications/initialized` notice, and one `tools/call` of
 * `microsoft_docs_search`. The server may answer a request as plain JSON or as a short event stream; both are read.
 * A session id the server hands back on `initialize` is sent with the later requests. Nothing is kept open: every
 * search starts and ends its own session, which suits a serverless function.
 */
import { z } from 'zod';
import type { Connector, ConnectorItem, ConnectorOptions, ConnectorResult } from './types';
import { cached, cleanQuery, clampLimit, fail, requestResponse, trimText } from './shared';

export const MCP_URL = 'https://learn.microsoft.com/api/mcp';
const PROTOCOL_VERSION = '2025-06-18';
const MAX_ITEMS = 5;
const SEARCH_TOOL = 'microsoft_docs_search';

const rpcAnswer = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
type RpcAnswer = z.infer<typeof rpcAnswer>;

const toolResult = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});

/** One search hit as the server writes it inside the tool's text. Field names vary a little, so both are accepted. */
const hit = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  contentUrl: z.string().optional(),
  url: z.string().optional(),
});

/** Reads a JSON-RPC answer from a plain JSON body or from an event stream (`data:` lines), matching the request id. */
export function readRpc(text: string, contentType: string, id: number): RpcAnswer | null {
  const candidates: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        candidates.push(JSON.parse(data));
      } catch {
        // a keep-alive or a line that is not JSON: skip it
      }
    }
  } else {
    try {
      const body: unknown = JSON.parse(text);
      if (Array.isArray(body)) candidates.push(...(body as unknown[]));
      else candidates.push(body);
    } catch {
      return null;
    }
  }
  for (const c of candidates) {
    const parsed = rpcAnswer.safeParse(c);
    if (parsed.success && parsed.data.id === id) return parsed.data;
  }
  return null;
}

/** Turns the tool's text into items: a JSON list of hits when it is one, otherwise the text itself as one item. */
export function itemsFrom(texts: string[], limit: number): ConnectorItem[] {
  const items: ConnectorItem[] = [];
  for (const t of texts) {
    let list: unknown = null;
    try {
      list = JSON.parse(t);
    } catch {
      list = null;
    }
    const arr = Array.isArray(list)
      ? list
      : list && typeof list === 'object' && Array.isArray((list as { results?: unknown }).results)
        ? (list as { results: unknown[] }).results
        : null;
    if (arr) {
      for (const raw of arr) {
        const h = hit.safeParse(raw);
        if (!h.success) continue;
        const url = h.data.contentUrl || h.data.url || '';
        if (!/^https:\/\/learn\.microsoft\.com\//.test(url)) continue; // only links to Microsoft Learn itself
        items.push({
          title: trimText(h.data.title || 'Microsoft Learn', 160, false),
          url,
          text: trimText(h.data.content || '', 400, false),
          source: 'Microsoft Learn',
        });
      }
    } else if (t.trim()) {
      items.push({
        title: 'Microsoft Learn',
        url: 'https://learn.microsoft.com/',
        text: trimText(t, 400, false),
        source: 'Microsoft Learn',
      });
    }
  }
  return items.slice(0, limit);
}

async function search(query: string, options: ConnectorOptions = {}): Promise<ConnectorResult> {
  const q = cleanQuery(query);
  if (!q.ok) return q;
  const limit = clampLimit(options.limit, MAX_ITEMS);
  const doFetch = options.fetch ?? fetch;

  return cached(`mslearn|${q.value}|${limit}`, async () => {
    let session: string | null = null;
    const call = async (id: number | null, method: string, params: unknown): Promise<RpcAnswer | null | { failed: ConnectorResult }> => {
      const headers: Record<string, string> = { accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL_VERSION };
      if (session) headers['mcp-session-id'] = session;
      const body = id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
      const res = await requestResponse(doFetch, MCP_URL, { method: 'POST', headers, body });
      if (!res.ok) return { failed: res };
      session = res.response.headers.get('mcp-session-id') ?? session;
      if (id === null) return null; // a notice: the server answers 202 with no body
      let text = '';
      try {
        text = await res.response.text();
      } catch {
        return { failed: fail('bad_response', 'Microsoft Learn answered, but the answer could not be read.') };
      }
      const answer = readRpc(text, res.response.headers.get('content-type') ?? '', id);
      return answer ?? { failed: fail('bad_response', 'Microsoft Learn answered in an unexpected shape.') };
    };

    const init = await call(1, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'turnkey', version: '0.1' },
    });
    if (init && 'failed' in init) return init.failed;
    if (init?.error) return fail('upstream', 'Microsoft Learn refused to start: ' + init.error.message);
    const noticed = await call(null, 'notifications/initialized', {});
    if (noticed && 'failed' in noticed) return noticed.failed;

    const got = await call(2, 'tools/call', { name: SEARCH_TOOL, arguments: { query: q.value } });
    if (got && 'failed' in got) return got.failed;
    if (!got) return fail('bad_response', 'Microsoft Learn did not answer the search.');
    if (got.error) return fail('upstream', 'Microsoft Learn could not search: ' + got.error.message);
    const result = toolResult.safeParse(got.result);
    if (!result.success) return fail('bad_response', 'Microsoft Learn answered in an unexpected shape.');
    if (result.data.isError) return fail('upstream', 'Microsoft Learn could not search for that.');
    const items = itemsFrom(
      result.data.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text as string),
      limit,
    );
    if (items.length === 0) return fail('not_found', `Microsoft Learn has nothing for "${q.value}".`);
    return { ok: true, items };
  });
}

export const msLearn: Connector = {
  id: 'mslearn',
  label: 'Microsoft Learn',
  describe: {
    name: 'search_microsoft_learn',
    purpose: "Search Microsoft's official documentation (Azure, Microsoft 365, Windows, .NET and more) through its MCP server.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'What to look up, in plain words.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS, description: 'How many passages to return.' },
      },
      required: ['query'],
    },
  },
  search,
};
