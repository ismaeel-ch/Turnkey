import { useState, useLayoutEffect, useRef, type FocusEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import type { AppTable, AppUser, ColumnDef, Dash as DashDef, DashWidget, Screen, StoredRow } from '@/shared/types/app';
import type { AppRecord, Dict, Pane, ViewFilter, ViewOptions } from '@/shared/types/workspace';
import { toStyle } from '@/platform/dom';
import { DOW, MON, cap, cx, fmtDate, fmtNum, fmtTime, isoDate, notify, parseISO, toast, today } from './core';
import { accOf, colOf, roleName, tableOf } from './engine';
import { DATA_VIEWS, isCat, isDate, isMeasure } from './viewspec';
import { Btn, Card, Empty, FilterChip, Icon, Seg, Switch } from './ui';
import { cellText, fetchApi, patchPane, rowTitle, stateLabel, stateTone } from './runtime';
import { EmptyDash } from './firstrun';
import { Pick, asText, choices, passes, vxState, type DrillPair, type ViewProps } from './views-a';

/* ===== Turnkey prototype · charts, pivot, timeline and the dashboard =====
   Chart rules followed here: colour follows the value, never its rank; one axis; a legend for two or more series;
   labels and numbers in text colours; every mark has a hover tip; a data table is one click away. */
export const SERIES_MAX = 8;
/** A column's label, or its name when it has none. */
export const colName = (c: ColumnDef) => c.label || c.name;
export const cvar = (i: number | null | undefined) => 'var(--c' + (i == null || i < 0 ? 0 : (i % SERIES_MAX) + 1) + ')';
/** What a chart counts: rows, or the total or average of a number column. */
export type Measure = { fn: 'count'; col: null; label: string } | { fn: 'sum' | 'avg'; col: ColumnDef; label: string };
export const measureOf = (t: AppTable, m: string | null | undefined): Measure => {
  const x = /^(sum|avg):(.+)$/.exec(m || ''),
    c = x && colOf(t, x[2]);
  return x && c && isMeasure(c)
    ? {
        fn: x[1] === 'sum' ? 'sum' : 'avg',
        col: c,
        label: (x[1] === 'sum' ? 'Total ' : 'Average ') + colName(c).toLowerCase(),
      }
    : {
        fn: 'count',
        col: null,
        label: 'Count',
      };
};
export const aggOf = (M: Measure, list: StoredRow[]) => {
  if (M.fn === 'count') return list.length;
  const col = M.col.name;
  const v = list
      .map((r) => r[col])
      .filter((x) => x != null && x !== '')
      .map(Number)
      .filter((x) => !isNaN(x)),
    s = v.reduce((a, b) => a + b, 0);
  return M.fn === 'sum' ? Math.round(s * 100) / 100 : v.length ? Math.round((s / v.length) * 10) / 10 : 0;
};
export const keyStr = (v: unknown) => (v == null || v === '' ? '' : String(v));
/** One value of a category column found in the rows; `ci` is its colour slot. `keys` marks the folded "Other". */
export interface Group {
  key: string;
  label: string;
  ci: number;
  val?: unknown;
  keys?: Dict<number>;
}
export function groupsOf(app: AppRecord, user: AppUser, t: AppTable, c: ColumnDef, rows: StoredRow[], fold: boolean): Group[] {
  // the values of a category column found in these rows, in a stable order; ci is the colour slot
  const all = choices(app, user, t, c),
    seen: Dict<unknown> = {},
    known: Dict<number> = {},
    out: Group[] = [];
  let other: (Group & { keys: Dict<number> }) | null = null;
  rows.forEach((r) => {
    const k = keyStr(r[c.name]);
    if (!(k in seen)) seen[k] = r[c.name];
  });
  all.forEach((o, i) => {
    const k = String(o.key);
    known[k] = 1;
    if (!(k in seen)) return;
    if (fold && all.length > SERIES_MAX && i >= SERIES_MAX - 1) {
      other = other || {
        key: '__other',
        label: 'Other',
        ci: -1,
        keys: {},
      };
      other.keys[k] = 1;
      return;
    }
    out.push({
      key: k,
      label: o.label,
      ci: i,
      val: o.key,
    });
  });
  Object.keys(seen).forEach((k) => {
    if (k !== '' && !known[k])
      out.push({
        key: k,
        label: cellText(app, user, t, c, seen[k], 1) || k,
        ci: -1,
        val: seen[k],
      });
  });
  if (other) out.push(other);
  if ('' in seen)
    out.push({
      key: '',
      label: 'Not set',
      ci: -1,
      val: null,
    });
  return out;
}
export const inGroup = (g: Group, r: StoredRow, c: ColumnDef) => (g.keys ? !!g.keys[keyStr(r[c.name])] : keyStr(r[c.name]) === g.key);
export function bucketOf(v: unknown, b: string) {
  const d = parseISO(asText(v));
  if (!d) return null;
  return isoDate(
    b === 'month'
      ? new Date(d.getFullYear(), d.getMonth(), 1)
      : b === 'week'
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
        : d,
  );
}
export function bucketsFor(rows: StoredRow[], col: string, b: string): { b: string; list: string[] } {
  // an unbroken run from the first date to the last, so quiet days show as zero
  const keys = rows
    .map((r) => bucketOf(r[col], b))
    .filter((k): k is string => !!k)
    .sort();
  if (!keys.length)
    return {
      b,
      list: [],
    };
  const step = (k: string) => {
    const d = parseISO(k) || today();
    return isoDate(
      b === 'month'
        ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
        : new Date(d.getFullYear(), d.getMonth(), d.getDate() + (b === 'week' ? 7 : 1)),
    );
  };
  const list: string[] = [],
    last = keys[keys.length - 1];
  let k = keys[0],
    n = 0;
  while (k <= last && n++ < 400) {
    list.push(k);
    k = step(k);
  }
  return list.length > 92 && b !== 'month'
    ? bucketsFor(rows, col, b === 'day' ? 'week' : 'month')
    : {
        b,
        list,
      };
}
export const bucketEnd = (k: string, b: string) => {
  const d = parseISO(k) || today();
  return isoDate(
    b === 'month'
      ? new Date(d.getFullYear(), d.getMonth() + 1, 0)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() + (b === 'week' ? 6 : 0)),
  );
};
export const dayText = (k: string) => {
  const d = parseISO(k);
  return d ? d.getDate() + ' ' + MON[d.getMonth()] : '';
};
export const bucketLabel = (k: string, b: string) => {
  const d = parseISO(k);
  return b === 'month' && d ? MON[d.getMonth()] + ' ' + d.getFullYear() : dayText(k);
};
export const bucketLong = (k: string, b: string) =>
  b === 'month'
    ? bucketLabel(k, b)
    : b === 'week'
      ? dayText(k) + ' to ' + dayText(bucketEnd(k, b))
      : DOW[(parseISO(k) || today()).getDay()] + ' ' + dayText(k);
export function niceTicks(max: number, whole?: boolean) {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4,
    p = Math.pow(10, Math.floor(Math.log10(raw))),
    f = raw / p;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  if (whole) step = Math.max(1, Math.round(step));
  const out: number[] = [];
  for (let v = 0; v < max + step - 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
/** One bar of a category chart: its group, the measure for each series, and the total. */
export interface CatBar {
  key: string;
  label: string;
  val: unknown;
  fold: boolean;
  total: number;
  n: number;
  vals: Dict<number>;
}
export function catData(
  app: AppRecord,
  user: AppUser,
  t: AppTable,
  rows: StoredRow[],
  xc: ColumnDef,
  sp: ColumnDef | null,
  M: Measure,
): { cats: CatBar[]; series: Group[] } {
  const gx = groupsOf(app, user, t, xc, rows, false),
    gs: Group[] = sp
      ? groupsOf(app, user, t, sp, rows, true)
      : [
          {
            key: '_',
            label: M.label,
            ci: 0,
          },
        ];
  const cats = gx.map((g): CatBar => {
    const list = rows.filter((r) => inGroup(g, r, xc)),
      vals: Dict<number> = {};
    gs.forEach((s) => {
      vals[s.key] = sp
        ? aggOf(
            M,
            list.filter((r) => inGroup(s, r, sp)),
          )
        : aggOf(M, list);
    });
    return {
      key: g.key,
      label: g.label,
      val: g.val,
      fold: !!g.keys,
      total: aggOf(M, list),
      n: list.length,
      vals,
    };
  });
  if (xc.type === 'user' || xc.type === 'ref') cats.sort((a, b) => b.total - a.total);
  return {
    cats,
    series: gs,
  };
}
/** A series of a time chart: its group and one value per bucket. */
export type TimeSeries = Group & { vals: number[] };
export function timeData(
  app: AppRecord,
  user: AppUser,
  t: AppTable,
  rows: StoredRow[],
  xc: ColumnDef,
  sp: ColumnDef | null,
  M: Measure,
  bucket: string | null | undefined,
): { b: string; buckets: string[]; series: TimeSeries[] } {
  const B = bucketsFor(rows, xc.name, bucket || 'day'),
    gs: Group[] = sp
      ? groupsOf(app, user, t, sp, rows, true)
      : [
          {
            key: '_',
            label: M.label,
            ci: 0,
          },
        ],
    idx: Dict<number> = {};
  B.list.forEach((k, i) => {
    idx[k] = i;
  });
  const lists = gs.map(() => B.list.map((): StoredRow[] => []));
  rows.forEach((r) => {
    const k = bucketOf(r[xc.name], B.b);
    if (k == null || idx[k] == null) return;
    gs.forEach((s, j) => {
      if (!sp || inGroup(s, r, sp)) lists[j][idx[k]].push(r);
    });
  });
  return {
    b: B.b,
    buckets: B.list,
    series: gs.map((s, j) =>
      Object.assign({}, s, {
        vals: lists[j].map((l) => aggOf(M, l)),
      }),
    ),
  };
}

/* ---------- hover tips and measuring ---------- */
/** A hover tip: an optional heading, one line per series, and a footnote. */
export interface TipContent {
  head?: string | null;
  rows: { ci?: number | null; v: string; l: string }[];
  foot?: string | null;
}
type TipAt = TipContent & { x: number; y: number };
export function useTip() {
  const ref = useRef<HTMLDivElement>(null),
    s = useState<TipAt | null>(null);
  const show = (e: MouseEvent<Element> | FocusEvent<Element>, tip: TipContent) => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect(),
      tg = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : b,
      pt = 'clientX' in e && e.type !== 'focus' ? e : null;
    const x = pt ? pt.clientX - b.left : tg.left + tg.width / 2 - b.left,
      y = pt ? pt.clientY - b.top : tg.top - b.top;
    s[1](
      Object.assign(
        {
          x: Math.max(84, Math.min(Math.max(84, b.width - 84), x)),
          y: Math.max(8, y),
        },
        tip,
      ),
    );
  };
  return {
    ref,
    tip: s[0],
    show,
    hide: () => s[1](null),
  };
}
export const Tip = ({ tip }: { tip: TipAt | null }) =>
  tip ? (
    <div
      className="ctip"
      aria-hidden="true"
      style={{
        left: tip.x + 'px',
        top: tip.y + 'px',
      }}
    >
      {tip.head && <div className="ctip-h">{tip.head}</div>}
      {tip.rows.map((r, i) => (
        <div key={i} className="ctip-r">
          {r.ci != null && (
            <span
              className="sw"
              style={{
                background: cvar(r.ci),
              }}
            />
          )}
          <strong>{r.v}</strong>
          <span>{r.l}</span>
        </div>
      ))}
      {tip.foot && <div className="ctip-f">{tip.foot}</div>}
    </div>
  ) : null;
export function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const w = el.clientWidth;
      setWidth((old) => (w && w !== old ? w : old));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width || 640;
}
export const Legend = ({ series }: { series: Group[] }) =>
  series.length > 1 ? (
    <div className="lg" role="list" aria-label="Legend">
      {series.map((s) => (
        <span key={s.key} className="lg-i" role="listitem">
          <span
            className="sw"
            style={{
              background: cvar(s.ci),
            }}
          />
          {s.label}
        </span>
      ))}
    </div>
  ) : null;

/* ---------- bars for categories: one hue for one series, stacked segments with a gap for a split ---------- */
export function HBars({
  cats,
  series,
  unit,
  onPick,
  picked,
}: {
  cats: CatBar[];
  series: Group[];
  unit: string;
  onPick?: (c: CatBar, s: Group) => void;
  picked?: string | null;
}) {
  const { ref: tipRef, ...T } = useTip(),
    many = series.length > 1,
    max =
      Math.max(...cats.map((c) => (many ? series.reduce((a, s) => a + Math.max(0, c.vals[s.key] || 0), 0) : Math.max(0, c.total))), 0) || 1,
    sum = cats.reduce((a, c) => a + c.total, 0);
  if (!cats.length) return <p className="muted t-cap">Nothing to plot for these filters.</p>;
  return (
    <div className="cwrap" ref={tipRef}>
      <Legend series={series} />
      <div className="hb" role="list">
        {cats.map((c) => {
          const segs = series.filter((s) => (c.vals[s.key] || 0) > 0),
            tot = many ? segs.reduce((a, s) => a + c.vals[s.key], 0) : Math.max(0, c.total),
            dim = picked != null && picked !== c.key;
          return (
            <div key={c.key} className={cx('hb-row', dim && 'dim')} role="listitem">
              <span className="hb-l ellipsis" title={c.label}>
                {c.label}
              </span>
              <div className="hb-track">
                {segs.map((s, i) => {
                  const v = c.vals[s.key],
                    tip = {
                      head: many ? c.label : null,
                      rows: [
                        {
                          ci: many ? s.ci : null,
                          v: fmtNum(v),
                          l: many ? s.label : c.label,
                        },
                      ],
                      foot: many
                        ? unit + ' · ' + Math.round((v / (tot || 1)) * 100) + '% of ' + c.label
                        : unit + (sum && unit === 'Count' ? ' · ' + Math.round((v / sum) * 100) + '% of ' + fmtNum(sum) : ''),
                    };
                  const can = !!onPick && !c.fold && !s.keys;
                  return (
                    <button
                      key={s.key}
                      className={cx('hb-seg', i === segs.length - 1 && 'end', can && 'can')}
                      style={{
                        flex: (v / max) * 100 + ' 1 0',
                        background: cvar(s.ci),
                      }}
                      aria-label={c.label + (many ? ', ' + s.label : '') + ': ' + fmtNum(v)}
                      onClick={() => {
                        if (can && onPick) onPick(c, s);
                      }}
                      onMouseMove={(e) => T.show(e, tip)}
                      onMouseLeave={T.hide}
                      onFocus={(e) => T.show(e, tip)}
                      onBlur={T.hide}
                    />
                  );
                })}
                <span className="hb-v">{fmtNum(c.total)}</span>
                <span
                  style={{
                    flex: (Math.max(0, max - tot) / max) * 100 + ' 1 0',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <Tip tip={T.tip} />
    </div>
  );
}

/* ---------- time on the x axis: a line, an area, or columns ---------- */
export function TimePlot({
  buckets,
  b,
  series,
  kind,
  unit,
  whole,
  onPick,
  about,
}: {
  buckets: string[];
  b: string;
  series: TimeSeries[];
  kind: string;
  unit: string;
  whole: boolean;
  onPick?: (i: number) => void;
  about: string;
}) {
  const { ref: tipRef, ...T } = useTip(),
    w = useWidth(tipRef),
    s0 = useState(-1),
    hov = s0[0],
    n = buckets.length,
    many = series.length > 1,
    bar = kind === 'bar',
    direct = !bar && many && series.length <= 4;
  if (!n) return <p className="muted t-cap">No dates to plot for these filters.</p>;
  const tops = buckets.map((_, i) =>
      bar ? series.reduce((a, s) => a + Math.max(0, s.vals[i] || 0), 0) : Math.max(...series.map((s) => s.vals[i] || 0)),
    ),
    ticks = niceTicks(Math.max(...tops, 0), whole),
    // room on the left for the widest axis label, so large amounts such as 300,000 are not cut off
    widest = Math.max(...ticks.map((v) => fmtNum(v).length));
  const h = 228,
    m = {
      l: Math.max(42, Math.ceil(widest * 7 + 14)),
      r: direct ? 104 : 14,
      t: 10,
      b: 24,
    },
    iw = Math.max(60, w - m.l - m.r),
    ih = h - m.t - m.b,
    band = iw / n,
    cxi = (i: number) => m.l + band * (i + 0.5);
  const ymax = ticks[ticks.length - 1] || 1,
    y = (v: number) => m.t + ih - (Math.max(0, v) / ymax) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 62)))),
    bw = Math.max(2, Math.min(24, band * 0.68));
  const tipFor = (i: number): TipContent => ({
    head: bucketLong(buckets[i], b),
    rows: series.map((s) => ({
      ci: many ? s.ci : null,
      v: fmtNum(s.vals[i] || 0),
      l: many ? s.label : unit,
    })),
    foot: many && bar ? 'Total ' + fmtNum(tops[i]) : null,
  });
  const over = (e: MouseEvent<Element>, i: number) => {
      if (hov !== i) s0[1](i);
      T.show(e, tipFor(i));
    },
    out = () => {
      s0[1](-1);
      T.hide();
    };
  const ends = direct
    ? series
        .map((s) => ({
          s,
          y: y(s.vals[n - 1] || 0),
        }))
        .sort((a, c) => a.y - c.y)
    : [];
  ends.forEach((e, i) => {
    if (i && e.y < ends[i - 1].y + 15) e.y = ends[i - 1].y + 15;
  });
  for (let i = ends.length - 1; i >= 0; i--) {
    const lim = m.t + ih - (ends.length - 1 - i) * 15;
    if (ends[i].y > lim) ends[i].y = lim;
  }
  const col = (i: number) => {
    let acc = 0;
    const live = series.filter((s) => (s.vals[i] || 0) > 0),
      x = cxi(i) - bw / 2;
    return live.map((s, k) => {
      const v = s.vals[i],
        y1 = y(acc + v),
        y0 = y(acc) - (k ? 2 : 0);
      acc += v;
      const hh = Math.max(1, y0 - y1),
        r = k === live.length - 1 ? Math.min(4, hh, bw / 2) : 0;
      return (
        <path
          key={s.key}
          d={
            'M' +
            x +
            ' ' +
            y0 +
            'V' +
            (y1 + r) +
            'Q' +
            x +
            ' ' +
            y1 +
            ' ' +
            (x + r) +
            ' ' +
            y1 +
            'H' +
            (x + bw - r) +
            'Q' +
            (x + bw) +
            ' ' +
            y1 +
            ' ' +
            (x + bw) +
            ' ' +
            (y1 + r) +
            'V' +
            y0 +
            'Z'
          }
          fill={cvar(s.ci)}
          opacity={hov >= 0 && hov !== i ? 0.5 : 1}
        />
      );
    });
  };
  return (
    <div className="cwrap" ref={tipRef}>
      <Legend series={series} />
      <svg className="plot" width={w} height={h} role="img" aria-label={about}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} className={v === 0 ? 'ax0' : 'grid'} />
            <text x={m.l - 8} y={y(v) + 4} className="axl" textAnchor="end">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        {buckets.map((k, i) =>
          i % every === 0 ? (
            <text key={k} x={cxi(i)} y={h - 6} className="axl" textAnchor="middle">
              {bucketLabel(k, b)}
            </text>
          ) : null,
        )}
        {hov >= 0 && <line x1={cxi(hov)} x2={cxi(hov)} y1={m.t} y2={m.t + ih} className="cross" />}
        {bar
          ? buckets.map((_, i) => <g key={i}>{col(i)}</g>)
          : series.map((s) => {
              const pts = s.vals.map((v, i) => cxi(i).toFixed(1) + ' ' + y(v || 0).toFixed(1)),
                line = 'M' + pts.join('L');
              return (
                <g key={s.key}>
                  {kind === 'area' && !many && (
                    <path
                      d={line + 'L' + cxi(n - 1).toFixed(1) + ' ' + y(0) + 'L' + cxi(0).toFixed(1) + ' ' + y(0) + 'Z'}
                      fill={cvar(s.ci)}
                      opacity="0.16"
                    />
                  )}
                  <path d={line} fill="none" stroke={cvar(s.ci)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {(n === 1 || hov >= 0) && (
                    <circle cx={cxi(n === 1 ? 0 : hov)} cy={y(s.vals[n === 1 ? 0 : hov] || 0)} r="5" fill={cvar(s.ci)} className="dot" />
                  )}
                </g>
              );
            })}
        {ends.map((e) => (
          <g key={e.s.key}>
            <circle cx={m.l + iw + 10} cy={e.y} r="4" fill={cvar(e.s.ci)} />
            <text x={m.l + iw + 19} y={e.y + 4} className="axd">
              {e.s.label.length > 13 ? e.s.label.slice(0, 12) + '…' : e.s.label}
            </text>
          </g>
        ))}
        {buckets.map((k, i) => (
          <rect
            key={k}
            x={m.l + band * i}
            y={m.t}
            width={band}
            height={ih}
            className={cx('hit', onPick && 'can')}
            onMouseMove={(e) => over(e, i)}
            onMouseLeave={out}
            onClick={() => onPick && onPick(i)}
          />
        ))}
      </svg>
      <Tip tip={T.tip} />
    </div>
  );
}
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl compact">
        <thead>
          <tr>
            {head.map((x, i) => (
              <th key={i} className={i ? 'num' : ''}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((x, j) => (
                <td key={j} className={j ? 'num' : ''}>
                  {j ? fmtNum(x) : x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export const measureOpts = (t: AppTable) => {
  const nums = t.columns.filter(isMeasure);
  return [
    {
      name: 'count',
      label: 'Count of ' + t.label.toLowerCase(),
    },
  ].concat(
    nums.map((c) => ({
      name: 'sum:' + c.name,
      label: 'Total ' + colName(c).toLowerCase(),
    })),
    nums.map((c) => ({
      name: 'avg:' + c.name,
      label: 'Average ' + colName(c).toLowerCase(),
    })),
  );
};
export const pickPair = (xc: ColumnDef, sp: ColumnDef | null, c: CatBar, s: Group | null): (DrillPair | null)[] => [
  c.fold
    ? null
    : {
        col: xc.name,
        val: c.val,
      },
  sp && s && s.key !== '_' && !s.keys
    ? {
        col: sp.name,
        val: s.val,
      }
    : null,
];
export function VChart({ app, user, pane, scr, t, rows, cfg, setCfg, drill }: ViewProps) {
  const xc = colOf(t, cfg.x),
    M = measureOf(t, cfg.measure),
    id = 'ch' + scr.id + pane.n;
  if (!xc) return <Empty icon="dashboard" title="Nothing to plot by" text="This table has no category or date field." />;
  const time = isDate(xc),
    kind = time ? (cfg.kind && ['line', 'area', 'bar'].includes(cfg.kind) ? cfg.kind : 'line') : 'bar',
    noStack = M.fn === 'avg' && (!time || kind === 'bar');
  const sp = (cfg.split && cfg.split !== xc.name && !noStack ? colOf(t, cfg.split) : null) || null,
    TD = time ? timeData(app, user, t, rows, xc, sp, M, cfg.bucket) : null,
    CD = TD ? null : catData(app, user, t, rows, xc, sp, M),
    series: Group[] = TD ? TD.series : CD ? CD.series : [];
  const about =
    M.label + ' of ' + t.label.toLowerCase() + ' by ' + colName(xc).toLowerCase() + (sp ? ', split by ' + colName(sp).toLowerCase() : '');
  const head = [colName(xc)].concat(
      series.map((s) => s.label),
      series.length > 1 && !time ? ['Total'] : [],
    ),
    table: (string | number)[][] = TD
      ? TD.buckets.map((k, i) => [bucketLong(k, TD.b) as string | number].concat(TD.series.map((s) => s.vals[i] || 0)))
      : (CD ? CD.cats : []).map((c) =>
          [c.label as string | number].concat(
            series.map((s) => c.vals[s.key] || 0),
            series.length > 1 ? [c.total] : [],
          ),
        );
  return (
    <>
      <div className="vopts">
        <Pick id={id + 'm'} label="Show" value={cfg.measure} opts={measureOpts(t)} onChange={(v) => setCfg('measure', v || 'count')} />
        <Pick
          id={id + 'x'}
          label="by"
          value={xc.name}
          opts={t.columns.filter((c) => isCat(c) || isDate(c))}
          onChange={(v) => setCfg('x', v)}
        />
        <Pick
          id={id + 's'}
          label="split by"
          value={sp ? sp.name : ''}
          none="Nothing"
          opts={t.columns.filter((c) => isCat(c) && c.name !== xc.name)}
          onChange={(v) => setCfg('split', v)}
        />
        {time && (
          <>
            <Pick
              id={id + 'b'}
              label="every"
              value={TD ? TD.b : null}
              opts={[
                {
                  name: 'day',
                  label: 'Day',
                },
                {
                  name: 'week',
                  label: 'Week',
                },
                {
                  name: 'month',
                  label: 'Month',
                },
              ]}
              onChange={(v) => setCfg('bucket', v)}
            />
            <Seg
              label="Chart shape"
              items={[
                {
                  id: 'line',
                  label: 'Line',
                },
                {
                  id: 'area',
                  label: 'Area',
                },
                {
                  id: 'bar',
                  label: 'Columns',
                },
              ]}
              value={kind}
              onChange={(v: string) => setCfg('kind', v)}
            />
          </>
        )}
        <span className="grow" />
        <Switch id={id + 't'} on={!!cfg.table} onChange={(v: boolean) => setCfg('table', v)} text="Data table" />
      </div>
      {noStack && cfg.split ? <p className="t-cap muted">Averages cannot be stacked, so the split is off for this shape.</p> : null}
      <Card className="card chart-card">
        <h3 className="widget-h">{cap(about)}</h3>
        {TD ? (
          <TimePlot
            buckets={TD.buckets}
            b={TD.b}
            series={TD.series}
            kind={kind}
            unit={M.label}
            whole={M.fn === 'count'}
            about={about}
            onPick={(i) =>
              drill([
                {
                  col: xc.name,
                  op: 'between',
                  val: [TD.buckets[i], bucketEnd(TD.buckets[i], TD.b)],
                },
              ])
            }
          />
        ) : (
          <HBars cats={CD ? CD.cats : []} series={series} unit={M.label} onPick={(c, s) => drill(pickPair(xc, sp, c, s))} />
        )}
        <p className="t-cap muted">Select a mark to see the records behind it.</p>
      </Card>
      {cfg.table ? <DataTable head={head} rows={table} /> : null}
    </>
  );
}
export function VPivot({ app, user, pane, scr, t, rows, cfg, setCfg, set, drill }: ViewProps) {
  const rc = colOf(t, cfg.rows),
    cc = colOf(t, cfg.cols),
    M = measureOf(t, cfg.measure),
    cats = t.columns.filter(isCat),
    id = 'pv' + scr.id + pane.n;
  if (!rc || !cc || rc.name === cc.name)
    return <Empty icon="grid" title="Pick two different fields" text="A pivot crosses one category field with another." />;
  const gr = groupsOf(app, user, t, rc, rows, false),
    gc = groupsOf(app, user, t, cc, rows, false),
    grid = gr.map((a) => {
      const la = rows.filter((r) => inGroup(a, r, rc));
      return {
        a,
        list: la,
        cells: gc.map((b) => {
          const l = la.filter((r) => inGroup(b, r, cc));
          return {
            n: l.length,
            v: aggOf(M, l),
          };
        }),
      };
    });
  const max = Math.max(1, ...grid.flatMap((g) => g.cells.map((x) => x.v))),
    shade = (x: { n: number; v: number }) =>
      x.n && x.v > 0
        ? {
            background: 'color-mix(in srgb, var(--c1) ' + Math.round(8 + 50 * (x.v / max)) + '%, transparent)',
          }
        : null;
  const swap = () =>
    set((s) => {
      s.cfg.pivot = Object.assign({}, s.cfg.pivot, {
        rows: cc.name,
        cols: rc.name,
      });
    });
  return (
    <>
      <div className="vopts">
        <Pick
          id={id + 'r'}
          label="Rows"
          value={rc.name}
          opts={cats.filter((c) => c.name !== cc.name)}
          onChange={(v) => setCfg('rows', v)}
        />
        <Btn className="btn subtle icon sm" title="Swap rows and columns" aria-label="Swap rows and columns" onClick={swap}>
          <Icon n="swap" s="16" />
        </Btn>
        <Pick
          id={id + 'c'}
          label="Columns"
          value={cc.name}
          opts={cats.filter((c) => c.name !== rc.name)}
          onChange={(v) => setCfg('cols', v)}
        />
        <Pick id={id + 'm'} label="Show" value={cfg.measure} opts={measureOpts(t)} onChange={(v) => setCfg('measure', v || 'count')} />
        <span className="grow" />
        <span className="heat-lg t-cap muted" aria-hidden="true">
          Fewer
          {[10, 22, 34, 46, 58].map((p) => (
            <span
              key={p}
              className="heat-sw"
              style={{
                background: 'color-mix(in srgb, var(--c1) ' + p + '%, transparent)',
              }}
            />
          ))}
          More
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl pivot">
          <thead>
            <tr>
              <th>
                {rc.label}
                {' / '}
                {cc.label}
              </th>
              {gc.map((b) => (
                <th key={b.key} className="num">
                  {b.label}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((g) => (
              <tr key={g.a.key}>
                <th scope="row">{g.a.label}</th>
                {g.cells.map((x, j) => (
                  <td key={j} className="num pv-c" style={toStyle(shade(x) || undefined)}>
                    {x.n ? (
                      <button
                        className="pv-b"
                        aria-label={g.a.label + ', ' + gc[j].label + ': ' + fmtNum(x.v)}
                        onClick={() =>
                          drill([
                            {
                              col: rc.name,
                              val: g.a.val,
                            },
                            {
                              col: cc.name,
                              val: gc[j].val,
                            },
                          ])
                        }
                      >
                        {fmtNum(x.v)}
                      </button>
                    ) : (
                      <span className="muted" aria-label="none">
                        ·
                      </span>
                    )}
                  </td>
                ))}
                <td className="num t-strong">{fmtNum(aggOf(M, g.list))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {gc.map((b) => (
                <td key={b.key} className="num">
                  {fmtNum(
                    aggOf(
                      M,
                      rows.filter((r) => inGroup(b, r, cc)),
                    ),
                  )}
                </td>
              ))}
              <td className="num">{fmtNum(aggOf(M, rows))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="t-cap muted">
        {M.label}
        {' of '}
        {t.label.toLowerCase()}. Select a cell to see the records behind it.
      </p>
    </>
  );
}
export function VTimeline({ app, user, pane, scr, t, rows, st, cfg, setCfg, set, open }: ViewProps) {
  const def = app.def,
    sc = colOf(t, cfg.start),
    ec = cfg.end ? colOf(t, cfg.end) : null,
    lane = cfg.lane ? colOf(t, cfg.lane) : null,
    P = def.process && def.process.table === t.name ? def.process : null,
    id = 'tm' + scr.id + pane.n;
  if (!sc) return <Empty icon="timeline" title="No date field" />;
  const day = 864e5,
    base = today(),
    dates = rows.map((r) => parseISO(asText(r[sc.name]))).filter((d): d is Date => !!d),
    reach = dates.length ? Math.max(...dates.map((d) => Math.abs(d.getTime() - base.getTime()) / day)) : 0,
    zoom = cfg.zoom || (reach <= 8 ? 'w2' : reach <= 30 ? 'w6' : 'q');
  const span =
      (
        {
          w2: 14,
          w6: 42,
          q: 91,
        } as Dict<number>
      )[zoom] || 91,
    ws = new Date(base.getFullYear(), base.getMonth(), base.getDate() - Math.round(span * (zoom === 'w2' ? 0.45 : 0.3)) + (st.tlOff || 0)),
    pct = (d: Date) => ((d.getTime() - ws.getTime()) / (span * day)) * 100;
  /** a record on the timeline: from `a` to `b`, on sub-row `row` of its lane */
  type Item = { r: StoredRow; a: Date; b: Date; row: number };
  const items = rows
    .map((r): Item | null => {
      const a = parseISO(asText(r[sc.name]));
      if (!a) return null;
      const b0 = ec && r[ec.name] ? parseISO(asText(r[ec.name])) : null,
        b =
          ec && b0 && b0 >= a
            ? new Date(b0.getTime() + (ec.type === 'date' ? day : 0))
            : new Date(a.getTime() + (sc.type === 'date' ? day : 36e5));
      return {
        r,
        a,
        b,
        row: 0,
      };
    })
    .filter((x): x is Item => !!x)
    .sort((x, y) => x.a.getTime() - y.a.getTime());
  const inWin = items.filter((x) => pct(x.b) > 0 && pct(x.a) < 100),
    lanes: { k: { key: unknown; label: string }; list: Item[]; n: number }[] = lane
      ? choices(app, user, t, lane)
          .concat([
            {
              key: null,
              label: 'Not set',
            },
          ])
          .map((k) => ({
            k,
            list: inWin.filter((x) =>
              k.key == null ? x.r[lane.name] == null || x.r[lane.name] === '' : String(x.r[lane.name]) === String(k.key),
            ),
            n: 1,
          }))
          .filter((l) => l.list.length)
      : [
          {
            k: {
              key: '_',
              label: t.label,
            },
            list: inWin,
            n: 1,
          },
        ];
  lanes.forEach((l) => {
    const ends: number[] = [];
    l.list.forEach((x) => {
      const from = Math.max(0, pct(x.a)),
        to = Math.max(pct(x.b), from + 15);
      let i = ends.findIndex((e) => e <= from);
      if (i < 0) {
        i = ends.length;
        ends.push(0);
      }
      ends[i] = to;
      x.row = i;
    });
    l.n = Math.max(1, ends.length);
  });
  const ticks: { d: Date; major: boolean }[] = [];
  for (let i = 0; i <= span; i++) {
    const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
    if (span <= 14 || (span <= 42 ? d.getDay() === 1 : d.getDate() === 1 || (d.getDay() === 1 && d.getDate() > 4 && d.getDate() < 26)))
      ticks.push({
        d,
        major: span <= 42 || d.getDate() === 1,
      });
  }
  const move = (n: number) =>
      set((s) => {
        s.tlOff = n;
      }),
    fit = () => {
      if (!items.length) return;
      const first = items[0].a;
      set((s) => {
        s.tlOff =
          Math.round((new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime() - base.getTime()) / day) +
          Math.round(span * (zoom === 'w2' ? 0.45 : 0.3)) -
          1;
      });
    },
    now = pct(new Date());
  const bar = (x: Item) => {
    const l = Math.max(0, pct(x.a)),
      w = Math.max(0.6, Math.min(100, pct(x.b)) - l),
      tone = P ? stateTone(def, t, colOf(t, P.column), x.r[P.column]) : 'info',
      name = rowTitle(app, user, t, x.r, scr.label),
      when =
        fmtDate(asText(x.r[sc.name])) +
        (ec && x.r[ec.name] && x.r[ec.name] !== x.r[sc.name]
          ? ' to ' + fmtDate(asText(x.r[ec.name]))
          : sc.type === 'datetime'
            ? ', ' + fmtTime(asText(x.r[sc.name]))
            : '');
    return (
      <button
        key={x.r.id}
        className={cx('gt-item', 'tone-' + tone, w >= 18 ? 'in' : 'out')}
        style={{
          left: l + '%',
          width: 'max(10px, ' + w + '%)',
          top: 4 + x.row * 28 + 'px',
        }}
        title={name + ' · ' + when + (P ? ' · ' + stateLabel(def, t, colOf(t, P.column), x.r[P.column]) : '')}
        onClick={() => open(x.r)}
      >
        <span className="gt-t">{name}</span>
      </button>
    );
  };
  return (
    <>
      <div className="vopts">
        <Btn className="btn subtle icon sm" aria-label="Earlier" onClick={() => move((st.tlOff || 0) - Math.round(span / 2))}>
          <Icon n="chevLeft" s="16" />
        </Btn>
        <strong className="cal-title">
          {dayText(isoDate(ws))}
          {' to '}
          {dayText(isoDate(new Date(ws.getTime() + (span - 1) * day)))}
        </strong>
        <Btn className="btn subtle icon sm" aria-label="Later" onClick={() => move((st.tlOff || 0) + Math.round(span / 2))}>
          <Icon n="chevRight" s="16" />
        </Btn>
        <Btn className="btn sm" onClick={() => move(0)}>
          Today
        </Btn>
        <Btn className="btn sm" title="Jump to the first record" onClick={fit}>
          First
        </Btn>
        <Seg
          label="Zoom"
          items={[
            {
              id: 'w2',
              label: '2 weeks',
            },
            {
              id: 'w6',
              label: '6 weeks',
            },
            {
              id: 'q',
              label: 'Quarter',
            },
          ]}
          value={zoom}
          onChange={(v: string) => setCfg('zoom', v)}
        />
        <span className="grow" />
        <Pick
          id={id + 'l'}
          label="Lanes"
          value={lane ? lane.name : ''}
          none="One lane"
          opts={t.columns.filter(isCat)}
          onChange={(v) => setCfg('lane', v)}
        />
        {t.columns.filter(isDate).length > 1 && (
          <>
            <Pick id={id + 's'} label="From" value={sc.name} opts={t.columns.filter(isDate)} onChange={(v) => setCfg('start', v)} />
            <Pick
              id={id + 'e'}
              label="until"
              value={ec ? ec.name : ''}
              none="Same day"
              opts={t.columns.filter((c) => isDate(c) && c.name !== sc.name)}
              onChange={(v) => setCfg('end', v)}
            />
          </>
        )}
      </div>
      <div className={cx('gt', lane && 'lanes')}>
        <div className="gt-head">
          {lane && <div className="gt-lab" />}
          <div className="gt-scale">
            {ticks.map((x, i) => (
              <span
                key={i}
                className={cx('gt-tick', x.major && 'major')}
                style={{
                  left: pct(x.d) + '%',
                }}
              >
                {now > 0 && now < 100 && pct(x.d) > now - 9 && pct(x.d) < now + 4
                  ? ''
                  : span <= 14
                    ? DOW[x.d.getDay()].slice(0, 2) + ' ' + x.d.getDate()
                    : x.major
                      ? x.d.getDate() + ' ' + MON[x.d.getMonth()]
                      : ''}
              </span>
            ))}
            {now > 0 && now < 100 && (
              <span
                className="gt-now-l"
                style={{
                  left: now + '%',
                }}
              >
                Today
              </span>
            )}
          </div>
        </div>
        {lanes.map((l) => (
          <div key={String(l.k.key)} className="gt-lane">
            {lane && (
              <div className="gt-lab ellipsis" title={l.k.label}>
                {l.k.label}
                <span className="tab-n">{l.list.length}</span>
              </div>
            )}
            <div
              className="gt-track"
              style={{
                height: l.n * 28 + 6 + 'px',
              }}
            >
              {ticks.map((x, i) => (
                <span
                  key={i}
                  className={cx('gt-grid', x.major && 'major')}
                  style={{
                    left: pct(x.d) + '%',
                  }}
                />
              ))}
              {now > 0 && now < 100 && (
                <span
                  className="gt-now"
                  style={{
                    left: now + '%',
                  }}
                />
              )}
              {l.list.map(bar)}
            </div>
          </div>
        ))}
        {!inWin.length && (
          <div className="gt-none muted">
            {items.length
              ? 'Nothing between these dates. Use First to jump to the earliest record.'
              : 'No ' + t.label.toLowerCase() + ' with a date to show.'}
          </div>
        )}
      </div>
      <p className="t-cap muted">
        {inWin.length}
        {' of '}
        {items.length} {t.label.toLowerCase()}
        {items.length < rows.length ? ' with a date' : ''}
        {' fall between these dates'}
        {P ? '. Colour shows the status.' : '.'}
      </p>
    </>
  );
}

/* ---------- the dashboard: every app has one, designed by the View advisor ---------- */
export const DASH_RANGES = [
  ['all', 'All time'],
  ['past7', 'Past 7 days'],
  ['past30', 'Past 30 days'],
  ['month', 'This month'],
  ['week', 'Next 7 days'],
];
export function goRecords(
  app: AppRecord,
  user: AppUser,
  pane: Pane,
  tn: string,
  o: { view?: string; filters?: (ViewFilter | null | undefined)[]; cfg?: ViewOptions },
) {
  // from a number or a mark to the records behind it
  const def = app.def,
    t = tableOf(def, tn),
    scr = def.screens.find((s) => s.table === tn && DATA_VIEWS.includes(s.type) && s.roles.includes(user.role));
  if (!scr) return toast(roleName(def, user.role) + ' has no page for ' + (t ? t.label : tn).toLowerCase() + '.', 'info');
  const st = vxState(pane, scr, app, user);
  st.view = o.view || 'table';
  st.filters = (o.filters || []).filter((f): f is ViewFilter => !!f);
  st.q = '';
  st.page = 0;
  st.group = '';
  if (o.cfg) st.cfg[st.view] = Object.assign({}, st.cfg[st.view], o.cfg);
  pane.screen = scr.id;
  pane.rec = null;
  notify();
}
/** A dashboard widget this user may see, with its table. */
type Shown = { w: DashWidget; i: number; t: AppTable };
type DashState = NonNullable<Pane['ds']>;
/** The dashboard's date range and picked filters for this pane, made on first use. */
export function dashOf(pane: Pane): DashState {
  return pane.ds || (pane.ds = { range: 'all', f: [] });
}
/** Changes the dashboard's range or filters and redraws. */
export function setDash(ds: DashState, patch: Partial<DashState>) {
  Object.assign(ds, patch);
  notify();
}
export function Dash({
  app,
  user,
  pane,
  scr,
  test,
}: {
  app: AppRecord;
  user: AppUser;
  pane: Pane;
  /** a check draws the dashboard from a page made up on the spot */
  scr: Pick<Screen, 'id' | 'name'> & Partial<Screen>;
  test?: boolean;
}) {
  const def = app.def,
    D: DashDef = def.dash || {
      title: 'Dashboard',
      date: null,
      widgets: [],
    },
    ds = dashOf(pane),
    src = test || pane.test ? 'check' : 'app',
    cache: Dict<StoredRow[]> = {};
  const W = D.widgets
    .map((w, i) => ({
      w,
      i,
      t: tableOf(def, w.table),
    }))
    .filter((x): x is Shown => !!x.t && accOf(def, user.role, x.t.name).list !== 'none');
  const dt = (D.date && accOf(def, user.role, D.date.table).list !== 'none' ? tableOf(def, D.date.table) : null) || null,
    dc = (dt && D.date ? colOf(dt, D.date.column) : null) || null;
  const filtersFor = (tn: string): ViewFilter[] =>
    (dc && dt && dt.name === tn && ds.range !== 'all'
      ? ([
          {
            col: dc.name,
            op: 'range',
            val: ds.range,
          },
        ] as ViewFilter[])
      : []
    ).concat(
      ds.f
        .filter((f) => f.table === tn)
        .map((f): ViewFilter =>
          f.val == null
            ? {
                col: f.col,
                op: 'empty',
                val: null,
              }
            : {
                col: f.col,
                op: 'is',
                val: f.val,
              },
        ),
    );
  const rowsOf = (tn: string, skip?: string | null) => {
    const key = tn + '|' + (skip || '');
    if (cache[key]) return cache[key];
    const r = fetchApi(app, user, '/api/' + tn, null, src);
    let rows: StoredRow[] = r.status === 200 ? r.data : [];
    filtersFor(tn).forEach((f) => {
      if (f.col !== skip) rows = rows.filter((x) => passes(f, x[f.col]));
    });
    return (cache[key] = rows);
  };
  const whereRows = (x: Shown, skip?: string | null) => {
    let rows = rowsOf(x.t.name, skip);
    const where = x.w.where || {};
    Object.keys(where).forEach((k) => {
      rows = rows.filter((r) => String(r[k]) === String(where[k]));
    });
    return rows;
  }; // a chart is not filtered by its own selection, so the other bars stay visible
  const whereF = (x: Shown): ViewFilter[] =>
    Object.keys(x.w.where || {}).map((k) => ({
      col: k,
      op: 'is',
      val: (x.w.where || {})[k],
    }));
  const toggle = (tn: string, col: string, val: unknown) => {
    const i = ds.f.findIndex((f) => f.table === tn && f.col === col),
      same = i >= 0 && String(ds.f[i].val) === String(val);
    if (i >= 0) ds.f.splice(i, 1);
    if (!same)
      ds.f.push({
        table: tn,
        col,
        val,
      });
    notify();
  };
  const pickedOf = (tn: string, col: string) => {
    const f = ds.f.find((x) => x.table === tn && x.col === col);
    return f ? keyStr(f.val) : null;
  };
  const tiles = W.filter((x) => x.w.kind === 'kpi'),
    cards = W.filter((x) => x.w.kind !== 'kpi');
  // before the first record there is nothing to count: say so, and offer the way to add one (firstrun.tsx)
  const main = dt || (W[0] ? W[0].t : null),
    bare =
      W.length > 0 &&
      W.every((x) => {
        const r = fetchApi(app, user, '/api/' + x.t.name, null, src);
        return r.status === 200 && !r.data.length;
      });
  const chip = (f: { table: string; col: string; val: unknown }, i: number) => {
    const t = tableOf(def, f.table),
      c = colOf(t, f.col);
    if (!t || !c) return null;
    return (
      <FilterChip
        key={i}
        removeLabel={'Remove the filter on ' + c.label}
        onRemove={() => {
          ds.f.splice(i, 1);
          notify();
        }}
      >
        {c.label}
        {': '}
        {f.val == null ? 'Not set' : cellText(app, user, t, c, f.val, 1)}
      </FilterChip>
    );
  };
  const card = (x: Shown) => {
    const t = x.t,
      w = x.w,
      M = measureOf(t, w.measure),
      xc = colOf(t, w.x),
      sp = (w.split ? colOf(t, w.split) : null) || null,
      rows = whereRows(x, w.kind === 'bar' || w.kind === 'stack' ? w.x : null),
      base = filtersFor(t.name).concat(whereF(x));
    const openChart = () =>
      goRecords(app, user, pane, t.name, {
        view: 'chart',
        filters: base,
        cfg: {
          x: w.x,
          split: w.split || null,
          measure: w.measure || 'count',
          bucket: w.bucket,
          kind: w.kind === 'line' ? 'line' : 'bar',
        },
      });
    let body: ReactNode;
    if (w.kind === 'recent') {
      const P = def.process && def.process.table === t.name ? def.process : null;
      body = rows.length ? (
        <ul className="rel">
          {rows.slice(0, 6).map((r) => (
            <li key={r.id}>
              <button
                className="rel-i"
                onClick={() => {
                  pane.rec = {
                    table: t.name,
                    id: r.id,
                  };
                  notify();
                }}
              >
                <span className="ellipsis grow">{rowTitle(app, user, t, r)}</span>
                {P && (
                  <span className={'badge b-' + stateTone(def, t, colOf(t, P.column), r[P.column])}>
                    {stateLabel(def, t, colOf(t, P.column), r[P.column])}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted t-cap">Nothing for these filters.</p>
      );
    } else if (!xc) {
      body = <p className="muted t-cap">Nothing to plot by.</p>;
    } else if (w.kind === 'line') {
      const T = timeData(app, user, t, rows, xc, sp, M, w.bucket),
        // a single line through mostly empty days zig-zags to zero and back; columns read better there
        gaps = T.series.length === 1 ? T.series[0].vals.filter((v) => !v).length : 0,
        sparse = T.buckets.length <= 3 || gaps * 2 >= T.buckets.length;
      body = (
        <TimePlot
          buckets={T.buckets}
          b={T.b}
          series={T.series}
          kind={sparse ? 'bar' : 'line'}
          unit={M.label}
          whole={M.fn === 'count'}
          about={w.label}
          onPick={(i) =>
            goRecords(app, user, pane, t.name, {
              filters: base
                .filter((f) => f.col !== xc.name)
                .concat([
                  {
                    col: xc.name,
                    op: 'between',
                    val: [T.buckets[i], bucketEnd(T.buckets[i], T.b)],
                  },
                ]),
            })
          }
        />
      );
    } else {
      const C = catData(app, user, t, rows.concat(), xc, w.kind === 'stack' ? sp : null, M);
      body = (
        <HBars
          cats={C.cats}
          series={C.series}
          unit={M.label}
          picked={pickedOf(t.name, xc.name)}
          onPick={(c) => toggle(t.name, xc.name, c.val)}
        />
      );
    }
    return (
      <Card key={x.i} className={cx('card widget', w.kind === 'line' && 'wide')}>
        <div className="row between">
          <h3 className="widget-h">{w.label}</h3>
          {w.kind !== 'recent' && (
            <Btn
              className="btn subtle icon sm"
              title="Open in the chart view"
              aria-label={'Open ' + w.label + ' in the chart view'}
              onClick={openChart}
            >
              <Icon n="open" s="16" />
            </Btn>
          )}
        </div>
        {body}
      </Card>
    );
  };
  return (
    <div className="scr dash">
      <div className="scr-head">
        <div className="col gap0 grow">
          <h2 className="t-sub1">{scr.name}</h2>
          <span className="t-cap muted">
            {'Counted from the rows '}
            {user.name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(' ')[0]}
            {' may see. Select a bar to filter the page, or a number to open its records.'}
          </span>
        </div>
      </div>
      <div className="dash-bar">
        {dc && (
          <>
            <span className="t-cap muted">{dc.label}</span>
            <Seg
              label={'Filter by ' + dc.label}
              items={DASH_RANGES.map((r) => ({
                id: r[0],
                label: r[1],
              }))}
              value={ds.range}
              onChange={(v: string) => setDash(ds, { range: v })}
            />
          </>
        )}
        {ds.f.map(chip)}
        {(ds.f.length > 0 || ds.range !== 'all') && (
          <Btn className="btn subtle sm" onClick={() => setDash(ds, { f: [], range: 'all' })}>
            Clear
          </Btn>
        )}
      </div>
      {bare && main ? (
        <EmptyDash
          app={app}
          user={user}
          t={main}
          onAdd={() => patchPane(pane, { form: { table: main.name, id: null, vals: {}, errs: {} } })}
        />
      ) : W.length ? (
        <>
          <div className="kpis">
            {tiles.map((x) => {
              const rows = whereRows(x),
                all = rowsOf(x.t.name),
                M = measureOf(x.t, x.w.measure),
                v = aggOf(M, rows),
                hasW = Object.keys(x.w.where || {}).length > 0;
              return (
                <button
                  key={x.i}
                  className="kpi"
                  title="Open these records"
                  onClick={() =>
                    goRecords(app, user, pane, x.t.name, {
                      filters: filtersFor(x.t.name).concat(whereF(x)),
                    })
                  }
                >
                  <span className="kpi-l">{x.w.label}</span>
                  <span className="kpi-v">{fmtNum(v)}</span>
                  <span className="kpi-s">
                    {hasW && M.fn === 'count' && all.length
                      ? Math.round((v / all.length) * 100) + '% of ' + fmtNum(all.length)
                      : M.fn === 'count'
                        ? 'in total'
                        : M.label.toLowerCase()}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="dash-grid">{cards.map(card)}</div>
        </>
      ) : (
        <Empty icon="pie" title="Nothing to show for this role" text="The dashboard only counts tables this role may read." />
      )}
    </div>
  );
}
