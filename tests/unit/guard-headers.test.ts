import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, DISABLED_FEATURES, securityHeaders } from '@/server/guard/headers';
import nextConfig from '../../next.config';

const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((d) => d.startsWith(name + ' '))
    ?.split(' ')
    .slice(1) ?? [];

describe('security headers', () => {
  const csp = contentSecurityPolicy(false);
  it('lets SQLite compile WebAssembly, and nothing else evaluate strings, in production', () => {
    expect(directive(csp, 'script-src')).toContain("'wasm-unsafe-eval'");
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(contentSecurityPolicy(true), 'script-src')).toContain("'unsafe-eval'");
  });
  it('allows the workspace its inline styles, data and blob images, and its service worker', () => {
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'");
    expect(directive(csp, 'img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']));
    expect(directive(csp, 'worker-src')).toEqual(["'self'"]);
  });
  it('keeps requests, frames, plugins and forms on this origin', () => {
    expect(directive(csp, 'connect-src')).toEqual(["'self'"]);
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'frame-src')).toEqual(["'self'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(csp).not.toMatch(/https?:|\*/);
  });
  it('refuses inline event handlers, so injected markup cannot run code through onclick="..."', () => {
    expect(directive(csp, 'script-src-attr')).toEqual(["'none'"]);
  });
  it('sets every header with the expected value', () => {
    const h = Object.fromEntries(securityHeaders(false).map((x) => [x.key, x.value]));
    expect(h['Content-Security-Policy']).toBe(csp);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(h['X-Permitted-Cross-Domain-Policies']).toBe('none');
    expect(h['Strict-Transport-Security']).toMatch(/^max-age=(\d+); includeSubDomains$/);
    expect(Number(/max-age=(\d+)/.exec(h['Strict-Transport-Security'])![1])).toBeGreaterThanOrEqual(31536000);
  });
  it('switches off the browser features Turnkey never uses, and leaves clipboard alone', () => {
    const pp = securityHeaders(false).find((x) => x.key === 'Permissions-Policy')!.value;
    for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'browsing-topics']) expect(pp).toContain(f + '=()');
    expect(pp.split(', ')).toHaveLength(DISABLED_FEATURES.length);
    expect(pp).not.toMatch(/clipboard|interest-cohort/);
  });
  it('sends the headers on every path, pages and API answers alike', async () => {
    const rules = (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
    const all = rules.find((r) => r.source === '/:path*');
    expect(all?.headers).toEqual(securityHeaders());
  });
});
