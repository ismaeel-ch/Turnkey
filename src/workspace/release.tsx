import { useState, useSyncExternalStore } from 'react';
import type { BriefedDef, Logo, RecordStep, Theme, Untrusted } from '@/shared/types/app';
import type { AppRecord, ChatMessage, Dict, Release, StartWith, ViewState } from '@/shared/types/workspace';
import { ACC_HEX } from '@/styles/theme.generated';
import { toStyle } from '@/platform/dom';
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
  cx,
  emit,
  errText,
  hashStr,
  label,
  me,
  notify,
  openDialog,
  saveFile,
  setChat,
  snake,
  str,
  toast,
  toolCall,
  uid,
} from './core';
import { dbAdopt, dbCount, dbDrop } from './db';
import { TEAMS } from './team';
import { runTestsSync, testStats } from './tests';
import { RUNS, STATIONS, pushChat } from './line';
import { Btn, Card, Dialog, Empty, Field, Icon, MBar, Proto, Seg, Spinner, Textarea } from './ui';
import { appFromPack, framed, openShare, openShared, packOf, readPack, settingsLists, squeeze, startWith, unsqueeze } from './share';
import type { Pack } from './share';
import { carryData } from './carry';
import { appBusy, historyOf, record as keepDraft, restoreVersion } from './history';
import { inverseSteps, verCmp, verParts } from './record-steps';
import type { VersionSteps } from './record-steps';
import { currentVersion } from '@/shared/history';
import { saveShortLink } from '@/platform/share-link';
import { exportMarkdown, exportPage, exportPdf, exportSqlite, exportZip } from './export';
import { canPromptInstall, installHint, onInstallPrompt, promptInstall } from '@/platform/pwa/prompt';

/* ===== Turnkey prototype · releases, the app's own icon, and installing the app on its own =====
   Building gives you a draft. Releasing turns the draft into a numbered version: the tests must pass, the notes say
   what changed, and a snapshot is kept so the version can be opened again or restored. A share link always carries
   a released version, never a half-finished draft. The icon is designed by the UI agent as data and drawn by code. */
/* ---------- the icon ---------- */
export const LOGO_SHAPES = ['squircle', 'circle', 'hexagon', 'shield', 'tile'],
  LOGO_FILLS = ['gradient', 'solid', 'split', 'ring'],
  LOGO_MARKS = ['none', 'dot', 'spark', 'bar'];
export const LOGO_WORD: Dict<string> = {
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
export function normLogo(o: Untrusted, theme: Pick<Theme, 'icon'>, name: string): Logo {
  // anything the UI agent leaves out is filled in from the app's name, so two apps rarely look alike
  o = o || {};
  let n = 0;
  const key = str(name) + '|' + theme.icon;
  for (let i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) >>> 0;
  return {
    glyph: (ICONS as Dict<string>)[o.glyph] ? o.glyph : null,
    shape: LOGO_SHAPES.includes(o.shape) ? o.shape : LOGO_SHAPES[n % 5],
    fill: LOGO_FILLS.includes(o.fill) ? o.fill : LOGO_FILLS[(n >>> 3) % 4],
    mark: LOGO_MARKS.includes(o.mark) ? o.mark : LOGO_MARKS[(n >>> 6) % 4],
    by: o.shape || o.fill || o.glyph ? 'ui' : 'rules',
  };
}
/** An app's icon with the accent it is drawn in. */
export type LogoView = Logo & { accent: string; glyph: string };
const IC = ICONS as Dict<string>,
  HEX = ACC_HEX as Dict<string[]>;
export function logoOf(app: AppRecord): LogoView {
  const th: Partial<Theme> = (app.def && app.def.theme) || {},
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
    glyph: lg.glyph && IC[lg.glyph] ? lg.glyph : th.icon && IC[th.icon] ? th.icon : IC[app.icon] ? app.icon : 'apps',
    shape: lg.shape,
    fill: lg.fill,
    mark: lg.mark,
    accent: th.accent && HEX[th.accent] ? th.accent : HEX[app.accent] ? app.accent : 'blue',
    by: lg.by,
  };
}
export function logoSvg(lg: LogoView, size?: number) {
  const c = HEX[lg.accent] || HEX.blue,
    s = size || 64,
    g = 'lg-' + lg.accent,
    small = lg.fill === 'ring';
  const shape = (
    {
      squircle: '<rect width="100" height="100" rx="24"/>',
      circle: '<circle cx="50" cy="50" r="50"/>',
      hexagon:
        '<path d="M44 3.5a12 12 0 0 1 12 0l31 18a12 12 0 0 1 6 10.4v36.2a12 12 0 0 1-6 10.4l-31 18a12 12 0 0 1-12 0l-31-18a12 12 0 0 1-6-10.4V31.9a12 12 0 0 1 6-10.4z"/>',
      shield: '<path d="M50 2c13 8.5 26 12 40 12v38c0 22-15 38-40 46C25 90 10 74 10 52V14c14 0 27-3.500 40-12z"/>',
      tile: '<rect width="100" height="100" rx="9"/>',
    } as Dict<string>
  )[lg.shape];
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
    (IC[lg.glyph] || IC.apps) +
    '</g>' +
    mark +
    '</svg>'
  );
}
export function AppLogo({ app, size, cls }: { app: AppRecord; size?: number; cls?: string }) {
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
export const logoText = (app: AppRecord) => {
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
export const logoUrl = (app: AppRecord, size?: number) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg(logoOf(app), size || 256));
export function logoPng(app: AppRecord, size?: number) {
  // a real PNG, drawn from the same data
  return new Promise<Blob>((res, rej) => {
    const img = new Image(),
      s = size || 512;
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = s;
        cv.height = s;
        (cv.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, s, s);
        cv.toBlob((b) => (b ? res(b) : rej(new Error('The icon could not be drawn.'))), 'image/png');
      } catch (e) {
        rej(e);
      }
    };
    img.onerror = () => rej(new Error('The icon could not be drawn.'));
    img.src = logoUrl(app, s);
  });
}
export async function saveLogo(app: AppRecord) {
  try {
    const b = await logoPng(app, 512);
    if (await saveFile(snake(app.name) + '-icon.png', b, 'image/png')) toast('Icon saved as a 512 pixel PNG.', 'success');
  } catch (e) {
    toast(errText(e), 'warning');
  }
}
export function redesignLogo(app: AppRecord) {
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
export let IDENT: { title: string } | null = null;
export function setIdentity(app: AppRecord) {
  // the browser tab, and anything that installs the page, sees the app and not the builder
  try {
    if (!IDENT)
      IDENT = {
        title: document.title,
      };
    document.title = app.name;
    let l = document.querySelector<HTMLLinkElement>('link[data-app-icon]');
    if (!l) {
      l = document.createElement('link');
      l.rel = 'icon';
      l.setAttribute('data-app-icon', '');
      document.head.appendChild(l);
    }
    l.type = 'image/svg+xml';
    l.href = logoUrl(app, 64);
    let m = document.querySelector<HTMLMetaElement>('meta[data-app-color]');
    if (!m) {
      m = document.createElement('meta');
      m.name = 'theme-color';
      m.setAttribute('data-app-color', '');
      document.head.appendChild(m);
    }
    m.content = (HEX[logoOf(app).accent] || HEX.blue)[0];
  } catch {}
}
export function clearIdentity() {
  try {
    if (IDENT) document.title = IDENT.title;
    IDENT = null;
    ['link[data-app-icon]', 'meta[data-app-color]'].forEach((q) => {
      const el = document.querySelector(q);
      if (el) el.remove();
    });
  } catch {}
}

/* ---------- versions ---------- */
export const relList = (app: AppRecord) => arr<Release>(app.releases),
  relOf = (app: AppRecord): Release | null => relList(app)[0] || null,
  SIGC: Dict<{ rev: number; name: string; sig: string | number }> = {};
export function appSig(app: AppRecord) {
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
export const isDirty = (app: AppRecord) => {
  const r = relOf(app);
  return !!r && r.sig !== appSig(app);
};
export { verCmp, verParts };
export const verNext = (v: string, kind: string) => {
  const p = verParts(v);
  return kind === 'major'
    ? p[0] + 1 + '.0'
    : kind === 'fix'
      ? p[0] + '.' + (p[1] || 0) + '.' + ((p[2] || 0) + 1)
      : p[0] + '.' + ((p[1] || 0) + 1);
};
export const REL_KIND: Dict<string> = {
  first: 'First release',
  fix: 'Fixes',
  feature: 'New features',
  major: 'Big change',
  rollback: 'Went back',
};
export function logChange(app: AppRecord, text: string, station?: string) {
  if (!app.log) app.log = [];
  app.log.push({
    at: Date.now(),
    text: str(text).slice(0, 160),
    station: station || '',
  });
  if (app.log.length > 80) app.log.splice(0, app.log.length - 80);
}
/**
 * The release the live version is the same as. Going back goes out under a new number, so the live version can be a
 * copy of an earlier one: what the draft changed is counted from that one.
 */
export function baseOf(app: AppRecord): Release | null {
  let r = relOf(app);
  for (let i = 0; r && r.back && i < 20; i++) {
    const v = r.back,
      b = relList(app).find((x) => x.v === v);
    if (!b) break;
    r = b;
  }
  return r;
}
export const draftLog = (app: AppRecord) => {
  const r = baseOf(app);
  return (app.log || []).filter((x) => !r || x.at > r.at);
};
export const PAST: [RegExp, string][] = [
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
export const pastTense = (t: string) => {
  for (const p of PAST) if (p[0].test(t)) return t.replace(p[0], p[1]);
  return t;
};
export function suggestKind(app: AppRecord) {
  const lg = draftLog(app);
  return !relOf(app)
    ? 'first'
    : lg.some((x) => /^Rebuil/.test(x.text))
      ? 'major'
      : lg.some((x) => x.station === 'database' || /^Add /.test(x.text))
        ? 'feature'
        : 'fix';
}
export function draftNotes(app: AppRecord) {
  const d = app.def as BriefedDef;
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
  const seen: Dict<number> = {},
    out: string[] = [];
  draftLog(app).forEach((x) => {
    const t = pastTense(x.text);
    if (!seen[t]) {
      seen[t] = 1;
      out.push(t);
    }
  });
  return out.length ? out.slice(-12) : ['Small changes.'];
}
/** What each released version did to the records, oldest first: a link carries it so a device can replay it. */
export const relHistory = (app: AppRecord): VersionSteps[] =>
  relList(app)
    .slice()
    .reverse()
    .map((r) => ({ v: r.v, steps: r.steps || [] }));
/** What the draft has done to the records since the last release. */
export const draftSteps = (app: AppRecord): RecordStep[] => {
  const r = baseOf(app);
  return arr<{ at: number; step?: RecordStep }>(app.def.migrations)
    .filter((m) => m.step && (!r || m.at > r.at))
    .map((m) => m.step as RecordStep);
};
export function releaseBlock(app: AppRecord) {
  // why a release cannot happen right now, or null
  if (app.status !== 'ready') return 'The build has not finished.';
  if (RUNS[app.id]) return 'The builders are still working on this app.';
  if (TEAMS[app.id] && TEAMS[app.id].status === 'running') return "The app's own agents are in the middle of a run.";
  const st = testStats(app);
  if (st && st.fresh && st.failed) return st.failed + ' of ' + st.total + ' tests fail. A version is released only when every test passes.';
  return null;
}
/** Puts a released version under the app's short link, when it has one: the address people already have then opens
 *  the newest version, and an installed app finds it the next time it opens. Fails quietly: the long link still works. */
export async function refreshShortLink(app: AppRecord, code: string) {
  const sh = app.short;
  if (!sh || !sh.slug || !sh.token || framed()) return false;
  const r = await saveShortLink({ code, name: app.name, slug: sh.slug, token: sh.token });
  if (!r.ok && r.reason === 'forbidden') delete app.short; // the name belongs to someone else now: Share makes a new one
  return r.ok;
}
/**
 * What the short link hands a person who opens the app for the first time: the version, holding the records the
 * owner chose for new people. The copy kept with the release always holds the demo data, so it stays small and the
 * app can go back to it.
 */
async function firstCopy(app: AppRecord, rel: Release): Promise<string> {
  const start = startWith(rel.start);
  if (!rel.pack || start === 'demo') return rel.pack || '';
  const pack = packOf(app, { data: start, as: '' });
  pack.ver = rel.v;
  pack.uid = app.uid;
  pack.notes = rel.notes;
  pack.kind = rel.kind;
  pack.history = relHistory(app);
  if (app.short) pack.slug = app.short.slug;
  return squeeze(JSON.stringify(pack));
}
/** Puts a version that was just released under the short link. */
function publish(app: AppRecord, rel: Release) {
  const fallback = rel.pack || '';
  void firstCopy(app, rel)
    .catch(() => fallback)
    .then((code) => (code ? refreshShortLink(app, code) : false))
    .then((ok) => ok && commit());
}
export async function releaseApp(app: AppRecord, kind: string, notes: string[], opts?: { start?: StartWith | null }) {
  const why = releaseBlock(app);
  if (why) {
    toast(why, 'warning');
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
    k = prev ? (REL_KIND[kind] && kind !== 'first' && kind !== 'rollback' ? kind : suggestKind(app)) : 'first',
    v = prev ? verNext(prev.v, k) : '1.0',
    steps = prev ? draftSteps(app) : [],
    // what a new person starts with: the owner's choice, or the choice of the version before (demo data before the choice existed)
    start = startWith((opts && opts.start) || (prev && prev.start)),
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
  pack.kind = k;
  pack.history = relHistory(app).concat([{ v, steps }]);
  if (app.short) pack.slug = app.short.slug; // an installed copy asks this address for newer versions
  let code: string;
  try {
    code = await squeeze(JSON.stringify(pack));
  } catch {
    toast('The version could not be packed.', 'danger');
    return null;
  }
  const rel: Release = {
    v,
    at: Date.now(),
    by: me()?.name || '',
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
    steps,
    start,
  };
  app.releases = [rel].concat(relList(app));
  app.releases.slice(6).forEach((r) => {
    r.pack = null;
  }); // older snapshots are let go to save room; their notes stay
  app.takenBack = null; // what was taken back either went out again in this version or was left behind on purpose
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
  publish(app, rel);
  return rel;
}
export async function openVersion(app: AppRecord, rel: Release) {
  if (!rel.pack) return toast('The snapshot of version ' + rel.v + ' was let go to save room. Its notes are still here.', 'info');
  try {
    await openShared(rel.pack, {
      preview: true,
      back: app.id,
    });
  } catch (e) {
    toast(errText(e), 'danger');
  }
}

/* ---------- going back ---------- */
/* Going back to an earlier version is one press and it never deletes a record. The earlier version's tables, rules,
   views and pages come back, the records the app holds now are moved into them, and it goes out at once as the next
   number, because a device only ever moves to a higher one. What the earlier version has no field for is put away
   and returns when that field does. The draft as it was stays in the draft history. */
/** The app's own lists, with how many records each holds now. */
export const recordCounts = (app: AppRecord) => app.def.tables.map((t) => ({ label: t.label, n: Number(dbCount(app.id, t.name)) || 0 }));
export const recordTotal = (app: AppRecord) => recordCounts(app).reduce((n, t) => n + t.n, 0);
/** What going back to `rel` would undo: the notes of every later release, then the draft's own changes. */
export function undoneBy(app: AppRecord, rel: Release): string[] {
  const out: string[] = [];
  relList(app)
    .filter((r) => verCmp(r.v, rel.v) > 0 && r.kind !== 'rollback')
    .forEach((r) => r.notes.forEach((n) => out.push(n)));
  if (isDirty(app)) draftNotes(app).forEach((n) => out.push(n));
  return out.filter((x, i, a) => x !== 'Small changes.' && a.indexOf(x) === i).slice(0, 12);
}
/** Why going back cannot start now, or null. */
export const goBackBlock = (app: AppRecord, rel: Release): string | null =>
  !rel.pack
    ? 'The copy of version ' + rel.v + ' was let go to save room, so the app cannot go back to it.'
    : appBusy(app)
      ? 'Wait until the agents have finished, then go back.'
      : null;
export function askGoBack(app: AppRecord, rel: Release) {
  const why = goBackBlock(app, rel);
  if (why) return toast(why, 'warning');
  openDialog('goback', { app: app.id, v: rel.v });
}
export async function goBackTo(app: AppRecord, rel: Release, why?: string): Promise<Release | null> {
  const live = relOf(app),
    block = goBackBlock(app, rel);
  if (!live || block) {
    if (block) toast(block, 'warning');
    return null;
  }
  const same = rel === live, // back to what is live: the draft's changes are dropped and nothing new goes out
    later = relList(app).filter((r) => verCmp(r.v, rel.v) > 0), // newest first
    undone = undoneBy(app, rel),
    relSteps = later
      .slice()
      .reverse()
      .flatMap((r) => r.steps || []),
    v = verNext(live.v, 'fix'),
    notes = ['Back to version ' + rel.v + ': the app works as it did then. No records were deleted.'];
  let pack: Pack,
    code = '';
  try {
    pack = readPack(await unsqueeze(rel.pack as string));
    if (!same) {
      pack.ver = v;
      pack.uid = app.uid;
      pack.notes = notes;
      pack.kind = 'rollback';
      pack.by = me()?.name || '';
      pack.history = relHistory(app).concat([{ v, steps: inverseSteps(relSteps) }]);
      if (app.short) pack.slug = app.short.slug;
      code = await squeeze(JSON.stringify(pack));
    }
  } catch (e) {
    toast('Version ' + rel.v + ' could not be opened: ' + errText(e), 'danger');
    return null;
  }
  if (goBackBlock(app, rel)) return null; // something started while the version was being unpacked
  keepDraft(app); // the draft as it is now goes into the draft history, so going back can be undone
  const hist = historyOf(app.id),
    kept = hist ? currentVersion(hist) : null, // that version, whether it was saved just now or when the draft last changed
    before = recordTotal(app);
  let tmp: AppRecord | null = null,
    moved: ReturnType<typeof carryData> = null;
  try {
    tmp = appFromPack(pack, 'rb' + Date.now(), true);
    moved = carryData(app, tmp, inverseSteps(relSteps.concat(draftSteps(app))));
    if (!moved) throw new Error('the records could not be moved into it, so nothing was changed');
    app.def = tmp.def;
    app.seed = tmp.seed;
    app.name = tmp.name;
    app.icon = tmp.icon;
    app.accent = tmp.accent;
    const from = tmp;
    STATIONS.forEach((s) => {
      app.line[s.id] = from.line[s.id];
      app.line[s.id].note = 'From version ' + rel.v;
    });
    dbAdopt(app.id, tmp.id);
  } catch (e) {
    toast('The app could not go back to version ' + rel.v + ': ' + errText(e), 'danger');
    return null;
  } finally {
    if (tmp) {
      dbDrop(tmp.id);
      delete S.apps[tmp.id];
    }
  }
  app.rev++;
  app.reviews = {};
  app.updated = Date.now();
  const ts = runTestsSync(app),
    testLine = ts ? (ts.failed ? ts.failed + ' of ' + ts.total + ' tests fail on it.' : 'All ' + ts.total + ' tests pass.') : '',
    recLine =
      'No records were deleted: ' +
      (moved.rows === before ? 'all ' + before : moved.rows + ' of ' + before) +
      ' are still here' +
      (moved.away
        ? ', and ' +
          moved.away +
          ' value' +
          (moved.away === 1 ? '' : 's') +
          ' that version ' +
          rel.v +
          ' has no field for ' +
          (moved.away === 1 ? 'is' : 'are') +
          ' put away for ' +
          AWAY_KEPT +
          ' and come back when that field does'
        : '') +
      '.';
  app.takenBack = undone.length
    ? { at: Date.now(), from: live.v, to: rel.v, items: undone, why: str(why).slice(0, 300), version: kept ? kept.id : null }
    : null;
  if (same) {
    app.log = (app.log || []).filter((x) => x.at <= live.at);
    pushChat(app, 'orchestrator', 'The draft is version ' + rel.v + ' again, the same as what people have. ' + recLine + ' ' + testLine);
    toast('The draft changes were dropped. Nothing was released.', 'success');
    commit();
    return live;
  }
  const back: Release = {
    v,
    at: Date.now(),
    by: me()?.name || '',
    kind: 'rollback',
    back: rel.v,
    notes,
    sig: appSig(app),
    tests: { passed: ts ? ts.passed : rel.tests.passed, total: ts ? ts.total : rel.tests.total },
    pack: code,
    size: code.length,
    inside: { tables: app.def.tables.length, pages: app.def.screens.length },
    steps: inverseSteps(relSteps),
    start: startWith(live.start),
  };
  app.log = (app.log || []).filter((x) => x.at <= rel.at); // what was changed after that version is not in the app now
  app.releases = [back].concat(relList(app));
  app.releases.slice(6).forEach((r) => {
    r.pack = null;
  });
  toolCall({ agent: 'orchestrator', appId: app.id }, 'release_version', { version: v, kind: 'rollback', back: rel.v }, () => ({
    released: v,
    records: moved ? moved.rows : 0,
  }));
  emit('STATE_DELTA', {
    app: app.id,
    source: 'user',
    delta: [{ op: 'add', path: '/releases/0', value: { version: v, kind: 'rollback' } }],
  });
  pushChat(
    app,
    'orchestrator',
    'You went back. Version ' +
      v +
      ' is live and is the same as ' +
      rel.v +
      '. ' +
      recLine +
      ' ' +
      testLine +
      (undone.length ? ' What was taken back is listed on the Release page, so you can ask for it again.' : ''),
    { type: 'released', v, kind: 'rollback', notes },
  );
  toast('Version ' + v + ' is live: the same as ' + rel.v + '. No records were deleted.', 'success');
  commit();
  publish(app, back);
  return back;
}
/** Whether the draft that going back replaced is still kept, so its changes can be brought back. */
export const canBringBack = (app: AppRecord) => {
  const t = app.takenBack;
  return !!(t && t.version && historyOf(app.id)?.versions.some((v) => v.id === t.version));
};
/**
 * Puts what going back took out into the draft again, with the records as they are now. Nothing is released: the
 * owner tries it, has it fixed, and releases when it is right.
 */
export function bringBack(app: AppRecord): boolean {
  const t = app.takenBack;
  if (!t || !t.version || !canBringBack(app)) {
    toast('The draft from before you went back is no longer kept. Ask for the changes again in the chat.', 'info');
    return false;
  }
  if (appBusy(app)) {
    toast('Wait until the agents have finished, then bring the changes back.', 'warning');
    return false;
  }
  const rev = app.rev;
  restoreVersion(app, t.version);
  if (app.rev === rev) return false;
  app.takenBack = null;
  const ts = runTestsSync(app);
  pushChat(
    app,
    'orchestrator',
    'What was taken back is in the draft again. Nothing was released: people still have version ' +
      (relOf(app)?.v || '') +
      '. Your records are as they were' +
      (ts
        ? ts.failed
          ? ', and ' + ts.failed + ' of ' + ts.total + ' tests fail on the draft.'
          : ', and all ' + ts.total + ' tests pass.'
        : '.') +
      (t.why ? ' You said what went wrong: "' + t.why + '". Tell me what to fix before you release it again.' : ''),
  );
  commit();
  return true;
}
const AWAY_KEPT = '30 days';
export function GoBackDialog({ p }: { p: { app: string; v: string } }) {
  const [why, setWhy] = useState(''),
    [busy, setBusy] = useState(false);
  const app = S.apps[p.app],
    rel = app ? relList(app).find((r) => r.v === p.v) : null,
    live = app ? relOf(app) : null;
  if (!app || !rel || !live) return null;
  const same = rel === live,
    undone = undoneBy(app, rel),
    counts = recordCounts(app).filter((t) => t.n),
    total = counts.reduce((n, t) => n + t.n, 0),
    next = verNext(live.v, 'fix');
  const go = async () => {
    setBusy(true);
    await goBackTo(app, rel, why);
    closeDialog();
  };
  return (
    <Dialog
      title={same ? 'Drop the draft changes?' : 'Go back to version ' + rel.v + '?'}
      onClose={closeDialog}
      cls="goback"
      foot={
        <>
          <Btn className="btn" onClick={closeDialog}>
            Cancel
          </Btn>
          <Btn className="btn primary" id="goback-go" data-autofocus disabled={busy} onClick={go}>
            {busy ? <Spinner /> : <Icon n="undo" s="16" />}
            {same ? 'Drop the draft changes' : 'Go back to ' + rel.v}
          </Btn>
        </>
      }
    >
      <div className="col gap12">
        <div className="col gap4">
          <strong>What comes back</strong>
          <span>
            {'The app as it was in version '}
            {rel.v}
            {', released '}
            {new Date(rel.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            {': its lists, rules, views and pages.'}
          </span>
        </div>
        {undone.length > 0 && (
          <div className="col gap4">
            <strong>What goes away for now</strong>
            <ul className="rel-notes" id="goback-undone">
              {undone.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <MBar tone="success">
          <strong>Your records: nothing is deleted.</strong>
          {total
            ? ' All ' + total + ' stay (' + counts.map((t) => t.n + ' ' + t.label.toLowerCase()).join(', ') + ').'
            : ' There are no records in the app yet.'}
          {' Values in a field that version '}
          {rel.v}
          {' does not have are put away for ' + AWAY_KEPT + ' and come back when that field does.'}
        </MBar>
        {!same && (
          <>
            <p className="muted">
              {'It goes out at once as version '}
              {next}
              {', the same as '}
              {rel.v}
              {'. People only ever move to a higher number, so an older one would reach nobody.'}
            </p>
            <Field id="goback-why" label="What went wrong? (optional)" hint="Kept with what was taken back, to help the fix.">
              <Textarea
                native
                className="textarea"
                id="goback-why"
                rows={2}
                value={why}
                onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)}
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
export const verText = (app: AppRecord) => {
  const sh = app.shared,
    r = relOf(app);
  return sh && sh.ver ? 'Version ' + sh.ver : r ? 'Version ' + r.v + (isDirty(app) ? ' + draft changes' : '') : 'Draft, not released yet';
};

/* ---------- the Release view ---------- */
export function Journey({ app }: { app: AppRecord }) {
  // where this app stands, in four plain steps
  const st = testStats(app),
    ready = app.status === 'ready',
    rel = relOf(app),
    dirty = isDirty(app),
    busy = !!RUNS[app.id],
    go = (v: string) => () => {
      U.view[app.id] = v;
      notify();
    };
  const steps: { id: string; n: string; done: boolean; now?: boolean; bad?: boolean; sub: string; go?: () => void }[] = [
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
/** The Release view's form, kept in the view state so it outlives a re-render. */
type RelForm = ViewState['rel'][string];
const relForm = (id: string): RelForm => U.rel[id] || { kind: null, text: null, busy: false };
function setRelForm(id: string, patch: Partial<RelForm>) {
  U.rel[id] = { ...relForm(id), ...patch };
  notify();
}
/** Ends a line the owner typed, or a list of them, with a full stop. */
const sentence = (x: string) => (/[.!?]$/.test(x.trim()) ? x.trim() : x.trim() + '.');
const wordList = (a: string[]) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
/** What a person who opens the app for the first time starts with. People who already have it keep their own records. */
function StartChoice({
  app,
  value,
  first,
  onChange,
}: {
  app: AppRecord;
  value: StartWith;
  first: boolean;
  onChange: (x: StartWith) => void;
}) {
  const [open, setOpen] = useState(false);
  const seedN = app.def.tables.reduce((n, t) => n + (((app.seed && app.seed.rows) || {})[t.name] || []).length, 0),
    total = recordTotal(app),
    keep = settingsLists(app, app.def.tables),
    kept = app.def.tables.filter((t) => keep.has(t.name)).map((t) => t.label.toLowerCase()),
    items: { id: StartWith; name: string; text: string; usual?: boolean }[] = [
      {
        id: 'empty',
        name: 'Empty',
        text: (kept.length ? 'Only your ' + wordList(kept) : 'No records') + '. Right for a real launch.',
        usual: true,
      },
      {
        id: 'demo',
        name: 'Demo data',
        text: 'The ' + seedN + ' made-up records the app was built with. Right for showing people how it works.',
      },
      {
        id: 'live',
        name: 'The records as they are now',
        text: total + ' record' + (total === 1 ? '' : 's') + ', with everything you added or changed while trying the app.',
      },
    ],
    now = items.find((x) => x.id === value) || items[0];
  if (!first && !open)
    return (
      <div className="row wrap gap8" id="rel-start">
        <span>
          {'New people start with: '}
          <strong>{now.name.toLowerCase()}</strong>
          {'. People who already have the app keep their own records.'}
        </span>
        <Btn className="btn subtle sm" id="rel-start-change" onClick={() => setOpen(true)}>
          Change
        </Btn>
      </div>
    );
  return (
    <div className="col gap8" id="rel-start">
      <strong className="t-sub2" id="rel-start-h">
        {first ? 'What should your people start with?' : 'What should new people start with?'}
      </strong>
      {!first && <span className="t-cap muted">People who already have the app keep their own records.</span>}
      <div className="choices three" role="group" aria-labelledby="rel-start-h">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={cx('choice', it.id === value && 'on')}
            aria-pressed={it.id === value}
            data-start={it.id}
            onClick={() => onChange(it.id)}
          >
            <span className="row wrap gap8">
              <strong>{it.name}</strong>
              {it.usual ? <span className="badge b-outline">Usual choice</span> : null}
            </span>
            <span className="t-cap muted">{it.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function ReleaseView({ app }: { app: AppRecord }) {
  const rel = relOf(app),
    dirty = isDirty(app),
    block = releaseBlock(app),
    st = testStats(app),
    R = relForm(app.id);
  const kind = rel ? R.kind || suggestKind(app) : 'first',
    v = rel ? verNext(rel.v, kind) : '1.0',
    text = R.text != null ? R.text : draftNotes(app).join('\n'),
    can = !block && (!rel || dirty),
    // a real launch starts empty; a later version starts new people the way the one before it did
    start: StartWith = R.start || (rel ? startWith(rel.start) : 'empty'),
    waiting = rel ? draftLog(app).length : 0,
    taken = app.takenBack || null;
  const go = async () => {
    setRelForm(app.id, { busy: true });
    const r = await releaseApp(
      app,
      kind,
      text
        .split('\n')
        .map((x) => x.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean),
      { start },
    );
    setRelForm(app.id, r ? { busy: false, text: null, kind: null, start: null } : { busy: false });
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
        <Card className="card rel-now">
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
            <dl className="rel-two">
              <div>
                <dt>Live</dt>
                <dd id="rel-live">
                  {rel
                    ? 'Version ' +
                      rel.v +
                      ', released ' +
                      ago(rel.at) +
                      (rel.by ? ' by ' + rel.by : '') +
                      (rel.back ? ', the same as ' + rel.back : '') +
                      '. This is what people with the link or the installed app have.'
                    : 'Nothing yet. Releasing makes this the version people get when you share or install the app.'}
                </dd>
              </div>
              <div>
                <dt>Draft</dt>
                <dd id="rel-draft">
                  {!rel
                    ? 'The app as you built it. Only you can see it.'
                    : dirty
                      ? (waiting ? waiting + ' change' + (waiting === 1 ? '' : 's') + ' waiting' : 'Changes waiting') +
                        '. Only you can see ' +
                        (waiting === 1 ? 'it' : 'them') +
                        ' until you release.'
                      : 'The same as the live version. Any change you ask for goes here first, and people get it when you release.'}
                </dd>
              </div>
            </dl>
            <span className="row wrap gap8 t-cap">
              {st ? (
                <span className={cx('ck', st.fresh && st.failed ? 'bad' : 'ok')}>
                  <Icon n={st.fresh && st.failed ? 'warning' : 'checkCircle'} s="16" />
                  {st.fresh ? st.passed + ' of ' + st.total + ' tests pass' : st.total + ' tests run again before a release'}
                </span>
              ) : null}
              <Btn
                className="btn subtle sm"
                onClick={() => {
                  U.view[app.id] = 'tests';
                  notify();
                }}
              >
                Open the tests
              </Btn>
            </span>
          </div>
        </Card>
        {(!rel || dirty) && (
          <Card className="card rel-form">
            <h3 className="widget-h">{rel ? 'Release the draft as version ' + v : 'Before you release'}</h3>
            {!rel && (
              <ul className="plain ticks" id="rel-ready">
                <li className={st && st.fresh && st.failed ? 'bad' : undefined}>
                  <Icon n={st && st.fresh && st.failed ? 'warning' : 'checkCircle'} s="16" />
                  <span>
                    {st && st.fresh
                      ? st.failed
                        ? st.failed + ' of ' + st.total + ' checks fail. Version 1.0 goes out only when every check passes.'
                        : 'Every check passes: ' + st.passed + ' of ' + st.total + '.'
                      : 'Every check runs once more when you release.'}
                  </span>
                </li>
              </ul>
            )}
            <StartChoice app={app} value={start} first={!rel} onChange={(x) => setRelForm(app.id, { start: x })} />
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
                    setRelForm(app.id, { kind: k });
                  }}
                />
              </Field>
            )}
            <Field
              id="rel-notes"
              label={rel ? 'What is new' : 'First release, becomes version 1.0'}
              hint={
                rel
                  ? 'Written from the ' +
                    draftLog(app).length +
                    ' change' +
                    (draftLog(app).length === 1 ? '' : 's') +
                    ' since version ' +
                    rel.v +
                    '. One line each. Edit them freely: people see these when they update.'
                  : 'One line each. People see these in About this app. Turnkey chooses the number: you do not have to.'
              }
            >
              <Textarea
                native
                className="textarea"
                id="rel-notes"
                rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
                value={text}
                onInput={(e) => {
                  setRelForm(app.id, { text: (e.target as HTMLTextAreaElement).value });
                }}
              />
            </Field>
            {block && (
              <MBar
                tone="warning"
                action={
                  /tests fail/.test(block) ? (
                    <Btn
                      className="btn sm"
                      onClick={() => {
                        U.view[app.id] = 'tests';
                        notify();
                      }}
                    >
                      Open the tests
                    </Btn>
                  ) : null
                }
              >
                {block}
              </MBar>
            )}
            <div className="row wrap">
              <Btn className="btn primary" id="rel-go" disabled={!can || R.busy} onClick={go}>
                {R.busy ? <Spinner /> : <Icon n="rocket" s="16" />}
                {'Release version '}
                {v}
              </Btn>
              <span className="t-cap muted">Every test runs once more first. If one fails, nothing is released.</span>
            </div>
          </Card>
        )}
        <Card className="card rel-share">
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
                <Btn className="btn primary" id="rel-share" disabled={!rel} onClick={() => openShare(app)}>
                  <Icon n="share" s="16" />
                  Share by link
                </Btn>
                <Btn className="btn" disabled={!rel || !rel.pack} onClick={() => rel && openVersion(app, rel)}>
                  <Icon n="eye" s="16" />
                  See what they get
                </Btn>
              </div>
              <ul className="plain ticks">
                <li>
                  <Icon n="install" s="16" />
                  <span>Whoever opens the link can install the app. It gets its own window, its own icon and its own data.</span>
                </li>
                <li>
                  <Icon n="sync" s="16" />
                  <span>
                    When you release a newer version the short link opens it at once, and an installed app offers the update the next time
                    it opens. Their records are kept.
                  </span>
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
                <Btn className="btn sm" id="rel-logo-next" disabled={!!RUNS[app.id]} onClick={() => redesignLogo(app)}>
                  <Icon n="wand" s="16" />
                  Another design
                </Btn>
                <Btn className="btn sm" onClick={() => saveLogo(app)}>
                  <Icon n="download" s="16" />
                  Save the icon
                </Btn>
              </div>
            </div>
          </div>
        </Card>
        <Card className="card rel-hist">
          <h3 className="widget-h">
            Versions
            {relList(app).length ? (
              <>
                {' '}
                <span className="tab-n">{relList(app).length}</span>
              </>
            ) : null}
          </h3>
          {taken && (
            <MBar
              tone="info"
              action={
                canBringBack(app) ? (
                  <Btn className="btn sm" id="rel-bring-back" disabled={appBusy(app)} onClick={() => bringBack(app)}>
                    Put them back in the draft
                  </Btn>
                ) : null
              }
            >
              <span id="rel-taken">
                <strong>{'You went back from version ' + taken.from + ' to ' + taken.to + '.'}</strong>
                {' Taken out: ' + sentence(taken.items.map((x) => x.replace(/\.$/, '')).join('; '))}
                {taken.why ? ' What went wrong: ' + sentence(taken.why) : ''}
                {canBringBack(app)
                  ? ' Putting them back changes only the draft. People keep what they have until you release.'
                  : ' Ask for them again in the chat when you want them back.'}
              </span>
            </MBar>
          )}
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
                    {r.back ? <span className="badge b-outline">{'Same as ' + r.back}</span> : null}
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
                    <Btn
                      className="btn subtle sm"
                      disabled={!r.pack}
                      title={r.pack ? 'Open this version on its own' : 'This snapshot was let go to save room'}
                      onClick={() => openVersion(app, r)}
                    >
                      Open
                    </Btn>
                    {(i > 0 || dirty) && (
                      <Btn
                        className="btn subtle sm"
                        disabled={!r.pack || !!RUNS[app.id]}
                        title={
                          r.pack
                            ? i > 0
                              ? 'Make this the live version again. No records are deleted.'
                              : 'Make the draft the same as this version again. No records are deleted.'
                            : 'This snapshot was let go to save room'
                        }
                        onClick={() => askGoBack(app, r)}
                      >
                        {i > 0 ? 'Go back to this' : 'Drop the draft changes'}
                      </Btn>
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
        </Card>
        <Card className="card rel-export" id="rel-export">
          <h3 className="widget-h">Export the deliverable</h3>
          <p className="muted">
            One document made from the app as it is now{rel && dirty ? ' (the draft, not version ' + rel.v + ')' : ''}: the brief, tables,
            rules, screens, tests, which agent made what and the run timeline. Hand it to the team that builds the production version.
          </p>
          <div className="row wrap">
            <Btn className="btn primary" id="exp-md" onClick={() => exportMarkdown(app)}>
              <Icon n="download" s="16" />
              Document (.md)
            </Btn>
            <Btn className="btn" id="exp-pdf" onClick={() => exportPdf(app)}>
              <Icon n="download" s="16" />
              PDF (print)
            </Btn>
            <Btn className="btn" id="exp-html" onClick={() => exportPage(app)}>
              <Icon n="download" s="16" />
              Page (.html)
            </Btn>
            <Btn className="btn" id="exp-sqlite" onClick={() => exportSqlite(app)}>
              <Icon n="download" s="16" />
              Database (.sqlite)
            </Btn>
            <Btn className="btn" id="exp-zip" onClick={() => exportZip(app)}>
              <Icon n="download" s="16" />
              Everything (.zip)
            </Btn>
          </div>
          <span className="t-cap muted">
            PDF opens your browser&apos;s print dialog: choose Save as PDF. The zip holds the document, the page, the database and the
            app&apos;s definition.
          </span>
        </Card>
      </div>
    </div>
  );
}
export function ReleaseCard({ app, m }: { app: AppRecord; m: ChatMessage }) {
  const c = m.card || { type: 'released' };
  return (
    <div className="gcard ok">
      <div className="gc-h">
        <Icon n="rocket" s="16" />
        {'Version '}
        {String(c.v)}
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
        <Btn className="btn primary sm" disabled={!relOf(app)} onClick={() => openShare(app)}>
          <Icon n="share" s="16" />
          Share by link
        </Btn>
        <Btn
          className="btn sm"
          onClick={() => {
            U.view[app.id] = 'release';
            if (NARROW() && chatShown()) setChat(false);
            notify();
          }}
        >
          Versions
        </Btn>
      </div>
    </div>
  );
}

/* ---------- installing the app on its own ---------- */
/* While an app is open on its own (see SoloShell in share.tsx) the page links that app's manifest and icon, so the
   browser installs it under its own name and icon, not Turnkey's. The browser's offer comes as an event (Chrome, Edge);
   Safari and Firefox install from their menu instead. Inside a frame nothing can be installed, so the flow is shown. */
export function installInputOf(app: AppRecord) {
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
/** Marks an app as installed on its own in this browser, or not. */
function markInstalled(id: string, v: boolean) {
  const a = S.apps[id];
  if (!a) return;
  if (v) a.installed = Date.now();
  else delete a.installed;
  commit();
}
export function InstallAppDialog({ p }: { p: { app: string } }) {
  const offered = useSyncExternalStore(onInstallPrompt, canPromptInstall, noOffer);
  const [asked, setAsked] = useState(false);
  const app = S.apps[p.app];
  if (!app) return null;
  const on = !!app.installed,
    ver = verText(app),
    inFrame = framed(),
    // the browser made an offer for this app's manifest: its own Install dialog does the work
    real = offered && !inFrame;
  const set = (v: boolean) => {
    markInstalled(app.id, v);
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
            <Btn className="btn" onClick={() => set(false)}>
              Uninstall
            </Btn>
            <Btn className="btn primary" data-autofocus onClick={closeDialog}>
              Done
            </Btn>
          </>
        ) : (
          <>
            <Btn className="btn" onClick={closeDialog}>
              Not now
            </Btn>
            {real ? (
              <Btn className="btn primary" data-autofocus id="inst-go" data-install="browser" onClick={install}>
                <Icon n="install" s="16" />
                Install
              </Btn>
            ) : (
              <Btn className="btn primary" data-autofocus id="inst-go" data-install={inFrame ? 'shown' : 'menu'} onClick={() => set(true)}>
                <Icon n="install" s="16" />
                {inFrame ? 'Install' : 'I have installed it'}
              </Btn>
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
              {' the app looks for a newer version when it opens, asks before it updates, and keeps your records'}
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
