import { useState } from 'react';
import type { Row } from '@/shared/types/app';
import type { AppRecord } from '@/shared/types/workspace';
import { confirmBox, toast } from './core';
import { DEMO_COL } from './db';
import {
  addDemoData,
  canAddDemoData,
  countsText,
  demoBlocked,
  demoCounts,
  demoUndo,
  dismissDemoUndo,
  isSettingsTable,
  planDemoRemoval,
  removeDemoData,
  setDemoMark,
  undoDemoRemoval,
  type DemoPlan,
} from './demo-data';
import { resetAppData } from './line';
import { Btn, Icon, refocus } from './ui';

/* Each of these buttons goes away once pressed (the bar changes, Remove becomes Add), so the keyboard is put on what
   took its place. */
const TO_REMOVED = ['[data-demo-bar=removed] .btn', '[data-demo-act=add]'];
const TO_DEMO = ['[data-demo-bar=on] .btn', '[data-demo-act=remove]'];
const putBack = (app: AppRecord) => {
  addDemoData(app);
  refocus(TO_DEMO);
};

/* ===== Turnkey · demo data, as the owner and the app's people see it =====
   A bar while the app holds made-up records, a "Demo" tag on each of them, one confirmation that says what goes,
   what stays and what is kept, Undo, and "Add demo data again". */

const records = (n: number) => n + (n === 1 ? ' record' : ' records');
const isDemo = (row: Row | null | undefined) => !!row && Number(row[DEMO_COL]) === 1;

/** The small tag beside the name of a made-up record. Draws nothing for a record someone added. */
export function DemoTag({ row }: { row: Row | null | undefined }) {
  return isDemo(row) ? (
    <span className="badge b-demo" title="A made-up record. Remove demo data takes it away.">
      Demo
    </span>
  ) : null;
}

/** The three lines of the confirmation: what goes, what stays, what is kept. */
function RemovalBody({ app, plan }: { app: AppRecord; plan: DemoPlan }) {
  const goes: Record<string, number> = {},
    own: Record<string, number> = {},
    c = demoCounts(app);
  app.def.tables.forEach((t) => {
    goes[t.name] = (plan.goes[t.name] || []).length;
    own[t.name] = (c.byTable[t.name] || { own: 0 }).own;
  });
  // starter settings are named, not counted: "Your categories and limits."
  const lists = app.def.tables.filter((t) => isSettingsTable(app, t.name)).map((t) => t.label.toLowerCase()),
    settings = lists.length > 1 ? lists.slice(0, -1).join(', ') + ' and ' + lists[lists.length - 1] : lists[0] || '';
  const names = plan.keptNames.slice(0, 3).map((n) => '"' + n + '"'),
    more = plan.keptNames.length - names.length;
  return (
    <div className="demo-plan">
      <div className="demo-line" data-demo="goes">
        <span className="badge b-danger">Goes</span>
        <span>
          {plan.goesN ? countsText(app, goes) + ', all made up, with ' + (plan.goesN === 1 ? 'its' : 'their') + ' history.' : 'Nothing.'}
          {plan.edited > 0 &&
            ' ' +
              plan.edited +
              (plan.edited === 1 ? ' of them was' : ' of them were') +
              ' changed after being added. Still demo data, so removed too.'}
        </span>
      </div>
      <div className="demo-line" data-demo="stays">
        <span className="badge b-success">Stays</span>
        <span>
          {plan.ownN ? 'The ' + countsText(app, own) + ' you added. ' : ''}
          {settings ? 'Your ' + settings + '. ' : ''}
          {'The people who can sign in, and every list, rule and screen.'}
        </span>
      </div>
      {plan.keptN > 0 && (
        <div className="demo-line" data-demo="kept">
          <span className="badge b-info">Kept for you</span>
          <span>
            {plan.keptN + (plan.keptN === 1 ? ' demo record' : ' demo records')}
            {' that your own records point to ('}
            {names.join(', ')}
            {more > 0 ? ' and ' + more + ' more' : ''}
            {'). '}
            {plan.keptN === 1 ? 'It stops being demo data.' : 'They stop being demo data.'}
          </span>
        </div>
      )}
      <p className="t-cap muted">Nothing you made is ever deleted. You can undo this, and you can add the demo data again later.</p>
    </div>
  );
}
/** Asks once, saying what goes, what stays and what is kept, then removes the demo data. */
export async function askRemoveDemo(app: AppRecord) {
  const why = demoBlocked(app);
  if (why) return toast(why, 'warning');
  const plan = planDemoRemoval(app);
  if (!plan.goesN && !plan.keptN) return toast(app.name + ' holds no demo data.', 'info');
  const ok = await confirmBox({
    title: 'Remove the demo data from ' + app.name + '?',
    body: <RemovalBody app={app} plan={plan} />,
    yes: 'Remove demo data',
    danger: true,
  });
  if (ok) {
    removeDemoData(app);
    refocus(TO_REMOVED);
  }
}
/** "Start over" is what "Reset data" used to do. It deletes records people added, so it says how many first. */
export async function askStartOver(app: AppRecord) {
  const why = demoBlocked(app);
  if (why) return toast(why, 'warning');
  const own = demoCounts(app).own;
  const ok = await confirmBox({
    title: 'Start ' + app.name + ' over?',
    body: own
      ? 'This deletes the ' +
        records(own) +
        ' you added, and all history. Every list is emptied and the demo data is put back. People, rules and screens stay. To remove only the made-up records, use Remove demo data instead.'
      : 'Every list is emptied and the demo data is put back as it was at the start. People, rules and screens stay.',
    yes: 'Start over',
    danger: own > 0,
  });
  if (ok) resetAppData(app);
}

/** The bar across the top of a built app: it stays while any record is made up, and after a removal it offers Undo. */
export function DemoBar({ app }: { app: AppRecord }) {
  const [about, setAbout] = useState(false);
  const c = demoCounts(app),
    undo = demoUndo(app);
  if (c.demo > 0) {
    const of: Record<string, number> = {};
    Object.keys(c.byTable).forEach((k) => {
      of[k] = c.byTable[k].demo;
    });
    return (
      <div className="demo-bar warn" role="status" data-demo-bar="on">
        <Icon n="info" s="16" />
        <span className="grow demo-text">
          <strong>{"You're looking at demo data."}</strong>{' '}
          <span className="demo-long">
            {countsText(app, of)}
            {c.demo === 1 ? ' is made up.' : ' are made up.'}
          </span>
          <span className="demo-short">
            {records(c.demo)}
            {c.demo === 1 ? ' is made up.' : ' are made up.'}
          </span>
          {c.own > 0 && ' Your own ' + records(c.own) + (c.own === 1 ? ' is real.' : ' are real.')}
          {about && (
            <span className="demo-about">
              {
                ' Demo data is made-up records, so every screen has something to show. Each one carries a "Demo" tag. Removing it never deletes anything you added, and you can add it again later.'
              }
            </span>
          )}
        </span>
        <Btn className="btn sm" onClick={() => void askRemoveDemo(app)}>
          Remove demo data
        </Btn>
        <button className="demo-link" aria-expanded={about} onClick={() => setAbout(!about)}>
          What is this?
        </button>
      </div>
    );
  }
  if (undo)
    return (
      <div className="demo-bar ok" role="status" data-demo-bar="removed">
        <Icon n="checkCircle" s="16" />
        <span className="grow demo-text">
          <strong>Demo data removed.</strong>
          {undo.own > 0
            ? ' Your ' + records(undo.own) + (undo.own === 1 ? ' is' : ' are') + ' untouched.'
            : ' The lists are empty and ready for real records.'}
        </span>
        <Btn
          className="btn sm"
          onClick={() => {
            undoDemoRemoval(app);
            refocus(TO_DEMO);
          }}
        >
          <Icon n="undo" s="16" />
          Undo
        </Btn>
        <button className="demo-link" onClick={() => putBack(app)}>
          Add demo data again
        </button>
        <Btn
          className="btn subtle icon sm"
          aria-label="Close this message"
          onClick={(e) => {
            const from = e.currentTarget.closest('.app');
            dismissDemoUndo(app);
            refocus(['.app-main h1', '.app-main h2', '.app-main'], from);
          }}
        >
          <Icon n="dismiss" s="16" />
        </Btn>
      </div>
    );
  return null;
}

/** The demo data buttons of the builder's preview bar and Data page. */
export function DemoActions({ app }: { app: AppRecord }) {
  const c = demoCounts(app);
  return (
    <>
      {c.demo > 0 ? (
        <Btn
          className="btn sm"
          data-demo-act="remove"
          aria-label="Remove demo data"
          title="Removes the made-up records. Records you added stay."
          onClick={() => void askRemoveDemo(app)}
        >
          <Icon n="broom" s="16" />
          <span className="hide-sm">Remove demo data</span>
        </Btn>
      ) : (
        <Btn
          className="btn sm"
          data-demo-act="add"
          aria-label="Add demo data again"
          disabled={!canAddDemoData(app)}
          title="Puts the made-up records back, next to the ones you added"
          onClick={() => putBack(app)}
        >
          <Icon n="add" s="16" />
          <span className="hide-sm">Add demo data again</span>
        </Btn>
      )}
      <Btn
        className="btn subtle sm"
        data-demo-act="over"
        aria-label="Start over"
        title="Empties every list and puts the demo data back. Records you added are deleted."
        onClick={() => void askStartOver(app)}
      >
        <Icon n="reset" s="16" />
        <span className="hide-sm">Start over</span>
      </Btn>
    </>
  );
}
/** The same actions as entries for a built app's own menu (the app opened on its own, and the phone layout). */
export function demoMenuItems(app: AppRecord): { label: string; icon: string; on: () => void }[] {
  const c = demoCounts(app),
    out: { label: string; icon: string; on: () => void }[] = [];
  if (c.demo > 0) out.push({ label: 'Remove demo data', icon: 'broom', on: () => void askRemoveDemo(app) });
  else if (canAddDemoData(app)) out.push({ label: 'Add demo data again', icon: 'add', on: () => putBack(app) });
  out.push({ label: 'Start over', icon: 'reset', on: () => void askStartOver(app) });
  return out;
}

/** On a record's page: says the record is made up and lets the owner keep it as their own. */
export function DemoNote({ app, table, row }: { app: AppRecord; table: string; row: Row & { id: number } }) {
  if (!isDemo(row)) return null;
  return (
    <div className="demo-note" role="note">
      <span className="badge b-demo">Demo</span>
      <span className="grow t-cap">Made up. It goes when the demo data is removed.</span>
      <Btn
        className="btn subtle sm"
        title="It stops being demo data and stays when the demo data is removed"
        onClick={() => {
          setDemoMark(app, table, row.id, false);
          toast('Kept. It is now one of your own records.', 'success');
        }}
      >
        Keep this record
      </Btn>
    </div>
  );
}
