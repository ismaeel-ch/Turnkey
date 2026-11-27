/**
 * Who works on a build, worked out from the plan by code. The Planner (a model) decides what the app is; this
 * function decides who has to work on it. So the team differs from app to app, it can never be put in a broken
 * order, it costs no model call, and it gives the same answer for a saved build as for a live one.
 */
import type { NotNeeded, PlanSpec, PlanTeam, PlannedPause, PlannedReview, PlannedStep } from './types';

/** The plain name of each agent, as the owner sees it. Keys are ids in the workspace's `AGENTS` and `REVIEWERS`. */
export const AGENT_NAMES: Readonly<Record<string, string>> = {
  researcher: 'Planner',
  database: 'List builder',
  backend: 'Rules builder',
  views: 'View advisor',
  ui: 'Screen designer',
  tester: 'Tester',
  security: 'Access checker',
  data: 'List checker',
};

/** A plan with no answer on demo data, and an app built before plans existed, start with demo data as apps always have. */
export const wantsDemoData = (plan: Pick<PlanSpec, 'demoData'> | null | undefined) => (plan ? plan.demoData !== false : true);

/** The facts about a plan that decide the team. */
export function planFacts(plan: PlanSpec) {
  const fields = plan.lists.flatMap((l) => l.fields);
  const scopes = Object.values(plan.permissions).flatMap((byPerson) => Object.values(byPerson));
  return {
    people: plan.people.length,
    stages: !!plan.stages,
    money: fields.some((f) => f.type === 'money'),
    /** a list has something to add up and something to group it by */
    numbers: plan.lists.some(
      (l) =>
        l.fields.some((f) => f.type === 'money' || f.type === 'number') &&
        l.fields.some((f) => f.type === 'date' || f.type === 'datetime' || f.type === 'select'),
    ),
    /** some rule limits people to their own records */
    own: scopes.some((p) => p.list === 'own' || p.update === 'own'),
    lists: plan.lists.length,
    fields: fields.length,
    helpers: !!plan.helpers,
  };
}

const kinds = (n: number) => (n === 1 ? '1 kind of person' : n + ' kinds of people');
const count = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

export function teamFor(plan: PlanSpec): PlanTeam {
  const f = planFacts(plan);
  const several = f.people >= 2;
  const agent = (id: PlannedStep['id'], name: string, who: string, why: string): PlannedStep => ({
    id,
    name,
    by: 'agent',
    agent: who,
    who: AGENT_NAMES[who],
    why,
  });
  const code = (id: PlannedStep['id'], name: string, why: string): PlannedStep => ({
    id,
    name,
    by: 'code',
    agent: null,
    who: 'Turnkey',
    why,
  });
  const notNeeded: NotNeeded[] = [];
  const skip = (who: string, why: string) => notNeeded.push({ agent: who, who: AGENT_NAMES[who], why });

  const steps: PlannedStep[] = [
    agent('research', 'Understand and plan', 'researcher', 'Wrote this plan from your sentence and your answers.'),
  ];

  steps.push(
    agent(
      'database',
      'Set up the lists',
      'database',
      'Sets up the ' +
        count(f.lists, 'list', 'lists') +
        (wantsDemoData(plan) ? ' and adds the demo data.' : '. No demo data: the app starts empty.'),
    ),
  );

  const rulesWhy = [
    several ? kinds(f.people) : '',
    f.stages ? count(plan.stages?.stages.length ?? 0, 'stage', 'stages') : '',
    f.helpers ? 'AI helpers' : '',
  ].filter(Boolean);
  if (rulesWhy.length)
    steps.push(
      agent(
        'backend',
        'Add the rules and approvals',
        'backend',
        'Writes ' + (f.stages ? 'the stages and ' : '') + 'who can see and do what: ' + rulesWhy.join(', ') + '.',
      ),
    );
  else {
    steps.push(
      code('backend', 'Add the rules', 'One kind of person and no approval steps, so the only rule is "you can see and do everything".'),
    );
    skip('backend', 'One kind of person and no approval steps.');
  }

  if (f.numbers || plan.overview)
    steps.push(
      agent(
        'views',
        'Choose views and the overview',
        'views',
        f.numbers
          ? 'Picks how to show each list and designs the overview: there are amounts to add up.'
          : 'Picks how to show each list and designs the overview.',
      ),
    );
  else {
    steps.push(code('views', 'Choose views', 'Nothing to chart, so each list gets its usual views.'));
    skip('views', 'There is nothing to chart.');
  }

  steps.push(
    agent(
      'screens',
      'Build the screens',
      'ui',
      several ? 'Lays out the screens for each kind of person, and their welcome.' : 'Lays out the screens and the welcome.',
    ),
  );
  steps.push(code('walkthrough', 'Try it end to end', 'Plays the app from the first screen to the last, as each kind of person.'));
  steps.push(
    agent(
      'tests',
      'Test everything',
      'tester',
      several
        ? 'Checks every rule for every kind of person' + (f.stages ? ', and every move between stages.' : '.')
        : 'Tries every screen' + (f.money ? ' and checks the totals.' : '.'),
    ),
  );

  const reviews: PlannedReview[] = [];
  if (several && (f.money || f.own))
    reviews.push({
      id: 'security',
      who: AGENT_NAMES.security,
      after: 'backend',
      why:
        'Reads the rules for anything wider than it should be: ' +
        kinds(f.people) +
        (f.money ? ' and money' : ' and records people keep to themselves') +
        '.',
    });
  else skip('security', several ? 'No money and nothing people keep to themselves.' : 'Nobody else signs in.');
  if (f.lists >= 5 || f.fields >= 30)
    reviews.push({
      id: 'data',
      who: AGENT_NAMES.data,
      after: 'database',
      why: 'Reads the lists for gaps: ' + count(f.lists, 'list', 'lists') + ' with ' + f.fields + ' fields is a lot to get right.',
    });
  else skip('data', count(f.lists, 'list is', 'lists are') + ' few enough to check by rule.');

  const pauses: PlannedPause[] = [];
  if (several && f.money)
    pauses.push({
      after: 'backend',
      why: 'The rules decide who sees what and there is money involved, so you check them before the screens are built.',
    });

  const working = new Set([...steps.map((s) => s.agent).filter(Boolean), ...reviews.map((r) => r.id)]);
  return { steps, reviews, pauses, notNeeded, agents: working.size };
}
