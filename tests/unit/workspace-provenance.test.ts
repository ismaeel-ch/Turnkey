import { describe, expect, it } from 'vitest';
import type { AppDef } from '@/shared/types/app';
import type { AppRecord } from '@/shared/types/workspace';
import { latestTouchOfTable, recordTouches, snapshotDef, touchShort, touchText } from '@/workspace/provenance';

const def = (): AppDef =>
  ({
    brief: null,
    tables: [
      {
        name: 'patients',
        label: 'Patients',
        one: 'patient',
        columns: [{ name: 'full_name', label: 'Full name', type: 'text', required: true }],
      },
    ],
    users: [],
    process: null,
    access: { patients: { doctor: { list: 'all' } } },
    team: null,
    views: {},
    dash: null,
    screens: [{ id: 's1', name: 'Patients', type: 'table', table: 'patients', roles: ['doctor'], columns: ['full_name'] }],
    theme: { accent: 'teal' },
    tour: [],
    actions: [],
    migrations: [],
  }) as unknown as AppDef;

const app = (): AppRecord => ({ id: 'a1', def: def() }) as unknown as AppRecord;

describe('provenance', () => {
  it('records the maker of every new item, and leaves unchanged items alone on a later change', () => {
    const a = app(),
      empty = snapshotDef(null);
    recordTouches(a, empty, 'database', 'build', 1);
    expect(a.touched?.['table:patients']).toMatchObject({ by: 'database', via: 'build', run: 1 });
    expect(a.touched?.['col:patients.full_name']?.by).toBe('database');
    expect(a.touched?.['screen:s1']?.by).toBe('database');

    const before = snapshotDef(a.def);
    a.def.tables[0].columns.push({ name: 'phone', label: 'Phone', type: 'text', by: 'database', run: 2 } as never);
    recordTouches(a, before, 'database', 'change', 2, 'Add Phone');
    expect(a.touched?.['col:patients.phone']).toMatchObject({ by: 'database', via: 'change', what: 'Add Phone' });
    expect(a.touched?.['col:patients.full_name']?.via).toBe('build');
    expect(touchText(a.touched?.['col:patients.phone'] ?? null)).toBe('Changed by the List builder at your request');
    expect(touchShort(a.touched?.['col:patients.phone'] ?? null)).toBe('List builder, your request');
  });

  it('ignores by and run, and forgets items that are gone', () => {
    const a = app();
    recordTouches(a, {}, 'ui', 'build', 1);
    const before = snapshotDef(a.def);
    (a.def.tables[0] as { run?: number }).run = 9;
    recordTouches(a, before, 'backend', 'change', 3);
    expect(a.touched?.['table:patients']?.by).toBe('ui');
    const b2 = snapshotDef(a.def);
    a.def.screens = [];
    recordTouches(a, b2, 'ui', 'rerun', 4);
    expect(a.touched?.['screen:s1']).toBeUndefined();
  });

  it('finds the newest record among a table and its parts, and has words for the rules and a re-run', () => {
    const a = app();
    a.touched = {
      'table:patients': { by: 'database', via: 'build', at: 1 },
      'col:patients.full_name': { by: 'database', via: 'change', at: 5 },
      'access:patients': { by: 'backend', via: 'build', at: 3 },
    };
    expect(latestTouchOfTable(a, 'patients')?.at).toBe(5);
    expect(touchText({ by: 'rules', via: 'rerun', at: 1 })).toBe('Made again by the built-in rules in a re-run');
    expect(touchText(null, 'fallback')).toBe('fallback');
  });
});
