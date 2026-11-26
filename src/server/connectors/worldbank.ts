/** World Bank: the latest values of one development indicator for one country. */
import { z } from 'zod';
import type { Connector, ConnectorItem, ConnectorOptions, ConnectorResult } from './types';
import { cached, cleanQuery, clampLimit, fail, requestJson, trimText } from './shared';

const MAX_ITEMS = 5;
// Indicator codes always have dots between their parts, for example NY.GDP.MKTP.CD or SP.POP.TOTL.
const QUERY_SHAPE = /^([A-Za-z]{2,3})\s+([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)$/;

// The API answers with a two element array: paging information, then the rows (null when there are none).
const rowsBody = z.tuple([z.unknown(), z.array(z.unknown()).nullable()]);
const row = z.object({
  date: z.string(),
  value: z.number().nullable(),
  indicator: z.object({ id: z.string(), value: z.string() }),
  country: z.object({ id: z.string(), value: z.string() }),
  unit: z.string().optional(),
});
const errorBody = z.array(z.object({ message: z.array(z.object({ id: z.string(), value: z.string() })) }));

async function search(query: string, options: ConnectorOptions = {}): Promise<ConnectorResult> {
  const q = cleanQuery(query);
  if (!q.ok) return q;
  const match = QUERY_SHAPE.exec(q.value);
  if (!match) {
    return fail('bad_request', 'Use a country code and an indicator code, for example "PAK NY.GDP.MKTP.CD".');
  }
  const country = match[1].toUpperCase();
  const indicator = match[2].toUpperCase();
  const limit = clampLimit(options.limit, MAX_ITEMS);
  const doFetch = options.fetch ?? fetch;

  return cached(`worldbank|${country}|${indicator}|${limit}`, async () => {
    const url =
      `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}` +
      `?format=json&per_page=${limit}`;
    const res = await requestJson(doFetch, url);
    if (!res.ok) return res;

    const errors = errorBody.safeParse(res.body);
    if (errors.success) {
      return fail('not_found', `The World Bank does not know the country or indicator "${country} ${indicator}".`);
    }
    const shaped = rowsBody.safeParse(res.body);
    if (!shaped.success) return fail('bad_response', 'The World Bank answered in an unexpected shape.');
    const rows = shaped.data[1] ?? [];

    const items: ConnectorItem[] = [];
    for (const raw of rows) {
      const parsed = row.safeParse(raw);
      if (!parsed.success || parsed.data.value === null) continue;
      const r = parsed.data;
      items.push({
        title: `${r.indicator.value}, ${r.country.value}, ${r.date}`,
        url: `https://data.worldbank.org/indicator/${r.indicator.id}?locations=${r.country.id}`,
        text: trimText(`${r.indicator.value} for ${r.country.value} in ${r.date}: ${r.value}${r.unit ? ` (${r.unit})` : ''}.`),
        source: 'World Bank',
      });
    }
    if (items.length === 0) {
      return fail('not_found', `The World Bank has no published values for ${country} ${indicator}.`);
    }
    return { ok: true, items };
  });
}

export const worldBank: Connector = {
  id: 'worldbank',
  label: 'World Bank',
  describe: {
    name: 'get_world_bank_indicator',
    purpose: 'Get the latest published figures, such as GDP or population, for one country from the World Bank.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          pattern: '^[A-Za-z]{2,3}\\s+[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+$',
          description: 'A country code and an indicator code, separated by a space, for example "PAK NY.GDP.MKTP.CD".',
        },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS, description: 'How many recent years to return.' },
      },
      required: ['query'],
    },
  },
  search,
};
