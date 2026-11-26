/**
 * GET /api/share/<slug> → { slug, name, code, updated }: the shared app saved under a short name. 404 when there is
 * none. The code is untrusted in the browser too: the workspace checks it like any "#app=" link.
 */
import { lightLimiter, lightLimitsFrom } from '@/server/guard/limits';
import { refuse, refuseVerdict, visitorKey } from '@/server/guard/http';
import { readShare } from '@/server/share/service';
import { resolveShareStore } from '@/server/share/store';
import { withRequestLog } from '@/server/log';

export const runtime = 'nodejs';

async function get(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const light = lightLimiter.take(visitorKey(request), lightLimitsFrom());
  if (!light.ok) return refuseVerdict(light);
  const store = resolveShareStore();
  if (!store) return refuse(503, 'not_configured', 'Short links are not set up on this site.');
  const { slug } = await ctx.params;
  try {
    const found = await readShare(store, slug);
    if (!found)
      return Response.json(
        { code: 'not_found', message: 'No app is shared under this name.' },
        { status: 404, headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(found, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return refuse(503, 'not_configured', 'The shared app could not be read just now.');
  }
}

export const GET = withRequestLog('share.read', get);
