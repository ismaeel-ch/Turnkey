import { describe, expect, it } from 'vitest';
import type { AppTable, AppUser, BackedDef, TestCase } from '@/shared/types/app';
import { narrowToPlan, pFits } from '@/workspace/line';
import { checkViews, fillThinViews, normViews } from '@/workspace/viewspec';
import { CASE_DO, alignOwners, testerPrompt, unplayable, type BackedApp } from '@/workspace/tester';

// Made-up apps, shaped like what real Live builds made: a reading list with stages, and a tutor's lessons with none.
const books: AppTable = {
  name: 'books',
  label: 'Books',
  one: 'Book',
  title: 'title',
  owner: null,
  columns: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'status', label: 'Status', type: 'select', required: true, options: ['want_to_read', 'reading', 'finished'] },
    { name: 'started_on', label: 'Started on', type: 'date' },
  ],
};
const lessons: AppTable = {
  name: 'lessons',
  label: 'Lessons',
  one: 'Lesson',
  title: 'topic',
  owner: null,
  columns: [
    { name: 'topic', label: 'Topic', type: 'text', required: true },
    { name: 'paid', label: 'Paid', type: 'bool' },
  ],
};
const brief = {
  name: 'X',
  summary: 'X',
  roles: [{ id: 'owner', name: 'You', can: 'everything' }],
  entities: [],
  process: { entity: '', states: [], note: '' },
  stories: [],
  rules: [],
  planned: true,
};
const staged = {
  tables: [books],
  brief,
  process: {
    table: 'books',
    column: 'status',
    states: [{ id: 'want_to_read' }, { id: 'reading' }, { id: 'finished' }],
    initial: 'want_to_read',
    transitions: [{ id: 'start_reading', label: 'Start reading', from: ['want_to_read'], to: 'reading', roles: ['owner'] }],
  },
  access: { books: { owner: { list: 'all', create: true, update: 'all', delete: true } } },
  users: [],
  screens: [],
} as unknown as BackedDef;
const flat = {
  ...staged,
  tables: [lessons],
  process: { table: '', column: '', states: [], initial: '', transitions: [] },
  access: { lessons: { owner: { list: 'all', create: true, update: 'all', delete: true } } },
} as unknown as BackedDef;
const kase = (id: string, steps: TestCase['steps']): TestCase => ({ id, name: id, why: '', steps });

describe('test cases no change could make pass', () => {
  it('takes out a transition the app does not have, and says why', () => {
    const r = unplayable(
      [
        kase('paid', [
          { role: 'owner', do: 'create', table: 'lessons', values: { topic: 'Fractions' } },
          { role: 'owner', do: 'transition', table: 'lessons', transition: 'mark_paid' },
        ]),
        kase('ok', [
          { role: 'owner', do: 'create', table: 'lessons', values: { topic: 'Fractions' } },
          { role: 'owner', do: 'update', table: 'lessons', values: { paid: true } },
        ]),
      ],
      flat,
    );
    expect(r.keep.map((c) => c.id)).toEqual(['ok']);
    expect(r.drop).toEqual([{ id: 'paid', why: 'It runs "mark_paid", but this app has no workflow.' }]);
    expect(
      unplayable([kase('x', [{ role: 'owner', do: 'transition', table: 'books', transition: 'finish_it' }])], staged).drop[0].why,
    ).toMatch(/not a step of the workflow/);
    expect(
      unplayable([kase('x', [{ role: 'owner', do: 'transition', table: 'books', transition: 'start_reading' }])], staged).keep,
    ).toHaveLength(1);
  });

  it('takes out an "incomplete" create that leaves out only the stage field, which the workflow fills in', () => {
    const r = unplayable(
      [
        kase('status', [{ role: 'owner', do: 'invalid', table: 'books', values: { title: 'Neuromancer' } }]),
        kase('title', [{ role: 'owner', do: 'invalid', table: 'books', values: { started_on: '2026-01-02' } }]),
      ],
      staged,
    );
    expect(r.keep.map((c) => c.id)).toEqual(['title']);
    expect(r.drop[0].why).toMatch(/only status/);
  });

  it('keeps one that leaves out only the stage on a list with rules: it is a save that breaks a rule', () => {
    const ruled = {
      ...staged,
      logic: { rules: [{ id: 'dates', table: 'books', when: 'started_on >= today()', message: 'Pick a later day.' }] },
    } as BackedDef;
    const r = unplayable(
      [kase('rule', [{ role: 'owner', do: 'invalid', table: 'books', values: { title: 'Neuromancer', started_on: -3 } }])],
      ruled,
    );
    expect(r.keep.map((c) => c.id)).toEqual(['rule']);
  });
});

describe("the Tester's prompt", () => {
  const app = (def: BackedDef) => ({ id: 'a', def }) as unknown as BackedApp;
  it('offers update and delete steps, and transitions only when the app has a workflow', () => {
    expect(CASE_DO).toEqual(expect.arrayContaining(['update', 'delete']));
    const noFlow = testerPrompt(app(flat)),
      withFlow = testerPrompt(app(staged));
    expect(noFlow).toMatch(/"do":"create\|see\|hidden\|update\|delete\|denied\|invalid\|open"/);
    expect(noFlow).toMatch(/This app has no workflow and no transitions/);
    expect(noFlow).not.toMatch(/"transition":"transition id"/);
    expect(withFlow).toMatch(/\|update\|transition\|delete\|/);
    expect(withFlow).toMatch(/leave out a required column other than status/);
  });
});

describe('the views that fit each table, as the View advisor is told', () => {
  it('leaves out a board for a table with no choice field, and calendars for one with no date', () => {
    expect(pFits({ ...flat, tables: [lessons, books] } as unknown as BackedDef).split('\n')).toEqual([
      'lessons: table, chart, tree, cards',
      'books: table, board, calendar, timeline, chart, tree, cards',
    ]);
  });

  it('fills in a table the advisor left with only the table view, and leaves a view that does not fit for the check', () => {
    const def = { ...staged, tables: [books, lessons], access: {}, views: {} } as unknown as BackedDef;
    const vw = fillThinViews(normViews({ views: [{ table: 'lessons', use: ['table', 'board'] }] }, def), def);
    expect(vw.views.books.map((v) => v.type)).toEqual(['table', 'board', 'calendar', 'timeline', 'chart', 'tree', 'cards']);
    expect(vw.views.lessons.map((v) => v.type)).toEqual(['table', 'board']);
    expect(checkViews(def, vw).find((c) => !c.ok)?.detail).toMatch(/Board on lessons needs a choice field/);
  });
});

// A made-up clinic: the front desk books appointments for doctors, and each doctor sees only their own.
const appointments: AppTable = {
  name: 'appointments',
  label: 'Appointments',
  one: 'Appointment',
  title: 'reason',
  owner: 'doctor',
  columns: [
    { name: 'reason', label: 'Reason', type: 'text', required: true },
    { name: 'doctor', label: 'Doctor', type: 'user', role: 'doctor', required: true },
  ],
};
const clinic = {
  ...flat,
  tables: [appointments],
  brief: {
    ...brief,
    roles: [
      { id: 'front_desk', name: 'Front desk', can: 'books' },
      { id: 'doctor', name: 'Doctor', can: 'sees own' },
    ],
  },
  access: {
    appointments: {
      front_desk: { list: 'all', create: true, update: 'all', delete: false },
      doctor: { list: 'own', create: false, update: 'own', delete: false },
    },
  },
} as unknown as BackedDef;
const people: AppUser[] = [
  { id: 1, name: 'Marcus Bell', username: 'marcus', role: 'front_desk' },
  { id: 2, name: 'Liam Chen', username: 'liam', role: 'doctor' },
  { id: 3, name: 'Rachel Kim', username: 'rachel', role: 'doctor' },
];
const booked = (doctor: unknown, ...later: TestCase['steps']) =>
  kase('own', [
    { role: 'front_desk', user: 'marcus bell', do: 'create', table: 'appointments', values: { reason: 'Check-up', doctor } },
    ...later,
  ]);
const doctorOf = (c: TestCase) => (c.steps[0].values || {}).doctor;

describe('a case that gives its record to the wrong person', () => {
  it('gives the appointment to the doctor who must find it, when the case miscounted', () => {
    const [c] = alignOwners(
      [
        booked(
          3,
          { role: 'doctor', user: 'liam chen', do: 'see', table: 'appointments' },
          { role: 'doctor', user: 'rachel kim', do: 'hidden', table: 'appointments' },
        ),
      ],
      clinic,
      people,
    );
    expect(doctorOf(c)).toBe(2);
  });
  it('moves it away from the doctor who must not find it, when no one is said to find it', () => {
    const [c] = alignOwners([booked(3, { role: 'doctor', user: 'rachel', do: 'hidden', table: 'appointments' })], clinic, people);
    expect(doctorOf(c)).toBe(2);
  });
  it('leaves a case that already agrees with itself, or names the person in words, as it is', () => {
    const right = booked(
        2,
        { role: 'doctor', user: 'liam chen', do: 'see', table: 'appointments' },
        { role: 'doctor', user: 'rachel kim', do: 'hidden', table: 'appointments' },
      ),
      named = booked('Liam Chen', { role: 'doctor', user: 'liam', do: 'see', table: 'appointments' });
    expect(alignOwners([right, named], clinic, people)).toEqual([right, named]);
  });
});

describe('the Backend agent may not open up what the plan kept private', () => {
  it('narrows "every appointment" back to "their own" where the plan says so, and never widens', () => {
    const access = {
      appointments: {
        front_desk: { list: 'all', create: true, update: 'own', delete: true },
        doctor: { list: 'all', create: false, update: 'all', delete: false },
      },
    } as BackedDef['access'];
    const changed = narrowToPlan(access, clinic.access, clinic);
    expect(access.appointments.doctor).toEqual({ list: 'own', create: false, update: 'own', delete: false });
    expect(access.appointments.front_desk).toEqual({ list: 'all', create: true, update: 'own', delete: false });
    expect(changed.sort()).toEqual([
      'doctor list appointments: all to own',
      'doctor update appointments: all to own',
      'front_desk delete appointments: not allowed',
    ]);
  });
  it('keeps "every record" where a list has no owner, since "their own" cannot work there', () => {
    const access = { appointments: { doctor: { list: 'all', create: false, update: 'all', delete: false } } } as BackedDef['access'];
    expect(narrowToPlan(access, clinic.access, { tables: [{ ...appointments, owner: null }] })).toEqual([]);
  });
});
