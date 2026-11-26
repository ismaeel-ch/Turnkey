import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkCode, hashToken, isSlug, slugCandidates, slugify, tokenMatches } from '@/server/share/records';
import { readShare, saveShare } from '@/server/share/service';
import { folderStore, resolveShareStore } from '@/server/share/store';
import { loadShortLink, saveShortLink, slugFromPath } from '@/platform/share-link';

const pack = (name = 'Clinic Desk') => ({ f: 'formwork-app', v: 1, name, research: {}, database: { tables: [] } });
const codeOf = (p: unknown) => '1.' + deflateRawSync(Buffer.from(JSON.stringify(p))).toString('base64url');
const CODE = codeOf(pack());

describe('short names', () => {
  it('come from the app name', () => {
    expect(slugify('Clinic Desk')).toBe('clinic-desk');
    expect(slugify('  Café   Orders!! ')).toBe('cafe-orders');
    expect(slugify('A')).toBe('a-app');
    expect(slugify('')).toBe('my-app');
    expect(slugify('API')).toBe('api-app');
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(35);
  });
  it('are tried plain, then numbered, then with a random ending', () => {
    expect(slugCandidates('Clinic Desk', () => 'ab12')).toEqual([
      'clinic-desk',
      'clinic-desk-2',
      'clinic-desk-3',
      'clinic-desk-4',
      'clinic-desk-5',
      'clinic-desk-ab12',
      'clinic-desk-ab12',
    ]);
    for (const s of slugCandidates('Any name at all')) expect(isSlug(s)).toBe(true);
  });
  it('refuse what the site uses or what is not a name', () => {
    expect(isSlug('api')).toBe(false);
    expect(isSlug('spike')).toBe(false);
    expect(isSlug('Clinic')).toBe(false);
    expect(isSlug('-abc')).toBe(false);
    expect(isSlug('a.b')).toBe(false);
    expect(isSlug('clinic-desk')).toBe(true);
  });
});

describe('checkCode', () => {
  it('takes what the workspace makes', () => {
    expect(checkCode(CODE).ok).toBe(true);
    expect(checkCode('0.' + Buffer.from(JSON.stringify(pack())).toString('base64url')).ok).toBe(true);
  });
  it('refuses anything else', () => {
    expect(checkCode('javascript:alert(1)').ok).toBe(false);
    expect(checkCode('1.AAAA').ok).toBe(false);
    expect(checkCode(codeOf({ hello: 'world' })).ok).toBe(false);
    expect(checkCode('1.' + 'A'.repeat(900_001)).ok).toBe(false);
  });
  it('refuses a code that unpacks to more than an app can hold', () => {
    const bomb = '1.' + deflateRawSync(Buffer.alloc(6_000_000, 32)).toString('base64url');
    expect(checkCode(bomb).ok).toBe(false);
  });
});

describe('tokens', () => {
  it('match only their own hash', () => {
    const h = hashToken('secret-1');
    expect(tokenMatches('secret-1', h)).toBe(true);
    expect(tokenMatches('secret-2', h)).toBe(false);
    expect(tokenMatches('secret-1', 'not-a-hash')).toBe(false);
  });
});

describe('saveShare and readShare', () => {
  let dir = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-share-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saves under the app name, then the next free name', async () => {
    const store = folderStore(dir);
    const a = await saveShare(store, { code: CODE, name: 'Clinic Desk' });
    const b = await saveShare(store, { code: CODE, name: 'Clinic Desk' });
    expect(a).toMatchObject({ ok: true, slug: 'clinic-desk', created: true });
    expect(b).toMatchObject({ ok: true, slug: 'clinic-desk-2', created: true });
    expect(a.ok && a.token).toBeTruthy();
    // the token itself is never stored
    expect(fs.readFileSync(path.join(dir, 'clinic-desk.json'), 'utf8')).not.toContain(a.ok ? a.token! : 'x');
  });

  it('puts a newer version under the same name only with the token', async () => {
    const store = folderStore(dir);
    const first = await saveShare(store, { code: CODE, name: 'Bid Desk' });
    if (!first.ok) throw new Error('save failed');
    const v2 = codeOf(pack('Bid Desk 2'));
    expect(await saveShare(store, { code: v2, name: 'Bid Desk', slug: 'bid-desk', token: 'wrong' })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await saveShare(store, { code: v2, name: 'Bid Desk', slug: 'bid-desk', token: first.token })).toMatchObject({
      ok: true,
      slug: 'bid-desk',
      created: false,
    });
    expect((await readShare(store, 'bid-desk'))?.code).toBe(v2);
  });

  it('refuses a bad code and reads nothing for an unknown or bad name', async () => {
    const store = folderStore(dir);
    expect(await saveShare(store, { code: '1.AAAA', name: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(await readShare(store, 'nothing-here')).toBeNull();
    expect(await readShare(store, '../etc/passwd')).toBeNull();
  });
});

describe('resolveShareStore', () => {
  it('is off without settings, and never throws', () => {
    expect(resolveShareStore({})).toBeNull();
    expect(resolveShareStore({ SHARE_STORE_DIR: '/tmp/x' })?.kind).toBe('folder');
    expect(resolveShareStore({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x_y' })?.kind).toBe('blob');
    // the way Vercel connects a store now: a store id, signed in with the deployment's OIDC token
    expect(resolveShareStore({ BLOB_STORE_ID: 'store_abc123' })?.kind).toBe('blob');
  });
});

describe('the routes', () => {
  let dir = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-share-route-'));
  });
  afterAll(() => {
    delete process.env.SHARE_STORE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = (body: unknown) =>
    new Request('http://localhost/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('say plainly when short links are off', async () => {
    delete process.env.SHARE_STORE_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    const { POST, GET } = await import('@/app/api/share/route');
    expect((await POST(post({ code: CODE, name: 'x' }))).status).toBe(503);
    expect(await (await GET(new Request('http://localhost/api/share'))).json()).toEqual({ enabled: false });
  });

  it('save and read back an app', async () => {
    process.env.SHARE_STORE_DIR = dir;
    const { POST } = await import('@/app/api/share/route');
    const { GET } = await import('@/app/api/share/[slug]/route');
    const res = await POST(post({ code: CODE, name: 'Route Desk' }));
    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved).toMatchObject({ slug: 'route-desk', path: '/route-desk' });
    const got = await GET(new Request('http://localhost/api/share/route-desk'), { params: Promise.resolve({ slug: 'route-desk' }) });
    expect(await got.json()).toMatchObject({ slug: 'route-desk', name: 'Route Desk', code: CODE });
    const none = await GET(new Request('http://localhost/api/share/nope-nope'), { params: Promise.resolve({ slug: 'nope-nope' }) });
    expect(none.status).toBe(404);
    expect((await POST(post({ code: 'not a code', name: 'x' }))).status).toBe(400);
  });
});

describe('browser helpers', () => {
  const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('read the short name from an address', () => {
    expect(slugFromPath('/clinic-desk')).toBe('clinic-desk');
    expect(slugFromPath('/clinic-desk/')).toBe('clinic-desk');
    expect(slugFromPath('/')).toBeNull();
    expect(slugFromPath('/a/manifest')).toBeNull();
    expect(slugFromPath('/Clinic')).toBeNull();
  });
  it('save: a result, or the reason to fall back to the long link', async () => {
    expect(await saveShortLink({ code: CODE, name: 'x' }, answer(201, { slug: 'x-app', path: '/x-app', token: 't' }))).toEqual({
      ok: true,
      slug: 'x-app',
      path: '/x-app',
      token: 't',
    });
    expect((await saveShortLink({ code: CODE, name: 'x' }, answer(503, { message: 'off' }))).ok).toBe(false);
    expect(await saveShortLink({ code: CODE, name: 'x' }, answer(403, {}))).toMatchObject({ reason: 'forbidden' });
    expect(await saveShortLink({ code: CODE, name: 'x' }, answer(201, { slug: '<b>' }))).toMatchObject({ ok: false });
    const down = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await saveShortLink({ code: CODE, name: 'x' }, down)).toMatchObject({ ok: false, reason: 'failed' });
  });
  it('load: the code, or why not', async () => {
    expect(await loadShortLink('clinic-desk', answer(200, { name: 'Clinic', code: CODE }))).toMatchObject({ ok: true, code: CODE });
    expect(await loadShortLink('clinic-desk', answer(404, {}))).toMatchObject({ reason: 'missing' });
    expect(await loadShortLink('clinic-desk', answer(200, { code: 'javascript:x' }))).toMatchObject({ ok: false });
    expect(await loadShortLink('../x', answer(200, {}))).toMatchObject({ reason: 'missing' });
    const down = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await loadShortLink('clinic-desk', down)).toMatchObject({ reason: 'offline' });
  });
});
