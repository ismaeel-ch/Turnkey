import { ImageResponse } from 'next/og';
import { createElement } from 'react';
import { parseIdentity } from '@/platform/pwa/identity';
import { logoSvg } from '@/platform/pwa/logo';
import { ICON_SIZES } from '@/platform/pwa/manifest';

// GET /a/icon?name=&accent=&glyph=&shape=&fill=&mark=&size=192&format=png|svg&maskable=1
// The icon of one app, drawn from its identity. Only catalog values reach the drawing; a bad one is a 400.
export function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const parsed = parseIdentity(q);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const size = q.get('size') === null ? 512 : Number(q.get('size'));
  if (!(ICON_SIZES as readonly number[]).includes(size))
    return Response.json({ error: 'size is not one of ' + ICON_SIZES.join(', ') }, { status: 400 });
  const format = q.get('format') ?? 'png';
  if (format !== 'png' && format !== 'svg') return Response.json({ error: 'format is png or svg' }, { status: 400 });
  const maskable = q.get('maskable') === '1';
  const svg = logoSvg(parsed.identity, { size, maskable });
  const cache = 'public, max-age=31536000, immutable';
  if (format === 'svg') {
    // A strict policy makes the file inert if someone opens it as a page.
    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': cache,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  }
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const res = new ImageResponse(createElement('img', { src, width: size, height: size, style: { width: size, height: size } }), {
    width: size,
    height: size,
  });
  res.headers.set('cache-control', cache);
  res.headers.set('x-content-type-options', 'nosniff');
  return res;
}
