import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '@/server/guard/headers';

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
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(csp).not.toMatch(/https?:|\*/);
  });
  it('sets the other standard headers', () => {
    const keys = securityHeaders(false).map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'Content-Security-Policy',
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Referrer-Policy',
        'Permissions-Policy',
      ]),
    );
  });
});
