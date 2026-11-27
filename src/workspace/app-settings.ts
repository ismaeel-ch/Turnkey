import type { AppDef, AppFormats, AppSettings, AppTable, Screen, Untrusted } from '@/shared/types/app';
import type { Dict } from '@/shared/types/workspace';
import { DOW, MON, arr, dayDiff, fmtDate, fmtNum, fmtTime, pad2, parseISO, str } from './core';
import { DATA_VIEWS, viewFit } from './viewspec';

/* ===== Turnkey · a built app's own settings: what they are, who may change them and what they drive =====
   Every built app has a Settings page (src/workspace/app-settings-ui.tsx). What is chosen there is kept in the app's
   definition (`def.settings`), so a copy, a release and an earlier version each carry their own. This file is the
   reading side: defaults, the check of anything that comes from outside, who may open the page, and the app's way of
   writing numbers, money, dates and times. Nothing here changes an app; src/workspace/app-admin.ts does that. */

/** The id the Settings page has among an app's pages. No built page can have it: page ids are snake_case. */
export const SETTINGS_SCREEN = '~settings';

/** The currencies an app can show money in. A sign made of letters gets a space before the amount. */
export const CURRENCIES: { code: string; name: string; sign: string }[] = [
  { code: 'USD', name: 'US dollar', sign: '$' },
  { code: 'EUR', name: 'Euro', sign: '€' },
  { code: 'GBP', name: 'British pound', sign: '£' },
  { code: 'PKR', name: 'Pakistani rupee', sign: 'Rs' },
  { code: 'INR', name: 'Indian rupee', sign: '₹' },
  { code: 'AED', name: 'UAE dirham', sign: 'AED' },
  { code: 'SAR', name: 'Saudi riyal', sign: 'SAR' },
  { code: 'JPY', name: 'Japanese yen', sign: '¥' },
  { code: 'CNY', name: 'Chinese yuan', sign: 'CN¥' },
  { code: 'CAD', name: 'Canadian dollar', sign: 'CA$' },
  { code: 'AUD', name: 'Australian dollar', sign: 'A$' },
  { code: 'CHF', name: 'Swiss franc', sign: 'CHF' },
  { code: 'TRY', name: 'Turkish lira', sign: '₺' },
  { code: 'NGN', name: 'Nigerian naira', sign: '₦' },
  { code: 'ZAR', name: 'South African rand', sign: 'R' },
  { code: 'BRL', name: 'Brazilian real', sign: 'R$' },
];
export const NUMBER_STYLES: { id: AppFormats['numbers']; label: string }[] = [
  { id: 'comma', label: '1,234.5' },
  { id: 'dot', label: '1.234,5' },
  { id: 'space', label: '1 234,5' },
];
export const DATE_STYLES: { id: AppFormats['dates']; label: string }[] = [
  { id: 'words', label: 'In words (Fri 27 Nov, Today, Tomorrow)' },
  { id: 'dmy', label: 'Day first (27/11/2026)' },
  { id: 'mdy', label: 'Month first (11/27/2026)' },
  { id: 'iso', label: 'Year first (2026-11-27)' },
];

/** How an app writes things until someone changes it: exactly as every app did before there were settings. */
export const DEFAULT_FORMATS: AppFormats = { currency: '', numbers: 'comma', dates: 'words', clock: '24', weekStart: 'mon' };
const DEFAULTS: AppSettings = { formats: DEFAULT_FORMATS, home: {}, views: {}, admins: [] };

const oneOf = <T extends string>(v: unknown, all: readonly T[], or: T): T => (all.includes(v as T) ? (v as T) : or);
/** The role ids of an app: the brief's, or the ones its people have when there is no brief. */
export const roleIds = (def: Pick<AppDef, 'brief' | 'users'>): string[] =>
  def.brief && def.brief.roles.length ? def.brief.roles.map((r) => r.id) : [...new Set(def.users.map((u) => u.role))];
/** Whether a page is a list of records, so it can open in more than one view. */
export const isListPage = (scr: Pick<Screen, 'type'>) => DATA_VIEWS.includes(scr.type);
/** The views one list page can open in: the ones that fit its table. */
export function viewChoices(def: AppDef, scr: Pick<Screen, 'type' | 'table'>): string[] {
  const t = def.tables.find((x) => x.name === scr.table);
  if (!t || !isListPage(scr)) return [];
  return DATA_VIEWS.filter((v) => v === scr.type || !viewFit(def, t as AppTable, v));
}

/**
 * Settings read from anywhere outside this file (a share link, a saved app, a file): every field is checked against
 * the app it belongs to, and anything that names a role, page or view the app does not have is left out.
 */
export function normSettings(o: Untrusted, def: AppDef): AppSettings {
  const src = o && typeof o === 'object' ? o : {},
    f = src.formats && typeof src.formats === 'object' ? src.formats : {},
    roles = roleIds(def);
  const home: Dict<string> = {},
    views: Dict<string> = {};
  if (src.home && typeof src.home === 'object')
    roles.forEach((r) => {
      const id = str(src.home[r]);
      if (def.screens.some((s) => s.id === id && s.roles.includes(r))) home[r] = id;
    });
  if (src.views && typeof src.views === 'object')
    def.screens.forEach((s) => {
      const v = str(src.views[s.id]);
      if (v && v !== s.type && viewChoices(def, s).includes(v)) views[s.id] = v;
    });
  return {
    formats: {
      currency: CURRENCIES.some((c) => c.code === f.currency) ? f.currency : '',
      numbers: oneOf(f.numbers, ['comma', 'dot', 'space'] as const, 'comma'),
      dates: oneOf(f.dates, ['words', 'dmy', 'mdy', 'iso'] as const, 'words'),
      clock: oneOf(f.clock, ['24', '12'] as const, '24'),
      weekStart: oneOf(f.weekStart, ['mon', 'sun'] as const, 'mon'),
    },
    home,
    views,
    admins: [...new Set(arr<unknown>(src.admins).map(str))].filter((r) => roles.includes(r)),
  };
}
/** An app's settings, with the usual choice wherever nothing was set. */
export const settingsOf = (def: Pick<AppDef, 'settings'>): AppSettings => def.settings || DEFAULTS;

/* ---------- who may open Settings ---------- */
/** Words in a role's name, or in what it does, that say it runs things. */
const BOSS = /admin|owner|manage|director|\bhead\b|\blead|supervis|principal|boss|approv|oversee|in charge/i;
/** How much one kind of person may do across the app's lists. */
function reach(def: Pick<AppDef, 'access'>, role: string): number {
  let n = 0;
  Object.keys(def.access || {}).forEach((t) => {
    const p = (def.access[t] || {})[role];
    if (!p) return;
    n += (p.list === 'all' ? 2 : p.list === 'own' ? 1 : 0) + (p.update === 'all' ? 2 : p.update === 'own' ? 1 : 0);
    n += (p.create ? 1 : 0) + (p.delete ? 1 : 0);
  });
  return n;
}
/**
 * The kinds of person who may open Settings. Until someone chooses, it is one kind: the one whose name or job says
 * they run things (a manager, an approver, an owner), and among those, or when nobody is, the one who may do the most.
 */
export function adminRoles(def: Pick<AppDef, 'brief' | 'users' | 'access' | 'settings'>): string[] {
  const roles = roleIds(def),
    set = settingsOf(def).admins.filter((r) => roles.includes(r));
  if (set.length) return set;
  if (!roles.length) return [];
  const words = (r: string) => {
    const x = def.brief?.roles.find((y) => y.id === r);
    return r + ' ' + (x ? x.name + ' ' + x.can : '');
  };
  const top = roles
    .map((r, i) => ({ r, i, n: reach(def, r), boss: BOSS.test(words(r)) }))
    .sort((a, b) => Number(b.boss) - Number(a.boss) || b.n - a.n || a.i - b.i)[0];
  return [top.r];
}
export const canOpenSettings = (def: Pick<AppDef, 'brief' | 'users' | 'access' | 'settings'>, role: string) =>
  adminRoles(def).includes(role);

/* ---------- where a person lands, and how a list opens ---------- */
/** The page a kind of person lands on: the one chosen in Settings when they may still open it, else their first. */
export function homeScreen<S extends Pick<Screen, 'id'>>(def: Pick<AppDef, 'settings'>, role: string, screens: S[]): S | undefined {
  const id = settingsOf(def).home[role];
  return screens.find((s) => s.id === id) || screens[0];
}
/** The view a list page opens in before the person has chosen one for themselves. */
export const defaultView = (def: Pick<AppDef, 'settings'>, scr: Pick<Screen, 'id' | 'type'>): string =>
  settingsOf(def).views[scr.id] || scr.type;

/* ---------- numbers, money, dates and times, the app's way ---------- */
export interface Fmt {
  /** a number with the app's thousands and decimal marks */
  num: (v: unknown) => string;
  /** an amount of money with the app's currency sign, or as a plain number when no currency is set */
  money: (v: unknown) => string;
  date: (s: string | null | undefined) => string;
  time: (s: string | null | undefined) => string;
  dateTime: (s: string | null | undefined) => string;
  /** the first day of a week, as `Date.getDay()` counts: 1 is Monday, 0 is Sunday */
  weekStart: 0 | 1;
  /** the currency sign in use, or '' */
  sign: string;
}
const MARKS: Record<AppFormats['numbers'], [string, string]> = { comma: [',', '.'], dot: ['.', ','], space: [' ', ','] };
const BASE: Fmt = {
  num: fmtNum,
  money: fmtNum,
  date: fmtDate,
  time: fmtTime,
  dateTime: (s) => (s ? fmtDate(s) + ', ' + fmtTime(s) : ''),
  weekStart: 1,
  sign: '',
};
export function makeFmt(f: AppFormats): Fmt {
  const [group, point] = MARKS[f.numbers] || MARKS.comma;
  const marks = (text: string) => (f.numbers === 'comma' ? text : text.replace(/[,.]/g, (ch) => (ch === ',' ? group : point)));
  const num = (v: unknown) => marks(fmtNum(v));
  const cur = CURRENCIES.find((c) => c.code === f.currency);
  const money = (v: unknown) => {
    if (!cur) return num(v);
    if (v == null || v === '' || isNaN(Number(v))) return '';
    const n = Number(v),
      whole = Math.round(n * 100) % 100 === 0,
      text = marks(
        Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: whole || cur.code === 'JPY' ? 0 : 2, maximumFractionDigits: 2 }),
      );
    return (n < 0 ? '-' : '') + cur.sign + (/[A-Za-z]$/.test(cur.sign) ? ' ' : '') + text;
  };
  const date = (s: string | null | undefined) => {
    if (f.dates === 'words') return fmtDate(s);
    const d = parseISO(s);
    if (!d) return s || '';
    const dd = pad2(d.getDate()),
      mm = pad2(d.getMonth() + 1),
      y = d.getFullYear();
    return f.dates === 'dmy' ? dd + '/' + mm + '/' + y : f.dates === 'mdy' ? mm + '/' + dd + '/' + y : y + '-' + mm + '-' + dd;
  };
  const time = (s: string | null | undefined) => {
    if (f.clock !== '12') return fmtTime(s);
    const d = parseISO(s);
    if (!d) return '';
    const h = d.getHours();
    return (h % 12 || 12) + ':' + pad2(d.getMinutes()) + (h < 12 ? ' AM' : ' PM');
  };
  return {
    num,
    money,
    date,
    time,
    dateTime: (s) => (s ? date(s) + ', ' + time(s) : ''),
    weekStart: f.weekStart === 'sun' ? 0 : 1,
    sign: cur ? cur.sign : '',
  };
}
const FMTS = new WeakMap<AppFormats, Fmt>();
/** The app's way of writing numbers, money, dates and times. With nothing set it is what every app did before. */
export function fmtOf(def: Pick<AppDef, 'settings'>): Fmt {
  const f = def.settings?.formats;
  if (!f) return BASE;
  let hit = FMTS.get(f);
  if (!hit) FMTS.set(f, (hit = makeFmt(f)));
  return hit;
}
/** One line that shows the formats at work, for the Settings page. */
export function formatSample(f: AppFormats, now = new Date()): string {
  const x = makeFmt(f),
    iso = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + 'T14:05';
  // "in words" would say Today here, which shows nothing: write the day out
  const day = f.dates === 'words' ? DOW[now.getDay()] + ' ' + now.getDate() + ' ' + MON[now.getMonth()] : x.date(iso);
  return x.money(12345.5) + ' · ' + x.num(0.25) + ' · ' + day + ', ' + x.time(iso);
}
/** Whether a date is today, for callers that word it themselves. */
export const isToday = (s: string | null | undefined) => dayDiff(s) === 0;
/** How the values of one number or money field are written: totals and averages follow their column. */
export const colFmt = (def: Pick<AppDef, 'settings'>, c: { type: string } | null | undefined): ((v: unknown) => string) =>
  c && c.type === 'money' ? fmtOf(def).money : fmtOf(def).num;
