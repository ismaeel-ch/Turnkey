import { REC } from './registry';
import type { AccessRule, Dict, SavedCase } from '@/shared/types/workspace';

/* ===== Turnkey · more saved builds for the Home page =====
   Two more business apps that Demo mode can replay with no model: a grant review desk that runs its own team of
   three agents and waits for the board chair's approval, and purchase requests with a two-step approval. They are
   shown on Home under "Business apps" and are not offered in onboarding, which keeps its short list. All people,
   organisations and amounts are made up. */
export const MORE_TEMPLATES = ['grants', 'purchasing'];

// Every role sees every record of a table; only the roles in `write` change them, and only `boss` deletes.
const readAll = (table: string, roles: string[], write: string[], boss: string): AccessRule[] =>
  roles.map((r) => ({
    table,
    role: r,
    list: 'all',
    create: write.includes(r),
    update: write.includes(r) ? 'all' : 'none',
    delete: r === boss,
  }));

/* ---------- Grant review desk: an app with its own team of agents and an approval step ---------- */
// The desk's first two applications are its saved cases, which come later in the same object.
const grantCases = (): SavedCase[] => REC.grants.cases || [];
REC.grants = {
  id: 'grants',
  title: 'Grant review desk',
  icon: 'heart',
  accent: 'magenta',
  agents: ['Assessor', 'Budget reviewer', 'Due diligence'],
  sentence:
    'A community foundation reviews grant applications: programme officers record each one, three agents score it, size the award and check it, the board chair approves every grant, and trustees can read everything.',
  blurb: 'Applications, scores, award options and checks. The board chair approves every grant.',
  keys: ['grant', 'grants', 'foundation', 'charity', 'funding', 'donor', 'nonprofit', 'non-profit', 'award', 'applicant'],
  usage: {
    research: [1280, 660, 6100],
    database: [2690, 3210, 15800],
    backend: [3610, 1440, 9800],
    views: [3020, 1390, 9100],
    ui: [4390, 1580, 10900],
  },
  lookup: {
    connector: 'wikipedia',
    tool: 'search_pages',
    args: {
      q: 'grant making foundation review process',
    },
    say: 'I looked up how foundations usually review grants, so the stages match what a grants team already says: received, under review, awarded or declined, then paid.',
    note: 'How grant review usually works',
  },
  say: {
    research: [
      'Reading the request. Officers record applications, the board chair decides, trustees read, and three agents review each application.',
      'Three roles, four kinds of record, one process on applications, four rules.',
    ],
    database: [
      'Creating tables for applications, score lines, award options and checks, with eight made-up applications at different stages.',
    ],
    backend: [
      'Writing the workflow from received to awarded, declined or paid, the access rules, and the review team: an Assessor, a Budget reviewer and Due diligence. The run pauses before Due diligence so a person can add a condition.',
    ],
    views: [
      'Applications have a status, a decision date and an amount, so a board, a calendar and a chart all fit. Checks sort by result.',
      "For the agents' room I chose a scorecard with a weighted total, the award options side by side with the recommended one marked, and the checks grouped by result. The verdict shows fund, fund less or decline, with the reviewers' confidence.",
    ],
    ui: [
      'Laying out the pages: a review room where the agents work, the applications board, a decision calendar, a decisions list for the chair, awards, checks and scores. Magenta, side navigation, and a heart for the icon.',
    ],
  },
  research: () => ({
    name: 'GrantDesk',
    summary:
      "A community foundation records grant applications, reviews each one with three agents, and funds only with the board chair's approval.",
    roles: [
      {
        id: 'officer',
        name: 'Programme officer',
        can: 'Records applications and runs the review team',
      },
      {
        id: 'chair',
        name: 'Board chair',
        can: 'Awards or declines grants, records payments and removes applications',
      },
      {
        id: 'trustee',
        name: 'Trustee',
        can: 'Reads every application, score and check, and changes nothing',
      },
    ],
    entities: [
      {
        name: 'applications',
        what: 'A request for funding from a community group',
      },
      {
        name: 'score_lines',
        what: 'One criterion the application was scored on',
      },
      {
        name: 'award_options',
        what: 'An amount we could award, with how many people it reaches',
      },
      {
        name: 'checks',
        what: 'One eligibility or due diligence check, met, not met or a condition',
      },
    ],
    process: {
      entity: 'applications',
      states: ['received', 'reviewing', 'reviewed', 'awarded', 'declined', 'paid'],
      note: 'The agents take an application from received to reviewed. The board chair awards or declines it, and later records the payment.',
    },
    stories: [
      {
        role: 'officer',
        want: 'see within minutes how strong an application is',
        so: 'I spend my time on the ones worth funding',
      },
      {
        role: 'officer',
        want: 'see three award amounts with the reach of each',
        so: 'I can explain the amount I propose',
      },
      {
        role: 'chair',
        want: 'decide with the score, the amount and the checks on one page',
        so: 'the board meeting moves quickly',
      },
      {
        role: 'chair',
        want: 'see what is waiting for a decision and when',
        so: 'no applicant waits past the promised date',
      },
      {
        role: 'trustee',
        want: 'read every application and decision',
        so: 'I can account for how the money was spent',
      },
    ],
    rules: [
      'Only the board chair awards a grant',
      'Only the board chair removes an application',
      'Trustees read everything and change nothing',
      'An application needs an organisation and an amount requested',
    ],
    question: null,
  }),
  database: () => {
    const A = [
      ['Reading club for care homes', 'Open Pages Trust', 'Older people', 18000, 12, 1, 'received', 'undecided', null, null],
      ['Solar panels for the village school', 'Greenfield Parents Group', 'Environment', 42000, 18, 2, 'received', 'undecided', null, null],
      [
        'After-school coding club',
        'Northside Youth Centre',
        'Young people',
        24000,
        9,
        1,
        'reviewed',
        'fund_reduced',
        70,
        'Fund the first year at the reduced amount; ask for attendance figures before a second year.',
      ],
      [
        'Community fridge',
        'Riverside Food Share',
        'Food',
        12000,
        5,
        2,
        'awarded',
        'fund',
        85,
        'A small, proven idea with volunteers already in place. Fund in full.',
      ],
      [
        'Wheelchair-accessible minibus',
        'Hillview Disability Forum',
        'Disability',
        65000,
        -6,
        1,
        'paid',
        'fund_reduced',
        74,
        'Fund the minibus; the group covers insurance from its own reserves.',
      ],
      [
        'Allotment tool library',
        'Eastfield Growers',
        'Environment',
        6500,
        -12,
        2,
        'paid',
        'fund',
        88,
        'Low cost, many users. Fund in full.',
      ],
      [
        'Music festival weekend',
        'Harbour Arts Collective',
        'Arts',
        55000,
        -3,
        1,
        'declined',
        'decline',
        62,
        'Most of the budget is for headline acts; little of it reaches local people.',
      ],
      ['Debt advice drop-in', 'Southgate Advice Centre', 'Money advice', 30000, 24, 2, 'reviewing', 'undecided', null, null],
    ];
    const D: Dict<string> = {
      'Young people': 'Two evening sessions a week for 11 to 16 year olds, run by volunteers from local firms, with laptops on loan.',
      Food: 'A shared fridge outside the community hall, stocked by local shops and checked daily by volunteers.',
      Disability: 'A second-hand minibus with a lift, so members can reach the weekly club and hospital visits.',
      Environment: 'A shed of shared tools for forty allotment plots, with a booking sheet and a volunteer keyholder.',
      Arts: 'A two-day festival in the harbour park with three stages, food stalls and free entry.',
      'Money advice': 'A weekly drop-in with a trained adviser for people behind on rent or bills, in the library.',
    };
    const SC = ['Need in the area', 'Reach', 'Track record', 'Value for money', 'Lasting effect'],
      W = [3, 2, 2, 2, 1],
      SV: Dict<number[]> = {
        3: [4, 3, 3, 4, 3],
        4: [5, 4, 4, 5, 3],
        5: [5, 3, 4, 3, 5],
      };
    const AO: Dict<(string | number | boolean)[][]> = {
      3: [
        ['Pilot only', 9000, 38, 40, false],
        ['Reduced', 16000, 67, 90, true],
        ['Full request', 24000, 100, 120, false],
      ],
      4: [
        ['Pilot only', 5000, 42, 150, false],
        ['Reduced', 8500, 71, 260, false],
        ['Full request', 12000, 100, 400, true],
      ],
      5: [
        ['Lease only', 22000, 34, 60, false],
        ['Reduced', 48000, 74, 140, true],
        ['Full request', 65000, 100, 140, false],
      ],
    };
    const CK = [
      [3, 'met', 'Registered as a charity for more than two years', 'high'],
      [3, 'condition', 'Send attendance figures after the first term', 'medium'],
      [4, 'met', 'Food hygiene training for every volunteer', 'high'],
      [4, 'met', 'The hall owner agrees in writing', 'medium'],
      [5, 'met', 'Accounts filed on time for three years', 'high'],
      [5, 'condition', 'Insurance for the minibus paid from reserves', 'medium'],
      [7, 'not_met', 'Less than a third of the budget reaches local people', 'high'],
      [7, 'met', 'Permission from the council for the park', 'low'],
    ];
    return {
      tables: [
        {
          name: 'applications',
          label: 'Applications',
          one: 'Application',
          title: 'title',
          owner: 'officer',
          columns: [
            {
              name: 'title',
              label: 'Project',
              type: 'text',
              required: true,
            },
            {
              name: 'organisation',
              label: 'Organisation',
              type: 'text',
              required: true,
            },
            {
              name: 'area',
              label: 'Area',
              type: 'text',
            },
            {
              name: 'description',
              label: 'What the money is for',
              type: 'longtext',
              required: true,
            },
            {
              name: 'amount_requested',
              label: 'Amount requested',
              type: 'money',
              required: true,
            },
            {
              name: 'decide_by',
              label: 'Decide by',
              type: 'date',
            },
            {
              name: 'officer',
              label: 'Programme officer',
              type: 'user',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['received', 'reviewing', 'reviewed', 'awarded', 'declined', 'paid'],
            },
            {
              name: 'recommendation',
              label: 'Recommendation',
              type: 'select',
              options: ['undecided', 'fund', 'fund_reduced', 'decline'],
            },
            {
              name: 'confidence',
              label: 'Confidence',
              type: 'number',
            },
            {
              name: 'summary',
              label: 'Verdict',
              type: 'longtext',
            },
          ],
          rows: A.map((t, i) => ({
            title: t[0],
            organisation: t[1],
            area: t[2],
            description: i < 2 ? grantCases()[i].values.description : D[t[2] as string],
            amount_requested: t[3],
            decide_by: t[4],
            officer: t[5],
            status: t[6],
            recommendation: t[7],
            confidence: t[8],
            summary: t[9],
          })),
        },
        {
          name: 'score_lines',
          label: 'Score lines',
          one: 'Score line',
          title: 'criterion',
          owner: null,
          columns: [
            {
              name: 'application_id',
              label: 'Application',
              type: 'ref',
              ref: 'applications',
              required: true,
            },
            {
              name: 'criterion',
              label: 'Criterion',
              type: 'text',
              required: true,
            },
            {
              name: 'score',
              label: 'Score',
              type: 'number',
              required: true,
            },
            {
              name: 'weight',
              label: 'Weight',
              type: 'number',
            },
            {
              name: 'note',
              label: 'Why',
              type: 'longtext',
            },
          ],
          rows: [3, 4, 5].flatMap((id) =>
            SC.map((c, i) => ({
              application_id: id,
              criterion: c,
              score: SV[id][i],
              weight: W[i],
              note: null,
            })),
          ),
        },
        {
          name: 'award_options',
          label: 'Award options',
          one: 'Award option',
          title: 'label',
          owner: null,
          columns: [
            {
              name: 'application_id',
              label: 'Application',
              type: 'ref',
              ref: 'applications',
              required: true,
            },
            {
              name: 'label',
              label: 'Option',
              type: 'text',
              required: true,
            },
            {
              name: 'amount',
              label: 'Amount',
              type: 'money',
              required: true,
            },
            {
              name: 'share',
              label: 'Share of request %',
              type: 'number',
            },
            {
              name: 'reach',
              label: 'People reached',
              type: 'number',
            },
            {
              name: 'recommended',
              label: 'Recommended',
              type: 'bool',
            },
            {
              name: 'note',
              label: 'Why',
              type: 'longtext',
            },
          ],
          rows: [3, 4, 5].flatMap((id) =>
            AO[id].map((p) => ({
              application_id: id,
              label: p[0],
              amount: p[1],
              share: p[2],
              reach: p[3],
              recommended: p[4],
              note: null,
            })),
          ),
        },
        {
          name: 'checks',
          label: 'Checks',
          one: 'Check',
          title: 'check',
          owner: null,
          columns: [
            {
              name: 'application_id',
              label: 'Application',
              type: 'ref',
              ref: 'applications',
              required: true,
            },
            {
              name: 'result',
              label: 'Result',
              type: 'select',
              options: ['met', 'not_met', 'condition'],
              required: true,
            },
            {
              name: 'check',
              label: 'Check',
              type: 'text',
              required: true,
            },
            {
              name: 'weight',
              label: 'Weight',
              type: 'select',
              options: ['high', 'medium', 'low'],
            },
          ],
          rows: CK.map((r) => ({
            application_id: r[0],
            result: r[1],
            check: r[2],
            weight: r[3],
          })),
        },
      ],
      users: [
        {
          name: 'Ayesha Karim',
          role: 'officer',
        },
        {
          name: 'Daniyal Shah',
          role: 'officer',
        },
        {
          name: 'Rukhsana Baig',
          role: 'chair',
        },
        {
          name: 'Tariq Anwar',
          role: 'trustee',
        },
      ],
    };
  },
  backend: () => ({
    status: {
      table: 'applications',
      column: 'status',
      initial: 'received',
      states: [
        {
          id: 'received',
          label: 'Received',
          tone: 'neutral',
        },
        {
          id: 'reviewing',
          label: 'Under review',
          tone: 'warning',
        },
        {
          id: 'reviewed',
          label: 'Awaiting decision',
          tone: 'info',
        },
        {
          id: 'awarded',
          label: 'Awarded',
          tone: 'success',
        },
        {
          id: 'declined',
          label: 'Declined',
          tone: 'danger',
        },
        {
          id: 'paid',
          label: 'Paid',
          tone: 'success',
        },
      ],
      transitions: [
        {
          id: 'start_review',
          label: 'Start the review',
          from: ['received'],
          to: 'reviewing',
          roles: ['officer', 'chair'],
        },
        {
          id: 'finish_review',
          label: 'Finish the review',
          from: ['reviewing'],
          to: 'reviewed',
          roles: ['officer', 'chair'],
        },
        {
          id: 'award',
          label: 'Award the grant',
          from: ['reviewed'],
          to: 'awarded',
          roles: ['chair'],
        },
        {
          id: 'decline',
          label: 'Decline',
          from: ['reviewed'],
          to: 'declined',
          roles: ['chair'],
        },
        {
          id: 'mark_paid',
          label: 'Record the payment',
          from: ['awarded'],
          to: 'paid',
          roles: ['chair'],
        },
      ],
    },
    access: [
      {
        table: 'applications',
        role: 'officer',
        list: 'all',
        create: true,
        update: 'all',
        delete: false,
      },
      {
        table: 'applications',
        role: 'chair',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'applications',
        role: 'trustee',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
    ].concat(
      ['score_lines', 'award_options', 'checks'].flatMap((tn) =>
        readAll(tn, ['officer', 'chair', 'trustee'], ['officer', 'chair'], 'chair'),
      ),
    ),
    team: {
      title: 'Review team',
      about:
        'Three agents review one application: how strong it is, how much to award, and whether it passes the checks. You can add a condition of your own before the verdict.',
      input: {
        table: 'applications',
        column: 'description',
      },
      start: 'start_review',
      done: 'finish_review',
      agents: [
        {
          id: 'assessor',
          name: 'Assessor',
          icon: 'target',
          acc: 'royalBlue',
          job: 'Scores the application from 0 to 5 on five criteria: need, reach, track record, value for money and lasting effect.',
          hint: 'One row per criterion, with "weight" from 1 to 3.',
          writes: 'score_lines',
        },
        {
          id: 'budget',
          name: 'Budget reviewer',
          icon: 'calculator',
          acc: 'forest',
          job: 'Works out three award amounts with the share of the request and the people each one reaches, and marks one as recommended.',
          hint: 'Exactly three rows, and exactly one with "recommended" true.',
          writes: 'award_options',
        },
        {
          id: 'diligence',
          name: 'Due diligence',
          icon: 'shield',
          acc: 'cranberry',
          job: 'Checks eligibility and risk: each check is met, not met or a condition. Then recommends fund, fund less or decline, with a confidence from 0 to 100.',
          hint: 'Use result "met", "not_met" or "condition".',
          writes: 'checks',
          sets: ['recommendation', 'confidence', 'summary'],
        },
      ],
      pause: {
        before: 'diligence',
        text: 'Scores and award options are in. Add a condition of your own before Due diligence gives its verdict, or continue.',
      },
      jump: {
        table: 'checks',
        column: 'check',
        set: {
          result: 'condition',
          weight: 'medium',
        },
        label: 'Add a condition',
      },
      samples: grantCases().map((c) => ({
        label: c.label,
        values: c.values,
      })),
    },
  }),
  views: () => ({
    views: [
      {
        table: 'applications',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'An application moves from received to awarded, declined or paid.',
          },
          {
            type: 'calendar',
            date: 'decide_by',
            why: 'Every applicant was promised a decision date.',
          },
          {
            type: 'table',
            why: 'For sorting by amount and organisation.',
          },
          {
            type: 'chart',
            x: 'area',
            split: 'status',
            measure: 'sum:amount_requested',
            why: 'Where the money is asked for, and what happened to it.',
          },
          {
            type: 'cards',
            why: 'An application and its verdict read well on a card.',
          },
          {
            type: 'timeline',
            start: 'decide_by',
            lane: 'officer',
            why: 'Decision dates per programme officer.',
          },
        ],
      },
      {
        table: 'score_lines',
        use: [
          {
            type: 'table',
            why: 'Scores are numbers to scan.',
          },
          {
            type: 'tree',
            levels: ['application_id'],
            why: 'Score lines belong to an application.',
          },
          {
            type: 'cards',
            why: 'One criterion per card.',
          },
        ],
      },
      {
        table: 'award_options',
        use: [
          {
            type: 'cards',
            why: 'Three amounts side by side.',
          },
          {
            type: 'table',
            why: 'For comparing reach against cost.',
          },
          {
            type: 'tree',
            levels: ['application_id'],
            why: 'Options belong to an application.',
          },
        ],
      },
      {
        table: 'checks',
        use: [
          {
            type: 'board',
            by: 'result',
            why: 'Met, not met and conditions as columns.',
          },
          {
            type: 'table',
            why: 'Every check in one list.',
          },
          {
            type: 'tree',
            levels: ['application_id', 'result'],
            why: 'Checks nested under their application.',
          },
          {
            type: 'chart',
            x: 'result',
            split: 'weight',
            why: 'How many checks pass, and how much the failures weigh.',
          },
        ],
      },
    ],
    board: {
      why: 'The agents produce a score, three award amounts and a list of checks, so the room shows a scorecard with a weighted total, the amounts side by side with the recommended one marked, and the checks grouped by result. The verdict leads with fund, fund less or decline, and the confidence.',
      verdict: {
        pick: 'recommendation',
        meter: 'confidence',
        text: 'summary',
      },
      panels: [
        {
          table: 'score_lines',
          layout: 'scores',
          title: 'How strong is it?',
          score: 'score',
          weight: 'weight',
          max: 5,
          text: 'note',
        },
        {
          table: 'award_options',
          layout: 'options',
          title: 'How much?',
          facts: ['amount', 'share', 'reach'],
          flag: 'recommended',
          text: 'note',
        },
        {
          table: 'checks',
          layout: 'groups',
          title: 'Does it pass the checks?',
          by: 'result',
        },
      ],
    },
    dashboard: {
      title: 'Grants overview',
      date: {
        table: 'applications',
        column: 'decide_by',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Applications',
          table: 'applications',
        },
        {
          kind: 'kpi',
          label: 'Awaiting decision',
          table: 'applications',
          where: {
            status: 'reviewed',
          },
        },
        {
          kind: 'kpi',
          label: 'Amount requested',
          table: 'applications',
          measure: 'sum:amount_requested',
        },
        {
          kind: 'kpi',
          label: 'Paid',
          table: 'applications',
          where: {
            status: 'paid',
          },
        },
        {
          kind: 'bar',
          label: 'Applications by stage',
          table: 'applications',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Amount requested by area',
          table: 'applications',
          x: 'area',
          split: 'status',
          measure: 'sum:amount_requested',
        },
        {
          kind: 'bar',
          label: 'Checks by result',
          table: 'checks',
          x: 'result',
        },
        {
          kind: 'line',
          label: 'Decisions due by week',
          table: 'applications',
          x: 'decide_by',
          bucket: 'week',
        },
        {
          kind: 'recent',
          label: 'Latest applications',
          table: 'applications',
        },
      ],
    },
  }),
  ui: () => ({
    theme: {
      accent: 'magenta',
      nav: 'side',
      icon: 'heart',
      logo: {
        shape: 'circle',
        fill: 'ring',
        mark: 'dot',
      },
    },
    screens: [
      {
        name: 'Review room',
        type: 'agents',
        table: 'applications',
        roles: ['officer', 'chair'],
        icon: 'bot',
      },
      {
        name: 'Applications',
        type: 'board',
        table: 'applications',
        roles: ['officer', 'chair', 'trustee'],
        group: 'status',
        columns: ['organisation', 'amount_requested', 'decide_by', 'recommendation'],
        icon: 'board',
      },
      {
        name: 'Decision dates',
        type: 'calendar',
        table: 'applications',
        roles: ['officer', 'chair'],
        columns: ['title', 'organisation', 'status'],
        icon: 'calendar',
      },
      {
        name: 'Decisions',
        type: 'table',
        table: 'applications',
        roles: ['chair'],
        columns: ['title', 'organisation', 'amount_requested', 'confidence', 'recommendation', 'status'],
        icon: 'approved',
      },
      {
        name: 'Awards',
        type: 'cards',
        table: 'award_options',
        roles: ['officer', 'chair', 'trustee'],
        columns: ['label', 'amount', 'share', 'reach', 'application_id'],
        icon: 'money',
      },
      {
        name: 'Checks',
        type: 'board',
        table: 'checks',
        roles: ['officer', 'chair', 'trustee'],
        group: 'result',
        columns: ['weight', 'application_id'],
        icon: 'checkCircle',
      },
      {
        name: 'Scores',
        type: 'table',
        table: 'score_lines',
        roles: ['officer', 'chair', 'trustee'],
        columns: ['criterion', 'score', 'weight', 'application_id'],
        icon: 'target',
      },
    ],
    tour: [
      {
        role: 'officer',
        do: 'create',
        table: 'applications',
        values: {
          title: 'Swimming lessons for refugee children',
          organisation: 'Welcome Neighbours',
          area: 'Young people',
          description: 'Ten weeks of lessons at the public pool for forty children, with transport from the community hall.',
          amount_requested: 9500,
          decide_by: 21,
        },
        say: 'Ayesha, a programme officer, records a new application.',
      },
      {
        role: 'chair',
        do: 'see',
        table: 'applications',
        screen: 'Applications',
        say: 'Rukhsana, the board chair, sees it on the applications board.',
      },
      {
        role: 'officer',
        do: 'transition',
        table: 'applications',
        transition: 'start_review',
        say: 'Ayesha starts the review. In the review room the three agents take it from here.',
      },
      {
        role: 'officer',
        do: 'transition',
        table: 'applications',
        transition: 'finish_review',
        say: 'The review is finished and the application waits for a decision.',
      },
      {
        role: 'officer',
        do: 'denied',
        table: 'applications',
        action: 'award',
        say: "Ayesha tries to award the grant. The backend refuses, because that is the chair's decision.",
      },
      {
        role: 'chair',
        do: 'transition',
        table: 'applications',
        transition: 'award',
        say: 'Rukhsana awards the grant.',
      },
      {
        role: 'trustee',
        do: 'denied',
        table: 'award_options',
        action: 'create',
        say: 'Tariq, a trustee, tries to add an award option. The backend refuses.',
      },
    ],
  }),
  cases: [
    {
      label: 'Reading club for care homes',
      values: {
        title: 'Reading club for care homes',
        organisation: 'Open Pages Trust',
        area: 'Older people',
        description:
          'Volunteers visit six care homes every week to read aloud and run a small book club, with large-print books bought for each home. The trust has run it in two homes for a year.',
        amount_requested: 18000,
        decide_by: 12,
      },
      script: [
        {
          agent: 'assessor',
          say: 'Scored on five criteria. The need is clear and the trust has already shown it works.',
          rows: [
            {
              criterion: 'Need in the area',
              score: 5,
              weight: 3,
              note: 'Loneliness in care homes is high, and none of the six has a reading activity now.',
            },
            {
              criterion: 'Reach',
              score: 3,
              weight: 2,
              note: 'About 120 residents across six homes.',
            },
            {
              criterion: 'Track record',
              score: 4,
              weight: 2,
              note: 'A year running in two homes, with the managers asking to keep it.',
            },
            {
              criterion: 'Value for money',
              score: 4,
              weight: 2,
              note: 'Most of the cost is books and travel; the readers are volunteers.',
            },
            {
              criterion: 'Lasting effect',
              score: 3,
              weight: 1,
              note: 'The books stay in the homes; the visits depend on volunteers staying.',
            },
          ],
        },
        {
          agent: 'budget',
          say: 'Three amounts. I recommend the full request: it is small, and cutting it drops homes rather than saving on each one.',
          rows: [
            {
              label: 'Pilot only',
              amount: 6000,
              share: 33,
              reach: 40,
              recommended: false,
              note: 'Keeps the two homes running, with no new ones.',
            },
            {
              label: 'Reduced',
              amount: 12000,
              share: 67,
              reach: 80,
              recommended: false,
              note: 'Four homes, standard-print books only.',
            },
            {
              label: 'Full request',
              amount: 18000,
              share: 100,
              reach: 120,
              recommended: true,
              note: 'All six homes and large-print books for each.',
            },
          ],
        },
        {
          agent: 'diligence',
          say: 'It passes the checks, with one condition on volunteer safety.',
          rows: [
            {
              check: 'Registered as a charity, with accounts filed on time',
              result: 'met',
              weight: 'high',
            },
            {
              check: 'Letters of support from the two care homes already visited',
              result: 'met',
              weight: 'medium',
            },
            {
              check: 'Every volunteer has a background check before visiting',
              result: 'condition',
              weight: 'high',
            },
          ],
          jumped: {
            say: 'I also weighed the condition added by the team.',
            rows: [
              {
                check: 'From the team: {{jump}}',
                result: 'condition',
                weight: 'medium',
              },
            ],
          },
          summary: {
            recommendation: 'fund',
            confidence: 82,
            summary:
              'Fund the full request, on the condition that every volunteer has a background check. A proven idea with a clear need.',
          },
        },
      ],
    },
    {
      label: 'Solar panels for a school',
      values: {
        title: 'Solar panels for the village school',
        organisation: 'Greenfield Parents Group',
        area: 'Environment',
        description:
          'A parents group asks for solar panels on the village school roof, to cut its electricity bill and teach pupils about energy. The school has not yet agreed, and the roof has not been surveyed.',
        amount_requested: 42000,
        decide_by: 18,
      },
      script: [
        {
          agent: 'assessor',
          say: 'Scored on five criteria. A good idea, but the group has no track record and the school is not signed up.',
          rows: [
            {
              criterion: 'Need in the area',
              score: 2,
              weight: 3,
              note: 'The school pays its bills; the saving is welcome but not urgent.',
            },
            {
              criterion: 'Reach',
              score: 3,
              weight: 2,
              note: 'About 180 pupils, and their families through the lessons.',
            },
            {
              criterion: 'Track record',
              score: 1,
              weight: 2,
              note: 'The group was formed this year and has not run a project.',
            },
            {
              criterion: 'Value for money',
              score: 3,
              weight: 2,
              note: 'Panels pay for themselves in about eight years.',
            },
            {
              criterion: 'Lasting effect',
              score: 5,
              weight: 1,
              note: 'Panels last twenty-five years.',
            },
          ],
        },
        {
          agent: 'budget',
          say: 'Three amounts. A roof survey first is the only one I can recommend before the school agrees.',
          rows: [
            {
              label: 'Survey only',
              amount: 2500,
              share: 6,
              reach: 0,
              recommended: true,
              note: 'Pays for a roof survey and a quote, so the full request can come back with facts.',
            },
            {
              label: 'Half the panels',
              amount: 21000,
              share: 50,
              reach: 180,
              recommended: false,
              note: 'Half the roof, half the saving.',
            },
            {
              label: 'Full request',
              amount: 42000,
              share: 100,
              reach: 180,
              recommended: false,
              note: 'The whole roof, if it can take the weight.',
            },
          ],
        },
        {
          agent: 'diligence',
          say: 'Two checks are not met yet, so I would not fund the panels now.',
          rows: [
            {
              check: 'The school governors agree in writing',
              result: 'not_met',
              weight: 'high',
            },
            {
              check: 'A survey shows the roof can carry the panels',
              result: 'not_met',
              weight: 'high',
            },
            {
              check: 'The group has a bank account in its own name',
              result: 'met',
              weight: 'medium',
            },
          ],
          jumped: {
            say: 'I also weighed the condition added by the team.',
            rows: [
              {
                check: 'From the team: {{jump}}',
                result: 'condition',
                weight: 'medium',
              },
            ],
          },
          summary: {
            recommendation: 'decline',
            confidence: 71,
            summary:
              'Decline for now and invite a new application with the governors’ agreement and a roof survey. The idea is sound; the project is not ready.',
          },
        },
      ],
    },
  ],
};

/* ---------- Purchase requests: two people approve before anything is bought ---------- */
REC.purchasing = {
  id: 'purchasing',
  title: 'Purchase requests',
  icon: 'cart',
  accent: 'marigold',
  sentence:
    'Staff raise purchase requests, their budget holder approves or rejects each one, the buyer orders from an approved supplier, and the person who asked confirms delivery.',
  blurb: 'Staff, a budget holder and a buyer. Nothing is ordered without approval.',
  keys: ['purchase', 'purchasing', 'buy', 'buyer', 'order', 'supplier', 'vendor', 'requisition', 'expense', 'spend'],
  usage: {
    research: [1210, 600, 5900],
    database: [2450, 2780, 13600],
    backend: [3290, 920, 7700],
    views: [2640, 1250, 8500],
    ui: [4120, 1460, 10100],
  },
  lookup: {
    connector: 'wikipedia',
    tool: 'search_pages',
    args: {
      q: 'purchase requisition approval',
    },
    say: 'I checked how purchase requests are usually approved, so the steps follow a normal purchasing process: request, approve, order, receive.',
    note: 'How purchase approval usually works',
  },
  say: {
    research: [
      'Reading the request. Staff ask, a budget holder approves, a buyer orders.',
      'Three roles, three kinds of record, one process on purchase requests. One question for you about who confirms delivery.',
    ],
    database: ['Creating tables for requests, suppliers and budgets, with two months of made-up requests around today.'],
    backend: [
      'Writing the workflow. Staff see only their own requests, only the budget holder approves, and only the buyer places orders.',
    ],
    views: [
      'Requests have an amount, a category and a date they are needed by, so a board, a calendar and charts that total the amount all fit.',
      'The dashboard totals what was approved and spent, shows what is waiting, and compares spend with each budget.',
    ],
    ui: [
      'Laying out the pages: a request form, an approvals board for the budget holder, an order queue for the buyer, a delivery calendar, suppliers and budgets. Marigold, top navigation.',
    ],
  },
  research: () => ({
    name: 'BuyRight',
    summary: 'Staff raise purchase requests, a budget holder approves them, and a buyer orders from approved suppliers.',
    roles: [
      {
        id: 'requester',
        name: 'Staff member',
        can: 'Raises requests and follows their own',
      },
      {
        id: 'approver',
        name: 'Budget holder',
        can: 'Approves or rejects requests and keeps the budgets',
      },
      {
        id: 'buyer',
        name: 'Buyer',
        can: 'Places orders and keeps the supplier list',
      },
    ],
    entities: [
      {
        name: 'purchase_requests',
        what: 'One thing someone needs bought',
      },
      {
        name: 'suppliers',
        what: 'A company we buy from',
      },
      {
        name: 'budgets',
        what: 'How much may be spent on one category this year',
      },
    ],
    process: {
      entity: 'purchase_requests',
      states: ['submitted', 'approved', 'rejected', 'ordered', 'received', 'cancelled'],
      note: 'The budget holder approves or rejects. The buyer orders what was approved. The person who asked may withdraw a request before it is approved.',
    },
    stories: [
      {
        role: 'requester',
        want: 'ask for something with the amount, the supplier and the date I need it',
        so: 'it can be approved without a chase',
      },
      {
        role: 'requester',
        want: 'see only my own requests and where each one is',
        so: 'I know when it will arrive',
      },
      {
        role: 'approver',
        want: 'approve or reject requests with the budget in view',
        so: 'we do not overspend',
      },
      {
        role: 'buyer',
        want: 'see what is approved and not yet ordered',
        so: 'nothing waits on me',
      },
      {
        role: 'buyer',
        want: 'keep the list of approved suppliers',
        so: 'we only buy from companies we trust',
      },
    ],
    rules: [
      'Staff see only their own requests',
      'Only the budget holder approves or rejects',
      'Only the buyer places orders',
      'A request needs an amount and a supplier',
    ],
    question: {
      text: 'Who confirms that an order has arrived?',
      options: ['The person who asked', 'Only the buyer'],
      recommended: 0,
    },
  }),
  database: () => {
    const R = [
      [1, 'Laptop for the new designer', 'equipment', 2, 245000, -30, 'received', 'Approved. Within the equipment budget.', 'PO-1041'],
      [2, 'Standing desks for the support team (4)', 'furniture', 3, 168000, -24, 'received', '', 'PO-1042'],
      [3, 'Design software licences for a year', 'software', 4, 96000, -18, 'ordered', 'Approved for one year only.', 'PO-1047'],
      [1, 'Printer toner and paper', 'supplies', 5, 18500, -10, 'received', '', 'PO-1049'],
      [4, 'Usability testing with ten customers', 'services', 6, 120000, 6, 'approved', 'Go ahead. Share the findings with sales.', ''],
      [2, 'Second monitor', 'equipment', 1, 42000, 4, 'approved', '', ''],
      [3, 'Ergonomic chairs (6)', 'furniture', 3, 210000, 12, 'submitted', '', ''],
      [4, 'Conference tickets for two', 'services', 6, 150000, 20, 'submitted', '', ''],
      [1, 'Whiteboards for the meeting rooms', 'supplies', 5, 36000, 9, 'submitted', '', ''],
      [
        2,
        'Gaming chairs for the break room',
        'furniture',
        3,
        95000,
        15,
        'rejected',
        'Not this year. The furniture budget is for desks.',
        '',
      ],
      [3, 'Cloud storage upgrade', 'software', 4, 54000, -5, 'ordered', '', 'PO-1050'],
      [4, 'Coffee machine', 'equipment', 1, 78000, 25, 'cancelled', '', ''],
      [1, 'Accessibility review of the website', 'services', 6, 180000, 30, 'submitted', '', ''],
      [2, 'Webcams for remote staff (5)', 'equipment', 1, 60000, -14, 'received', '', 'PO-1045'],
    ];
    const SUP = [
      ['Northline Computers', 'equipment', 'Imran Saeed', 4, true],
      ['Pakhtun Office Interiors', 'furniture', 'Zainab Gul', 5, true],
      ['Brightwork Furniture', 'furniture', 'Asad Ali', 3, true],
      ['Cloudmark Software', 'software', 'Nadia Hussain', 4, true],
      ['Daily Office Supplies', 'supplies', 'Faisal Mir', 4, true],
      ['Insight Research Partners', 'services', 'Samina Rauf', 5, true],
      ['Quickbuy Traders', 'equipment', 'Unknown', 2, false],
    ];
    const BUD = [
      ['equipment', 900000, 347000],
      ['furniture', 600000, 168000],
      ['software', 400000, 150000],
      ['supplies', 150000, 18500],
      ['services', 700000, 0],
    ];
    const yr = new Date().getFullYear(),
      CATS = ['equipment', 'furniture', 'software', 'supplies', 'services'];
    return {
      tables: [
        {
          name: 'purchase_requests',
          label: 'Purchase requests',
          one: 'Purchase request',
          title: 'item',
          owner: 'requester_id',
          columns: [
            {
              name: 'requester_id',
              label: 'Requested by',
              type: 'user',
              role: 'requester',
              required: true,
            },
            {
              name: 'item',
              label: 'What is needed',
              type: 'text',
              required: true,
            },
            {
              name: 'category',
              label: 'Category',
              type: 'select',
              options: CATS,
              required: true,
            },
            {
              name: 'supplier_id',
              label: 'Supplier',
              type: 'ref',
              ref: 'suppliers',
              required: true,
            },
            {
              name: 'amount',
              label: 'Amount',
              type: 'money',
              required: true,
            },
            {
              name: 'needed_by',
              label: 'Needed by',
              type: 'date',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['submitted', 'approved', 'rejected', 'ordered', 'received', 'cancelled'],
              required: true,
            },
            {
              name: 'approver_note',
              label: 'Budget holder note',
              type: 'text',
            },
            {
              name: 'po_number',
              label: 'Order number',
              type: 'text',
            },
          ],
          rows: R.map((r) => ({
            requester_id: r[0],
            item: r[1],
            category: r[2],
            supplier_id: r[3],
            amount: r[4],
            needed_by: r[5],
            status: r[6],
            approver_note: r[7],
            po_number: r[8],
          })),
        },
        {
          name: 'suppliers',
          label: 'Suppliers',
          one: 'Supplier',
          title: 'name',
          owner: null,
          columns: [
            {
              name: 'name',
              label: 'Name',
              type: 'text',
              required: true,
            },
            {
              name: 'category',
              label: 'Category',
              type: 'select',
              options: CATS,
            },
            {
              name: 'contact',
              label: 'Contact person',
              type: 'text',
            },
            {
              name: 'rating',
              label: 'Rating',
              type: 'number',
            },
            {
              name: 'approved',
              label: 'Approved supplier',
              type: 'bool',
            },
          ],
          rows: SUP.map((s) => ({
            name: s[0],
            category: s[1],
            contact: s[2],
            rating: s[3],
            approved: s[4],
          })),
        },
        {
          name: 'budgets',
          label: 'Budgets',
          one: 'Budget',
          title: 'category',
          owner: null,
          columns: [
            {
              name: 'category',
              label: 'Category',
              type: 'select',
              options: CATS,
              required: true,
            },
            {
              name: 'year',
              label: 'Year',
              type: 'number',
              required: true,
            },
            {
              name: 'budget',
              label: 'Budget',
              type: 'money',
              required: true,
            },
            {
              name: 'spent',
              label: 'Spent',
              type: 'money',
            },
          ],
          rows: BUD.map((b) => ({
            category: b[0],
            year: yr,
            budget: b[1],
            spent: b[2],
          })),
        },
      ],
      users: [
        {
          name: 'Mariam Javed',
          role: 'requester',
        },
        {
          name: 'Usman Tariq',
          role: 'requester',
        },
        {
          name: 'Kiran Abbas',
          role: 'requester',
        },
        {
          name: 'Saad Rehman',
          role: 'requester',
        },
        {
          name: 'Nida Hamid',
          role: 'approver',
        },
        {
          name: 'Junaid Akhtar',
          role: 'buyer',
        },
      ],
    };
  },
  backend: (ctx) => ({
    status: {
      table: 'purchase_requests',
      column: 'status',
      initial: 'submitted',
      states: [
        {
          id: 'submitted',
          label: 'Waiting for approval',
          tone: 'warning',
        },
        {
          id: 'approved',
          label: 'Approved',
          tone: 'info',
        },
        {
          id: 'rejected',
          label: 'Rejected',
          tone: 'danger',
        },
        {
          id: 'ordered',
          label: 'Ordered',
          tone: 'info',
        },
        {
          id: 'received',
          label: 'Received',
          tone: 'success',
        },
        {
          id: 'cancelled',
          label: 'Cancelled',
          tone: 'neutral',
        },
      ],
      transitions: [
        {
          id: 'approve',
          label: 'Approve',
          from: ['submitted'],
          to: 'approved',
          roles: ['approver'],
        },
        {
          id: 'reject',
          label: 'Reject',
          from: ['submitted'],
          to: 'rejected',
          roles: ['approver'],
        },
        {
          id: 'withdraw',
          label: 'Withdraw',
          from: ['submitted'],
          to: 'cancelled',
          roles: ['requester'],
        },
        {
          id: 'place_order',
          label: 'Place the order',
          from: ['approved'],
          to: 'ordered',
          roles: ['buyer'],
        },
        {
          id: 'confirm_delivery',
          label: 'Confirm delivery',
          from: ['ordered'],
          to: 'received',
          roles: ctx.answer === 1 ? ['buyer'] : ['requester', 'buyer'],
        },
      ],
    },
    access: [
      {
        table: 'purchase_requests',
        role: 'requester',
        list: 'own',
        create: true,
        update: 'none',
        delete: false,
      },
      {
        table: 'purchase_requests',
        role: 'approver',
        list: 'all',
        create: false,
        update: 'all',
        delete: false,
      },
      {
        table: 'purchase_requests',
        role: 'buyer',
        list: 'all',
        create: false,
        update: 'all',
        delete: true,
      },
      ...readAll('suppliers', ['requester', 'approver', 'buyer'], ['buyer'], 'buyer'),
      ...readAll('budgets', ['requester', 'approver', 'buyer'], ['approver'], 'approver').map((r) =>
        r.role === 'requester' ? { ...r, list: 'none' } : r,
      ),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'purchase_requests',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'A request moves from waiting to approved, ordered and received.',
          },
          {
            type: 'calendar',
            date: 'needed_by',
            why: 'Each request has a date it is needed by.',
          },
          {
            type: 'table',
            why: 'For sorting, with the amount totalled at the bottom.',
          },
          {
            type: 'chart',
            x: 'category',
            split: 'status',
            measure: 'sum:amount',
            why: 'Spend by category and stage.',
          },
          {
            type: 'pivot',
            rows: 'supplier_id',
            cols: 'category',
            measure: 'sum:amount',
            why: 'How much goes to each supplier.',
          },
          {
            type: 'timeline',
            start: 'needed_by',
            lane: 'requester_id',
            why: 'What each person is waiting for, and when.',
          },
        ],
      },
      {
        table: 'suppliers',
        use: [
          {
            type: 'cards',
            why: 'One card per supplier with its rating.',
          },
          {
            type: 'table',
            why: 'A short list to sort.',
          },
          {
            type: 'chart',
            x: 'category',
            why: 'How many suppliers we have for each category.',
          },
        ],
      },
      {
        table: 'budgets',
        use: [
          {
            type: 'table',
            why: 'Budgets are a ledger.',
          },
          {
            type: 'chart',
            x: 'category',
            measure: 'sum:spent',
            why: 'What each budget has spent.',
          },
          {
            type: 'cards',
            why: 'A card per budget.',
          },
        ],
      },
    ],
    dashboard: {
      title: 'Spending',
      date: {
        table: 'purchase_requests',
        column: 'needed_by',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Requests',
          table: 'purchase_requests',
        },
        {
          kind: 'kpi',
          label: 'Waiting for approval',
          table: 'purchase_requests',
          where: {
            status: 'submitted',
          },
        },
        {
          kind: 'kpi',
          label: 'Approved, not ordered',
          table: 'purchase_requests',
          where: {
            status: 'approved',
          },
        },
        {
          kind: 'kpi',
          label: 'Spent this year',
          table: 'budgets',
          measure: 'sum:spent',
        },
        {
          kind: 'bar',
          label: 'Requests by stage',
          table: 'purchase_requests',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Amount by category',
          table: 'purchase_requests',
          x: 'category',
          split: 'status',
          measure: 'sum:amount',
        },
        {
          kind: 'bar',
          label: 'Spent per budget',
          table: 'budgets',
          x: 'category',
          measure: 'sum:spent',
        },
        {
          kind: 'line',
          label: 'Amount needed each week',
          table: 'purchase_requests',
          x: 'needed_by',
          bucket: 'week',
          measure: 'sum:amount',
        },
        {
          kind: 'recent',
          label: 'Latest requests',
          table: 'purchase_requests',
        },
      ],
    },
  }),
  ui: () => ({
    theme: {
      accent: 'marigold',
      nav: 'top',
      icon: 'cart',
      density: 'comfortable',
    },
    screens: [
      {
        name: 'New request',
        type: 'form',
        table: 'purchase_requests',
        roles: ['requester'],
        icon: 'add',
      },
      {
        name: 'My requests',
        type: 'table',
        table: 'purchase_requests',
        roles: ['requester'],
        columns: ['item', 'category', 'amount', 'needed_by', 'status'],
        icon: 'list',
      },
      {
        name: 'Approvals',
        type: 'board',
        table: 'purchase_requests',
        roles: ['approver'],
        group: 'status',
        label: 'item',
        columns: ['requester_id', 'amount', 'category', 'needed_by'],
        icon: 'board',
      },
      {
        name: 'To order',
        type: 'table',
        table: 'purchase_requests',
        roles: ['buyer'],
        columns: ['item', 'supplier_id', 'amount', 'needed_by', 'status', 'po_number'],
        icon: 'cart',
      },
      {
        name: 'Deliveries',
        type: 'calendar',
        table: 'purchase_requests',
        roles: ['buyer', 'approver'],
        date: 'needed_by',
        label: 'item',
        icon: 'calendar',
      },
      {
        name: 'Suppliers',
        type: 'cards',
        table: 'suppliers',
        roles: ['requester', 'approver', 'buyer'],
        columns: ['name', 'category', 'contact', 'rating', 'approved'],
        icon: 'building',
      },
      {
        name: 'Budgets',
        type: 'table',
        table: 'budgets',
        roles: ['approver', 'buyer'],
        columns: ['category', 'year', 'budget', 'spent'],
        icon: 'calculator',
      },
      {
        name: 'Spending',
        type: 'dashboard',
        table: 'purchase_requests',
        roles: ['approver'],
        icon: 'pie',
      },
    ],
    tour: [
      {
        role: 'requester',
        do: 'create',
        table: 'purchase_requests',
        values: {
          item: 'Headsets for the sales team (3)',
          category: 'equipment',
          supplier_id: 1,
          amount: 27000,
          needed_by: 10,
        },
        say: 'Mariam asks for three headsets for the sales team.',
      },
      {
        role: 'approver',
        do: 'see',
        table: 'purchase_requests',
        screen: 'Approvals',
        say: 'Nida, the budget holder, finds the request on the approvals board.',
      },
      {
        role: 'buyer',
        do: 'denied',
        table: 'purchase_requests',
        action: 'approve',
        say: 'Junaid, the buyer, tries to approve it. The backend refuses, because approval belongs to the budget holder.',
      },
      {
        role: 'approver',
        do: 'transition',
        table: 'purchase_requests',
        transition: 'approve',
        say: 'Nida approves it.',
      },
      {
        role: 'buyer',
        do: 'transition',
        table: 'purchase_requests',
        transition: 'place_order',
        say: 'Junaid places the order with the supplier.',
      },
      {
        role: 'requester',
        do: 'denied',
        table: 'budgets',
        action: 'update',
        say: 'Mariam tries to change a budget. The backend refuses.',
      },
      {
        role: 'approver',
        do: 'open',
        screen: 'Spending',
        say: 'Nida opens the spending overview to see what is waiting and what each budget has spent.',
      },
    ],
  }),
};
