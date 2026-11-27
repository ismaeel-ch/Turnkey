/**
 * Security headers for every response, set from `headers()` in next.config.ts.
 *
 * The content security policy is as tight as the app allows:
 *   script-src   own files, the inline scripts Next.js writes into each page, and 'wasm-unsafe-eval' so SQLite
 *                (sql.js) can compile its WebAssembly. Nothing else may evaluate strings as code; development also
 *                needs 'unsafe-eval' for hot reload. There is no per-request nonce on purpose: a nonce forces every
 *                page to render on the server for each request, and the service worker answers the page from its
 *                cache so the workspace opens offline. SECURITY.md says more.
 *   script-src-attr  'none': no inline event handlers (onclick="..."). React never writes them, so markup that
 *                slips into the page through innerHTML cannot run code that way.
 *   style-src    own files and inline styles: the workspace sets style="..." attributes on its elements.
 *   img-src      own files, data: and blob: (app icons, charts, exports).
 *   connect-src  this origin only. The browser never calls a model provider or any other site.
 *   worker-src   this origin only: the service worker and nothing else.
 *   frame-src    this origin only (printing uses a blank frame of its own); frame-ancestors 'none' stops any
 *                other site from framing Turnkey.
 */
export function contentSecurityPolicy(dev = process.env.NODE_ENV === 'development'): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'worker-src': ["'self'"],
    'frame-src': ["'self'"],
    'manifest-src': ["'self'"],
    'media-src': ["'self'", 'data:', 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => k + ' ' + v.join(' '))
    .join('; ');
}

/**
 * Browser features Turnkey never uses, switched off for the page and anything it embeds. Only names that current
 * browsers recognise, because an unknown name is reported as an error in the console. Clipboard, fullscreen and
 * web share stay at their defaults: the workspace copies links and text.
 */
export const DISABLED_FEATURES = [
  'accelerometer',
  'browsing-topics',
  'camera',
  'display-capture',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'serial',
  'usb',
  'xr-spatial-tracking',
] as const;

export function securityHeaders(dev = process.env.NODE_ENV === 'development'): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(dev) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Older browsers that do not know frame-ancestors.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: DISABLED_FEATURES.map((f) => f + '=()').join(', ') },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Other sites may not load Turnkey's files (pages, API answers, icons) into their own pages.
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    // Two years, every subdomain. Not 'preload': the site lives on a vercel.app subdomain it does not own.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  ];
}
