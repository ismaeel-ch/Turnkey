import type { AppRecord, Connector, Dict } from '@/shared/types/workspace';
import { S, online, toolCall } from './core';

/* ---------- connections to third parties ----------
   Five of them have real clients on the server (src/server/connectors, /api/connectors/<id>): the Connections page's Test button
   calls those for real. Saved builds replay the labelled samples below, so a Demo build costs nothing and needs no network. */
export const CONNECTORS: Connector[] = [
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    kind: 'REST API',
    url: 'https://en.wikipedia.org/api/rest_v1',
    auth: 'No key needed',
    icon: 'globe',
    acc: 'steel',
    about: 'Looks up domain terms while the Researcher writes the brief, and facts for the fact-check desk.',
    usedBy: 'Researcher agent, Fact-check desk (Researchers agent)',
    tools: [
      {
        name: 'search_pages',
        desc: 'Search article titles and descriptions',
        args: {
          q: 'help desk issue tracking',
        },
      },
      {
        name: 'page_summary',
        desc: 'Short summary of one article',
        args: {
          title: 'Workflow',
        },
      },
    ],
  },
  {
    id: 'mslearn',
    name: 'Microsoft Learn',
    kind: 'MCP server',
    url: 'https://learn.microsoft.com/api/mcp',
    auth: 'No key needed',
    icon: 'book',
    acc: 'royalBlue',
    about: 'Searches official Microsoft documentation. Built apps can call it from a record.',
    usedBy: 'Built apps (Suggest docs), Researcher agent',
    tools: [
      {
        name: 'microsoft_docs_search',
        desc: 'Search Microsoft documentation',
        args: {
          query: 'reset multifactor authentication for a user',
        },
      },
      {
        name: 'microsoft_docs_fetch',
        desc: 'Fetch one documentation page as Markdown',
        args: {
          url: 'https://learn.microsoft.com/en-us/entra/',
        },
      },
    ],
  },
  {
    id: 'worldbank',
    name: 'World Bank Open Data',
    kind: 'REST API',
    url: 'https://api.worldbank.org/v2',
    auth: 'No key needed',
    icon: 'trending',
    acc: 'forest',
    about: 'Country indicators for apps that need public reference data.',
    usedBy: 'Fact-check desk (Researchers agent)',
    tools: [
      {
        name: 'get_indicator',
        desc: 'Indicator values by country and year',
        args: {
          country: 'PK',
          indicator: 'SP.POP.TOTL',
        },
      },
    ],
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    kind: 'REST API',
    url: 'https://api.openalex.org',
    auth: 'No key needed',
    icon: 'library',
    acc: 'pumpkin',
    about: 'Open catalog of scholarly works, for research-heavy domains.',
    usedBy: 'Prior-art scout (Search agent)',
    tools: [
      {
        name: 'search_works',
        desc: 'Search scholarly works',
        args: {
          search: 'appointment no-show prediction',
        },
      },
    ],
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    kind: 'REST API',
    url: 'https://export.arxiv.org/api',
    auth: 'No key needed',
    icon: 'document',
    acc: 'cranberry',
    about: 'Preprints, for domains that track papers.',
    usedBy: 'Prior-art scout (Search agent)',
    tools: [
      {
        name: 'query',
        desc: 'Search preprints by keyword',
        args: {
          search_query: 'all:multi-agent orchestration',
        },
      },
    ],
  },
  {
    id: 'patentsview',
    name: 'PatentsView',
    kind: 'REST API',
    url: 'https://search.patentsview.org/api/v1',
    auth: 'Free API key, kept on the server',
    icon: 'certificate',
    acc: 'navy',
    about: 'Search of United States patent records.',
    usedBy: 'Prior-art scout (Search agent)',
    tools: [
      {
        name: 'search_patents',
        desc: 'Search patents by words in the title or abstract',
        args: {
          q: 'shelf camera stock counting',
        },
      },
    ],
  },
];
export const allConnectors = (): Connector[] => CONNECTORS.concat(S.custom || []);
export const connOn = (id: string) => (S.conns[id] !== undefined ? !!S.conns[id] : true);
export const WIKI = [
  ['Appointment scheduling software', 'Software that lets organisations manage bookings and appointments.'],
  ['Triage', 'Sorting people by how urgently they need care.'],
  ['Electronic health record', 'A digital collection of patient health information.'],
  ['Help desk', 'A resource that gives users information and support.'],
  ['Issue tracking system', 'Software that manages lists of issues or tickets.'],
  ['Service-level agreement', 'An agreement on the level of service a provider commits to.'],
  ['Annual leave', 'Paid time off work granted by employers.'],
  ['Leave of absence', 'A period away from a job while keeping it.'],
  ['Workflow', 'A repeatable pattern of activity that moves work through steps.'],
  ['Role-based access control', 'Restricting system access by the roles users hold.'],
  ['Grant (money)', 'Money given by a government, foundation or trust for a project, usually after an application and a review.'],
  ['Foundation (nonprofit)', 'A charitable organisation that gives grants to other organisations or people.'],
  ['Due diligence', 'Checking the facts about a person or organisation before an agreement or a payment.'],
  ['Purchase requisition', 'An internal request asking the purchasing department to buy goods or services.'],
  ['Purchase order', 'A document a buyer sends a supplier, listing what is ordered, how many and at what price.'],
];
export const LEARN: [RegExp, string, string][] = [
  [/vpn|wi-?fi|network|dns|proxy/i, 'Windows documentation', 'https://learn.microsoft.com/en-us/windows/'],
  [/password|sign|mfa|multifactor|account|access|locked/i, 'Microsoft Entra documentation', 'https://learn.microsoft.com/en-us/entra/'],
  [/outlook|mail|calendar|excel|office|365/i, 'Microsoft 365 documentation', 'https://learn.microsoft.com/en-us/microsoft-365/'],
  [/teams|meeting|call/i, 'Microsoft Teams documentation', 'https://learn.microsoft.com/en-us/microsoftteams/'],
];
export const SAMPLE_NOTE = 'Sample response, recorded with this saved build. Test on the Connections page makes the call for real.';
// Sample arguments come from saved builds and from what the owner types in the connector panel.
type SampleArgs = Dict<string | number | undefined>;
export const SAMPLES: Dict<Dict<(a: SampleArgs) => Dict<unknown>>> = {
  wikipedia: {
    search_pages: (a) => {
      const w = String(a.q || '')
        .toLowerCase()
        .split(/\W+/)
        .filter((x) => x.length > 2);
      const hits = WIKI.map((p) => ({
        p,
        n: w.filter((x) => (p[0] + ' ' + p[1]).toLowerCase().indexOf(x) >= 0).length,
      }))
        .sort((x, y) => y.n - x.n)
        .slice(0, 3);
      return {
        pages: hits.map((h) => ({
          title: h.p[0],
          description: h.p[1],
          url: 'https://en.wikipedia.org/wiki/' + h.p[0].replace(/ /g, '_'),
        })),
      };
    },
    page_summary: (a) => {
      const p = WIKI.find((x) => x[0].toLowerCase() === String(a.title || '').toLowerCase());
      return {
        title: a.title,
        extract: p ? p[1] : '(summary of this article from the live API)',
      };
    },
  },
  mslearn: {
    microsoft_docs_search: (a) => {
      const q = String(a.query || '');
      const hits = LEARN.filter((l) => l[0].test(q))
        .slice(0, 2)
        .map((l) => ({
          title: l[1],
          url: l[2],
          excerpt: 'The live connection returns the matching passages from this documentation set.',
        }));
      hits.push({
        title: 'Search Microsoft Learn for "' + q + '"',
        url: 'https://learn.microsoft.com/en-us/search/?terms=' + encodeURIComponent(q),
        excerpt: 'Opens the full search on Microsoft Learn.',
      });
      return {
        results: hits,
      };
    },
    microsoft_docs_fetch: (a) => ({
      url: a.url,
      markdown: '# (page content)\n\nThe live connection returns the page as Markdown.',
    }),
  },
  worldbank: {
    get_indicator: (a) => ({
      country: a.country,
      indicator: a.indicator,
      values: [
        {
          year: '(year)',
          value: '(value from the live API)',
        },
      ],
    }),
  },
  openalex: {
    search_works: (a) => ({
      search: a.search,
      results: [
        {
          title: '(title from the live API)',
          year: '(year)',
          cited_by_count: '(count)',
        },
      ],
    }),
  },
  arxiv: {
    query: (a) => ({
      search_query: a.search_query,
      entries: [
        {
          title: '(title from the live API)',
          published: '(date)',
        },
      ],
    }),
  },
  patentsview: {
    search_patents: (a) => ({
      q: a.q,
      patents: [
        {
          patent_title: '(title from the live API)',
          patent_date: '(date)',
        },
      ],
    }),
  },
};
export function callConnector(
  app: AppRecord | null | undefined,
  agent: string,
  runId: string | null | undefined,
  cid: string,
  tool: string,
  args?: SampleArgs | null,
) {
  const c = allConnectors().find((x) => x.id === cid) || {
    name: cid,
  };
  return toolCall(
    {
      agent,
      runId: runId ?? undefined,
      appId: app ? app.id : undefined,
    },
    c.name + ' · ' + tool,
    args,
    () => {
      if (!online()) throw new Error('Offline. Connections need internet.');
      const f = (SAMPLES[cid] || {})[tool];
      return Object.assign(
        {
          sample: true,
          note: SAMPLE_NOTE,
        },
        f
          ? f(args || {})
          : {
              result: '(response from ' + c.name + ')',
            },
      );
    },
    'connector',
  );
}
