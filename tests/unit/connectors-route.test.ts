/**
 * The route is called directly with a Request. Only inputs that never reach the network are used here: an unknown
 * name, an empty query, and PatentsView without its key. No network is used.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/connectors/[name]/route';

const call = (name: string, search = '') =>
  GET(new Request(`http://localhost/api/connectors/${name}${search}`, { headers: { cookie: 'session=secret' } }), {
    params: Promise.resolve({ name }),
  });

const savedKey = process.env.PATENTSVIEW_API_KEY;
afterEach(() => {
  if (savedKey === undefined) delete process.env.PATENTSVIEW_API_KEY;
  else process.env.PATENTSVIEW_API_KEY = savedKey;
});

describe('GET /api/connectors/[name]', () => {
  it('answers 404 for a connector that does not exist', async () => {
    const res = await call('nope', '?q=x');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('answers 400 for an empty query without calling any source', async () => {
    const res = await call('wikipedia', '?q=');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: 'bad_request' });
  });

  it('answers 503 not_configured for PatentsView without its key', async () => {
    delete process.env.PATENTSVIEW_API_KEY;
    const res = await call('patentsview', '?q=sensor');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: 'not_configured' });
  });

  it('never sends a response that is not JSON, and marks it uncacheable', async () => {
    const res = await call('nope', '?q=x');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
