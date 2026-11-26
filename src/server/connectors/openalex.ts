/** OpenAlex: scholarly works (papers, books, datasets) matching a search. */
import { z } from 'zod';
import type { Connector, ConnectorItem, ConnectorOptions, ConnectorResult } from './types';
import { cached, cleanQuery, clampLimit, fail, requestJson, trimText } from './shared';

const MAX_ITEMS = 5;

const worksBody = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      doi: z.string().nullish(),
      title: z.string().nullish(),
      display_name: z.string().nullish(),
      publication_year: z.number().nullish(),
      cited_by_count: z.number().nullish(),
      authorships: z.array(z.object({ author: z.object({ display_name: z.string().nullish() }) })).nullish(),
      primary_location: z.object({ landing_page_url: z.string().nullish() }).nullish(),
      abstract_inverted_index: z.record(z.string(), z.array(z.number())).nullish(),
    }),
  ),
});

/** OpenAlex sends abstracts as word → positions. Rebuild the sentence in order. */
export function abstractFromIndex(index: Record<string, number[]> | null | undefined): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter((w) => w !== undefined).join(' ');
}

async function search(query: string, options: ConnectorOptions = {}): Promise<ConnectorResult> {
  const q = cleanQuery(query);
  if (!q.ok) return q;
  const limit = clampLimit(options.limit, MAX_ITEMS);
  const doFetch = options.fetch ?? fetch;

  return cached(`openalex|${q.value}|${limit}`, async () => {
    const fields = 'id,doi,title,display_name,publication_year,cited_by_count,authorships,primary_location,abstract_inverted_index';
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(q.value)}&per_page=${limit}&select=${fields}`;
    const res = await requestJson(doFetch, url);
    if (!res.ok) return res;
    const parsed = worksBody.safeParse(res.body);
    if (!parsed.success) return fail('bad_response', 'OpenAlex answered in an unexpected shape.');
    if (parsed.data.results.length === 0) return fail('not_found', `OpenAlex has no works for "${q.value}".`);

    const items: ConnectorItem[] = parsed.data.results.slice(0, limit).map((w) => {
      const authors = (w.authorships ?? [])
        .map((a) => a.author.display_name)
        .filter(Boolean)
        .slice(0, 3);
      const facts = [
        authors.length ? authors.join(', ') : null,
        w.publication_year ? String(w.publication_year) : null,
        typeof w.cited_by_count === 'number' ? `cited ${w.cited_by_count} times` : null,
      ].filter(Boolean);
      const abstract = abstractFromIndex(w.abstract_inverted_index);
      const body = [facts.join(' · '), abstract].filter(Boolean).join('. ');
      return {
        title: w.title || w.display_name || 'Untitled work',
        url: w.doi || w.primary_location?.landing_page_url || w.id,
        text: trimText(body || 'No abstract available.'),
        source: 'OpenAlex',
      };
    });
    return { ok: true, items };
  });
}

export const openAlex: Connector = {
  id: 'openalex',
  label: 'OpenAlex',
  describe: {
    name: 'search_scholarly_works',
    purpose: 'Find academic papers, books and datasets on a topic, with authors, year, citations and abstract.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'The topic or title words to search for.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS, description: 'How many works to return.' },
      },
      required: ['query'],
    },
  },
  search,
};
