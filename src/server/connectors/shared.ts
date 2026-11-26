/**
 * Helpers every connector uses: requests with an 8 second limit per try, retried with backoff when the source is
 * briefly down, a 10 minute in-memory cache, text trimming and a clear error object in place of a thrown error.
 * Nothing here sends a visitor's headers or cookies.
 *
 * Retries: at most 3 tries per request, only for failures that may pass (a timeout, no connection, status 429 or
 * 5xx), waiting about 0.4 s and then 1.2 s (or what `Retry-After` asks, up to 3 s) in between, and never past 15 s
 * in all. A 4xx other than 429, or an answer in the wrong shape, is final at once.
 */
import type { ConnectorError, ConnectorErrorCode, ConnectorResult } from './types';

export const TIMEOUT_MS = 8000;
export const MAX_TRIES = 3;
/** No new try starts once a request has taken this long, so an agent's lookup never hangs a run. */
export const TOTAL_BUDGET_MS = 15000;
const MAX_RETRY_AFTER_MS = 3000;

/** Waits between tries. Tests swap it for one that does not wait. */
let pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// No waiting under vitest, so tests of failing sources stay fast; tests of the waits set it with setConnectorRetry.
let backoffBase = process.env.VITEST ? 0 : 400;

/** For tests only: how to wait between tries, and the first wait in ms (0 = no wait). Returns the old settings' undo. */
export function setConnectorRetry(o: { pause?: (ms: number) => Promise<void>; baseMs?: number }): () => void {
  const before = { pause, backoffBase };
  if (o.pause) pause = o.pause;
  if (o.baseMs !== undefined) backoffBase = o.baseMs;
  return () => {
    pause = before.pause;
    backoffBase = before.backoffBase;
  };
}

/** The wait before try `n + 1` (n = 1, 2): about 1x then 3x the base, give or take a quarter, or the source's ask. */
export function backoffMs(n: number, retryAfter: string | null, base = backoffBase, rand: () => number = Math.random): number {
  const asked = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(asked) && asked >= 0) return Math.min(asked * 1000, MAX_RETRY_AFTER_MS);
  return Math.round(base * 3 ** (n - 1) * (0.75 + rand() * 0.5));
}
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

/** One try. `retry` says whether another try may help. */
async function sendOnce(
  doFetch: Fetcher,
  url: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown },
  timeoutMs: number = TIMEOUT_MS,
): Promise<{ ok: true; response: Response } | { ok: false; error: ConnectorError; retry: boolean; retryAfter: string | null }> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/json', ...init.headers };
  const hasBody = init.body !== undefined;
  if (hasBody) headers['content-type'] = 'application/json';
  // a timer of our own rather than AbortSignal.timeout, so the limit can be cut to what is left of the budget
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('The source did not answer in time.', 'TimeoutError')), timeoutMs);
  // On success the timer keeps running so reading the body is held to the same limit; it never keeps the process up.
  (timer as { unref?: () => void }).unref?.();
  try {
    const response = await doFetch(url, {
      method: init.method ?? (hasBody ? 'POST' : 'GET'),
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: timeout.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      clearTimeout(timer);
      const retry = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        error: fail('upstream', `The source answered with status ${response.status}.`),
        retry,
        retryAfter: response.headers.get('retry-after'),
      };
    }
    return { ok: true, response };
  } catch (err) {
    clearTimeout(timer);
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: fail('timeout', 'The source did not answer in time.'), retry: true, retryAfter: null };
    }
    return { ok: false, error: fail('upstream', 'The source could not be reached.'), retry: true, retryAfter: null };
  }
}

async function send(
  doFetch: Fetcher,
  url: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown },
): Promise<{ ok: true; response: Response } | { ok: false; error: ConnectorError }> {
  const started = Date.now();
  for (let n = 1; ; n++) {
    // a later try gets only what is left of the budget, so the whole request never runs past it
    const r = await sendOnce(doFetch, url, init, Math.min(TIMEOUT_MS, TOTAL_BUDGET_MS - (Date.now() - started)));
    if (r.ok) return r;
    const wait = backoffMs(n, r.retryAfter);
    if (!r.retry || n >= MAX_TRIES || Date.now() - started + wait >= TOTAL_BUDGET_MS) {
      const tries = n > 1 ? ` (tried ${n} times)` : '';
      return { ok: false, error: { ...r.error, message: r.error.message.replace(/\.$/, '') + tries + '.' } };
    }
    if (wait > 0) await pause(wait);
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
