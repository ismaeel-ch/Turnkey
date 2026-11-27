import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMATS,
  adminRoles,
  canOpenSettings,
  colFmt,
  defaultView,
  fmtOf,
  formatSample,
  homeScreen,
  makeFmt,
  normSettings,
  settingsOf,
  viewChoices,
} from '@/workspace/app-settings';
import { fmtDate, fmtNum } from '@/workspace/core';
import type { AppDef, AppTable, Permission } from '@/shared/types/app';

/* A made-up purchasing app: staff raise requests, a budget holder approves, a buyer orders. */
const perm = (list: Permission['list'], create: boolean, update: Permission['update'], del = false): Permission => ({
  list,
  create,
  update,
  delete: del,
});
const requests: AppTable = {
  name: 'requests',
  label: 'Requests',
  one: 'Request',
  title: 'item',
  owner: null,
  columns: [
    { name: 'item', label: 'Item', type: 'text', required: true },
    { name: 'amount', label: 'Amount', type: 'money' },
    { name: 'needed_by', label: 'Needed by', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: ['new', 'approved', 'ordered'] },
  ],
};
const def = (): AppDef => ({
  brief: {
    name: 'BuyRight',
    summary: '',
    roles: [
      { id: 'requester', name: 'Staff member', can: 'Raises requests and follows their own' },
      { id: 'approver', name: 'Budget holder', can: 'Approves or rejects requests and keeps the budgets' },
      { id: 'buyer', name: 'Buyer', can: 'Places orders and keeps the supplier list' },
    ],
    entities: [],
    process: { entity: 'requests', states: ['new', 'approved', 'ordered'], note: '' },
    stories: [],
    rules: [],
    question: null,
    decision: null,
    sources: [],
  },
  tables: [requests],
  users: [
    { name: 'Mariam Javed', role: 'requester', username: 'mariam', password: 'demo' },
    { name: 'Nida Hamid', role: 'approver', username: 'nida', password: 'demo' },
    { name: 'Junaid Akhtar', role: 'buyer', username: 'junaid', password: 'demo' },
  ],
  process: null,
  access: {
    requests: { requester: perm('own', true, 'none'), approver: perm('all', false, 'all'), buyer: perm('all', true, 'all', true) },
  },
  team: null,
  views: {},
  dash: null,
  screens: [
    { id: 's1', name: 'Overview', type: 'dashboard', table: '', roles: ['requester', 'approver', 'buyer'], columns: [] },
    { id: 's2', name: 'Requests', type: 'table', table: 'requests', roles: ['requester', 'approver', 'buyer'], columns: ['item'] },
    { id: 's3', name: 'To order', type: 'board', table: 'requests', roles: ['buyer'], columns: [] },
  ],
  theme: { accent: 'blue', nav: 'side', icon: 'cart' },
  tour: [],
  actions: [],
  migrations: [],
});

describe('who may open Settings', () => {
  it('is, until someone chooses, the kind of person whose job says they run things', () => {
    // the buyer may do more across the lists, but the budget holder approves
    expect(adminRoles(def())).toEqual(['approver']);
    expect(canOpenSettings(def(), 'approver')).toBe(true);
    expect(canOpenSettings(def(), 'buyer')).toBe(false);
  });
  it('falls back to whoever may do the most when no job says so', () => {
    const d = def();
    d.brief!.roles.forEach((r) => (r.can = ''));
    // the id "approver" would still say so: call that kind of person something plain
    d.brief!.roles[1].id = 'holder';
    d.users[1].role = 'holder';
    d.access.requests.holder = d.access.requests.approver;
    expect(adminRoles(d)).toEqual(['buyer']);
  });
  it('follows the choice made in Settings, and ignores a role the app no longer has', () => {
    const d = def();
    d.settings = normSettings({ admins: ['buyer', 'ghost', 'buyer'] }, d);
    expect(d.settings.admins).toEqual(['buyer']);
    expect(adminRoles(d)).toEqual(['buyer']);
  });
  it('an app with one kind of person lets that person in', () => {
    const d = def();
    d.brief!.roles = [d.brief!.roles[0]];
    expect(adminRoles(d)).toEqual(['requester']);
  });
});

describe('settings from outside', () => {
  it('keep only what fits the app', () => {
    const d = def();
    const s = normSettings(
      {
        formats: { currency: 'PKR', numbers: 'dot', dates: 'nonsense', clock: '12', weekStart: 'sun', extra: '<script>' },
        home: { buyer: 's3', requester: 's3', ghost: 's1' },
        views: { s2: 'board', s3: 'board', s1: 'table', nope: 'table' },
        admins: 'approver',
      },
      d,
    );
    expect(s.formats).toEqual({ currency: 'PKR', numbers: 'dot', dates: 'words', clock: '12', weekStart: 'sun' });
    // a requester cannot open "To order", so it cannot be where they land
    expect(s.home).toEqual({ buyer: 's3' });
    // a view the page already opens in is not a choice, and a dashboard has no views
    expect(s.views).toEqual({ s2: 'board' });
    expect(s.admins).toEqual([]);
  });
  it('are the usual ones when nothing or rubbish comes in', () => {
    for (const junk of [null, undefined, 'x', 7, [], { formats: 3, home: [], views: 'a' }])
      expect(normSettings(junk, def())).toEqual({ formats: DEFAULT_FORMATS, home: {}, views: {}, admins: [] });
  });
});

describe('first page and first view', () => {
  it('a person lands on the chosen page, or on their first when the choice is gone', () => {
    const d = def(),
      buyer = d.screens.filter((s) => s.roles.includes('buyer'));
    expect(homeScreen(d, 'buyer', buyer)?.id).toBe('s1');
    d.settings = normSettings({ home: { buyer: 's3' } }, d);
    expect(homeScreen(d, 'buyer', buyer)?.id).toBe('s3');
    expect(homeScreen(d, 'buyer', buyer.slice(0, 2))?.id).toBe('s1');
    expect(homeScreen(d, 'buyer', [])).toBeUndefined();
  });
  it('a list opens in the chosen view', () => {
    const d = def();
    expect(viewChoices(d, d.screens[1])).toContain('board');
    expect(viewChoices(d, d.screens[0])).toEqual([]);
    expect(defaultView(d, d.screens[1])).toBe('table');
    d.settings = normSettings({ views: { s2: 'board' } }, d);
    expect(defaultView(d, d.screens[1])).toBe('board');
  });
});

describe('formats', () => {
  it('change nothing until something is set', () => {
    const d = def(),
      F = fmtOf(d);
    expect(settingsOf(d).formats).toEqual(DEFAULT_FORMATS);
    expect(F.num(1234.5)).toBe(fmtNum(1234.5));
    expect(F.money(1234.5)).toBe('1,234.5');
    expect(F.date('2026-03-04')).toBe(fmtDate('2026-03-04'));
    expect(F.dateTime('2026-03-04T09:05')).toBe(fmtDate('2026-03-04') + ', 09:05');
    expect(F.weekStart).toBe(1);
    // and the defaults written out behave the same
    const G = makeFmt(DEFAULT_FORMATS);
    expect([G.num(1234.5), G.money(1234.5), G.date('2026-03-04'), G.time('2026-03-04T09:05')]).toEqual([
      '1,234.5',
      '1,234.5',
      fmtDate('2026-03-04'),
      '09:05',
    ]);
  });
  it('write money with the currency sign', () => {
    const F = (currency: string) => makeFmt({ ...DEFAULT_FORMATS, currency });
    expect(F('USD').money(1234.5)).toBe('$1,234.50');
    expect(F('USD').money(1200)).toBe('$1,200');
    expect(F('USD').money(-40)).toBe('-$40');
    expect(F('PKR').money(5000)).toBe('Rs 5,000');
    expect(F('JPY').money(1234.5)).toBe('¥1,234.5');
    expect(F('EUR').money('')).toBe('');
    expect(F('EUR').money('abc')).toBe('');
    expect(F('EUR').num(1234.5)).toBe('1,234.5');
    expect(F('EUR').sign).toBe('€');
  });
  it('swap the thousands and decimal marks', () => {
    expect(makeFmt({ ...DEFAULT_FORMATS, numbers: 'dot', currency: 'EUR' }).money(1234567.5)).toBe('€1.234.567,50');
    expect(makeFmt({ ...DEFAULT_FORMATS, numbers: 'space' }).num(1234567.25)).toBe('1 234 567,25');
  });
  it('write dates and times the chosen way', () => {
    const at = '2026-03-04T14:05';
    expect(makeFmt({ ...DEFAULT_FORMATS, dates: 'dmy' }).date(at)).toBe('04/03/2026');
    expect(makeFmt({ ...DEFAULT_FORMATS, dates: 'mdy' }).date(at)).toBe('03/04/2026');
    expect(makeFmt({ ...DEFAULT_FORMATS, dates: 'iso' }).dateTime(at)).toBe('2026-03-04, 14:05');
    expect(makeFmt({ ...DEFAULT_FORMATS, dates: 'iso', clock: '12' }).dateTime(at)).toBe('2026-03-04, 2:05 PM');
    expect(makeFmt({ ...DEFAULT_FORMATS, clock: '12' }).time('2026-03-04T00:30')).toBe('12:30 AM');
    expect(makeFmt({ ...DEFAULT_FORMATS, dates: 'dmy' }).date('not a date')).toBe('not a date');
    expect(makeFmt({ ...DEFAULT_FORMATS, weekStart: 'sun' }).weekStart).toBe(0);
  });
  it('totals follow their column: money gets the sign, a plain number does not', () => {
    const d = def();
    d.settings = normSettings({ formats: { currency: 'GBP' } }, d);
    expect(colFmt(d, requests.columns[1])(99)).toBe('£99');
    expect(colFmt(d, { type: 'number' })(99)).toBe('99');
    expect(colFmt(d, null)(99)).toBe('99');
    // one formatter per settings object, so a redraw does not build it again
    expect(fmtOf(d)).toBe(fmtOf(d));
  });
  it('the sample line writes the day out even when dates are in words', () => {
    const now = new Date(2026, 10, 27);
    expect(formatSample(DEFAULT_FORMATS, now)).toBe('12,345.5 · 0.25 · Fri 27 Nov, 14:05');
    expect(formatSample({ currency: 'PKR', numbers: 'dot', dates: 'dmy', clock: '12', weekStart: 'mon' }, now)).toBe(
      'Rs 12.345,50 · 0,25 · 27/11/2026, 2:05 PM',
    );
  });
});
