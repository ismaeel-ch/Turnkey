/**
 * POST /api/share against the daily share quota, on a stand-in Blob store at the network boundary: a refused save is a
 * plain 429, and a save that wrote nothing (Blob down, a wrong token) gives its place in the day's allowance back.
 */
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/share/route';
import { createShareQuota } from '@/server/share/quota';
import { fakeBlobToken, startFakeBlob, type FakeBlob } from './helpers/blob-fake';
import { setEnv } from './helpers/fakes';

const codeOf = (name: string) =>
  '1.' +
  deflateRawSync(Buffer.from(JSON.stringify({ f: 'formwork-app', v: 1, name, research: {}, database: { tables: [] } }))).toString(
    'base64url',
  );

let n = 0;
/** A fresh visitor for each test: the route's counters live for the whole file. */
const visitor = () => `198.51.100.${++n}`;
const save = (body: Record<string, unknown>, ip: string) =>
  POST(
    new Request('http://localhost/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  );

let blob: FakeBlob;
let restore: () => void = () => {};
beforeEach(() => {
  blob = startFakeBlob();
  restore = setEnv({
    BLOB_READ_WRITE_TOKEN: fakeBlobToken(),
    SHARE_STORE_DIR: undefined,
    VERCEL_BLOB_RETRIES: '0',
    VERCEL_BLOB_API_URL: undefined,
    SHARE_SAVES_PER_DAY: '2',
    SHARE_SAVES_PER_MINUTE: '1000',
  });
});
afterEach(async () => {
  restore();
  await blob.close();
});

describe('POST /api/share and the daily quota', () => {
  it('answers 429 rate_limited once a visitor has used their saves for the day, and others still save', async () => {
    const me = visitor();
    expect((await save({ code: codeOf('Quota Desk A'), name: 'Quota Desk A' }, me)).status).toBe(201);
    expect((await save({ code: codeOf('Quota Desk B'), name: 'Quota Desk B' }, me)).status).toBe(201);
    const third = await save({ code: codeOf('Quota Desk C'), name: 'Quota Desk C' }, me);
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: 'rate_limited', message: expect.stringContaining('long link works') });
    expect(third.headers.get('x-request-id')).toBeTruthy();
    expect((await save({ code: codeOf('Quota Desk D'), name: 'Quota Desk D' }, visitor())).status).toBe(201);
  });

  it('does not count a save that failed because Blob was down', async () => {
    const me = visitor();
    for (let i = 0; i < 3; i++) {
      blob.failNext('put', 503);
      expect((await save({ code: codeOf('Outage Desk'), name: 'Outage Desk' }, me)).status).toBe(503);
    }
    // three failures, and both of the day's saves are still there
    expect((await save({ code: codeOf('Outage Desk'), name: 'Outage Desk' }, me)).status).toBe(201);
    expect((await save({ code: codeOf('Outage Desk Two'), name: 'Outage Desk Two' }, me)).status).toBe(201);
    expect((await save({ code: codeOf('Outage Desk Three'), name: 'Outage Desk Three' }, me)).status).toBe(429);
  });

  it('does not count an update refused for a wrong token', async () => {
    const me = visitor();
    const first = (await (await save({ code: codeOf('Token Desk'), name: 'Token Desk' }, me)).json()) as { slug: string };
    for (let i = 0; i < 3; i++)
      expect((await save({ code: codeOf('Token Desk'), name: 'Token Desk', slug: first.slug, token: 'wrong' }, me)).status).toBe(403);
    expect((await save({ code: codeOf('Token Desk Two'), name: 'Token Desk Two' }, me)).status).toBe(201);
  });
});

describe('createShareQuota().refund', () => {
  const L = { saves: 2, perVisitor: 1, bytes: 100 };

  it('gives back the save, its bytes and the visitor’s place', () => {
    const q = createShareQuota(() => Date.parse('2026-11-27T10:00:00Z'));
    expect(q.take('a', 60, L).ok).toBe(true);
    expect(q.take('b', 60, L).ok).toBe(false); // over the bytes
    q.refund('a', 60);
    expect(q.take('b', 60, L).ok).toBe(true);
    expect(q.take('a', 30, L).ok).toBe(true);
    expect(q.take('c', 1, L).ok).toBe(false); // two saves today
  });

  it('cannot be used to go below zero or to refund for someone who saved nothing', () => {
    const q = createShareQuota(() => Date.parse('2026-11-27T10:00:00Z'));
    q.refund('a', 1000);
    q.refund('a', 1000);
    expect(q.take('a', 10, L).ok).toBe(true);
    q.refund('nobody', 10);
    expect(q.take('a', 10, L).ok).toBe(false); // still one per visitor
  });

  it('a refund after midnight does not touch the new day', () => {
    let t = Date.parse('2026-11-27T23:59:00Z');
    const q = createShareQuota(() => t);
    expect(q.take('a', 10, L).ok).toBe(true);
    t += 120_000;
    expect(q.take('b', 10, L).ok).toBe(true);
    q.refund('a', 10); // yesterday's save: 'a' has none today, so nothing changes
    expect(q.take('c', 10, L).ok).toBe(true);
    expect(q.take('d', 10, L).ok).toBe(false);
  });
});
