import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtVersion, checkForUpdate, isNewer } from '@/platform/pwa/update';

describe('a newer version on the server', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('compares plain version numbers', () => {
    expect(isNewer('0.5.5', '0.5.4')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.5.4', '0.5.4')).toBe(false);
    expect(isNewer('0.5.3', '0.5.4')).toBe(false);
    expect(isNewer('v0.6.0', '0.5.4')).toBe(false);
    expect(isNewer('', '0.5.4')).toBe(false);
  });
  it('stays quiet when the server runs the same version, or cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ version: builtVersion })));
    expect(await checkForUpdate(true)).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    expect(await checkForUpdate(true)).toBeNull();
    vi.stubGlobal('fetch', async () => new Response('not json'));
    expect(await checkForUpdate(true)).toBeNull();
  });
  it('reports the newer version the server runs', async () => {
    const [a, b, c] = builtVersion.split('.').map(Number);
    const next = a + '.' + b + '.' + (c + 1);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ version: next })));
    expect(await checkForUpdate(true)).toBe(next);
  });
});
