/**
 * The error body every API route answers with, and the plain words the workspace shows for each code.
 *
 *   { "code": "rate_limited", "message": "Too many model calls in one minute.", "requestId"?: "…" }
 *
 * `requestId` is in the `x-request-id` header of every answer, and in the body of a 500. It matches the server's log
 * line, so a person can quote it when something goes wrong.
 */
// A hand-written check rather than zod: the workspace imports this file, and zod would add about 95 KB (gzip) to the page.

export const API_ERROR_CODES = [
  'not_configured',
  'rate_limited',
  'budget',
  'bad_request',
  'too_large',
  'forbidden',
  'not_found',
  'upstream',
  'timeout',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiError = { code: string; message: string; requestId?: string };

/** Reads an error body, or null when the value is not one. Unknown codes are kept: newer servers may add some. */
export function parseApiError(value: unknown): ApiError | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.code !== 'string' || v.code.length < 1 || v.code.length > 64) return null;
  if (v.requestId !== undefined && (typeof v.requestId !== 'string' || v.requestId.length > 128)) return null;
  const message = typeof v.message === 'string' && v.message.length <= 2000 ? v.message : '';
  return { code: v.code, message, ...(v.requestId !== undefined ? { requestId: v.requestId } : {}) };
}

/**
 * What to tell the person when a model call did not happen or did not finish. `code` may be a route code above or
 * one of the workspace's own (`not_granted`, `network`, `aborted`); `offline` is the browser's view of the connection.
 */
export function modelProblem(code: string | undefined, opts: { offline?: boolean; detail?: string } = {}): string {
  if (opts.offline) return 'The connection dropped during the call, so Live is paused. Run it again when you are back online.';
  switch (code) {
    case 'not_granted':
    case 'not_configured':
    case 'unauthorized':
      return 'No model is connected on this site, so Live cannot run. Saved builds, Demo and every app you built keep working.';
    case 'budget':
    case 'spend_cap':
      // the server says whether the whole day's allowance is gone or only this visitor's share of it
      return /your share/i.test(opts.detail || '')
        ? "You have used your share of today's live model calls, so Live is paused for you until midnight UTC. Saved builds, Demo and every app you built keep working."
        : "Today's allowance for live model calls is used up, so Live is paused until midnight UTC. Saved builds, Demo and every app you built keep working.";
    case 'rate_limited':
      return 'The model is busy right now. Wait a minute and run it again, or use Demo to keep going.';
    case 'upstream':
      return 'The model service had a problem and did not answer. Run it again in a minute, or use Demo to keep going.';
    case 'timeout':
      return 'The model took too long to answer. Run it again; a shorter request may help.';
    case 'internal':
      return 'The server hit an error it did not expect. Run it again in a moment.';
    case 'network':
      return 'Turnkey could not reach its server. Check the connection, then run it again.';
    default:
      return 'The model call failed' + (opts.detail ? ': ' + opts.detail : '.');
  }
}

/**
 * True when `code` says the model could not be used at all (none connected, allowance used up, busy, down, out of
 * reach), as opposed to an answer that came back wrong. The workspace then offers Demo as the way to keep going.
 */
export function modelOutage(code: string | undefined): boolean {
  return (
    !!code &&
    [
      'not_granted',
      'not_configured',
      'unauthorized',
      'budget',
      'spend_cap',
      'rate_limited',
      'upstream',
      'timeout',
      'internal',
      'network',
    ].includes(code)
  );
}

/** True when running the same call again cannot help today: no model, or the allowance is used up. */
export function modelGoneForToday(code: string | undefined): boolean {
  return code === 'not_granted' || code === 'not_configured' || code === 'unauthorized' || code === 'budget' || code === 'spend_cap';
}
