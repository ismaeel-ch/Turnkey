/** Test helpers for the connectors: a fake `fetch` that answers from fixtures. No network is ever used. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type Call = { url: string; init: RequestInit };

/** Reads one fixture file from tests/unit/fixtures/connectors. */
export function fixture<T = unknown>(name: string): T {
  const file = path.resolve(__dirname, 'fixtures/connectors', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** A fetch that answers with `respond(url)` and records every call it receives. */
export function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  }) as typeof fetch;
  return { doFetch, calls };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const xmlResponse = (text: string, status = 200) =>
  new Response(text, { status, headers: { 'content-type': 'application/atom+xml' } });
