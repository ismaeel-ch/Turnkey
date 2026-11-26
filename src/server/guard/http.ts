/**
 * Helpers shared by the API routes: read and validate a JSON body, answer with a uniform error, name the visitor.
 *
 * Every refusal is JSON `{ code, message }` with `cache-control: no-store`. Codes: not_configured, rate_limited,
 * budget, bad_request, too_large.
 */
import type { z } from 'zod';
import { visitorOf } from './limits';

export type ErrorCode = 'not_configured' | 'rate_limited' | 'budget' | 'bad_request' | 'too_large';

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

/** The refusal for a limiter verdict that said no. */
export function refuseVerdict(verdict: { code: 'rate_limited' | 'budget' | 'off'; message: string; retryAfter?: number }) {
  const headers = verdict.retryAfter ? { 'retry-after': String(verdict.retryAfter) } : undefined;
  return verdict.code === 'off'
    ? refuse(503, 'not_configured', verdict.message, headers)
    : refuse(429, verdict.code, verdict.message, headers);
}
