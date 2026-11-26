import type { FormEvent } from 'react';
import { useEffect } from 'react';
import type { BriefedDef, Row, Untrusted } from '@/shared/types/app';
import type { SqlRow } from '@/shared/types/sqljs';
import type { AppRecord, Dict, ShareState, SharedInfo, SoloView } from '@/shared/types/workspace';
import {
  S,
  U,
  arr,
  closeDialog,
  commit,
  confirmBox,
  copyText,
  emit,
  errText,
  fmtBytes,
  hashStr,
  me,
  myApps,
  notify,
  openDialog,
  openTab,
  str,
  toast,
  uid,
} from './core';
import { dbCount, dbDrop, dbExists, dbSave, qi, sqlRun } from './db';
import { appUsers, deriveEndpoints, roleName } from './engine';
import { REC } from './builds';
import { runTestsSync, testStats } from './tests';
import { APPLY, STATIONS, blankDef, blankLine, deleteApp, newRun, pushChat, resetAppData } from './line';
import type { BuildApp, Station } from './line';
import { normCases } from './tester';
import { Btn, Dialog, Field, Icon, Input, MBar, Seg, Select, Spinner, Textarea } from './ui';
import { AppPane, newPane } from './runtime';
import {
  AppLogo,
  carryData,
  clearIdentity,
  draftNotes,
  installInputOf,
  isDirty,
  relOf,
  releaseApp,
  releaseBlock,
  setIdentity,
  verCmp,
  verText,
} from './release';
import { appInstallLinks, holdInstallLinks, setInstallLinks } from '@/platform/pwa/app';
import { lastInstalledAt, onInstallPrompt, runningInstalled } from '@/platform/pwa/prompt';
import { loadShortLink, saveShortLink, slugFromPath } from '@/platform/share-link';

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
  const reader = new Blob([bytes])
      .stream()
      .pipeThrough<Uint8Array>(through as ReadableWritablePair<Uint8Array, Uint8Array>)
      .getReader(),
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
export function packOf(app: AppRecord, o: { data: string; as?: string | null }): Pack {
  // everything a browser needs to rebuild the app: what each station wrote, and the rows to start with
  const def = app.def,
    live = o.data === 'live',
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
      raw[t.name] = rows('SELECT * FROM ' + qi(t.name) + ' ORDER BY "id" LIMIT ' + SHARE.maxRows);
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
    data: live ? 'live' : 'demo',
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
        data: (pack.data === 'live' ? 'live' : 'demo') as 'live' | 'demo',
        preview: !!preview,
        ver: /^\d+(\.\d+){0,2}$/.test(str(pack.ver)) ? str(pack.ver) : '',
        uid: /^[A-Za-z0-9_-]{4,40}$/.test(str(pack.uid)) ? str(pack.uid) : '',
        notes: arr(pack.notes)
          .map((n) => str(n).slice(0, 200))
          .filter(Boolean)
          .slice(0, 12),
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
  app.def.cases = normCases(pack.tests, app.def as BriefedDef);
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
      // a newer version of an app this browser already has: update it and keep the records
      const kept = carryData(old, made);
      mine.updated = {
        from: old.shared.ver || 'an earlier version',
        kept: kept ? kept.rows : null,
        at: Date.now(),
      };
      if (old.installed) made.installed = old.installed;
      deleteApp(old);
      emit('CUSTOM', {
        name: 'app_updated',
        app: made.id,
        value: {
          from: mine.updated.from,
          to: mine.ver,
          rowsKept: kept ? kept.rows : 0,
        },
      });
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
  const pane = newPane(7) as SoloView['pane'],
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
    data: 'demo',
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
    } else {
      pack = packOf(app, sh);
      pack.ver = rel.v;
      pack.uid = app.uid;
      pack.notes = rel.notes;
    }
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
/** a choice in the share dialog changed: the link is packed again */
function setShare(patch: Partial<ShareState>) {
  if (!U.share) return;
  Object.assign(U.share, patch, { code: null });
  makeShare();
}
function setShareBusy(busy: boolean) {
  if (U.share) U.share.rbusy = busy;
}
export function ShareDialog({ p }: { p: { app: string } }) {
  const app = S.apps[p.app],
    sh = U.share;
  if (!app || !sh) return null;
  const users = appUsers(app),
    link = sh.code ? shareLink(sh.code) : '',
    seedN = app.def.tables.reduce((n, t) => n + (((app.seed && app.seed.rows) || {})[t.name] || []).length, 0),
    liveN = app.def.tables.reduce((n, t) => n + Number(dbCount(app.id, t.name)), 0);
  const preview = async () => {
    try {
      closeDialog();
      await openShared(sh.code, {
        preview: true,
        back: app.id,
      });
    } catch (e) {
      toast(errText(e), 'danger');
    }
  };
  const rel = relOf(app),
    dirty = isDirty(app),
    block = releaseBlock(app),
    first = async () => {
      setShareBusy(true);
      notify();
      const r = await releaseApp(app, 'first', draftNotes(app));
      setShareBusy(false);
      if (r) makeShare();
      else notify();
    };
  if (!rel)
    return (
      <Dialog
        title={'Share ' + app.name}
        onClose={closeDialog}
        cls="share"
        foot={
          <>
            <Btn className="btn" onClick={closeDialog}>
              Not now
            </Btn>
            <Btn className="btn primary" id="sh-release" data-autofocus disabled={!!block || sh.rbusy} onClick={first}>
              {sh.rbusy ? <Spinner /> : <Icon n="rocket" s="16" />}Release version 1.0 and make the link
            </Btn>
          </>
        }
      >
        <div className="col gap12">
          <div className="install-app">
            <AppLogo app={app} size={48} />
            <div className="col gap0">
              <strong className="t-sub2">{app.name}</strong>
              <span className="muted t-cap">Draft · not released yet</span>
            </div>
          </div>
          <p>
            A link always carries a released version, so people never get a half-finished draft. Releasing runs every test once more and
            takes a moment.
          </p>
          {block && <MBar tone="warning">{block}</MBar>}
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title={'Share ' + app.name}
      onClose={closeDialog}
      cls="share"
      foot={
        <>
          <Btn className="btn" disabled={!sh.code} onClick={preview}>
            <Icon n="eye" s="16" />
            Preview what they see
          </Btn>
          <Btn className="btn primary" data-autofocus disabled={!sh.code} onClick={() => copyText(link, 'Link')}>
            <Icon n="copy" s="16" />
            Copy link
          </Btn>
        </>
      }
    >
      <div className="install-app">
        <AppLogo app={app} size={48} />
        <div className="col gap0 grow">
          <strong className="t-sub2">{app.name}</strong>
          <span className="muted t-cap" id="sh-ver">
            {'Version '}
            {rel.v}
            {dirty ? ' · your draft changes are not in this link' : ''}
          </span>
        </div>
        {dirty && (
          <Btn
            className="btn sm"
            onClick={() => {
              closeDialog();
              U.view[app.id] = 'release';
              notify();
            }}
          >
            Release the draft
          </Btn>
        )}
      </div>
      <p>
        {'Anyone with the link opens '}
        <strong>{app.name}</strong>
        {
          ' on its own: the app, its icon, its sign-in screen and its data. They can install it. They do not see Turnkey, the agents or your other apps.'
        }
      </p>
      <div className="share-grid">
        <Field
          id="sh-data"
          label="They start with"
          hint={
            sh.data === 'live'
              ? 'A copy of the ' + liveN + ' records as they are now. The activity history stays with you.'
              : 'The ' + seedN + ' made-up rows the Database agent wrote, with dates that stay around today.'
          }
        >
          <Seg
            label="Which data the link carries"
            items={[
              {
                id: 'demo',
                label: 'Demo data',
              },
              {
                id: 'live',
                label: 'Current records',
              },
            ]}
            value={dirty ? 'demo' : sh.data}
            onChange={(v) =>
              dirty && v === 'live'
                ? toast('Current records fit the draft, not version ' + rel.v + '. Release the draft to share them.', 'info')
                : setShare({ data: v as ShareState['data'] })
            }
          />
        </Field>
        <Field id="sh-as" label="They open it as" hint="A person skips the sign-in screen. They can still switch.">
          <Select
            native
            className="select"
            id="sh-as"
            value={sh.as}
            onChange={(e) => setShare({ as: (e.target as HTMLSelectElement).value })}
          >
            <option value="">The sign-in screen</option>
            {users.map((u) => (
              <option key={u.id} value={u.username}>
                {u.name}
                {' · '}
                {roleName(app.def, u.role)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {(sh.short || sh.shortBusy) && (
        <Field id="sh-short" label="Short link" hint="Opens the newest version you share. Anyone with it can open the app.">
          <div className="row">
            <Input
              native
              className="input grow mono"
              id="sh-short"
              readOnly
              value={sh.shortBusy ? 'Saving the short link…' : sh.short}
              onFocus={(e) => e.target.select()}
            />
            <Btn
              className="btn icon"
              title="Copy the short link"
              aria-label="Copy the short link"
              disabled={!sh.short}
              onClick={() => copyText(sh.short || '', 'Short link')}
            >
              <Icon n="copy" />
            </Btn>
          </div>
        </Field>
      )}
      <Field
        id="sh-link"
        label={sh.short || sh.shortBusy ? 'Long link (holds the whole app, works without the server)' : 'Link'}
        error={sh.err || null}
        hint={
          sh.code
            ? fmtBytes(link.length) +
              ' · the app and ' +
              sh.rows +
              ' rows, compressed from ' +
              fmtBytes(sh.raw) +
              (sh.short || sh.shortBusy ? '' : ' · nothing is uploaded') +
              (sh.shortNote ? ' · ' + sh.shortNote : '')
            : 'Packing the app'
        }
      >
        <div className="row">
          <Input
            native
            className="input grow mono"
            id="sh-link"
            readOnly
            value={sh.busy ? 'Packing the app…' : link}
            onFocus={(e) => e.target.select()}
          />
          <Btn
            className="btn icon"
            title="Copy the link"
            aria-label="Copy the link"
            disabled={!sh.code}
            onClick={() => copyText(link, 'Link')}
          >
            <Icon n="copy" />
          </Btn>
        </div>
      </Field>
      <ul className="share-facts">
        <li>
          <Icon n="shield" s="16" />
          <span>
            Either link opens the app on its own. It is checked again, station by station, in the browser that opens it, and nothing in it
            runs as code.
          </span>
        </li>
        <li>
          <Icon n="people" s="16" />
          <span>
            Everyone who opens it works in their own copy, saved in their own browser. One database shared by everyone needs a small store
            on the server, which the free hosting plan does not keep.
          </span>
        </li>
        {framed() && (
          <li>
            <Icon n="info" s="16" />
            <span>
              Inside this prototype viewer a link cannot open a new page, so use Preview, or paste the link under Open a shared app.
            </span>
          </li>
        )}
      </ul>
    </Dialog>
  );
}
/** the dialog's props, which also hold what has been pasted so far */
interface OpenLinkProps {
  text?: string;
  err?: string;
  busy?: boolean;
}
function setOpenLink(p: OpenLinkProps, patch: Partial<OpenLinkProps>) {
  Object.assign(p, patch);
}
export function OpenLinkDialog({ p }: { p: OpenLinkProps }) {
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setOpenLink(p, { err: '', busy: true });
    notify();
    try {
      await openShared(p.text, {
        back: null,
      });
    } catch (er) {
      setOpenLink(p, { err: errText(er), busy: false });
      notify();
    }
  };
  return (
    <Dialog title="Open a shared app" onClose={closeDialog}>
      <form className="col gap12" onSubmit={go}>
        <p className="muted">Paste a Turnkey app link. The app opens on its own, with its own copy of the data in this browser.</p>
        <Field id="ol-text" label="Link" error={p.err || null}>
          <Textarea
            native
            className="textarea mono"
            id="ol-text"
            rows={4}
            data-autofocus
            placeholder="https://…#app=1.xxxxx"
            value={p.text || ''}
            onInput={(e) => {
              setOpenLink(p, { text: (e.target as HTMLTextAreaElement).value });
            }}
          />
        </Field>
        <div className="row end">
          <Btn type="button" className="btn" onClick={closeDialog}>
            Cancel
          </Btn>
          <Btn type="submit" className="btn primary" disabled={!!p.busy}>
            {p.busy ? <Spinner /> : <Icon n="open" s="16" />}Open the app
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
export function AboutAppDialog({ p }: { p: { app: string } }) {
  const app = S.apps[p.app];
  if (!app) return null;
  const def = app.def,
    st = testStats(app),
    rel = relOf(app),
    notes = app.shared ? arr<string>(app.shared.notes) : rel ? rel.notes : [];
  return (
    <Dialog
      title={'About ' + app.name}
      onClose={closeDialog}
      foot={
        <Btn className="btn primary" data-autofocus onClick={closeDialog}>
          Close
        </Btn>
      }
    >
      <div className="install-app">
        <AppLogo app={app} size={48} />
        <div className="col gap0">
          <strong className="t-sub2">{app.name}</strong>
          <span className="muted t-cap" id="about-ver">
            {verText(app)}
            {app.installed ? ' · installed' : ''}
          </span>
        </div>
      </div>
      <p>{def.brief ? def.brief.summary : app.request}</p>
      {notes.length > 0 && (
        <div className="col gap4">
          <strong>What is new in this version</strong>
          <ul className="rel-notes">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="about-dl">
        <dt>Built with</dt>
        <dd>
          Turnkey. Agents wrote this app as definitions: a brief, tables, rules, views, pages and test cases. A fixed runtime runs them.
        </dd>
        <dt>Inside</dt>
        <dd>
          {def.tables.length}
          {' tables · '}
          {def.process ? deriveEndpoints(def as BriefedDef).length : 0}
          {' endpoints · '}
          {def.screens.length}
          {' pages'}
          {st ? ' · ' + st.passed + ' of ' + st.total + ' tests pass' : ''}
        </dd>
        <dt>Your data</dt>
        <dd>
          {app.shared
            ? 'A copy that lives in this browser. Nothing you enter is sent anywhere, and nobody else sees it.'
            : 'Stored in this browser, in a SQLite file.'}
        </dd>
        <dt>People</dt>
        <dd>
          {appUsers(app)
            .map((u) => u.name + ' (' + roleName(def, u.role) + ')')
            .join(', ')}
          . Every password is demo. The data is made up.
        </dd>
        {app.shared && app.shared.by ? (
          <>
            <dt>Shared by</dt>
            <dd>{app.shared.by}</dd>
          </>
        ) : null}
      </dl>
    </Dialog>
  );
}

/* ---------- the app-only view ---------- */
export function SoloShell() {
  const so = U.solo as SoloView, // the shell draws this only while an app is open on its own
    app = S.apps[so.app],
    shared = app.shared,
    signed = !!(S.session && me()),
    up = shared && shared.updated && !shared.updated.seen ? shared.updated : null;
  useEffect(() => {
    setIdentity(app);
    // the browser installs whatever manifest the page links: while the app is open alone, that is the app's own
    const stop = holdInstallLinks(document, appInstallLinks(installInputOf(app)), app.name);
    return () => {
      stop();
      clearIdentity();
      setInstallLinks(document, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs again when the app's id, name or version changes, not on every store update
  }, [app.id, app.name, app.rev]);
  useEffect(() => {
    // the browser reports an install it made while this app was open alone: mark the app
    const since = Date.now();
    return onInstallPrompt(() => {
      if (lastInstalledAt() >= since && !app.installed) {
        app.installed = lastInstalledAt();
        commit();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener per app, not one per store update
  }, [app.id]);
  const reset = async () => {
    if (
      await confirmBox({
        title: 'Reset the data in ' + app.name + '?',
        body: 'Every table is emptied and the rows the app started with are put back.',
        yes: 'Reset data',
      })
    )
      resetAppData(app);
  };
  const extra = [
    {
      label: app.installed ? 'Installed on this device' : 'Install this app',
      icon: 'install',
      on: () =>
        openDialog('installapp', {
          app: app.id,
        }),
    },
    {
      label: 'About this app',
      icon: 'info',
      on: () =>
        openDialog('aboutapp', {
          app: app.id,
        }),
    },
    {
      label: 'Reset the data',
      icon: 'reset',
      on: reset,
    },
    signed && app.shared && !app.shared.preview
      ? {
          label: 'Save a copy to my library',
          icon: 'save',
          on: () => keepShared(app),
        }
      : null,
    '-',
    {
      label: so.from === 'preview' ? 'Back to sharing' : signed ? 'Back to Turnkey' : 'Open Turnkey',
      icon: 'arrowLeft',
      on: exitSolo,
    },
  ].filter(Boolean);
  return (
    <div className="solo" data-solo={so.from}>
      {so.from === 'preview' && (
        <div className="solo-note" role="status">
          <Icon n="eye" s="16" />
          <span className="grow">Preview: this is all that someone with the link sees.</span>
          <Btn className="btn sm" onClick={exitSolo}>
            Close preview
          </Btn>
        </div>
      )}
      {up && (
        <div className="solo-note ok" role="status">
          <Icon n="sync" s="16" />
          <span className="grow">
            <strong>
              {'Updated to version '}
              {shared?.ver}
            </strong>
            {' from '}
            {up.from}
            {'. '}
            {up.kept == null
              ? 'Your earlier records could not be carried over, so it starts with sample data.'
              : 'Your ' + up.kept + ' records were kept.'}
            {shared?.notes.length ? ' New: ' + shared.notes.slice(0, 2).join(' · ') : ''}
          </span>
          <Btn
            className="btn sm"
            onClick={() => {
              up.seen = true;
              commit();
            }}
          >
            OK
          </Btn>
        </div>
      )}
      {so.from === 'link' && !app.installed && !so.noInstall && (
        <div className="solo-note install" role="status">
          <AppLogo app={app} size={24} />
          <span className="grow">
            {'Install '}
            <strong>{app.name}</strong>
            {' to open it from your desktop or home screen, under its own icon.'}
          </span>
          <Btn
            className="btn sm primary"
            id="solo-install"
            onClick={() =>
              openDialog('installapp', {
                app: app.id,
              })
            }
          >
            Install
          </Btn>
          <Btn
            className="btn subtle icon sm"
            aria-label="Not now"
            onClick={() => {
              so.noInstall = true;
              notify();
            }}
          >
            <Icon n="dismiss" s="16" />
          </Btn>
        </div>
      )}
      <AppPane app={app} pane={so.pane} solo={extra} />
    </div>
  );
}
