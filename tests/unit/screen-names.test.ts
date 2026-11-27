import { describe, expect, it } from 'vitest';
import { normUI } from '@/workspace/viewspec';

/* A real-model build of a van fleet app named its list of vans "Fleet overview", the same title as its dashboard, so
   the menu showed two pages with one name (and React warned about two children with the same key). */
type Def = Parameters<typeof normUI>[1];
const def = {
  tables: [
    { name: 'vans', label: 'Vans', one: 'Van', columns: [{ name: 'plate', type: 'text' }] },
    { name: 'services', label: 'Services', one: 'Service', columns: [{ name: 'done_on', type: 'date' }] },
  ],
  brief: { roles: [{ id: 'manager', name: 'Manager' }], process: { entity: 'vans' } },
  process: { table: '', states: [] },
  dash: { title: 'Fleet overview', widgets: [] },
  access: {
    vans: { manager: { list: 'all', create: true, update: 'all', delete: true } },
    services: { manager: { list: 'all', create: true, update: 'all', delete: true } },
  },
} as unknown as Def;

describe('page names', () => {
  it('are unique: the overview keeps its name and a later page takes its table name, or a number', () => {
    const ui = normUI(
      {
        screens: [
          { name: 'Fleet overview', type: 'table', table: 'vans', roles: ['manager'] },
          { name: 'Log', type: 'table', table: 'services', roles: ['manager'] },
          { name: 'Log', type: 'table', table: 'services', roles: ['manager'] },
          { name: 'Vans', type: 'table', table: 'vans', roles: ['manager'] },
        ],
      },
      def,
    );
    expect(ui.screens.map((s) => s.name)).toEqual(['Fleet overview', 'Vans', 'Log', 'Services', 'Vans 2']);
  });
});
