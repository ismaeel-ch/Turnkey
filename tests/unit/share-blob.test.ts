/**
 * Short links on Vercel: the Blob store and the share routes, with the real @vercel/blob client talking to a fake
 * Blob service (helpers/blob-fake.ts) instead of the network.
 */
import { deflateRawSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ShareRecord } from '@/server/share/records';
import { readShare, saveShare } from '@/server/share/service';
import { blobStore, resolveShareStore, type ShareStore } from '@/server/share/store';
import { fakeBlobToken, startFakeBlob, type FakeBlob } from './helpers/blob-fake';
import { setEnv } from './helpers/fakes';

const pack = (name = 'Clinic Desk') => ({ f: 'formwork-app', v: 1, name, research: {}, database: { tables: [] } });
const codeOf = (p: unknown) => '1.' + deflateRawSync(Buffer.from(JSON.stringify(p))).toString('base64url');
const CODE = codeOf(pack());

const record = (slug: string, extra: Partial<ShareRecord> = {}): ShareRecord => ({
  v: 1,
  slug,
  name: 'Clinic Desk',
  code: CODE,
  tokenHash: 'a'.repeat(64),
  created: '2026-11-26T00:00:00.000Z',
  updated: '2026-11-26T00:00:00.000Z',
  ...extra,
});

let blob: FakeBlob;
let restoreEnv: () => void = () => {};
beforeEach(() => {
  blob = startFakeBlob();
  // a failed request is retried up to ten times, a second apart, by default; the retry test turns one back on
  restoreEnv = setEnv({ VERCEL_BLOB_RETRIES: '0', VERCEL_BLOB_API_URL: undefined });
});
afterEach(async () => {
  restoreEnv();
  await blob.close();
});

describe('blobStore', () => {
  it('writes a private JSON file under share/ and reads it back without the cache', async () => {
    const store = blobStore(fakeBlobToken());
    expect(store.kind).toBe('blob');
    expect(await store.write(record('clinic-desk'), { create: true })).toBe(true);
    expect(JSON.parse(blob.files.get('share/clinic-desk.json')!)).toMatchObject({ slug: 'clinic-desk', code: CODE });

    const put = blob.requests.find((r) => r.method === 'PUT')!;
    expect(put.path).toBe('/api/blob/?pathname=share%2Fclinic-desk.json');
    expect(put.headers['x-vercel-blob-access']).toBe('private');
    expect(put.headers['x-add-random-suffix']).toBe('0');
    expect(put.headers['x-allow-overwrite']).toBe('0');
    expect(put.headers['x-content-type']).toBe('application/json');

    expect(await store.read('clinic-desk')).toEqual(record('clinic-desk'));
    const get = blob.requests.find((r) => r.method === 'GET')!;
    expect(get.path).toBe('/share/clinic-desk.json?cache=0');
  });

  it('refuses a taken name on create, and overwrites it on update', async () => {
    const store = blobStore(fakeBlobToken());
    await store.write(record('bid-desk'), { create: true });
    expect(await store.write(record('bid-desk', { name: 'Other' }), { create: true })).toBe(false);
    expect((await store.read('bid-desk'))?.name).toBe('Clinic Desk');

    expect(await store.write(record('bid-desk', { name: 'Bid Desk v2' }), { create: false })).toBe(true);
    expect(blob.requests.filter((r) => r.method === 'PUT').at(-1)?.headers['x-allow-overwrite']).toBe('1');
    expect((await store.read('bid-desk'))?.name).toBe('Bid Desk v2');
  });

  it('reads nothing for a missing file, broken JSON or a record of the wrong shape', async () => {
    const store = blobStore(fakeBlobToken());
    expect(await store.read('nothing-here')).toBeNull();
    blob.files.set('share/broken.json', '{not json');
    expect(await store.read('broken')).toBeNull();
    blob.files.set('share/wrong.json', JSON.stringify({ hello: 'world' }));
    expect(await store.read('wrong')).toBeNull();
  });

  it('passes on failures other than a taken name', async () => {
    const store = blobStore(fakeBlobToken());
    // a refused token is not retried and is not mistaken for a taken name
    const wrong = blobStore(['vercel', 'blob', 'rw', 'faketurnkeystore', 'wrongsecret'].join('_'));
    await expect(wrong.write(record('locked'), { create: true })).rejects.toThrow();
    blob.failNext('put', 503);
    await expect(store.write(record('down'), { create: false })).rejects.toThrow();
    blob.failNext('get', 500);
    await expect(store.read('down')).rejects.toThrow();
  });

  it('retries a short outage and then succeeds', async () => {
    process.env.VERCEL_BLOB_RETRIES = '1';
    const store = blobStore(fakeBlobToken());
    blob.failNext('put', 503);
    expect(await store.write(record('flaky-desk'), { create: true })).toBe(true);
    const puts = blob.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.headers['x-api-blob-request-attempt'])).toEqual(['0', '1']);
  });
});

describe('saveShare on the Blob store', () => {
  it('picks the next free name, keeps only the token hash, and updates with the token', async () => {
    const store = blobStore(fakeBlobToken());
    const a = await saveShare(store, { code: CODE, name: 'Clinic Desk' });
    const b = await saveShare(store, { code: CODE, name: 'Clinic Desk' });
    expect(a).toMatchObject({ ok: true, slug: 'clinic-desk', created: true });
    expect(b).toMatchObject({ ok: true, slug: 'clinic-desk-2', created: true });
    if (!a.ok || !a.token) throw new Error('save failed');
    expect(blob.files.get('share/clinic-desk.json')).not.toContain(a.token);

    const v2 = codeOf(pack('Clinic Desk 2'));
    expect(await saveShare(store, { code: v2, name: 'Clinic Desk', slug: 'clinic-desk', token: 'wrong' })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await saveShare(store, { code: v2, name: 'Clinic Desk', slug: 'clinic-desk', token: a.token })).toMatchObject({
      ok: true,
      slug: 'clinic-desk',
      created: false,
    });
    expect((await readShare(store, 'clinic-desk'))?.code).toBe(v2);
  });

  it('makes a new name when the old record is gone', async () => {
    const store = blobStore(fakeBlobToken());
    const r = await saveShare(store, { code: CODE, name: 'Lost Desk', slug: 'lost-desk-old', token: 'any' });
    expect(r).toMatchObject({ ok: true, slug: 'lost-desk', created: true });
  });

  it('refuses a bad slug without touching the store', async () => {
    const store = blobStore(fakeBlobToken());
    expect(await saveShare(store, { code: CODE, name: 'x', slug: '../up', token: 't' })).toMatchObject({ ok: false, status: 400 });
    expect(blob.requests).toHaveLength(0);
  });

  it('gives up with 409 when every candidate name is taken', async () => {
    const full: ShareStore = { kind: 'blob', read: async () => null, write: async () => false };
    expect(await saveShare(full, { code: CODE, name: 'Full Desk' })).toMatchObject({ ok: false, status: 409 });
  });
});

describe('the share routes on the Blob store', () => {
  const post = (body: unknown, ip = '203.0.113.7') =>
    new Request('http://localhost/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });
  const read = async (slug: string, ip = '203.0.113.7') => {
    const { GET } = await import('@/app/api/share/[slug]/route');
    return GET(new Request('http://localhost/api/share/' + slug, { headers: { 'x-forwarded-for': ip } }), {
      params: Promise.resolve({ slug }),
    });
  };
  let restore: () => void = () => {};
  beforeAll(() => {
    restore = setEnv({ BLOB_READ_WRITE_TOKEN: fakeBlobToken(), SHARE_STORE_DIR: undefined });
  });
  afterAll(() => restore());

  it('prefer Blob over a folder when both are set', () => {
    expect(resolveShareStore({ BLOB_READ_WRITE_TOKEN: fakeBlobToken(), SHARE_STORE_DIR: '/tmp/x' })?.kind).toBe('blob');
  });

  it('report that short links are on', async () => {
    const { GET } = await import('@/app/api/share/route');
    const res = await GET(new Request('http://localhost/api/share'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ enabled: true });
  });

  it('save (201 with a token), update (200 without one), and read back', async () => {
    const { POST } = await import('@/app/api/share/route');
    const res = await POST(post({ code: CODE, name: 'Blob Route Desk' }));
    expect(res.status).toBe(201);
    const saved = (await res.json()) as { slug: string; path: string; token: string };
    expect(saved).toMatchObject({ slug: 'blob-route-desk', path: '/blob-route-desk' });
    expect(saved.token).toEqual(expect.any(String));

    const v2 = codeOf(pack('Blob Route Desk v2'));
    const again = await POST(post({ code: v2, name: 'Blob Route Desk', slug: saved.slug, token: saved.token }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ slug: 'blob-route-desk', path: '/blob-route-desk' });

    const got = await read('blob-route-desk');
    expect(got.status).toBe(200);
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    const body = (await got.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ slug: 'blob-route-desk', name: 'Blob Route Desk', code: v2 });
    // the stored token hash never leaves the server
    expect(body).not.toHaveProperty('tokenHash');
  });

  it('answer 403 to a wrong token and 404 to an unknown name', async () => {
    const { POST } = await import('@/app/api/share/route');
    const first = (await (await POST(post({ code: CODE, name: 'Guarded Desk' }))).json()) as { slug: string };
    const res = await POST(post({ code: CODE, name: 'Guarded Desk', slug: first.slug, token: 'not-the-token' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'bad_request' });
    expect((await read('never-saved')).status).toBe(404);
  });

  it('fall back to the long link with 503 when Blob is down', async () => {
    const { POST } = await import('@/app/api/share/route');
    blob.failNext('put', 503);
    const res = await POST(post({ code: CODE, name: 'Outage Desk' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not_configured' });

    blob.failNext('get', 500);
    const got = await read('outage-desk');
    expect(got.status).toBe(503);
  });

  it('refuse a body that is not JSON', async () => {
    const { POST } = await import('@/app/api/share/route');
    const res = await POST(
      new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
        body: '{oops',
      }),
    );
    expect(res.status).toBe(400);
    expect(blob.requests).toHaveLength(0);
  });
});
