import { describe, expect, it } from 'vitest';
import { S, closeTab, createAccount, errText, freshState, label, openTab, setS, snake, tabsNow } from '@/workspace/core';
import { colSQL, createTableSQL, ql, qi, topoOrder } from '@/workspace/db';
import '@/workspace/saved';
import { CARDS, QUESTS, TEMPLATES, HOME_TEMPLATES, matchTemplate } from '@/workspace/catalog';
import { everyone } from '@/workspace/quests';
import { REC } from '@/workspace/registry';

describe('workspace core helpers', () => {
  it('reads the message of anything thrown', () => {
    expect(errText(new Error('boom'))).toBe('boom');
    expect(errText({ message: 'plain object' })).toBe('plain object');
    expect(errText('text')).toBe('text');
    expect(errText(null)).toBe('null');
    expect(errText(undefined)).toBe('undefined');
  });

  it('turns names into labels and snake_case', () => {
    expect(label('follow_up_on')).toBe('Follow up on');
    expect(snake(' 2nd Visit Notes ')).toBe('n2nd_visit_notes');
  });

  it('keeps tabs per account, and under "null" when signed out', () => {
    setS(freshState());
    expect(tabsNow()).toHaveLength(1);
    expect(Object.keys(S.tabs)).toEqual(['null']);
    const a = createAccount('Sam Lee', 'Sam', 'pw');
    S.session = a.id;
    const t = openTab('app_1');
    expect(tabsNow().map((x) => x.app)).toEqual(['app_1']);
    closeTab(t.id);
    expect(tabsNow().map((x) => x.app)).toEqual([null]);
  });
});

describe('workspace SQL helpers', () => {
  it('quotes names and values', () => {
    expect(qi('a"b')).toBe('"a""b"');
    expect(ql(null)).toBe('NULL');
    expect(ql(3)).toBe('3');
    expect(ql("it's")).toBe("'it''s'");
  });

  it('writes column and table SQL', () => {
    expect(colSQL({ name: 'status', type: 'select', required: true, options: ['open', 'done'] })).toBe(
      '"status" TEXT NOT NULL CHECK ("status" IN (\'open\', \'done\'))',
    );
    expect(createTableSQL({ name: 'notes', columns: [{ name: 'visit', type: 'ref', ref: 'visits' }] })).toContain(
      '"visit" INTEGER REFERENCES "visits"("id")',
    );
  });

  it('orders parent tables before the tables that point at them', () => {
    const order = topoOrder([
      { name: 'notes', columns: [{ name: 'visit', type: 'ref', ref: 'visits' }] },
      { name: 'visits', columns: [{ name: 'patient', type: 'ref', ref: 'patients' }] },
      { name: 'patients', columns: [{ name: 'name', type: 'text' }] },
    ]);
    expect(order.map((t) => t.name)).toEqual(['patients', 'visits', 'notes']);
  });
});

describe('saved builds', () => {
  it('registers every template and quest with recordings for each station', () => {
    for (const id of [...TEMPLATES, ...QUESTS]) {
      const rec = REC[id];
      expect(rec.id).toBe(id);
      for (const st of ['research', 'database', 'backend', 'views', 'ui'] as const) {
        expect(typeof rec[st]).toBe('function');
        expect(rec[st]({ answer: 0 }, 1)).toBeTypeOf('object');
      }
    }
  });

  it('lists every saved build in the catalog, with the same card fields as its recording', () => {
    const ids = [...HOME_TEMPLATES, ...QUESTS];
    expect(Object.keys(CARDS).sort()).toEqual([...ids].sort());
    expect(Object.keys(REC).sort()).toEqual([...ids].sort());
    for (const id of ids) for (const [k, v] of Object.entries(CARDS[id])) expect(REC[id][k]).toEqual(v);
  });

  it('picks a template from the words in a sentence', () => {
    expect(matchTemplate('book appointments for a dentist')).toBe('clinic');
  });

  it('gives every role read access and only writers the right to change', () => {
    const rules = everyone('claims', ['editor', 'reader'], ['editor'], 'editor');
    expect(rules).toEqual([
      { table: 'claims', role: 'editor', list: 'all', create: true, update: 'all', delete: true },
      { table: 'claims', role: 'reader', list: 'all', create: false, update: 'none', delete: false },
    ]);
  });
});
