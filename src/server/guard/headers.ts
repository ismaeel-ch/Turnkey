/**
 * Security headers for every response, set from `headers()` in next.config.ts.
 *
 * The content security policy is as tight as the app allows:
 *   script-src   own files, the inline scripts Next.js writes into each page (no per-request nonce, so pages stay
 *                static and cacheable), and 'wasm-unsafe-eval' so SQLite (sql.js) can compile its WebAssembly.
 *                Nothing else may evaluate strings as code; development also needs 'unsafe-eval' for hot reload.
 *   style-src    own files and inline styles: the workspace sets style="..." attributes on its elements.
 *   img-src      own files, data: and blob: (app icons, charts, exports).
 *   connect-src  this origin only. The browser never calls a model provider or any other site.
 *   worker-src   this origin only: the service worker and nothing else.
 */
export function contentSecurityPolicy(dev = process.env.NODE_ENV === 'development'): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'worker-src': ["'self'"],
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

export function securityHeaders(dev = process.env.NODE_ENV === 'development'): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(dev) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  ];
}
