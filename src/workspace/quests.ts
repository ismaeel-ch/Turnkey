import type { AccessRule, SavedCase } from '@/shared/types/workspace';
import { REC } from './builds';

/* ===== Turnkey prototype · the three hackathon quests, each as its own app =====
   Each quest is built by the same line as any other app. What makes it a quest is its "team": three agents of
   its own, written by the Backend agent as data and run by the engine in team.js. "cases" are saved runs of
   those agents, replayed in Demo mode through the app's real API. People, newsrooms, ideas and prior-work
   records below are made up. The facts in the fact-check cases are well-known reference facts. */
export const SAMPLE_PW = 'Illustrative record for the demo. The live build lists real search results here.';
// A quest's records start from its saved cases, which come later in the same object.
const casesOf = (id: string): SavedCase[] => REC[id].cases || [];
export const everyone = (table: string, roles: string[], write: string[], boss: string): AccessRule[] =>
  roles.map((r) => ({
    table,
    role: r,
    list: 'all',
    create: write.includes(r),
    update: write.includes(r) ? 'all' : 'none',
    delete: r === boss,
  }));
REC.factcheck = {
  id: 'factcheck',
  quest: 1,
  title: 'Fact-check desk',
  icon: 'shield',
  accent: 'navy',
  agents: ['Extractor', 'Researchers', 'Verifier'],
  sampleNote: 'Evidence in the saved runs is sample data',
  sentence:
    'Editors paste a piece of text. Agents split it into claims, look for evidence and give each claim a verdict, and a senior editor signs off before it is published.',
  blurb: 'An Extractor, Researchers and a Verifier check each text, claim by claim.',
  keys: ['fact', 'claim', 'verify', 'verdict', 'misinformation', 'evidence', 'newsroom'],
  usage: {
    research: [1240, 600, 6000],
    database: [2460, 2910, 14300],
    backend: [3520, 1310, 9400],
    views: [2700, 1230, 8300],
    ui: [4180, 1390, 9900],
  },
  say: {
    research: [
      'Reading the request. The work is done by agents, so I am also noting what each one produces: claims, evidence, verdicts.',
      'Three roles, three kinds of record, one process on checks. No decision needs you this time.',
    ],
    database: ['Creating tables for checks, claims and evidence, with three finished checks so the views have something to show.'],
    backend: [
      "Writing the workflow, the access rules and the app's own team: an Extractor, Researchers and a Verifier. They write through the same endpoints as people, so I am checking that an editor is allowed to do everything they do.",
    ],
    views: [
      'Claims have a verdict and a topic, so a board by verdict, a pivot and charts all fit. Evidence hangs off claims, so a tree is the natural view.',
      'The dashboard counts claims by verdict and shows where the evidence comes from.',
      "For the agents' room I put every claim in a list with its evidence underneath, because a verdict is only as good as the sources beside it.",
    ],
    ui: [
      'Laying out the pages: a check room where the team works, a board of checks, the claims, and the evidence as a tree. Navy, side navigation.',
    ],
  },
  research: () => ({
    name: 'Fact Desk',
    summary: 'Editors send in text, three agents break it into claims and check each one, and a senior editor signs off.',
    roles: [
      {
        id: 'editor',
        name: 'Editor',
        can: 'Sends in text, runs the agents and reads the verdicts',
      },
      {
        id: 'senior_editor',
        name: 'Senior editor',
        can: 'Reviews and corrects verdicts, and publishes the check',
      },
      {
        id: 'reader',
        name: 'Reader',
        can: 'Reads checks and their evidence',
      },
    ],
    entities: [
      {
        name: 'checks',
        what: 'A piece of text sent in for checking',
      },
      {
        name: 'claims',
        what: 'One factual statement found in a text',
      },
      {
        name: 'evidence',
        what: 'What a source says about a claim',
      },
    ],
    process: {
      entity: 'checks',
      states: ['queued', 'checking', 'checked', 'published'],
      note: 'The agents take a check from queued to checked. A senior editor publishes it.',
    },
    stories: [
      {
        role: 'editor',
        want: 'paste a text and have it checked claim by claim',
        so: 'I know what I can print',
      },
      {
        role: 'editor',
        want: 'see the evidence behind every verdict',
        so: 'I can judge it myself',
      },
      {
        role: 'senior_editor',
        want: 'correct a verdict and publish the check',
        so: 'a person signs off, not an agent',
      },
      {
        role: 'reader',
        want: 'read checks without being able to change them',
        so: 'the record stays clean',
      },
    ],
    rules: [
      'Only a senior editor can publish a check',
      'Readers cannot change anything',
      'Agents write through the same endpoints as people',
    ],
    question: null,
  }),
  database: () => {
    const C = [
      [
        'Space trivia post',
        'The Great Wall of China is visible from space with the naked eye. Light from the Sun takes about eight minutes to reach Earth. A day on Venus is longer than its year.',
        'Social media draft',
        1,
        'published',
        'Two of three claims hold. The Great Wall claim is a common myth.',
        67,
        -6,
      ],
      [
        'Health newsletter',
        'People use only ten percent of their brains. An adult human body has 206 bones. Lightning never strikes the same place twice.',
        'Newsletter draft',
        2,
        'checked',
        'One of three claims holds. The other two are popular myths.',
        33,
        -3,
      ],
      [
        'Geography quiz',
        'Mount Everest is the highest mountain above sea level. The Sahara is the largest desert on Earth. Russia spans eleven time zones.',
        'Quiz sheet',
        1,
        'checked',
        'Two of three claims hold. The largest desert is Antarctica. The Sahara is the largest hot desert.',
        67,
        -1,
      ],
      ['Science class handout', casesOf('factcheck')[1].values.text, 'Class handout', 2, 'queued', null, null, null],
    ];
    const K = [
      [
        1,
        'The Great Wall of China is visible from space with the naked eye',
        'science',
        'contradicted',
        92,
        'Astronauts report that the wall cannot be picked out with the unaided eye from orbit. It is long but narrow.',
      ],
      [
        1,
        'Light from the Sun takes about eight minutes to reach Earth',
        'science',
        'supported',
        97,
        'Light covers the average distance between the Sun and Earth in a little over eight minutes.',
      ],
      [
        1,
        'A day on Venus is longer than its year',
        'science',
        'supported',
        95,
        'Venus turns once in about 243 Earth days and goes round the Sun in about 225.',
      ],
      [
        2,
        'People use only ten percent of their brains',
        'health',
        'contradicted',
        96,
        'Brain imaging shows activity across the whole brain. No large region sits unused.',
      ],
      [2, 'An adult human body has 206 bones', 'health', 'supported', 97, 'The usual count for an adult skeleton is 206.'],
      [
        2,
        'Lightning never strikes the same place twice',
        'science',
        'contradicted',
        97,
        'Tall structures are struck again and again, some of them many times a year.',
      ],
      [
        3,
        'Mount Everest is the highest mountain above sea level',
        'geography',
        'supported',
        98,
        'Its summit is the highest point on Earth above sea level.',
      ],
      [
        3,
        'The Sahara is the largest desert on Earth',
        'geography',
        'contradicted',
        90,
        'A desert is defined by low rainfall, which makes Antarctica the largest. The Sahara is the largest hot desert.',
      ],
      [3, 'Russia spans eleven time zones', 'geography', 'supported', 95, 'Russia uses eleven time zones.'],
    ];
    const E = [
      [1, 'Great Wall of China', 'The wall is generally not visible to the unaided eye from low Earth orbit.', 'contradicts'],
      [2, 'Sunlight', 'Sunlight takes a little over eight minutes to reach Earth.', 'supports'],
      [3, 'Venus', 'Venus rotates more slowly than it orbits the Sun.', 'supports'],
      [4, 'Ten percent of the brain myth', 'The idea that people use a tenth of their brain is a myth.', 'contradicts'],
      [5, 'Human skeleton', 'The adult human skeleton has 206 bones.', 'supports'],
      [6, 'Lightning', 'Lightning can and does strike the same place more than once.', 'contradicts'],
      [7, 'Mount Everest', 'Everest is the highest mountain above sea level.', 'supports'],
      [8, 'Desert', 'The largest deserts are polar. The Sahara is the largest hot desert.', 'contradicts'],
      [9, 'Time in Russia', 'Russia has eleven time zones.', 'supports'],
    ];
    return {
      tables: [
        {
          name: 'checks',
          label: 'Checks',
          one: 'Check',
          title: 'title',
          owner: 'submitted_by',
          columns: [
            {
              name: 'title',
              label: 'Title',
              type: 'text',
              required: true,
            },
            {
              name: 'text',
              label: 'Text to check',
              type: 'longtext',
              required: true,
            },
            {
              name: 'source',
              label: 'Where it is from',
              type: 'text',
            },
            {
              name: 'submitted_by',
              label: 'Sent in by',
              type: 'user',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['queued', 'checking', 'checked', 'published'],
              required: true,
            },
            {
              name: 'summary',
              label: 'Summary',
              type: 'longtext',
            },
            {
              name: 'accuracy',
              label: 'Claims that hold, %',
              type: 'number',
            },
            {
              name: 'checked_on',
              label: 'Checked on',
              type: 'date',
            },
          ],
          rows: C.map((c) => ({
            title: c[0],
            text: c[1],
            source: c[2],
            submitted_by: c[3],
            status: c[4],
            summary: c[5],
            accuracy: c[6],
            checked_on: c[7],
          })),
        },
        {
          name: 'claims',
          label: 'Claims',
          one: 'Claim',
          title: 'statement',
          owner: null,
          columns: [
            {
              name: 'check_id',
              label: 'Check',
              type: 'ref',
              ref: 'checks',
              required: true,
            },
            {
              name: 'statement',
              label: 'Statement',
              type: 'text',
              required: true,
            },
            {
              name: 'topic',
              label: 'Topic',
              type: 'select',
              options: ['science', 'health', 'geography', 'history', 'economy', 'other'],
            },
            {
              name: 'verdict',
              label: 'Verdict',
              type: 'select',
              options: ['unverified', 'contradicted', 'supported', 'mixed', 'unverifiable'],
              required: true,
            },
            {
              name: 'confidence',
              label: 'Confidence',
              type: 'number',
            },
            {
              name: 'reason',
              label: 'Reason',
              type: 'longtext',
            },
          ],
          rows: K.map((k) => ({
            check_id: k[0],
            statement: k[1],
            topic: k[2],
            verdict: k[3],
            confidence: k[4],
            reason: k[5],
          })),
        },
        {
          name: 'evidence',
          label: 'Evidence',
          one: 'Piece of evidence',
          title: 'title',
          owner: null,
          columns: [
            {
              name: 'claim_id',
              label: 'Claim',
              type: 'ref',
              ref: 'claims',
              required: true,
            },
            {
              name: 'source',
              label: 'Source',
              type: 'select',
              options: ['wikipedia', 'world_bank', 'model_knowledge'],
              labels: {
                wikipedia: 'Wikipedia',
                world_bank: 'World Bank',
                model_knowledge: 'Model knowledge',
              },
              required: true,
            },
            {
              name: 'title',
              label: 'Title',
              type: 'text',
              required: true,
            },
            {
              name: 'finding',
              label: 'What it says',
              type: 'longtext',
            },
            {
              name: 'stance',
              label: 'Stance',
              type: 'select',
              options: ['neutral', 'contradicts', 'supports'],
              required: true,
            },
            {
              name: 'url',
              label: 'Link',
              type: 'text',
            },
          ],
          rows: E.map((e) => ({
            claim_id: e[0],
            source: 'wikipedia',
            title: e[1],
            finding: e[2],
            stance: e[3],
            url: 'https://en.wikipedia.org/wiki/' + String(e[1]).replace(/ /g, '_'),
          })),
        },
      ],
      users: [
        {
          name: 'Hina Aslam',
          role: 'editor',
        },
        {
          name: 'Daniyal Raza',
          role: 'editor',
        },
        {
          name: 'Sobia Qadir',
          role: 'senior_editor',
        },
        {
          name: 'Usman Ghani',
          role: 'reader',
        },
      ],
    };
  },
  backend: () => ({
    status: {
      table: 'checks',
      column: 'status',
      initial: 'queued',
      states: [
        {
          id: 'queued',
          label: 'Queued',
          tone: 'neutral',
        },
        {
          id: 'checking',
          label: 'Checking',
          tone: 'warning',
        },
        {
          id: 'checked',
          label: 'Checked',
          tone: 'info',
        },
        {
          id: 'published',
          label: 'Published',
          tone: 'success',
        },
      ],
      transitions: [
        {
          id: 'start_check',
          label: 'Start checking',
          from: ['queued'],
          to: 'checking',
          roles: ['editor', 'senior_editor'],
        },
        {
          id: 'finish_check',
          label: 'Finish checking',
          from: ['checking'],
          to: 'checked',
          roles: ['editor', 'senior_editor'],
        },
        {
          id: 'publish',
          label: 'Publish',
          from: ['checked'],
          to: 'published',
          roles: ['senior_editor'],
        },
        {
          id: 'reopen',
          label: 'Send back to the queue',
          from: ['checked', 'published'],
          to: 'queued',
          roles: ['senior_editor'],
        },
      ],
    },
    access: ([] as AccessRule[]).concat(
      everyone('checks', ['editor', 'senior_editor', 'reader'], ['editor', 'senior_editor'], 'senior_editor'),
      everyone('claims', ['editor', 'senior_editor', 'reader'], ['editor', 'senior_editor'], 'senior_editor'),
      everyone('evidence', ['editor', 'senior_editor', 'reader'], ['editor', 'senior_editor'], 'senior_editor'),
    ),
    team: {
      title: 'Fact-check team',
      about: "Three agents work on one text, one after another. Each one writes to this app's own tables.",
      input: {
        table: 'checks',
        column: 'text',
      },
      start: 'start_check',
      done: 'finish_check',
      agents: [
        {
          id: 'extractor',
          name: 'Extractor',
          icon: 'filter',
          acc: 'purple',
          job: 'Splits the text into separate factual claims and leaves opinions out.',
          writes: 'claims',
          fixed: {
            verdict: 'unverified',
          },
        },
        {
          id: 'researchers',
          name: 'Researchers',
          icon: 'search',
          acc: 'teal',
          job: 'Look for evidence in Wikipedia and World Bank data, one researcher per claim.',
          writes: 'evidence',
          tools: [
            {
              connector: 'wikipedia',
              tool: 'page_summary',
            },
            {
              connector: 'worldbank',
              tool: 'get_indicator',
            },
          ],
          proto:
            'This page cannot reach other hosts, so no tool results are attached. Work from what you know, set "source" to "model_knowledge" and leave "url" empty. One row per claim.',
        },
        {
          id: 'verifier',
          name: 'Verifier',
          icon: 'shield',
          acc: 'forest',
          job: 'Weighs the evidence, gives every claim a verdict with a confidence from 0 to 100, and sums up the text. Thin evidence means unverifiable, not a guess.',
          updates: 'claims',
          sets: ['summary', 'accuracy', 'checked_on'],
        },
      ],
      samples: casesOf('factcheck').map((c) => ({
        label: c.label,
        values: c.values,
      })),
    },
  }),
  views: () => ({
    views: [
      {
        table: 'checks',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'Checks move from queued to published.',
          },
          {
            type: 'table',
            why: 'For sorting by date and accuracy.',
          },
          {
            type: 'cards',
            why: 'The text of a check reads better on a card.',
          },
          {
            type: 'calendar',
            date: 'checked_on',
            why: 'When each check was finished.',
          },
          {
            type: 'chart',
            x: 'status',
            why: 'How much is waiting.',
          },
          {
            type: 'pivot',
            rows: 'submitted_by',
            cols: 'status',
            why: 'Who sent in what, and where it stands.',
          },
        ],
      },
      {
        table: 'claims',
        use: [
          {
            type: 'table',
            why: 'Statement, verdict and confidence side by side.',
          },
          {
            type: 'board',
            by: 'verdict',
            why: 'A senior editor corrects a verdict by moving the card.',
          },
          {
            type: 'chart',
            x: 'verdict',
            split: 'topic',
            why: 'How many claims hold, by topic.',
          },
          {
            type: 'pivot',
            rows: 'topic',
            cols: 'verdict',
            why: 'Topic against verdict in one grid.',
          },
          {
            type: 'tree',
            levels: ['check_id', 'verdict'],
            why: 'Claims nested under the text they came from.',
          },
          {
            type: 'cards',
            why: 'A card per claim with its reason.',
          },
        ],
      },
      {
        table: 'evidence',
        use: [
          {
            type: 'tree',
            levels: ['claim_id', 'stance'],
            why: 'Evidence hangs off a claim, so it nests under it.',
          },
          {
            type: 'table',
            why: 'Every source in one list.',
          },
          {
            type: 'pivot',
            rows: 'source',
            cols: 'stance',
            why: 'Which sources support and which contradict.',
          },
          {
            type: 'chart',
            x: 'source',
            split: 'stance',
            why: 'Where the evidence comes from.',
          },
          {
            type: 'cards',
            why: 'What each source says, in full.',
          },
        ],
      },
    ],
    board: {
      why: 'Every claim needs its evidence next to it, so the room lists the claims with their sources underneath and the verdict beside each one.',
      verdict: {
        meter: 'accuracy',
        text: 'summary',
        date: 'checked_on',
      },
      panels: [
        {
          table: 'claims',
          layout: 'list',
          title: 'Claims and their evidence',
          badge: 'verdict',
          meter: 'confidence',
          text: 'reason',
          tag: 'topic',
          children: {
            table: 'evidence',
            via: 'claim_id',
            badge: 'stance',
            text: 'finding',
            tag: 'source',
            link: 'url',
          },
        },
      ],
    },
    dashboard: {
      title: 'Desk overview',
      date: {
        table: 'checks',
        column: 'checked_on',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Texts',
          table: 'checks',
        },
        {
          kind: 'kpi',
          label: 'Claims',
          table: 'claims',
        },
        {
          kind: 'kpi',
          label: 'Supported',
          table: 'claims',
          where: {
            verdict: 'supported',
          },
        },
        {
          kind: 'kpi',
          label: 'Contradicted',
          table: 'claims',
          where: {
            verdict: 'contradicted',
          },
        },
        {
          kind: 'bar',
          label: 'Claims by verdict',
          table: 'claims',
          x: 'verdict',
        },
        {
          kind: 'stack',
          label: 'Claims by topic and verdict',
          table: 'claims',
          x: 'topic',
          split: 'verdict',
        },
        {
          kind: 'line',
          label: 'Texts checked per day',
          table: 'checks',
          x: 'checked_on',
          bucket: 'day',
        },
        {
          kind: 'bar',
          label: 'Evidence by source',
          table: 'evidence',
          x: 'source',
        },
        {
          kind: 'recent',
          label: 'Latest checks',
          table: 'checks',
        },
      ],
    },
  }),
  ui: () => ({
    theme: {
      accent: 'navy',
      nav: 'side',
      icon: 'shield',
    },
    screens: [
      {
        name: 'Check room',
        type: 'agents',
        table: 'checks',
        roles: ['editor', 'senior_editor'],
        icon: 'bot',
      },
      {
        name: 'Checks',
        type: 'board',
        table: 'checks',
        roles: ['editor', 'senior_editor', 'reader'],
        group: 'status',
        columns: ['source', 'submitted_by', 'accuracy', 'checked_on'],
        icon: 'board',
      },
      {
        name: 'Claims',
        type: 'table',
        table: 'claims',
        roles: ['editor', 'senior_editor', 'reader'],
        columns: ['statement', 'verdict', 'confidence', 'topic', 'check_id'],
        icon: 'list',
      },
      {
        name: 'Verdict board',
        type: 'board',
        table: 'claims',
        roles: ['senior_editor'],
        group: 'verdict',
        columns: ['check_id', 'confidence', 'topic'],
        icon: 'scales',
      },
      {
        name: 'Evidence',
        type: 'tree',
        table: 'evidence',
        roles: ['editor', 'senior_editor', 'reader'],
        columns: ['title', 'source', 'stance', 'claim_id'],
        icon: 'branch',
      },
    ],
    tour: [
      {
        role: 'editor',
        do: 'create',
        table: 'checks',
        values: {
          title: 'Product page copy',
          text: 'Water boils at 100 degrees Celsius at sea level. The company was founded in 2015.',
          source: 'Web copy',
        },
        say: 'Hina, an editor, sends in a short text.',
      },
      {
        role: 'senior_editor',
        do: 'see',
        table: 'checks',
        screen: 'Checks',
        say: 'Sobia, the senior editor, finds it on the board.',
      },
      {
        role: 'editor',
        do: 'transition',
        table: 'checks',
        transition: 'start_check',
        say: 'Hina starts the check. In the check room the three agents take it from here.',
      },
      {
        role: 'editor',
        do: 'transition',
        table: 'checks',
        transition: 'finish_check',
        say: 'The check is finished and waits for sign-off.',
      },
      {
        role: 'editor',
        do: 'denied',
        table: 'checks',
        action: 'publish',
        say: 'Hina tries to publish it. The backend refuses, because only a senior editor signs off.',
      },
      {
        role: 'senior_editor',
        do: 'transition',
        table: 'checks',
        transition: 'publish',
        say: 'Sobia publishes it.',
      },
      {
        role: 'reader',
        do: 'denied',
        table: 'claims',
        action: 'create',
        say: 'Usman, a reader, tries to add a claim. The backend refuses.',
      },
    ],
  }),
  cases: [
    {
      label: 'Company blog draft',
      values: {
        title: 'Company blog draft',
        text: 'India is now the most populous country in the world. Honey stored in a sealed jar does not spoil. Nine out of ten developers already use our product.',
        source: 'Blog draft',
      },
      script: [
        {
          agent: 'extractor',
          say: 'Three checkable statements. The last one is about your own product, so public sources may have nothing on it.',
          rows: [
            {
              statement: 'India is now the most populous country in the world',
              topic: 'economy',
            },
            {
              statement: 'Honey stored in a sealed jar does not spoil',
              topic: 'science',
            },
            {
              statement: 'Nine out of ten developers already use our product',
              topic: 'other',
            },
          ],
        },
        {
          agent: 'researchers',
          say: 'Population totals for India and China from the World Bank, and the Honey article. Nothing public on the product figure.',
          tools: [
            [
              'worldbank',
              'get_indicator',
              {
                country: 'IN',
                indicator: 'SP.POP.TOTL',
              },
            ],
            [
              'worldbank',
              'get_indicator',
              {
                country: 'CN',
                indicator: 'SP.POP.TOTL',
              },
            ],
            [
              'wikipedia',
              'page_summary',
              {
                title: 'Honey',
              },
            ],
          ],
          rows: [
            {
              claim_id: 1,
              source: 'world_bank',
              title: 'Population, total: India and China',
              finding: 'World Bank population totals put India above China from 2023.',
              stance: 'supports',
              url: 'https://data.worldbank.org/indicator/SP.POP.TOTL',
            },
            {
              claim_id: 2,
              source: 'wikipedia',
              title: 'Honey',
              finding:
                'Honey is low in water and acidic, which stops most microbes from growing. Kept sealed, it stays edible for a very long time.',
              stance: 'supports',
              url: 'https://en.wikipedia.org/wiki/Honey',
            },
            {
              claim_id: 3,
              source: 'model_knowledge',
              title: 'No public source found',
              finding:
                "Nothing public backs the nine in ten figure. It would need the company's own survey, with the sample size and the question that was asked.",
              stance: 'neutral',
            },
          ],
        },
        {
          agent: 'verifier',
          say: 'Two claims hold. The product figure cannot be checked from public sources, so I marked it unverifiable instead of guessing.',
          update: [
            {
              row: 1,
              verdict: 'supported',
              confidence: 93,
              reason: 'World Bank totals show India ahead of China since 2023.',
            },
            {
              row: 2,
              verdict: 'supported',
              confidence: 88,
              reason: 'Low water content and acidity keep sealed honey from spoiling.',
            },
            {
              row: 3,
              verdict: 'unverifiable',
              confidence: 20,
              reason: 'No public source. Print it only with your own survey behind it.',
            },
          ],
          summary: {
            summary: 'Two of three claims hold. The product claim cannot be checked from public sources.',
            accuracy: 67,
            checked_on: 0,
          },
        },
      ],
    },
    {
      label: 'Science class handout',
      values: {
        title: 'Science class handout',
        text: 'Humans have exactly five senses. Sound travels faster in water than in air. The Moon has no gravity.',
        source: 'Class handout',
      },
      script: [
        {
          agent: 'extractor',
          say: 'Three statements, all checkable.',
          rows: [
            {
              statement: 'Humans have exactly five senses',
              topic: 'health',
            },
            {
              statement: 'Sound travels faster in water than in air',
              topic: 'science',
            },
            {
              statement: 'The Moon has no gravity',
              topic: 'science',
            },
          ],
        },
        {
          agent: 'researchers',
          say: 'One article for each claim.',
          tools: [
            [
              'wikipedia',
              'page_summary',
              {
                title: 'Sense',
              },
            ],
            [
              'wikipedia',
              'page_summary',
              {
                title: 'Speed of sound',
              },
            ],
            [
              'wikipedia',
              'page_summary',
              {
                title: 'Gravitation of the Moon',
              },
            ],
          ],
          rows: [
            {
              claim_id: 1,
              source: 'wikipedia',
              title: 'Sense',
              finding: 'Besides the classic five, people sense balance, temperature, pain and the position of their own body.',
              stance: 'contradicts',
              url: 'https://en.wikipedia.org/wiki/Sense',
            },
            {
              claim_id: 2,
              source: 'wikipedia',
              title: 'Speed of sound',
              finding: 'About 343 metres a second in air at room temperature, and roughly 1,480 in water.',
              stance: 'supports',
              url: 'https://en.wikipedia.org/wiki/Speed_of_sound',
            },
            {
              claim_id: 3,
              source: 'wikipedia',
              title: 'Gravitation of the Moon',
              finding: 'Gravity at the surface of the Moon is about one sixth of gravity on Earth.',
              stance: 'contradicts',
              url: 'https://en.wikipedia.org/wiki/Gravitation_of_the_Moon',
            },
          ],
        },
        {
          agent: 'verifier',
          say: 'One claim holds. The other two are common simplifications that are wrong as written.',
          update: [
            {
              row: 1,
              verdict: 'contradicted',
              confidence: 90,
              reason: 'People have more than five senses, including balance and temperature.',
            },
            {
              row: 2,
              verdict: 'supported',
              confidence: 97,
              reason: 'Sound moves more than four times faster in water than in air.',
            },
            {
              row: 3,
              verdict: 'contradicted',
              confidence: 98,
              reason: "The Moon has gravity, about a sixth of Earth's.",
            },
          ],
          summary: {
            summary: 'One of three claims holds. Rewrite the lines about senses and the Moon before the handout goes out.',
            accuracy: 33,
            checked_on: 0,
          },
        },
      ],
    },
    {
      label: 'Travel article',
      values: {
        title: 'Travel article',
        text: 'The Nile is the longest river in Africa. Tokyo is the capital of Japan. Mount Kilimanjaro is in Kenya.',
        source: 'Magazine draft',
      },
      script: [
        {
          agent: 'extractor',
          say: 'Three statements about places.',
          rows: [
            {
              statement: 'The Nile is the longest river in Africa',
              topic: 'geography',
            },
            {
              statement: 'Tokyo is the capital of Japan',
              topic: 'geography',
            },
            {
              statement: 'Mount Kilimanjaro is in Kenya',
              topic: 'geography',
            },
          ],
        },
        {
          agent: 'researchers',
          say: 'One article for each place.',
          tools: [
            [
              'wikipedia',
              'page_summary',
              {
                title: 'Nile',
              },
            ],
            [
              'wikipedia',
              'page_summary',
              {
                title: 'Tokyo',
              },
            ],
            [
              'wikipedia',
              'page_summary',
              {
                title: 'Mount Kilimanjaro',
              },
            ],
          ],
          rows: [
            {
              claim_id: 1,
              source: 'wikipedia',
              title: 'Nile',
              finding: 'The Nile is the longest river in Africa.',
              stance: 'supports',
              url: 'https://en.wikipedia.org/wiki/Nile',
            },
            {
              claim_id: 2,
              source: 'wikipedia',
              title: 'Tokyo',
              finding: 'Tokyo is the capital of Japan.',
              stance: 'supports',
              url: 'https://en.wikipedia.org/wiki/Tokyo',
            },
            {
              claim_id: 3,
              source: 'wikipedia',
              title: 'Mount Kilimanjaro',
              finding: 'Kilimanjaro is in Tanzania, close to the border with Kenya.',
              stance: 'contradicts',
              url: 'https://en.wikipedia.org/wiki/Mount_Kilimanjaro',
            },
          ],
        },
        {
          agent: 'verifier',
          say: 'Two claims hold. Kilimanjaro is in Tanzania, which is an easy fix.',
          update: [
            {
              row: 1,
              verdict: 'supported',
              confidence: 96,
              reason: 'The Nile is the longest river on the continent.',
            },
            {
              row: 2,
              verdict: 'supported',
              confidence: 99,
              reason: 'Tokyo is the capital.',
            },
            {
              row: 3,
              verdict: 'contradicted',
              confidence: 98,
              reason: 'The mountain is in Tanzania. It can be seen from Kenya.',
            },
          ],
          summary: {
            summary: 'Two of three claims hold. Change Kenya to Tanzania.',
            accuracy: 67,
            checked_on: 0,
          },
        },
      ],
    },
  ],
};
REC.priorart = {
  id: 'priorart',
  quest: 2,
  title: 'Prior-art scout',
  icon: 'lightbulb',
  accent: 'royalBlue',
  agents: ['Search', 'Analyst', 'Critic'],
  sampleNote: 'Prior work is illustrative, not real citations',
  sentence:
    'Inventors describe an idea. Agents search patents and papers for similar work, compare it with the idea and challenge the result, and an IP reviewer decides whether to pursue it.',
  blurb: 'Search, Analyst and Critic agents weigh an idea against earlier work.',
  keys: ['prior art', 'patent', 'invention', 'novelty', 'inventor', 'idea'],
  usage: {
    research: [1210, 590, 5900],
    database: [2440, 3050, 14900],
    backend: [3490, 1280, 9200],
    views: [2690, 1200, 8200],
    ui: [4150, 1370, 9800],
  },
  say: {
    research: [
      'Reading the request. Agents do the searching and comparing here, so I am noting what each one leaves behind: prior work and findings.',
      'Three roles, three kinds of record, one process on ideas.',
    ],
    database: [
      'Creating tables for ideas, prior work and findings. The prior work in the seed data is marked as illustrative, so nobody mistakes it for a real citation.',
    ],
    backend: [
      'Writing the workflow, the access rules and the team: Search, Analyst and Critic. Inventors see only their own ideas, and only an IP reviewer decides.',
    ],
    views: [
      'Prior work has a source and an overlap rating, which makes a pivot the quickest read. Findings belong to an idea, so they nest in a tree.',
      'The dashboard shows ideas by status and how much overlap the searches found.',
      "For the agents' room I rank the prior work by overlap and put the Analyst's points under each record.",
    ],
    ui: [
      'Laying out the pages: a scout room for the agents, a board of ideas, the prior work as a list and an overlap map, findings as a tree. Blue, with an icon rail.',
    ],
  },
  research: () => ({
    name: 'Prior Art Scout',
    summary: 'Inventors describe an idea, three agents weigh it against earlier work, and an IP reviewer decides whether to pursue it.',
    roles: [
      {
        id: 'inventor',
        name: 'Inventor',
        can: 'Describes an idea and runs the scout on it',
      },
      {
        id: 'ip_reviewer',
        name: 'IP reviewer',
        can: 'Reads every assessment and decides to pursue or shelve',
      },
      {
        id: 'partner',
        name: 'Partner',
        can: 'Reads assessments',
      },
    ],
    entities: [
      {
        name: 'ideas',
        what: 'An idea someone wants to protect',
      },
      {
        name: 'prior_work',
        what: 'Earlier work that is close to an idea',
      },
      {
        name: 'findings',
        what: 'One point from the comparison: an overlap, a difference, a risk or a next step',
      },
    ],
    process: {
      entity: 'ideas',
      states: ['draft', 'searching', 'assessed', 'pursue', 'shelved'],
      note: 'The agents take an idea from draft to assessed. An IP reviewer decides.',
    },
    stories: [
      {
        role: 'inventor',
        want: 'describe my idea and see what already exists',
        so: 'I do not spend months on something that is taken',
      },
      {
        role: 'inventor',
        want: 'see only my own ideas',
        so: 'unfiled ideas stay private',
      },
      {
        role: 'ip_reviewer',
        want: 'read the overlaps and risks and then decide',
        so: 'the decision is made by a person',
      },
      {
        role: 'partner',
        want: 'see the portfolio without changing it',
        so: 'I can plan budgets',
      },
    ],
    rules: [
      'Inventors see only their own ideas',
      'Only an IP reviewer can pursue or shelve an idea',
      'Agents write through the same endpoints as people',
    ],
    question: null,
  }),
  database: () => {
    const I = [
      [
        'Shelf-edge camera that counts stock',
        'A small camera on the shelf edge photographs the facing products every few minutes and counts what is left, so staff know what to refill.',
        'retail',
        1,
        'assessed',
        'low',
        'A crowded field. Camera-based shelf monitoring is well covered. The open angle is a cheap retrofit for small shops.',
        -9,
      ],
      [
        'Shared cold-chain capacity for small hauliers',
        'A marketplace where small refrigerated hauliers offer spare space on fixed routes, with a temperature log attached to every booking.',
        'logistics',
        2,
        'pursue',
        'medium',
        'Load matching is common. Sharing refrigerated space with temperature proof on each booking looks less covered.',
        -4,
      ],
      [
        'Reading coach that listens and scores fluency',
        'An app that listens to a child reading aloud, marks the words that were missed and gives a fluency score to the teacher.',
        'education',
        1,
        'shelved',
        'low',
        'Speech-based reading tutors are well established. Nothing in the idea is clearly new.',
        -14,
      ],
      [casesOf('priorart')[0].values.title, casesOf('priorart')[0].values.description, 'health_tech', 2, 'draft', 'unknown', null, null],
    ];
    const W = [
      [1, 'Camera system for monitoring shelf inventory', 'patentsview', 'patent', 2018, 'high', 'P-01'],
      [1, 'Detecting out-of-stock products from shelf images', 'openalex', 'paper', 2020, 'high', 'W-02'],
      [1, 'Low-power image sensing for retail shelves', 'arxiv', 'preprint', 2022, 'medium', 'A-03'],
      [2, 'Freight matching platform for partial loads', 'patentsview', 'patent', 2017, 'medium', 'P-04'],
      [2, 'Shared capacity in refrigerated transport: a survey', 'openalex', 'paper', 2021, 'medium', 'W-05'],
      [2, 'Tamper-evident temperature logging for shipments', 'arxiv', 'preprint', 2023, 'low', 'A-06'],
      [3, 'Automated assessment of oral reading fluency', 'openalex', 'paper', 2016, 'high', 'W-07'],
      [3, 'Speech recognition tutor for early readers', 'patentsview', 'patent', 2014, 'high', 'P-08'],
    ];
    const F = [
      [1, 'Counting products from shelf images is already described', 'overlap', 'high', 1],
      [1, 'A retrofit that needs no shelf wiring is narrower than the earlier work', 'difference', 'medium', 3],
      [1, 'Lighting and stacked products make counts unreliable', 'risk', 'medium', 2],
      [1, 'Search for claims on battery-powered retrofit units', 'next_step', 'low', null],
      [2, 'Matching spare freight space is well covered', 'overlap', 'medium', 4],
      [2, 'A temperature log tied to each booking is not in the matching patents', 'difference', 'high', 6],
      [2, 'Hauliers may not share route data with competitors', 'risk', 'medium', null],
      [2, 'Draft claims around the booking plus the temperature proof', 'next_step', 'medium', null],
      [3, 'Scoring fluency from speech is established', 'overlap', 'high', 7],
      [3, 'No clear difference from existing reading tutors', 'risk', 'high', 8],
    ];
    return {
      tables: [
        {
          name: 'ideas',
          label: 'Ideas',
          one: 'Idea',
          title: 'title',
          owner: 'inventor_id',
          columns: [
            {
              name: 'title',
              label: 'Title',
              type: 'text',
              required: true,
            },
            {
              name: 'description',
              label: 'Description',
              type: 'longtext',
              required: true,
            },
            {
              name: 'field',
              label: 'Field',
              type: 'select',
              options: ['retail', 'logistics', 'energy', 'health_tech', 'education'],
              labels: {
                health_tech: 'Health tech',
              },
            },
            {
              name: 'inventor_id',
              label: 'Inventor',
              type: 'user',
              role: 'inventor',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['draft', 'searching', 'assessed', 'pursue', 'shelved'],
              required: true,
            },
            {
              name: 'novelty',
              label: 'Novelty',
              type: 'select',
              options: ['unknown', 'high', 'medium', 'low'],
            },
            {
              name: 'summary',
              label: 'Assessment',
              type: 'longtext',
            },
            {
              name: 'assessed_on',
              label: 'Assessed on',
              type: 'date',
            },
          ],
          rows: I.map((i) => ({
            title: i[0],
            description: i[1],
            field: i[2],
            inventor_id: i[3],
            status: i[4],
            novelty: i[5],
            summary: i[6],
            assessed_on: i[7],
          })),
        },
        {
          name: 'prior_work',
          label: 'Prior work',
          one: 'Piece of prior work',
          title: 'title',
          owner: null,
          columns: [
            {
              name: 'idea_id',
              label: 'Idea',
              type: 'ref',
              ref: 'ideas',
              required: true,
            },
            {
              name: 'title',
              label: 'Title',
              type: 'text',
              required: true,
            },
            {
              name: 'source',
              label: 'Found in',
              type: 'select',
              options: ['patentsview', 'openalex', 'arxiv', 'model_knowledge'],
              labels: {
                patentsview: 'PatentsView',
                openalex: 'OpenAlex',
                arxiv: 'arXiv',
                model_knowledge: 'Model knowledge',
              },
              required: true,
            },
            {
              name: 'kind',
              label: 'Kind',
              type: 'select',
              options: ['patent', 'paper', 'preprint'],
            },
            {
              name: 'year',
              label: 'Year',
              type: 'number',
            },
            {
              name: 'overlap',
              label: 'Overlap',
              type: 'select',
              options: ['high', 'medium', 'low'],
              required: true,
            },
            {
              name: 'note',
              label: 'Note',
              type: 'longtext',
            },
            {
              name: 'ref_code',
              label: 'Reference',
              type: 'text',
            },
          ],
          rows: W.map((w) => ({
            idea_id: w[0],
            title: w[1],
            source: w[2],
            kind: w[3],
            year: w[4],
            overlap: w[5],
            note: SAMPLE_PW,
            ref_code: 'SAMPLE-' + w[6],
          })),
        },
        {
          name: 'findings',
          label: 'Findings',
          one: 'Finding',
          title: 'point',
          owner: null,
          columns: [
            {
              name: 'idea_id',
              label: 'Idea',
              type: 'ref',
              ref: 'ideas',
              required: true,
            },
            {
              name: 'point',
              label: 'Point',
              type: 'text',
              required: true,
            },
            {
              name: 'kind',
              label: 'Kind',
              type: 'select',
              options: ['overlap', 'difference', 'risk', 'next_step'],
              required: true,
            },
            {
              name: 'severity',
              label: 'Weight',
              type: 'select',
              options: ['high', 'medium', 'low'],
            },
            {
              name: 'prior_work_id',
              label: 'Based on',
              type: 'ref',
              ref: 'prior_work',
            },
            {
              name: 'detail',
              label: 'Detail',
              type: 'longtext',
            },
          ],
          rows: F.map((f) => ({
            idea_id: f[0],
            point: f[1],
            kind: f[2],
            severity: f[3],
            prior_work_id: f[4],
          })),
        },
      ],
      users: [
        {
          name: 'Areeba Nasir',
          role: 'inventor',
        },
        {
          name: 'Talha Yousaf',
          role: 'inventor',
        },
        {
          name: 'Rukhsana Iqbal',
          role: 'ip_reviewer',
        },
        {
          name: 'Faisal Dar',
          role: 'partner',
        },
      ],
    };
  },
  backend: () => ({
    status: {
      table: 'ideas',
      column: 'status',
      initial: 'draft',
      states: [
        {
          id: 'draft',
          label: 'Draft',
          tone: 'neutral',
        },
        {
          id: 'searching',
          label: 'Searching',
          tone: 'warning',
        },
        {
          id: 'assessed',
          label: 'Assessed',
          tone: 'info',
        },
        {
          id: 'pursue',
          label: 'Pursue',
          tone: 'success',
        },
        {
          id: 'shelved',
          label: 'Shelved',
          tone: 'neutral',
        },
      ],
      transitions: [
        {
          id: 'start_search',
          label: 'Start the search',
          from: ['draft'],
          to: 'searching',
          roles: ['inventor', 'ip_reviewer'],
        },
        {
          id: 'finish_search',
          label: 'Finish the assessment',
          from: ['searching'],
          to: 'assessed',
          roles: ['inventor', 'ip_reviewer'],
        },
        {
          id: 'pursue',
          label: 'Pursue',
          from: ['assessed'],
          to: 'pursue',
          roles: ['ip_reviewer'],
        },
        {
          id: 'shelve',
          label: 'Shelve',
          from: ['assessed'],
          to: 'shelved',
          roles: ['ip_reviewer'],
        },
        {
          id: 'reopen',
          label: 'Reopen',
          from: ['shelved'],
          to: 'draft',
          roles: ['ip_reviewer'],
        },
      ],
    },
    access: [
      {
        table: 'ideas',
        role: 'inventor',
        list: 'own',
        create: true,
        update: 'own',
        delete: false,
      },
      {
        table: 'ideas',
        role: 'ip_reviewer',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'ideas',
        role: 'partner',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
    ].concat(
      everyone('prior_work', ['inventor', 'ip_reviewer', 'partner'], ['inventor', 'ip_reviewer'], 'ip_reviewer'),
      everyone('findings', ['inventor', 'ip_reviewer', 'partner'], ['inventor', 'ip_reviewer'], 'ip_reviewer'),
    ),
    team: {
      title: 'Prior-art team',
      about: "Three agents weigh one idea against earlier work. Each one writes to this app's own tables.",
      input: {
        table: 'ideas',
        column: 'description',
      },
      start: 'start_search',
      done: 'finish_search',
      agents: [
        {
          id: 'search',
          name: 'Search',
          icon: 'search',
          acc: 'royalBlue',
          job: 'Searches patents, papers and preprints for work that is close to the idea.',
          writes: 'prior_work',
          tools: [
            {
              connector: 'patentsview',
              tool: 'search_patents',
            },
            {
              connector: 'openalex',
              tool: 'search_works',
            },
            {
              connector: 'arxiv',
              tool: 'query',
            },
          ],
          proto:
            'This page cannot reach other hosts, so no search results are attached. Describe the kinds of earlier work you would expect to find, set "source" to "model_knowledge", leave "ref_code" and "year" empty, and do not name real patents, papers, companies or authors.',
        },
        {
          id: 'analyst',
          name: 'Analyst',
          icon: 'scales',
          acc: 'teal',
          job: 'Compares the idea with each piece of prior work and records what overlaps and what is different.',
          hint: 'Use kind "overlap" or "difference", and set "prior_work_id" to the record the point is about.',
          writes: 'findings',
        },
        {
          id: 'critic',
          name: 'Critic',
          icon: 'warning',
          acc: 'cranberry',
          job: 'Challenges the analysis, names the risks and the next steps, and rates how new the idea is.',
          hint: 'Use kind "risk" or "next_step".',
          writes: 'findings',
          sets: ['novelty', 'summary', 'assessed_on'],
        },
      ],
      samples: casesOf('priorart').map((c) => ({
        label: c.label,
        values: c.values,
      })),
    },
  }),
  views: () => ({
    views: [
      {
        table: 'ideas',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'Ideas move from draft to a decision.',
          },
          {
            type: 'table',
            why: 'For sorting by novelty and date.',
          },
          {
            type: 'cards',
            why: 'An idea is a paragraph of text, which reads better on a card.',
          },
          {
            type: 'chart',
            x: 'field',
            split: 'novelty',
            why: 'Which fields produce the newest ideas.',
          },
          {
            type: 'pivot',
            rows: 'field',
            cols: 'status',
            why: 'Field against status.',
          },
          {
            type: 'calendar',
            date: 'assessed_on',
            why: 'When each idea was assessed.',
          },
        ],
      },
      {
        table: 'prior_work',
        use: [
          {
            type: 'table',
            why: 'Title, source, year and overlap side by side.',
          },
          {
            type: 'pivot',
            rows: 'source',
            cols: 'overlap',
            why: 'Where the close matches come from.',
          },
          {
            type: 'board',
            by: 'overlap',
            why: 'A reviewer can correct an overlap rating by moving the card.',
          },
          {
            type: 'chart',
            x: 'overlap',
            split: 'source',
            why: 'How much close work there is.',
          },
          {
            type: 'tree',
            levels: ['idea_id', 'overlap'],
            why: 'Prior work nested under its idea.',
          },
          {
            type: 'cards',
            why: 'One card per record.',
          },
        ],
      },
      {
        table: 'findings',
        use: [
          {
            type: 'tree',
            levels: ['idea_id', 'kind'],
            why: 'Findings belong to an idea, then split into overlaps, differences, risks and next steps.',
          },
          {
            type: 'board',
            by: 'kind',
            why: 'The four kinds of finding as columns.',
          },
          {
            type: 'table',
            why: 'Everything in one list.',
          },
          {
            type: 'pivot',
            rows: 'kind',
            cols: 'severity',
            why: 'Kind against weight.',
          },
          {
            type: 'chart',
            x: 'kind',
            split: 'severity',
            why: 'How heavy the risks are.',
          },
        ],
      },
    ],
    board: {
      why: "The question is how close each earlier work comes, so the room ranks prior work by overlap, puts the Analyst's points under each record, and keeps risks and next steps apart.",
      verdict: {
        pick: 'novelty',
        text: 'summary',
        date: 'assessed_on',
      },
      panels: [
        {
          table: 'prior_work',
          layout: 'list',
          title: 'Earlier work, closest first',
          rank: 'overlap',
          badge: 'kind',
          text: 'note',
          tag: 'source',
          facts: ['year'],
          children: {
            table: 'findings',
            via: 'prior_work_id',
            by: 'kind',
            only: ['overlap', 'difference'],
            badge: 'kind',
            text: 'detail',
          },
        },
        {
          table: 'findings',
          layout: 'groups',
          title: 'Risks and next steps',
          by: 'kind',
          only: ['risk', 'next_step'],
          text: 'detail',
        },
      ],
    },
    dashboard: {
      title: 'Portfolio overview',
      date: {
        table: 'ideas',
        column: 'assessed_on',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Ideas',
          table: 'ideas',
        },
        {
          kind: 'kpi',
          label: 'Worth pursuing',
          table: 'ideas',
          where: {
            status: 'pursue',
          },
        },
        {
          kind: 'kpi',
          label: 'Prior work found',
          table: 'prior_work',
        },
        {
          kind: 'kpi',
          label: 'High overlap',
          table: 'prior_work',
          where: {
            overlap: 'high',
          },
        },
        {
          kind: 'bar',
          label: 'Ideas by status',
          table: 'ideas',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Prior work by source and overlap',
          table: 'prior_work',
          x: 'source',
          split: 'overlap',
        },
        {
          kind: 'line',
          label: 'Ideas assessed per week',
          table: 'ideas',
          x: 'assessed_on',
          bucket: 'week',
        },
        {
          kind: 'bar',
          label: 'Findings by kind',
          table: 'findings',
          x: 'kind',
        },
        {
          kind: 'recent',
          label: 'Latest ideas',
          table: 'ideas',
        },
      ],
    },
  }),
  ui: () => ({
    theme: {
      accent: 'royalBlue',
      nav: 'rail',
      icon: 'lightbulb',
    },
    screens: [
      {
        name: 'Scout room',
        type: 'agents',
        table: 'ideas',
        roles: ['inventor', 'ip_reviewer'],
        icon: 'bot',
      },
      {
        name: 'Ideas',
        type: 'board',
        table: 'ideas',
        roles: ['inventor', 'ip_reviewer', 'partner'],
        group: 'status',
        columns: ['field', 'inventor_id', 'novelty', 'assessed_on'],
        icon: 'lightbulb',
      },
      {
        name: 'Prior work',
        type: 'table',
        table: 'prior_work',
        roles: ['inventor', 'ip_reviewer', 'partner'],
        columns: ['title', 'source', 'kind', 'year', 'overlap', 'idea_id'],
        icon: 'library',
      },
      {
        name: 'Overlap map',
        type: 'pivot',
        table: 'prior_work',
        roles: ['ip_reviewer', 'partner'],
        columns: ['title', 'source', 'overlap', 'idea_id'],
        icon: 'grid',
      },
      {
        name: 'Findings',
        type: 'tree',
        table: 'findings',
        roles: ['inventor', 'ip_reviewer', 'partner'],
        columns: ['point', 'kind', 'severity', 'idea_id'],
        icon: 'branch',
      },
    ],
    tour: [
      {
        role: 'inventor',
        do: 'create',
        table: 'ideas',
        values: {
          title: 'Foldable crate with a built-in weight tag',
          description: 'A returnable crate that folds flat and reports its own weight when it is scanned at the dock.',
          field: 'logistics',
        },
        say: 'Areeba, an inventor, describes a new idea.',
      },
      {
        role: 'ip_reviewer',
        do: 'see',
        table: 'ideas',
        screen: 'Ideas',
        say: 'Rukhsana, the IP reviewer, finds it on the board.',
      },
      {
        role: 'inventor',
        do: 'transition',
        table: 'ideas',
        transition: 'start_search',
        say: 'Areeba starts the search. In the scout room the three agents take it from here.',
      },
      {
        role: 'inventor',
        do: 'transition',
        table: 'ideas',
        transition: 'finish_search',
        say: 'The assessment is finished and waits for a decision.',
      },
      {
        role: 'inventor',
        do: 'denied',
        table: 'ideas',
        action: 'pursue',
        say: "Areeba tries to mark her own idea as worth pursuing. The backend refuses, because that is the reviewer's call.",
      },
      {
        role: 'ip_reviewer',
        do: 'transition',
        table: 'ideas',
        transition: 'pursue',
        say: 'Rukhsana decides to pursue it.',
      },
      {
        role: 'partner',
        do: 'denied',
        table: 'findings',
        action: 'create',
        say: 'Faisal, a partner, tries to add a finding. The backend refuses.',
      },
    ],
  }),
  cases: [
    {
      label: 'Smart bottle cap',
      values: {
        title: 'Bottle cap that tracks intake by weight',
        description:
          'A replacement cap with a small load sensor. It weighs the bottle each time it is put down, works out how much was drunk and reminds the user through a phone app.',
        field: 'health_tech',
      },
      script: [
        {
          agent: 'search',
          say: 'Three searches, one per source. Sensor bottles are well covered. Weighing at rest is rarer.',
          tools: [
            [
              'patentsview',
              'search_patents',
              {
                q: 'bottle cap hydration sensor',
              },
            ],
            [
              'openalex',
              'search_works',
              {
                search: 'smart water bottle fluid intake monitoring',
              },
            ],
            [
              'arxiv',
              'query',
              {
                search_query: 'all:fluid intake sensing',
              },
            ],
          ],
          rows: [
            {
              title: 'Drinking container with a sensor for measuring liquid consumed',
              source: 'patentsview',
              kind: 'patent',
              year: 2016,
              overlap: 'high',
              note: SAMPLE_PW + ' Covers a bottle with a built-in level sensor and a phone link.',
              ref_code: 'SAMPLE-P-11',
            },
            {
              title: 'Smart bottles for tracking fluid intake in older adults',
              source: 'openalex',
              kind: 'paper',
              year: 2020,
              overlap: 'medium',
              note: SAMPLE_PW + ' Compares sensing methods and reports errors when a bottle is refilled.',
              ref_code: 'SAMPLE-W-12',
            },
            {
              title: 'Recognising drinking gestures from wrist motion',
              source: 'arxiv',
              kind: 'preprint',
              year: 2021,
              overlap: 'low',
              note: SAMPLE_PW + ' Detects sips from a wristband, with no sensor on the bottle.',
              ref_code: 'SAMPLE-A-13',
            },
          ],
        },
        {
          agent: 'analyst',
          say: 'One clear overlap and two real differences.',
          rows: [
            {
              point: 'A sensor bottle with a phone app is already described',
              kind: 'overlap',
              severity: 'high',
              prior_work_id: 1,
              detail: 'The earlier work covers measuring what was drunk and sending it to a phone.',
            },
            {
              point: 'Weighing the bottle at rest is different from measuring the level',
              kind: 'difference',
              severity: 'medium',
              prior_work_id: 1,
              detail: 'The earlier work senses the liquid level inside the container.',
            },
            {
              point: 'A cap that fits bottles people already own is a retrofit',
              kind: 'difference',
              severity: 'medium',
              prior_work_id: 2,
              detail: 'The products in the study are whole bottles.',
            },
          ],
        },
        {
          agent: 'critic',
          say: 'The broad idea is taken. The narrow version, a retrofit cap that weighs, deserves a focused search before any money is spent.',
          rows: [
            {
              point: 'Refills and top-ups will confuse a weight-only reading',
              kind: 'risk',
              severity: 'high',
              prior_work_id: 2,
              detail: 'The study reports exactly this error for other sensing methods.',
            },
            {
              point: 'Search claims for retrofit caps before building a prototype',
              kind: 'next_step',
              severity: 'medium',
            },
          ],
          summary: {
            novelty: 'medium',
            summary:
              'The broad idea is covered. A retrofit cap that weighs the bottle at rest looks less crowded and is worth a focused search.',
            assessed_on: 0,
          },
        },
      ],
    },
    {
      label: 'Solar kiosk',
      values: {
        title: 'Pay-as-you-go solar kiosk with battery swapping',
        description:
          'A roadside kiosk with solar panels where riders swap an empty e-bike battery for a charged one and pay per swap by phone.',
        field: 'energy',
      },
      script: [
        {
          agent: 'search',
          say: 'Battery swapping and pay-as-you-go solar are both busy areas.',
          tools: [
            [
              'patentsview',
              'search_patents',
              {
                q: 'battery swap station solar',
              },
            ],
            [
              'openalex',
              'search_works',
              {
                search: 'pay-as-you-go solar battery swapping',
              },
            ],
          ],
          rows: [
            {
              title: 'Battery exchange station for light electric vehicles',
              source: 'patentsview',
              kind: 'patent',
              year: 2019,
              overlap: 'high',
              note: SAMPLE_PW,
              ref_code: 'SAMPLE-P-21',
            },
            {
              title: 'Pay-as-you-go models for off-grid solar',
              source: 'openalex',
              kind: 'paper',
              year: 2018,
              overlap: 'medium',
              note: SAMPLE_PW,
              ref_code: 'SAMPLE-W-22',
            },
          ],
        },
        {
          agent: 'analyst',
          say: 'Each half exists. The combination in one unattended kiosk is the only gap.',
          rows: [
            {
              point: 'Swap stations for small vehicles are already described',
              kind: 'overlap',
              severity: 'high',
              prior_work_id: 1,
            },
            {
              point: 'Paying per swap by phone follows known pay-as-you-go models',
              kind: 'overlap',
              severity: 'medium',
              prior_work_id: 2,
            },
            {
              point: 'An unattended kiosk that charges only from its own panels is narrower',
              kind: 'difference',
              severity: 'low',
              prior_work_id: 1,
            },
          ],
        },
        {
          agent: 'critic',
          say: 'Combining two known things is rarely enough. I rate the novelty low.',
          rows: [
            {
              point: 'A combination of known parts is hard to protect',
              kind: 'risk',
              severity: 'high',
            },
            {
              point: 'Look for something new in how the kiosk balances charging',
              kind: 'next_step',
              severity: 'medium',
            },
          ],
          summary: {
            novelty: 'low',
            summary: 'Both halves of the idea are established. Unless the charging control is new, there is little to protect.',
            assessed_on: 0,
          },
        },
      ],
    },
    {
      label: 'Returnable packaging',
      values: {
        title: 'Returnable packaging tracked by QR for small shops',
        description:
          'Reusable boxes with a QR code. Shops scan them out and in, customers get a deposit back, and the system tells the shop which boxes are overdue.',
        field: 'retail',
      },
      script: [
        {
          agent: 'search',
          say: 'Deposit systems are old. QR tracking for small shops shows up mostly in papers.',
          tools: [
            [
              'patentsview',
              'search_patents',
              {
                q: 'reusable packaging deposit tracking',
              },
            ],
            [
              'openalex',
              'search_works',
              {
                search: 'reusable packaging tracking small retailers',
              },
            ],
          ],
          rows: [
            {
              title: 'Deposit handling for reusable containers',
              source: 'patentsview',
              kind: 'patent',
              year: 2015,
              overlap: 'medium',
              note: SAMPLE_PW,
              ref_code: 'SAMPLE-P-31',
            },
            {
              title: 'Tracking reusable packaging with printed codes',
              source: 'openalex',
              kind: 'paper',
              year: 2022,
              overlap: 'high',
              note: SAMPLE_PW,
              ref_code: 'SAMPLE-W-32',
            },
          ],
        },
        {
          agent: 'analyst',
          say: 'The tracking is described. The overdue reminder for shops is a small difference.',
          rows: [
            {
              point: 'Scanning reusable boxes in and out is already described',
              kind: 'overlap',
              severity: 'high',
              prior_work_id: 2,
            },
            {
              point: 'Telling the shop which boxes are overdue is a modest addition',
              kind: 'difference',
              severity: 'low',
              prior_work_id: 2,
            },
          ],
        },
        {
          agent: 'critic',
          say: 'This is a good business more than an invention.',
          rows: [
            {
              point: 'Little here is new enough to protect',
              kind: 'risk',
              severity: 'medium',
            },
            {
              point: 'Treat it as a product and move fast instead of filing',
              kind: 'next_step',
              severity: 'medium',
            },
          ],
          summary: {
            novelty: 'low',
            summary: 'Well covered by earlier work. Better pursued as a product than as a filing.',
            assessed_on: 0,
          },
        },
      ],
    },
  ],
};
REC.debate = {
  id: 'debate',
  quest: 3,
  title: 'Debate partner',
  icon: 'scales',
  accent: 'grape',
  agents: ['For', 'Against', 'Moderator'],
  sentence:
    'A team raises a motion before a decision. One agent argues for it, one argues against it, anyone can jump in, and a moderator records what is agreed and what is still open.',
  blurb: 'For, Against and a Moderator argue a motion, and you can jump in.',
  keys: ['debate', 'argue', 'motion', 'devil', 'skeptic', 'second opinion', 'decision'],
  usage: {
    research: [1180, 570, 5700],
    database: [2390, 2870, 14100],
    backend: [3460, 1340, 9500],
    views: [2660, 1180, 8100],
    ui: [4090, 1350, 9700],
  },
  say: {
    research: [
      'Reading the request. Two agents argue and a third sums up, so the records are debates, arguments and takeaways.',
      'Three roles, three kinds of record, one process on debates.',
    ],
    database: [
      'Creating tables for debates, arguments and takeaways. An argument can answer another argument, so the table links to itself.',
    ],
    backend: [
      'Writing the workflow, the access rules and the team: For, Against and a Moderator. The run pauses before the Moderator so a person can add a point.',
    ],
    views: [
      'Arguments answer each other, so they form a real tree of parents and replies. A board by side shows the balance at a glance.',
      'The dashboard shows where debates stand and how strong each side was.',
      "For the agents' room I put For and Against face to face, with the Moderator's notes underneath.",
    ],
    ui: [
      'Laying out the pages: a debate room where the agents run, a board of debates, the arguments as a tree and the takeaways as cards. Purple, top navigation.',
    ],
  },
  research: () => ({
    name: 'Second Opinion',
    summary: 'A team raises a motion, two agents argue both sides, anyone can jump in, and a moderator records the outcome.',
    roles: [
      {
        id: 'member',
        name: 'Team member',
        can: 'Raises a motion, runs the debate and adds points',
      },
      {
        id: 'facilitator',
        name: 'Facilitator',
        can: 'Records the decision, parks or reopens a debate',
      },
      {
        id: 'observer',
        name: 'Observer',
        can: 'Reads debates',
      },
    ],
    entities: [
      {
        name: 'debates',
        what: 'A motion the team wants argued before deciding',
      },
      {
        name: 'arguments',
        what: 'One point for or against, or from the floor',
      },
      {
        name: 'takeaways',
        what: 'What the moderator recorded: agreed, open, a risk or a recommendation',
      },
    ],
    process: {
      entity: 'debates',
      states: ['open', 'debating', 'summed_up', 'decided', 'parked'],
      note: 'The agents take a debate from open to summed up. A facilitator records the decision.',
    },
    stories: [
      {
        role: 'member',
        want: 'hear the strongest case against my own proposal',
        so: 'I find the holes before the meeting does',
      },
      {
        role: 'member',
        want: 'add my own point while the agents argue',
        so: 'the summary includes what only we know',
      },
      {
        role: 'facilitator',
        want: 'record the decision once the debate is summed up',
        so: 'there is one place to look later',
      },
      {
        role: 'observer',
        want: 'read past debates',
        so: 'I understand why things were decided',
      },
    ],
    rules: ['Only a facilitator records a decision', 'Observers cannot change anything', 'People can only edit their own arguments'],
    question: null,
  }),
  database: () => {
    const D = [
      [
        'Rewrite the billing service instead of refactoring it',
        'The service is eight years old, has few tests, and every change takes weeks.',
        'engineering',
        1,
        'decided',
        'against',
        'Refactor behind tests first. Look at a rewrite again only if the data model blocks the next two features.',
        -8,
      ],
      [
        'Replace the weekly status meeting with a written update',
        'The meeting takes an hour for twelve people and most of it is read-outs.',
        'process',
        2,
        'summed_up',
        'for',
        'Try written updates for a month and keep a short call for blockers.',
        -3,
      ],
      [
        'Use TypeScript for all new front-end work',
        'Half the team knows it well. The other half has never used it.',
        'engineering',
        1,
        'parked',
        'split',
        'No clear lean. Parked until the design system work is finished.',
        -12,
      ],
      [casesOf('debate')[0].values.motion, casesOf('debate')[0].values.context, 'engineering', 2, 'open', 'undecided', null, null],
    ];
    const A = [
      [1, 'for', 'A clean design removes years of workarounds', 'strong', null],
      [1, 'for', 'New hires cannot read the current code', 'moderate', null],
      [1, 'against', 'A rewrite freezes features for months while the old system still needs fixes', 'strong', 1],
      [1, 'against', 'Tests and small refactors also make code readable', 'moderate', 2],
      [1, 'floor', 'Billing mistakes cost real money, so the risk of the move matters most', 'strong', 3],
      [2, 'for', 'Written updates can be read in five minutes', 'strong', null],
      [2, 'against', 'Blockers surface faster when people talk', 'moderate', 6],
      [2, 'for', 'A short call can stay for blockers only', 'moderate', 7],
      [3, 'for', 'Types catch mistakes before review', 'strong', null],
      [3, 'against', 'Half the team would be slower for a quarter', 'strong', 9],
    ];
    const T = [
      [1, 'agreed', 'The lack of tests is the real blocker'],
      [1, 'recommendation', 'Write tests around current behaviour, then refactor the invoice module first'],
      [1, 'risk', 'A rewrite means running two billing systems side by side'],
      [1, 'open_question', 'Does the data model block multi-currency?'],
      [2, 'agreed', 'Most of the meeting is read-outs'],
      [2, 'recommendation', 'Written updates for a month, with a fifteen-minute call for blockers'],
      [3, 'open_question', 'Who would train the half of the team that is new to it?'],
    ];
    return {
      tables: [
        {
          name: 'debates',
          label: 'Debates',
          one: 'Debate',
          title: 'motion',
          owner: 'raised_by',
          columns: [
            {
              name: 'motion',
              label: 'Motion',
              type: 'text',
              required: true,
            },
            {
              name: 'context',
              label: 'Context',
              type: 'longtext',
              required: true,
            },
            {
              name: 'topic',
              label: 'Topic',
              type: 'select',
              options: ['engineering', 'product', 'people', 'process'],
            },
            {
              name: 'raised_by',
              label: 'Raised by',
              type: 'user',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['open', 'debating', 'summed_up', 'decided', 'parked'],
              required: true,
            },
            {
              name: 'leaning',
              label: 'Leaning',
              type: 'select',
              options: ['undecided', 'for', 'against', 'split'],
            },
            {
              name: 'summary',
              label: 'Summary',
              type: 'longtext',
            },
            {
              name: 'debated_on',
              label: 'Debated on',
              type: 'date',
            },
          ],
          rows: D.map((d) => ({
            motion: d[0],
            context: d[1],
            topic: d[2],
            raised_by: d[3],
            status: d[4],
            leaning: d[5],
            summary: d[6],
            debated_on: d[7],
          })),
        },
        {
          name: 'arguments',
          label: 'Arguments',
          one: 'Argument',
          title: 'point',
          owner: null,
          columns: [
            {
              name: 'debate_id',
              label: 'Debate',
              type: 'ref',
              ref: 'debates',
              required: true,
            },
            {
              name: 'side',
              label: 'Side',
              type: 'select',
              options: ['for', 'against', 'floor'],
              required: true,
            },
            {
              name: 'point',
              label: 'Point',
              type: 'text',
              required: true,
            },
            {
              name: 'detail',
              label: 'Detail',
              type: 'longtext',
            },
            {
              name: 'strength',
              label: 'Strength',
              type: 'select',
              options: ['strong', 'moderate', 'weak'],
            },
            {
              name: 'reply_to',
              label: 'Answers',
              type: 'ref',
              ref: 'arguments',
            },
          ],
          rows: A.map((a) => ({
            debate_id: a[0],
            side: a[1],
            point: a[2],
            strength: a[3],
            reply_to: a[4],
          })),
        },
        {
          name: 'takeaways',
          label: 'Takeaways',
          one: 'Takeaway',
          title: 'text',
          owner: null,
          columns: [
            {
              name: 'debate_id',
              label: 'Debate',
              type: 'ref',
              ref: 'debates',
              required: true,
            },
            {
              name: 'kind',
              label: 'Kind',
              type: 'select',
              options: ['agreed', 'recommendation', 'risk', 'open_question'],
              required: true,
            },
            {
              name: 'text',
              label: 'Takeaway',
              type: 'text',
              required: true,
            },
            {
              name: 'detail',
              label: 'Detail',
              type: 'longtext',
            },
          ],
          rows: T.map((t) => ({
            debate_id: t[0],
            kind: t[1],
            text: t[2],
          })),
        },
      ],
      users: [
        {
          name: 'Maryam Sheikh',
          role: 'member',
        },
        {
          name: 'Ahsan Javaid',
          role: 'member',
        },
        {
          name: 'Nida Rehman',
          role: 'facilitator',
        },
        {
          name: 'Bilal Awan',
          role: 'observer',
        },
      ],
    };
  },
  backend: () => ({
    status: {
      table: 'debates',
      column: 'status',
      initial: 'open',
      states: [
        {
          id: 'open',
          label: 'Open',
          tone: 'neutral',
        },
        {
          id: 'debating',
          label: 'Debating',
          tone: 'warning',
        },
        {
          id: 'summed_up',
          label: 'Summed up',
          tone: 'info',
        },
        {
          id: 'decided',
          label: 'Decided',
          tone: 'success',
        },
        {
          id: 'parked',
          label: 'Parked',
          tone: 'neutral',
        },
      ],
      transitions: [
        {
          id: 'start_debate',
          label: 'Start the debate',
          from: ['open'],
          to: 'debating',
          roles: ['member', 'facilitator'],
        },
        {
          id: 'sum_up',
          label: 'Sum up',
          from: ['debating'],
          to: 'summed_up',
          roles: ['member', 'facilitator'],
        },
        {
          id: 'decide',
          label: 'Record the decision',
          from: ['summed_up'],
          to: 'decided',
          roles: ['facilitator'],
        },
        {
          id: 'park',
          label: 'Park',
          from: ['open', 'summed_up'],
          to: 'parked',
          roles: ['facilitator'],
        },
        {
          id: 'reopen',
          label: 'Reopen',
          from: ['parked', 'decided'],
          to: 'open',
          roles: ['facilitator'],
        },
      ],
    },
    access: ([] as AccessRule[]).concat(
      everyone('debates', ['member', 'facilitator', 'observer'], ['member', 'facilitator'], 'facilitator'),
      [
        {
          table: 'arguments',
          role: 'member',
          list: 'all',
          create: true,
          update: 'own',
          delete: false,
        },
        {
          table: 'arguments',
          role: 'facilitator',
          list: 'all',
          create: true,
          update: 'all',
          delete: true,
        },
        {
          table: 'arguments',
          role: 'observer',
          list: 'all',
          create: false,
          update: 'none',
          delete: false,
        },
      ],
      [
        {
          table: 'takeaways',
          role: 'member',
          list: 'all',
          create: true,
          update: 'none',
          delete: false,
        },
        {
          table: 'takeaways',
          role: 'facilitator',
          list: 'all',
          create: true,
          update: 'all',
          delete: true,
        },
        {
          table: 'takeaways',
          role: 'observer',
          list: 'all',
          create: false,
          update: 'none',
          delete: false,
        },
      ],
    ),
    team: {
      title: 'Debate team',
      about: 'Two agents argue one motion from opposite sides and a third sums up. You can add a point of your own before the summary.',
      input: {
        table: 'debates',
        column: 'motion',
      },
      start: 'start_debate',
      done: 'sum_up',
      agents: [
        {
          id: 'for_side',
          name: 'For',
          icon: 'trending',
          acc: 'forest',
          job: 'Makes the strongest honest case for the motion, in three points.',
          writes: 'arguments',
          fixed: {
            side: 'for',
          },
        },
        {
          id: 'against_side',
          name: 'Against',
          icon: 'shield',
          acc: 'cranberry',
          job: 'Makes the strongest honest case against the motion and answers the points made for it.',
          hint: 'Set "reply_to" to the number of the point you are answering.',
          writes: 'arguments',
          fixed: {
            side: 'against',
          },
        },
        {
          id: 'moderator',
          name: 'Moderator',
          icon: 'scales',
          acc: 'royalBlue',
          job: 'Weighs both sides and anything added from the floor, then records what is agreed, what is open, the risks and one recommendation.',
          writes: 'takeaways',
          sets: ['leaning', 'summary', 'debated_on'],
        },
      ],
      pause: {
        before: 'moderator',
        text: 'Both sides have spoken. Add a point of your own before the Moderator sums up, or continue.',
      },
      jump: {
        table: 'arguments',
        column: 'point',
        set: {
          side: 'floor',
          strength: 'moderate',
        },
        label: 'Add your own point',
      },
      samples: casesOf('debate').map((c) => ({
        label: c.label,
        values: c.values,
      })),
    },
  }),
  views: () => ({
    views: [
      {
        table: 'debates',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'Debates move from open to decided.',
          },
          {
            type: 'table',
            why: 'For sorting by date and topic.',
          },
          {
            type: 'cards',
            why: 'A motion and its summary read better on a card.',
          },
          {
            type: 'chart',
            x: 'topic',
            split: 'leaning',
            why: 'Which way debates lean, by topic.',
          },
          {
            type: 'pivot',
            rows: 'topic',
            cols: 'leaning',
            why: 'Topic against leaning.',
          },
          {
            type: 'calendar',
            date: 'debated_on',
            why: 'When each debate was held.',
          },
        ],
      },
      {
        table: 'arguments',
        use: [
          {
            type: 'tree',
            levels: ['debate_id', 'side'],
            why: 'Arguments answer each other, so they form a tree of points and replies.',
          },
          {
            type: 'board',
            by: 'side',
            why: 'For, against and the floor side by side.',
          },
          {
            type: 'table',
            why: 'Every point in one list.',
          },
          {
            type: 'chart',
            x: 'side',
            split: 'strength',
            why: 'How strong each side was.',
          },
          {
            type: 'pivot',
            rows: 'debate_id',
            cols: 'side',
            why: 'Points per debate and side.',
          },
          {
            type: 'cards',
            why: 'A card per argument.',
          },
        ],
      },
      {
        table: 'takeaways',
        use: [
          {
            type: 'cards',
            why: 'Takeaways are short statements to read, not rows to scan.',
          },
          {
            type: 'board',
            by: 'kind',
            why: 'Agreed, open, risks and recommendations as columns.',
          },
          {
            type: 'table',
            why: 'Everything in one list.',
          },
          {
            type: 'tree',
            levels: ['debate_id', 'kind'],
            why: 'Takeaways nested under their debate.',
          },
          {
            type: 'chart',
            x: 'kind',
            why: 'How many questions are still open.',
          },
        ],
      },
    ],
    board: {
      why: 'Two agents argue opposite sides, so the room puts their points face to face, shows which answers which, and lists what the Moderator recorded underneath.',
      verdict: {
        pick: 'leaning',
        text: 'summary',
        date: 'debated_on',
      },
      panels: [
        {
          table: 'arguments',
          layout: 'versus',
          title: 'The argument',
          by: 'side',
          sides: ['for', 'against'],
          badge: 'strength',
          reply: 'reply_to',
          text: 'detail',
        },
        {
          table: 'takeaways',
          layout: 'groups',
          title: 'What the Moderator recorded',
          by: 'kind',
        },
      ],
    },
    dashboard: {
      title: 'Debate overview',
      date: {
        table: 'debates',
        column: 'debated_on',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Debates',
          table: 'debates',
        },
        {
          kind: 'kpi',
          label: 'Decided',
          table: 'debates',
          where: {
            status: 'decided',
          },
        },
        {
          kind: 'kpi',
          label: 'Arguments',
          table: 'arguments',
        },
        {
          kind: 'kpi',
          label: 'Open questions',
          table: 'takeaways',
          where: {
            kind: 'open_question',
          },
        },
        {
          kind: 'bar',
          label: 'Debates by status',
          table: 'debates',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Arguments by side and strength',
          table: 'arguments',
          x: 'side',
          split: 'strength',
        },
        {
          kind: 'bar',
          label: 'Takeaways by kind',
          table: 'takeaways',
          x: 'kind',
        },
        {
          kind: 'bar',
          label: 'Debates by leaning',
          table: 'debates',
          x: 'leaning',
        },
        {
          kind: 'recent',
          label: 'Latest debates',
          table: 'debates',
        },
      ],
    },
  }),
  ui: () => ({
    theme: {
      accent: 'grape',
      nav: 'top',
      icon: 'scales',
    },
    screens: [
      {
        name: 'Debate room',
        type: 'agents',
        table: 'debates',
        roles: ['member', 'facilitator'],
        icon: 'bot',
      },
      {
        name: 'Debates',
        type: 'board',
        table: 'debates',
        roles: ['member', 'facilitator', 'observer'],
        group: 'status',
        columns: ['topic', 'raised_by', 'leaning', 'debated_on'],
        icon: 'board',
      },
      {
        name: 'Arguments',
        type: 'tree',
        table: 'arguments',
        roles: ['member', 'facilitator', 'observer'],
        columns: ['point', 'side', 'strength', 'debate_id'],
        icon: 'branch',
      },
      {
        name: 'Takeaways',
        type: 'cards',
        table: 'takeaways',
        roles: ['member', 'facilitator', 'observer'],
        columns: ['text', 'kind', 'debate_id'],
        icon: 'lightbulb',
      },
    ],
    tour: [
      {
        role: 'member',
        do: 'create',
        table: 'debates',
        values: {
          motion: 'Freeze new features for one sprint to pay down bugs',
          context: 'The bug backlog has doubled since spring.',
          topic: 'process',
        },
        say: 'Maryam, a team member, raises a motion.',
      },
      {
        role: 'facilitator',
        do: 'see',
        table: 'debates',
        screen: 'Debates',
        say: 'Nida, the facilitator, finds it on the board.',
      },
      {
        role: 'member',
        do: 'transition',
        table: 'debates',
        transition: 'start_debate',
        say: 'Maryam starts the debate. In the debate room the three agents take it from here.',
      },
      {
        role: 'member',
        do: 'transition',
        table: 'debates',
        transition: 'sum_up',
        say: 'The debate is summed up and waits for a decision.',
      },
      {
        role: 'member',
        do: 'denied',
        table: 'debates',
        action: 'decide',
        say: "Maryam tries to record the decision herself. The backend refuses, because that is the facilitator's job.",
      },
      {
        role: 'facilitator',
        do: 'transition',
        table: 'debates',
        transition: 'decide',
        say: 'Nida records the decision.',
      },
      {
        role: 'observer',
        do: 'denied',
        table: 'arguments',
        action: 'create',
        say: 'Bilal, an observer, tries to add an argument. The backend refuses.',
      },
    ],
  }),
  cases: [
    {
      label: 'One codebase first',
      values: {
        motion: 'Start with one codebase before splitting into services',
        context: 'We are six engineers building a new scheduling product. Two of us want separate services from day one.',
        topic: 'engineering',
      },
      script: [
        {
          agent: 'for_side',
          say: 'Three points for starting with one codebase.',
          rows: [
            {
              point: 'One codebase lets six people ship and change direction quickly',
              detail: 'A single deploy and one test suite keep the feedback loop short while the product is still finding its shape.',
              strength: 'strong',
            },
            {
              point: 'Service boundaries are guesses until real use shows where they are',
              detail: 'Splitting early fixes boundaries before anyone knows which parts change together.',
              strength: 'strong',
            },
            {
              point: 'Running many services costs time a small team does not have',
              detail: 'Each service needs its own pipeline, monitoring and on-call knowledge.',
              strength: 'moderate',
            },
          ],
        },
        {
          agent: 'against_side',
          say: 'I answered each point. The second answer is the strongest.',
          rows: [
            {
              point: 'One codebase tangles quickly unless module boundaries are enforced',
              detail: 'Without rules, every module ends up reaching into every other.',
              strength: 'moderate',
              reply_to: 1,
            },
            {
              point: 'Splitting later is expensive once every feature shares the same tables',
              detail: 'The cost of a late split is in the data, not in the code.',
              strength: 'strong',
              reply_to: 2,
            },
            {
              point: 'The scheduler has to scale on its own, apart from the web app',
              detail: 'Its load follows the number of jobs, not the number of visitors.',
              strength: 'moderate',
              reply_to: 3,
            },
          ],
        },
        {
          agent: 'moderator',
          say: 'Both sides agree that boundaries matter more than deployment. I lean for the motion, with conditions.',
          rows: [
            {
              kind: 'agreed',
              text: 'Boundaries matter more than how the code is deployed',
            },
            {
              kind: 'recommendation',
              text: 'One codebase with strict modules, and the scheduler behind its own queue',
            },
            {
              kind: 'risk',
              text: 'Shared tables will make a later split costly',
            },
            {
              kind: 'open_question',
              text: 'What load would justify running the scheduler as its own service?',
            },
          ],
          jumped: {
            say: 'I also recorded the point from the floor.',
            rows: [
              {
                kind: 'open_question',
                text: 'From the floor: {{jump}}',
              },
            ],
          },
          summary: {
            leaning: 'for',
            summary:
              'For, with conditions. One codebase now, strict module boundaries, and the scheduler isolated behind a queue so it can move out later.',
            debated_on: 0,
          },
        },
      ],
    },
    {
      label: 'A free tier',
      values: {
        motion: 'Offer a free tier for the scheduling product',
        context: 'Sign-ups are slow and every trial needs a sales call. Support is two people.',
        topic: 'product',
      },
      script: [
        {
          agent: 'for_side',
          say: 'Three points for a free tier.',
          rows: [
            {
              point: 'People can try the product without waiting for a sales call',
              strength: 'strong',
            },
            {
              point: 'Free users bring colleagues, which is cheaper than advertising',
              strength: 'moderate',
            },
            {
              point: 'Real usage shows which features people would pay for',
              strength: 'moderate',
            },
          ],
        },
        {
          agent: 'against_side',
          say: 'The support load is the weak spot in the case for.',
          rows: [
            {
              point: 'Two support people cannot carry thousands of free accounts',
              strength: 'strong',
              reply_to: 1,
            },
            {
              point: 'Free users rarely invite paying teams unless the limits are well chosen',
              strength: 'moderate',
              reply_to: 2,
            },
            {
              point: 'Usage from people who will never pay can mislead the roadmap',
              strength: 'weak',
              reply_to: 3,
            },
          ],
        },
        {
          agent: 'moderator',
          say: 'The disagreement is about support, not about the idea. I lean for a limited version.',
          rows: [
            {
              kind: 'agreed',
              text: 'The sales call is what slows sign-ups',
            },
            {
              kind: 'recommendation',
              text: 'A free tier with one calendar and community support only',
            },
            {
              kind: 'risk',
              text: 'Support load, unless free accounts are kept out of the queue',
            },
            {
              kind: 'open_question',
              text: 'Which limit would make a team upgrade?',
            },
          ],
          jumped: {
            say: 'I also recorded the point from the floor.',
            rows: [
              {
                kind: 'open_question',
                text: 'From the floor: {{jump}}',
              },
            ],
          },
          summary: {
            leaning: 'for',
            summary: 'For a limited free tier: one calendar, no support queue, and a clear upgrade limit.',
            debated_on: 0,
          },
        },
      ],
    },
    {
      label: 'Support shifts',
      values: {
        motion: 'Every engineer takes a support shift once a quarter',
        context: 'Engineers rarely see customer problems first hand. Support says the same bugs keep coming back.',
        topic: 'people',
      },
      script: [
        {
          agent: 'for_side',
          say: 'Three points for support shifts.',
          rows: [
            {
              point: 'Engineers who see the problems fix the causes, not the symptoms',
              strength: 'strong',
            },
            {
              point: 'Support gets relief and a direct line to the people who can fix things',
              strength: 'moderate',
            },
            {
              point: 'One day a quarter is a small cost',
              strength: 'weak',
            },
          ],
        },
        {
          agent: 'against_side',
          say: 'The cost is larger than a day, and customers feel an untrained agent.',
          rows: [
            {
              point: 'An untrained engineer gives slower and worse answers to customers',
              strength: 'strong',
              reply_to: 2,
            },
            {
              point: 'The real cost includes training and the lost focus around the shift',
              strength: 'moderate',
              reply_to: 3,
            },
            {
              point: 'Reading ticket summaries each week would teach the same lesson',
              strength: 'moderate',
              reply_to: 1,
            },
          ],
        },
        {
          agent: 'moderator',
          say: 'Both sides want engineers closer to customers. They differ on how. I call it split.',
          rows: [
            {
              kind: 'agreed',
              text: 'Engineers should see customer problems first hand',
            },
            {
              kind: 'recommendation',
              text: 'Try shadowing first: engineers sit with support for a shift without answering tickets',
            },
            {
              kind: 'risk',
              text: 'Customer answers get worse if engineers handle tickets alone',
            },
            {
              kind: 'open_question',
              text: 'Would a weekly ticket review be enough?',
            },
          ],
          jumped: {
            say: 'I also recorded the point from the floor.',
            rows: [
              {
                kind: 'open_question',
                text: 'From the floor: {{jump}}',
              },
            ],
          },
          summary: {
            leaning: 'split',
            summary: 'Split. Start with shadowing for one quarter, then decide whether full shifts are worth it.',
            debated_on: 0,
          },
        },
      ],
    },
  ],
};
export const QUESTS = ['factcheck', 'priorart', 'debate'];
