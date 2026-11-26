/**
 * Joins the team graph's tool box to the connectors package (src/server/connectors, WP-07).
 *
 * The types here are the shape of that package's `Connector` written out again, so this file compiles on its own.
 * `getConnector` from `@/server/connectors` fits `ConnectorLookup` as it is.
 */
import { KNOWN_TOOLS, toolBoxFrom, type ToolBox, type ToolInfo } from './tools';

type ConnectorReply =
  { ok: true; items: { title: string; url: string; text: string; source: string }[] } | { ok: false; code?: string; message: string };
export type ConnectorLike = { id: string; search(query: string, options?: { limit?: number }): Promise<ConnectorReply> };
export type ConnectorLookupLike = (id: string) => ConnectorLike | undefined;

/** The one query string a connector takes, from the named arguments an agent gave. */
export function queryFrom(connector: string, args: Record<string, string>): string {
  if (connector === 'worldbank') return `${args.country ?? ''} ${args.indicator ?? ''}`.trim();
  const first = Object.values(args).find((v) => v.trim());
  return (first ?? '').trim();
}

export function toolBoxFromConnectors(lookup: ConnectorLookupLike, known: ToolInfo[] = KNOWN_TOOLS): ToolBox {
  return toolBoxFrom(async (connector, tool, args) => {
    const c = lookup(connector);
    if (!c) return { ok: false, text: `The source ${connector} is not available.` };
    const r = await c.search(queryFrom(connector, args), { limit: 4 });
    if (!r.ok) return { ok: false, text: r.message };
    if (!r.items.length) return { ok: true, text: 'Nothing found.' };
    const text = r.items.map((i) => `- ${i.title} (${i.source}): ${i.text} ${i.url}`).join('\n');
    return { ok: true, text, url: r.items[0].url };
  }, known);
}
