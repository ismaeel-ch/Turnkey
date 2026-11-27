/**
 * Joins the team graph's tool box to the connectors package (src/server/connectors, WP-07).
 *
 * The types here are the shape of that package's `Connector` written out again, so this file compiles on its own.
 * `getConnector` from `@/server/connectors` fits `ConnectorLookup` as it is.
 */
import { KNOWN_TOOLS, toolBoxFrom, type ToolBox, type ToolInfo } from './tools';

type ConnectorReply =
  { ok: true; items: { title: string; url: string; text: string; source: string }[] } | { ok: false; code?: string; message: string };
export type ConnectorLike = { id: string; label?: string; search(query: string, options?: { limit?: number }): Promise<ConnectorReply> };
export type ConnectorLookupLike = (id: string) => ConnectorLike | undefined;

/** The one query string a connector takes, from the named arguments an agent gave. */
export function queryFrom(connector: string, args: Record<string, string>): string {
  if (connector === 'worldbank') return `${args.country ?? ''} ${args.indicator ?? ''}`.trim();
  const first = Object.values(args).find((v) => v.trim());
  return (first ?? '').trim();
}

/** Codes that mean the source itself is down or misbehaving, not that the question was wrong. */
const DOWN = new Set(['timeout', 'upstream', 'bad_response', 'not_configured']);

/**
 * What an agent is told when a source cannot answer: plainly that it is unavailable, why, and what to do instead,
 * so it neither retries in a loop nor fills the gap with made-up facts.
 */
export function unavailableText(label: string, code: string | undefined, message: string): string {
  const why =
    code === 'timeout'
      ? 'it did not answer in time'
      : code === 'not_configured'
        ? 'it is not set up on this server'
        : code === 'bad_response'
          ? 'its answer could not be read'
          : 'it could not be reached';
  return (
    `SOURCE UNAVAILABLE: ${label} cannot be used right now (${why}; ${message}) ` +
    'Do not ask it again in this turn and do not guess what it would have said. Use your other lookups, or say in ' +
    `your answer that ${label} was unavailable.`
  );
}

export function toolBoxFromConnectors(lookup: ConnectorLookupLike, known: ToolInfo[] = KNOWN_TOOLS): ToolBox {
  return toolBoxFrom(async (connector, tool, args) => {
    const c = lookup(connector);
    if (!c) return { ok: false, unavailable: true, text: unavailableText(connector, 'not_configured', 'The source is not known.') };
    let r: ConnectorReply;
    try {
      r = await c.search(queryFrom(connector, args), { limit: 4 });
    } catch {
      // connectors never throw by contract; this keeps one that breaks it from failing the whole run
      r = { ok: false, code: 'upstream', message: 'The lookup failed.' };
    }
    if (!r.ok) {
      if (r.code === 'not_found') return { ok: true, text: `Nothing found: ${r.message}` };
      if (r.code && DOWN.has(r.code))
        return { ok: false, unavailable: true, text: unavailableText(c.label ?? connector, r.code, r.message) };
      return { ok: false, text: r.message };
    }
    if (!r.items.length) return { ok: true, text: 'Nothing found.' };
    const text = r.items.map((i) => `- ${i.title} (${i.source}): ${i.text} ${i.url}`).join('\n');
    return { ok: true, text, url: r.items[0].url };
  }, known);
}
