import type { ChangePlan, Dict, PlanWho } from '@/shared/types/workspace';
import { AGENT_NAMES } from '@/shared/plan/team';
import { verNext } from './record-steps';

/* ===== Turnkey · the plan of a change, as the owner reads it =====
   A change to a built app is a list of planned steps (src/workspace/changes.ts). This file turns that list into the
   card the owner approves: what will change, which agents are needed and which are not, what happens to the records,
   who gains or loses access, and the version it goes out as. It is plain logic with no database and no screen in it:
   the counts come in as numbers, so every sentence can be checked by a test. */

/** What this file needs to know about one planned step. */
export interface StepFacts {
  /** the station that makes the change */
  station: string;
  text: string;
  /** other stations whose work this step also changes (an access rule also changes who sees which page) */
  also?: string[];
  destructive?: boolean;
  /** what leaves the app, as a sentence without a full stop */
  loss?: string;
  /** a question the owner must answer before the step can run */
  ask?: string;
  /** a change to who may do what */
  access?: { who: string; people: number; gains: boolean; what: string };
}

/** The stations of the build line, in order. */
export const LINE = ['research', 'database', 'backend', 'views', 'screens', 'walkthrough'];
/** Which stations read what a station writes: they run again when it changes, the others are left alone. */
export const READ_BY: Dict<string[]> = {
  research: ['database', 'backend', 'views', 'screens', 'walkthrough'],
  database: ['backend', 'views', 'screens', 'walkthrough'],
  backend: ['walkthrough'],
  views: ['screens', 'walkthrough'],
  screens: ['walkthrough'],
  walkthrough: [],
};
/** The agent the owner knows each station by. The last station is the Tester's: it walks through the app and runs the tests. */
const AGENT_OF: Dict<string> = {
  research: 'researcher',
  database: 'database',
  backend: 'backend',
  views: 'views',
  screens: 'ui',
  walkthrough: 'tester',
};
const FOLLOWS: Dict<string> = {
  database: 'Keeps the lists in step with the change.',
  backend: 'Checks that every rule and sign-in still works with the changed lists.',
  views: 'Offers the views that fit the changed fields.',
  screens: 'Puts the change on the pages and forms.',
  walkthrough: 'Walks through the app as each kind of person and runs every test again.',
};
const NOT_NEEDED: Dict<string> = {
  research: 'What the app is for and who uses it stay the same.',
  database: 'No list or field changes.',
  backend: 'Who may do what stays the same.',
  views: 'No field that a view is built on changes.',
  screens: 'No page or form changes.',
  walkthrough: 'Nothing a person does in the app changes.',
};

/** The stations a change needs, in line order: the ones its steps change, and the ones that read what those write. */
export function stationsFor(steps: StepFacts[]): string[] {
  const need = new Set<string>();
  steps.forEach((s) =>
    [s.station].concat(s.also || []).forEach((id) => {
      if (!LINE.includes(id)) return;
      need.add(id);
      (READ_BY[id] || []).forEach((x) => need.add(x));
    }),
  );
  return LINE.filter((id) => need.has(id));
}

const who = (station: string, why: string): PlanWho => ({
  agent: AGENT_OF[station],
  who: AGENT_NAMES[AGENT_OF[station]] || station,
  why,
});
/** Who works on a change and who is not needed, each with one line on why. */
export function changeTeam(steps: StepFacts[]): { team: PlanWho[]; notNeeded: PlanWho[] } {
  const need = stationsFor(steps),
    team = need.map((id) => {
      const own = steps.filter((s) => s.station === id).map((s) => s.text);
      return who(id, own.length ? clip(own.join('; ') + '.', 160) : FOLLOWS[id]);
    }),
    notNeeded = LINE.filter((id) => !need.includes(id)).map((id) => who(id, NOT_NEEDED[id]));
  return { team, notNeeded };
}
const clip = (x: string, n: number) => (x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x);

/**
 * Whether a set of changes is a fix or a new feature. Anything that changes the lists, or adds something, is a new
 * feature; the rest (who may do what, how it looks, a name) is a fix. The Release page suggests the kind of the next
 * version by the same rule, so the plan and the release never disagree.
 */
export const kindOf = (items: { text: string; station?: string; kind?: 'fix' | 'feature' }[]): 'fix' | 'feature' =>
  items.some((x) => (x.kind ? x.kind === 'feature' : x.station === 'database' || /^Add(ed)? /.test(x.text))) ? 'feature' : 'fix';

const count = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
/**
 * What a change does to the records, as one of three labels and a sentence with real numbers. `lists` are the app's
 * lists with how many records each holds now.
 */
export function recordsFor(steps: StepFacts[], lists: { label: string; n: number }[]): ChangePlan['records'] {
  const total = lists.reduce((n, t) => n + t.n, 0),
    held = lists.filter((t) => t.n).map((t) => t.n + ' ' + t.label.toLowerCase()),
    gone = steps.filter((s) => s.destructive),
    asks = steps.filter((s) => s.ask);
  if (gone.length)
    return {
      level: 'removes',
      label: 'Removes something',
      text: gone.map((s) => s.text + ': ' + (s.loss || 'records that use it are affected') + '.').join(' '),
    };
  if (asks.length) return { level: 'ask', label: 'Needs one answer', text: asks.map((s) => s.ask).join(' ') };
  if (!steps.some((s) => s.station === 'database'))
    return {
      level: 'safe',
      label: 'Nothing is changed',
      text: 'No record is touched.' + (steps.some((s) => s.access) ? ' Only who may see or change them.' : ''),
    };
  return {
    level: 'safe',
    label: 'Nothing is lost',
    text: total
      ? 'All ' +
        count(total, 'record stays as it is', 'records stay as they are') +
        (held.length > 1 ? ' (' + held.join(', ') + ').' : '.') +
        (steps.some((s) => /^Add .* to /.test(s.text)) ? ' A new field is empty on the records you have.' : '')
      : 'There are no records in the app yet.',
  };
}

/** Who gains and who loses access, each with how many people that is. */
export function accessFor(steps: StepFacts[]): ChangePlan['access'] {
  const line = (a: NonNullable<StepFacts['access']>) =>
    a.who +
    ' (' +
    count(a.people, 'person', 'people') +
    ') ' +
    (a.gains ? 'will be able to ' : 'will no longer be able to ') +
    a.what +
    '.';
  const all = steps.map((s) => s.access).filter((a): a is NonNullable<StepFacts['access']> => !!a);
  return { gains: all.filter((a) => a.gains).map(line), loses: all.filter((a) => !a.gains).map(line) };
}

/** The whole card. `live` is the version people have now, or '' before the first release. */
export function changePlan(o: {
  title: string;
  steps: StepFacts[];
  lists: { label: string; n: number }[];
  live: string;
  /** the owner's own word on what kind of change it is, when they gave one */
  kind?: 'fix' | 'feature' | null;
}): ChangePlan {
  const kind = o.kind || kindOf(o.steps),
    t = changeTeam(o.steps);
  return {
    title: clip(o.title.trim().replace(/[.!?]+$/, ''), 70),
    kind,
    becomes: o.live ? verNext(o.live, kind) : '',
    changes: o.steps.map((s) => s.text),
    team: t.team,
    notNeeded: t.notNeeded,
    records: recordsFor(o.steps, o.lists),
    access: accessFor(o.steps),
  };
}
