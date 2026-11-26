/**
 * Helpers every connector uses: one request with an 8 second limit, a 10 minute in-memory cache, text trimming and
 * a clear error object in place of a thrown error. Nothing here sends a visitor's headers or cookies.
 */
import type { ConnectorError, ConnectorErrorCode, ConnectorResult } from './types';

export const TIMEOUT_MS = 8000;
export const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const MAX_QUERY_CHARS = 200;

/** Sent with every outside request. Says what the caller is and that it is a connection test or an agent's lookup. */
export const USER_AGENT = 'Turnkey/0.1 (public-data connector; read-only lookups)';

export function fail(code: ConnectorErrorCode, message: string): ConnectorError {
  return { ok: false, code, message };
}

/** Trims a query to a sane size and says if it is empty. */
export function cleanQuery(query: unknown): { ok: true; value: string } | ConnectorError {
  if (typeof query !== 'string') return fail('bad_request', 'The query must be text.');
  const value = query.replace(/\s+/g, ' ').trim();
  if (!value) return fail('bad_request', 'The query is empty.');
  if (value.length > MAX_QUERY_CHARS) return fail('bad_request', `The query is longer than ${MAX_QUERY_CHARS} characters.`);
  return { ok: true, value };
}

/** Clamps a requested item count to 1..max, with a default. */
export function clampLimit(limit: number | undefined, max: number, fallback = 3): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

/**
 * Trims text to `max` characters on a word boundary. For HTML snippets (`html` true, the default) it first removes
 * tags and the common entities. Plain text that a parser has already decoded (`html` false) keeps its markup.
 */
export function trimText(raw: string, max = 400, html = true): string {
  const stripped = html
    ? raw
        .replace(/<[^>]*>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    : raw;
  const plain = stripped.replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

type Fetcher = typeof fetch;

/** A GET or POST with the timeout and headers set. Returns the parsed body or an error object. Never throws. */
export async function requestJson(
  doFetch: Fetcher,
  url: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ ok: true; body: unknown } | ConnectorError> {
  const res = await send(doFetch, url, init);
  if (!res.ok) return res.error;
  try {
    return { ok: true, body: await res.response.json() };
  } catch {
    return fail('bad_response', 'The source answered, but not with JSON.');
  }
}

/** Same as requestJson, but returns the body as text (for Atom XML). */
export async function requestText(
  doFetch: Fetcher,
  url: string,
  init: { headers?: Record<string, string> } = {},
): Promise<{ ok: true; text: string } | ConnectorError> {
  const res = await send(doFetch, url, init);
  if (!res.ok) return res.error;
  try {
    return { ok: true, text: await res.response.text() };
  } catch {
    return fail('bad_response', 'The source answered, but the answer could not be read.');
  }
}

async function send(
  doFetch: Fetcher,
  url: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown },
): Promise<{ ok: true; response: Response } | { ok: false; error: ConnectorError }> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/json', ...init.headers };
  const hasBody = init.body !== undefined;
  if (hasBody) headers['content-type'] = 'application/json';
  try {
    const response = await doFetch(url, {
      method: init.method ?? (hasBody ? 'POST' : 'GET'),
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      return { ok: false, error: fail('upstream', `The source answered with status ${response.status}.`) };
    }
    return { ok: true, response };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: fail('timeout', 'The source did not answer in time.') };
    }
    return { ok: false, error: fail('upstream', 'The source could not be reached.') };
  }
}

type Entry = { value: ConnectorResult; expires: number };
const cache = new Map<string, Entry>();

/**
 * Runs `load` once per key for ten minutes. Only successful answers are kept, so a timeout is retried next time.
 * The cache is in memory: a serverless instance keeps it while warm, which is all this needs.
 */
export async function cached(key: string, load: () => Promise<ConnectorResult>, now: () => number = Date.now): Promise<ConnectorResult> {
  const t = now();
  const hit = cache.get(key);
  if (hit && hit.expires > t) return hit.value;
  const value = await load();
  if (value.ok) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      for (const [k, e] of cache) if (e.expires <= t) cache.delete(k);
      if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    }
    cache.set(key, { value, expires: t + CACHE_TTL_MS });
  }
  return value;
}

/** For tests only: forgets every cached answer. */
export function clearConnectorCache(): void {
  cache.clear();
}
