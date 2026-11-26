import { parseIdentity } from '@/platform/pwa/identity';
import { appManifest } from '@/platform/pwa/manifest';

// GET /a/manifest?name=&accent=&glyph=&shape=&fill=&mark=&c=   the web manifest of one app.
// Every parameter is checked against a catalog or reduced to safe characters; a bad one is a 400.
export function GET(request: Request) {
  const parsed = parseIdentity(new URL(request.url).searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  return new Response(JSON.stringify(appManifest(parsed.identity)), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
