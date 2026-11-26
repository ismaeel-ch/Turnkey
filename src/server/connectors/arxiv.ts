/**
 * arXiv: preprints in physics, maths, computing and more, from the public Atom feed.
 * The feed is XML. A small reader pulls out the few fields needed, and zod checks each entry before use.
 */
import { z } from 'zod';
import type { Connector, ConnectorItem, ConnectorOptions, ConnectorResult } from './types';
import { cached, cleanQuery, clampLimit, fail, requestText, trimText } from './shared';

const MAX_ITEMS = 5;
const FEED_URL = 'https://export.arxiv.org/api/query';

const entrySchema = z.object({
  id: z.string().url(),
  title: z.string().min(1),
  summary: z.string(),
  published: z.string(),
  authors: z.array(z.string()),
});

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const tagText = (block: string, tag: string): string => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
};

/** Reads each <entry> of an Atom feed into the fields this connector uses. Exported for the tests. */
export function parseArxivFeed(xml: string): { ok: true; entries: unknown[] } | { ok: false } {
  if (!/<feed[\s>]/.test(xml)) return { ok: false };
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const block = m[1];
    const authors = [...block.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((a) => tagText(a[1], 'name')).filter(Boolean);
    return {
      id: tagText(block, 'id'),
      title: tagText(block, 'title'),
      summary: tagText(block, 'summary'),
      published: tagText(block, 'published'),
      authors,
    };
  });
  return { ok: true, entries };
}

async function search(query: string, options: ConnectorOptions = {}): Promise<ConnectorResult> {
  const q = cleanQuery(query);
  if (!q.ok) return q;
  const limit = clampLimit(options.limit, MAX_ITEMS);
  const doFetch = options.fetch ?? fetch;

  return cached(`arxiv|${q.value}|${limit}`, async () => {
    const url = `${FEED_URL}?search_query=all:${encodeURIComponent(q.value)}&start=0&max_results=${limit}&sortBy=relevance`;
    const res = await requestText(doFetch, url, { headers: { accept: 'application/atom+xml' } });
    if (!res.ok) return res;

    const feed = parseArxivFeed(res.text);
    if (!feed.ok) return fail('bad_response', 'arXiv answered in an unexpected shape.');

    const items: ConnectorItem[] = [];
    for (const raw of feed.entries) {
      // arXiv reports its own errors as an entry whose id points at the API's error page.
      if (typeof raw === 'object' && raw && 'id' in raw && String((raw as { id: string }).id).includes('/api/errors')) {
        return fail('upstream', 'arXiv refused the search.');
      }
      const parsed = entrySchema.safeParse(raw);
      if (!parsed.success) continue;
      const e = parsed.data;
      const year = e.published.slice(0, 4);
      const who = e.authors.slice(0, 3).join(', ');
      items.push({
        title: e.title,
        url: e.id,
        text: trimText([who && `${who}${year ? ` (${year})` : ''}`, e.summary].filter(Boolean).join('. '), 400, false),
        source: 'arXiv',
      });
    }
    if (items.length === 0) return fail('not_found', `arXiv has no preprints for "${q.value}".`);
    return { ok: true, items };
  });
}

export const arxiv: Connector = {
  id: 'arxiv',
  label: 'arXiv',
  describe: {
    name: 'search_preprints',
    purpose: 'Find recent research preprints in physics, mathematics, computer science and related fields.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'The topic or title words to search for.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS, description: 'How many preprints to return.' },
      },
      required: ['query'],
    },
  },
  search,
};
