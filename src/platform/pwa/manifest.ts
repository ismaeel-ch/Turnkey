// The web manifest of one app. Pure: takes a validated identity, returns the JSON the route sends.
import { createHash } from 'node:crypto';
import { ACCENT_COLORS, identityQuery, type AppIdentity } from './identity';

export const ICON_SIZES = [48, 64, 96, 128, 144, 180, 192, 256, 384, 512] as const;

export function iconUrl(id: AppIdentity, size: number, extra: Record<string, string> = {}): string {
  return '/a/icon?' + identityQuery(id, { size: String(size), ...extra });
}

export function appManifest(id: AppIdentity) {
  const hasCode = id.code !== '';
  const key = createHash('sha256')
    .update(hasCode ? id.code : id.name)
    .digest('base64url')
    .slice(0, 22);
  return {
    id: '/?tk-app=' + key,
    name: id.name,
    short_name: id.name.length > 12 ? id.name.slice(0, 12).trim() : id.name,
    description: id.name + ', an app built with Turnkey.',
    // A share code is only ever added behind the "#app=" the workspace already reads.
    start_url: hasCode ? '/#app=' + id.code : '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: ACCENT_COLORS[id.accent][0],
    icons: [
      { src: iconUrl(id, 192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: iconUrl(id, 512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: iconUrl(id, 512, { maskable: '1' }), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: iconUrl(id, 512, { format: 'svg' }), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
