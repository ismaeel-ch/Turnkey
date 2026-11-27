import type { BriefedDef, Logo, RecordStep, Theme, Untrusted } from '@/shared/types/app';
import type { AppRecord, ChangeSet, Dict, Release, StartWith } from '@/shared/types/workspace';
import { ACC_HEX } from '@/styles/theme.generated';
import { toStyle } from '@/platform/dom';
import { ICONS } from './icons';
import { S, arr, commit, cx, emit, errText, hashStr, label, me, str, toast, toolCall, uid } from './core';
import { dbAdopt, dbCount, dbDrop } from './db';
import { TEAMS } from './team';
import { runTestsSync, testStats } from './tests';
import { RUNS, STATIONS, pushChat } from './line';
import { appFromPack, framed, packOf, readPack, squeeze, startWith, unsqueeze } from './share';
import type { Pack } from './share';
import { carryData } from './carry';
import { kindOf } from './change-plan';
import { appBusy, historyOf, record as keepDraft, restoreVersion } from './history';
import { inverseSteps, verCmp, verNext, verParts } from './record-steps';
import type { VersionSteps } from './record-steps';
import { currentVersion } from '@/shared/history';
import { saveShortLink } from '@/platform/share-link';

/* ===== Turnkey prototype · releases, the app's own icon, and installing the app on its own =====
   Building gives you a draft. Releasing turns the draft into a numbered version: the tests must pass, the notes say
   what changed, and a snapshot is kept so the version can be opened again or restored. A share link always carries
   a released version, never a half-finished draft. The icon is designed by the UI agent as data and drawn by code. */
/* ---------- the icon ---------- */
export const LOGO_SHAPES = ['squircle', 'circle', 'hexagon', 'shield', 'tile'],
  LOGO_FILLS = ['gradient', 'solid', 'split', 'ring'],
  LOGO_MARKS = ['none', 'dot', 'spark', 'bar'];
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
export const logoUrl = (app: AppRecord, size?: number) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg(logoOf(app), size || 256));
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
        // only when there are rules, so an app from before rules existed keeps the signature it had
        ...(d.logic && d.logic.rules.length ? [d.logic] : []),
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
export { verCmp, verNext, verParts };
export const REL_KIND: Dict<string> = {
  first: 'First release',
  fix: 'Fixes',
  feature: 'New features',
  major: 'Big change',
  rollback: 'Went back',
};
/** Notes a change for the next release. `kind` is the owner's own word on it (a fix or a new feature), when they gave one. */
export function logChange(app: AppRecord, text: string, station?: string, kind?: 'fix' | 'feature' | null, group?: string) {
  if (!app.log) app.log = [];
  app.log.push({
    at: Date.now(),
    text: str(text).slice(0, 160),
    station: station || '',
    ...(kind ? { kind } : {}),
    ...(group ? { group } : {}),
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
type LogEntry = NonNullable<AppRecord['log']>[number];
/** A record step in the owner's words, for a release note: "Add Phone to Tracks". */
export function stepWords(app: AppRecord, step: RecordStep): string {
  const t = app.def.tables.find((x) => x.name === step.table),
    list = t ? t.label : label(step.table);
  switch (step.op) {
    case 'add_field':
      return 'Add ' + label(step.column) + ' to ' + list;
    case 'remove_field':
      return 'Remove ' + label(step.column) + ' from ' + list;
    case 'rename_field':
      return 'Rename ' + label(step.from) + ' to ' + label(step.to) + ' in ' + list;
    case 'to_choice':
      return 'Change ' + label(step.column) + ' in ' + list + ' to a choice';
  }
}
/**
 * What the draft changed since the live version, for the release notes. A change that was cut off half-way (the tab
 * was closed while its steps ran) is in the app but never got its note: its record steps carry no change id. Each
 * such step is noted from the step itself, so it is never left out of the notes people read when they update.
 */
export const draftLog = (app: AppRecord): LogEntry[] => {
  const r = baseOf(app),
    after = (at: number) => !r || at > r.at,
    noted = (app.log || []).filter((x) => after(x.at)),
    cut = arr<{ at: number; step?: RecordStep; group?: string }>(app.def.migrations)
      .filter((m) => m.step && !m.group && after(m.at))
      .map((m): LogEntry => ({ at: m.at, text: stepWords(app, m.step as RecordStep), station: 'database' }))
      .filter((x) => !noted.some((y) => y.text === x.text));
  return cut.length ? noted.concat(cut).sort((a, b) => a.at - b.at) : noted;
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
  return !relOf(app) ? 'first' : lg.some((x) => /^Rebuil/.test(x.text)) ? 'major' : kindOf(lg); // the same rule the plan of a change shows: a new field, list, page or view is a new feature
}
export function draftNotes(app: AppRecord) {
  const d = app.def as BriefedDef;
  if (!relOf(app))
    return [
      'First release: ' +
        d.screens.length +
        (d.screens.length === 1 ? ' screen for ' : ' screens for ') +
        (d.brief.roles.length === 1 ? 'one kind of person' : d.brief.roles.length + ' kinds of people') +
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
/** One change waiting in the draft. Edits made some other way are gathered into one entry with no `set`. */
export interface Waiting {
  id: string;
  title: string;
  kind: 'fix' | 'feature' | null;
  notes: string[];
  set: ChangeSet | null;
}
/** What waits in the draft, one entry for each change the owner approved, then the other edits together. */
export function waitingChanges(app: AppRecord): Waiting[] {
  if (!relOf(app)) return [];
  const sets = arr<ChangeSet>(app.changes),
    out: Waiting[] = [],
    by: Dict<Waiting> = {};
  draftLog(app).forEach((x) => {
    const set = (x.group && sets.find((c) => c.id === x.group)) || null,
      id = set ? set.id : '';
    let w = by[id];
    if (!w) {
      w = by[id] = { id, title: set ? set.title : 'Other changes', kind: set ? set.kind : null, notes: [], set };
      out.push(w);
    }
    const t = pastTense(x.text);
    if (!w.notes.includes(t)) w.notes.push(t);
  });
  return out.sort((a, b) => (a.set ? 0 : 1) - (b.set ? 0 : 1));
}
/** Whether a change can go out on its own: it was kept with its operations, and something else waits beside it. */
export const aloneOffered = (app: AppRecord, id?: string) => {
  const w = waitingChanges(app);
  return w.length > 1 && w.some((x) => x.set && (!id || x.id === id));
};
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
async function firstCopy(app: AppRecord, rel: Release, src: AppRecord): Promise<string> {
  const start = startWith(rel.start);
  if (!rel.pack || start === 'demo') return rel.pack || '';
  const pack = packOf(src, { data: start, as: '' });
  pack.ver = rel.v;
  pack.uid = app.uid;
  pack.notes = rel.notes;
  pack.kind = rel.kind;
  pack.history = relHistory(app);
  if (app.short) pack.slug = app.short.slug;
  return squeeze(JSON.stringify(pack));
}
/**
 * Puts a version that was just released under the short link. `src` holds the version's records when that is not the
 * app itself (a change released on its own is made in a copy); it is read before this returns, so it can go after.
 */
export function publish(app: AppRecord, rel: Release, src: AppRecord = app) {
  const fallback = rel.pack || '';
  void firstCopy(app, rel, src)
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
export const AWAY_KEPT = '30 days';
export const verText = (app: AppRecord) => {
  const sh = app.shared,
    r = relOf(app);
  return sh && sh.ver ? 'Version ' + sh.ver : r ? 'Version ' + r.v + (isDirty(app) ? ' + draft changes' : '') : 'Draft, not released yet';
};

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
