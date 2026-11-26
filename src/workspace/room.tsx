// @ts-nocheck -- converted from the prototype; types are added module by module
import { toStyle, NativeField } from '@/platform/dom';
import { S, U, arr, brief, commit, cx, fmtDate, fmtMs, fmtNum, label, notify, online, snake, str, toast, liveModelOn } from './core';
import { VIEW_ICON, accOf, apiCall, chk, colOf, roleName, tableOf, tourValues } from './engine';
import { DATA_VIEWS } from './viewspec';
import { REC, allConnectors, connOn } from './builds';
import { TEAMS, TeamAv, canRunTeam, runTeam, sameText, stopTeam, teamBlock, teamCase, teamJump } from './team';
import { Avatar, Empty, Icon, MBar, Proto, Spinner } from './ui';
import { FieldInput, cellText, fetchApi, formCols, isStatusCol, optLabel, rowTitle, saveForm, stateLabel, stateTone } from './runtime';
import { vxState } from './views-a';

/* ===== Turnkey prototype · the agent room: where an app's own agents work, in a view picked for what they produce =====
   The View advisor writes the "board" as data: which panel shows each table the agents fill, and how the outcome reads.
   The catalog of panels is fixed (versus, list, groups, scores, options); the choice is the advisor's. Rules in code
   suggest a board whenever the advisor's answer does not fit, so a team is never left with a plain step log. */
export const BOARD_LAYOUTS = ['versus', 'list', 'groups', 'scores', 'options'];
export const BOARD_WHAT = {
  versus: 'Two sides, face to face',
  list: 'One card per record, with what belongs to it underneath',
  groups: 'Short statements sorted into groups',
  scores: 'Criteria with a score each and a total',
  options: 'Choices side by side with their numbers',
};
export const TONE_WORDS = {
  success: [
    'supported',
    'supports',
    'for',
    'agreed',
    'go',
    'won',
    'approved',
    'yes',
    'pass',
    'passed',
    'true',
    'strong',
    'difference',
    'recommended',
    'accepted',
    'pursue',
    'bid',
    'strength',
    'opportunity',
  ],
  danger: [
    'contradicted',
    'contradicts',
    'against',
    'no_go',
    'no_bid',
    'lost',
    'rejected',
    'no',
    'fail',
    'failed',
    'false',
    'risk',
    'blocker',
    'critical',
    'overlap',
    'declined',
    'shelved',
    'weakness',
    'threat',
  ],
  warning: [
    'mixed',
    'split',
    'moderate',
    'open_question',
    'conditions',
    'go_with_conditions',
    'bid_with_conditions',
    'conditional',
    'unverifiable',
    'unclear',
    'partly',
    'caution',
    'watch',
    'gap',
  ],
  info: ['recommendation', 'next_step', 'neutral', 'floor', 'note', 'question', 'action'],
};
export const wordTone = (v) => {
  const k = snake(String(v == null ? '' : v));
  for (const t in TONE_WORDS) if (TONE_WORDS[t].includes(k)) return t;
  return 'neutral';
};
export const TONE_GLYPH = {
  success: 'checkCircle',
  danger: 'warning',
  warning: 'questionChat',
  info: 'lightbulb',
  neutral: 'circle',
};
export const LEVEL_OF = {
  high: 3,
  strong: 3,
  critical: 3,
  major: 3,
  medium: 2,
  moderate: 2,
  some: 2,
  low: 1,
  weak: 1,
  minor: 1,
  none: 0,
};
export const niceTop = (m) => (m <= 1 ? 1 : m <= 5 ? 5 : m <= 10 ? 10 : m <= 100 ? 100 : m);
export function boardTables(def) {
  const tm = def.team,
    out = [];
  if (!tm) return out;
  tm.agents.forEach((a) =>
    [a.writes, a.updates].forEach((n) => {
      if (n && n !== tm.input.table && !out.includes(n)) out.push(n);
    }),
  );
  return out;
}

/* ---------- the board as data: normalise the advisor's answer, or suggest one by rule ---------- */
export function normPanel(p, def, kid) {
  p = p || {};
  const tm = def.team,
    t = tableOf(def, snake(p.table));
  if (!t || !boardTables(def).includes(t.name)) return null;
  const col = (n, types) => {
    const c = n ? colOf(t, snake(n)) : null;
    return c && types.includes(c.type) ? c.name : null;
  };
  const o = {
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
      .filter(Boolean)
      .slice(0, 3),
    sides: [],
    only: [],
    children: null,
  };
  const rp = p.reply ? colOf(t, snake(p.reply)) : null;
  if (rp && rp.type === 'ref' && rp.ref === t.name) o.reply = rp.name;
  if (o.by) {
    const opts = colOf(t, o.by).options;
    o.only = arr(p.only)
      .map(snake)
      .filter((v) => opts.includes(v));
    o.sides = arr(p.sides)
      .map(snake)
      .filter((v, i, a) => opts.includes(v) && a.indexOf(v) === i)
      .slice(0, 2);
  }
  if (o.layout === 'versus') {
    if (o.by && o.sides.length < 2) {
      const fx = tm.agents.filter((a) => a.writes === t.name && a.fixed && a.fixed[o.by]).map((a) => a.fixed[o.by]);
      o.sides = fx
        .concat(colOf(t, o.by).options)
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
      via = kt && kt.name !== t.name && kt.columns.find((c) => c.type === 'ref' && c.ref === t.name && (!k.via || c.name === snake(k.via))),
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
    if (kp)
      o.children = Object.assign(kp, {
        via: via.name,
      });
  }
  return o;
}
export function suggestBoard(def) {
  // what code lays out when the View advisor gives nothing usable
  const tm = def.team,
    it = tableOf(def, tm.input.table),
    tabs = boardTables(def)
      .map((n) => tableOf(def, n))
      .filter(Boolean),
    sets = [].concat
      .apply(
        [],
        tm.agents.map((a) => a.sets),
      )
      .map((n) => colOf(it, n))
      .filter(Boolean);
  const parentOf = (t) => tabs.find((p) => p.name !== t.name && t.columns.some((c) => c.type === 'ref' && c.ref === p.name)),
    viaOf = (t, p) => t.columns.find((c) => c.type === 'ref' && c.ref === p.name);
  const first = (t, types, skip) =>
      (t.columns.find((c) => types.includes(c.type) && c.name !== t.title && !(skip || []).includes(c.name)) || {}).name || null,
    base = (t) => ({
      table: t.name,
      title: t.label,
      badge: first(t, ['select']),
      text: first(t, ['longtext']),
      meter: first(t, ['number']),
    }),
    panels = [];
  tabs.forEach((t) => {
    const parent = parentOf(t),
      via = parent && viaOf(t, parent);
    if (parent && via.required) return; // always drawn under its parent
    const fx = {};
    tm.agents.forEach((a) => {
      if (a.writes === t.name)
        Object.keys(a.fixed || {}).forEach((k) => {
          (fx[k] = fx[k] || []).push(a.fixed[k]);
        });
    });
    const vs = Object.keys(fx).find((k) => colOf(t, k) && colOf(t, k).type === 'select' && new Set(fx[k]).size >= 2),
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
        reply: (t.columns.find((c) => c.type === 'ref' && c.ref === t.name) || {}).name,
      });
    else if (sc)
      Object.assign(p, {
        layout: 'scores',
        score: sc.name,
        weight: (t.columns.find((c) => c.type === 'number' && /weight/.test(c.name)) || {}).name,
        meter: null,
      });
    else if (kids.length)
      Object.assign(p, {
        layout: 'list',
        children: Object.assign(base(kids[0]), {
          via: viaOf(kids[0], t).name,
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
  const pick = (types) => (sets.find((c) => types.includes(c.type)) || {}).name || null;
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
      .filter(Boolean)
      .slice(0, 4),
  };
}
export function normBoard(o, def) {
  const tm = def.team;
  if (!tm) return null;
  const sug = suggestBoard(def),
    panels = arr(o && o.panels)
      .map((p) => normPanel(p, def))
      .filter(Boolean)
      .slice(0, 4);
  if (!panels.length) return sug;
  const it = tableOf(def, tm.input.table),
    sets = [].concat.apply(
      [],
      tm.agents.map((a) => a.sets),
    ),
    v = o.verdict || {},
    vc = (n, types) => {
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
export const boardOf = (def) => (def.team ? def.board || suggestBoard(def) : null);
export const boardText = (b) =>
  b ? b.panels.map((p) => label(p.layout) + ' of ' + p.table + (p.children ? ' with ' + p.children.table : '')).join(', ') : '';
export function checkBoard(def, b) {
  const names = boardTables(def),
    shown = b.panels.map((p) => p.table).concat(b.panels.filter((p) => p.children).map((p) => p.children.table)),
    miss = names.filter((n) => !shown.includes(n));
  return chk(
    "The agent room shows everything the app's own agents write",
    !miss.length,
    miss.length ? 'no panel for ' + miss.join(', ') : boardText(b),
  );
}
export function boardRows(app, user, def, t, it, id, src) {
  // the rows of one table that belong to one case, oldest first
  const res = fetchApi(app, user, '/api/' + t.name, null, src);
  if (res.status !== 200) return [];
  const direct = t.columns.find((c) => c.type === 'ref' && c.ref === it.name);
  let rows;
  if (direct) rows = res.data.filter((r) => r[direct.name] === id);
  else {
    const mid = t.columns
      .map((c) => (c.type === 'ref' ? tableOf(def, c.ref) : null))
      .filter(Boolean)
      .find((m) => m.name !== t.name && m.columns.some((c) => c.type === 'ref' && c.ref === it.name));
    if (!mid) return [];
    const via = t.columns.find((c) => c.type === 'ref' && c.ref === mid.name).name,
      ids = boardRows(app, user, def, mid, it, id, src).map((r) => r.id);
    rows = res.data.filter((r) => ids.includes(r[via]));
  }
  return rows.slice().sort((a, b) => a.id - b.id);
}

/* ---------- drawing a board ---------- */
export function Ring({ pct, size, tone }) {
  const s = size || 60,
    r = (s - 8) / 2,
    c = 2 * Math.PI * r,
    p = Math.max(0, Math.min(100, pct));
  return (
    <svg
      className={'ring tone-' + (tone || (p >= 67 ? 'success' : p >= 34 ? 'warning' : 'danger'))}
      width={s}
      height={s}
      viewBox={'0 0 ' + s + ' ' + s}
      role="img"
      aria-label={p + ' out of 100'}
    >
      <circle className="ring-bg" cx={s / 2} cy={s / 2} r={r} />
      <circle
        className="ring-fg"
        cx={s / 2}
        cy={s / 2}
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p / 100)}
        transform={'rotate(-90 ' + s / 2 + ' ' + s / 2 + ')'}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
        {p}
      </text>
    </svg>
  );
}
export function CaseBoard({ app, user, pane, board, it, row, src }) {
  const def = app.def,
    tm = def.team,
    open = (tn, id) => {
      pane.rec = {
        table: tn,
        id,
      };
      notify();
    };
  const title = (t, r) => rowTitle(app, user, t, r),
    txt = (t, n, r) => (n && r[n] != null && r[n] !== '' ? cellText(app, user, t, colOf(t, n), r[n], 0) : '');
  const tone = (t, c, v) => (isStatusCol(def, t, c) ? stateTone(def, t, c, v) : wordTone(v));
  const badge = (t, n, r) => {
    if (!n || r[n] == null || r[n] === '') return null;
    const c = colOf(t, n);
    return <span className={'badge b-' + tone(t, c, r[n])}>{stateLabel(def, t, c, r[n])}</span>;
  };
  const bar = (v, top, text, tn) => (
    <span className="bd-meter">
      <span className="bd-meter-bar">
        <span
          className={'bd-meter-fill tone-' + (tn || 'info')}
          style={toStyle('width:' + Math.max(0, Math.min(100, Math.round((100 * v) / (top || 1)))) + '%')}
        />
      </span>
      <span className="bd-meter-n">{text}</span>
    </span>
  );
  const writers = (t) => tm.agents.filter((a) => a.writes === t.name || a.updates === t.name).map((a) => a.name),
    none = (t) => (
      <p className="muted t-cap bd-none">
        {'Nothing here yet. '}
        {writers(t).join(' and ') || 'The agents'} {writers(t).length > 1 ? 'fill' : 'fills'}
        {' this in during a run.'}
      </p>
    );
  const foot = (p, t, r) => {
    const bits = [];
    if (p.tag && txt(t, p.tag, r))
      bits.push(
        <span key="t" className="badge b-outline">
          {txt(t, p.tag, r)}
        </span>,
      );
    p.facts.forEach((n) => {
      if (txt(t, n, r))
        bits.push(
          <span key={n} className="t-cap muted">
            {colOf(t, n).label} {/year/.test(n) ? String(r[n]) : txt(t, n, r)}
          </span>,
        );
    });
    if (p.link && /^https?:\/\//.test(str(r[p.link])))
      bits.push(
        <a key="l" className="bd-link" href={r[p.link]} target="_blank" rel="noopener noreferrer">
          <Icon n="link" s="12" />
          Source
        </a>,
      );
    return bits.length ? <div className="row wrap gap4 bd-foot">{bits}</div> : null;
  };
  const kidsOf = (p, r) => {
    const k = p.children;
    if (!k) return null;
    const kt = tableOf(def, k.table);
    if (!kt || accOf(def, user.role, kt.name).list === 'none') return null;
    const rows = boardRows(app, user, def, kt, it, row.id, src).filter(
      (x) => x[k.via] === r.id && (!k.only.length || k.only.includes(x[k.by])),
    );
    if (!rows.length) return null;
    return (
      <ul className="bd-kids" aria-label={kt.label}>
        {rows.map((x) => (
          <li
            key={x.id}
            className={'bd-kid tone-' + (k.badge && x[k.badge] != null ? tone(kt, colOf(kt, k.badge), x[k.badge]) : 'neutral')}
          >
            <div className="bd-top">
              <button className="bd-open" title={'Open this ' + kt.one.toLowerCase()} onClick={() => open(kt.name, x.id)}>
                {title(kt, x)}
              </button>
              {badge(kt, k.badge, x)}
            </div>
            {k.text && k.text !== kt.title && txt(kt, k.text, x) ? <p className="bd-text">{txt(kt, k.text, x)}</p> : null}
            {foot(k, kt, x)}
          </li>
        ))}
      </ul>
    );
  };
  const item = (p, t, r, rows, top) => {
    const lv = p.rank ? (colOf(t, p.rank).type === 'select' ? LEVEL_OF[r[p.rank]] : +r[p.rank]) : null,
      to = p.reply && r[p.reply] ? rows.find((x) => x.id === r[p.reply]) : null;
    return (
      <li key={r.id} className="bd-item">
        {to && (
          <span className="bd-reply">
            <Icon n="arrowRight" s="12" />
            Answers “{brief(title(t, to), 64)}”
          </span>
        )}
        <div className="bd-top">
          <button className="bd-open" title={'Open this ' + t.one.toLowerCase()} onClick={() => open(t.name, r.id)}>
            {title(t, r)}
          </button>
          {badge(t, p.badge, r)}
        </div>
        {p.rank && lv != null
          ? colOf(t, p.rank).type === 'select'
            ? bar(
                lv,
                3,
                colOf(t, p.rank).label + ': ' + stateLabel(def, t, colOf(t, p.rank), r[p.rank]),
                lv >= 3 ? 'danger' : lv === 2 ? 'warning' : 'success',
              )
            : bar(lv, top.rank, colOf(t, p.rank).label + ' ' + fmtNum(lv))
          : null}
        {p.meter && r[p.meter] != null && r[p.meter] !== ''
          ? bar(
              +r[p.meter],
              top.meter,
              colOf(t, p.meter).label + ' ' + fmtNum(+r[p.meter]) + (top.meter === 100 ? '%' : ' of ' + top.meter),
            )
          : null}
        {p.text && p.text !== t.title && txt(t, p.text, r) ? <p className="bd-text">{txt(t, p.text, r)}</p> : null}
        {foot(p, t, r)}
        {kidsOf(p, r)}
      </li>
    );
  };
  const versus = (p, t, rows) => {
    const c = colOf(t, p.by),
      per = p.sides.map((s) => rows.filter((r) => r[p.by] === s)),
      rest = rows.filter((r) => !p.sides.includes(r[p.by])),
      ag = (s) => tm.agents.find((a) => a.writes === t.name && a.fixed && a.fixed[p.by] === s);
    const wt = (rs) => rs.reduce((n, r) => n + (p.badge && LEVEL_OF[r[p.badge]] != null ? LEVEL_OF[r[p.badge]] : 1), 0),
      w = per.map(wt),
      acc = p.sides.map(
        (s, i) =>
          (
            ag(s) || {
              acc: i ? 'cranberry' : 'forest',
            }
          ).acc,
      ),
      names = p.sides.map((s) => optLabel(c, s)),
      others = rest.map((r) => optLabel(c, r[p.by])).filter((v, i, a) => a.indexOf(v) === i);
    return (
      <>
        {w[0] + w[1] > 0 && (
          <div className="bd-balance-wrap">
            <div className="bd-balance" role="img" aria-label={names[0] + ' ' + w[0] + ', ' + names[1] + ' ' + w[1]}>
              <span className={'bd-bal acc-' + acc[0]} style={toStyle('flex-grow:' + Math.max(w[0], 0.4))}>
                {names[0]} {w[0]}
              </span>
              <span className={'bd-bal acc-' + acc[1]} style={toStyle('flex-grow:' + Math.max(w[1], 0.4))}>
                {w[1]} {names[1]}
              </span>
            </div>
            <span className="t-cap muted">
              {p.badge ? 'Weight of the points made: strong counts 3, moderate 2, weak 1' : 'Number of points on each side'}
            </span>
          </div>
        )}
        <div className="bd-versus">
          {p.sides.map((s, i) => (
            <section key={s} className={'bd-side acc-' + acc[i]} aria-label={names[i]}>
              <h4 className="bd-side-h">
                {ag(s) ? <TeamAv a={ag(s)} size="sm" /> : null}
                <span className="grow">{names[i]}</span>
                <span className="tab-n">{per[i].length}</span>
              </h4>
              {per[i].length ? (
                <ul className="bd-list">{per[i].map((r) => item(p, t, r, rows, {}))}</ul>
              ) : (
                <p className="muted t-cap bd-none">{ag(s) ? ag(s).name + ' has not spoken yet.' : 'No points yet.'}</p>
              )}
            </section>
          ))}
        </div>
        {rest.length > 0 && (
          <section className="bd-rest" aria-label={others.join(', ')}>
            <h4 className="bd-side-h">
              <Icon n="people" s="16" />
              <span className="grow">{others.join(', ')}</span>
              <span className="tab-n">{rest.length}</span>
            </h4>
            <ul className="bd-list wide">{rest.map((r) => item(p, t, r, rows, {}))}</ul>
          </section>
        )}
      </>
    );
  };
  const groups = (p, t, rows) => {
    const c = colOf(t, p.by),
      vals = (p.only.length ? p.only : c.options).filter((v) => p.only.length || rows.some((r) => r[p.by] === v));
    return (
      <div className="bd-groups">
        {vals.map((v) => {
          const rs = rows.filter((r) => r[p.by] === v),
            tn = tone(t, c, v);
          return (
            <section key={v} className={'bd-group tone-' + tn}>
              <h4>
                <Icon n={TONE_GLYPH[tn]} s="16" />
                <span className="grow">{optLabel(c, v)}</span>
                <span className="tab-n">{rs.length}</span>
              </h4>
              {rs.length ? (
                <ul className="bd-lines">
                  {rs.map((r) => (
                    <li key={r.id}>
                      <button className="bd-open" title={'Open this ' + t.one.toLowerCase()} onClick={() => open(t.name, r.id)}>
                        {title(t, r)}
                      </button>
                      {p.text && p.text !== t.title && txt(t, p.text, r) ? <p className="bd-text">{txt(t, p.text, r)}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted t-cap">Nothing yet</span>
              )}
            </section>
          );
        })}
      </div>
    );
  };
  const scores = (p, t, rows) => {
    const top =
        p.max ||
        niceTop(
          Math.max.apply(
            null,
            rows.map((r) => +r[p.score] || 0),
          ),
        ),
      wOf = (r) => (p.weight ? +r[p.weight] || 1 : 1),
      ws = rows.reduce((n, r) => n + wOf(r), 0),
      got = rows.reduce((n, r) => n + (+r[p.score] || 0) * wOf(r), 0),
      pct = ws ? Math.round((100 * got) / (top * ws)) : 0;
    return (
      <div className="bd-scores">
        <div className="bd-total">
          <Ring pct={pct} />
          <div className="col gap0">
            <strong className="t-sub2">
              {pct}
              {' out of 100'}
            </strong>
            <span className="t-cap muted">
              {p.weight ? 'Weighted total of ' : 'Average of '}
              {rows.length} {rows.length === 1 ? t.one.toLowerCase() : t.label.toLowerCase()}
            </span>
          </div>
        </div>
        <ul className="bd-srows">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="bd-top">
                <button className="bd-open" title={'Open this ' + t.one.toLowerCase()} onClick={() => open(t.name, r.id)}>
                  {title(t, r)}
                </button>
                {p.weight ? (
                  <span className="t-cap muted" title={colOf(t, p.weight).label}>
                    {'× '}
                    {fmtNum(wOf(r))}
                  </span>
                ) : null}
                {badge(t, p.badge, r)}
              </div>
              {bar(
                +r[p.score] || 0,
                top,
                fmtNum(+r[p.score] || 0) + ' of ' + top,
                (+r[p.score] || 0) / top >= 0.67 ? 'success' : (+r[p.score] || 0) / top >= 0.34 ? 'warning' : 'danger',
              )}
              {p.text && p.text !== t.title && txt(t, p.text, r) ? <p className="bd-text">{txt(t, p.text, r)}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  const options = (p, t, rows) => (
    <ul className="bd-options">
      {rows.map((r) => (
        <li key={r.id} className={cx('bd-opt', p.flag && r[p.flag] && 'best')}>
          {p.flag && r[p.flag] ? (
            <span className="badge b-success bd-pick">
              <Icon n="checkCircle" s="12" />
              {colOf(t, p.flag).label}
            </span>
          ) : null}
          <div className="bd-top">
            <button className="bd-open" title={'Open this ' + t.one.toLowerCase()} onClick={() => open(t.name, r.id)}>
              {title(t, r)}
            </button>
            {badge(t, p.badge, r)}
          </div>
          <dl className="bd-facts">
            {p.facts.map((n) => (
              <div key={n}>
                <dt>{colOf(t, n).label}</dt>
                <dd>{txt(t, n, r) || '–'}</dd>
              </div>
            ))}
          </dl>
          {p.text && p.text !== t.title && txt(t, p.text, r) ? <p className="bd-text">{txt(t, p.text, r)}</p> : null}
        </li>
      ))}
    </ul>
  );
  return board.panels.map((p) => {
    const t = tableOf(def, p.table);
    if (!t || accOf(def, user.role, t.name).list === 'none') return null;
    let rows = boardRows(app, user, def, t, it, row.id, src);
    if (p.only.length) rows = rows.filter((r) => p.only.includes(r[p.by]));
    if (p.loose) rows = rows.filter((r) => r[p.loose] == null);
    const rk = p.rank ? colOf(t, p.rank) : null,
      rv = (r) => (rk.type === 'select' ? LEVEL_OF[r[p.rank]] || 0 : +r[p.rank] || 0);
    if (rk) rows = rows.slice().sort((a, b) => rv(b) - rv(a) || a.id - b.id);
    const top = {
      rank: rk && rk.type !== 'select' ? niceTop(Math.max.apply(null, rows.map(rv).concat(1))) : 3,
      meter: p.meter ? p.max || niceTop(Math.max.apply(null, rows.map((r) => +r[p.meter] || 0).concat(1))) : 0,
    };
    const body =
      p.layout === 'versus' ? (
        versus(p, t, rows)
      ) : !rows.length ? (
        none(t)
      ) : p.layout === 'groups' ? (
        groups(p, t, rows)
      ) : p.layout === 'scores' ? (
        scores(p, t, rows)
      ) : p.layout === 'options' ? (
        options(p, t, rows)
      ) : (
        <ul className="bd-list wide">{rows.map((r) => item(p, t, r, rows, top))}</ul>
      );
    return (
      <section
        key={p.table + '.' + p.layout + '.' + (p.by || '')}
        className={'bd-panel bdp-' + p.layout}
        data-panel={p.layout}
        aria-label={p.title}
      >
        <div className="bd-h">
          <h3 className="widget-h grow">{p.title}</h3>
          <span className="t-cap muted">
            {rows.length} {rows.length === 1 ? t.one.toLowerCase() : t.label.toLowerCase()}
          </span>
        </div>
        {body}
      </section>
    );
  });
}

/* ---------- the room: start a case, watch the agents fill the board, jump in, act on the outcome ---------- */
export function TeamConsole({ app, user, pane, scr }) {
  const def = app.def,
    team = def.team;
  if (!team) return <Empty icon="bot" title="This app has no agents of its own" />;
  const it = tableOf(def, team.input.table),
    P = def.process,
    T = TEAMS[app.id],
    running = !!T && T.status === 'running',
    cases = (REC[app.tpl] && REC[app.tpl].cases) || [],
    src = pane.test ? 'check' : 'app',
    board = boardOf(def);
  const f =
      pane.tf ||
      (pane.tf = {
        table: it.name,
        id: null,
        vals: {},
        errs: {},
        err: '',
      }),
    acc = accOf(def, user.role, it.name),
    may = canRunTeam(def, user.role);
  const cols = formCols(app, user, it, true).filter((c) => c.required || c.name === team.input.column),
    text = f.vals[team.input.column],
    block = teamBlock(app, user, text);
  const go = (row) => {
    pane.caseId = row.id;
    runTeam(app, user, row.id, !liveModelOn() ? (teamCase(app, row[team.input.column]) || {}).script : null);
  };
  const start = (e) => {
    e.preventDefault();
    if (block) return toast(block.text, 'warning');
    const row = saveForm(
      app,
      user,
      it,
      f,
      cols.concat(it.columns.filter((c) => !cols.includes(c) && f.vals[c.name] != null && !isStatusCol(def, it, c))),
    );
    if (!row) return notify();
    pane.tf = null;
    go(row);
  };
  const list = fetchApi(app, user, '/api/' + it.name, null, src),
    all = list.status === 200 ? list.data : [],
    sc = colOf(it, P.column);
  const row =
      all.find((r) => r.id === pane.caseId) ||
      (T && all.find((r) => r.id === T.row)) ||
      all.find((r) => r[P.column] !== P.initial) ||
      all[0] ||
      null,
    mine = !!(T && row && T.row === row.id);
  const openRec = (tn, id) => {
      pane.rec = {
        table: tn,
        id,
      };
      notify();
    },
    page = (tn) => def.screens.find((s) => s.table === tn && DATA_VIEWS.includes(s.type) && s.roles.includes(user.role));
  const see = (tn) => {
    const s = page(tn);
    if (!s || !row) return;
    const st = vxState(pane, s, app, user);
    st.view = s.type;
    st.filters = [
      {
        col: (tableOf(def, tn).columns.find((c) => c.type === 'ref' && c.ref === it.name) || {}).name,
        op: 'is',
        val: row.id,
      },
    ].filter((x) => x.col);
    st.q = '';
    pane.screen = s.id;
    pane.rec = null;
    notify();
  };
  const jump = (e) => {
    e.preventDefault();
    const el = e.currentTarget.querySelector('input');
    if (teamJump(app, user, el.value)) el.value = '';
  };
  const tables = boardTables(def).filter((tn) => page(tn)),
    V = board.verdict,
    fresh = row && row[P.column] === P.initial,
    rb = row ? teamBlock(app, user, row[team.input.column]) : null;
  const has = (n) => !!(n && row && row[n] != null && row[n] !== ''),
    outcome = !!row && !fresh && (has(V.text) || has(V.meter) || has(V.pick)),
    vp = has(V.pick) ? colOf(it, V.pick) : null;
  const trs = row
    ? P.transitions.filter(
        (x) => x.roles.includes(user.role) && x.from.includes(row[P.column]) && x.id !== team.start && x.id !== team.done,
      )
    : [];
  const act = (tr) => {
    const r = apiCall(app, user, 'POST', '/api/' + it.name + '/' + row.id + '/' + tr.id, {}, 'app');
    toast(
      r.status === 200 ? tr.label + ': now ' + label(r.data[P.column]).toLowerCase() : r.status + ' ' + r.error,
      r.status === 200 ? 'success' : 'danger',
    );
    notify();
  };
  const waitAt = mine && T.wait ? team.pause.before : null,
    intro = row && row[team.input.column] !== row[it.title] ? str(row[team.input.column]) : '',
    extra = row
      ? it.columns.filter((c) => c.type === 'longtext' && c.name !== team.input.column && c.name !== V.text && has(c.name)).slice(0, 1)
      : [];
  return (
    <div className="scr team room">
      <div className="scr-head">
        <div className="col gap0 grow">
          <h2 className="t-sub1">{scr.name}</h2>
          <span className="t-cap muted">{team.about}</span>
        </div>
        {running && (
          <button className="btn" onClick={() => stopTeam(app)}>
            <Icon n="stop" s="16" />
            Stop
          </button>
        )}
      </div>
      <ol className="team-flow" aria-label="The agents, in the order they work">
        {team.agents.map((a, i) => {
          const st = T ? T.steps[i] : null,
            s = st ? st.status : 'idle',
            wait = T && T.wait && team.pause.before === a.id;
          return (
            <li key={a.id} className={cx('team-a', s === 'working' && 'on', s === 'ok' && 'done')}>
              <TeamAv a={a} />
              <div className="col gap0 grow">
                <span className="row gap4">
                  <strong>{a.name}</strong>
                  {s === 'working' ? (
                    <Spinner />
                  ) : s === 'ok' ? (
                    <Icon n="checkCircle" s="16" cls="ok" />
                  ) : s === 'failed' ? (
                    <Icon n="errorCircle" s="16" cls="bad" />
                  ) : wait ? (
                    <span className="badge b-warning">Waiting for you</span>
                  ) : null}
                </span>
                <span className="t-cap muted">{a.job}</span>
                {a.tools.length > 0 && (
                  <span className="row gap4 wrap">
                    {a.tools
                      .map((x) => x.connector)
                      .filter((v, k, arr0) => arr0.indexOf(v) === k)
                      .map((id) => (
                        <span key={id} className={cx('badge', connOn(id) ? 'b-outline' : 'b-warning')}>
                          <Icon n="plug" s="12" />
                          {
                            (
                              allConnectors().find((c) => c.id === id) || {
                                name: id,
                              }
                            ).name
                          }
                        </span>
                      ))}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="team-grid">
        <div className="col gap12 room-side">
          <form className="card team-start" onSubmit={start}>
            <h3 className="widget-h">
              {'Start a new '}
              {it.one.toLowerCase()}
            </h3>
            {team.samples.length > 0 && (
              <div className="col gap4">
                <span className="t-cap muted">{cases.length ? 'Saved cases. Demo replays them, Live runs them fresh.' : 'Examples'}</span>
                <div className="row wrap">
                  {team.samples.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className={cx('chip', sameText(text, s.values[team.input.column]) && 'on')}
                      onClick={() => {
                        pane.tf = {
                          table: it.name,
                          id: null,
                          vals: tourValues(app, it, s.values),
                          errs: {},
                          err: '',
                        };
                        notify();
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="form-grid one">
              {cols.map((c) => (
                <FieldInput key={c.name} app={app} user={user} c={c} f={f} idp={'tm' + pane.n + '_'} />
              ))}
            </div>
            {f.err && <MBar tone="danger">{f.err}</MBar>}
            {block && !running && str(text) ? (
              <MBar
                tone="warning"
                action={
                  block.fix ? (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        block.fix.forEach((id) => {
                          S.conns[id] = true;
                        });
                        commit();
                      }}
                    >
                      Switch on
                    </button>
                  ) : null
                }
              >
                {block.text}
              </MBar>
            ) : null}
            <div className="row">
              <button className="btn primary" type="submit" disabled={running || !acc.create}>
                <Icon n="play" s="16" />
                Run the agents
              </button>
              <span className="t-cap muted">
                {liveModelOn()
                  ? 'Live: each agent makes its own model call'
                  : (S.settings.demo ? 'Demo' : !online() ? 'Live is paused while you are offline' : 'No model connected') +
                    ': a saved run, replayed through the real API'}
              </span>
            </div>
          </form>
          <section className="card room-cases">
            <h3 className="widget-h">{it.label}</h3>
            {all.length ? (
              <ul className="rel">
                {all.slice(0, 12).map((r) => {
                  const b = r[P.column] === P.initial && may ? teamBlock(app, user, r[team.input.column]) : null;
                  return (
                    <li key={r.id} className={cx(row && r.id === row.id && 'on')}>
                      <span className="rel-i">
                        <button
                          className="rel-open ellipsis grow"
                          aria-current={row && r.id === row.id ? 'true' : null}
                          onClick={() => {
                            pane.caseId = r.id;
                            notify();
                          }}
                        >
                          {rowTitle(app, user, it, r)}
                        </button>
                        <span className={'badge b-' + stateTone(def, it, sc, r[P.column])}>{stateLabel(def, it, sc, r[P.column])}</span>
                        {r[P.column] === P.initial && may ? (
                          <button
                            className="btn sm"
                            disabled={running || !!b}
                            title={
                              (
                                b || {
                                  text: 'Run the agents on this ' + it.one.toLowerCase(),
                                }
                              ).text
                            }
                            onClick={() => go(r)}
                          >
                            <Icon n="play" s="16" />
                            Run
                          </button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted t-cap">
                {'No '}
                {it.label.toLowerCase()}
                {' yet.'}
              </p>
            )}
          </section>
        </div>
        <section className="card team-log room-case" aria-live="polite">
          {!row ? (
            <Empty
              icon="bot"
              title="Nothing has run yet"
              text="Pick a saved case or write your own, then run the agents. Their work appears here as it happens."
            />
          ) : (
            <>
              <div className="case-head">
                <div className="col gap0 grow">
                  <span className="t-cap muted">
                    {it.one}
                    {' #'}
                    {row.id}
                    {mine ? ' · ' + (T.live ? 'live run' : 'saved run') : ''}
                  </span>
                  <h3 className="t-sub2 case-title">{rowTitle(app, user, it, row)}</h3>
                </div>
                <span className={'badge b-' + stateTone(def, it, sc, row[P.column])}>{stateLabel(def, it, sc, row[P.column])}</span>
                <button className="btn subtle sm" onClick={() => openRec(it.name, row.id)}>
                  Open
                </button>
              </div>
              {intro && <p className="case-text">{intro}</p>}
              {extra.map((c) => (
                <p key={c.name} className="case-text muted">
                  <strong>{c.label}:</strong> {str(row[c.name])}
                </p>
              ))}
              {mine && running && !waitAt && (
                <div className="case-now">
                  <Spinner />
                  <span>
                    {(team.agents[T.i] || team.agents[0]).name}
                    {' is '}
                    {T.live && U.stream[app.id] ? 'writing, ' + U.stream[app.id] + ' characters so far' : 'working'}…
                  </span>
                </div>
              )}
              {waitAt && (
                <div className="gcard ask">
                  <div className="gc-h">
                    <Icon n="questionChat" s="16" />
                    Your turn
                  </div>
                  <p>{T.wait.text}</p>
                  {team.jump && (
                    <form className="row" onSubmit={jump}>
                      <NativeField as="input" className="input grow" aria-label={team.jump.label} placeholder={team.jump.label} />
                      <button className="btn sm" type="submit">
                        Add
                      </button>
                    </form>
                  )}
                  <div className="row">
                    <button className="btn primary sm" onClick={() => T.resume && T.resume()}>
                      Continue
                    </button>
                  </div>
                </div>
              )}
              {fresh && !mine && (
                <div className="case-new">
                  <Icon n="bot" />
                  <div className="col gap0 grow">
                    <strong>
                      {'The agents have not worked on this '}
                      {it.one.toLowerCase()}
                      {' yet'}
                    </strong>
                    <span className="t-cap muted">
                      {!may
                        ? roleName(def, user.role) + ' cannot start a run.'
                        : rb
                          ? rb.text
                          : 'Run them and watch the board below fill in.'}
                    </span>
                  </div>
                  {may && (
                    <button className="btn primary" disabled={running || !!rb} onClick={() => go(row)}>
                      <Icon n="play" s="16" />
                      Run the agents
                    </button>
                  )}
                </div>
              )}
              {outcome && (
                <section
                  className={cx(
                    'verdict team-done',
                    vp && 'tone-' + (isStatusCol(def, it, vp) ? stateTone(def, it, vp, row[V.pick]) : wordTone(row[V.pick])),
                  )}
                  aria-label="Outcome"
                >
                  {has(V.meter) ? (
                    <Ring pct={Math.round(+row[V.meter] <= 1 && +row[V.meter] > 0 ? +row[V.meter] * 100 : +row[V.meter])} size={68} />
                  ) : (
                    <span className="verdict-ic">
                      <Icon
                        n={
                          vp
                            ? TONE_GLYPH[isStatusCol(def, it, vp) ? stateTone(def, it, vp, row[V.pick]) : wordTone(row[V.pick])]
                            : 'checkCircle'
                        }
                      />
                    </span>
                  )}
                  <div className="col gap4 grow">
                    <div className="row wrap verdict-facts">
                      {vp && (
                        <span className="col gap0">
                          <span className="t-cap muted">{vp.label}</span>
                          <strong className="t-sub1 verdict-pick">{stateLabel(def, it, vp, row[V.pick])}</strong>
                        </span>
                      )}
                      {has(V.meter) && (
                        <span className="col gap0">
                          <span className="t-cap muted">{colOf(it, V.meter).label}</span>
                          <strong className="t-sub1">
                            {fmtNum(+row[V.meter])}
                            {+row[V.meter] > 1 && +row[V.meter] <= 100 ? ' out of 100' : ''}
                          </strong>
                        </span>
                      )}
                    </div>
                    {has(V.text) && <p className="verdict-text">{str(row[V.text])}</p>}
                    <span className="t-cap muted">
                      {mine && T.status === 'done' ? 'Finished in ' + fmtMs(T.t1 - T.t0) : ''}
                      {has(V.date)
                        ? (mine && T.status === 'done' ? ' · ' : '') + colOf(it, V.date).label + ': ' + fmtDate(row[V.date]).toLowerCase()
                        : ''}
                    </span>
                    {(tables.length > 0 || trs.length > 0) && (
                      <div className="row wrap">
                        {trs.map((tr) => (
                          <button key={tr.id} className="btn sm primary" onClick={() => act(tr)}>
                            {tr.label}
                          </button>
                        ))}
                        {tables.map((tn) => (
                          <button key={tn} className="btn sm" onClick={() => see(tn)}>
                            <Icon n={page(tn).icon} s="16" />
                            {'See the '}
                            {tableOf(def, tn).label.toLowerCase()}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}
              {!outcome && !fresh && trs.length > 0 && (
                <div className="row wrap">
                  {trs.map((tr) => (
                    <button key={tr.id} className="btn sm" onClick={() => act(tr)}>
                      {tr.label}
                    </button>
                  ))}
                </div>
              )}
              <CaseBoard app={app} user={user} pane={pane} board={board} it={it} row={row} src={src} />
              {mine &&
                T.notes.map((n, i) => (
                  <div key={i} className="tnote">
                    <Avatar name={n.who} size="sm" />
                    <div className="col gap0">
                      <span className="t-cap muted">
                        {n.who}
                        {' jumped in'}
                      </span>
                      <span>{n.text}</span>
                    </div>
                  </div>
                ))}
              {mine && team.jump && running && !T.wait && (
                <form className="row" onSubmit={jump}>
                  <NativeField
                    as="input"
                    className="input grow"
                    aria-label={team.jump.label}
                    placeholder={team.jump.label + ' while they work'}
                  />
                  <button className="btn sm" type="submit">
                    Add
                  </button>
                </form>
              )}
              {mine && T.status === 'failed' && <MBar tone="danger">{T.error}</MBar>}
              {mine && T.status === 'stopped' && <MBar tone="info">Stopped. What the agents had already written stays in the app.</MBar>}
              {mine && (
                <details className="case-log" open={running || T.status === 'failed'}>
                  <summary>What the agents did, step by step</summary>
                  <ol className="tsteps">
                    {team.agents.map((a, i) => {
                      const st = T.steps[i];
                      return (
                        <li key={a.id} className={cx('tstep', st.status)}>
                          <div className="tstep-h">
                            <TeamAv a={a} size="sm" />
                            <strong>{a.name}</strong>
                            {st.status === 'working' ? (
                              <>
                                <span className="t-cap muted">working</span>
                                <Spinner />
                              </>
                            ) : st.status === 'idle' ? (
                              <span className="t-cap muted">{waitAt === a.id ? 'waiting for you' : 'waiting'}</span>
                            ) : st.t1 ? (
                              <span className="t-cap muted">{fmtMs(st.t1 - st.t0)}</span>
                            ) : null}
                          </div>
                          {st.tools.length > 0 && (
                            <div className="row wrap gap4">
                              {st.tools.map((x, k) => (
                                <span
                                  key={k}
                                  className={cx('tool-chip', !x.ok && 'bad')}
                                  title={
                                    x.ok
                                      ? 'Sample response. The real build makes this call from the server.'
                                      : 'The call did not go through'
                                  }
                                >
                                  <Icon n="plug" s="12" />
                                  {x.name}
                                  {' · '}
                                  {x.tool}
                                  {x.args ? ' “' + brief(x.args, 28) + '”' : ''}
                                </span>
                              ))}
                              <Proto>Sample responses</Proto>
                            </div>
                          )}
                          {st.say && <p className="tstep-say">{st.say}</p>}
                          {(st.rows.length > 0 || st.updated > 0) && (
                            <div className="row wrap gap4">
                              {st.rows.map((r) => (
                                <button key={r.table + r.id} className="row-chip" onClick={() => openRec(r.table, r.id)}>
                                  <Icon n={VIEW_ICON.table} s="12" />
                                  <span className="ellipsis">{r.title}</span>
                                </button>
                              ))}
                              {st.updated > 0 && (
                                <span className="t-cap muted">
                                  {st.updated}
                                  {' record'}
                                  {st.updated === 1 ? '' : 's'}
                                  {' updated'}
                                </span>
                              )}
                            </div>
                          )}
                          {st.problems.length > 0 && (
                            <MBar tone="warning">
                              {st.problems.length}
                              {' write'}
                              {st.problems.length === 1 ? ' was' : 's were'}
                              {' refused: '}
                              {st.problems[0]}
                            </MBar>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
