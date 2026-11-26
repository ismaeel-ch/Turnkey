/**
 * Shared HTTP plumbing for providers that call an API with fetch: retries with backoff for 429 and 5xx, a request
 * pacer that keeps one instance under the gateway's 60 requests a minute, and the mapping from a refusal to an
 * LlmError that is safe to show (never a key, never the address).
 */
import { LlmError } from './types';

export type RetryOptions = {
  /** Most tries, the first included. The project rule is three attempts at most. */
  attempts?: number;
  /** First wait in milliseconds; each later wait doubles. */
  baseMs?: number;
  /** Longest single wait. */
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** Called before a wait. For tests and logs: it must not receive the request. */
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number }) => void;
};

const realSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError('aborted', 'the call was stopped', 499));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new LlmError('aborted', 'the call was stopped', 499))), {
      once: true,
    });
  });

/** `Retry-After` in seconds or as a date, in milliseconds. */
export function retryAfterMs(res: Response, now = Date.now()): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * Runs `send` until it answers with something other than 429 or a 5xx, or the attempts are used up; the last
 * response is returned either way so the caller can map it to an error. Network failures are retried too.
 */
export async function withRetries(send: () => Promise<Response>, options: RetryOptions = {}): Promise<Response> {
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 3));
  const base = options.baseMs ?? 500;
  const max = options.maxMs ?? 8000;
  const sleep = options.sleep ?? ((ms: number) => realSleep(ms, options.signal));
  let last: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw new LlmError('aborted', 'the call was stopped', 499);
    let status: number | null = null;
    let wait = Math.min(max, base * 2 ** (attempt - 1));
    try {
      const res = await send();
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      status = res.status;
      last = res;
      lastError = null;
      const asked = retryAfterMs(res);
      if (asked !== null) wait = Math.min(max, asked);
      if (attempt < attempts) await res.body?.cancel().catch(() => undefined);
    } catch (e) {
      if (options.signal?.aborted) throw new LlmError('aborted', 'the call was stopped', 499);
      lastError = e;
      last = null;
    }
    if (attempt < attempts) {
      options.onRetry?.({ attempt, status, waitMs: wait });
      await sleep(wait);
    }
  }
  if (last) return last;
  throw lastError instanceof Error ? lastError : new Error('the request failed');
}

/**
 * Keeps calls under a requests-per-minute limit with a sliding window. A call that would go over waits for room, up
 * to `maxWaitMs`; beyond that it is refused as rate limited, so a request never hangs for long.
 */
export function createPacer(
  perMinute: number,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void>; maxWaitMs?: number } = {},
) {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => realSleep(ms));
  const maxWait = opts.maxWaitMs ?? 15_000;
  const stamps: number[] = [];
  return async function pace(): Promise<void> {
    for (;;) {
      const t = now();
      while (stamps.length && t - stamps[0] >= 60_000) stamps.shift();
      if (stamps.length < perMinute) {
        stamps.push(t);
        return;
      }
      const wait = 60_000 - (t - stamps[0]) + 5;
      if (wait > maxWait) throw new LlmError('rate_limited', 'too many model calls this minute; try again shortly', 429);
      await sleep(wait);
    }
  };
}

/** Removes anything that looks like a key from text that may reach the browser or a log. */
export function scrub(text: string): string {
  return text
    .replace(/\b(sk|pk|key|ak)-[A-Za-z0-9_\-.]{3,}/gi, '$1-…')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[address]')
    .replace(/\bBearer\s+[A-Za-z0-9_\-.=]+/gi, 'Bearer …');
}

/** Maps a refused response to an LlmError. Reads at most 300 characters of the body and passes none of the secrets on. */
export async function errorFromResponse(res: Response): Promise<LlmError> {
  const detail = scrub((await res.text().catch(() => '')).slice(0, 300));
  if (res.status === 401 || res.status === 403) return new LlmError('unauthorized', 'the model gateway refused the key', 401);
  if (/budget/i.test(detail)) return new LlmError('budget', 'the model budget is used up', 429);
  if (res.status === 429) return new LlmError('rate_limited', 'the model gateway is rate limiting', 429);
  // A success status only reaches here when the answer had no body: the service failed, not the request.
  if (res.ok) return new LlmError('upstream', 'the model gateway answered ' + res.status + ' with no body');
  return new LlmError(
    res.status >= 500 ? 'upstream' : 'bad_request',
    'the model gateway answered ' + res.status + (detail ? ': ' + detail : ''),
  );
}

/** Reads `data: {...}` lines of a server-sent event stream, with the optional `event:` name, and yields parsed JSON. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string | null; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  const parse = function* (line: string): Generator<{ event: string | null; data: unknown }> {
    const text = line.trim();
    if (text.startsWith('event:')) {
      event = text.slice(6).trim();
      return;
    }
    if (!text.startsWith('data:')) return;
    const data = text.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      yield { event, data: JSON.parse(data) };
    } catch {
      // a partial or non-JSON keep-alive line: ignore it
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        yield* parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
      }
    }
    yield* parse(buffer + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
