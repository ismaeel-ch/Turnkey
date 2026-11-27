import { describe, expect, it } from 'vitest';
import { accessFor, changePlan, changeTeam, kindOf, recordsFor, stationsFor, type StepFacts } from '@/workspace/change-plan';

/* The plan of a change, as the owner reads it. Plain logic: steps and record counts in, sentences out. */

const addField: StepFacts = { station: 'database', text: 'Add Notes (long text) to Claims' };
const access: StepFacts = {
  station: 'backend',
  text: 'Let Manager see receipts',
  also: ['screens'],
  access: { who: 'Manager', people: 4, gains: true, what: 'see receipts' },
};
const theme: StepFacts = { station: 'screens', text: 'Use a purple accent' };
const chart: StepFacts = { station: 'views', text: 'Add a chart of claims by month to the dashboard' };
const remove: StepFacts = {
  station: 'database',
  text: 'Remove Notes from Claims',
  destructive: true,
  loss: '58 stored values leave the app. They are put away for 30 days and come back if you add the field again',
};
const lists = [
  { label: 'Claims', n: 214 },
  { label: 'Receipts', n: 61 },
  { label: 'Categories', n: 0 },
];

describe('which stations a change needs', () => {
  it('a change to the lists runs everything that reads them, and never the Planner', () => {
    expect(stationsFor([addField])).toEqual(['database', 'backend', 'views', 'screens', 'walkthrough']);
  });
  it('a rule about who may do what runs the rules, the pages it opens or closes, and the tests: not the lists or the views', () => {
    expect(stationsFor([access])).toEqual(['backend', 'screens', 'walkthrough']);
    expect(stationsFor([{ station: 'backend', text: 'x' }])).toEqual(['backend', 'walkthrough']);
  });
  it('a change to how it looks runs the pages and the tests', () => {
    expect(stationsFor([theme])).toEqual(['screens', 'walkthrough']);
    expect(stationsFor([chart])).toEqual(['views', 'screens', 'walkthrough']);
  });
  it('several steps need the stations of each, in the order of the line', () => {
    expect(stationsFor([theme, access])).toEqual(['backend', 'screens', 'walkthrough']);
    expect(stationsFor([{ station: 'nowhere', text: 'x' }])).toEqual([]);
  });
});

describe('who works on a change', () => {
  it('names only the agents that are needed, in plain words, and says why the rest are not', () => {
    const t = changeTeam([access]);
    expect(t.team.map((w) => w.who)).toEqual(['Rules builder', 'Screen designer', 'Tester']);
    expect(t.team[0].why).toBe('Let Manager see receipts.');
    expect(t.team[2].why).toMatch(/runs every test again/);
    expect(t.notNeeded.map((w) => w.who)).toEqual(['Planner', 'List builder', 'View advisor']);
    expect(t.notNeeded[1].why).toBe('No list or field changes.');
  });
  it('a new field needs the whole line after the Planner', () => {
    const t = changeTeam([addField]);
    expect(t.team.map((w) => w.who)).toEqual(['List builder', 'Rules builder', 'View advisor', 'Screen designer', 'Tester']);
    expect(t.notNeeded.map((w) => w.who)).toEqual(['Planner']);
  });
});

describe('a fix or a new feature', () => {
  it('anything that changes the lists or adds something is a new feature; the rest is a fix', () => {
    expect(kindOf([addField])).toBe('feature');
    expect(kindOf([chart])).toBe('feature');
    expect(kindOf([access])).toBe('fix');
    expect(kindOf([theme])).toBe('fix');
    expect(kindOf([theme, addField])).toBe('feature');
  });
  it("the owner's own word wins over the rule", () => {
    expect(kindOf([{ ...addField, kind: 'fix' }])).toBe('fix');
    expect(kindOf([{ ...theme, kind: 'feature' }])).toBe('feature');
  });
});

describe('what a change does to the records', () => {
  it('says nothing is lost, with the real numbers', () => {
    const r = recordsFor([addField], lists);
    expect(r.level).toBe('safe');
    expect(r.label).toBe('Nothing is lost');
    expect(r.text).toBe('All 275 records stay as they are (214 claims, 61 receipts). A new field is empty on the records you have.');
    expect(recordsFor([addField], [{ label: 'Claims', n: 1 }]).text).toMatch(/^All 1 record stays as it is\./);
    expect(recordsFor([addField], [{ label: 'Claims', n: 0 }]).text).toBe('There are no records in the app yet.');
  });
  it('says no record is touched when only rules or looks change', () => {
    expect(recordsFor([access], lists)).toEqual({
      level: 'safe',
      label: 'Nothing is changed',
      text: 'No record is touched. Only who may see or change them.',
    });
    expect(recordsFor([theme], lists).text).toBe('No record is touched.');
  });
  it('a removal is named with what leaves, and wins over everything else', () => {
    const r = recordsFor([addField, remove], lists);
    expect(r.level).toBe('removes');
    expect(r.label).toBe('Removes something');
    expect(r.text).toMatch(/^Remove Notes from Claims: 58 stored values leave the app\. They are put away for 30 days/);
  });
  it('a step that needs an answer says so', () => {
    const r = recordsFor([{ station: 'database', text: 'x', ask: '37 old claims have no cost centre.' }], lists);
    expect(r).toEqual({ level: 'ask', label: 'Needs one answer', text: '37 old claims have no cost centre.' });
  });
});

describe('who gains and who loses access', () => {
  it('counts the people on each side', () => {
    const lose: StepFacts = {
      station: 'backend',
      text: 'Stop Employee from deleting claims',
      access: { who: 'Employee', people: 1, gains: false, what: 'delete claims' },
    };
    expect(accessFor([access, lose, theme])).toEqual({
      gains: ['Manager (4 people) will be able to see receipts.'],
      loses: ['Employee (1 person) will no longer be able to delete claims.'],
    });
  });
});

describe('the whole card', () => {
  it('a fix on version 1.0 becomes 1.0.1, a new feature 1.1, and nothing is promised before the first release', () => {
    const fix = changePlan({ title: "Managers can't see receipts.", steps: [access], lists, live: '1.0' });
    expect(fix.title).toBe("Managers can't see receipts");
    expect(fix.kind).toBe('fix');
    expect(fix.becomes).toBe('1.0.1');
    expect(fix.changes).toEqual(['Let Manager see receipts']);
    expect(fix.access.gains).toHaveLength(1);
    expect(changePlan({ title: 'Notes', steps: [addField], lists, live: '1.0' }).becomes).toBe('1.1');
    expect(changePlan({ title: 'Notes', steps: [addField], lists, live: '1.4.2' }).becomes).toBe('1.5');
    expect(changePlan({ title: 'Notes', steps: [addField], lists, live: '' }).becomes).toBe('');
  });
  it("uses the owner's word on the kind when they gave one", () => {
    const p = changePlan({ title: 'Notes', steps: [addField], lists, live: '1.0', kind: 'fix' });
    expect(p.kind).toBe('fix');
    expect(p.becomes).toBe('1.0.1');
  });
});
