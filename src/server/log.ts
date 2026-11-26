/**
 * Structured server logs: one JSON object per line, which Vercel's log view can search and filter. Server only.
 *
 *   {"level":"info","event":"request","requestId":"…","route":"llm","method":"POST","status":200,"ms":1820,
 *    "outcome":"ok","modelCalls":1,"inputTokens":812,"outputTokens":240,"costUsd":0.00429}
 *
 * `withRequestLog(route, handler)` wraps an API route: it gives the request an id (Vercel's own when there is one),
 * sends it back in `x-request-id`, and logs one `request` line when the response has been sent in full, so a streamed
 * answer is timed to its end and carries the tokens and cost of every model call it made. A handler that throws
 * answers 500 with the uniform `{ code: "internal", message, requestId }` instead of Next's bare error page.
 *
 * Never logged: a prompt, an answer, a request body, a key, a cookie or the visitor's address.
 *
 *   LOG_LEVEL   debug | info | warn | error | silent   (default info; silent under vitest)
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type Env = Record<string, string | undefined>;
export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Fields = Record<string, string | number | boolean | null | undefined>;

const RANK: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold(env: Env): number {
  const set = (env.LOG_LEVEL || '').trim().toLowerCase();
  if (set in RANK) return RANK[set as Level | 'silent'];
  return env.VITEST ? RANK.silent : RANK.info;
}

/** What one request has done so far. Model calls add to it from anywhere below the route. */
type RequestContext = {
  requestId: string;
  route: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

const store = new AsyncLocalStorage<RequestContext>();

type Sink = (level: Level, line: string) => void;
const consoleSink: Sink = (level, line) => {
  // console.error and console.warn go to Vercel's error stream; info and debug to the normal one
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
};
let sink: Sink = consoleSink;

/** Tests swap where lines go. Returns a function that puts the console back. */
export function setLogSink(next: Sink): () => void {
  sink = next;
  return () => {
    sink = consoleSink;
  };
}

/** Writes one line. `requestId` and `route` of the current request are added when there is one. */
export function log(level: Level, event: string, fields: Fields = {}, env: Env = process.env) {
  if (RANK[level] < threshold(env)) return;
  const ctx = store.getStore();
  const line: Record<string, unknown> = { level, event, time: new Date().toISOString() };
  if (ctx) {
    line.requestId = ctx.requestId;
    line.route = ctx.route;
  }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) line[k] = v;
  sink(level, JSON.stringify(line));
}

/** The message of anything thrown, cut short. Never a stack: stacks can carry file paths and request data. */
export function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown error';
  return text.length > 300 ? text.slice(0, 300) + '…' : text;
}

/** Called by the gateway when a model call ends, so the request line carries its tokens and cost. */
export function noteModelCall(usage: { input?: number; output?: number; cacheRead?: number; costUsd?: number }) {
  const ctx = store.getStore();
  if (!ctx) return;
  ctx.modelCalls += 1;
  ctx.inputTokens += usage.input ?? 0;
  ctx.outputTokens += usage.output ?? 0;
  ctx.cacheReadTokens += usage.cacheRead ?? 0;
  ctx.costUsd += usage.costUsd ?? 0;
}

/** The id of the request being handled, or null outside one. */
export function currentRequestId(): string | null {
  return store.getStore()?.requestId ?? null;
}

const ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

/** Vercel's id for the request when it is there and well formed, else a fresh one. */
export function requestIdFor(request: Request): string {
  const vercel = request.headers.get('x-vercel-id');
  if (vercel && ID_RE.test(vercel)) return vercel;
  return crypto.randomUUID();
}

/** The uniform answer for an error nobody expected. The id lets the owner find the log line. */
export function internalError(requestId: string): Response {
  return Response.json(
    { code: 'internal', message: 'Something went wrong on the server. Please try again.', requestId },
    { status: 500, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
  );
}

type Handler<C> = (request: Request, context: C) => Response | Promise<Response>;
/** The context is optional so a route without params can be called with the request alone (as tests do). */
type Wrapped<C> = (request: Request, context?: C) => Promise<Response>;

/**
 * Wraps a route handler with a request id, one structured log line per request and a typed 500 for anything thrown.
 * `route` is a short fixed name (`llm`, `agent.step`, …), never taken from the URL.
 */
export function withRequestLog<C = unknown>(route: string, handler: Handler<C>): Wrapped<C> {
  return async (request, context) => {
    const ctx: RequestContext = {
      requestId: requestIdFor(request),
      route,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
    };
    const started = Date.now();
    return store.run(ctx, async () => {
      let response: Response;
      try {
        response = await handler(request, context as C);
      } catch (e) {
        log('error', 'unhandled', { method: request.method, error: errorText(e) });
        response = internalError(ctx.requestId);
      }

      let logged = false;
      const finish = (outcome: 'ok' | 'aborted' | 'failed') => {
        if (logged) return;
        logged = true;
        const failed = outcome === 'failed' || response.status >= 500;
        store.run(ctx, () =>
          log(failed ? 'error' : response.status >= 400 ? 'warn' : 'info', 'request', {
            method: request.method,
            status: response.status,
            ms: Date.now() - started,
            outcome,
            modelCalls: ctx.modelCalls || undefined,
            inputTokens: ctx.modelCalls ? ctx.inputTokens : undefined,
            outputTokens: ctx.modelCalls ? ctx.outputTokens : undefined,
            cacheReadTokens: ctx.cacheReadTokens || undefined,
            costUsd: ctx.modelCalls ? Math.round(ctx.costUsd * 1e6) / 1e6 : undefined,
          }),
        );
      };

      const headers = new Headers(response.headers);
      headers.set('x-request-id', ctx.requestId);
      if (!response.body) {
        finish('ok');
        return new Response(null, { status: response.status, statusText: response.statusText, headers });
      }
      // Pass the body through untouched and log when it ends, so a stream is timed to its last byte.
      const reader = response.body.getReader();
      const tracked = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              finish('ok');
              controller.close();
            } else controller.enqueue(value);
          } catch (e) {
            log('error', 'stream_failed', { error: errorText(e) });
            finish('failed');
            controller.error(e);
          }
        },
        cancel(reason) {
          finish('aborted');
          return reader.cancel(reason);
        },
      });
      return new Response(tracked, { status: response.status, statusText: response.statusText, headers });
    });
  };
}
