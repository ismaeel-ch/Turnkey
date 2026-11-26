// @ts-nocheck -- converted from the prototype; types are added module by module
import { useReducer } from 'react';

export const BRAND = {
  name: 'Turnkey',
  ns: 'formwork:v1:',
};
export const CAP = 40; // model calls allowed per session in Live mode (protects the spend cap)

/* ---------- small helpers ---------- */
export const uid = (p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 8) + (Date.now() % 46656).toString(36);
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const cx = (...a) => a.filter(Boolean).join(' ');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export const label = (s) =>
  cap(
    String(s == null ? '' : s)
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
export const snake = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'n$1')
    .slice(0, 32);
export const singular = (s) => (/(ss|us|is)$/i.test(s) ? s : s.replace(/ies$/i, 'y').replace(/s$/i, ''));
export const arr = (x) => (Array.isArray(x) ? x : []);
export const str = (x) => (x == null ? '' : String(x).trim());
export const pad2 = (n) => String(n).padStart(2, '0');
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
export const isoDate = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
export const dayOffset = (n) => {
  const d = today();
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
export const nowStamp = () => {
  const d = new Date();
  return isoDate(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};
export const parseISO = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
};
export const dayDiff = (s) => {
  const d = parseISO(s);
  return d ? Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today()) / 864e5) : null;
};
export const fmtDate = (s) => {
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
export const fmtTime = (s) => {
  const d = parseISO(s);
  return d ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '';
};
export const fmtDateTime = (s) => (s ? fmtDate(s) + ', ' + fmtTime(s) : '');
export const fmtClock = (ts) => {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
};
export const fmtMs = (ms) =>
  ms < 1 ? ms.toFixed(2) + ' ms' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
export const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB');
export const fmtNum = (n) =>
  n == null || n === '' || isNaN(n)
    ? ''
    : Number(n).toLocaleString('en-US', {
        maximumFractionDigits: 2,
      });
export const ago = (ts) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return Math.floor(s) + ' s ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
};
export const initials = (name) => {
  const p = String(name || '?')
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .trim()
    .split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
export const brief = (v, n) => {
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch (e) {
    s = String(v);
  }
  s = s == null ? '' : s;
  return s.length > (n || 600) ? s.slice(0, n || 600) + ' …' : s;
};
export function hashStr(str) {
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
export function parseJSONLoose(text) {
  if (!text) return null;
  let s = String(text).replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'),
    b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    return null;
  }
}
export const ACC_PICK = ['teal', 'purple', 'pumpkin', 'royalBlue', 'forest', 'cranberry', 'steel', 'magenta', 'lavender', 'navy'];
export const accFor = (key) => ACC_PICK[Math.abs(parseInt(hashStr(String(key)).slice(-4), 36)) % ACC_PICK.length];

/* ---------- browser storage (the product keeps everything in the visitor's browser) ---------- */
export const MEM = {};
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
      this.why = String((e && e.message) || e);
    }
    return this.ok;
  },
  get(k) {
    if (!this.ok) return MEM[k] != null ? MEM[k] : null;
    try {
      return localStorage.getItem(BRAND.ns + k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    if (!this.ok) {
      MEM[k] = v;
      return true;
    }
    try {
      localStorage.setItem(BRAND.ns + k, v);
      this.full = false;
      return true;
    } catch (e) {
      this.full = true;
      this.why = String((e && e.message) || e);
      return false;
    }
  },
  del(k) {
    delete MEM[k];
    if (!this.ok) return;
    try {
      localStorage.removeItem(BRAND.ns + k);
    } catch (e) {}
  },
  keys() {
    if (!this.ok) return Object.keys(MEM);
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(BRAND.ns) === 0) out.push(k.slice(BRAND.ns.length));
      }
    } catch (e) {}
    return out.sort();
  },
  size(k) {
    const v = this.get(k);
    return v ? v.length + k.length + BRAND.ns.length : 0;
  },
};

/* ---------- persisted state (S) and view state (U) ---------- */
export function freshState() {
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
export let S = freshState();
export const setS = (v) => {
  S = v;
};
export function freshView() {
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
export let U = freshView();
export const setU = (v) => {
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
  } catch (e) {
    return false;
  }
}
export let saveTimer = null;
export const setSaveTimer = (v) => {
  saveTimer = v;
};
export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (LS.set('state', JSON.stringify(S))) U.savedAt = Date.now();
}
export function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 300);
}
export const subs = new Set();
export let notifyQueued = false;
export function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  Promise.resolve().then(() => {
    notifyQueued = false;
    subs.forEach((f) => f());
  });
}
export function commit() {
  saveSoon();
  notify();
}
export function useForce() {
  const r = useReducer((x) => x + 1, 0);
  return r[1];
}

/* ---------- AG-UI event log and telemetry (Debug mode reads these) ---------- */
export const EV = [];
export let evSeq = 0,
  toolSeq = 0,
  msgSeq = 0;
export const TOOLCALLS = [],
  MODELCALLS = [],
  SQLLOG = [],
  APILOG = [];
export function ring(a, item, max) {
  a.push(item);
  if (a.length > max) a.splice(0, Math.ceil(max / 3));
}
export function emit(type, d) {
  const e = Object.assign(
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
export function toolCall(ctx, name, args, fn, kind) {
  const id = 'call_' + ++toolSeq;
  const t0 = performance.now();
  let result,
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
      error: String((e && e.message) || e),
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
  };
}

/* ---------- toasts, dialogs, network, clipboard, files ---------- */
export function toast(text, tone, ms) {
  const t = {
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
export function openDialog(type, props) {
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
export function confirmBox(o) {
  return new Promise((res) => {
    U.dialog = {
      type: 'confirm',
      props: Object.assign({}, o, {
        done: (v) => {
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
export const online = () => deviceOnline() && !S.settings.offline; // the connection, or the offline test switch standing in for a lost one
export function needNet(what) {
  if (online()) return true;
  toast('You are offline. ' + what + ' needs internet.', 'warning');
  return false;
}
/* Live follows the internet connection and nothing else. It is on when this device is connected (unless Demo was chosen), it pauses by itself
   when the connection goes, and it comes back by itself when the connection does. Where the page runs plays no part. Whether a model can be
   reached from this copy of the page is a separate fact (U.live); when none can, saved builds and built-in changes stand in and say so. */
export const NO_MODEL = 'No model is connected to this copy of the prototype.';
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
export const liveOn = () => modeNow().on; // the Live switch as it shows: wanted, and connected
export const liveModelOn = () => modeNow().live; // Live, with a model to call
export const netInfo = () => {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return c && c.effectiveType ? String(c.effectiveType).toUpperCase() + (c.downlink ? ', about ' + c.downlink + ' Mbps' : '') : '';
  } catch (e) {
    return '';
  }
};
export let netWas = null;
export const setNetWas = (v) => {
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
export function setOffline(v) {
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
export function setLive(v) {
  // what the owner wants. Whether Live is on right now also depends on the connection.
  if (v && !online()) return toast('You are offline. Live needs internet, and switches itself on when you reconnect.', 'warning');
  S.settings.demo = !v;
  commit();
  if (!v) return toast('Demo is on. Saved builds and built-in changes, no model calls.', 'info');
  if (U.live === 'none') toast('Live is on. ' + NO_MODEL + ' Saved builds and built-in changes stand in until one is.', 'warning', 8000);
  else toast('Live is on. Your own sentence goes to the model.', 'info');
}
export function copyText(text, what) {
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
      ok ? done() : toast('Copy was blocked. Select the text and copy it by hand.', 'warning');
    } catch (e) {
      toast('Copy was blocked in this view.', 'warning');
    }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  } catch (e) {
    fallback();
  }
}
export async function saveFile(filename, data, mime) {
  if (U.dl) {
    try {
      await U.dl.save({
        filename,
        data,
      });
      return true;
    } catch (e) {
      if (typeof data !== 'string') {
        try {
          await U.dl.save({
            filename,
            data: new Blob([data], {
              type: mime || 'application/octet-stream',
            }),
          });
          return true;
        } catch (e2) {}
      }
      toast('The download did not go through.', 'warning');
      return false;
    }
  }
  toast('Saving files is not available in this view. Use Copy instead.', 'warning');
  return false;
}
export const NARROW = () => window.innerWidth <= 1080;
export const PHONE = () => window.innerWidth <= 640; // one-hand layouts: bottom bars, sheets, full-screen pages
export const chatShown = () => (NARROW() ? !!U.peek : !!S.settings.chat);
export function setChat(v) {
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
export const me = () => S.accounts.find((a) => a.id === S.session) || null;
export const myApps = () =>
  Object.values(S.apps)
    .filter((a) => a.owner === S.session)
    .sort((a, b) => b.updated - a.updated);
export function createAccount(name, username, password) {
  const a = {
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
export function signIn(username, password) {
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
export function tabsNow() {
  return (
    S.tabs[S.session] ||
    (S.tabs[S.session] = [
      {
        id: uid('tab'),
        app: null,
      },
    ])
  );
}
export function activeTab() {
  const tabs = tabsNow();
  return tabs.find((t) => t.id === S.active[S.session]) || tabs[0];
}
export function openTab(appId) {
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
  S.active[S.session] = t.id;
  commit();
  return t;
}
export function closeTab(id) {
  const tabs = tabsNow();
  const i = tabs.findIndex((x) => x.id === id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (!tabs.length)
    tabs.push({
      id: uid('tab'),
      app: null,
    });
  if (S.active[S.session] === id || !tabs.some((t) => t.id === S.active[S.session])) S.active[S.session] = tabs[Math.max(0, i - 1)].id;
  commit();
}
export function selectTab(id) {
  S.active[S.session] = id;
  commit();
}
