// @ts-nocheck -- converted from the prototype; types are added module by module
import { useState, useSyncExternalStore } from 'react';
import { ACC_HEX } from '@/styles/theme.generated';
import { toStyle, NativeField } from '@/platform/dom';
import { ICONS } from './icons';
import {
  NARROW,
  S,
  U,
  ago,
  arr,
  cap,
  chatShown,
  closeDialog,
  commit,
  confirmBox,
  cx,
  emit,
  hashStr,
  label,
  me,
  notify,
  saveFile,
  setChat,
  snake,
  str,
  toast,
  toolCall,
  uid,
} from './core';
import { dbDrop, dbRelease, dbRollback, dbSave, dbSavepoint, qi, sqlRun, topoOrder } from './db';
import { buildDatabase } from './engine';
import { TEAMS } from './team';
import { runTestsSync, testStats } from './tests';
import { RUNS, STATIONS, pushChat } from './line';
import { Dialog, Empty, Field, Icon, MBar, Proto, Seg, Spinner } from './ui';
import { appFromPack, framed, openShare, openShared, packOf, readPack, squeeze, unsqueeze } from './share';
import { canPromptInstall, installHint, onInstallPrompt, promptInstall } from '@/platform/pwa/prompt';

/* ===== Turnkey prototype · releases, the app's own icon, and installing the app on its own =====
   Building gives you a draft. Releasing turns the draft into a numbered version: the tests must pass, the notes say
   what changed, and a snapshot is kept so the version can be opened again or restored. A share link always carries
   a released version, never a half-finished draft. The icon is designed by the UI agent as data and drawn by code. */
/* ---------- the icon ---------- */
export const LOGO_SHAPES = ['squircle', 'circle', 'hexagon', 'shield', 'tile'],
  LOGO_FILLS = ['gradient', 'solid', 'split', 'ring'],
  LOGO_MARKS = ['none', 'dot', 'spark', 'bar'];
export const LOGO_WORD = {
  squircle: 'rounded square',
  circle: 'circle',
  hexagon: 'hexagon',
  shield: 'shield',
  tile: 'tile',
  gradient: 'gradient',
  solid: 'solid colour',
  split: 'two-tone split',
  ring: 'ring',
  none: '',
  dot: 'a dot',
  spark: 'a spark',
  bar: 'an underline',
};
export function normLogo(o, theme, name) {
  // anything the UI agent leaves out is filled in from the app's name, so two apps rarely look alike
  o = o || {};
  let n = 0;
  const key = str(name) + '|' + theme.icon;
  for (let i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) >>> 0;
  return {
    glyph: ICONS[o.glyph] ? o.glyph : null,
    shape: LOGO_SHAPES.includes(o.shape) ? o.shape : LOGO_SHAPES[n % 5],
    fill: LOGO_FILLS.includes(o.fill) ? o.fill : LOGO_FILLS[(n >>> 3) % 4],
    mark: LOGO_MARKS.includes(o.mark) ? o.mark : LOGO_MARKS[(n >>> 6) % 4],
    by: o.shape || o.fill || o.glyph ? 'ui' : 'rules',
  };
}
export function logoOf(app) {
  const th = (app.def && app.def.theme) || {},
    lg =
      th.logo ||
      normLogo(
        null,
        {
          icon: app.icon,
        },
        app.name,
      );
  return {
    glyph: ICONS[lg.glyph] ? lg.glyph : ICONS[th.icon] ? th.icon : ICONS[app.icon] ? app.icon : 'apps',
    shape: lg.shape,
    fill: lg.fill,
    mark: lg.mark,
    accent: ACC_HEX[th.accent] ? th.accent : ACC_HEX[app.accent] ? app.accent : 'blue',
    by: lg.by,
  };
}
export function logoSvg(lg, size) {
  const c = ACC_HEX[lg.accent] || ACC_HEX.blue,
    s = size || 64,
    g = 'lg-' + lg.accent,
    small = lg.fill === 'ring';
  const shape = {
    squircle: '<rect width="100" height="100" rx="24"/>',
    circle: '<circle cx="50" cy="50" r="50"/>',
    hexagon:
      '<path d="M44 3.5a12 12 0 0 1 12 0l31 18a12 12 0 0 1 6 10.4v36.2a12 12 0 0 1-6 10.4l-31 18a12 12 0 0 1-12 0l-31-18a12 12 0 0 1-6-10.4V31.9a12 12 0 0 1 6-10.4z"/>',
    shield: '<path d="M50 2c13 8.5 26 12 40 12v38c0 22-15 38-40 46C25 90 10 74 10 52V14c14 0 27-3.500 40-12z"/>',
    tile: '<rect width="100" height="100" rx="9"/>',
  }[lg.shape];
  const bg =
    lg.fill === 'gradient'
      ? '<g fill="url(#' + g + ')">' + shape + '</g>'
      : lg.fill === 'split'
        ? '<g fill="' +
          c[0] +
          '">' +
          shape +
          '</g><g clip-path="url(#' +
          g +
          '-' +
          lg.shape +
          ')"><path d="M0 100 100 0v100z" fill="' +
          c[1] +
          '"/></g>'
        : '<g fill="' +
          c[0] +
          '">' +
          shape +
          '</g>' +
          (small ? '<circle cx="50" cy="50" r="31" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="4"/>' : '');
  const mark =
    lg.mark === 'dot'
      ? '<circle cx="76" cy="26" r="7" fill="#fff" fill-opacity=".92"/>'
      : lg.mark === 'spark'
        ? '<path d="M76 14l3.200 8.800 8.800 3.200-8.800 3.200-3.200 8.800-3.200-8.800-8.800-3.200 8.800-3.200z" fill="#fff" fill-opacity=".92"/>'
        : lg.mark === 'bar'
          ? '<rect x="32" y="80" width="36" height="5" rx="2.500" fill="#fff" fill-opacity=".6"/>'
          : '';
  const k = small ? 2 : lg.shape === 'shield' || lg.shape === 'hexagon' ? 2.3 : 2.6,
    at = 50 - 10 * k,
    up = lg.mark === 'bar' && !small ? 4 : 0;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    s +
    '" height="' +
    s +
    '" viewBox="0 0 100 100" role="img" aria-hidden="true"><defs><linearGradient id="' +
    g +
    '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' +
    c[2] +
    '"/><stop offset="1" stop-color="' +
    c[1] +
    '"/></linearGradient><clipPath id="' +
    g +
    '-' +
    lg.shape +
    '">' +
    shape +
    '</clipPath></defs>' +
    bg +
    '<g transform="translate(' +
    at +
    ' ' +
    (at - up) +
    ') scale(' +
    k +
    ')" fill="#fff">' +
    (ICONS[lg.glyph] || ICONS.apps) +
    '</g>' +
    mark +
    '</svg>'
  );
}
export function AppLogo({ app, size, cls }) {
  const s = size || 32;
  return (
    <span
      className={cx('applogo', cls)}
      style={toStyle('width:' + s + 'px;height:' + s + 'px')}
      dangerouslySetInnerHTML={{
        __html: logoSvg(logoOf(app), s),
      }}
    />
  );
}
export const logoText = (app) => {
  const lg = logoOf(app);
  return (
    'A ' +
    label(lg.glyph).toLowerCase() +
    ' symbol on a ' +
    label(lg.accent).toLowerCase() +
    ' ' +
    LOGO_WORD[lg.fill] +
    ' ' +
    LOGO_WORD[lg.shape] +
    (lg.mark !== 'none' ? ', with ' + LOGO_WORD[lg.mark] : '')
  );
};
export const logoUrl = (app, size) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg(logoOf(app), size || 256));
export function logoPng(app, size) {
  // a real PNG, drawn from the same data
  return new Promise((res, rej) => {
    const img = new Image(),
      s = size || 512;
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = s;
        cv.height = s;
        cv.getContext('2d').drawImage(img, 0, 0, s, s);
        cv.toBlob((b) => (b ? res(b) : rej(new Error('The icon could not be drawn.'))), 'image/png');
      } catch (e) {
        rej(e);
      }
    };
    img.onerror = () => rej(new Error('The icon could not be drawn.'));
    img.src = logoUrl(app, s);
  });
}
export async function saveLogo(app) {
  try {
    const b = await logoPng(app, 512);
    if (await saveFile(snake(app.name) + '-icon.png', b, 'image/png')) toast('Icon saved as a 512 pixel PNG.', 'success');
  } catch (e) {
    toast(String((e && e.message) || e), 'warning');
  }
}
export function redesignLogo(app) {
  // "another design": the next shape, fill and mark. In the hosted build the UI agent is asked again.
  const th = app.def.theme,
    lg = Object.assign({}, th.logo || normLogo(null, th, app.name)),
    n = (lg.turn || 0) + 1;
  lg.shape = LOGO_SHAPES[(LOGO_SHAPES.indexOf(lg.shape) + 1) % 5];
  lg.fill = LOGO_FILLS[(LOGO_FILLS.indexOf(lg.fill) + (n % 2 ? 1 : 2)) % 4];
  lg.mark = LOGO_MARKS[(LOGO_MARKS.indexOf(lg.mark) + 1) % 4];
  lg.turn = n;
  lg.by = 'you';
  th.logo = lg;
  app.rev++;
  app.updated = Date.now();
  logChange(app, 'Redesign the app icon', 'screens');
  emit('STATE_DELTA', {
    app: app.id,
    source: 'user',
    delta: [
      {
        op: 'replace',
        path: '/theme/logo',
        value: {
          shape: lg.shape,
          fill: lg.fill,
          mark: lg.mark,
        },
      },
    ],
  });
  commit();
}
export let IDENT = null;
export function setIdentity(app) {
  // the browser tab, and anything that installs the page, sees the app and not the builder
  try {
    if (!IDENT)
      IDENT = {
        title: document.title,
      };
    document.title = app.name;
    let l = document.querySelector('link[data-app-icon]');
    if (!l) {
      l = document.createElement('link');
      l.rel = 'icon';
      l.setAttribute('data-app-icon', '');
      document.head.appendChild(l);
    }
    l.type = 'image/svg+xml';
    l.href = logoUrl(app, 64);
    let m = document.querySelector('meta[data-app-color]');
    if (!m) {
      m = document.createElement('meta');
      m.name = 'theme-color';
      m.setAttribute('data-app-color', '');
      document.head.appendChild(m);
    }
    m.content = (ACC_HEX[logoOf(app).accent] || ACC_HEX.blue)[0];
  } catch (e) {}
}
export function clearIdentity() {
  try {
    if (IDENT) document.title = IDENT.title;
    IDENT = null;
    ['link[data-app-icon]', 'meta[data-app-color]'].forEach((q) => {
      const el = document.querySelector(q);
      if (el) el.remove();
    });
  } catch (e) {}
}

/* ---------- versions ---------- */
export const relList = (app) => arr(app.releases),
  relOf = (app) => relList(app)[0] || null,
  SIGC = {};
export function appSig(app) {
  const c = SIGC[app.id];
  if (c && c.rev === app.rev && c.name === app.name) return c.sig;
  const d = app.def,
    sig = hashStr(
      JSON.stringify([
        app.name,
        d.tables,
        d.process,
        d.access,
        d.team,
        d.views,
        d.dash,
        d.board,
        d.screens,
        d.theme,
        d.tour,
        d.cases || null,
      ]),
    );
  SIGC[app.id] = {
    rev: app.rev,
    name: app.name,
    sig,
  };
  return sig;
}
export const isDirty = (app) => {
  const r = relOf(app);
  return !!r && r.sig !== appSig(app);
};
export const verParts = (v) =>
    String(v || '0')
      .split('.')
      .map((x) => parseInt(x, 10) || 0),
  verCmp = (a, b) => {
    const x = verParts(a),
      y = verParts(b);
    for (let i = 0; i < 3; i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  };
export const verNext = (v, kind) => {
  const p = verParts(v);
  return kind === 'major'
    ? p[0] + 1 + '.0'
    : kind === 'fix'
      ? p[0] + '.' + (p[1] || 0) + '.' + ((p[2] || 0) + 1)
      : p[0] + '.' + ((p[1] || 0) + 1);
};
export const REL_KIND = {
  first: 'First release',
  fix: 'Fixes',
  feature: 'New features',
  major: 'Big change',
  rollback: 'Rolled back',
};
export function logChange(app, text, station) {
  if (!app.log) app.log = [];
  app.log.push({
    at: Date.now(),
    text: str(text).slice(0, 160),
    station: station || '',
  });
  if (app.log.length > 80) app.log.splice(0, app.log.length - 80);
}
export const draftLog = (app) => {
  const r = relOf(app);
  return arr(app.log).filter((x) => !r || x.at > r.at);
};
export const PAST = [
  [/^Add /, 'Added '],
  [/^Rename /, 'Renamed '],
  [/^Remove /, 'Removed '],
  [/^Change /, 'Changed '],
  [/^Use /, 'Now uses '],
  [/^Let /, 'Now lets '],
  [/^Stop /, 'Stopped '],
  [/^Show /, 'Now shows '],
  [/^Set /, 'Set '],
  [/^Reset /, 'Reset '],
  [/^Redesign /, 'Redesigned '],
  [/^Rebuild/, 'Rebuilt'],
  [/^Run /, 'Ran '],
  [/^Make /, 'Made '],
  [/^Move /, 'Moved '],
  [/^Switch /, 'Switched '],
];
export const pastTense = (t) => {
  for (const p of PAST) if (p[0].test(t)) return t.replace(p[0], p[1]);
  return t;
};
export function suggestKind(app) {
  const lg = draftLog(app);
  return !relOf(app)
    ? 'first'
    : lg.some((x) => /^Rebuil/.test(x.text))
      ? 'major'
      : lg.some((x) => x.station === 'database' || /^Add /.test(x.text))
        ? 'feature'
        : 'fix';
}
export function draftNotes(app) {
  const d = app.def;
  if (!relOf(app))
    return [
      'First release: ' +
        d.screens.length +
        ' pages for ' +
        d.brief.roles.length +
        ' roles' +
        (d.team ? ', with a team of ' + d.team.agents.length + ' agents inside' : '') +
        '.',
    ];
  const seen = {},
    out = [];
  draftLog(app).forEach((x) => {
    const t = pastTense(x.text);
    if (!seen[t]) {
      seen[t] = 1;
      out.push(t);
    }
  });
  return out.length ? out.slice(-12) : ['Small changes.'];
}
export function releaseBlock(app) {
  // why a release cannot happen right now, or null
  if (app.status !== 'ready') return 'The build has not finished.';
  if (RUNS[app.id]) return 'The builders are still working on this app.';
  if (TEAMS[app.id] && TEAMS[app.id].status === 'running') return "The app's own agents are in the middle of a run.";
  const st = testStats(app);
  if (st && st.fresh && st.failed) return st.failed + ' of ' + st.total + ' tests fail. A version is released only when every test passes.';
  return null;
}
export async function releaseApp(app, kind, notes) {
  if (releaseBlock(app)) {
    toast(releaseBlock(app), 'warning');
    return null;
  }
  const ts = runTestsSync(app);
  if (!ts) return null;
  if (ts.failed) {
    toast(ts.failed + ' of ' + ts.total + ' tests fail, so nothing was released.', 'danger');
    commit();
    return null;
  }
  const prev = relOf(app),
    k = prev ? (REL_KIND[kind] && kind !== 'first' ? kind : suggestKind(app)) : 'first',
    v = prev ? verNext(prev.v, k) : '1.0',
    list = arr(notes)
      .map((x) => str(x).slice(0, 200))
      .filter(Boolean)
      .slice(0, 12);
  if (!app.uid) app.uid = uid('a');
  const pack = packOf(app, {
    data: 'demo',
    as: '',
  });
  pack.ver = v;
  pack.uid = app.uid;
  pack.notes = list;
  let code;
  try {
    code = await squeeze(JSON.stringify(pack));
  } catch (e) {
    toast('The version could not be packed.', 'danger');
    return null;
  }
  const rel = {
    v,
    at: Date.now(),
    by: me() ? me().name : '',
    kind: k,
    notes: list.length ? list : draftNotes(app),
    sig: appSig(app),
    tests: {
      passed: ts.passed,
      total: ts.total,
    },
    pack: code,
    size: code.length,
    inside: {
      tables: app.def.tables.length,
      pages: app.def.screens.length,
    },
  };
  app.releases = [rel].concat(relList(app));
  app.releases.slice(6).forEach((r) => {
    r.pack = null;
  }); // older snapshots are let go to save room; their notes stay
  toolCall(
    {
      agent: 'orchestrator',
      appId: app.id,
    },
    'release_version',
    {
      version: v,
      kind: k,
      notes: rel.notes.length,
    },
    () => ({
      released: v,
      tests: ts.passed + ' of ' + ts.total,
    }),
    'frontend',
  );
  emit('STATE_DELTA', {
    app: app.id,
    source: 'user',
    delta: [
      {
        op: 'add',
        path: '/releases/0',
        value: {
          version: v,
          kind: k,
        },
      },
    ],
  });
  pushChat(
    app,
    'orchestrator',
    'Version ' +
      v +
      ' is released. All ' +
      ts.total +
      ' tests passed first. The share link and anyone who installs the app now get this version.',
    {
      type: 'released',
      v,
      kind: k,
      notes: rel.notes,
    },
  );
  app.updated = Date.now();
  toast('Version ' + v + ' of ' + app.name + ' is released.', 'success');
  commit();
  return rel;
}
export async function openVersion(app, rel) {
  if (!rel.pack) return toast('The snapshot of version ' + rel.v + ' was let go to save room. Its notes are still here.', 'info');
  try {
    await openShared(rel.pack, {
      preview: true,
      back: app.id,
    });
  } catch (e) {
    toast(String((e && e.message) || e), 'danger');
  }
}
export async function rollbackTo(app, rel) {
  if (RUNS[app.id] || !rel.pack) return;
  if (
    !(await confirmBox({
      title: 'Go back to version ' + rel.v + '?',
      body:
        'The draft becomes version ' +
        rel.v +
        " again: its tables, rules, views and pages. The records are reset to that version's sample data. Releases you already made stay in the history.",
      yes: 'Go back to ' + rel.v,
      danger: true,
    }))
  )
    return;
  let tmp = null;
  try {
    tmp = appFromPack(readPack(await unsqueeze(rel.pack)), 'rb' + Date.now(), true);
    app.def = tmp.def;
    app.seed = tmp.seed;
    app.name = tmp.name;
    app.icon = tmp.icon;
    app.accent = tmp.accent;
    STATIONS.forEach((s) => {
      app.line[s.id] = tmp.line[s.id];
      app.line[s.id].note = 'From version ' + rel.v;
    });
  } catch (e) {
    toast('Version ' + rel.v + ' could not be restored: ' + String((e && e.message) || e), 'danger');
    return;
  } finally {
    if (tmp) {
      dbDrop(tmp.id);
      delete S.apps[tmp.id];
    }
  }
  dbDrop(app.id);
  const built = buildDatabase(
    app,
    {
      tables: app.def.tables.map((t) =>
        Object.assign({}, t, {
          rows: (app.seed.rows || {})[t.name] || [],
        }),
      ),
      users: app.def.users,
    },
    {
      agent: 'orchestrator',
      appId: app.id,
    },
  );
  app.rev++;
  app.reviews = {};
  app.updated = Date.now();
  logChange(app, 'Go back to version ' + rel.v, 'database');
  const ts = runTestsSync(app);
  pushChat(
    app,
    'orchestrator',
    'The draft is version ' +
      rel.v +
      ' again' +
      (built.every((c) => c.ok) ? '' : ', but the database reported a problem') +
      '. ' +
      (ts ? (ts.failed ? ts.failed + ' of ' + ts.total + ' tests fail.' : 'All ' + ts.total + ' tests pass.') : '') +
      ' Release it to make it the current version for everyone.',
  );
  toast('The draft is version ' + rel.v + ' again.', 'success');
  commit();
}
export function carryData(from, to) {
  // an update keeps the records: every table and column both versions have is copied across, with its ids
  const kept = {
      tables: 0,
      rows: 0,
    },
    names = (id, t) => sqlRun(id, 'PRAGMA table_info(' + qi(t) + ')', null, 'update').map((c) => c.name);
  dbSavepoint(to.id, 'carry');
  try {
    topoOrder(to.def.tables)
      .reverse()
      .forEach((t) => {
        if (from.def.tables.some((x) => x.name === t.name)) sqlRun(to.id, 'DELETE FROM ' + qi(t.name), null, 'update');
      });
    topoOrder(to.def.tables).forEach((t) => {
      if (!from.def.tables.some((x) => x.name === t.name)) return;
      const have = names(from.id, t.name),
        cols = names(to.id, t.name).filter((c) => have.includes(c)),
        rows = sqlRun(from.id, 'SELECT * FROM ' + qi(t.name) + ' ORDER BY "id"', null, 'update');
      rows.forEach((r) => {
        sqlRun(
          to.id,
          'INSERT INTO ' + qi(t.name) + ' (' + cols.map(qi).join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')',
          cols.map((c) => r[c]),
          'update',
        );
        kept.rows++;
      });
      kept.tables++;
    });
    dbRelease(to.id, 'carry');
  } catch (e) {
    dbRollback(to.id, 'carry');
    return null;
  }
  dbSave(to.id);
  return kept;
}
export const verText = (app) => {
  const sh = app.shared,
    r = relOf(app);
  return sh && sh.ver ? 'Version ' + sh.ver : r ? 'Version ' + r.v + (isDirty(app) ? ' + draft changes' : '') : 'Draft, not released yet';
};

/* ---------- the Release view ---------- */
export function Journey({ app }) {
  // where this app stands, in four plain steps
  const st = testStats(app),
    ready = app.status === 'ready',
    rel = relOf(app),
    dirty = isDirty(app),
    busy = !!RUNS[app.id],
    go = (v) => () => {
      U.view[app.id] = v;
      notify();
    };
  const steps = [
    {
      id: 'build',
      n: 'Build',
      done: ready,
      now: busy,
      sub: busy ? 'The agents are working' : ready ? 'Built and checked' : cap(app.status),
      go: go('build'),
    },
    {
      id: 'tests',
      n: 'Test',
      done: ready && !!st && st.fresh && !st.failed,
      bad: !!st && st.fresh && st.failed > 0,
      sub: st ? (st.fresh ? st.passed + ' of ' + st.total + ' pass' : st.total + ' tests ready') : 'After the build',
      go: go('tests'),
    },
    {
      id: 'release',
      n: 'Release',
      done: !!rel && !dirty,
      sub: rel ? (dirty ? 'Version ' + rel.v + ' is out, the draft is newer' : 'Version ' + rel.v) : 'Not released yet',
    },
    {
      id: 'share',
      n: 'Share and install',
      done: false,
      sub: rel ? 'One link, the app alone' : 'After the first release',
    },
  ];
  return (
    <ol className="journey" aria-label="Where this app stands">
      {steps.map((s, i) => (
        <li key={s.id} className={cx('jstep', s.done && 'done', s.bad && 'bad', s.now && 'now')}>
          <span className="jdot">
            {s.now ? <Spinner /> : s.done ? <Icon n="check" s="16" /> : s.bad ? <Icon n="warning" s="16" /> : i + 1}
          </span>
          {s.go ? (
            <button className="jtext" onClick={s.go}>
              <strong>{s.n}</strong>
              <span className="t-cap muted">{s.sub}</span>
            </button>
          ) : (
            <span className="jtext">
              <strong>{s.n}</strong>
              <span className="t-cap muted">{s.sub}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
export function ReleaseView({ app }) {
  const rel = relOf(app),
    dirty = isDirty(app),
    block = releaseBlock(app),
    st = testStats(app),
    R =
      U.rel[app.id] ||
      (U.rel[app.id] = {
        kind: null,
        text: null,
        busy: false,
      });
  const kind = rel ? R.kind || suggestKind(app) : 'first',
    v = rel ? verNext(rel.v, kind) : '1.0',
    text = R.text != null ? R.text : draftNotes(app).join('\n'),
    can = !block && (!rel || dirty);
  const go = async () => {
    R.busy = true;
    notify();
    const r = await releaseApp(
      app,
      kind,
      text
        .split('\n')
        .map((x) => x.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean),
    );
    R.busy = false;
    if (r) {
      R.text = null;
      R.kind = null;
    }
    notify();
  };
  const kinds = [
    {
      id: 'fix',
      label: 'Fixes · ' + (rel ? verNext(rel.v, 'fix') : ''),
      title: 'Bug fixes and small corrections',
    },
    {
      id: 'feature',
      label: 'New features · ' + (rel ? verNext(rel.v, 'feature') : ''),
      title: 'New fields, pages, views or rules',
    },
    {
      id: 'major',
      label: 'Big change · ' + (rel ? verNext(rel.v, 'major') : ''),
      title: 'The app works differently now',
    },
  ];
  if (!app.def.screens.length)
    return (
      <div className="release scroll">
        <div className="release-in">
          <Journey app={app} />
          <Empty
            icon="rocket"
            title="Nothing to release yet"
            text="When the build has finished and its tests pass, you release version 1.0 from here."
          />
        </div>
      </div>
    );
  return (
    <div className="release scroll" data-tour="release">
      <div className="release-in">
        <Journey app={app} />
        <section className="card rel-now">
          <AppLogo app={app} size={72} />
          <div className="col gap4 grow">
            <span className="row wrap gap8">
              <h2 className="t-sub1">{app.name}</h2>
              {rel ? (
                <span className={'badge ' + (dirty ? 'b-warning' : 'b-success')} id="rel-state">
                  {dirty ? 'Version ' + rel.v + ' is out · draft has changes' : 'Version ' + rel.v + ' · up to date'}
                </span>
              ) : (
                <span className="badge b-outline" id="rel-state">
                  Draft · not released yet
                </span>
              )}
            </span>
            <span className="muted">
              {!rel
                ? 'Releasing makes this the version people get when you share or install the app. Until then it is a draft only you can see.'
                : dirty
                  ? 'People with the link or the installed app still have version ' +
                    rel.v +
                    '. Release the draft to give them your changes.'
                  : 'Released ' +
                    ago(rel.at) +
                    (rel.by ? ' by ' + rel.by : '') +
                    '. Any change you ask for from here on goes into a new draft.'}
            </span>
            <span className="row wrap gap8 t-cap">
              {st ? (
                <span className={cx('ck', st.fresh && st.failed ? 'bad' : 'ok')}>
                  <Icon n={st.fresh && st.failed ? 'warning' : 'checkCircle'} s="16" />
                  {st.fresh ? st.passed + ' of ' + st.total + ' tests pass' : st.total + ' tests run again before a release'}
                </span>
              ) : null}
              <button
                className="btn subtle sm"
                onClick={() => {
                  U.view[app.id] = 'tests';
                  notify();
                }}
              >
                Open the tests
              </button>
            </span>
          </div>
        </section>
        {(!rel || dirty) && (
          <section className="card rel-form">
            <h3 className="widget-h">{rel ? 'Release the draft as version ' + v : 'Release version 1.0'}</h3>
            {rel && (
              <Field
                id="rel-kind"
                label="What kind of release is it?"
                hint="The agents suggest one from what changed. The number follows your choice."
              >
                <Seg
                  label="Kind of release"
                  items={kinds}
                  value={kind}
                  onChange={(k) => {
                    R.kind = k;
                    notify();
                  }}
                />
              </Field>
            )}
            <Field
              id="rel-notes"
              label="What is new"
              hint={
                rel
                  ? 'Written from the ' +
                    draftLog(app).length +
                    ' change' +
                    (draftLog(app).length === 1 ? '' : 's') +
                    ' since version ' +
                    rel.v +
                    '. One line each. Edit them freely: people see these when they update.'
                  : 'One line each. People see these in About this app.'
              }
            >
              <NativeField
                as="textarea"
                className="textarea"
                id="rel-notes"
                rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
                value={text}
                onInput={(e) => {
                  R.text = e.target.value;
                  notify();
                }}
              />
            </Field>
            {block && (
              <MBar
                tone="warning"
                action={
                  /tests fail/.test(block) ? (
                    <button
                      className="btn sm"
                      onClick={() => {
                        U.view[app.id] = 'tests';
                        notify();
                      }}
                    >
                      Open the tests
                    </button>
                  ) : null
                }
              >
                {block}
              </MBar>
            )}
            <div className="row wrap">
              <button className="btn primary" id="rel-go" disabled={!can || R.busy} onClick={go}>
                {R.busy ? <Spinner /> : <Icon n="rocket" s="16" />}
                {'Release version '}
                {v}
              </button>
              <span className="t-cap muted">Every test runs once more first. If one fails, nothing is released.</span>
            </div>
          </section>
        )}
        <section className="card rel-share">
          <h3 className="widget-h">Share and install</h3>
          <div className="rel-share-grid">
            <div className="col gap8">
              <p className="muted">
                {rel
                  ? 'The link opens ' +
                    app.name +
                    ' alone, with its own name, icon and sign-in. It carries version ' +
                    rel.v +
                    (dirty ? ', not the draft' : '') +
                    '.'
                  : 'A link carries a released version, so release version 1.0 first.'}
              </p>
              <div className="row wrap">
                <button className="btn primary" id="rel-share" disabled={!rel} onClick={() => openShare(app)}>
                  <Icon n="share" s="16" />
                  Share by link
                </button>
                <button className="btn" disabled={!rel || !rel.pack} onClick={() => openVersion(app, rel)}>
                  <Icon n="eye" s="16" />
                  See what they get
                </button>
              </div>
              <ul className="plain ticks">
                <li>
                  <Icon n="install" s="16" />
                  <span>Whoever opens the link can install the app. It gets its own window, its own icon and its own data.</span>
                </li>
                <li>
                  <Icon n="sync" s="16" />
                  <span>When you release a newer version and send its link, their copy updates and keeps their records.</span>
                </li>
              </ul>
            </div>
            <div className="rel-icon">
              <div className="row gap12 rel-icons">
                <AppLogo app={app} size={96} />
                <AppLogo app={app} size={48} />
                <AppLogo app={app} size={24} />
              </div>
              <span className="t-cap muted" id="rel-logo-text">
                {logoOf(app).by === 'you' ? 'Your pick' : 'Designed by the UI agent'}
                {': '}
                {logoText(app).toLowerCase()}.
              </span>
              <div className="row wrap">
                <button className="btn sm" id="rel-logo-next" disabled={!!RUNS[app.id]} onClick={() => redesignLogo(app)}>
                  <Icon n="wand" s="16" />
                  Another design
                </button>
                <button className="btn sm" onClick={() => saveLogo(app)}>
                  <Icon n="download" s="16" />
                  Save the icon
                </button>
              </div>
            </div>
          </div>
        </section>
        <section className="card rel-hist">
          <h3 className="widget-h">
            Versions
            {relList(app).length ? (
              <>
                {' '}
                <span className="tab-n">{relList(app).length}</span>
              </>
            ) : null}
          </h3>
          {relList(app).length ? (
            <ol className="rel-list">
              {relList(app).map((r, i) => (
                <li key={r.v} className="rel-item">
                  <div className="row wrap gap8">
                    <strong className="t-sub2">{r.v}</strong>
                    <span className={'badge ' + (i === 0 ? 'b-success' : 'b-outline')}>
                      {i === 0 ? 'Current' : REL_KIND[r.kind] || 'Release'}
                    </span>
                    {i === 0 && r.kind !== 'first' ? <span className="badge b-outline">{REL_KIND[r.kind]}</span> : null}
                    <span className="t-cap muted grow" title={new Date(r.at).toLocaleString()}>
                      {new Date(r.at).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {r.by ? ' · ' + r.by : ''}
                      {' · '}
                      {r.tests.passed}
                      {' of '}
                      {r.tests.total}
                      {' tests passed · '}
                      {r.inside.tables}
                      {' tables, '}
                      {r.inside.pages}
                      {' pages'}
                    </span>
                    <button
                      className="btn subtle sm"
                      disabled={!r.pack}
                      title={r.pack ? 'Open this version on its own' : 'This snapshot was let go to save room'}
                      onClick={() => openVersion(app, r)}
                    >
                      Open
                    </button>
                    {(i > 0 || dirty) && (
                      <button className="btn subtle sm" disabled={!r.pack || !!RUNS[app.id]} onClick={() => rollbackTo(app, r)}>
                        Go back to this
                      </button>
                    )}
                  </div>
                  <ul className="rel-notes">
                    {r.notes.map((n, k) => (
                      <li key={k}>{n}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No version yet. The first release is 1.0.</p>
          )}
        </section>
      </div>
    </div>
  );
}
export function ReleaseCard({ app, m }) {
  const c = m.card;
  return (
    <div className="gcard ok">
      <div className="gc-h">
        <Icon n="rocket" s="16" />
        {'Version '}
        {c.v}
        {' released'}
      </div>
      <ul className="plain flow-items">
        {arr(c.notes)
          .slice(0, 6)
          .map((n, i) => (
            <li key={i}>
              <Icon n="check" s="12" />
              <span>{n}</span>
            </li>
          ))}
      </ul>
      <div className="row wrap">
        <button className="btn primary sm" disabled={!relOf(app)} onClick={() => openShare(app)}>
          <Icon n="share" s="16" />
          Share by link
        </button>
        <button
          className="btn sm"
          onClick={() => {
            U.view[app.id] = 'release';
            if (NARROW() && chatShown()) setChat(false);
            notify();
          }}
        >
          Versions
        </button>
      </div>
    </div>
  );
}

/* ---------- installing the app on its own ---------- */
/* While an app is open on its own (see SoloShell in share.tsx) the page links that app's manifest and icon, so the
   browser installs it under its own name and icon, not Turnkey's. The browser's offer comes as an event (Chrome, Edge);
   Safari and Firefox install from their menu instead. Inside a frame nothing can be installed, so the flow is shown. */
export function installInputOf(app) {
  const lg = logoOf(app);
  return {
    name: app.name,
    accent: lg.accent,
    glyph: lg.glyph,
    shape: lg.shape,
    fill: lg.fill,
    mark: lg.mark,
    // the same in every version, so the installed app reopens the newest copy saved in this browser
    key: (app.shared && app.shared.uid) || app.uid || app.id,
  };
}
const noOffer = () => false;
export function InstallAppDialog({ p }) {
  const offered = useSyncExternalStore(onInstallPrompt, canPromptInstall, noOffer);
  const [asked, setAsked] = useState(false);
  const app = S.apps[p.app];
  if (!app) return null;
  const on = !!app.installed,
    ver = verText(app),
    inFrame = framed(),
    // the browser made an offer for this app's manifest: its own Install dialog does the work
    real = offered && !inFrame;
  const set = (v) => {
    if (v) app.installed = Date.now();
    else delete app.installed;
    commit();
    closeDialog();
    toast(
      v
        ? app.name + ' is installed. It opens in its own window with its own icon.'
        : app.name +
            ' is no longer marked as installed here. To remove the app itself, use Uninstall in its own window menu. Its link still works.',
      v ? 'success' : 'info',
    );
  };
  const install = async () => {
    setAsked(true);
    const out = await promptInstall();
    if (out === 'accepted') set(true);
    else if (out === 'dismissed') closeDialog();
  };
  return (
    <Dialog
      title={on ? app.name + ' is installed' : 'Install ' + app.name}
      onClose={closeDialog}
      foot={
        on ? (
          <>
            <button className="btn" onClick={() => set(false)}>
              Uninstall
            </button>
            <button className="btn primary" data-autofocus onClick={closeDialog}>
              Done
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={closeDialog}>
              Not now
            </button>
            {real ? (
              <button className="btn primary" data-autofocus id="inst-go" data-install="browser" onClick={install}>
                <Icon n="install" s="16" />
                Install
              </button>
            ) : (
              <button
                className="btn primary"
                data-autofocus
                id="inst-go"
                data-install={inFrame ? 'shown' : 'menu'}
                onClick={() => set(true)}
              >
                <Icon n="install" s="16" />
                {inFrame ? 'Install' : 'I have installed it'}
              </button>
            )}
          </>
        )
      }
    >
      <div className="col gap12">
        <div className="install-app">
          <AppLogo app={app} size={56} />
          <div className="col gap0">
            <strong className="t-sub2">{app.name}</strong>
            <span className="muted t-cap">
              {ver}
              {' · its own app, not Turnkey'}
            </span>
          </div>
        </div>
        <ul className="plain ticks">
          <li>
            <Icon n="window" s="16" />
            <span>Opens in its own window from the desktop, taskbar, dock or home screen, under this icon</span>
          </li>
          <li>
            <Icon n="checkCircle" s="16" />
            <span>
              <strong>Works offline:</strong>
              {' every page, the sign-in and your records, which stay on this device'}
            </span>
          </li>
          <li>
            <Icon n="sync" s="16" />
            <span>
              <strong>Updates:</strong>
              {' opening the link of a newer version updates the app and keeps your records'}
            </span>
          </li>
          {app.def.team ? (
            <li>
              <Icon n="cloudOff" s="16" />
              <span>
                <strong>Waits for internet:</strong>
                {" the app's own agents, when they run live"}
              </span>
            </li>
          ) : null}
        </ul>
        {on ? null : inFrame ? (
          <MBar tone="info">
            <Proto>Simulated here</Proto>
            {
              ' A page inside a frame cannot install anything, so this shows the flow. Open the link in its own browser tab and the browser offers Install for this app alone.'
            }
          </MBar>
        ) : real ? (
          <MBar tone="info">Your browser asks you to confirm. The app keeps this name and icon.</MBar>
        ) : (
          <MBar tone="info" cls="inst-hint">
            {asked ? 'The browser did not open its install dialog. ' : 'Your browser installs this app from its own menu. '}
            {installHint(navigator.userAgent)}
          </MBar>
        )}
      </div>
    </Dialog>
  );
}
