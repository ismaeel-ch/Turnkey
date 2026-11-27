import { useSyncExternalStore } from 'react';
import { downloadFile } from '@/platform/files';
import type {
  Account,
  ApiLogRecord,
  ModelCallRecord,
  SqlLogRecord,
  AppRecord,
  Dialog,
  Dict,
  LoggedEvent,
  State,
  Tab,
  Toast,
  ToastTone,
  ToolCallRecord,
  ToolContext,
  ViewState,
} from '@/shared/types/workspace';

export const BRAND = {
  name: 'Turnkey',
  ns: 'formwork:v1:',
};
export const CAP = 40; // model calls allowed per session in Live mode (protects the spend cap)

/* ---------- small helpers ---------- */
export const uid = (p?: string) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 8) + (Date.now() % 46656).toString(36);
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const cx = (...a: unknown[]) => a.filter(Boolean).join(' ');
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export const label = (s: unknown) =>
  cap(
    String(s == null ? '' : s)
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
export const snake = (s: unknown) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'n$1')
    .slice(0, 32);
export const singular = (s: string) => (/(ss|us|is)$/i.test(s) ? s : s.replace(/ies$/i, 'y').replace(/s$/i, ''));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers pass model output of any shape; the element type is theirs to narrow
export const arr = <T = any>(x: unknown): T[] => (Array.isArray(x) ? x : []);
export const str = (x: unknown) => (x == null ? '' : String(x).trim());
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const isoDate = (d: Date) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
export const dayOffset = (n: number) => {
  const d = today();
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
export const nowStamp = () => {
  const d = new Date();
  return isoDate(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};
export const parseISO = (s: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
};
export const dayDiff = (s: string | null | undefined) => {
  const d = parseISO(s);
  return d ? Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today().getTime()) / 864e5) : null;
};
export const fmtDate = (s: string | null | undefined) => {
  const d = parseISO(s);
  if (!d) return s || '';
  const n = dayDiff(s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return (
    DOW[d.getDay()] +
    ' ' +
    d.getDate() +
    ' ' +
    MON[d.getMonth()] +
    (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '')
  );
};
export const fmtTime = (s: string | null | undefined) => {
  const d = parseISO(s);
  return d ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '';
};
export const fmtDateTime = (s: string | null | undefined) => (s ? fmtDate(s) + ', ' + fmtTime(s) : '');
export const fmtClock = (ts: number) => {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
};
export const fmtMs = (ms: number) =>
  ms < 1 ? ms.toFixed(2) + ' ms' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
export const fmtBytes = (n: number) =>
  n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
export const fmtNum = (n: unknown) =>
  n == null || n === '' || isNaN(Number(n))
    ? ''
    : Number(n).toLocaleString('en-US', {
        maximumFractionDigits: 2,
      });
export const ago = (ts: number) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return Math.floor(s) + ' s ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
};
export const initials = (name: string | null | undefined) => {
  const p = String(name || '?')
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .trim()
    .split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
export const brief = (v: unknown, n?: number) => {
  let s: string | undefined;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  s = s == null ? '' : s;
  return s.length > (n || 600) ? s.slice(0, n || 600) + ' …' : s;
};
export function hashStr(str: string) {
  let h1 = 0xdeadbeef ^ 7,
    h2 = 0x41c6ce57 ^ 7;
  str = 'fw|' + str;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- returns model output; callers check the fields they read
export function parseJSONLoose(text: unknown): any {
  if (!text) return null;
  const s = String(text).replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'),
    b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}
export const ACC_PICK = ['teal', 'purple', 'pumpkin', 'royalBlue', 'forest', 'cranberry', 'steel', 'magenta', 'lavender', 'navy'];
export const accFor = (key: unknown) => ACC_PICK[Math.abs(parseInt(hashStr(String(key)).slice(-4), 36)) % ACC_PICK.length];

/* ---------- browser storage (the product keeps everything in the visitor's browser) ---------- */
/** The message of a thrown value, whatever was thrown. */
export const errText = (e: unknown) => String((e as { message?: unknown } | null | undefined)?.message || e);
export const MEM: Dict<string> = {};
/** Tells src/workspace/errors.ts about a save that failed (or works again) on the plain localStorage path. */
function storageEvent(kind: string, why = '') {
  try {
    window.dispatchEvent(new CustomEvent('turnkey:storage-problem', { detail: { kind, why } }));
  } catch {
    // no window (tests in Node)
  }
}
export const LS = {
  ok: true,
  why: '',
  full: false,
  probe() {
    try {
      const k = BRAND.ns + '__probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      this.ok = true;
    } catch (e) {
      this.ok = false;
      this.why = errText(e);
    }
    return this.ok;
  },
  get(k: string): string | null {
    if (!this.ok) return MEM[k] != null ? MEM[k] : null;
    try {
      return localStorage.getItem(BRAND.ns + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    if (!this.ok) {
      MEM[k] = v;
      return true;
    }
    try {
      localStorage.setItem(BRAND.ns + k, v);
      if (this.full) storageEvent('ok');
      this.full = false;
      return true;
    } catch (e) {
      this.full = true;
      this.why = errText(e);
      storageEvent('quota', this.why); // errors.ts shows it; an event, so core.ts does not import errors.ts
      return false;
    }
  },
  del(k: string) {
    delete MEM[k];
    if (!this.ok) return;
    try {
      localStorage.removeItem(BRAND.ns + k);
    } catch {}
  },
  keys() {
    if (!this.ok) return Object.keys(MEM);
    const out: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(BRAND.ns) === 0) out.push(k.slice(BRAND.ns.length));
      }
    } catch {}
    return out.sort();
  },
  size(k: string) {
    const v = this.get(k);
    return v ? v.length + k.length + BRAND.ns.length : 0;
  },
};
/**
 * Puts another storage under `LS`: anything with its surface (`ok`, `why`, `full` and the methods), such as the
 * IndexedDB adapter's `lsCompat()`. Property descriptors are copied so the adapter's live `ok`, `why` and `full`
 * getters stay live. Call it before `boot()`.
 */
export function attachStorage(s: Partial<typeof LS>) {
  Object.defineProperties(LS, Object.getOwnPropertyDescriptors(s));
}

/* ---------- persisted state (S) and view state (U) ---------- */
export function freshState(): State {
  return {
    v: 1,
    onboarded: false,
    accounts: [],
    session: null,
    settings: {
      theme: 'system',
      demo: true,
      debug: false,
      speed: 'normal',
      offline: false,
      installed: false,
      tier: 'default',
      chat: true,
      tourDone: false,
      keys: true,
      buildDetail: false,
    },
    apps: {},
    shared: {},
    flows: {},
    tabs: {},
    active: {},
    prefs: {},
    conns: {
      wikipedia: true,
      mslearn: true,
      worldbank: false,
      openalex: false,
      arxiv: false,
    },
    custom: [],
  };
}
export let S: State = freshState();
export const setS = (v: State) => {
  S = v;
};
export function freshView(): ViewState {
  /* rel: release form per app, detail: last Details tab per app */
  return {
    boot: 'loading',
    bootErr: '',
    toasts: [],
    dialog: null,
    tour: null,
    view: {},
    bview: {},
    sel: {},
    itab: {},
    runSel: {},
    follow: {},
    stage: {},
    data: {},
    api: {},
    conn: null,
    dbg: {
      tab: 'events',
      q: '',
      max: false,
      all: false,
    },
    live: 'unknown',
    dl: null,
    calls: 0,
    savedAt: 0,
    home: {
      text: '',
      note: '',
    },
    handoff: {},
    chatDraft: {},
    stream: {},
    showSql: {},
    busy: null,
    connOut: null,
    ob: null,
    si: null,
    tv: {},
    flowPos: {},
    flowN: 0,
    flowMap: null,
    solo: null,
    sheet: null,
    told: {},
    noteDraft: {},
    rel: {},
    detail: {},
  };
}
export let U: ViewState = freshView();
export const setU = (v: ViewState) => {
  U = v;
};
export function loadState() {
  const raw = LS.get('state');
  if (!raw) return false;
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 1) return false;
    const f = freshState();
    S = Object.assign(f, o);
    S.settings = Object.assign(freshState().settings, o.settings || {});
    S.conns = Object.assign(freshState().conns, o.conns || {});
    return true;
  } catch {
    return false;
  }
}
export let saveTimer: ReturnType<typeof setTimeout> | null = null;
export const setSaveTimer = (v: ReturnType<typeof setTimeout> | null) => {
  saveTimer = v;
};
export function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (LS.set('state', JSON.stringify(S))) U.savedAt = Date.now();
}
export function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 300);
}
/* The store: S and U are plain objects that actions change in place, then call notify() (or commit(), which also saves).
   React reads them through useStore(), which re-renders on the next microtask after any number of changes. */
const subs = new Set<() => void>();
let version = 0;
let notifyQueued = false;
export function subscribe(listener: () => void) {
  subs.add(listener);
  return () => {
    subs.delete(listener);
  };
}
/** Goes up by one each time the store tells React it changed. */
export const storeVersion = () => version;
export function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  Promise.resolve().then(() => {
    notifyQueued = false;
    version++;
    subs.forEach((f) => f());
  });
}
export function commit() {
  saveSoon();
  notify();
}
/** Re-render this component whenever the store changes. Returns the store version. */
export function useStore() {
  return useSyncExternalStore(subscribe, storeVersion, storeVersion);
}

/* ---------- AG-UI event log and telemetry (Debug mode reads these) ---------- */
export const EV: LoggedEvent[] = [];
let evSeq = 0,
  toolSeq = 0;
export const TOOLCALLS: ToolCallRecord[] = [],
  MODELCALLS: ModelCallRecord[] = [],
  SQLLOG: SqlLogRecord[] = [],
  APILOG: ApiLogRecord[] = [];
export function ring<T>(a: T[], item: T, max: number) {
  a.push(item);
  if (a.length > max) a.splice(0, Math.ceil(max / 3));
}
export function emit(type: string, d?: Dict<unknown>): LoggedEvent {
  const e: LoggedEvent = Object.assign(
    {
      seq: ++evSeq,
      t: Date.now(),
      type,
    },
    d || {},
  );
  ring(EV, e, 900);
  notify();
  return e;
}
/** What a tool call returns: the tool's result, or the error it threw. */
export type ToolOutcome<R> = { ok: true; result: R } | { ok: false; result: { error: string } };
export function toolCall<R>(ctx: ToolContext, name: string, args: unknown, fn: () => R, kind?: string): ToolOutcome<R> {
  const id = 'call_' + ++toolSeq;
  const t0 = performance.now();
  let result: R | { error: string },
    ok = true;
  emit('TOOL_CALL_START', {
    toolCallId: id,
    toolCallName: name,
    agent: ctx.agent,
    runId: ctx.runId,
    app: ctx.appId,
  });
  emit('TOOL_CALL_ARGS', {
    toolCallId: id,
    delta: brief(args, 400),
    agent: ctx.agent,
    app: ctx.appId,
  });
  try {
    result = fn();
  } catch (e) {
    ok = false;
    result = {
      error: errText(e),
    };
  }
  emit('TOOL_CALL_END', {
    toolCallId: id,
    agent: ctx.agent,
    app: ctx.appId,
  });
  emit('TOOL_CALL_RESULT', {
    toolCallId: id,
    content: brief(result, 400),
    agent: ctx.agent,
    app: ctx.appId,
  });
  ring(
    TOOLCALLS,
    {
      id,
      t: Date.now(),
      agent: ctx.agent,
      tool: name,
      kind: kind || 'backend',
      args,
      result,
      ok,
      ms: performance.now() - t0,
      app: ctx.appId,
      run: ctx.runId,
    },
    400,
  );
  return {
    ok,
    result,
  } as ToolOutcome<R>;
}

/* ---------- toasts, dialogs, network, clipboard, files ---------- */
export function toast(text: string, tone?: ToastTone, ms?: number) {
  const t: Toast = {
    id: uid('t'),
    text,
    tone: tone || 'info',
  };
  U.toasts.push(t);
  if (U.toasts.length > 4) U.toasts.shift();
  notify();
  setTimeout(() => {
    U.toasts = U.toasts.filter((x) => x !== t);
    notify();
  }, ms || 4500);
}
export function openDialog(type: string, props?: Dialog['props']) {
  U.dialog = {
    type,
    props: props || {},
  };
  notify();
}
export function closeDialog() {
  U.dialog = null;
  notify();
}
export function confirmBox(o: Dict<unknown>) {
  return new Promise<unknown>((res) => {
    U.dialog = {
      type: 'confirm',
      props: Object.assign({}, o, {
        done: (v: unknown) => {
          U.dialog = null;
          notify();
          res(v);
        },
      }),
    };
    notify();
  });
}
export const deviceOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false; // what the browser reports about this device's connection
/* A browser can report "online" on a network that reaches nothing (a captive portal, a dead router). So the page also asks its own server
   route whether it can be reached: at start, whenever the browser reports the connection came back, and when the page is shown again.
   While the route cannot be reached the page counts as offline, and it asks again every 20 seconds until it can. */
let reachable = true;
let reachTimer: ReturnType<typeof setTimeout> | null = null;
let reachBusy = false;
export const serverReachable = () => reachable;
export async function checkReach(): Promise<boolean> {
  if (typeof fetch === 'undefined' || !deviceOnline() || reachBusy) return reachable;
  reachBusy = true;
  if (reachTimer) clearTimeout(reachTimer);
  reachTimer = null;
  let ok = true;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      await fetch('/api/health', { cache: 'no-store', signal: ctl.signal }); // any answer, even a refusal, means the server was reached
    } finally {
      clearTimeout(t);
    }
  } catch {
    ok = deviceOnline() ? false : reachable; // a failure because the device itself went offline is reported by the browser instead
  }
  reachBusy = false;
  if (ok !== reachable) {
    reachable = ok;
    netChanged();
  }
  if (!reachable) reachTimer = setTimeout(() => void checkReach(), 20000);
  return reachable;
}
export const online = () => deviceOnline() && reachable && !S.settings.offline; // the connection, or the offline test switch standing in for a lost one
export function needNet(what: string) {
  if (online()) return true;
  toast('You are offline. ' + what + ' needs internet.', 'warning');
  return false;
}
/* Live follows the internet connection and nothing else. It is on when this device is connected (unless Demo was chosen), it pauses by itself
   when the connection goes, and it comes back by itself when the connection does. Where the page runs plays no part. Whether a model can be
   reached from this copy of the page is a separate fact (U.live); when none can, saved builds and built-in changes stand in and say so. */
export const NO_MODEL = 'No model is connected to this copy of Turnkey.';
export function modeNow() {
  // one answer for every badge and every decision: what the agents will do right now, and why
  if (S.settings.demo)
    return {
      id: 'demo',
      live: false,
      on: false,
      text: 'Demo',
      long: 'Demo · saved builds, no model calls',
      cls: 'b-outline',
    };
  if (!online())
    return {
      id: 'offline',
      live: false,
      on: false,
      text: 'Live paused',
      long: 'Live is paused while you are offline · saved builds still run',
      cls: 'b-warning',
    };
  if (U.live === 'unknown')
    return {
      id: 'checking',
      live: false,
      on: true,
      text: 'Live',
      long: 'Live · connecting to the model',
      cls: 'b-info',
    };
  if (U.live !== 'ready')
    return {
      id: 'nomodel',
      live: false,
      on: true,
      text: 'Live',
      long: 'Live · no model connected to this copy, saved builds stand in',
      cls: 'b-info',
    };
  return {
    id: 'live',
    live: true,
    on: true,
    text: 'Live',
    long: 'Live · ' + (CAP - U.calls) + ' model calls left this session',
    cls: 'b-info',
  };
}
export const liveModelOn = () => modeNow().live; // Live, with a model to call
interface NetworkInfo {
  effectiveType?: string;
  downlink?: number;
}
export const netInfo = () => {
  try {
    const n = navigator as Navigator & Partial<Record<'connection' | 'mozConnection' | 'webkitConnection', NetworkInfo>>;
    const c = n.connection || n.mozConnection || n.webkitConnection;
    return c && c.effectiveType ? String(c.effectiveType).toUpperCase() + (c.downlink ? ', about ' + c.downlink + ' Mbps' : '') : '';
  } catch {
    return '';
  }
};
export let netWas: boolean | null = null;
export const setNetWas = (v: boolean | null) => {
  netWas = v;
};
export function netChanged() {
  // the browser reported that the connection came or went, or the offline test switch was flipped
  const on = online();
  if (netWas !== null && on !== netWas) {
    const want = !S.settings.demo;
    emit('CUSTOM', {
      name: 'connectivity',
      value: {
        online: on,
        live: on && want,
      },
    });
    toast(
      on
        ? want
          ? 'Back online. Live is on again.'
          : 'Back online.'
        : want
          ? 'You are offline, so Live is paused. It comes back by itself when the connection does. Your apps, their data and saved builds keep working.'
          : 'You are offline. Your apps, their data and saved builds keep working.',
      on ? 'success' : 'warning',
      on ? 4500 : 7000,
    );
  }
  netWas = on;
  notify();
}
export function setOffline(v: boolean) {
  // the offline test switch
  if (!v && !deviceOnline()) {
    S.settings.offline = false;
    commit();
    return toast('This device has no connection. Live comes back when it reconnects.', 'warning');
  }
  S.settings.offline = !!v;
  commit();
  netChanged();
}
export function setLive(v: boolean) {
  // what the owner wants. Whether Live is on right now also depends on the connection.
  if (v && !online()) return toast('You are offline. Live needs internet, and switches itself on when you reconnect.', 'warning');
  S.settings.demo = !v;
  commit();
  if (!v) return toast('Demo is on. Saved builds and built-in changes, no model calls.', 'info');
  if (U.live === 'none') toast('Live is on. ' + NO_MODEL + ' Saved builds and built-in changes stand in until one is.', 'warning', 8000);
  else toast('Live is on. Your own sentence goes to the model.', 'info');
}
export function copyText(text: string, what?: string) {
  const done = () => toast((what || 'Text') + ' copied', 'success');
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) done();
      else toast('Copy was blocked. Select the text and copy it by hand.', 'warning');
    } catch {
      toast('Copy was blocked in this view.', 'warning');
    }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  } catch {
    fallback();
  }
}
export async function saveFile(filename: string, data: string | Blob | ArrayBuffer | Uint8Array, mime?: string) {
  if (U.dl) {
    try {
      await U.dl.save({
        filename,
        data,
      });
      return true;
    } catch {
      if (typeof data !== 'string') {
        try {
          await U.dl.save({
            filename,
            data: new Blob([data as BlobPart], {
              type: mime || 'application/octet-stream',
            }),
          });
          return true;
        } catch {}
      }
      toast('The download did not go through.', 'warning');
      return false;
    }
  }
  if (downloadFile(filename, data, mime)) return true;
  toast('Saving files is not available in this view. Use Copy instead.', 'warning');
  return false;
}
export const NARROW = () => window.innerWidth <= 1080;
export const PHONE = () => window.innerWidth <= 640; // one-hand layouts: bottom bars, sheets, full-screen pages
export const chatShown = () => (NARROW() ? !!U.peek : !!S.settings.chat);
export function setChat(v: boolean) {
  if (NARROW()) U.peek = v;
  else S.settings.chat = v;
  commit();
}
export function applyTheme() {
  const t = S.settings.theme;
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.setAttribute('data-app-theme', t);
  else r.removeAttribute('data-app-theme');
}

/* ---------- accounts and workspace tabs ---------- */
// Tabs are kept per account. Signed out, the key is "null", as it always was when the session id was used as a key.
const sessionKey = () => String(S.session);
export const me = (): Account | null => S.accounts.find((a) => a.id === S.session) || null;
export const myApps = (): AppRecord[] =>
  Object.values(S.apps)
    .filter((a) => a.owner === S.session)
    .sort((a, b) => b.updated - a.updated);
export function createAccount(name: string, username: string, password: string) {
  const a: Account = {
    id: uid('acc'),
    name: str(name) || 'Demo user',
    username: str(username).toLowerCase() || 'demo',
    pass: hashStr(password || 'demo'),
    created: Date.now(),
  };
  S.accounts.push(a);
  S.tabs[a.id] = [
    {
      id: uid('tab'),
      app: null,
    },
  ];
  S.active[a.id] = S.tabs[a.id][0].id;
  return a;
}
export function signIn(username: string, password: string) {
  const a = S.accounts.find((x) => x.username === str(username).toLowerCase());
  if (!a || a.pass !== hashStr(password)) return null;
  S.session = a.id;
  commit();
  return a;
}
export function signOut() {
  S.session = null;
  U.tour = null;
  commit();
}
export function tabsNow(): Tab[] {
  return (
    S.tabs[sessionKey()] ||
    (S.tabs[sessionKey()] = [
      {
        id: uid('tab'),
        app: null,
      },
    ])
  );
}
export function activeTab() {
  const tabs = tabsNow();
  return tabs.find((t) => t.id === S.active[sessionKey()]) || tabs[0];
}
export function openTab(appId?: string | null) {
  const tabs = tabsNow();
  let t = appId ? tabs.find((x) => x.app === appId) : tabs.find((x) => !x.app);
  if (!t) {
    const cur = activeTab();
    if (appId && cur && !cur.app) {
      cur.app = appId;
      t = cur;
    } else {
      t = {
        id: uid('tab'),
        app: appId || null,
      };
      tabs.push(t);
    }
  }
  S.active[sessionKey()] = t.id;
  commit();
  return t;
}
export function closeTab(id: string) {
  const tabs = tabsNow();
  const i = tabs.findIndex((x) => x.id === id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (!tabs.length)
    tabs.push({
      id: uid('tab'),
      app: null,
    });
  if (S.active[sessionKey()] === id || !tabs.some((t) => t.id === S.active[sessionKey()]))
    S.active[sessionKey()] = tabs[Math.max(0, i - 1)].id;
  commit();
}
export function selectTab(id: string) {
  S.active[sessionKey()] = id;
  commit();
}
