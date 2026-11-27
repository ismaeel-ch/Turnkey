import type { Row, Untrusted } from '@/shared/types/app';
import type { SqlRow } from '@/shared/types/sqljs';
import type { AppRecord, Dict, ShareState, SharedInfo, SoloView, StartWith } from '@/shared/types/workspace';
import { S, U, arr, commit, emit, errText, hashStr, me, myApps, notify, openDialog, openTab, str, toast, uid } from './core';
import { dbDrop, dbExists, dbSave, qi, sqlRun } from './db';
import { appUsers } from './engine';
import { REC } from './registry';
import { runTestsSync } from './tests';
import { normSettings } from './app-settings';
import { APPLY, STATIONS, blankDef, blankLine, deleteApp, newRun, pushChat } from './line';
import type { BuildApp, Station } from './line';
import { normCases } from './tester';
import { newPane } from './runtime';
import { isDirty, relOf, relHistory } from './release';
import { carryData, keepSafetyCopy } from './carry';
import { normHistory, stepsBetween, verCmp } from './record-steps';
import { runningInstalled } from '@/platform/pwa/prompt';
import { SLUG_RE, loadShortLink, saveShortLink, slugFromPath } from '@/platform/share-link';

/* ===== Turnkey prototype · share an app by link, and the app-only view =====
   A share link carries the app itself: the five definitions the agents wrote and the rows to start with, compressed into the part of
   the address after the #. Nothing is uploaded. Whoever opens the link gets the app on its own, without the builder around it, and
   their own copy of the data in their own browser. A link is untrusted input, so it goes through the same normalisers and checks as
   an agent's output, and nothing in it is ever run as code. */
export const SHARE = {
  maxCode: 900000,
  maxJson: 5000000,
  maxRows: 400,
};
export const b64u = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (t: string) => {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)),
    out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
export async function pipeBytes(bytes: Uint8Array<ArrayBuffer>, through: GenericTransformStream, cap?: number) {
  // run bytes through a compression stream, refusing to grow past the cap
  const reader = new Blob([bytes]).stream().pipeThrough<Uint8Array>(through).getReader(),
    parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    n += r.value.length;
    if (cap && n > cap) {
      try {
        reader.cancel();
      } catch {
        // already closed
      }
      throw new Error('This link holds more than an app can.');
    }
    parts.push(r.value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  parts.forEach((p) => {
    out.set(p, at);
    at += p.length;
  });
  return out;
}
export async function squeeze(text: string) {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') {
    try {
      return '1.' + b64u(await pipeBytes(raw, new CompressionStream('deflate-raw')));
    } catch {
      // fall back to the uncompressed form
    }
  }
  return '0.' + b64u(raw);
}
export async function unsqueeze(code: string) {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(code);
  if (!m) throw new Error('That is not a Turnkey app link.');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = unb64u(m[2]);
  } catch {
    throw new Error('The link is damaged. Ask for it to be sent again.');
  }
  if (m[1] === '0') return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream !== 'function') throw new Error('This browser is too old to open a compressed app link.');
  try {
    return new TextDecoder().decode(await pipeBytes(bytes, new DecompressionStream('deflate-raw'), SHARE.maxJson));
  } catch (e) {
    throw new Error(/more than an app/.test(errText(e)) ? errText(e) : 'The link is damaged. Ask for it to be sent again.');
  }
}
export const framed = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};
/* A code is either a whole app ("0." or "1." and the packed app) or "i." and an app's lasting id: the start address
   of an installed app, which reopens the copy already saved in this browser. */
export const shareCode = (input: unknown) => {
  const s = str(input).trim(),
    m =
      /#app=([01]\.[A-Za-z0-9_-]+|[is]\.[A-Za-z0-9_-]{1,40})(?![A-Za-z0-9_-])/.exec(s) ||
      /^([01]\.[A-Za-z0-9_-]+|[is]\.[A-Za-z0-9_-]{1,40})$/.exec(s);
  if (m) return m[1];
  // a pasted short link: https://<site>/<name>
  const u = /^https?:\/\/[^/?#\s]+(\/[a-z0-9-]{3,40})\/?$/.exec(s),
    slug = u ? slugFromPath(u[1]) : null;
  return slug ? 's.' + slug : null;
};
/** The app the address opens: an "#app=" code, or a short name in the path ("/clinic-desk"). */
export const linkCode = () => {
  try {
    const slug = slugFromPath(location.pathname);
    return shareCode(location.hash) || (slug ? 's.' + slug : null);
  } catch {
    return null;
  }
};
/** The saved app an installed app's "i.<id>" start address points at: the newest guest copy with that id, else one
 *  of the owner's own apps. */
export function installedApp(key: string) {
  const ready = (a: AppRecord) => a.status === 'ready' && dbExists(a.id);
  const all = Object.values(S.apps);
  return (
    all.find((a) => a.shared && !a.shared.preview && a.shared.uid === key && ready(a)) ||
    all.find((a) => !a.shared && (a.uid === key || a.id === key) && ready(a)) ||
    null
  );
}
export const shareLink = (code: string) => {
  let base = '';
  try {
    base = location.origin && location.origin !== 'null' && /^https?:/.test(location.protocol) ? location.origin + location.pathname : '';
  } catch {
    // no address to build on: use the placeholder
  }
  return (base || 'https://formwork.example/') + '#app=' + code;
};
/** A share link's contents, as read from untrusted text: every part goes through the station checks. */
export type Pack = Untrusted;
/** Reads what a copy starts with from anything: a link from before the choice existed starts with demo data. */
export const startWith = (x: unknown): StartWith => (x === 'live' || x === 'empty' ? x : 'demo');
/**
 * The lists that keep their records when a copy starts empty: the starter settings the plan names (categories, teams,
 * limits), which are real from day one. A settings list whose records must point at a list that starts empty cannot
 * keep them, so it starts empty too. An app built before plans has none.
 */
export function settingsLists(
  app: AppRecord,
  tables: { name: string; columns: { type: string; ref?: string | null; required?: boolean }[] }[],
): Set<string> {
  const named = new Set(
      arr<{ name: string; settings?: boolean }>(app.plan && app.plan.lists)
        .filter((l) => l && l.settings)
        .map((l) => l.name),
    ),
    keep = new Set(tables.filter((t) => named.has(t.name)).map((t) => t.name)),
    gone = (c: { type: string; ref?: string | null }) => c.type === 'ref' && c.ref !== 'users' && !keep.has(String(c.ref));
  for (let again = keep.size > 0; again;) {
    again = false;
    tables.forEach((t) => {
      if (
        keep.has(t.name) &&
        arr<{ type: string; ref?: string | null; required?: boolean }>(t.columns).some((c) => c.required && gone(c))
      ) {
        keep.delete(t.name);
        again = true;
      }
    });
  }
  return keep;
}
/** Takes the records out of a version that is already packed, all but the starter settings. */
export function emptied(pack: Pack, app: AppRecord): Pack {
  const tables = arr<Untrusted>(pack.database && pack.database.tables),
    keep = settingsLists(
      app,
      tables.map((t) => ({ name: str(t && t.name), columns: arr(t && t.columns) })),
    );
  tables.forEach((t) => {
    if (!t) return;
    if (!keep.has(str(t.name))) t.rows = [];
    else
      arr<Untrusted>(t.rows).forEach((r) =>
        arr<Untrusted>(t.columns).forEach((c) => {
          if (r && c && c.type === 'ref' && c.ref !== 'users' && !keep.has(str(c.ref))) delete r[c.name]; // it pointed at a record that is not there
        }),
      );
  });
  pack.data = 'empty';
  return pack;
}
export function packOf(app: AppRecord, o: { data: string; as?: string | null }): Pack {
  // everything a browser needs to rebuild the app: what each station wrote, and the rows to start with
  const def = app.def,
    start = startWith(o.data),
    live = start !== 'demo', // the rows come from the database as it is, not from the made-up rows the app was built with
    keep = start === 'empty' ? settingsLists(app, def.tables) : null,
    strip = (c: object) => {
      const x = { ...c } as Dict<unknown>;
      delete x.by;
      delete x.run;
      return x;
    },
    rowsOf: Dict<Row[]> = {},
    rows = (text: string) => sqlRun(app.id, text, null, 'share') as SqlRow[];
  if (live) {
    // rows point at each other by position in the link, not by id
    const pos: Dict<Dict<number>> = {},
      upos: Dict<number> = {},
      raw: Dict<SqlRow[]> = {};
    rows('SELECT "id" FROM "users" ORDER BY "id"').forEach((u, i) => {
      upos[String(u.id)] = i + 1;
    });
    def.tables.forEach((t) => {
      raw[t.name] = keep && !keep.has(t.name) ? [] : rows('SELECT * FROM ' + qi(t.name) + ' ORDER BY "id" LIMIT ' + SHARE.maxRows);
      pos[t.name] = {};
      raw[t.name].forEach((r, i) => {
        pos[t.name][String(r.id)] = i + 1;
      });
    });
    def.tables.forEach((t) => {
      rowsOf[t.name] = raw[t.name].map((r) => {
        const x: Row = {};
        t.columns.forEach((c) => {
          const v = r[c.name];
          if (v == null || v === '') return;
          const k = String(v);
          x[c.name] =
            c.type === 'ref' ? (pos[String(c.ref)] || {})[k] || null : c.type === 'user' ? upos[k] || null : c.type === 'bool' ? !!v : v;
        });
        if (!t.owner && upos[String(r.created_by)]) x._by = upos[String(r.created_by)];
        if (r.is_demo) x._demo = 1; // made-up rows stay marked in the copy (src/workspace/demo-data.ts)
        return x;
      });
    });
  } else
    def.tables.forEach((t) => {
      rowsOf[t.name] = ((app.seed && app.seed.rows) || {})[t.name] || [];
    });
  const brief = { ...def.brief } as Dict<unknown>;
  delete brief.sources;
  return {
    f: 'formwork-app',
    v: 1,
    name: app.name,
    request: app.request,
    tpl: app.tpl || null,
    data: start,
    as: o.as || null,
    by: me()?.name || '',
    research: brief,
    database: {
      tables: def.tables.map((t) => ({
        name: t.name,
        label: t.label,
        one: t.one,
        title: t.title,
        owner: t.owner,
        columns: t.columns.map(strip),
        rows: rowsOf[t.name],
      })),
      users: def.users.map((u) => ({
        name: u.name,
        role: u.role,
      })),
    },
    backend: {
      process: def.process,
      access: def.access,
      team: def.team,
    },
    views: {
      views: Object.keys(def.views || {}).map((t) => ({
        table: t,
        use: (def.views || {})[t],
      })),
      dashboard: def.dash,
      board: def.board || null,
    },
    screens: {
      screens: def.screens,
      theme: def.theme,
      tour: def.tour,
      actions: def.actions,
    },
    tests: {
      cases: def.cases || [],
    },
    // what was chosen on the app's own Settings page travels with it
    ...(def.settings ? { settings: def.settings } : {}),
  };
}
export function readPack(json: string): Pack {
  let p: Pack;
  try {
    p = JSON.parse(json);
  } catch {
    throw new Error('The link is damaged. Ask for it to be sent again.');
  }
  if (!p || p.f !== 'formwork-app' || p.v !== 1 || typeof p.research !== 'object' || typeof p.database !== 'object')
    throw new Error('That link does not hold a Turnkey app.');
  return p;
}
export function appFromPack(pack: Pack, key: string, preview?: boolean): AppRecord {
  // rebuild the app station by station. Each part must pass the same checks an agent's output must pass.
  const id = uid('app'),
    app = {
      id,
      owner: 'guest',
      shared: {
        key,
        by: str(pack.by).slice(0, 60),
        at: Date.now(),
        as: str(pack.as).slice(0, 40),
        data: startWith(pack.data),
        preview: !!preview,
        ver: /^\d+(\.\d+){0,2}$/.test(str(pack.ver)) ? str(pack.ver) : '',
        uid: /^[A-Za-z0-9_-]{4,40}$/.test(str(pack.uid)) ? str(pack.uid) : '',
        notes: arr(pack.notes)
          .map((n) => str(n).slice(0, 200))
          .filter(Boolean)
          .slice(0, 12),
        kind: ['first', 'fix', 'feature', 'major', 'rollback'].includes(str(pack.kind)) ? str(pack.kind) : '',
        ...(SLUG_RE.test(str(pack.slug)) ? { slug: str(pack.slug) } : {}),
      },
      name: str(pack.name).slice(0, 40) || 'Shared app',
      icon: 'apps',
      accent: 'blue',
      request: str(pack.request).slice(0, 600),
      tpl: REC[pack.tpl] ? pack.tpl : null,
      mode: 'demo',
      status: 'new',
      created: Date.now(),
      updated: Date.now(),
      def: blankDef(),
      seed: null,
      line: {},
      runs: [],
      chat: [],
      answers: {},
      rev: 0,
      renamed: true,
    } as unknown as BuildApp; // flow and reviews are made the first time something asks for them; the stations fill the definition
  const shared = app.shared as SharedInfo;
  STATIONS.forEach((s) => {
    app.line[s.id] = blankLine();
  });
  S.apps[id] = app;
  const run = newRun(app, 'open', 'Opened from a link', 'demo'),
    parts: [string, Untrusted][] = [
      ['research', pack.research],
      ['database', pack.database],
      ['backend', pack.backend],
      ['views', pack.views],
      ['screens', pack.screens],
      ['walkthrough', null],
    ];
  try {
    parts.forEach((x) => {
      const st = x[0],
        L = app.line[st],
        r = APPLY[st](app, x[1], run, 1),
        bad = r.checks.filter((c) => !c.ok);
      L.attempt = 1;
      L.checks = r.checks;
      L.facts = r.facts;
      L.attempts = [
        {
          n: 1,
          ok: !bad.length,
          issues: bad.map((c) => c.label + (c.detail ? ': ' + c.detail : '')),
        },
      ];
      L.status = bad.length ? 'failed' : 'ok';
      L.t1 = Date.now();
      app.rev++;
      if (bad.length && st !== 'walkthrough')
        throw new Error(
          'The ' +
            (STATIONS.find((s) => s.id === st) as Station).name.toLowerCase() +
            ' part of this link did not pass its checks (' +
            bad[0].label +
            ').',
        );
      if (st === 'research' && app.def.brief && pack.research && pack.research.decision && typeof pack.research.decision === 'object')
        app.def.brief.decision = {
          text: str(pack.research.decision.text).slice(0, 300),
          answer: str(pack.research.decision.answer).slice(0, 300),
        };
    });
  } catch (e) {
    run.status = 'failed';
    dbDrop(id);
    delete S.apps[id];
    throw e;
  }
  app.def.cases = normCases(pack.tests, app.def);
  // a link is untrusted: its settings are checked against the app that was just rebuilt from it
  if (pack.settings) app.def.settings = normSettings(pack.settings, app.def);
  app.rev++;
  run.status = 'ok';
  run.t1 = Date.now();
  app.status = 'ready';
  app.updated = Date.now();
  pushChat(
    app,
    'orchestrator',
    'This app was opened from a share link' +
      (shared.by ? ' sent by ' + shared.by : '') +
      '. Its definition passed every check again in this browser, and its data is a copy that lives here.',
  );
  dbSave(id);
  return app;
}
/** How a link is being opened. */
interface OpenOpts {
  preview?: boolean;
  /** the app tab to go back to */
  back?: string | null;
  /** the short link's name, when it came from one */
  slug?: string;
}
export async function openShared(input: unknown, o: OpenOpts = {}): Promise<AppRecord> {
  // from a link, a pasted code, or the owner's preview
  const code = shareCode(input);
  if (!code) throw new Error('That is not a Turnkey app link. A link ends with #app= followed by a long code.');
  if (code.length > SHARE.maxCode) throw new Error('That link is too long to be an app.');
  if (code.startsWith('s.')) {
    // a short link: the code is kept on the server under the name; offline, the copy saved here opens
    const slug = code.slice(2),
      got = await loadShortLink(slug);
    if (got.ok) return openShared(got.code, { ...o, slug });
    const saved = Object.values(S.apps).find(
      (a) => a.shared && !a.shared.preview && a.shared.slug === slug && a.status === 'ready' && dbExists(a.id),
    );
    if (saved) {
      enterSolo(saved, { from: 'link', back: o.back || null });
      commit();
      return saved;
    }
    throw new Error(got.reason === 'offline' ? 'This app needs a connection the first time it opens.' : got.message);
  }
  if (code.startsWith('i.')) {
    // opened from the home screen, the dock or the Start menu: the app is already in this browser
    const saved = installedApp(code.slice(2));
    if (!saved) throw new Error('This app is no longer saved in this browser. Open its link again to get it back.');
    if (runningInstalled() && !saved.installed) saved.installed = Date.now();
    enterSolo(saved, { from: 'link', back: o.back || null });
    commit();
    return saved;
  }
  if (!S.shared) S.shared = {};
  const key = 'k' + hashStr(code);
  let app: AppRecord | null = S.shared[key] ? S.apps[S.shared[key]] : null;
  if (!app || app.status !== 'ready' || !dbExists(app.id)) {
    const pack = readPack(await unsqueeze(code));
    if (app) deleteApp(app);
    if (o.preview)
      Object.values(S.apps)
        .filter((a) => a.shared && a.shared.preview)
        .forEach((a) => {
          delete S.shared[(a.shared as SharedInfo).key];
          deleteApp(a);
        }); // one preview copy at a time
    const made = appFromPack(pack, key, o.preview),
      mine = made.shared as SharedInfo;
    app = made;
    S.shared[key] = made.id;
    const old =
      !o.preview && mine.uid
        ? Object.values(S.apps).find(
            (a) =>
              a.id !== made.id &&
              a.owner === 'guest' &&
              a.shared &&
              !a.shared.preview &&
              a.shared.uid === mine.uid &&
              a.status === 'ready' &&
              dbExists(a.id),
          )
        : null;
    if (old && old.shared && verCmp(mine.ver, old.shared.ver) > 0) {
      // a newer version of an app this browser already has: update it and keep the records. The records follow what
      // each version in between did to the tables (a renamed field keeps its values), and it is all or nothing.
      const kept = carryData(old, made, stepsBetween(normHistory(pack.history), old.shared.ver, mine.ver));
      if (kept) {
        keepSafetyCopy(old, made, old.shared.ver, kept.rows); // the records as they were, before anything changed them
        mine.updated = {
          from: old.shared.ver || 'an earlier version',
          kept: kept.rows,
          at: Date.now(),
          away: kept.away,
        };
        if (old.installed) made.installed = old.installed;
        if (!mine.slug && old.shared.slug) mine.slug = old.shared.slug;
        deleteApp(old);
        emit('CUSTOM', {
          name: 'app_updated',
          app: made.id,
          value: {
            from: mine.updated.from,
            to: mine.ver,
            rowsKept: kept.rows,
            putAway: kept.away,
          },
        });
      } else {
        // the records could not all be moved: this device stays on the version that holds them
        delete S.shared[key];
        deleteApp(made);
        old.shared.failed = { to: mine.ver, at: Date.now() };
        app = old;
        emit('CUSTOM', {
          name: 'app_update_failed',
          app: old.id,
          value: {
            from: old.shared.ver,
            to: mine.ver,
          },
        });
      }
    }
  }
  const sh = app.shared as SharedInfo;
  if (!o.preview && sh.preview) sh.preview = false; // opened for real: keep the copy
  if (o.slug && !o.preview) sh.slug = o.slug;
  enterSolo(app, {
    from: o.preview ? 'preview' : 'link',
    as: sh.as,
    back: o.back || null,
  });
  commit();
  return app;
}
export function enterSolo(app: AppRecord, o: { from?: SoloView['from']; as?: string | null; back?: string | null } = {}) {
  const pane = newPane(7),
    u = o.as ? appUsers(app).find((x) => x.username === o.as) : null;
  if (u) pane.uid = u.id;
  U.solo = {
    app: app.id,
    pane,
    from: o.from || 'link',
    back: o.back || null,
  };
  U.dialog = null;
  U.sheet = null;
  U.toasts = [];
  U.tour = null;
  notify();
}
export function exitSolo() {
  const so = U.solo;
  U.solo = null;
  U.sheet = null;
  try {
    if (/#app=/.test(location.hash) || slugFromPath(location.pathname))
      history.replaceState(null, '', (slugFromPath(location.pathname) ? '/' : location.pathname) + location.search);
  } catch {
    // the address could not be changed: leave it
  }
  if (so && so.back && S.apps[so.back]) {
    openTab(so.back);
  }
  commit();
}
export function keepShared(app: AppRecord) {
  // a guest copy becomes one of your own apps
  if (!me() || !app.shared) return;
  let name = app.name,
    k = 2;
  while (myApps().some((a) => a.name === name)) name = app.name + ' ' + k++;
  delete S.shared[app.shared.key];
  app.owner = S.session;
  app.name = name;
  delete app.shared;
  app.updated = Date.now();
  runTestsSync(app);
  U.solo = null;
  openTab(app.id);
  toast(name + ' is in your library now. You can change it by chat like any app you built.', 'success');
  commit();
}
export const sharedApps = () =>
  Object.values(S.apps)
    .filter((a) => a.owner === 'guest' && a.shared && !a.shared.preview && a.status === 'ready')
    .sort((a, b) => b.updated - a.updated);

/* ---------- the share dialog ---------- */
export function openShare(app: AppRecord) {
  U.share = {
    app: app.id,
    data: startWith(relOf(app)?.start), // what the owner chose for new people when they released
    as: '',
    code: null,
    busy: true,
    err: '',
    raw: 0,
    rows: 0,
  };
  openDialog('share', {
    app: app.id,
  });
  makeShare();
}
export async function makeShare() {
  const sh = U.share,
    app = sh && S.apps[sh.app];
  if (!app) return;
  const tag = sh.data + '|' + sh.as;
  sh.busy = true;
  sh.err = '';
  notify();
  try {
    const rel = relOf(app);
    if (!rel) {
      sh.code = null;
      sh.busy = false;
      return notify();
    } // a link carries a released version
    const dirty = isDirty(app);
    let pack: Pack;
    sh.ver = rel.v;
    sh.draft = dirty;
    if (dirty) {
      if (!rel.pack) throw new Error('The snapshot of version ' + rel.v + ' is gone. Release the draft to share it.');
      pack = readPack(await unsqueeze(rel.pack));
      pack.as = sh.as || null;
      pack.by = me()?.name || '';
      if (sh.data === 'empty') emptied(pack, app);
    } else {
      pack = packOf(app, sh);
      pack.ver = rel.v;
      pack.uid = app.uid;
      pack.notes = rel.notes;
      pack.kind = rel.kind;
      pack.history = relHistory(app);
    }
    if (app.short) pack.slug = app.short.slug; // an installed copy asks this address for newer versions
    const json = JSON.stringify(pack),
      code = await squeeze(json);
    if (U.share !== sh || tag !== sh.data + '|' + sh.as) return;
    sh.code = code;
    sh.raw = json.length;
    sh.rows = arr(pack.database.tables).reduce((n: number, t: Untrusted) => n + arr(t.rows).length, 0);
  } catch (e) {
    sh.code = null;
    sh.err = errText(e);
  }
  sh.busy = false;
  notify();
  await shortenShare(sh, app);
}
/* The short link: the code is saved on the server under a name made from the app's name. The first save gives a
   token that stays with the app in this browser; later saves send it back, so the same address gets the newer
   version. When the site keeps no store, or the save fails, the long link is all there is, and it works the same. */
export async function shortenShare(sh: ShareState, app: AppRecord) {
  if (!sh.code || framed()) return;
  const code = sh.code;
  sh.short = '';
  sh.shortBusy = true;
  notify();
  const prev: Partial<NonNullable<AppRecord['short']>> = app.short || {};
  let r = await saveShortLink({ code, name: app.name, slug: prev.slug, token: prev.token });
  if (!r.ok && r.reason === 'forbidden') {
    delete app.short; // the name belongs to someone else now: make a new one
    r = await saveShortLink({ code, name: app.name });
  }
  if (U.share !== sh || sh.code !== code) return;
  sh.shortBusy = false;
  if (r.ok) {
    if (r.token) app.short = { slug: r.slug, token: r.token };
    sh.short = location.origin + r.path;
    commit();
  } else sh.shortNote = r.reason === 'off' ? '' : r.message;
  notify();
}
