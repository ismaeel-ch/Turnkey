/**
 * PatentsView: US patents, searched by title or abstract. Needs a free key in PATENTSVIEW_API_KEY.
 * Without the key the connector answers `not_configured` and nothing is sent.
 */
import { z } from 'zod';
import type { Connector, ConnectorItem, ConnectorOptions, ConnectorResult } from './types';
import { cached, cleanQuery, clampLimit, fail, requestJson, trimText } from './shared';

const MAX_ITEMS = 5;
const ENDPOINT = 'https://search.patentsview.org/api/v1/patent/';

const patentsBody = z.object({
  error: z.boolean().optional(),
  patents: z
    .array(
      z.object({
        patent_id: z.string(),
        patent_title: z.string().nullish(),
        patent_abstract: z.string().nullish(),
        patent_date: z.string().nullish(),
      }),
    )
    .nullish(),
});

async function search(query: string, options: ConnectorOptions = {}): Promise<ConnectorResult> {
  const key = (process.env.PATENTSVIEW_API_KEY ?? '').trim();
  if (!key) {
    return fail('not_configured', 'PatentsView is not set up on this deployment: its API key is missing.');
  }
  const q = cleanQuery(query);
  if (!q.ok) return q;
  const limit = clampLimit(options.limit, MAX_ITEMS);
  const doFetch = options.fetch ?? fetch;

  return cached(`patentsview|${q.value}|${limit}`, async () => {
    const res = await requestJson(doFetch, ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': key },
      body: {
        q: { _text_any: { patent_title: q.value, patent_abstract: q.value } },
        f: ['patent_id', 'patent_title', 'patent_abstract', 'patent_date'],
        o: { size: limit },
      },
    });
    if (!res.ok) return res;
    const parsed = patentsBody.safeParse(res.body);
    if (!parsed.success || parsed.data.error === true) {
      return fail('bad_response', 'PatentsView answered in an unexpected shape.');
    }
    const patents = parsed.data.patents ?? [];
    if (patents.length === 0) return fail('not_found', `PatentsView has no US patents for "${q.value}".`);

    const items: ConnectorItem[] = patents.slice(0, limit).map((p) => ({
      title: p.patent_title || `US patent ${p.patent_id}`,
      url: `https://patents.google.com/patent/US${encodeURIComponent(p.patent_id)}`,
      text: trimText(
        [p.patent_date && `Granted ${p.patent_date}.`, p.patent_abstract].filter(Boolean).join(' ') || 'No abstract available.',
      ),
      source: 'PatentsView',
    }));
    return { ok: true, items };
  });
}

export const patentsView: Connector = {
  id: 'patentsview',
  label: 'PatentsView',
  describe: {
    name: 'search_us_patents',
    purpose: 'Find granted US patents on a technology, with title, grant date and abstract.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'The technology or invention words to search for.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS, description: 'How many patents to return.' },
      },
      required: ['query'],
    },
  },
  search,
};
