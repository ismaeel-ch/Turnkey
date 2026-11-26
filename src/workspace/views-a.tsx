import { useState, useEffect, useRef, type DragEvent, type FormEvent, type FunctionComponent, type ReactNode } from 'react';
import type { AppDef, AppTable, AppUser, ColumnDef, Screen, StoredRow } from '@/shared/types/app';
import type { AppRecord, Dict, ExplorerState, Pane, ViewFilter, ViewOptions } from '@/shared/types/workspace';
import {
  MON,
  MONTH,
  S,
  clone,
  copyText,
  cx,
  dayDiff,
  fmtDate,
  fmtNum,
  fmtTime,
  isoDate,
  label,
  notify,
  parseISO,
  saveSoon,
  str,
  toast,
  today,
} from './core';
import { VIEW_ICON, VIEW_LABEL, accOf, apiCall, appUsers, colOf, roleName, tableOf } from './engine';
import { DATA_VIEWS, isCat, isDate, isNum, viewCfg, viewFit, viewsOf } from './viewspec';
import { Btn, Empty, FilterChip, Icon, Input, MBar, Menu, Seg, Select, type MenuEntry } from './ui';
import { Cell, cellText, fetchApi, isStatusCol, optLabel, rowTitle, stateLabel, stateTone } from './runtime';
import { VChart, VPivot, VTimeline } from './views-b';

/* ===== Turnkey prototype · the data explorer: one table, many views =====
   Every view below draws the same rows: the ones the API returned for this user, after the search box and the filters. */
export const OP_TEXT: Dict<string> = {
  is: 'is',
  not: 'is not',
  has: 'contains',
  gt: 'is more than',
  lt: 'is less than',
  before: 'is before',
  after: 'is after',
  range: 'is',
  between: 'is from',
  empty: 'is empty',
  filled: 'is filled',
};
export const RANGES: Dict<string> = {
  today: 'today',
  week: 'in the next 7 days',
  upcoming: 'today or later',
  past7: 'in the past 7 days',
  past30: 'in the past 30 days',
  month: 'this month',
};
/** A value read from a row, as the date helpers take it. */
export const asText = (v: unknown) => (v == null ? null : String(v));
/** The `[from, to]` dates of a `between` filter. */
export const span = (v: unknown): [string, string] => (Array.isArray(v) ? [String(v[0]), String(v[1])] : ['', '']);
/** A choice a category column can take, in its stable order. */
export interface Choice {
  key: string | number | null;
  label: string;
}
/** A filter to add when a mark of a chart or a cell of a pivot is selected: `op` defaults to `is` (or `empty`). */
export interface DrillPair {
  col: string;
  op?: string;
  val: unknown;
}
export const opsFor = (c: ColumnDef) =>
  isCat(c)
    ? ['is', 'not', 'empty', 'filled']
    : isDate(c)
      ? ['range', 'before', 'after', 'empty', 'filled']
      : isNum(c)
        ? ['gt', 'lt', 'is', 'empty']
        : ['has', 'empty', 'filled'];
export function inRange(v: unknown, r: unknown) {
  const s = asText(v);
  const n = dayDiff(s);
  if (n == null) return false;
  if (r === 'today') return n === 0;
  if (r === 'week') return n >= 0 && n < 7;
  if (r === 'upcoming') return n >= 0;
  if (r === 'past7') return n <= 0 && n > -7;
  if (r === 'past30') return n <= 0 && n > -30;
  const d = parseISO(s),
    t = today();
  return !!d && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
}
export function passes(f: ViewFilter, v: unknown) {
  const none = v == null || v === '';
  switch (f.op) {
    case 'empty':
      return none;
    case 'filled':
      return !none;
    case 'is':
      return !none && String(v) === String(f.val);
    case 'not':
      return String(v) !== String(f.val);
    case 'has':
      return !none && String(v).toLowerCase().indexOf(String(f.val).toLowerCase()) >= 0;
    case 'gt':
      return !none && Number(v) > Number(f.val);
    case 'lt':
      return !none && Number(v) < Number(f.val);
    case 'before':
      return !none && String(v).slice(0, 10) < String(f.val);
    case 'after':
      return !none && String(v).slice(0, 10) > String(f.val);
    case 'range':
      return !none && inRange(v, f.val);
    case 'between':
      return !none && String(v).slice(0, 10) >= span(f.val)[0] && String(v).slice(0, 10) <= span(f.val)[1];
    default:
      return true;
  }
}
export function catChoices(app: AppRecord, user: AppUser, c: ColumnDef & { _t?: string }): Choice[] {
  // the values a category column can take, in a stable order, so colours follow the value
  if (c.type === 'select')
    return (c.options || []).map((o) => ({
      key: o,
      label: stateLabel(
        app.def,
        {
          name: c._t || '',
        },
        c,
        o,
      ),
    }));
  if (c.type === 'bool')
    return [
      {
        key: 1,
        label: 'Yes',
      },
      {
        key: 0,
        label: 'No',
      },
    ];
  if (c.type === 'user')
    return appUsers(app)
      .filter((u) => !c.role || u.role === c.role)
      .map((u) => ({
        key: u.id,
        label: u.name,
      }));
  const rt = tableOf(app.def, c.ref),
    res = rt ? fetchApi(app, user, '/api/' + c.ref) : null;
  return rt && res && res.status === 200
    ? (res.data as StoredRow[])
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((r) => ({
          key: r.id,
          label: rowTitle(app, user, rt, r),
        }))
    : [];
}
export const choices = (app: AppRecord, user: AppUser, t: AppTable, c: ColumnDef) =>
  catChoices(
    app,
    user,
    Object.assign(
      {
        _t: t.name,
      },
      c,
    ),
  );
export const prefKey = (app: AppRecord, user: AppUser, scr: Pick<Screen, 'id'>) => app.id + '|' + user.id + '|' + scr.id;
/** The page fields `vxState` reads. A dashboard link may open a page by id alone. */
type PageRef = Pick<Screen, 'id' | 'type'> & Partial<Pick<Screen, 'range' | 'date'>>;
export function vxState(pane: Pane, scr: PageRef, app: AppRecord, user: AppUser, test?: boolean): ExplorerState {
  // how this person left this page: view, filters, sorting and options are kept with the app
  const all = pane.vs || (pane.vs = {});
  if (!all[scr.id]) {
    const saved =
      !test && !pane.test && app && user && S.prefs ? (S.prefs[prefKey(app, user, scr)] as Partial<ExplorerState> | undefined) : null;
    all[scr.id] = Object.assign(
      {
        view: scr.type,
        q: '',
        filters:
          scr.range && scr.date
            ? [
                {
                  col: scr.date,
                  op: 'range',
                  val: scr.range,
                },
              ]
            : [],
        sort: null,
        group: '',
        hidden: null,
        page: 0,
        closed: {},
        open: {},
        cfg: {},
        fd: null,
      },
      saved ? clone(saved) : {},
    );
  }
  return all[scr.id];
}
export function vxRemember(app: AppRecord, user: AppUser, scr: Screen, st: ExplorerState) {
  const P = S.prefs || (S.prefs = {});
  P[prefKey(app, user, scr)] = {
    view: st.view,
    filters: st.filters,
    sort: st.sort,
    group: st.group,
    hidden: st.hidden,
    cfg: st.cfg,
  };
  saveSoon();
}
export function vxCfg(def: AppDef, t: AppTable, scr: Screen, st: ExplorerState, type: string): ViewOptions {
  // the advisor's plan, then the page's presets, then what the person chose; every column is checked again
  const base: Dict<unknown> = Object.assign({}, viewsOf(def, t).find((v) => v.type === type) || {}),
    mine: ViewOptions = st.cfg[type] || {};
  if (type === 'board' && scr.group) base.by = scr.group;
  if ((type === 'calendar' || type === 'timeline') && scr.date) {
    base.date = scr.date;
    base.start = scr.date;
    if (scr.end) base.end = scr.end;
  }
  // viewCfg checks every column it keeps; its settings are the ViewOptions fields
  const o = viewCfg(def, t, type, Object.assign({}, base, mine)) as ViewOptions;
  (['split', 'lane', 'end'] as const).forEach((k) => {
    if (k in mine && mine[k] == null && k in o) o[k] = null;
  });
  if (type === 'tree' && Array.isArray(mine.levels))
    o.levels = mine.levels.filter((n) => {
      const c = colOf(t, n);
      return !!c && isCat(c);
    });
  if (mine.mode != null) o.mode = mine.mode;
  if (mine.zoom != null) o.zoom = mine.zoom;
  if (mine.table != null) o.table = mine.table;
  return o;
}
/** Changes a page's state, remembers it for this person and redraws. */
export type SetState = (fn: (s: ExplorerState) => void) => void;
export function FilterBox({ app, user, t, st, set }: { app: AppRecord; user: AppUser; t: AppTable; st: ExplorerState; set: SetState }) {
  const s0 = useState(false),
    open = s0[0],
    setOpen = s0[1],
    ref = useRef<HTMLDivElement>(null),
    d =
      st.fd ||
      (st.fd = {
        col: t.columns[0].name,
        op: '',
        val: '',
      });
  useEffect(() => {
    if (!open) return undefined;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const c = colOf(t, d.col) || t.columns[0],
    ops = opsFor(c),
    op = ops.includes(d.op) ? d.op : ops[0],
    noVal = op === 'empty' || op === 'filled',
    id = 'fl_' + t.name + '_';
  const upd = (k: 'col' | 'op' | 'val', v: string) => {
    d[k] = v;
    if (k === 'col') {
      d.op = '';
      d.val = '';
    }
    notify();
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!noVal && (d.val === '' || d.val == null)) return;
    set((s) => {
      s.filters.push({
        col: c.name,
        op,
        val: noVal ? null : d.val,
      });
      s.page = 0;
      s.fd = null;
    });
    setOpen(false);
  };
  let ctl: ReactNode = null;
  if (!noVal)
    ctl = isCat(c) ? (
      <Select native className="select" id={id + 'v'} aria-label="Value" value={String(d.val)} onChange={(e) => upd('val', e.target.value)}>
        <option value="">Choose</option>
        {choices(app, user, t, c).map((o) => (
          <option key={o.key} value={String(o.key)}>
            {o.label}
          </option>
        ))}
      </Select>
    ) : op === 'range' ? (
      <Select native className="select" id={id + 'v'} aria-label="Value" value={d.val} onChange={(e) => upd('val', e.target.value)}>
        <option value="">Choose</option>
        {Object.keys(RANGES).map((k) => (
          <option key={k} value={k}>
            {RANGES[k]}
          </option>
        ))}
      </Select>
    ) : (
      <Input
        native
        className="input"
        id={id + 'v'}
        aria-label="Value"
        type={isDate(c) ? 'date' : isNum(c) ? 'number' : 'text'}
        value={d.val}
        onInput={(e: FormEvent<HTMLInputElement>) => upd('val', e.currentTarget.value)}
      />
    );
  return (
    <div className="menu-wrap" ref={ref}>
      <Btn className={cx('btn sm', st.filters.length && 'on')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon n="filter" s="16" />
        Filter{st.filters.length ? ' · ' + st.filters.length : ''}
      </Btn>
      {open && (
        <form className="menu right fbox" onSubmit={add}>
          <div className="mlabel">Show rows where</div>
          <Select native className="select" id={id + 'c'} aria-label="Field" value={c.name} onChange={(e) => upd('col', e.target.value)}>
            {t.columns.map((x) => (
              <option key={x.name} value={x.name}>
                {x.label}
              </option>
            ))}
          </Select>
          <Select native className="select" id={id + 'o'} aria-label="Condition" value={op} onChange={(e) => upd('op', e.target.value)}>
            {ops.map((o) => (
              <option key={o} value={o}>
                {OP_TEXT[o]}
              </option>
            ))}
          </Select>
          {ctl}
          <Btn className="btn primary sm" type="submit">
            Add filter
          </Btn>
        </form>
      )}
    </div>
  );
}
/** What every data view is given: the rows to draw, and ways to change the page. */
export interface ViewProps {
  app: AppRecord;
  user: AppUser;
  pane: Pane;
  scr: Screen;
  t: AppTable;
  rows: StoredRow[];
  st: ExplorerState;
  cfg: ViewOptions;
  setCfg: <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => void;
  set: SetState;
  open: (r: StoredRow) => void;
  openNew: (preset?: Dict<unknown>) => void;
  drill: (pairs: (DrillPair | null | undefined)[]) => void;
  canCreate: boolean;
}
export function Explorer({ app, user, pane, scr, test }: { app: AppRecord; user: AppUser; pane: Pane; scr: Screen; test?: boolean }) {
  const def = app.def,
    t = tableOf(def, scr.table);
  if (!t)
    return (
      <div className="scr">
        <MBar tone="danger">{'This page shows a table that is not there: ' + scr.table}</MBar>
      </div>
    );
  const keep = !test && !pane.test,
    st = vxState(pane, scr, app, user, test),
    acc = accOf(def, user.role, t.name),
    res = fetchApi(app, user, '/api/' + t.name, null, test || pane.test ? 'check' : 'app');
  if (res.status !== 200)
    return (
      <div className="scr">
        <MBar tone="danger">{res.status + ' ' + res.error}</MBar>
      </div>
    );
  const rec = viewsOf(def, t),
    recT = rec.map((v) => v.type),
    view = DATA_VIEWS.includes(st.view) && !viewFit(def, t, st.view) ? st.view : 'table',
    q = str(st.q).toLowerCase();
  let rows: StoredRow[] = res.data;
  st.filters.forEach((f) => {
    if (colOf(t, f.col)) rows = rows.filter((r) => passes(f, r[f.col]));
  });
  if (q)
    rows = rows.filter((r) =>
      t.columns.some(
        (c) =>
          String(cellText(app, user, t, c, r[c.name], 1))
            .toLowerCase()
            .indexOf(q) >= 0,
      ),
    );
  const set: SetState = (fn) => {
      fn(st);
      if (keep) vxRemember(app, user, scr, st);
      notify();
    },
    open = (r: StoredRow) => {
      pane.rec = {
        table: t.name,
        id: r.id,
      };
      notify();
    };
  const openNew = (preset?: Dict<unknown>) => {
    pane.form = {
      table: t.name,
      id: null,
      vals: Object.assign({}, preset || {}),
      errs: {},
    };
    notify();
  };
  const drill = (pairs: (DrillPair | null | undefined)[]) =>
    set((s) => {
      pairs.forEach((p) => {
        if (!p) return;
        s.filters = s.filters.filter((f) => f.col !== p.col);
        s.filters.push(
          p.op
            ? {
                col: p.col,
                op: p.op,
                val: p.val,
              }
            : p.val == null || p.val === ''
              ? {
                  col: p.col,
                  op: 'empty',
                  val: null,
                }
              : {
                  col: p.col,
                  op: 'is',
                  val: p.val,
                },
        );
      });
      s.view = 'table';
      s.page = 0;
      s.group = '';
    });
  const cfg = vxCfg(def, t, scr, st, view),
    setCfg = <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) =>
      set((s) => {
        s.cfg[view] = Object.assign({}, s.cfg[view], {
          [k]: v,
        });
      });
  const P: ViewProps = {
    app,
    user,
    pane,
    scr,
    t,
    rows,
    st,
    cfg,
    setCfg,
    set,
    open,
    openNew,
    drill,
    canCreate: acc.create,
  };
  const chip = (f: ViewFilter, i: number) => {
    const c = colOf(t, f.col);
    if (!c) return null;
    const [from, to] = span(f.val);
    const v =
      f.op === 'range'
        ? RANGES[String(f.val)]
        : f.op === 'between'
          ? from === to
            ? fmtDate(from)
            : fmtDate(from) + ' to ' + fmtDate(to)
          : f.val == null
            ? ''
            : isCat(c)
              ? (
                  choices(app, user, t, c).find((o) => String(o.key) === String(f.val)) || {
                    label: String(f.val),
                  }
                ).label
              : isDate(c)
                ? fmtDate(String(f.val))
                : String(f.val);
    return (
      <FilterChip
        key={i}
        removeLabel={'Remove the filter on ' + c.label}
        onRemove={() =>
          set((s) => {
            s.filters.splice(i, 1);
            s.page = 0;
          })
        }
      >
        {c.label} {f.op === 'range' || (f.op === 'between' && from === to) ? 'is' : OP_TEXT[f.op]} {v}
      </FilterChip>
    );
  };
  const csv = () => {
    const cols = t.columns,
      esc = (x: unknown) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    copyText(
      [cols.map((c) => esc(c.label)).join(',')]
        .concat(rows.map((r) => cols.map((c) => esc(cellText(app, user, t, c, r[c.name], 1))).join(',')))
        .join('\n'),
      rows.length + ' rows as CSV',
    );
  };
  const more = DATA_VIEWS.filter((v) => !recT.includes(v)),
    V = (
      {
        table: VTable,
        board: VBoard,
        calendar: VCalendar,
        cards: VCards,
        tree: VTree,
        chart: VChart,
        pivot: VPivot,
        timeline: VTimeline,
      } as Dict<FunctionComponent<ViewProps>>
    )[view];
  return (
    <div className="scr vx">
      <div className="scr-head">
        <div className="col gap0 grow">
          <h2 className="t-sub1">{scr.name}</h2>
          <span className="t-cap muted">
            {rows.length}
            {rows.length !== res.data.length ? ' of ' + res.data.length : ''}{' '}
            {rows.length === 1 ? t.one.toLowerCase() : t.label.toLowerCase()}
            {acc.list === 'own' ? ' · only yours' : ''}
          </span>
        </div>
        <div className="search">
          <Icon n="search" s="16" />
          <Input
            native
            className="input"
            id={'q' + scr.id + '_' + pane.n}
            aria-label={'Search ' + t.label.toLowerCase()}
            placeholder="Search"
            value={st.q || ''}
            onInput={(e: FormEvent<HTMLInputElement>) =>
              set((s) => {
                s.q = e.currentTarget.value;
                s.page = 0;
              })
            }
          />
        </div>
        {acc.create && (
          <Btn className="btn primary fab" onClick={() => openNew()}>
            <Icon n="add" />
            <span>
              {'New '}
              {t.one.toLowerCase()}
            </span>
          </Btn>
        )}
      </div>
      <div className="vx-bar">
        <div className="vswitch" role="tablist" aria-label="Ways to view this data" data-tour="vswitch">
          {rec
            .concat(
              recT.includes(view)
                ? []
                : [
                    {
                      type: view,
                      why: 'Not recommended by the advisor, but it fits.',
                    },
                  ],
            )
            .map((v) => (
              <button
                key={v.type}
                role="tab"
                aria-selected={v.type === view}
                className={cx('vs-b', v.type === view && 'on')}
                title={v.why}
                onClick={() =>
                  set((s) => {
                    s.view = v.type;
                  })
                }
              >
                <Icon n={VIEW_ICON[v.type]} s="16" />
                <span>{VIEW_LABEL[v.type]}</span>
              </button>
            ))}
          {more.length > 0 && (
            <Menu
              align="left"
              title="Views the advisor did not recommend for this table"
              btn={{
                cls: 'vs-b',
                label: 'More views',
                body: <Icon n="more" s="16" />,
              }}
              items={[
                {
                  head: true,
                  label: 'Not recommended here',
                } as MenuEntry,
              ].concat(
                more.map((v): MenuEntry => {
                  const why = viewFit(def, t, v);
                  return {
                    label: VIEW_LABEL[v],
                    icon: VIEW_ICON[v],
                    hint: why ? 'does not fit' : 'fits',
                    disabled: !!why,
                    on: () =>
                      set((s) => {
                        s.view = v;
                      }),
                  };
                }),
              )}
            />
          )}
        </div>
        <span className="grow" />
        <FilterBox app={app} user={user} t={t} st={st} set={set} />
        <Btn className="btn sm" title="Copy the rows you see as CSV" onClick={csv}>
          <Icon n="copy" s="16" />
          <span className="hide-sm">CSV</span>
        </Btn>
      </div>
      {st.filters.length > 0 && (
        <div className="chips">
          {st.filters.map(chip)}
          <Btn
            className="btn subtle sm"
            onClick={() =>
              set((s) => {
                s.filters = [];
                s.page = 0;
              })
            }
          >
            Clear all
          </Btn>
        </div>
      )}
      <div className="vx-body">
        <V {...P} />
      </div>
    </div>
  );
}
/** A small labelled dropdown of a view's options. */
export const Pick = ({
  id,
  label: text,
  value,
  onChange,
  opts,
  none,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  opts: { name: string; label?: string }[];
  none?: string;
}) => (
  <label className="pick">
    <span>{text}</span>
    <Select native className="select sm" id={id} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      {none && <option value="">{none}</option>}
      {opts.map((o) => (
        <option key={o.name} value={o.name}>
          {o.label}
        </option>
      ))}
    </Select>
  </label>
);
export const NoRows = ({ t }: { t: AppTable }) => (
  <Empty icon="search" title={'No ' + t.label.toLowerCase() + ' to show'} text="Nothing matches the search and filters." />
);
export function VTable({ app, user, pane, scr, t, rows, st, set, open }: ViewProps) {
  if (!st.hidden) {
    const h: Dict<boolean> = {};
    t.columns.forEach((c) => {
      h[c.name] = !scr.columns.includes(c.name);
    });
    st.hidden = h;
  }
  const hidden = st.hidden;
  const cols = t.columns.filter((c) => !hidden[c.name]),
    sort = st.sort && colOf(t, st.sort.col) ? st.sort : null,
    list = rows.slice(),
    g = colOf(t, st.group),
    nums = cols.filter(isNum),
    per = 25,
    pages = Math.max(1, Math.ceil(list.length / per)),
    page = Math.min(st.page || 0, pages - 1);
  const raw = (c: ColumnDef, r: StoredRow): string | number =>
    isNum(c) || isDate(c) || c.type === 'bool'
      ? r[c.name] == null
        ? ''
        : (r[c.name] as string | number)
      : String(cellText(app, user, t, c, r[c.name], 1)).toLowerCase();
  const sc = sort ? colOf(t, sort.col) : null;
  if (sort && sc) {
    const c = sc;
    list.sort((a, b) => {
      const x = raw(c, a),
        y = raw(c, b);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  } else if (scr.date) {
    const dc = scr.date;
    list.sort((a, b) => String(a[dc]).localeCompare(String(b[dc])));
  }
  const sum = (c: ColumnDef, l: StoredRow[]) => l.reduce((n, r) => n + (Number(r[c.name]) || 0), 0),
    id = 'tb' + scr.id + pane.n;
  const row = (r: StoredRow) => (
    <tr
      key={r.id}
      className="clickable"
      tabIndex={0}
      onClick={() => open(r)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open(r);
      }}
    >
      {cols.map((c) => (
        <td key={c.name} className={isNum(c) ? 'num' : ''} data-l={c.label}>
          <Cell app={app} user={user} t={t} c={c} v={r[c.name]} />
        </td>
      ))}
    </tr>
  );
  let body: ReactNode;
  if (g) {
    const gc = g;
    const keys = choices(app, user, t, g).concat([
      {
        key: null,
        label: 'Not set',
      },
    ]);
    body = keys.map((k) => {
      const l = list.filter((r) => (k.key == null ? r[gc.name] == null || r[gc.name] === '' : String(r[gc.name]) === String(k.key)));
      if (!l.length) return null;
      const shut = st.closed[gc.name + k.key];
      return [
        <tr key={'g' + k.key} className="grp">
          <td colSpan={cols.length}>
            <button
              className="grp-b"
              aria-expanded={!shut}
              onClick={() =>
                set((s) => {
                  s.closed[gc.name + k.key] = !shut;
                })
              }
            >
              <Icon n={shut ? 'chevRight' : 'chevDown'} s="16" />
              <strong>{k.label}</strong>
              <span className="tab-n">{l.length}</span>
              {nums.map((c) => (
                <span key={c.name} className="muted t-cap">
                  {c.label} {fmtNum(sum(c, l))}
                </span>
              ))}
            </button>
          </td>
        </tr>,
        shut ? null : l.map(row),
      ];
    });
  } else body = list.slice(page * per, page * per + per).map(row);
  return (
    <>
      <div className="vopts">
        <Pick
          id={id + 'g'}
          label="Group by"
          value={st.group}
          none="Nothing"
          opts={t.columns.filter(isCat)}
          onChange={(v) =>
            set((s) => {
              s.group = v || '';
            })
          }
        />
        <span className="only-c">
          <Pick
            id={id + 's'}
            label="Sort by"
            value={sort ? sort.col : ''}
            none="Default"
            opts={cols}
            onChange={(v) =>
              set((s) => {
                s.sort = v
                  ? {
                      col: v,
                      dir: 1,
                    }
                  : null;
              })
            }
          />
        </span>
        <Menu
          align="left"
          title="Choose columns"
          btn={{
            cls: 'btn sm',
            label: 'Columns',
            body: (
              <>
                <Icon n="layout" s="16" />
                {'Columns · '}
                {cols.length}
              </>
            ),
          }}
          items={t.columns.map((c) => ({
            label: c.label,
            check: !hidden[c.name],
            on: () =>
              set((s) => {
                const h = s.hidden || (s.hidden = {});
                h[c.name] = !h[c.name];
              }),
          }))}
        />
        <span className="grow" />
        {!g && pages > 1 && (
          <span className="pager">
            <Btn
              className="btn subtle icon sm"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() =>
                set((s) => {
                  s.page = page - 1;
                })
              }
            >
              <Icon n="chevLeft" s="16" />
            </Btn>
            <span className="t-cap">
              {'Page '}
              {page + 1}
              {' of '}
              {pages}
            </span>
            <Btn
              className="btn subtle icon sm"
              aria-label="Next page"
              disabled={page >= pages - 1}
              onClick={() =>
                set((s) => {
                  s.page = page + 1;
                })
              }
            >
              <Icon n="chevRight" s="16" />
            </Btn>
          </span>
        )}
      </div>
      {list.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.name}
                    className={isNum(c) ? 'num' : ''}
                    aria-sort={sort && sort.col === c.name ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
                  >
                    <button
                      className="th-btn"
                      onClick={() =>
                        set((s) => {
                          s.sort =
                            sort && sort.col === c.name
                              ? {
                                  col: c.name,
                                  dir: -sort.dir,
                                }
                              : {
                                  col: c.name,
                                  dir: 1,
                                };
                        })
                      }
                    >
                      {c.label}
                      {sort && sort.col === c.name && <Icon n={sort.dir > 0 ? 'arrowUp' : 'arrowDown'} s="12" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{body}</tbody>
            {nums.length > 0 && (
              <tfoot>
                <tr>
                  {cols.map((c, i) => (
                    <td key={c.name} className={isNum(c) ? 'num' : ''}>
                      {isNum(c) ? fmtNum(sum(c, list)) : i === 0 ? 'Total of ' + list.length : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        <NoRows t={t} />
      )}
    </>
  );
}
export function VBoard({ app, user, pane, scr, t, rows, cfg, setCfg, open }: ViewProps) {
  const def = app.def,
    g = colOf(t, cfg.by),
    lane = colOf(t, cfg.lane),
    P = g && isStatusCol(def, t, g) ? def.process : null,
    lab = scr.label || t.title,
    id = 'bd' + scr.id + pane.n;
  if (!g) return <Empty icon="board" title="No choice field to group by" />;
  const cols = scr.columns
    .map((n) => colOf(t, n))
    .filter((c): c is ColumnDef => !!c && c.name !== g.name && c.name !== lab && c.type !== 'longtext')
    .slice(0, 3);
  const drop = (e: DragEvent<HTMLElement>, to: string) => {
    e.preventDefault();
    const rid = +e.dataTransfer.getData('text/plain'),
      r0 = rows.find((r) => r.id === rid);
    if (!r0 || r0[g.name] === to) return;
    if (P) {
      const tr = P.transitions.find((x) => x.to === to && x.from.includes(String(r0[g.name])) && x.roles.includes(user.role));
      if (!tr)
        return toast(
          roleName(def, user.role) +
            ' cannot move a ' +
            t.one.toLowerCase() +
            ' from ' +
            label(r0[g.name]).toLowerCase() +
            ' to ' +
            label(to).toLowerCase() +
            '.',
          'warning',
        );
      const r = apiCall(app, user, 'POST', '/api/' + t.name + '/' + rid + '/' + tr.id, {}, 'app');
      toast(r.status === 200 ? tr.label + ': done' : r.status + ' ' + r.error, r.status === 200 ? 'success' : 'danger');
    } else {
      const r = apiCall(
        app,
        user,
        'PATCH',
        '/api/' + t.name + '/' + rid,
        {
          [g.name]: to,
        },
        'app',
      );
      if (r.status !== 200) toast(r.status + ' ' + r.error, 'danger');
    }
    notify();
  };
  const board = (list: StoredRow[], key: string) => (
    <div key={key} className="kb">
      {(g.options || []).map((o) => {
        const l = list.filter((r) => r[g.name] === o);
        return (
          <section
            key={o}
            className="kb-col"
            aria-label={stateLabel(def, t, g, o)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, o)}
          >
            <header className="kb-head">
              <span className={cx('badge', P ? 'b-' + stateTone(def, t, g, o) : 'b-outline')}>{stateLabel(def, t, g, o)}</span>
              <span className="t-cap muted">{l.length}</span>
            </header>
            <div className="kb-list">
              {l.map((r) => (
                <button
                  key={r.id}
                  className="kb-card"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(r.id))}
                  onClick={() => open(r)}
                >
                  <span className="t-strong">{rowTitle(app, user, t, r, lab)}</span>
                  {lab !== t.title && <span className="muted t-cap">{rowTitle(app, user, t, r)}</span>}
                  {cols.map(
                    (c) =>
                      r[c.name] != null &&
                      r[c.name] !== '' && (
                        <span key={c.name} className="kb-f">
                          <span className="muted">{c.label}</span>
                          <span>
                            <Cell app={app} user={user} t={t} c={c} v={r[c.name]} />
                          </span>
                        </span>
                      ),
                  )}
                </button>
              ))}
              {!l.length && <div className="kb-empty">Nothing here</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
  return (
    <>
      <div className="vopts">
        <Pick
          id={id + 'b'}
          label="Columns from"
          value={g.name}
          opts={t.columns.filter((c) => c.type === 'select')}
          onChange={(v) => setCfg('by', v)}
        />
        <Pick
          id={id + 'l'}
          label="Swimlanes"
          value={lane ? lane.name : ''}
          none="None"
          opts={t.columns.filter((c) => isCat(c) && c.name !== g.name)}
          onChange={(v) => setCfg('lane', v)}
        />
        {P ? <span className="t-cap muted hide-sm">Drag a card to run a workflow action your role may take</span> : null}
      </div>
      {lane
        ? choices(app, user, t, lane)
            .concat([
              {
                key: null,
                label: 'Not set',
              },
            ])
            .map((k) => {
              const l = rows.filter((r) => (k.key == null ? r[lane.name] == null : String(r[lane.name]) === String(k.key)));
              return l.length ? (
                <section key={String(k.key)} className="lane">
                  <h3 className="lane-h">
                    {k.label}
                    <span className="tab-n">{l.length}</span>
                  </h3>
                  {board(l, 'b')}
                </section>
              ) : null;
            })
        : board(rows, 'b')}
    </>
  );
}
export function VCalendar({ app, user, pane, scr, t, rows, st, cfg, setCfg, set, open, openNew, canCreate }: ViewProps) {
  const def = app.def,
    dc = colOf(t, cfg.date);
  if (!dc) return <Empty icon="calendar" title="No date field" />;
  const week = cfg.mode === 'week',
    off = st.month || 0,
    base = today(),
    lab = scr.label || t.title,
    P = def.process && def.process.table === t.name ? def.process : null,
    isDT = dc.type === 'datetime',
    tk = isoDate(base),
    id = 'cl' + scr.id + pane.n;
  const first = week
      ? new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7) + off * 7)
      : new Date(base.getFullYear(), base.getMonth() + off, 1),
    start = week ? first : new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7)),
    byDay: Dict<StoredRow[]> = {};
  rows.forEach((r) => {
    const a = parseISO(asText(r[dc.name]));
    if (!a) return;
    const b = cfg.end && r[cfg.end] ? parseISO(asText(r[cfg.end])) : null;
    let d = new Date(a.getFullYear(), a.getMonth(), a.getDate()),
      n = 0;
    const last = b && b >= d ? b : d;
    while (d <= last && n < 60) {
      const k = isoDate(d);
      (byDay[k] = byDay[k] || []).push(r);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      n++;
    }
  });
  const days: Date[] = [];
  for (let i = 0; i < (week ? 7 : 42); i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const count = week ? 7 : days[35].getMonth() !== first.getMonth() ? 35 : 42,
    move = (n: number) =>
      set((s) => {
        s.month = n;
        s.calOpen = null;
      }),
    end = days[count - 1];
  return (
    <>
      <div className="vopts">
        <Btn className="btn subtle icon sm" aria-label={week ? 'Previous week' : 'Previous month'} onClick={() => move(off - 1)}>
          <Icon n="chevLeft" s="16" />
        </Btn>
        <strong className="cal-title">
          {week
            ? first.getDate() + ' ' + MON[first.getMonth()] + ' to ' + end.getDate() + ' ' + MON[end.getMonth()]
            : MONTH[first.getMonth()] + ' ' + first.getFullYear()}
        </strong>
        <Btn className="btn subtle icon sm" aria-label={week ? 'Next week' : 'Next month'} onClick={() => move(off + 1)}>
          <Icon n="chevRight" s="16" />
        </Btn>
        <Btn className="btn sm" onClick={() => move(0)}>
          Today
        </Btn>
        <Seg
          label="Calendar span"
          items={[
            {
              id: 'month',
              label: 'Month',
            },
            {
              id: 'week',
              label: 'Week',
            },
          ]}
          value={week ? 'week' : 'month'}
          onChange={(v: string) => {
            st.month = 0;
            setCfg('mode', v);
          }}
        />
        <span className="grow" />
        {t.columns.filter(isDate).length > 1 && (
          <Pick id={id + 'd'} label="Date from" value={dc.name} opts={t.columns.filter(isDate)} onChange={(v) => setCfg('date', v)} />
        )}
      </div>
      <div className={cx('cal-grid', week && 'wk')}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {days.slice(0, count).map((d) => {
          const k = isoDate(d),
            list = (byDay[k] || []).slice().sort((a, b) => String(a[dc.name]).localeCompare(String(b[dc.name]))),
            all = week || st.calOpen === k;
          return (
            <div key={k} className={cx('cal-day', !week && d.getMonth() !== first.getMonth() && 'out', k === tk && 'today')}>
              <div className="cal-num">
                <span>{d.getDate()}</span>
                {canCreate && (
                  <button
                    className="cal-add"
                    aria-label={'New ' + t.one.toLowerCase() + ' on ' + k}
                    onClick={() =>
                      openNew({
                        [dc.name]: isDT ? k + 'T09:00' : k,
                      })
                    }
                  >
                    <Icon n="add" s="12" />
                  </button>
                )}
              </div>
              {(all ? list : list.slice(0, 3)).map((r) => (
                <button
                  key={r.id}
                  className={cx('cal-chip', P && 'tone-' + stateTone(def, t, colOf(t, P.column), r[P.column]))}
                  title={rowTitle(app, user, t, r) + (P ? ' · ' + stateLabel(def, t, colOf(t, P.column), r[P.column]) : '')}
                  onClick={() => open(r)}
                >
                  {isDT && <span className="cal-t">{fmtTime(asText(r[dc.name]))}</span>}
                  <span className="ellipsis">{rowTitle(app, user, t, r, lab)}</span>
                </button>
              ))}
              {list.length > 3 && !all && (
                <button
                  className="cal-more"
                  onClick={() =>
                    set((s) => {
                      s.calOpen = k;
                    })
                  }
                >
                  +{list.length - 3}
                  {' more'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
export function VCards({ app, user, scr, t, rows, open }: ViewProps) {
  const def = app.def,
    P = def.process && def.process.table === t.name ? def.process : null,
    lab = scr.label || t.title,
    cols = scr.columns
      .map((n) => colOf(t, n))
      .filter((c): c is ColumnDef => !!c && c.name !== lab && !(P && c.name === P.column) && c.type !== 'longtext')
      .slice(0, 4),
    long = t.columns.find((c) => c.type === 'longtext');
  if (!rows.length) return <NoRows t={t} />;
  return (
    <>
      <div className="cards">
        {rows.slice(0, 120).map((r) => (
          <button key={r.id} className="card rcard" onClick={() => open(r)}>
            <span className="row between">
              <strong className="ellipsis">{rowTitle(app, user, t, r, lab)}</strong>
              {P && (
                <span className={'badge b-' + stateTone(def, t, colOf(t, P.column), r[P.column])}>
                  {stateLabel(def, t, colOf(t, P.column), r[P.column])}
                </span>
              )}
            </span>
            {long && r[long.name] ? <span className="muted t-cap clamp">{String(r[long.name])}</span> : null}
            {cols.map(
              (c) =>
                r[c.name] != null &&
                r[c.name] !== '' && (
                  <span key={c.name} className="kb-f">
                    <span className="muted">{c.label}</span>
                    <span>
                      <Cell app={app} user={user} t={t} c={c} v={r[c.name]} />
                    </span>
                  </span>
                ),
            )}
          </button>
        ))}
      </div>
      {rows.length > 120 && <p className="muted t-cap">Showing the first 120. Filter to narrow it down.</p>}
    </>
  );
}
export function VTree({ app, user, pane, scr, t, rows, st, cfg, setCfg, set, open }: ViewProps) {
  const def = app.def,
    cats = t.columns.filter(isCat),
    self = cfg.parent ? colOf(t, cfg.parent) : null,
    byParent = self && cfg.mode !== 'groups',
    levels = (cfg.levels || []).filter((n) => colOf(t, n)),
    num = t.columns.find(isNum),
    P = def.process && def.process.table === t.name ? def.process : null,
    id = 'tr' + scr.id + pane.n,
    tag = P ? null : t.columns.find((c) => c.type === 'select' && (byParent || !levels.includes(c.name)));
  const isOpen = (k: string, depth: number) => (st.open[k] != null ? st.open[k] : depth < (byParent ? 2 : 1)),
    tog = (k: string, depth: number) =>
      set((s) => {
        s.open[k] = !isOpen(k, depth);
      });
  const total = (l: StoredRow[]) => (num ? l.reduce((n, r) => n + (Number(r[num.name]) || 0), 0) : 0);
  const leaf = (r: StoredRow, depth: number, kids: number) => (
    <li key={'r' + r.id}>
      <div
        className="tree-row"
        style={{
          paddingLeft: depth * 20 + 'px',
        }}
      >
        {kids ? (
          <button
            className="tree-tog"
            aria-label="Expand or collapse"
            aria-expanded={isOpen('p' + r.id, depth)}
            onClick={() => tog('p' + r.id, depth)}
          >
            <Icon n={isOpen('p' + r.id, depth) ? 'chevDown' : 'chevRight'} s="16" />
          </button>
        ) : (
          <span className="tree-dot" />
        )}
        <button className="tree-leaf" onClick={() => open(r)}>
          <span className="ellipsis">{rowTitle(app, user, t, r, scr.label)}</span>
          {kids ? <span className="tab-n">{kids}</span> : null}
          {P && (
            <span className={'badge b-' + stateTone(def, t, colOf(t, P.column), r[P.column])}>
              {stateLabel(def, t, colOf(t, P.column), r[P.column])}
            </span>
          )}
          {tag && r[tag.name] ? <span className="badge b-outline">{optLabel(tag, r[tag.name])}</span> : null}
        </button>
      </div>
    </li>
  );
  type Tree = ReactNode | Tree[];
  let body: Tree;
  if (self && byParent) {
    const pc = self.name,
      ids = new Set<unknown>(rows.map((r) => r.id)),
      kidsOf = (pid: number) => rows.filter((r) => r[pc] === pid).sort((a, b) => a.id - b.id),
      walk = (r: StoredRow, depth: number): Tree[] => {
        const k = kidsOf(r.id);
        return [leaf(r, depth, k.length) as Tree].concat(
          k.length && isOpen('p' + r.id, depth) && depth < 8 ? k.map((x) => walk(x, depth + 1)) : [],
        );
      };
    body = rows
      .filter((r) => r[pc] == null || !ids.has(r[pc]))
      .sort((a, b) => a.id - b.id)
      .map((r) => walk(r, 0));
  } else {
    const walk = (list: StoredRow[], depth: number, path: string): Tree[] => {
      if (depth >= levels.length) return list.map((r) => leaf(r, depth, 0));
      const c = colOf(t, levels[depth]);
      if (!c) return [];
      return choices(app, user, t, c)
        .concat([
          {
            key: null,
            label: 'Not set',
          },
        ])
        .map((k) => {
          const l = list.filter((r) => (k.key == null ? r[c.name] == null || r[c.name] === '' : String(r[c.name]) === String(k.key)));
          if (!l.length) return null;
          const key = path + '/' + k.key,
            on = isOpen(key, depth);
          return [
            (
              <li key={key}>
                <div
                  className="tree-row grp"
                  style={{
                    paddingLeft: depth * 20 + 'px',
                  }}
                >
                  <button className="tree-tog" aria-label="Expand or collapse" aria-expanded={on} onClick={() => tog(key, depth)}>
                    <Icon n={on ? 'chevDown' : 'chevRight'} s="16" />
                  </button>
                  <button className="tree-leaf" onClick={() => tog(key, depth)}>
                    <span className="muted t-cap">{c.label}</span>
                    <strong className="ellipsis">{k.label}</strong>
                    <span className="tab-n">{l.length}</span>
                    {num ? (
                      <span className="muted t-cap">
                        {num.label} {fmtNum(total(l))}
                      </span>
                    ) : null}
                  </button>
                </div>
              </li>
            ) as Tree,
          ].concat(on ? walk(l, depth + 1, key) : []);
        });
    };
    body = levels.length ? walk(rows, 0, '') : rows.map((r) => leaf(r, 0, 0));
  }
  const lv = (i: number) => (
    <Pick
      id={id + i}
      label={i ? 'then by' : 'Nest by'}
      value={levels[i] || ''}
      none={i ? 'Nothing' : 'Nothing'}
      opts={cats.filter((c) => !levels.slice(0, i).includes(c.name))}
      onChange={(v) => {
        const n = levels.slice(0, i);
        if (v) n.push(v);
        setCfg('levels', n);
      }}
    />
  );
  return (
    <>
      <div className="vopts">
        {self && (
          <Seg
            label="Tree shape"
            items={[
              {
                id: 'parent',
                label: 'Parents and children',
              },
              {
                id: 'groups',
                label: 'Groups',
              },
            ]}
            value={byParent ? 'parent' : 'groups'}
            onChange={(v) => setCfg('mode', v)}
          />
        )}
        {!byParent && [lv(0), levels.length > 0 && lv(1), levels.length > 1 && lv(2)]}
        <span className="grow" />
        <Btn
          className="btn subtle sm"
          onClick={() =>
            set((s) => {
              s.open = {};
            })
          }
        >
          Reset
        </Btn>
      </div>
      {rows.length ? <ul className="tree">{body as ReactNode}</ul> : <NoRows t={t} />}
    </>
  );
}
