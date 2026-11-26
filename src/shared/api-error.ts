/**
 * The error body every API route answers with, and the plain words the workspace shows for each code.
 *
 *   { "code": "rate_limited", "message": "Too many model calls in one minute.", "requestId"?: "…" }
 *
 * `requestId` is in the `x-request-id` header of every answer, and in the body of a 500. It matches the server's log
 * line, so a person can quote it when something goes wrong.
 */
import { z } from 'zod';

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

export const ApiErrorSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(2000).catch(''),
  requestId: z.string().max(128).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Reads an error body, or null when the value is not one. Unknown codes are kept: newer servers may add some. */
export function parseApiError(value: unknown): ApiError | null {
  const r = ApiErrorSchema.safeParse(value);
  return r.success ? r.data : null;
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
      return 'No model is connected on this site, so Live cannot run. Saved builds, the demo and every built app still work.';
    case 'budget':
    case 'spend_cap':
      return "Today's allowance for live model calls is used up. Saved builds and built apps still work. Live comes back tomorrow.";
    case 'rate_limited':
      return 'Too many model calls are running right now. Wait a minute, then run it again.';
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
