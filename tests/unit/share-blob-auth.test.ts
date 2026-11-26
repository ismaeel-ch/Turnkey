import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { fn: string; opts: Record<string, unknown> }[] = [];
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (_path: string, _body: string, opts: Record<string, unknown>) => {
    calls.push({ fn: 'put', opts });
    return {};
  }),
  get: vi.fn(async (_path: string, opts: Record<string, unknown>) => {
    calls.push({ fn: 'get', opts });
    return null;
  }),
}));

import { blobStore } from '@/server/share/store';

const record = {
  v: 1 as const,
  slug: 'clinic-desk',
  name: 'Clinic Desk',
  code: '1.abc',
  tokenHash: 'a'.repeat(64),
  created: '2026-11-26T00:00:00Z',
  updated: '2026-11-26T00:00:00Z',
};

describe('blobStore sign-in', () => {
  beforeEach(() => {
    calls.length = 0;
  });
  it('with a store id: passes the id and no token, so the SDK uses the OIDC token', async () => {
    const store = blobStore({ storeId: 'store_abc' });
    await store.write(record, { create: true });
    await store.read('clinic-desk');
    for (const c of calls) {
      expect(c.opts.storeId).toBe('store_abc');
      expect(c.opts).not.toHaveProperty('token');
      expect(c.opts.access).toBe('private');
    }
    expect(calls.map((c) => c.fn)).toEqual(['put', 'get']);
  });
  it('with a read-write token: passes the token', async () => {
    const store = blobStore({ token: 'vercel_blob_rw_x_y' });
    await store.write(record, { create: false });
    expect(calls[0].opts).toMatchObject({ token: 'vercel_blob_rw_x_y', allowOverwrite: true });
    expect(calls[0].opts).not.toHaveProperty('storeId');
  });
});
