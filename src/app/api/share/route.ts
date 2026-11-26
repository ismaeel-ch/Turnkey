/**
 * POST /api/share  { code, name, slug?, token? }  → { slug, path, token? }
 *   Saves a shared app under a short name made from its name, so /<slug> opens it. The first save returns a token;
 *   sending it back with the slug puts a newer version under the same name. 503 not_configured when this deployment
 *   has no store: the workspace then shares the long "#app=" link.
 * GET /api/share → { enabled } : whether short links are on here.
 */
import { createLimiter, lightLimiter, lightLimitsFrom } from '@/server/guard/limits';
import { parseBody, refuse, refuseVerdict, visitorKey } from '@/server/guard/http';
import { MAX_CODE, shareRequestSchema } from '@/server/share/records';
import { saveShare } from '@/server/share/service';
import { resolveShareStore } from '@/server/share/store';
import { withRequestLog } from '@/server/log';

export const runtime = 'nodejs';

/** Saves are rarer than reads: a person shares a few times an hour, not every second. */
const saveLimiter = createLimiter();
const saveLimits = () => ({ ...lightLimitsFrom(), perMinute: Number(process.env.SHARE_SAVES_PER_MINUTE) || 12, globalPerMinute: 200 });

function get(request: Request) {
  const light = lightLimiter.take(visitorKey(request), lightLimitsFrom());
  if (!light.ok) return refuseVerdict(light);
  return Response.json({ enabled: !!resolveShareStore() }, { headers: { 'cache-control': 'no-store' } });
}

async function post(request: Request) {
  const verdict = saveLimiter.take(visitorKey(request), saveLimits());
  if (!verdict.ok) return refuseVerdict(verdict);
  const store = resolveShareStore();
  if (!store) return refuse(503, 'not_configured', 'Short links are not set up on this site. The long link works.');
  const body = await parseBody(request, shareRequestSchema, MAX_CODE + 2000);
  if (!body.ok) return body.response;
  try {
    const r = await saveShare(store, body.data);
    if (!r.ok)
      return Response.json({ code: 'bad_request', message: r.error }, { status: r.status, headers: { 'cache-control': 'no-store' } });
    return Response.json(
      { slug: r.slug, path: '/' + r.slug, ...(r.token ? { token: r.token } : {}) },
      { status: r.created ? 201 : 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return refuse(503, 'not_configured', 'The short link could not be saved just now. The long link works.');
  }
}

export const GET = withRequestLog('share.status', get);

export const POST = withRequestLog('share.save', post);
