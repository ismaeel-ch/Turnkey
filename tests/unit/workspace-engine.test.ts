import { describe, expect, it } from 'vitest';
import {
  checkBackendShape,
  checkBrief,
  checkSchemaShape,
  coerceField,
  deriveEndpoints,
  normBackend,
  normBrief,
  normSchema,
  seedValue,
} from '@/workspace/engine';
import type { BriefedDef } from '@/shared/types/app';

const brief = normBrief({
  name: 'Gym desk',
  summary: 'Members book classes.',
  roles: [{ name: 'Trainer' }, { id: 'manager', name: 'Manager' }, { name: 'Trainer' }],
  entities: ['members', { name: 'Bookings', what: 'a place in a class' }, 'users'],
  process: { entity: 'booking', states: ['Booked', 'attended', { id: 'no_show' }, 'booked'] },
  stories: [
    { role: 'trainer', want: 'see my classes' },
    { as: 'manager', want: 'count no-shows' },
  ],
  question: { text: 'Can trainers cancel?', options: ['Yes', 'No'], recommended: 7 },
});

describe('the brief', () => {
  it('normalises names, drops duplicates and the users table, and keeps the question in range', () => {
    expect(brief.roles.map((r) => r.id)).toEqual(['trainer', 'manager']);
    expect(brief.entities.map((e) => e.name)).toEqual(['members', 'bookings']);
    expect(brief.process).toEqual({ entity: 'bookings', states: ['booked', 'attended', 'no_show'], note: '' });
    expect(brief.question?.recommended).toBe(1);
  });

  it('passes every check', () => {
    expect(checkBrief(brief).every((c) => c.ok)).toBe(true);
  });
});

describe('tables and seed data', () => {
  const sc = normSchema(
    {
      tables: [
        { name: 'members', columns: [{ name: 'name', type: 'string', required: true }, { name: 'id' }] },
        {
          name: 'bookings',
          columns: [
            { name: 'member', type: 'fk', ref: 'members' },
            { name: 'trainer', type: 'ref', ref: 'users', role: 'trainer' },
            { name: 'status', type: 'enum', options: ['Booked', 'attended', 'no_show'] },
          ],
          owner: 'trainer',
        },
      ],
      users: [
        { name: 'Dr. Ana Ruiz', role: 'trainer' },
        { name: 'Ana Lee', role: 'trainer' },
        { name: 'Sam Park', role: 'manager' },
      ],
    },
    brief,
  );

  it('maps type words, turns a link to users into a person, and drops system columns', () => {
    expect(sc.tables[0].columns.map((c) => c.name)).toEqual(['name']);
    expect(sc.tables[0].columns[0].type).toBe('text');
    const cols = sc.tables[1].columns;
    expect(cols.map((c) => c.type)).toEqual(['ref', 'user', 'select']);
    expect(cols[1]).toMatchObject({ type: 'user', role: 'trainer' });
    expect(cols[2].options).toEqual(['booked', 'attended', 'no_show']);
    expect(sc.tables[1].owner).toBe('trainer');
  });

  it('gives each seeded user a unique username', () => {
    expect(sc.users.map((u) => u.username)).toEqual(['ana', 'ana2', 'sam']);
  });

  it('passes every check', () => {
    expect(checkSchemaShape(sc, brief).filter((c) => !c.ok)).toEqual([]);
  });

  it('reads seed values written as day offsets, words and row positions', () => {
    const look = { user: (n: string) => (n === 'Sam Park' ? 3 : 0), ref: () => 2 };
    expect(seedValue({ name: 'd', type: 'date' }, 0, look)[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(seedValue({ name: 'd', type: 'datetime' }, 'tomorrow 14:30', look)[0]).toMatch(/T14:30$/);
    expect(seedValue({ name: 'u', type: 'user' }, 'Sam Park', look)).toEqual([3, null]);
    expect(seedValue({ name: 's', type: 'select', options: ['a'] }, 'b', look)[1]).toContain('is not one of a');
    expect(seedValue({ name: 'r', type: 'text', required: true }, '', look)).toEqual([null, 'is required']);
  });

  it('checks fields sent to the API', () => {
    expect(coerceField({ name: 'n', type: 'number' }, 'x')).toEqual([null, 'Use a number']);
    expect(coerceField({ name: 'b', type: 'bool' }, 'true')).toEqual([1, null]);
    expect(coerceField({ name: 't', type: 'text' }, undefined)).toEqual([undefined, null]);
  });
});

describe('workflow, access and endpoints', () => {
  const def = {
    brief,
    tables: [
      { name: 'members', label: 'Members', one: 'Member', title: 'name', columns: [{ name: 'name', type: 'text' }] },
      {
        name: 'bookings',
        label: 'Bookings',
        one: 'Booking',
        title: 'status',
        columns: [{ name: 'status', type: 'select', options: ['booked', 'attended', 'no_show'] }],
      },
    ],
    access: {},
    process: null,
  } as unknown as BriefedDef;
  const be = normBackend(
    {
      workflow: {
        table: 'bookings',
        states: ['booked', { id: 'attended', tone: 'success' }, { id: 'no_show', tone: 'loud' }],
        transitions: [
          { id: 'attend', from: 'booked', to: 'attended', roles: ['trainer', 'nobody'] },
          { label: 'Mark no show', from: ['booked'], to: 'no_show', roles: 'manager' },
        ],
      },
      access: {
        members: { trainer: { list: true }, manager: { list: 'all', create: 'yes' } },
        bookings: { trainer: { list: 'own' }, manager: { list: 'all' } },
      },
    },
    def,
  );

  it('normalises states, transitions and access rules', () => {
    expect(be.process.states.map((s) => s.tone)).toEqual(['neutral', 'success', 'neutral']);
    expect(be.process.initial).toBe('booked');
    expect(be.process.transitions.map((x) => [x.id, x.roles])).toEqual([
      ['attend', ['trainer']],
      ['mark_no_show', ['manager']],
    ]);
    expect(be.access.members.manager).toEqual({ list: 'all', create: true, update: 'none', delete: false });
    expect(be.access.bookings.trainer.list).toBe('own');
  });

  it('passes every check', () => {
    expect(checkBackendShape(def, be).filter((c) => !c.ok)).toEqual([]);
  });

  it('derives the endpoints with the roles allowed on each', () => {
    const eps = deriveEndpoints({ ...def, access: be.access, process: be.process });
    const byId = Object.fromEntries(eps.map((e) => [e.id, e]));
    expect(byId['members.create'].roles).toEqual({ manager: 'all' });
    expect(byId['bookings.list'].roles).toEqual({ trainer: 'own', manager: 'all' });
    expect(byId['bookings.attend']).toMatchObject({ method: 'POST', path: '/api/bookings/:id/attend', roles: { trainer: 'own' } });
  });
});
