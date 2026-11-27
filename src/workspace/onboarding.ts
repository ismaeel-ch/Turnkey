import type { AppDef, AppTable, Permission, Screen } from '@/shared/types/app';
import type { AppRecord } from '@/shared/types/workspace';

/* ===== Turnkey · first use of a built app: what each kind of person is told =====
   Everything here is worked out from what the agents already wrote: the kinds of people and what each can do, the
   user stories, the access rules, the screens and the status steps. No model is called, so a saved build and an
   app opened from a link get the same guide. This file only works the words out; firstrun.tsx draws them. */

/** Where the welcome's main button, or a checklist item's "Do it", takes the person. */
export interface FirstAction {
  label: string;
  /** the screen to open, if any */
  screen: string | null;
  /** the table to start a new record of, in the form that opens over the page */
  create: string | null;
}
/** What makes a checklist item tick itself. */
export type Done =
  /** the person opened a record */
  | { by: 'opened' }
  /** the app's activity log shows the person did this on that table */
  | { by: 'did'; table: string; action: string }
  /** the person opened this screen */
  | { by: 'visited'; screen: string }
  /** no demo data is left in the app */
  | { by: 'demo' };
export interface ChecklistItem {
  id: string;
  text: string;
  note: string;
  done: Done;
  go: FirstAction | null;
}
/** The part of the app a tour stop points at. */
export type TourTarget = 'nav' | 'list' | 'add' | 'status';
export interface TourStop {
  target: TourTarget;
  title: string;
  text: string;
}
/** The first-use guide of one kind of person. */
export interface Guide {
  role: string;
  roleName: string;
  /** one line on what this kind of person does, shown under their name on the sign-in screen */
  line: string;
  /** up to three things they can do, for the welcome */
  points: string[];
  action: FirstAction | null;
  checklist: ChecklistItem[];
  /** the screen the tour is given on */
  home: string | null;
  stops: TourStop[];
}

const MAX_POINTS = 3,
  MAX_ITEMS = 5,
  MAX_STOPS = 4,
  MAX_BUBBLE = 160;
const NONE: Permission = { list: 'none', create: false, update: 'none', delete: false };
const acc = (def: AppDef, role: string, table: string): Permission => (def.access[table] || {})[role] || NONE;
const tbl = (def: AppDef, name: string | null | undefined) => def.tables.find((t) => t.name === name);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const low = (s: string) => s.toLowerCase();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
/** "a claim", "an appointment" */
export const aAn = (noun: string) => (/^[aeiou]/i.test(noun) ? 'an ' : 'a ') + noun;
const joined = (names: string[], word: string) =>
  names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' ' + word + ' ' + names[names.length - 1];
const orList = (names: string[]) => joined(names, 'or');
const nameOfRole = (def: AppDef, id: string) => {
  const r = def.brief ? def.brief.roles.find((x) => x.id === id) : null;
  return r && r.name ? r.name : cap(id.replace(/_/g, ' '));
};
/** A screen that lists records, as a table, a board, a calendar and so on. */
const isList = (s: Screen) => !['dashboard', 'form', 'agents'].includes(s.type);
const screensOf = (def: AppDef, role: string) => def.screens.filter((s) => s.roles.includes(role));
const listFor = (def: AppDef, role: string, table: string) => screensOf(def, role).find((s) => isList(s) && s.table === table);

/** A user story is written as "I want to …". The welcome speaks to the person, so "my" becomes "your". */
export function toYou(want: string): string {
  const s = String(want || '')
    .trim()
    .replace(/^(i want to|i can|to)\s+/i, '')
    .replace(/[.\s]+$/, '')
    .replace(/\bI am\b/g, 'you are')
    .replace(/\bI'm\b/g, "you're")
    .replace(/\bmyself\b/gi, 'yourself')
    .replace(/\bmine\b/gi, 'yours')
    .replace(/\bmy\b/gi, 'your')
    .replace(/\bme\b/gi, 'you')
    .replace(/\bI\b/g, 'you');
  return clip(cap(s), 90);
}

/** The line under a person's name on the sign-in screen: what their kind of person does. */
export function roleLine(def: AppDef, role: string): string {
  const r = def.brief ? def.brief.roles.find((x) => x.id === role) : null;
  const can = r && r.can ? r.can.trim().replace(/[.\s]+$/, '') : '';
  if (can) return clip(cap(can), 90);
  const adds = def.tables.filter((t) => acc(def, role, t.name).create).map((t) => low(t.label));
  if (adds.length) return clip('Adds ' + joined(adds, 'and'), 90);
  const sees = def.tables.filter((t) => acc(def, role, t.name).list !== 'none').map((t) => low(t.label));
  return sees.length ? clip('Sees ' + joined(sees, 'and'), 90) : '';
}

/** The status steps this kind of person may take on a table, in the order the workflow lists them. */
function movesOf(def: AppDef, role: string, table: string) {
  const P = def.process && def.process.table === table ? def.process : null;
  return P ? P.transitions.filter((x) => x.roles.includes(role)) : [];
}
/** The table a sentence talks about first, out of the ones given. */
function tableIn(text: string, tables: AppTable[]): AppTable | null {
  const s = ' ' + low(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
  let best: AppTable | null = null,
    at = -1;
  tables.forEach((t) => {
    const words = [low(t.one), low(t.label), t.name.replace(/_/g, ' '), t.name.replace(/_/g, ' ').replace(/s$/, '')];
    words.forEach((w) => {
      const i = w ? s.indexOf(' ' + w) : -1;
      if (i >= 0 && (at < 0 || i < at)) {
        at = i;
        best = t;
      }
    });
  });
  return best;
}
/** Verbs a story uses for making a new record: "submit a claim", "book an appointment". */
const MAKES =
  'add book capture create draft enter file log make open place post raise record register report request schedule send start submit upload write'.split(
    ' ',
  );

function newRecord(def: AppDef, role: string, t: AppTable, verb: string): FirstAction {
  const form = screensOf(def, role).find((s) => s.type === 'form' && s.table === t.name),
    list = listFor(def, role, t.name);
  return {
    label: cap(verb) + ' your first ' + low(t.one),
    // a form page has the form ready; otherwise the form opens over the list
    screen: form ? form.id : list ? list.id : null,
    create: form ? null : t.name,
  };
}
const openScreen = (s: Screen): FirstAction => ({ label: 'Open ' + s.name, screen: s.id, create: null });

/** The first thing to do: the person's first user story, as a button that opens the right screen. */
export function firstAction(def: AppDef, role: string): FirstAction | null {
  const screens = screensOf(def, role);
  const story = def.brief ? def.brief.stories.find((s) => s.role === role) : null;
  const mine = def.tables.filter((t) => acc(def, role, t.name).create),
    seen = def.tables.filter((t) => acc(def, role, t.name).list !== 'none');
  if (story) {
    const want = low(String(story.want || '').trim()),
      m = /^([a-z]+)\s+(?:a|an|the|my|new|one)\b/.exec(want),
      made = tableIn(want, mine);
    if (m && MAKES.includes(m[1]) && made) return newRecord(def, role, made, m[1]);
    const about = tableIn(want, seen),
      scr = (about && listFor(def, role, about.name)) || (def.process && listFor(def, role, def.process.table));
    if (scr) return openScreen(scr);
  } else {
    // no story for this kind of person: adding the main record is the usual first thing
    const main = mine.find((t) => def.process && def.process.table === t.name) || mine.find((t) => listFor(def, role, t.name));
    if (main) return newRecord(def, role, main, 'add');
  }
  return screens.length ? openScreen(screens[0]) : null;
}

/** Up to three things this kind of person can do: their user stories, then what the access rules allow. */
export function welcomePoints(def: AppDef, role: string): string[] {
  const out: string[] = [];
  // one line per thing: a line that starts with the same word as one already there says it twice
  const verb = (s: string) => low(s).split(' ')[0];
  const add = (s: string) => {
    if (s && out.length < MAX_POINTS && !out.some((x) => verb(x) === verb(s) && tableWord(x) === tableWord(s))) out.push(s);
  };
  const tableWord = (s: string) => (tableIn(s, def.tables) || { name: low(s) }).name;
  (def.brief ? def.brief.stories : []).filter((s) => s.role === role).forEach((s) => add(toYou(s.want)));
  def.tables.filter((t) => acc(def, role, t.name).create).forEach((t) => add('Add ' + aAn(low(t.one))));
  if (def.process) {
    const one = low((tbl(def, def.process.table) || { one: 'record' }).one);
    // "Approve a claim" reads as a sentence; a longer label such as "Send back" is named as the button it is
    movesOf(def, role, def.process.table).forEach((x) =>
      add(/\s/.test(x.label.trim()) ? 'Use "' + x.label + '" on ' + aAn(one) : x.label + ' ' + aAn(one)),
    );
  }
  screensOf(def, role).forEach((s) => add('Open ' + s.name));
  return out;
}

/** The screen the tour is given on: the first one that lists records. */
const homeOf = (def: AppDef, role: string) => screensOf(def, role).find((s) => isList(s) && tbl(def, s.table)) || null;

/** A short list of real things to do. Each item ticks itself when the person has done it. */
export function checklist(def: AppDef, role: string, o: { owner?: boolean; demo?: boolean } = {}): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (it: ChecklistItem) => {
    if (items.length < MAX_ITEMS && !items.some((x) => x.id === it.id)) items.push(it);
  };
  const screens = screensOf(def, role),
    home = homeOf(def, role),
    ht = home ? tbl(def, home.table) : null,
    first = firstAction(def, role);
  if (home && ht)
    add({ id: 'open', text: 'Open ' + aAn(low(ht.one)) + ' and look around', note: '', done: { by: 'opened' }, go: openScreen(home) });
  // adding a record: the welcome's own first step when it is one, otherwise the main record this person may add
  const form = first && !first.create && first.screen ? screens.find((s) => s.id === first.screen && s.type === 'form') : null,
    madeName = first && first.create ? first.create : form ? form.table : null,
    made =
      (madeName && tbl(def, madeName)) ||
      def.tables.find((t) => acc(def, role, t.name).create && def.process && def.process.table === t.name) ||
      def.tables.find((t) => acc(def, role, t.name).create && listFor(def, role, t.name));
  if (made) {
    const go = madeName && first ? first : newRecord(def, role, made, 'add');
    add({ id: 'create', text: go.label, note: '', done: { by: 'did', table: made.name, action: 'created' }, go });
  }
  if (def.process) {
    const P = def.process,
      pt = tbl(def, P.table),
      step = movesOf(def, role, P.table)[0],
      list = listFor(def, role, P.table);
    if (pt && step)
      add({
        id: 'move',
        text: 'Open ' + aAn(low(pt.one)) + ' and press "' + step.label + '"',
        note: '',
        // the activity log writes a status step under its label, in lower case
        done: { by: 'did', table: P.table, action: low(step.label) },
        go: list ? openScreen(list) : null,
      });
  }
  const dash = screens.find((s) => s.type === 'dashboard');
  if (dash) add({ id: 'dash', text: 'Look at ' + dash.name, note: '', done: { by: 'visited', screen: dash.id }, go: openScreen(dash) });
  // a short list still shows the person where their other screens are
  screens
    .filter((s) => s !== home && s !== dash && s.type !== 'form')
    .forEach((s) => {
      if (items.length < 3)
        add({ id: 'see:' + s.id, text: 'Open ' + s.name, note: '', done: { by: 'visited', screen: s.id }, go: openScreen(s) });
    });
  if (o.owner && o.demo)
    add({ id: 'demo', text: 'Remove the demo data when you are ready', note: 'Owner only', done: { by: 'demo' }, go: null });
  return items;
}

/** What a person has done so far, as the checklist reads it. */
export interface Progress {
  opened: boolean;
  /** screens the person has opened, by id */
  seen: Record<string, boolean | undefined>;
  /** `table|action` pairs from the app's activity log for this person */
  did: Set<string>;
  /** demo data is still in the app */
  demo: boolean;
}
export function isDone(it: ChecklistItem, p: Progress): boolean {
  const d = it.done;
  if (d.by === 'opened') return p.opened;
  if (d.by === 'visited') return !!p.seen[d.screen];
  if (d.by === 'did') return p.did.has(d.table + '|' + d.action);
  return !p.demo;
}

/** At most four stops. A stop for something this kind of person does not have is left out. */
export function tourStops(def: AppDef, role: string): TourStop[] {
  const stops: TourStop[] = [];
  const add = (target: TourTarget, title: string, text: string) => {
    if (stops.length < MAX_STOPS) stops.push({ target, title, text: clip(text, MAX_BUBBLE) });
  };
  const screens = screensOf(def, role),
    home = homeOf(def, role),
    t = home ? tbl(def, home.table) : null;
  if (screens.length > 1) add('nav', 'Your screens', 'These are your screens. You see the ones for your job.');
  if (!home || !t) return stops;
  const a = acc(def, role, t.name),
    one = low(t.one),
    P = def.process && def.process.table === t.name ? def.process : null,
    moves = movesOf(def, role, t.name);
  add(
    'list',
    home.name,
    (a.list === 'own' ? 'Your ' + low(t.label) + ' are listed here' : 'Every ' + one + ' is listed here') +
      (P ? ', with the status it has reached.' : '.') +
      ' Select one to open it.',
  );
  if (a.create) add('add', 'New ' + one, 'Start a new ' + one + ' here.');
  else if (moves.length)
    add('list', 'What you do here', 'Open ' + aAn(one) + ' and use ' + orList(moves.slice(0, 2).map((x) => x.label)) + '.');
  if (P) {
    const others = [...new Set(P.transitions.flatMap((x) => x.roles))].filter((r) => r !== role).map((r) => nameOfRole(def, r));
    add(
      'status',
      'Status',
      'Each ' +
        one +
        ' has a status. ' +
        (moves.length
          ? 'You move it on with the buttons on the ' + one + '.'
          : others.length
            ? 'It moves on when someone signed in as ' + orList(others.slice(0, 3)) + ' acts on it.'
            : 'It shows how far the ' + one + ' has got.'),
    );
  }
  return stops;
}

/** The whole first-use guide of one kind of person. */
export function guideFor(def: AppDef, role: string, o: { owner?: boolean; demo?: boolean } = {}): Guide {
  const home = homeOf(def, role);
  return {
    role,
    roleName: nameOfRole(def, role),
    line: roleLine(def, role),
    points: welcomePoints(def, role),
    action: firstAction(def, role),
    checklist: checklist(def, role, o),
    home: home ? home.id : null,
    stops: tourStops(def, role),
  };
}

/**
 * An app with one kind of person has no sign-in screen: it opens straight away as its first person. The plan says so
 * when the owner answered "Just me"; an app with no plan is read from its people.
 */
export function soleUser<U extends { role: string }>(app: Pick<AppRecord, 'plan'>, users: U[]): U | null {
  if (!users.length) return null;
  return (app.plan && app.plan.audience === 'just_me') || new Set(users.map((u) => u.role)).size === 1 ? users[0] : null;
}

/* ---------- empty screens ---------- */
/** What an empty list says, and the one button it offers. */
export interface EmptyText {
  icon: string;
  title: string;
  text: string;
  button: 'add' | 'clear' | null;
  label: string;
}
/**
 * An empty list explains itself. `total` is how many records this person may see before the search and filters;
 * when that is not zero, the list is empty only because nothing matches.
 */
export function emptyList(def: AppDef, t: AppTable, role: string, total: number): EmptyText {
  const many = low(t.label),
    one = low(t.one),
    a = acc(def, role, t.name);
  if (total > 0)
    return {
      icon: 'search',
      title: 'No ' + many + ' match',
      text: 'Nothing matches the search and filters.',
      button: 'clear',
      label: 'Clear filters',
    };
  if (a.create)
    return a.list === 'own'
      ? {
          icon: 'add',
          title: 'You have no ' + many + ' yet',
          text: 'You see your own ' + many + ' here.',
          button: 'add',
          label: 'New ' + one,
        }
      : { icon: 'add', title: 'No ' + many + ' yet', text: cap(many) + ' you add appear here.', button: 'add', label: 'New ' + one };
  const who = (def.brief ? def.brief.roles.map((r) => r.id) : Object.keys(def.access[t.name] || {}))
    .filter((r) => r !== role && acc(def, r, t.name).create)
    .map((r) => nameOfRole(def, r));
  return {
    icon: 'info',
    title: (a.list === 'own' ? 'You have no ' : 'No ') + many + ' yet',
    text: who.length
      ? 'They appear here when someone signed in as ' + orList(who.slice(0, 3)) + ' adds one.'
      : 'They appear here when the first one is added.',
    button: null,
    label: '',
  };
}
/** A dashboard with nothing to count yet. `table` is the record it mostly counts. */
export function emptyDash(def: AppDef, t: AppTable, role: string): EmptyText {
  const can = acc(def, role, t.name).create;
  return {
    icon: 'pie',
    title: 'Nothing to count yet',
    text: 'The numbers and charts fill in after the first ' + low(t.one) + '.',
    button: can ? 'add' : null,
    label: can ? 'New ' + low(t.one) : '',
  };
}
