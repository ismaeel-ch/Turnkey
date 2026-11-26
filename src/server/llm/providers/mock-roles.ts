/**
 * Saved answers for Turnkey's agent prompts, so the whole Live path runs with no key: `LLM_PROVIDER=mock`.
 *
 * Given a prompt that begins "You are the <Name> agent on Turnkey, a line of agents…" (the Researcher, Database,
 * Backend, View advisor, UI and Tester, the Orchestrator that reads changes from chat, and the owner's own
 * reviewers), or "You are <Name>, one of N agents inside the app…" (an app's own team), it returns a valid answer for
 * that role, worked out from what the prompt itself says (the request, the brief, the tables, the access rules). The
 * answers are deliberately plain and generic: they pass the same checks a model's answers must pass.
 */

type Col = { name: string; type: string; options: string[]; ref: string; role: string; required: boolean };
type Table = { name: string; title: string; owner: string | null; columns: Col[] };
type Brief = {
  name?: string;
  summary?: string;
  roles?: { id: string; name: string; can?: string }[];
  entities?: { name: string; what?: string }[];
  process?: { entity: string; states: string[]; note?: string };
};
type Access = { table: string; role: string; list: string; create: boolean; update: string; delete: boolean };
type Flow = { table: string; column: string; initial: string; transitions: { id: string; from: string[]; to: string; roles: string[] }[] };

const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'that',
  'this',
  'my',
  'our',
  'their',
  'app',
  'application',
  'system',
  'tool',
  'build',
  'make',
  'create',
  'track',
  'tracks',
  'tracking',
  'manage',
  'manages',
  'managing',
  'small',
  'simple',
  'new',
  'who',
  'which',
  'from',
  'by',
  'into',
  'can',
  'need',
  'needs',
  'want',
  'wants',
  'where',
  'every',
  'each',
  'all',
  'about',
  'using',
  'keep',
  'keeps',
]);

const PEOPLE = [
  'Aisha Khan',
  'Ben Carter',
  'Tom Reid',
  'Lina Park',
  'Omar Aziz',
  'Sara Malik',
  'Daniel Shaw',
  'Maya Rossi',
  'Noah Bell',
  'Hana Ito',
];
const TITLES = [
  'Spring intake',
  'Quarterly review',
  'Front desk setup',
  'Supplier follow-up',
  'Annual renewal',
  'Welcome pack',
  'Site visit',
  'Records cleanup',
];
const SENTENCES = [
  'Made-up sample record for trying the app.',
  'Waiting on a reply from the other side.',
  'Checked and ready for the next step.',
  'Needs a second look next week.',
];

const snake = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (s: string) => s.split('_').filter(Boolean).join(' ');
const label = (s: string) => cap(words(s));
const singular = (s: string) =>
  /ies$/.test(s) ? s.replace(/ies$/, 'y') : /ses$/.test(s) ? s.replace(/es$/, '') : /s$/.test(s) ? s.replace(/s$/, '') : s;
const plural = (s: string) => (/s$/.test(s) ? s : /y$/.test(s) ? s.replace(/y$/, 'ies') : s + 's');
const json = (v: unknown) => JSON.stringify(v);

function section(prompt: string, head: RegExp): string {
  const m = head.exec(prompt);
  if (!m) return '';
  const rest = prompt.slice(m.index + m[0].length);
  const end = rest.search(/\n\n/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function parseBrief(prompt: string): Brief {
  const at = prompt.indexOf('BRIEF: ');
  if (at < 0) return {};
  const line = prompt.slice(at + 7).split('\n')[0];
  try {
    return JSON.parse(line) as Brief;
  } catch {
    return {};
  }
}

function parseTables(prompt: string): Table[] {
  const block = section(prompt, /TABLES(?: \(name:type, \* = required\))?:\n/);
  const tables: Table[] = [];
  for (const line of block.split('\n')) {
    const m = /^(\w+) \(title: (\w+), owner: (\w+)\): (.*)$/.exec(line.trim());
    if (!m) continue;
    const columns: Col[] = [];
    for (const raw of m[4].split(', ')) {
      const c = /^(\w+):(\w+)(?:\[([^\]]*)\])?(?:->(\w+))?(?:\((\w+)\))?(\*)?$/.exec(raw.trim());
      if (c)
        columns.push({ name: c[1], type: c[2], options: c[3] ? c[3].split('|') : [], ref: c[4] || '', role: c[5] || '', required: !!c[6] });
    }
    tables.push({ name: m[1], title: m[2], owner: m[3] === 'none' ? null : m[3], columns });
  }
  return tables;
}

function parseUsers(prompt: string): { name: string; role: string }[] {
  const m = /USERS: (.*)/.exec(prompt);
  if (!m) return [];
  return m[1]
    .split('; ')
    .map((x) => {
      const u = /^\d+\. (.*) \((\w+)\)$/.exec(x.trim());
      return u ? { name: u[1], role: u[2] } : { name: '', role: '' };
    })
    .filter((u) => u.name);
}

function parseAccess(prompt: string): Access[] {
  const out: Access[] = [];
  for (const line of section(prompt, /ACCESS:\n/).split('\n')) {
    const m = /^(\w+): (.*)$/.exec(line.trim());
    if (!m) continue;
    for (const part of m[2].split(' | ')) {
      const a = /^(\w+) list=(\w+) create=(\w+) update=(\w+) delete=(\w+)$/.exec(part.trim());
      if (a) out.push({ table: m[1], role: a[1], list: a[2], create: a[3] === 'true', update: a[4], delete: a[5] === 'true' });
    }
  }
  return out;
}

function parseFlow(prompt: string): Flow | null {
  const block = section(prompt, /WORKFLOW:\n/);
  const head = /^table (\w+), column (\w+), initial (\w+)\n?/.exec(block);
  if (!head) return null;
  const transitions = block
    .slice(head[0].length)
    .split('\n')
    .map((l) => /^(\w+): ([\w|]+) -> (\w+) by ([\w|]+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ id: m[1], from: m[2].split('|'), to: m[3], roles: m[4].split('|') }));
  return { table: head[1], column: head[2], initial: head[3], transitions };
}

const tone = (state: string, i: number, n: number) =>
  /cancel|reject|declin|fail|miss|lost|denied/.test(state)
    ? 'danger'
    : i === 0
      ? 'info'
      : i === n - 1
        ? 'success'
        : i === 1
          ? 'warning'
          : 'neutral';

/* ---------- Researcher ---------- */
function researcher(prompt: string) {
  const request = /REQUEST: "([\s\S]*?)"\n\nWrite the brief/.exec(prompt)?.[1] || 'A small record-keeping app';
  const sig = request
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const unique = [...new Set(sig)];
  const main = plural(snake(unique[1] || unique[0] || 'request'));
  const main2 = main === 'contacts' ? 'items' : main;
  const name = cap(unique[0] || 'Records') + ' ' + (unique[1] ? cap(unique[1]) : 'Tracker');
  const states = ['new', 'in_progress', 'done'];
  return {
    name: name.split(' ').slice(0, 3).join(' '),
    summary: request.replace(/\s+/g, ' ').slice(0, 140).replace(/\.?$/, '.'),
    roles: [
      { id: 'manager', name: 'Manager', can: 'Sees everything and assigns the work' },
      { id: 'staff', name: 'Staff', can: 'Does the work and moves it forward' },
    ],
    entities: [
      { name: 'contacts', what: 'People and organisations involved' },
      { name: main2, what: 'The work being tracked, moving through its states' },
    ],
    process: { entity: main2, states, note: 'Staff move records forward; the manager can move any' },
    stories: [
      { role: 'manager', want: 'add a record and give it to someone', so: 'nothing is forgotten' },
      { role: 'staff', want: 'see my records and move them forward', so: 'the manager sees progress' },
      { role: 'manager', want: 'see how many records are in each state', so: 'I can plan the week' },
    ],
    rules: ['Staff cannot delete records.', 'Only the manager removes contacts.'],
    question: null,
  };
}

/* ---------- Database ---------- */
function database(prompt: string) {
  const brief = parseBrief(prompt);
  const roles = brief.roles?.length ? brief.roles : [{ id: 'manager', name: 'Manager' }];
  const entities = brief.entities?.length ? brief.entities : [{ name: 'records' }];
  const proc = brief.process || { entity: entities[entities.length - 1].name, states: ['new', 'in_progress', 'done'] };
  const lastRole = roles[roles.length - 1].id;
  const users: { name: string; role: string }[] = [];
  roles.forEach((r, i) => {
    users.push({ name: PEOPLE[(i * 2) % PEOPLE.length], role: r.id });
    users.push({ name: PEOPLE[(i * 2 + 1) % PEOPLE.length], role: r.id });
  });
  const userOf = (role: string, i: number) => {
    const idx = users.map((u, n) => (u.role === role ? n + 1 : 0)).filter(Boolean);
    return idx[i % idx.length];
  };
  const first = entities.find((e) => e.name !== proc.entity)?.name;
  const rowsOf = new Map<string, number>(entities.map((e) => [e.name, 6]));

  const tables = entities.map((e) => {
    const isProc = e.name === proc.entity;
    const columns: Record<string, unknown>[] = [{ name: 'name', label: 'Name', type: 'text', required: true }];
    if (isProc) {
      if (first) columns.push({ name: singular(first) + '_id', label: label(singular(first)), type: 'ref', ref: first, required: true });
      columns.push({ name: 'assignee', label: 'Assigned to', type: 'user', role: lastRole });
      columns.push({ name: 'status', label: 'Status', type: 'select', options: proc.states, required: true });
      columns.push({ name: 'due_on', label: 'Due on', type: 'date' });
      columns.push({ name: 'notes', label: 'Notes', type: 'longtext' });
    } else {
      columns.push({ name: 'email', label: 'Email', type: 'text' });
      columns.push({ name: 'phone', label: 'Phone', type: 'text' });
      columns.push({ name: 'notes', label: 'Notes', type: 'longtext' });
    }
    const rows = Array.from({ length: rowsOf.get(e.name) || 6 }, (_, i) => {
      const row: Record<string, unknown> = {
        name: isProc ? TITLES[i % TITLES.length] : PEOPLE[(i + 2) % PEOPLE.length],
        notes: SENTENCES[i % SENTENCES.length],
      };
      if (isProc) {
        if (first) row[singular(first) + '_id'] = (i % (rowsOf.get(first) || 1)) + 1;
        row.assignee = userOf(lastRole, i);
        row.status = proc.states[i % proc.states.length];
        row.due_on = i * 2 - 2;
      } else {
        row.email = snake(String(row.name)) + '@example.com';
        row.phone = '555-01' + String(10 + i);
      }
      return row;
    });
    return {
      name: e.name,
      label: label(e.name),
      one: label(singular(e.name)),
      title: 'name',
      owner: isProc ? 'assignee' : null,
      columns,
      rows,
    };
  });
  return { tables, users };
}

/* ---------- shared: values for creating a record ---------- */
function valuesFor(table: Table, users: { name: string; role: string }[], skip: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const c of table.columns) {
    if (!c.required || skip.includes(c.name)) continue;
    if (c.type === 'ref') values[c.name] = 1;
    else if (c.type === 'user') values[c.name] = Math.max(1, users.findIndex((u) => !c.role || u.role === c.role) + 1);
    else if (c.type === 'select') values[c.name] = c.options[0];
    else if (c.type === 'number' || c.type === 'money') values[c.name] = 10;
    else if (c.type === 'date') values[c.name] = 0;
    else if (c.type === 'datetime') values[c.name] = '1 09:00';
    else if (c.type === 'bool') values[c.name] = true;
    else values[c.name] = 'Sample ' + label(singular(table.name)).toLowerCase();
  }
  return values;
}

/* ---------- Backend ---------- */
function backend(prompt: string) {
  const brief = parseBrief(prompt);
  const tables = parseTables(prompt);
  const roles = brief.roles?.map((r) => r.id) || ['manager'];
  const proc = brief.process || { entity: tables[tables.length - 1]?.name || 'records', states: ['new', 'done'] };
  const states = proc.states;
  const transitions = states
    .slice(1)
    .map((s, i) => ({ id: 'move_to_' + s, label: 'Move to ' + words(s), from: [states[i]], to: s, roles }));
  return {
    status: {
      table: proc.entity,
      column: 'status',
      states: states.map((s, i) => ({ id: s, label: label(s), tone: tone(s, i, states.length) })),
      initial: states[0],
      transitions,
    },
    access: tables.flatMap((t) =>
      roles.map((r, i) =>
        i === 0
          ? { table: t.name, role: r, list: 'all', create: true, update: 'all', delete: true }
          : {
              table: t.name,
              role: r,
              list: 'all',
              create: t.name === proc.entity,
              update: t.name === proc.entity ? 'all' : 'none',
              delete: false,
            },
      ),
    ),
  };
}

/* ---------- View advisor ---------- */
function views(prompt: string) {
  const tables = parseTables(prompt);
  const flow = parseFlow(prompt);
  const dateOf = (t: Table) => t.columns.find((c) => c.type === 'date' || c.type === 'datetime');
  const catOf = (t: Table) => t.columns.find((c) => c.type === 'select' || c.type === 'user' || c.type === 'ref');
  const plan = tables.map((t) => {
    const use: Record<string, unknown>[] = [
      { type: 'table', why: 'The full list, sortable.' },
      { type: 'cards', why: 'A friendlier look at each record.' },
    ];
    const sel = t.columns.find((c) => c.type === 'select');
    const date = dateOf(t);
    const cat = catOf(t);
    if (sel) use.push({ type: 'board', by: sel.name, why: 'Records grouped by ' + words(sel.name) + '.' });
    if (date) use.push({ type: 'calendar', date: date.name, why: 'Records by day.' });
    if (cat) use.push({ type: 'chart', x: cat.name, kind: 'bar', why: 'How many per ' + words(cat.name) + '.' });
    return { table: t.name, use };
  });
  const main = tables.find((t) => t.name === flow?.table) || tables[tables.length - 1];
  const widgets: Record<string, unknown>[] = [];
  if (main) {
    widgets.push({ kind: 'kpi', label: label(main.name), table: main.name, measure: 'count' });
    const sel = main.columns.find((c) => c.name === (flow?.column || 'status')) || main.columns.find((c) => c.type === 'select');
    if (sel) {
      widgets.push({ kind: 'kpi', label: 'Open', table: main.name, where: { [sel.name]: sel.options[0] }, measure: 'count' });
      widgets.push({ kind: 'bar', label: 'By ' + words(sel.name), table: main.name, x: sel.name });
    }
    const user = main.columns.find((c) => c.type === 'user' || c.type === 'ref');
    if (user && sel) widgets.push({ kind: 'stack', label: 'By ' + words(user.name), table: main.name, x: user.name, split: sel.name });
    widgets.push({ kind: 'recent', label: 'Latest', table: main.name });
  }
  const dateTable = tables.find((t) => dateOf(t));
  return {
    views: plan,
    dashboard: { title: 'Overview', date: dateTable ? { table: dateTable.name, column: dateOf(dateTable)!.name } : null, widgets },
  };
}

/* ---------- UI ---------- */
function screensAndTour(prompt: string, withTheme: boolean) {
  const brief = parseBrief(prompt);
  const tables = parseTables(prompt);
  const users = parseUsers(prompt);
  const access = parseAccess(prompt);
  const flow = parseFlow(prompt);
  const roles = brief.roles?.map((r) => r.id) || [...new Set(access.map((a) => a.role))];
  const mainName = flow?.table || brief.process?.entity || tables[0]?.name;
  const main = tables.find((t) => t.name === mainName) || tables[0];
  const may = (role: string, table: string) => access.find((a) => a.role === role && a.table === table);
  const canList = (role: string, table: string) => (may(role, table)?.list || 'none') !== 'none';
  const sel = main?.columns.find((c) => c.type === 'select');

  const screens: Record<string, unknown>[] = [];
  for (const t of tables) {
    const rs = roles.filter((r) => canList(r, t.name));
    if (!rs.length) continue;
    const cols = t.columns
      .filter((c) => c.name !== 'notes')
      .slice(0, 5)
      .map((c) => c.name);
    if (t === main && sel)
      screens.push({ name: label(t.name) + ' board', type: 'board', table: t.name, roles: rs, columns: cols.slice(0, 4), label: t.title });
    screens.push({ name: label(t.name), type: 'table', table: t.name, roles: rs, columns: cols, label: t.title });
  }
  if (main) {
    const creators = roles.filter((r) => may(r, main.name)?.create);
    if (creators.length)
      screens.push({ name: 'New ' + label(singular(main.name)).toLowerCase(), type: 'form', table: main.name, roles: creators });
  }
  if (!withTheme) {
    // A corrected tour: the pages already exist, so the tour may only open those.
    screens.length = 0;
    for (const part of (/SCREENS: (.*)/.exec(prompt)?.[1] || '').split('; ')) {
      const m = /^(.*) \(([\w|]*)\)$/.exec(part.trim());
      if (m) screens.push({ name: m[1], roles: m[2].split('|').filter(Boolean) });
    }
  }
  const screenFor = (role: string) => screens.find((s) => (s.roles as string[]).includes(role));

  const tour: Record<string, unknown>[] = [];
  const creator = roles.find((r) => main && may(r, main.name)?.create) || roles[0];
  const person = (role: string) => users.find((u) => u.role === role)?.name || 'Someone';
  if (main && creator) {
    const owns = main.owner ? main.columns.find((c) => c.name === main.owner) : null;
    const skip = ['status', ...(owns && owns.role === creator ? [owns.name] : [])];
    tour.push({
      role: creator,
      do: 'create',
      table: main.name,
      values: valuesFor(main, users, skip),
      say: person(creator) + ' adds a ' + singular(main.name).replace(/_/g, ' ') + '.',
    });
    tour.push({ role: creator, do: 'see', table: main.name, say: person(creator) + ' sees it in the list.' });
    const t = flow?.transitions.find((x) => x.from.includes(flow.initial) && x.roles.includes(creator));
    if (t)
      tour.push({
        role: creator,
        do: 'transition',
        table: main.name,
        transition: t.id,
        say: person(creator) + ' moves it to ' + t.to.replace(/_/g, ' ') + '.',
      });
    const limited = roles.find((r) => r !== creator && may(r, main.name) && !may(r, main.name)!.delete);
    if (limited)
      tour.push({ role: limited, do: 'denied', table: main.name, action: 'delete', say: person(limited) + ' cannot delete it.' });
  }
  for (const r of roles) {
    const s = screenFor(r);
    if (s && tour.length < 7 && !tour.some((x) => x.do === 'open' && x.role === r))
      tour.push({ role: r, do: 'open', screen: s.name, say: person(r) + ' opens ' + String(s.name) + '.' });
  }
  const theme = { accent: 'teal', nav: 'side', icon: 'clipboard', logo: { shape: 'squircle', fill: 'gradient', mark: 'spark' } };
  return withTheme ? { theme, screens, tour } : { tour };
}

/* ---------- Tester ---------- */
function tester(prompt: string) {
  const { screens, tour } = screensAndTour(prompt, true) as { screens: Record<string, unknown>[]; tour: Record<string, unknown>[] };
  void screens;
  const steps = (kinds: string[]) => tour.filter((s) => kinds.includes(String(s.do))).map((s) => ({ ...s }));
  const cases: { name: string; why: string; steps: Record<string, unknown>[] }[] = [];
  const created = tour.find((s) => s.do === 'create');
  if (created) {
    cases.push({
      name: 'A new record can be added and then found',
      why: 'People add records and expect to see them.',
      steps: [created, tour.find((s) => s.do === 'see')].filter(Boolean) as Record<string, unknown>[],
    });
    const tr = tour.find((s) => s.do === 'transition');
    if (tr) cases.push({ name: 'A record moves to its next state', why: 'Records move through the workflow.', steps: [created, tr] });
    const bad = { role: created.role, do: 'invalid', table: created.table, values: {}, say: 'A record with nothing filled in is refused.' };
    cases.push({ name: 'A record with required values missing is refused', why: 'Required fields must be filled in.', steps: [bad] });
  }
  const denied = tour.find((s) => s.do === 'denied');
  if (denied)
    cases.push({ name: 'A role without delete rights cannot delete', why: 'Access rules limit what each role may do.', steps: [denied] });
  const opens = steps(['open']).slice(0, 2);
  if (opens.length) cases.push({ name: 'Every role has a page to open', why: 'Every role needs a way in.', steps: opens });
  return { cases };
}

/* ---------- Orchestrator: changes from chat ---------- */
function change(prompt: string) {
  const text = /wrote: "([\s\S]*?)"\n\nTABLES:/.exec(prompt)?.[1] || '';
  const tables = parseTables(prompt);
  const rename = /\b(?:rename|call) (?:the |this )?(?:app|it)? ?(?:to|as)? ?"?([A-Za-z0-9][\w ]{1,40})"?\s*$/i.exec(text.trim());
  if (/\brename\b|\bcall (?:the app|it)\b/i.test(text) && rename)
    return { reply: 'Renaming the app.', ops: [{ op: 'rename_app', name: rename[1].trim() }] };
  const add =
    /\badd (?:an? |the )?(.+?) (?:field|column)(?: to (?:the )?(.+?))?\s*$/i.exec(text.trim()) ||
    /\b(.+?) need(?:s)? (?:an? )?(.+)$/i.exec(text.trim());
  if (add && /field|column/i.test(text)) {
    const name = snake(add[1]);
    const want = snake(add[2] || '');
    const t = tables.find((x) => x.name === want || singular(x.name) === singular(want)) || tables[0];
    if (t && name) return { reply: 'Adding it.', ops: [{ op: 'add_field', table: t.name, name, label: label(name), type: 'text' }] };
  }
  return {
    reply:
      'In this stand-in mode I can add a field or rename the app. Say, for example, "Add an emergency contact field to ' +
      (tables[0] ? words(tables[0].name) : 'the table') +
      '".',
    ops: [],
  };
}

/** The role named by a prompt, or null if it is not one of Turnkey's agent prompts. */
export function roleOf(prompt: string): string | null {
  const m = /^You are the ([\w ]+?) agent on Turnkey/.exec(prompt.trimStart());
  if (m) return m[1];
  return /^You are \w+, one of \d+ agents inside the app/.test(prompt.trimStart()) ? 'team' : null;
}

/** A valid answer (as JSON text) for one of Turnkey's agent prompts, or null for any other prompt. */
export function roleAnswer(prompt: string): string | null {
  const role = roleOf(prompt);
  if (!role) return null;
  if (role === 'team') return json({ say: 'Nothing to add in this stand-in mode.' });
  if (/ reviewer$|^Reviewer$/i.test(role)) return json({ findings: [] });
  switch (role) {
    case 'Researcher':
      return json(researcher(prompt));
    case 'Database':
      return json(database(prompt));
    case 'Backend':
      return json(
        /FAILING TESTS:/.test(prompt)
          ? { say: 'The failing tests need no change to the app in this stand-in mode.', fixes: [], wrong: [] }
          : backend(prompt),
      );
    case 'View advisor':
      return json(views(prompt));
    case 'UI':
      return json(/The tour failed as an acceptance test/.test(prompt) ? screensAndTour(prompt, false) : screensAndTour(prompt, true));
    case 'Tester':
      return json(tester(prompt));
    case 'Orchestrator':
      return json(change(prompt));
    default:
      return json({ findings: [] });
  }
}
