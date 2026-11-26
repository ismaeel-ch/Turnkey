/**
 * Helpers shared by the API routes: read and validate a JSON body, answer with a uniform error, name the visitor.
 *
 * Every refusal is JSON `{ code, message }` with `cache-control: no-store`. Codes: not_configured, rate_limited,
 * budget, bad_request, too_large, forbidden.
 */
import { z } from 'zod';
import { visitorOf } from './limits';

export type ErrorCode = 'not_configured' | 'rate_limited' | 'budget' | 'bad_request' | 'too_large' | 'forbidden';

export function refuse(status: number, code: ErrorCode, message: string, headers?: Record<string, string>) {
  return Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/** Reads the body as JSON and checks it against `schema`. Returns the data, or the Response to send back. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = 1_000_000,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes)
    return { ok: false, response: refuse(413, 'too_large', 'The request is too large.') };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: refuse(400, 'bad_request', 'The request body could not be read.') };
  }
  if (text.length > maxBytes) return { ok: false, response: refuse(413, 'too_large', 'The request is too large.') };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, response: refuse(400, 'bad_request', 'The request body must be JSON.') };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join('.') + ': ' : '';
    return { ok: false, response: refuse(400, 'bad_request', where + (issue?.message ?? 'The request is not valid.')) };
  }
  return { ok: true, data: parsed.data };
}

/** The key one visitor is counted under: their address, shortened so a forged header cannot grow the counters. */
export function visitorKey(request: Request): string {
  return visitorOf(request).slice(0, 64);
}

/**
 * True when a browser sent this request from another site. A page elsewhere could otherwise make its visitors'
 * browsers call the model routes (a plain-text POST needs no preflight), spending the budget from many addresses at
 * once. Browsers say where a request came from in `Sec-Fetch-Site`; older ones only in `Origin`. A request with
 * neither header is not from a browser page and is left to the rate limits.
 */
export function isCrossSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'cross-site';
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return origin === 'null';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    return !host || new URL(origin).host !== host.split(',')[0].trim();
  } catch {
    return true;
  }
}

/** The refusal for a request another site sent, or null when it may go on. */
export function refuseCrossSite(request: Request): Response | null {
  return isCrossSite(request) ? refuse(403, 'forbidden', 'This route only answers Turnkey itself.') : null;
}

/** The refusal for a limiter verdict that said no. */
export function refuseVerdict(verdict: { code: 'rate_limited' | 'budget' | 'off'; message: string; retryAfter?: number }) {
  const headers = verdict.retryAfter ? { 'retry-after': String(verdict.retryAfter) } : undefined;
  return verdict.code === 'off'
    ? refuse(503, 'not_configured', verdict.message, headers)
    : refuse(429, verdict.code, verdict.message, headers);
}
