import { render } from '@/platform/dom';
import type {
  AppDef,
  AppTable,
  BackedDef,
  BriefedDef,
  Check,
  ColumnDef,
  Dash as DashSpec,
  DashWidget,
  DashWidgetKind,
  Screen,
  TourStep,
  Untrusted,
  ViewSpec,
} from '@/shared/types/app';
import type { AppRecord, Dict } from '@/shared/types/workspace';
import { ICONS } from './icons';
import { arr, errText, label, snake, str } from './core';
import { ACCENTS, LIMITS, VIEW_ICON, VIEW_LABEL, VIEW_TYPES, accOf, appUsers, chk, colOf, mainTable, roleName, tableOf } from './engine';
import { canRunTeam } from './team';
import { suggestBoard } from './room';
import { STATIONS, blankLine } from './line';
import { normFlow } from './custom';
import { REVIEWERS } from './reviewers';
import { newPane } from './runtime';
import { Explorer } from './views-a';
import { Dash } from './views-b';

/* ===== Turnkey prototype · the view catalog, the View advisor's output, screens =====
   The catalog is a registry: a view is one component plus one rule that says which tables it fits.
   The View advisor agent recommends views per table; code checks every recommendation against the rule. */
export const DATA_VIEWS: readonly string[] = ['table', 'board', 'calendar', 'timeline', 'chart', 'pivot', 'tree', 'cards'];
export const VIEW_ALIAS: Dict<string> = {
  list: 'table',
  grid: 'table',
  kanban: 'board',
  graph: 'chart',
  charts: 'chart',
  hierarchy: 'tree',
  gallery: 'cards',
  card: 'cards',
  gantt: 'timeline',
  schedule: 'calendar',
};
export const VIEW_WHAT: Dict<string> = {
  table: 'Rows and columns with sorting, grouping and totals',
  board: 'Cards in columns, moved by drag and drop',
  calendar: 'Records on the days they happen',
  timeline: 'Bars across time, one lane per group',
  chart: 'Counts and sums by category or over time',
  pivot: 'Two fields crossed, with totals',
  tree: 'Records nested under groups or parents',
  cards: 'A gallery of records for scanning',
};
export const isCat = (c: ColumnDef) => ['select', 'user', 'ref', 'bool'].includes(c.type),
  isDate = (c: ColumnDef) => c.type === 'date' || c.type === 'datetime',
  isNum = (c: ColumnDef) => c.type === 'number' || c.type === 'money',
  /** A number that names something rather than counts it, like a year: shown without a thousands separator, never summed. */
  isYear = (c: ColumnDef) => c.type === 'number' && /(^|_)year$/.test(c.name),
  /** A number that adds up: what totals, sums and averages use. */
  isMeasure = (c: ColumnDef) => isNum(c) && !isYear(c),
  /** A score, rate or price per unit on each record (rating, confidence, unit price, hourly rate): adding them up means nothing, so a total row averages them. */
  isRate = (c: ColumnDef) =>
    isMeasure(c) &&
    /(^|_)(rating|score|confidence|chance|accuracy|share|margin|weight|percent|pct|rate|unit_price|price_each)$/.test(c.name);
export function viewFit(def: AppDef, t: AppTable, type: string): string | null {
  // null when the view fits the table, otherwise the reason it does not
  const cats = t.columns.filter(isCat).length,
    dates = t.columns.filter(isDate).length,
    sels = t.columns.filter((c) => c.type === 'select').length;
  switch (type) {
    case 'table':
    case 'cards':
      return null;
    case 'board':
      return sels ? null : 'needs a choice field to make the columns';
    case 'calendar':
    case 'timeline':
      return dates ? null : 'needs a date field';
    case 'chart':
      return cats || dates ? null : 'needs a category or a date to plot';
    case 'pivot':
      return cats >= 2 ? null : 'needs two category fields to cross';
    case 'tree':
      return cats ? null : 'needs a category or a link to nest by';
    default:
      return 'is not in the view catalog';
  }
}
export const guessEnd = (t: AppTable, start: string | null) => {
  const c = t.columns.find((x) => x.type === 'date' && x.name !== start && /end|until|due|finish/.test(x.name));
  return c ? c.name : null;
};
export const normMeasure = (t: AppTable, m: unknown) => {
  const x = /^(sum|avg):(.+)$/.exec(String(m || ''));
  const c = x && colOf(t, snake(x[2]));
  return x && c && isMeasure(c) ? x[1] + ':' + snake(x[2]) : 'count';
};
/** The columns a view of a table needs (`by`, `date`, `x` and so on), keeping the advisor's choices that are valid. */
export type ViewCfg = Dict<string | string[] | null>;
export function viewCfg(def: AppDef, t: AppTable, type: string, u: Untrusted): ViewCfg {
  // fills in the columns a view needs, keeping the advisor's choices when they are valid
  u = u || {};
  const P = def.process && def.process.table === t.name ? def.process : null,
    status = P ? P.column : null;
  const col = (n: unknown, test?: (c: ColumnDef) => boolean) => {
    const c = colOf(t, snake(n));
    return c && (!test || test(c)) ? c.name : null;
  };
  const cats = t.columns.filter(isCat),
    dates = t.columns.filter(isDate),
    sels = t.columns.filter((c) => c.type === 'select'),
    self = t.columns.find((c) => c.type === 'ref' && c.ref === t.name);
  const firstCat = (skip?: string | null) =>
    (cats.find((c) => c.name !== skip && c.type !== 'bool' && c.name !== (self && self.name)) || cats.find((c) => c.name !== skip))?.name ||
    null;
  switch (type) {
    case 'board':
      return {
        by: col(u.by || u.group, (c) => c.type === 'select') || status || (sels[0] || {}).name || null,
        lane: col(u.lane, isCat),
      };
    case 'calendar': {
      const d = col(u.date, isDate) || (dates[0] || {}).name || null;
      return {
        date: d,
        end: col(u.end, (c) => c.type === 'date') || guessEnd(t, d),
      };
    }
    case 'timeline': {
      const s = col(u.start || u.date, isDate) || (dates[0] || {}).name || null;
      return {
        start: s,
        end: col(u.end, isDate) || guessEnd(t, s),
        lane: col(u.lane, isCat) || (cats.find((c) => c.type === 'user') || cats.find((c) => c.name !== status) || {}).name || null,
      };
    }
    case 'chart':
      return {
        kind: ['bar', 'stack', 'line', 'area'].includes(u.kind) ? u.kind : null,
        x: col(u.x, (c) => isCat(c) || isDate(c)) || status || firstCat() || (dates[0] || {}).name || null,
        split: col(u.split, isCat),
        measure: normMeasure(t, u.measure),
        bucket: ['day', 'week', 'month'].includes(u.bucket) ? u.bucket : 'day',
      };
    case 'pivot': {
      const r = col(u.rows, isCat) || firstCat(status) || status;
      return {
        rows: r,
        cols: col(u.cols, isCat) || (status && status !== r ? status : firstCat(r)),
        measure: normMeasure(t, u.measure),
      };
    }
    case 'tree': {
      const lv = arr(u.levels)
        .map((n) => col(n, isCat))
        .filter((n): n is string => !!n)
        .slice(0, 3);
      return {
        parent: self ? self.name : null,
        levels: lv.length ? lv : [firstCat(status), status].filter((n): n is string => !!n).slice(0, 2),
      };
    }
    default:
      return {};
  }
}
export function normDashWidget(w: Untrusted, def: AppDef): DashWidget | null {
  w = w || {};
  const kind: DashWidgetKind | null = ['kpi', 'bar', 'stack', 'line', 'recent'].includes(w.kind)
      ? w.kind
      : w.kind === 'count' || w.kind === 'sum'
        ? 'kpi'
        : w.kind === 'by'
          ? 'bar'
          : null,
    t = tableOf(def, snake(w.table));
  if (!kind || !t) return null;
  const x = colOf(t, snake(w.x || w.column)),
    split = colOf(t, snake(w.split)),
    where: Dict<unknown> = {};
  if (w.where && typeof w.where === 'object')
    Object.keys(w.where).forEach((k) => {
      const c = colOf(t, snake(k));
      if (c) where[c.name] = c.type === 'select' ? snake(w.where[k]) : w.where[k];
    });
  if ((kind === 'bar' || kind === 'stack') && !(x && isCat(x))) return null;
  if (kind === 'line' && !(x && isDate(x))) return null;
  if (kind === 'stack' && !(split && isCat(split))) return null;
  return {
    kind,
    label: str(w.label) || label(kind + ' ' + t.name),
    table: t.name,
    x: x ? x.name : null,
    split: split ? split.name : null,
    measure: normMeasure(t, w.measure || (w.kind === 'sum' && w.column ? 'sum:' + w.column : '')),
    bucket: ['day', 'week', 'month'].includes(w.bucket) ? w.bucket : 'day',
    where,
  };
}
/** The View advisor's answer, once normalised. */
export interface ViewsDraft {
  views: Dict<ViewSpec[]>;
  dash: DashSpec;
  dropped: number;
}
export function normViews(o: Untrusted, def: AppDef): ViewsDraft {
  o = o || {};
  const views: Dict<ViewSpec[]> = {},
    d = o.dashboard || {};
  def.tables.forEach((t) => {
    views[t.name] = [];
  });
  arr(o.views).forEach((v) => {
    const t = tableOf(def, snake(v && v.table));
    if (!t) return;
    arr(v.use).forEach((u: Untrusted) => {
      u =
        typeof u === 'string'
          ? {
              type: u,
            }
          : u || {};
      let type = String(u.type || '').toLowerCase();
      type = VIEW_ALIAS[type] || type;
      if (!type || views[t.name].some((x) => x.type === type)) return;
      views[t.name].push(
        Object.assign(
          {
            type,
            why: str(u.why) || VIEW_WHAT[type] || '',
          },
          DATA_VIEWS.includes(type) && !viewFit(def, t, type) ? viewCfg(def, t, type, u) : {},
        ),
      );
    });
  });
  def.tables.forEach((t) => {
    if (!views[t.name].some((x) => x.type === 'table'))
      views[t.name].push({
        type: 'table',
        why: VIEW_WHAT.table,
      });
  });
  const dt = tableOf(def, snake(d.date && d.date.table)),
    dc = dt && colOf(dt, snake(d.date.column)),
    all = arr(d.widgets),
    widgets = all
      .map((w) => normDashWidget(w, def))
      .filter((w): w is DashWidget => !!w)
      .slice(0, 10);
  return {
    views,
    dash: {
      title: str(d.title) || 'Dashboard',
      date:
        dc && isDate(dc)
          ? {
              table: dt.name,
              column: dc.name,
            }
          : null,
      widgets,
    },
    dropped: all.length - widgets.length,
  };
}
/**
 * A table the advisor said nothing useful about (only the table view, which every table gets) is given the views that
 * fit it by rule, on every attempt: a missing answer is filled in rather than sent back for another model call.
 * Views that do not fit are still the advisor's to fix.
 */
export function fillThinViews(vw: ViewsDraft, def: BackedDef): ViewsDraft {
  const thin = def.tables.filter((t) => vw.views[t.name].length < 2);
  if (!thin.length) return vw;
  const sug = normViews(suggestViews(def), def);
  thin.forEach((t) => {
    const have = vw.views[t.name];
    vw.views[t.name] = have.concat(sug.views[t.name].filter((v) => !have.some((k) => k.type === v.type)));
  });
  return vw;
}
export function mendViews(o: Untrusted, def: BackedDef) {
  // last attempt: keep what fits from the advisor's answer and fill the gaps by rule, instead of failing the build
  const vw = normViews(o, def),
    sug = normViews(suggestViews(def), def);
  def.tables.forEach((t) => {
    const ok = vw.views[t.name].filter((v) => !viewFit(def, t, v.type));
    vw.views[t.name] = ok.length >= 2 ? ok : ok.concat(sug.views[t.name].filter((v) => !ok.some((k) => k.type === v.type)));
  });
  if (!vw.dash.widgets.some((w) => w.kind === 'kpi') || !vw.dash.widgets.some((w) => ['bar', 'stack', 'line'].includes(w.kind)))
    vw.dash = sug.dash;
  return vw;
}
export function checkViews(def: AppDef, vw: ViewsDraft) {
  const out: Check[] = [],
    thin = def.tables.filter((t) => vw.views[t.name].length < 2).map((t) => t.label),
    misfit: string[] = [];
  def.tables.forEach((t) =>
    vw.views[t.name].forEach((v) => {
      const why = viewFit(def, t, v.type);
      if (why) misfit.push(label(v.type) + ' on ' + t.name + ' ' + why);
    }),
  );
  out.push(
    chk(
      'Every table can be seen in at least two ways',
      !thin.length,
      thin.length ? 'only one view for ' + thin.join(', ') : def.tables.map((t) => t.label + ': ' + vw.views[t.name].length).join(', '),
    ),
  );
  out.push(
    chk(
      'Every recommended view fits its table',
      !misfit.length,
      misfit.length ? misfit.slice(0, 3).join('; ') : 'checked against the catalog rules',
    ),
  );
  const k = vw.dash.widgets.filter((w) => w.kind === 'kpi').length,
    c = vw.dash.widgets.filter((w) => w.kind === 'bar' || w.kind === 'stack' || w.kind === 'line').length;
  // lists of plain text only (no choice, link, person, yes/no or date field anywhere) have nothing a chart could show
  const chartable = def.tables.some((t) => t.columns.some((col) => isCat(col) || isDate(col)));
  out.push(
    chk(
      'The dashboard has numbers and charts',
      k >= 1 && (c >= 1 || !chartable),
      k +
        ' numbers, ' +
        c +
        ' charts' +
        (vw.dropped ? ', ' + vw.dropped + ' unusable widgets left out' : '') +
        (chartable ? '' : ' (nothing to chart by)'),
    ),
  );
  return out;
}
export function suggestViews(def: BackedDef) {
  // the rule-based plan: used when the advisor cannot pass, and for tables added later
  const P = def.process,
    staged = P.states.length > 0,
    pt = mainTable(def) as AppTable,
    views = def.tables.map((t) => ({
      table: t.name,
      use: DATA_VIEWS.filter((v) => !viewFit(def, t, v)).map((v) => ({
        type: v,
      })),
    }));
  const cat = pt.columns.find((c) => isCat(c) && c.name !== P.column),
    date = pt.columns.find(isDate),
    amount = pt.columns.find((c) => c.type === 'money' || c.type === 'number'),
    w: Dict<unknown>[] = [
      {
        kind: 'kpi',
        label: pt.label,
        table: pt.name,
      },
    ];
  P.states.slice(0, 3).forEach((s) =>
    w.push({
      kind: 'kpi',
      label: s.label,
      table: pt.name,
      where: {
        [P.column]: s.id,
      },
    }),
  );
  if (staged)
    w.push({
      kind: 'bar',
      label: pt.label + ' by ' + label(P.column).toLowerCase(),
      table: pt.name,
      x: P.column,
    });
  else {
    // no stages to count by: the total of what is added up, and the list by its first category
    if (amount)
      w.push({
        kind: 'kpi',
        label: /^total\b/i.test(String(amount.label || label(amount.name)))
          ? String(amount.label || label(amount.name))
          : 'Total ' + String(amount.label || label(amount.name)).toLowerCase(),
        table: pt.name,
        measure: 'sum:' + amount.name,
      });
    if (cat) w.push({ kind: 'bar', label: pt.label + ' by ' + String(cat.label).toLowerCase(), table: pt.name, x: cat.name });
  }
  if (date)
    w.push({
      kind: 'line',
      label: pt.label + ' over time',
      table: pt.name,
      x: date.name,
      bucket: 'day',
    });
  if (cat && staged)
    w.push({
      kind: 'stack',
      label: pt.label + ' by ' + String(cat.label).toLowerCase(),
      table: pt.name,
      x: cat.name,
      split: P.column,
    });
  if (!w.some((x) => x.kind === 'bar' || x.kind === 'line' || x.kind === 'stack')) {
    // the main list has nothing to chart by: chart the first list that has
    const other = def.tables.find((t) => t.columns.some((c) => isCat(c) || isDate(c)));
    const by = other && (other.columns.find(isCat) || other.columns.find(isDate));
    if (other && by)
      w.push(
        isCat(by)
          ? { kind: 'bar', label: other.label + ' by ' + String(by.label || label(by.name)).toLowerCase(), table: other.name, x: by.name }
          : { kind: 'line', label: other.label + ' over time', table: other.name, x: by.name, bucket: 'day' },
      );
  }
  w.push({
    kind: 'recent',
    label: 'Latest ' + pt.label.toLowerCase(),
    table: pt.name,
  });
  return {
    views,
    dashboard: {
      title: 'Dashboard',
      date: date
        ? {
            table: pt.name,
            column: date.name,
          }
        : null,
      widgets: w,
    },
  };
}
export function refreshViews(app: AppRecord & { def: BackedDef }) {
  // after a change to the tables: keep the advisor's plan where it still fits, and fill the gaps by rule
  const def = app.def,
    sug = suggestViews(def),
    ruleFor = (t: AppTable) =>
      (
        sug.views.find((v) => v.table === t.name) || {
          use: [],
        }
      ).use;
  const use = (t: AppTable): { type: string }[] => {
    const kept: { type: string }[] = ((def.views || {})[t.name] || []).filter((v) => !viewFit(def, t, v.type));
    return kept.length >= 2 ? kept : kept.concat(ruleFor(t).filter((v) => !kept.some((k) => k.type === v.type)));
  };
  let vw = normViews(
    {
      views: def.tables.map((t) => ({
        table: t.name,
        use: use(t),
      })),
      dashboard: def.dash || sug.dashboard,
    },
    def,
  );
  if (checkViews(def, vw).some((c) => !c.ok))
    vw = normViews(
      {
        views: def.tables.map((t) => ({
          table: t.name,
          use: use(t),
        })),
        dashboard: sug.dashboard,
      },
      def,
    );
  def.views = vw.views;
  def.dash = vw.dash;
  return vw;
}
export function migrateApp(app: AppRecord) {
  // apps saved by an earlier version of this page get what the View advisor would have written
  app.flow = normFlow(app.flow);
  if (!app.reviews) app.reviews = {}; // and the standard workflow, which is theirs to change
  Object.keys(app.reviews).forEach((k) => {
    const R = app.reviews[k];
    if (!(REVIEWERS as Dict<unknown>)[k] || !R || R.status !== 'ok' || !app.flow.reviewers.includes(k)) delete app.reviews[k];
    else
      arr(R.findings).forEach((f) => {
        if (f.state === 'applying') f.state = 'open';
      });
  }); // a review that was cut off by a reload is dropped
  const def = app.def;
  if (!def || !def.theme) return;
  STATIONS.forEach((s) => {
    if (!app.line[s.id]) app.line[s.id] = blankLine();
  });
  if (def.team === undefined) def.team = null;
  if (def.team && !def.board && def.tables.length && def.process) def.board = suggestBoard(def);
  if (!def.team) def.board = null;
  if (!def.theme.density) def.theme.density = 'comfortable';
  if (!def.views) def.views = {};
  if (def.screens.length && def.screens[0].type !== 'dashboard' && def.screens.some((s) => s.type === 'dashboard'))
    def.screens.sort((a, b) => Number(b.type === 'dashboard') - Number(a.type === 'dashboard')); // the overview comes first
  if (!def.process || !def.tables.length || !def.brief || (def.dash && Object.keys(def.views).length)) return;
  const vw = refreshViews(app as AppRecord & { def: BackedDef }),
    L = app.line.views,
    roleIds = def.brief.roles.map((r) => r.id);
  let dash = def.screens.find((s) => s.type === 'dashboard');
  if (!dash) {
    dash = {
      id: 's' + (def.screens.length + 301),
      name: 'Dashboard',
      type: 'dashboard',
      table: (mainTable(def) as AppTable).name,
      roles: [],
      columns: [],
      icon: 'pie',
      auto: true,
    };
    def.screens.push(dash);
  }
  roleIds.forEach((r) => {
    if (!def.screens.some((s) => s.type === 'dashboard' && s.roles.includes(r))) dash.roles.push(r);
  });
  if (app.line.backend.status === 'ok') {
    L.status = 'ok';
    L.attempt = 1;
    L.checks = checkViews(def, vw);
    L.facts = [
      Object.keys(vw.views).reduce((k, t) => k + vw.views[t].length, 0) + ' views for ' + def.tables.length + ' tables',
      vw.dash.widgets.length + ' dashboard widgets',
    ];
    L.attempts = [
      {
        n: 1,
        ok: true,
        issues: [],
      },
    ];
    L.note = 'Added by the update';
  }
  app.rev = (app.rev || 0) + 1;
}
export function viewsOf(def: AppDef, t: AppTable): ViewSpec[] {
  const v = (def.views && def.views[t.name]) || [];
  return v.length
    ? v
    : [
        {
          type: 'table',
          why: VIEW_WHAT.table,
        },
      ];
}
export function renderViewsTest(app: AppRecord) {
  // mount every recommended view of every table, and the dashboard, with the real data
  const def = app.def,
    users = appUsers(app),
    host = document.createElement('div'),
    fails: string[] = [];
  let n = 0;
  def.tables.forEach((t) => {
    const u = users.find((x) => accOf(def, x.role, t.name).list !== 'none');
    if (!u) return;
    viewsOf(def, t).forEach((v) => {
      n++;
      const scr = {
        id: 'vt_' + t.name,
        name: t.label,
        type: v.type,
        table: t.name,
        roles: [u.role],
        columns: t.columns.slice(0, 6).map((c) => c.name),
      };
      try {
        render(
          <div className="app">
            <Explorer app={app} user={u} pane={newPane(9)} scr={scr} test />
          </div>,
          host,
        );
        if (!host.querySelector('.vx-body')) throw new Error('nothing drawn');
      } catch (e) {
        fails.push(label(v.type) + ' on ' + t.name + ': ' + errText(e));
      }
    });
  });
  const boss = users[users.length - 1];
  if (boss) {
    n++;
    try {
      render(
        <div className="app">
          <Dash
            app={app}
            user={boss}
            pane={newPane(9)}
            scr={{
              id: 'vt_dash',
              name: 'Dashboard',
              type: 'dashboard',
            }}
            test
          />
        </div>,
        host,
      );
      if (!host.querySelector('.dash')) throw new Error('nothing drawn');
    } catch (e) {
      fails.push('Dashboard: ' + errText(e));
    }
  }
  try {
    render(null, host);
  } catch {}
  return chk(
    'Every view and the dashboard draw with the real data',
    !fails.length,
    fails.length ? fails.slice(0, 3).join('; ') : n + ' views mounted',
  );
}

/* ---------- screens: which pages each role gets, and the layout ---------- */
export const mayOpen = (def: AppDef, r: string, type: string, tn: string) =>
  type === 'dashboard'
    ? true
    : type === 'agents'
      ? canRunTeam(def, r)
      : type === 'form'
        ? accOf(def, r, tn).create
        : accOf(def, r, tn).list !== 'none';
/** The UI agent's answer, once normalised. */
export interface UIDraft {
  theme: AppDef['theme'];
  screens: Screen[];
  tour: TourStep[];
  actions: AppDef['actions'];
}
export function normUI(o: Untrusted, def: BackedDef): UIDraft {
  o = o || {};
  const roleIds = def.brief.roles.map((r) => r.id),
    th = o.theme || {};
  let n = 0;
  const screens: Screen[] = arr(o.screens)
    .map((s: Untrusted): Screen | null => {
      s = s || {};
      let type = String(s.type || 'table').toLowerCase();
      type = VIEW_ALIAS[type] || type;
      if (!VIEW_TYPES.includes(type)) type = 'table';
      if (type === 'agents' && !def.team) return null;
      const t =
        tableOf(def, snake(s.table)) ||
        (type === 'dashboard' ? mainTable(def) : type === 'agents' && def.team ? tableOf(def, def.team.input.table) : null);
      if (t && DATA_VIEWS.includes(type) && viewFit(def, t, type)) type = 'table';
      const scr: Screen = {
        id: 's' + ++n,
        name: str(s.name) || (t ? t.label : 'Screen ' + n),
        type,
        table: t ? t.name : snake(s.table),
        roles: arr(s.roles)
          .map(snake)
          .filter((r) => roleIds.includes(r)),
        columns: t
          ? arr(s.columns)
              .map(snake)
              .filter((c) => colOf(t, c))
          : [],
        icon: (ICONS as Dict<string>)[s.icon] ? s.icon : VIEW_ICON[type],
      };
      if (t) scr.roles = (scr.roles.length ? scr.roles : roleIds).filter((r) => mayOpen(def, r, type, t.name));
      if (t && !(scr.columns || []).length)
        scr.columns = t.columns
          .filter((c) => c.type !== 'longtext')
          .slice(0, 6)
          .map((c) => c.name);
      if (t) {
        const lb = colOf(t, snake(s.label)),
          g = colOf(t, snake(s.group)),
          d = colOf(t, snake(s.date)),
          e = colOf(t, snake(s.end));
        if (lb) scr.label = lb.name;
        if (g && g.type === 'select') scr.group = g.name;
        if (d && isDate(d)) scr.date = d.name;
        if (e && e.type === 'date') scr.end = e.name;
        if (['today', 'week', 'upcoming'].includes(s.range)) {
          const rd = scr.date || (t.columns.find(isDate) || {}).name;
          if (rd) {
            scr.range = s.range;
            scr.date = rd;
          }
        }
      }
      return scr;
    })
    .filter((s): s is Screen => !!s)
    .slice(0, LIMITS.screens);
  const team = def.team;
  if (team && !screens.some((s) => s.type === 'agents'))
    screens.unshift({
      id: 's' + ++n,
      name: 'Agents',
      type: 'agents',
      table: team.input.table,
      roles: roleIds.filter((r) => canRunTeam(def, r)),
      columns: [],
      icon: 'bot',
      auto: true,
    });
  let dash = screens.find((s) => s.type === 'dashboard'); // a dashboard is always there, for every role
  if (!dash) {
    dash = {
      id: 's' + ++n,
      name: (def.dash && def.dash.title) || 'Dashboard',
      type: 'dashboard',
      table: (mainTable(def) as AppTable).name,
      roles: [],
      columns: [],
      icon: 'pie',
      auto: true,
    };
    screens.push(dash);
  }
  roleIds.forEach((r) => {
    if (!screens.some((s) => s.type === 'dashboard' && s.roles.includes(r))) dash.roles.push(r);
  });
  // two pages with one name read as one page in the menu: the overview keeps its name, a later page takes its table's
  const named = new Set<string>();
  [dash, ...screens.filter((s) => s !== dash)].forEach((s) => {
    const t = tableOf(def, s.table),
      base = s.name;
    let k = 2;
    if (named.has(s.name.toLowerCase()) && t && !named.has(t.label.toLowerCase())) s.name = t.label;
    while (named.has(s.name.toLowerCase())) s.name = base + ' ' + k++;
    named.add(s.name.toLowerCase());
  });
  screens.sort((a, b) => Number(b.type === 'dashboard') - Number(a.type === 'dashboard')); // the overview comes first, for everyone
  const tour: TourStep[] = arr(o.tour)
    .map((x: Untrusted) => {
      x = x || {};
      return {
        role: snake(x.role),
        user: str(x.user).toLowerCase() || null,
        do: ['open', 'create', 'see', 'transition', 'denied'].includes(x.do) ? x.do : 'open',
        screen: str(x.screen),
        table: snake(x.table),
        values: x.values && typeof x.values === 'object' ? x.values : {},
        transition: snake(x.transition),
        action: snake(x.action),
        say: str(x.say),
      };
    })
    .filter((x) => roleIds.includes(x.role))
    // with only one kind of person there is nobody else to be refused, so a "denied" step can never pass
    .filter((x) => x.do !== 'denied' || roleIds.length > 1)
    .slice(0, 10);
  const actions = arr(o.actions)
    .map((a: Untrusted) => ({
      id: snake(a.id || a.label),
      label: str(a.label),
      table: snake(a.table),
      connector: str(a.connector),
      tool: str(a.tool),
      arg: snake(a.arg),
    }))
    .filter((a) => a.id && tableOf(def, a.table));
  return {
    theme: {
      accent: ACCENTS.includes(th.accent) ? th.accent : 'blue',
      nav: ['top', 'rail', 'side'].includes(th.nav) ? th.nav : 'side',
      icon: (ICONS as Dict<string>)[th.icon] ? th.icon : 'apps',
      density: th.density === 'compact' ? 'compact' : 'comfortable',
    },
    screens,
    tour,
    actions,
  };
}
export function checkScreensShape(def: BriefedDef, ui: Pick<UIDraft, 'screens'>) {
  const out: Check[] = [],
    S0 = ui.screens,
    roles = def.brief.roles;
  const ghost = S0.filter((s) => !tableOf(def, s.table)).map((s) => s.name);
  out.push(
    chk(
      'Every screen points at a real table and real columns',
      S0.length > 0 && !ghost.length,
      ghost.length ? 'no table behind: ' + ghost.join(', ') : S0.length + ' screens',
    ),
  );
  const lone = roles.filter((r) => !S0.some((s) => s.type !== 'dashboard' && s.roles.includes(r.id))).map((r) => r.name);
  out.push(chk('Every role has at least one working screen', !lone.length, lone.length ? 'no screen for ' + lone.join(', ') : ''));
  const misfit = S0.filter(
    (s) => DATA_VIEWS.includes(s.type) && tableOf(def, s.table) && viewFit(def, tableOf(def, s.table) as AppTable, s.type),
  ).map((s) => s.name + ' (' + s.type + ')');
  out.push(
    chk(
      'Each screen opens a view its table supports',
      !misfit.length,
      misfit.length
        ? misfit.join(', ')
        : S0.map((s) => VIEW_LABEL[s.type])
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(', '),
    ),
  );
  const leak: string[] = [];
  S0.forEach((s) => {
    if (!tableOf(def, s.table) || s.type === 'dashboard') return;
    s.roles.forEach((r) => {
      if (!mayOpen(def, r, s.type, s.table)) leak.push(s.name + ' for ' + roleName(def, r));
    });
    if (!s.roles.length) leak.push(s.name + ' has no roles');
  });
  out.push(
    chk('Screens only show what the role may use', !leak.length, leak.length ? 'not permitted: ' + leak.slice(0, 4).join(', ') : ''),
  );
  const noDash = roles.filter((r) => !S0.some((s) => s.type === 'dashboard' && s.roles.includes(r.id))).map((r) => r.name);
  out.push(
    chk(
      'Every role can open the dashboard',
      !noDash.length,
      noDash.length ? 'missing for ' + noDash.join(', ') : 'a dashboard is always part of the app',
    ),
  );
  return out;
}
