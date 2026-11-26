/**
 * A stand-in for the Vercel Blob service, at the network boundary. @vercel/blob sends its requests through undici, so
 * an undici MockAgent installed as the global dispatcher answers them here: nothing leaves the machine, and the real
 * @vercel/blob code (headers, retries, error mapping) runs unchanged.
 *
 *   PUT  https://vercel.com/api/blob/?pathname=…           saves a file (x-allow-overwrite: 0 refuses a taken name)
 *   GET  https://<store>.private.blob.vercel-storage.com/…  reads one back (404 when there is none)
 */
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from 'undici';

/** The store id inside a read-write token: vercel_blob_rw_<store>_<secret>. Built from pieces for the secrets scan. */
export const FAKE_STORE = 'faketurnkeystore';
export const fakeBlobToken = () => ['vercel', 'blob', 'rw', FAKE_STORE, 'notarealsecret'].join('_');

export interface BlobRequestLog {
  method: string;
  path: string;
  headers: Record<string, string>;
}

export interface FakeBlob {
  /** What is stored, by pathname. Tests may read or change it directly. */
  files: Map<string, string>;
  requests: BlobRequestLog[];
  /** Makes the next n requests to the given side fail with this status (a 5xx is retried by @vercel/blob). */
  failNext(side: 'put' | 'get', status: number, n?: number): void;
  close(): Promise<void>;
}

const API = 'https://vercel.com';
const READS = `https://${FAKE_STORE}.private.blob.vercel-storage.com`;

const headerRecord = (h: Dispatcher.DispatchOptions['headers']): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (Array.isArray(h)) for (let i = 0; i + 1 < h.length; i += 2) out[String(h[i]).toLowerCase()] = String(h[i + 1]);
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
};

/** The request body. undici hands a mock the body's source as given to fetch: here the JSON string put() sends. */
const bodyText = (body: unknown): string => {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  throw new Error('The fake Blob service only takes string or byte bodies.');
};

export function startFakeBlob(): FakeBlob {
  const previous = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);

  const files = new Map<string, string>();
  const requests: BlobRequestLog[] = [];
  const failures = { put: [] as number[], get: [] as number[] };
  const failNext: FakeBlob['failNext'] = (side, status, n = 1) => {
    for (let i = 0; i < n; i++) failures[side].push(status);
  };
  const json = { headers: { 'content-type': 'application/json' } };

  agent
    .get(API)
    .intercept({ path: (p) => p.startsWith('/api/blob'), method: 'PUT' })
    .reply<Record<string, unknown>>((opts) => {
      const headers = headerRecord(opts.headers);
      const url = new URL(opts.path, API);
      requests.push({ method: 'PUT', path: url.pathname + url.search, headers });
      const failure = failures.put.shift();
      if (failure) return { statusCode: failure, data: { error: { code: 'service_unavailable', message: 'down' } }, responseOptions: json };
      if (headers.authorization !== 'Bearer ' + fakeBlobToken())
        return { statusCode: 403, data: { error: { code: 'forbidden', message: 'Forbidden' } }, responseOptions: json };
      const pathname = url.searchParams.get('pathname') ?? '';
      if (headers['x-allow-overwrite'] === '0' && files.has(pathname))
        return {
          statusCode: 400,
          data: {
            error: { code: 'bad_request', message: 'This blob already exists, use `allowOverwrite: true` if you want to overwrite it.' },
          },
          responseOptions: json,
        };
      files.set(pathname, bodyText(opts.body));
      return {
        statusCode: 200,
        data: {
          url: `${READS}/${pathname}`,
          downloadUrl: `${READS}/${pathname}?download=1`,
          pathname,
          contentType: headers['x-content-type'] ?? 'application/octet-stream',
          contentDisposition: 'inline',
          etag: '"1"',
        },
        responseOptions: json,
      };
    })
    .persist();

  agent
    .get(READS)
    .intercept({ path: () => true, method: 'GET' })
    .reply<Record<string, unknown>>((opts) => {
      const headers = headerRecord(opts.headers);
      const url = new URL(opts.path, READS);
      requests.push({ method: 'GET', path: url.pathname + url.search, headers });
      const failure = failures.get.shift();
      if (failure) return { statusCode: failure, data: 'down' };
      if (headers.authorization !== 'Bearer ' + fakeBlobToken()) return { statusCode: 403, data: 'Forbidden' };
      const text = files.get(decodeURIComponent(url.pathname.slice(1)));
      return text === undefined ? { statusCode: 404, data: 'Not found' } : { statusCode: 200, data: text, responseOptions: json };
    })
    .persist();

  return {
    files,
    requests,
    failNext,
    async close() {
      setGlobalDispatcher(previous);
      await agent.close();
    },
  };
}
