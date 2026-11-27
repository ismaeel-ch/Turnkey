import type { AppDef, AppTable, Board, BoardLayout, BoardPanel, ColumnDef, Untrusted } from '@/shared/types/app';
import type { Dict } from '@/shared/types/workspace';
import { arr, label, snake, str } from './core';
import { chk, colOf, tableOf } from './engine';

/* ===== Turnkey prototype · the agent room: where an app's own agents work, in a view picked for what they produce =====
   The View advisor writes the "board" as data: which panel shows each table the agents fill, and how the outcome reads.
   The catalog of panels is fixed (versus, list, groups, scores, options); the choice is the advisor's. Rules in code
   suggest a board whenever the advisor's answer does not fit, so a team is never left with a plain step log. */
export const BOARD_LAYOUTS: readonly BoardLayout[] = ['versus', 'list', 'groups', 'scores', 'options'];
export const BOARD_WHAT: Record<BoardLayout, string> = {
  versus: 'Two sides, face to face',
  list: 'One card per record, with what belongs to it underneath',
  groups: 'Short statements sorted into groups',
  scores: 'Criteria with a score each and a total',
  options: 'Choices side by side with their numbers',
};
export function boardTables(def: AppDef) {
  const tm = def.team,
    out: string[] = [];
  if (!tm) return out;
  tm.agents.forEach((a) =>
    [a.writes, a.updates].forEach((n) => {
      if (n && n !== tm.input.table && !out.includes(n)) out.push(n);
    }),
  );
  return out;
}

/* ---------- the board as data: normalise the advisor's answer, or suggest one by rule ---------- */
export function normPanel(p: Untrusted, def: AppDef, kid?: boolean): BoardPanel | null {
  p = p || {};
  const agents = def.team ? def.team.agents : [],
    t = tableOf(def, snake(p.table));
  if (!t || !boardTables(def).includes(t.name)) return null;
  const col = (n: unknown, types: string[]) => {
    const c = n ? colOf(t, snake(n)) : null;
    return c && types.includes(c.type) ? c.name : null;
  };
  const o: BoardPanel = {
    table: t.name,
    layout: BOARD_LAYOUTS.includes(p.layout) ? p.layout : 'list',
    title: str(p.title).slice(0, 60) || t.label,
    by: col(p.by, ['select']),
    badge: col(p.badge, ['select']),
    text: col(p.text, ['longtext', 'text']),
    tag: col(p.tag, ['select', 'user']),
    meter: col(p.meter, ['number']),
    rank: col(p.rank, ['select', 'number', 'money']),
    score: col(p.score, ['number']),
    weight: col(p.weight, ['number']),
    max: +p.max > 0 ? +p.max : 0,
    link: col(p.link, ['text']),
    flag: col(p.flag, ['bool']),
    loose: col(p.loose, ['ref']),
    reply: null,
    facts: arr(p.facts)
      .map((n) => col(n, ['number', 'money', 'date', 'select']))
      .filter((n): n is string => !!n)
      .slice(0, 3),
    sides: [],
    only: [],
    children: null,
  };
  const rp = p.reply ? colOf(t, snake(p.reply)) : null;
  if (rp && rp.type === 'ref' && rp.ref === t.name) o.reply = rp.name;
  const by = o.by;
  if (by) {
    const opts = colOf(t, by)?.options || [];
    o.only = arr(p.only)
      .map(snake)
      .filter((v) => opts.includes(v));
    o.sides = arr(p.sides)
      .map(snake)
      .filter((v, i, a) => opts.includes(v) && a.indexOf(v) === i)
      .slice(0, 2);
  }
  if (o.layout === 'versus') {
    if (by && o.sides.length < 2) {
      const fx = agents.filter((a) => a.writes === t.name && a.fixed && a.fixed[by]).map((a) => String(a.fixed[by]));
      o.sides = fx
        .concat(colOf(t, by)?.options || [])
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 2);
    }
    if (!o.by || o.sides.length < 2) o.layout = o.by ? 'groups' : 'list';
  }
  if (o.layout === 'groups' && !o.by) o.layout = 'list';
  if (o.layout === 'scores' && !o.score) o.layout = 'list';
  if (o.layout === 'options' && !o.facts.length) o.layout = 'list';
  const k = p.children;
  if (k && !kid) {
    const kt = tableOf(def, snake(k.table)),
      via =
        kt && kt.name !== t.name
          ? kt.columns.find((c) => c.type === 'ref' && c.ref === t.name && (!k.via || c.name === snake(k.via)))
          : undefined,
      kp = via
        ? normPanel(
            Object.assign({}, k, {
              layout: 'list',
              children: null,
            }),
            def,
            true,
          )
        : null;
    if (kp && via)
      o.children = Object.assign(kp, {
        via: via.name,
      });
  }
  return o;
}
export function suggestBoard(def: AppDef): Board {
  // what code lays out when the View advisor gives nothing usable
  const tm = def.team;
  if (!tm)
    return {
      by: 'rules',
      why: 'This app has no agents of its own.',
      verdict: { pick: null, meter: null, text: null, date: null },
      panels: [],
    };
  const it = tableOf(def, tm.input.table),
    tabs = boardTables(def)
      .map((n) => tableOf(def, n))
      .filter((t): t is AppTable => !!t),
    sets = tm.agents
      .flatMap((a) => a.sets)
      .map((n) => colOf(it, n))
      .filter((c): c is ColumnDef => !!c);
  const parentOf = (t: AppTable) => tabs.find((p) => p.name !== t.name && t.columns.some((c) => c.type === 'ref' && c.ref === p.name)),
    viaOf = (t: AppTable, p: AppTable) => t.columns.find((c) => c.type === 'ref' && c.ref === p.name);
  const first = (t: AppTable, types: string[], skip?: string[]) =>
      t.columns.find((c) => types.includes(c.type) && c.name !== t.title && !(skip || []).includes(c.name))?.name || null,
    base = (t: AppTable): Dict<unknown> => ({
      table: t.name,
      title: t.label,
      badge: first(t, ['select']),
      text: first(t, ['longtext']),
      meter: first(t, ['number']),
    }),
    panels: Dict<unknown>[] = [];
  tabs.forEach((t) => {
    const parent = parentOf(t),
      via = parent && viaOf(t, parent);
    if (parent && via && via.required) return; // always drawn under its parent
    const fx: Dict<unknown[]> = {};
    tm.agents.forEach((a) => {
      if (a.writes === t.name)
        Object.keys(a.fixed || {}).forEach((k) => {
          (fx[k] = fx[k] || []).push(a.fixed[k]);
        });
    });
    const vs = Object.keys(fx).find((k) => colOf(t, k)?.type === 'select' && new Set(fx[k]).size >= 2),
      sc = t.columns.find((c) => c.type === 'number' && /score|rating|points|mark/.test(c.name)),
      kids = tabs.filter((k) => parentOf(k) === t),
      sel = first(t, ['select']),
      p = base(t);
    if (vs)
      Object.assign(p, {
        layout: 'versus',
        by: vs,
        sides: fx[vs],
        badge: first(t, ['select'], [vs]),
        reply: t.columns.find((c) => c.type === 'ref' && c.ref === t.name)?.name,
      });
    else if (sc)
      Object.assign(p, {
        layout: 'scores',
        score: sc.name,
        weight: t.columns.find((c) => c.type === 'number' && /weight/.test(c.name))?.name,
        meter: null,
      });
    else if (kids.length)
      Object.assign(p, {
        layout: 'list',
        children: Object.assign(base(kids[0]), {
          via: viaOf(kids[0], t)?.name,
        }),
      });
    else if (sel)
      Object.assign(p, {
        layout: 'groups',
        by: sel,
        badge: null,
        loose: via ? via.name : null,
        title: via ? 'Other ' + t.label.toLowerCase() : t.label,
      });
    else p.layout = 'list';
    panels.push(p);
  });
  const pick = (types: string[]) => sets.find((c) => types.includes(c.type))?.name || null;
  return {
    by: 'rules',
    why: 'Laid out by rule from the tables the agents write.',
    verdict: {
      pick: pick(['select']),
      meter: pick(['number']),
      text: pick(['longtext', 'text']),
      date: pick(['date', 'datetime']),
    },
    panels: panels
      .map((p) => normPanel(p, def))
      .filter((p): p is BoardPanel => !!p)
      .slice(0, 4),
  };
}
export function normBoard(o: Untrusted, def: AppDef): Board | null {
  const tm = def.team;
  if (!tm) return null;
  const sug = suggestBoard(def),
    panels = arr(o && o.panels)
      .map((p) => normPanel(p, def))
      .filter((p): p is BoardPanel => !!p)
      .slice(0, 4);
  if (!panels.length) return sug;
  const it = tableOf(def, tm.input.table),
    sets = tm.agents.flatMap((a) => a.sets),
    v = o.verdict || {},
    vc = (n: unknown, types: string[]) => {
      const c = n ? colOf(it, snake(n)) : null;
      return c && types.includes(c.type) && sets.includes(c.name) ? c.name : null;
    };
  return {
    by: 'views',
    why: str(o.why).slice(0, 240) || sug.why,
    verdict: {
      pick: vc(v.pick, ['select']) || sug.verdict.pick,
      meter: vc(v.meter, ['number']) || sug.verdict.meter,
      text: vc(v.text, ['longtext', 'text']) || sug.verdict.text,
      date: vc(v.date, ['date', 'datetime']) || sug.verdict.date,
    },
    panels,
  };
}
export const boardText = (b: Board | null | undefined) =>
  b ? b.panels.map((p) => label(p.layout) + ' of ' + p.table + (p.children ? ' with ' + p.children.table : '')).join(', ') : '';
export function checkBoard(def: AppDef, b: Board) {
  const names = boardTables(def),
    shown = b.panels.map((p) => p.table).concat(b.panels.flatMap((p) => (p.children ? [p.children.table] : []))),
    miss = names.filter((n) => !shown.includes(n));
  return chk(
    "The agent room shows everything the app's own agents write",
    !miss.length,
    miss.length ? 'no panel for ' + miss.join(', ') : boardText(b),
  );
}
