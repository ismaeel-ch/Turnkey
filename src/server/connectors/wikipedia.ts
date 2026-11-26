/** Wikipedia: search the English encyclopedia, then read each hit's short page summary. */
import { z } from 'zod';
import type { Connector, ConnectorItem, ConnectorOptions, ConnectorResult } from './types';
import { cached, cleanQuery, clampLimit, fail, requestJson, trimText } from './shared';

const SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const MAX_ITEMS = 3;

const searchBody = z.object({
  query: z.object({
    search: z.array(z.object({ title: z.string().min(1), snippet: z.string().optional() })),
  }),
});

const summaryBody = z.object({
  title: z.string().optional(),
  extract: z.string().optional(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }).optional(),
});

const pageUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

async function search(query: string, options: ConnectorOptions = {}): Promise<ConnectorResult> {
  const q = cleanQuery(query);
  if (!q.ok) return q;
  const limit = clampLimit(options.limit, MAX_ITEMS);
  const doFetch = options.fetch ?? fetch;

  return cached(`wikipedia|${q.value}|${limit}`, async () => {
    const url =
      `${SEARCH_URL}?action=query&list=search&format=json&formatversion=2&srlimit=${limit}` + `&srsearch=${encodeURIComponent(q.value)}`;
    const found = await requestJson(doFetch, url);
    if (!found.ok) return found;
    const parsed = searchBody.safeParse(found.body);
    if (!parsed.success) return fail('bad_response', 'Wikipedia search answered in an unexpected shape.');
    const hits = parsed.data.query.search.slice(0, limit);
    if (hits.length === 0) return fail('not_found', `Wikipedia has no article for "${q.value}".`);

    const items: ConnectorItem[] = await Promise.all(
      hits.map(async (hit): Promise<ConnectorItem> => {
        const summary = await requestJson(doFetch, SUMMARY_URL + encodeURIComponent(hit.title.replace(/ /g, '_')));
        const body = summary.ok ? summaryBody.safeParse(summary.body) : null;
        const extract = body?.success ? body.data.extract : undefined;
        return {
          title: hit.title,
          url: body?.success && body.data.content_urls ? body.data.content_urls.desktop.page : pageUrl(hit.title),
          // If the summary is missing, fall back to the search snippet, which is already short.
          text: trimText(extract || hit.snippet || 'No summary available.'),
          source: 'Wikipedia',
        };
      }),
    );
    return { ok: true, items };
  });
}

export const wikipedia: Connector = {
  id: 'wikipedia',
  label: 'Wikipedia',
  describe: {
    name: 'search_wikipedia',
    purpose: 'Look up what an encyclopedia article says about a person, place, organisation or concept.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'What to look up, in plain words.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS, description: 'How many articles to return.' },
      },
      required: ['query'],
    },
  },
  search,
};
