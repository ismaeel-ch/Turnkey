/**
 * The tools an agent may ask for. Server only.
 *
 * The connectors package (src/server/connectors) will provide the real calls. Until it is joined, the graph codes
 * against this small interface: a list of what each tool takes, and one function that runs a tool.
 */
export type ToolResult = { ok: boolean; text: string; url?: string };

export type ToolInfo = { connector: string; tool: string; description: string; args: Record<string, string> };

export interface ToolBox {
  /** What the agent may be told about a tool. Null when this server has no such tool. */
  info(connector: string, tool: string): ToolInfo | null;
  run(connector: string, tool: string, args: Record<string, string>, signal?: AbortSignal): Promise<ToolResult>;
}

/** What each public source offers, matching the connector list the workspace shows. */
export const KNOWN_TOOLS: ToolInfo[] = [
  {
    connector: 'wikipedia',
    tool: 'search_pages',
    description: 'Search Wikipedia article titles and descriptions',
    args: { q: 'search words' },
  },
  { connector: 'wikipedia', tool: 'page_summary', description: 'Short summary of one Wikipedia article', args: { title: 'article title' } },
  {
    connector: 'worldbank',
    tool: 'get_indicator',
    description: 'World Bank indicator values by country and year',
    args: { country: 'two-letter country code, e.g. PK', indicator: 'indicator code, e.g. SP.POP.TOTL' },
  },
  { connector: 'openalex', tool: 'search_works', description: 'Search scholarly works', args: { search: 'search words' } },
  {
    connector: 'arxiv',
    tool: 'query',
    description: 'Search arXiv preprints by keyword',
    args: { search_query: 'e.g. all:multi-agent orchestration' },
  },
  {
    connector: 'patentsview',
    tool: 'search_patents',
    description: 'Search United States patents by words in the title or abstract',
    args: { q: 'search words' },
  },
];

/** A tool box over any function that runs a tool, for example the connectors package's entry point. */
export function toolBoxFrom(run: ToolBox['run'], known: ToolInfo[] = KNOWN_TOOLS): ToolBox {
  return { info: (c, t) => known.find((k) => k.connector === c && k.tool === t) ?? null, run };
}

/** No tools at all: agents are told to work from what they know. */
export const noTools: ToolBox = {
  info: () => null,
  run: async () => ({ ok: false, text: 'No tools are available.' }),
};
