/**
 * GET /api/connectors/[name]?q=...&limit=n: run one public-data connector, for the browser's connection test.
 *
 *   200  { ok: true, items: [{ title, url, text, source }] }
 *   4xx/5xx  { ok: false, code, message }
 *
 * The visitor's headers and cookies are never passed on: only the query text and the item count reach the source.
 */
import { limiter, visitorOf } from '@/server/guard/limits';
import { getConnector } from '@/server/connectors';
import type { ConnectorErrorCode } from '@/server/connectors/types';

export const runtime = 'nodejs';

const STATUS: Record<ConnectorErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  not_configured: 503,
  timeout: 504,
  upstream: 502,
  bad_response: 502,
};

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const verdict = limiter.take(visitorOf(request));
  if (!verdict.ok) {
    const headers = verdict.retryAfter ? { 'retry-after': String(verdict.retryAfter) } : undefined;
    return json(verdict.code === 'off' ? 503 : 429, { ok: false, code: verdict.code, message: verdict.message }, headers);
  }

  const { name } = await params;
  const connector = getConnector(name);
  if (!connector) return json(404, { ok: false, code: 'not_found', message: `There is no connector called "${name}".` });

  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam === null ? undefined : Number(limitParam);

  const result = await connector.search(q, { limit });
  if (result.ok) return json(200, result);
  return json(STATUS[result.code], result);
}
