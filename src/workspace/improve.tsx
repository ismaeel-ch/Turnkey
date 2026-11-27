import { useState } from 'react';
import type { AppTable, BackedDef, Untrusted } from '@/shared/types/app';
import type { AppRecord, ChangePlan, Dict, Pane, PlanCard, TryCard, UnderstandCard } from '@/shared/types/workspace';
import { S, U, arr, closeDialog, commit, cx, errText, label, notify, openDialog, setChat, snake, str, toast, uid } from './core';
import { dbCount, dbDrop, qi, sqlPeek } from './db';
import { ACT_VERB, ACT_WORDS, editBlocked, inferType, planOf, planOps, readChange, runChange, suggestChanges } from './changes';
import { TYPE_LABEL, accOf, apiCall, appUsers, findCol, findRole, findTable, roleName, tableOf } from './engine';
import { pushChat, say } from './line';
import { carryData } from './carry';
import { inverseSteps } from './record-steps';
import { aloneOffered, draftSteps, isDirty, relOf, suggestKind, verNext } from './release';
import { appFromPack, readPack, unsqueeze } from './share';
import { AppPane, newPane, stageOf } from './runtime';
import { Btn, Dialog, Field, Icon, Spinner, Textarea } from './ui';

/* ===== Turnkey · changing an app after it is built =====
   The owner says what is wrong or what is missing, in their own words: in the box on the Release page, or with
   "Report a problem" while they use the app. Turnkey says what it took that to be (a problem to fix or a new
   feature), the Tester looks for the problem itself where it can, and at most three questions follow, each with a
   recommended answer. Then comes one plan card: what will change, who works on it and who is not needed, what happens
   to the records, and the version it goes out as. Nothing runs until the owner presses Go ahead. The change is built
   in the draft by only the stations it needs, the owner tries it as the person it is about, beside the version people
   have now, and it goes out with the next release.

   The plan is worked out by code from the planned steps (src/workspace/change-plan.ts). A model, when one is
   connected, only reads the owner's sentence into operations: the same reader a change typed in the chat uses. */

type BackedApp = AppRecord & { def: BackedDef };
type Kind = 'fix' | 'feature';
type Op = Dict<Untrusted>;

/** Where a report came from: who the owner was signed in as in the app, on which page, with which record open. */
export interface ReportCtx {
  user: string;
  role: string;
  screen: string;
  table: string | null;
  record: string | null;
}
/** One question before the plan. The last option is always "You decide", which takes the recommended answer. */
interface Question {
  text: string;
  options: string[];
  recommended: number;
  answered: number | null;
  /** changes the operations to match the answer */
  apply(i: number): void;
}
/** An improvement on its way from a sentence to a change in the draft. Kept only while the page is open. */
interface Flow {
  id: string;
  text: string;
  ctx: ReportCtx | null;
  kind: Kind;
  /** the owner said which kind it is */
  owned: boolean;
  ops: Op[];
  questions: Question[];
}
/** App id -> the improvement that is waiting for an answer, a go-ahead or a verdict. */
export const IMPROVE: Dict<Flow> = {};
const flowOf = (app: AppRecord, id: string | undefined) => (IMPROVE[app.id] && IMPROVE[app.id].id === id ? IMPROVE[app.id] : null);

const KIND: Record<Kind, string> = { fix: 'Fix', feature: 'New feature' };
const TONE: Record<ChangePlan['records']['level'], string> = { safe: 'success', ask: 'warning', removes: 'danger' };
const YOU_DECIDE = 'You decide';
const HELP =
  'I could not turn that into a change yet. Say who it is about, what they cannot do or what is missing, and in which list. For example: "Managers cannot see receipts" or "Add a notes field to claims".';

/* ---------- reading a report ---------- */
const PROBLEM =
  /\b(can ?not|can't|cant|cannot|couldn't|could not|unable|not able|not allowed|won't|will not|doesn't|does not|don't|do not|isn't|is not|aren't|are not|wrong|broken|missing|error|bug|fails?|failing|problem|should (?:be|not|have)|instead of|no longer)\b/i;
/** Whether a sentence reads as something that is wrong, as opposed to something new to add. */
export const soundsLikeProblem = (text: string) => PROBLEM.test(text);

const VERBS = 'see|view|read|open|find|list|create|add|edit|update|change|delete|remove';
const BLOCKED = new RegExp(
  "\\b(?:can ?not|can't|cant|cannot|could ?n[o']t|unable to|not able to|not allowed to|won't let \\w+|(?:does not|doesn't|do not|don't) let \\w+|should be able to|needs? to be able to|must be able to)\\s+(" +
    VERBS +
    ')\\b(.*)$',
  'i',
);
const mentions = (hay: string, word: string | undefined) => {
  const k = str(word).toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
  return k.length > 2 && hay.toLowerCase().replace(/_/g, ' ').includes(k.replace(/_/g, ' '));
};
/**
 * Reads "managers can't see receipts" as the rule it asks for: who, what they cannot do, and in which list. The kind
 * of person and the list may come from where the report was made. Null when the sentence is not of that kind.
 */
export function problemOps(app: BackedApp, text: string, ctx?: ReportCtx | null): Op[] | null {
  const m = BLOCKED.exec(text);
  if (!m) return null;
  const def = app.def,
    before = text.slice(0, m.index),
    roles = def.brief.roles,
    named = (hay: string) => roles.find((r) => mentions(hay, r.name) || mentions(hay, r.id)),
    role = named(before) || named(text) || (ctx ? roles.find((r) => r.id === ctx.role) : undefined),
    listIn = (hay: string) => def.tables.find((t) => mentions(hay, t.label) || mentions(hay, t.one) || mentions(hay, t.name)),
    table = listIn(m[2]) || listIn(text) || (ctx && ctx.table ? tableOf(def, ctx.table) : undefined);
  if (!role || !table) return null;
  return [{ op: 'set_access', table: table.name, role: role.id, action: m[1].toLowerCase(), value: 'all' }];
}

/**
 * The Tester looks for a reported problem itself: it signs in as a person of the kind the report names and asks for
 * the list, or reads the rule for the action. Null when the change is not about who may do what.
 */
export function testerSees(app: BackedApp, ops: Op[]): { ok: boolean; text: string } | null {
  const o = ops.find((x) => x.op === 'set_access' && x.value !== 'none' && x.value !== false);
  if (!o) return null;
  const def = app.def,
    t = findTable(def, o.table),
    role = findRole(def, o.role),
    act = ACT_WORDS[str(o.action)] || str(o.action);
  if (!t || !role) return null;
  const u = appUsers(app).find((x) => x.role === role.id),
    acc = accOf(def, role.id, t.name),
    lists = t.label.toLowerCase(),
    as = u ? 'Signed in as ' + u.name + ' (' + role.name + '), ' : 'For ' + role.name + ', ';
  if (act === 'list' && u) {
    const res = apiCall(app, u, 'GET', '/api/' + t.name, {}, 'check'),
      total = Number(dbCount(app.id, t.name)) || 0,
      shown = res.status === 200 ? arr(res.data).length : 0;
    if (res.status !== 200) return { ok: true, text: 'I see it too. ' + as + 'I asked for the ' + lists + ' and was refused.' };
    if (acc.list === 'own' && shown < total)
      return { ok: true, text: 'I see it too. ' + as + 'I get ' + shown + ' of the ' + total + ' ' + lists + ': only their own.' };
    return { ok: false, text: 'I could not see it. ' + as + 'I can open all ' + total + ' ' + lists + '.' };
  }
  const can = acc[act as 'create' | 'update' | 'delete'],
    allowed = can === true || can === 'all',
    verb = ACT_VERB[act] || act;
  if (!allowed)
    return {
      ok: true,
      text:
        'I see it too. ' +
        as +
        'the rules ' +
        (can === 'own' ? 'only allow them to ' + verb + ' their own ' : 'do not allow them to ' + verb + ' ') +
        lists +
        '.',
    };
  return { ok: false, text: 'I could not see it. ' + as + 'the rules already allow them to ' + verb + ' ' + lists + '.' };
}

/** At most three questions, worked out from what the change would do. Each has a recommended answer. */
export function questionsFor(app: BackedApp, ops: Op[], said = ''): Question[] {
  const def = app.def,
    out: Question[] = [],
    ask = (text: string, options: string[], recommended: number, apply: (i: number) => void) =>
      out.push({ text, options: options.concat([YOU_DECIDE]), recommended, answered: null, apply });
  ops.forEach((o) => {
    const t = findTable(def, o.table) as AppTable | null;
    if (o.op === 'set_access' && t) {
      const role = findRole(def, o.role),
        act = ACT_WORDS[str(o.action)] || str(o.action);
      if (!role || !t.owner || (act !== 'list' && act !== 'update') || o.value === 'none' || o.value === false) return;
      const acc = accOf(def, role.id, t.name);
      if (acc[act as 'list' | 'update'] !== 'none') return; // they have their own already: this is about everyone's
      // people who add records of this list have some of their own; for the others "their own" would show nothing
      const own = acc.create === true;
      ask(
        'Which ' + t.label.toLowerCase() + ' should ' + role.name + ' ' + ACT_VERB[act] + '?',
        ['All of them', 'Only their own'],
        own ? 1 : 0,
        (i) => {
          o.value = i === 1 ? 'own' : 'all';
        },
      );
    }
    // a name that gives no clue, in a sentence that names no kind of field: ask instead of guessing plain text
    if (o.op === 'add_field' && t && (!o.type || o.type === 'text') && !/\b(text|number|date|money|yes|choice|link|person)\b/i.test(said)) {
      const guess = inferType(snake(o.name)).type,
        others = ['text', 'number', 'date', 'bool', 'longtext'].filter((x) => x !== guess).slice(0, 2),
        types = [guess].concat(others);
      ask(
        'What kind of field is ' + (str(o.label) || label(snake(o.name))) + '?',
        types.map((x) => TYPE_LABEL[x] || label(x)),
        0,
        (i) => {
          o.type = types[i] || guess;
        },
      );
    }
    if (o.op === 'remove_field' && t) {
      const c = findCol(t, o.name);
      if (!c) return;
      const n =
        Number(
          (
            sqlPeek(
              app.id,
              'SELECT COUNT(*) AS n FROM ' + qi(t.name) + ' WHERE ' + qi(c.name) + ' IS NOT NULL AND ' + qi(c.name) + " <> ''",
            )[0] || {}
          ).n,
        ) || 0;
      if (!n) return;
      ask(
        n +
          ' ' +
          (n === 1 ? t.one : t.label).toLowerCase() +
          ' ' +
          (n === 1 ? 'has' : 'have') +
          ' a value in ' +
          c.label +
          '. What should happen to ' +
          (n === 1 ? 'it' : 'them') +
          '?',
        ['Put ' + (n === 1 ? 'it' : 'them') + ' away for 30 days', 'Keep the field'],
        0,
        (i) => {
          if (i === 1) o.op = 'keep';
        },
      );
    }
  });
  return out.slice(0, 3);
}

/* ---------- the flow ---------- */
/** The newest card of one kind that belongs to an improvement. The card is the saved part of the flow, so it is changed in place. */
const lastCard = <C,>(app: AppRecord, type: string, flow: string): C | null => {
  const m = app.chat
    .slice()
    .reverse()
    .find((x) => !!x.card && x.card.type === type && x.card.flow === flow);
  return m ? (m.card as unknown as C) : null;
};
const live = (ops: Op[]) => ops.filter((o) => o.op !== 'keep');
const titleOf = (text: string) => (text.length > 46 ? text.slice(0, 44) + '…' : text);

/**
 * Starts an improvement from the owner's words. `ctx` says where a report was made, so "they cannot see it" can be
 * read without naming who or what. `kind` is the owner's own word on it, when they are trying again.
 */
export async function startImprove(app: AppRecord, said: string, ctx?: ReportCtx | null, kind?: Kind | null) {
  const text = str(said).trim().slice(0, 400);
  if (!text) return;
  const blocked = editBlocked(app);
  if (blocked) return void toast(blocked, 'warning');
  const B = app as BackedApp;
  setChat(true);
  pushChat(app, 'user', text);
  commit();
  let ops = problemOps(B, text, ctx),
    reply = '';
  if (!ops) {
    const read = await readChange(
      B,
      ctx ? text + ' (Reported while signed in as ' + roleName(app.def, ctx.role) + ' on the ' + ctx.screen + ' page.)' : text,
    );
    ops = arr<Op>(read.ops).slice(0, 6);
    reply = str(read.reply);
  }
  if (!ops.length) return void say(app, 'orchestrator', reply || HELP);
  const first = planOps(B, ops);
  const flow: Flow = {
    id: uid('imp'),
    text,
    ctx: ctx || null,
    kind: kind || (soundsLikeProblem(text) ? 'fix' : planOf(app, first.steps, text).kind),
    owned: !!kind,
    ops,
    questions: [],
  };
  const seen = testerSees(B, ops);
  if (seen && !seen.ok) {
    // the Tester could not see the problem, so there is nothing to plan yet
    say(app, 'orchestrator', 'This sounds like a problem with who can do what. I asked the Tester to look.');
    say(app, 'tester', seen.text + ' Tell me who it happened to, and on which page, and I will look again.');
    return void commit();
  }
  if (!first.steps.length) return void say(app, 'orchestrator', first.errors[0] || HELP);
  flow.questions = questionsFor(B, ops, text);
  IMPROVE[app.id] = flow;
  const n = flow.questions.length;
  say(
    app,
    seen ? 'tester' : 'orchestrator',
    (flow.kind === 'fix' ? 'This sounds like a problem to fix.' : 'This is a new feature.') +
      (seen ? ' ' + seen.text : '') +
      (n ? (n === 1 ? ' One question first.' : ' ' + n + ' quick questions first.') : ''),
    {
      type: 'understand',
      flow: flow.id,
      kind: flow.kind,
      seen,
      questions: flow.questions.map((q) => ({ text: q.text, options: q.options, recommended: q.recommended, answered: null })),
    },
  );
  if (!n) propose(app, flow);
  commit();
}

/** The owner corrects what Turnkey took the request to be: a problem to fix, or a new feature. */
export function setImproveKind(app: AppRecord, flowId: string, kind: Kind) {
  const flow = flowOf(app, flowId);
  if (!flow) return;
  flow.kind = kind;
  flow.owned = true;
  const u = lastCard<UnderstandCard>(app, 'understand', flow.id),
    p = lastCard<PlanCard>(app, 'plan', flow.id);
  if (u) u.kind = kind;
  if (p && p.decided == null) p.plan = planOf(app, planOps(app as BackedApp, live(flow.ops)).steps, flow.text, kind);
  commit();
}

/** The owner answers one question. After the last one comes the plan. */
export function answerImprove(app: AppRecord, flowId: string, q: number, option: number) {
  const flow = flowOf(app, flowId),
    c = flow && lastCard<UnderstandCard>(app, 'understand', flow.id),
    Q = flow && flow.questions[q];
  if (!flow || !c || !Q || Q.answered != null) return;
  Q.answered = option;
  c.questions[q].answered = option;
  Q.apply(Q.options[option] === YOU_DECIDE ? Q.recommended : option);
  if (flow.questions.every((x) => x.answered != null)) propose(app, flow);
  commit();
}

/** Shows the plan card and waits. Nothing is changed until the owner presses Go ahead. */
function propose(app: AppRecord, flow: Flow) {
  const B = app as BackedApp,
    ops = live(flow.ops);
  if (!ops.length) {
    delete IMPROVE[app.id];
    return void say(app, 'orchestrator', 'Then nothing needs to change. The app stays as it is.');
  }
  const p = planOps(B, ops);
  if (!p.steps.length) {
    delete IMPROVE[app.id];
    return void say(app, 'orchestrator', p.errors[0] || HELP);
  }
  const plan = planOf(app, p.steps, flow.text, flow.kind);
  say(
    app,
    'orchestrator',
    'Here is the plan. Nothing changes until you say go ahead' +
      (relOf(app) ? ', and people keep version ' + relOf(app)?.v + ' until you release.' : '.') +
      (p.errors.length ? ' I left out one part: ' + p.errors[0] : ''),
    {
      type: 'plan',
      steps: p.steps.map((s) => ({ text: s.text, sql: s.sql || '' })),
      rerun: plan.team.map((w) => w.who),
      skip: plan.notNeeded.map((w) => w.who),
      plan,
      flow: flow.id,
      decided: null,
    },
  );
}

/** Go ahead: the change is built in the draft by the stations it needs, then the owner is asked to try it. */
export async function goAhead(app: AppRecord, flowId: string) {
  const flow = flowOf(app, flowId),
    c = flow && lastCard<PlanCard>(app, 'plan', flow.id);
  if (!flow || !c || c.decided != null) return;
  const blocked = editBlocked(app);
  if (blocked) return void toast(blocked, 'warning');
  const B = app as BackedApp,
    p = planOps(B, live(flow.ops)); // planned again now, so the steps fit the app as it is at this moment
  if (!p.steps.length) {
    c.decided = 'later';
    delete IMPROVE[app.id];
    say(app, 'orchestrator', p.errors[0] || 'Nothing was changed.');
    return void commit();
  }
  c.decided = 'go';
  pushChat(app, 'user', 'Go ahead');
  commit();
  let ok = false;
  try {
    ok = await runChange(B, p.steps, titleOf(flow.text), flow.kind, flow.id); // the change keeps the flow's id, so Try it can release it on its own
  } catch (e) {
    say(app, 'orchestrator', 'The change could not be made: ' + errText(e));
  }
  if (!ok) {
    delete IMPROVE[app.id];
    return void commit();
  }
  const o = flow.ops.find((x) => x.table) || {},
    role = (o.role ? findRole(B.def, o.role)?.id : null) || (flow.ctx ? flow.ctx.role : null),
    table = findTable(app.def, o.table)?.name || (flow.ctx ? flow.ctx.table : null) || null,
    rel = relOf(app);
  say(
    app,
    'orchestrator',
    'It is in the draft. ' +
      (rel ? 'People still have version ' + rel.v + '. ' : '') +
      'Try it' +
      (role ? ' as ' + roleName(app.def, role) : '') +
      ', then tell me whether it works.',
    { type: 'tryit', flow: flow.id, said: flow.text, kind: flow.kind, role, table, state: null },
  );
  commit();
}

/** Not now, or Change the plan: the plan is dropped and nothing was changed. */
export function dropPlan(app: AppRecord, flowId: string, change: boolean) {
  const flow = flowOf(app, flowId),
    c = flow && lastCard<PlanCard>(app, 'plan', flow.id);
  if (!flow || !c || c.decided != null) return;
  c.decided = change ? 'changed' : 'later';
  delete IMPROVE[app.id];
  pushChat(app, 'user', change ? 'Change the plan' : 'Not now');
  say(
    app,
    'orchestrator',
    change ? 'Nothing was changed. Say it again the way you want it.' : 'Nothing was changed. Ask again whenever you want it.',
  );
  commit();
  if (change) openDialog('report', { app: app.id, text: flow.text, kind: flow.owned ? flow.kind : null });
}

/** The owner's verdict after trying the change. */
export function tryVerdict(app: AppRecord, flowId: string, works: boolean) {
  const c = lastCard<TryCard>(app, 'tryit', flowId);
  if (!c || c.state != null) return;
  c.state = works ? 'works' : 'wrong';
  if (IMPROVE[app.id] && IMPROVE[app.id].id === flowId) delete IMPROVE[app.id];
  pushChat(app, 'user', works ? 'It works' : 'Still wrong');
  const rel = relOf(app);
  say(
    app,
    'orchestrator',
    works
      ? rel
        ? 'Good. It waits in the draft, and goes out when you release version ' + verNext(rel.v, suggestKind(app)) + '.'
        : 'Good. It is part of the app now, and goes out with version 1.0.'
      : 'Then tell me what is still wrong. The change stays in the draft' +
          (rel ? ', and people keep version ' + rel.v + ' until you release.' : '.'),
  );
  commit();
  if (!works) openDialog('report', { app: app.id, text: 'Still wrong: ', kind: c.kind });
}

/** Opens the app as the kind of person a change is about, on the page of the list it is about. */
function signInFor(app: AppRecord, pane: Pane, role: string | null, table: string | null) {
  const users = appUsers(app),
    u = (role && users.find((x) => x.role === role)) || users[0];
  if (!u) return;
  const scr = app.def.screens.find((s) => s.roles.includes(u.role) && !!table && s.table === table && s.type !== 'form');
  Object.assign(pane, { uid: u.id, screen: scr ? scr.id : null, rec: null, form: null, sheet: null });
}
export function openDraftAs(app: AppRecord, role: string | null, table: string | null) {
  signInFor(app, stageOf(app).panes[0], role, table);
  U.view[app.id] = 'app';
  notify();
}

/* ---------- before and after ---------- */
/**
 * Builds the version people have now, holding the records the draft holds, so the two can be compared on the same
 * records. It is a private copy: nothing in it is saved, and it is dropped when the comparison closes.
 */
export async function beforeCopy(app: AppRecord): Promise<AppRecord | null> {
  const rel = relOf(app);
  if (!rel || !rel.pack) return null;
  Object.values(S.apps)
    .filter((a) => a.shared && a.shared.preview && a.shared.key.indexOf('cmp') === 0)
    .forEach((a) => dropCopy(a.id)); // a copy left behind when the page was closed with the comparison open
  const tmp = appFromPack(readPack(await unsqueeze(rel.pack)), 'cmp' + Date.now(), true);
  if (tmp.status !== 'ready') {
    dropCopy(tmp.id);
    return null;
  }
  carryData(app, tmp, inverseSteps(draftSteps(app))); // when the records cannot be moved, the copy keeps its demo data
  return tmp;
}
function dropCopy(id: string) {
  try {
    dbDrop(id);
  } catch {
    // it never got a database
  }
  if (S.apps[id] && S.apps[id].shared) delete S.shared[S.apps[id].shared.key];
  delete S.apps[id];
}
export async function openCompare(app: AppRecord, role: string | null, table: string | null) {
  let before: AppRecord | null = null;
  try {
    before = await beforeCopy(app);
  } catch (e) {
    toast('The version people have could not be opened: ' + errText(e), 'danger');
  }
  if (!before) {
    if (relOf(app)) toast('The copy of the released version was let go to save room, so only the draft can be shown.', 'info');
    return openDraftAs(app, role, table);
  }
  const panes = [newPane(2), newPane(3)];
  signInFor(before, panes[0], role, table);
  signInFor(app, panes[1], role, table);
  openDialog('compare', { app: app.id, before: before.id, panes, role });
  commit();
}
function closeCompare(beforeId: string) {
  closeDialog();
  dropCopy(beforeId);
  commit();
}
export function CompareDialog({ p }: { p: { app: string; before: string; panes: Pane[]; role: string | null } }) {
  const app = S.apps[p.app],
    before = S.apps[p.before],
    rel = app ? relOf(app) : null;
  if (!app || !before || !rel) return null;
  return (
    <Dialog
      title={'Before and after' + (p.role ? ', as ' + roleName(app.def, p.role) : '')}
      onClose={() => closeCompare(p.before)}
      cls="compare"
      wide
      foot={
        <Btn className="btn primary" id="cmp-done" data-autofocus onClick={() => closeCompare(p.before)}>
          Done
        </Btn>
      }
    >
      <div className="cmp">
        <div className="cmp-side" id="cmp-before">
          <span className="cmp-h">
            <strong>Before</strong>
            <span className="muted">{'Version ' + rel.v + ', what people have now'}</span>
          </span>
          <div className="device">
            <AppPane app={before} pane={p.panes[0]} quiet />
          </div>
        </div>
        <div className="cmp-side" id="cmp-after">
          <span className="cmp-h">
            <strong>After</strong>
            <span className="muted">The draft, with your change</span>
          </span>
          <div className="device">
            <AppPane app={app} pane={p.panes[1]} quiet />
          </div>
        </div>
      </div>
      <p className="t-cap muted">
        Both sides hold the same records. Anything you do on the Before side is thrown away when you close this.
      </p>
    </Dialog>
  );
}

/* ---------- the cards in the chat ---------- */
/** The four parts of a plan, always in the same order. */
export function PlanParts({ plan, detail }: { plan: ChangePlan; detail?: { text: string; sql?: string }[] }) {
  const sql = (detail || []).filter((s) => s.sql);
  return (
    <>
      <section className="cplan-s">
        <h4>What will change</h4>
        <ul className="cplan-list">
          {plan.changes.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        {sql.length > 0 && (
          <details className="cplan-detail">
            <summary>Show the detail</summary>
            {sql.map((s, i) => (
              <code key={i}>{String(s.sql).replace(/\s+/g, ' ')}</code>
            ))}
          </details>
        )}
      </section>
      <section className="cplan-s">
        <h4>Who works on it</h4>
        <ul className="cplan-team">
          {plan.team.map((w) => (
            <li key={w.agent + w.why}>
              <strong>{w.who}</strong>
              <span>{w.why}</span>
            </li>
          ))}
        </ul>
        {plan.notNeeded.length > 0 && (
          <p className="cplan-skip muted" title={plan.notNeeded.map((w) => w.who + ': ' + w.why).join('\n')}>
            {'Not needed for this change: '}
            {plan.notNeeded.map((w) => w.who).join(', ')}
            {'.'}
          </p>
        )}
      </section>
      <section className="cplan-s">
        <h4>
          Your records
          <span className={'badge b-' + TONE[plan.records.level]}>{plan.records.label}</span>
        </h4>
        <p>{plan.records.text}</p>
      </section>
      {plan.access.gains.length > 0 && (
        <p className="cplan-access">
          <Icon n="warning" s="16" />
          <span>
            <strong>More people will see or do something. </strong>
            {plan.access.gains.join(' ')}
          </span>
        </p>
      )}
      {plan.access.loses.length > 0 && (
        <p className="cplan-access">
          <Icon n="warning" s="16" />
          <span>
            <strong>Some people lose access. </strong>
            {plan.access.loses.join(' ')}
          </span>
        </p>
      )}
    </>
  );
}

/** The plan card under a chat message. A plan that came from the Improve box waits for the owner. */
export function ChangePlanCard({ app, c }: { app: AppRecord; c: PlanCard }) {
  const plan = c.plan;
  if (!plan) return null;
  const waiting = !!c.flow && c.decided == null,
    flow = c.flow ? flowOf(app, c.flow) : null,
    removes = plan.records.level === 'removes';
  return (
    <div className={cx('gcard', 'cplan', removes && 'warn')}>
      <div className="gc-h cplan-h">
        <Icon n="branch" s="16" />
        <span className="grow">
          {'Plan: '}
          {plan.title}
        </span>
        <span className="badge b-info cplan-kind">
          {KIND[plan.kind]}
          {plan.becomes ? ', becomes version ' + plan.becomes : ''}
        </span>
      </div>
      <PlanParts plan={plan} detail={c.steps} />
      {c.flow &&
        (waiting && flow ? (
          <div className="row wrap cplan-acts">
            <Btn className="btn primary sm" data-act="go" onClick={() => void goAhead(app, flow.id)}>
              {removes ? 'Put the values away and go ahead' : 'Go ahead'}
            </Btn>
            <Btn className="btn sm" data-act="change" onClick={() => dropPlan(app, flow.id, true)}>
              Change the plan
            </Btn>
            <Btn className="btn subtle sm" data-act="later" onClick={() => dropPlan(app, flow.id, false)}>
              Not now
            </Btn>
          </div>
        ) : (
          <span className={c.decided === 'go' ? 'badge b-success' : 't-cap muted'}>
            {c.decided === 'go' ? 'You said go ahead' : c.decided ? 'Not done: nothing was changed' : 'No longer waiting for an answer.'}
          </span>
        ))}
    </div>
  );
}

/** What Turnkey took the request to be, what the Tester saw, and the questions. */
export function UnderstandBox({ app, c }: { app: AppRecord; c: UnderstandCard }) {
  const flow = flowOf(app, c.flow),
    plan = lastCard<PlanCard>(app, 'plan', c.flow),
    open = !!flow && (!plan || plan.decided == null);
  return (
    <div className="gcard ask understand">
      <div className="gc-h">
        <Icon n="questionChat" s="16" />
        <span className="grow">{c.kind === 'fix' ? 'A problem to fix' : 'A new feature'}</span>
        {open && (
          <button className="link-btn" data-act="kind" onClick={() => setImproveKind(app, c.flow, c.kind === 'fix' ? 'feature' : 'fix')}>
            {c.kind === 'fix' ? 'It is a new feature' : 'It is a problem to fix'}
          </button>
        )}
      </div>
      {c.questions.map((q, i) => (
        <div key={i} className="col gap4 understand-q">
          <strong>{q.text}</strong>
          {q.options.map((o, k) => (
            <button
              key={k}
              className={cx('opt', q.answered === k && 'on')}
              disabled={!flow || q.answered != null}
              onClick={() => answerImprove(app, c.flow, i, k)}
            >
              <span className="grow">{o}</span>
              {k === q.recommended && <span className="badge b-info">Recommended</span>}
              {q.answered === k && <Icon n="check" s="16" />}
            </button>
          ))}
        </div>
      ))}
      {!flow && c.questions.some((q) => q.answered == null) && <span className="t-cap muted">No longer waiting for an answer.</span>}
    </div>
  );
}

/** Try the change as the person it is about, beside the version people have, then say whether it works. */
export function TryItCard({ app, c }: { app: AppRecord; c: TryCard }) {
  const [busy, setBusy] = useState(false);
  const rel = relOf(app),
    who = c.role ? roleName(app.def, c.role) : '';
  const compare = async () => {
    setBusy(true);
    await openCompare(app, c.role, c.table);
    setBusy(false);
  };
  // the other changes in the draft keep waiting; the code for this loads the first time it is pressed
  const alone = async () => {
    setBusy(true);
    try {
      await (await import('./release-one')).releaseAlone(app, [c.flow]);
    } catch (e) {
      toast(errText(e), 'danger');
    }
    setBusy(false);
  };
  return (
    <div className={cx('gcard', 'tryit', c.state === 'works' && 'ok')}>
      <div className="gc-h">
        <Icon n="eye" s="16" />
        Try it
      </div>
      <span>
        {c.kind === 'fix' ? 'You said: "' + c.said + '". ' : ''}
        {rel && rel.pack && isDirty(app)
          ? 'See version ' + rel.v + ' and the draft side by side' + (who ? ', both signed in as ' + who + '.' : '.')
          : 'Open the app' + (who ? ' as ' + who : '') + ' and look.'}
      </span>
      <div className="row wrap">
        {rel && rel.pack && isDirty(app) ? (
          <Btn className="btn sm" data-act="compare" disabled={busy} onClick={() => void compare()}>
            {busy ? <Spinner /> : <Icon n="split" s="16" />}
            Before and after
          </Btn>
        ) : (
          <Btn className="btn sm" data-act="open" onClick={() => openDraftAs(app, c.role, c.table)}>
            <Icon n="eye" s="16" />
            Open the app
          </Btn>
        )}
        {c.state == null ? (
          <>
            <Btn className="btn primary sm" data-act="works" onClick={() => tryVerdict(app, c.flow, true)}>
              It works
            </Btn>
            <Btn className="btn sm" data-act="wrong" onClick={() => tryVerdict(app, c.flow, false)}>
              Still wrong
            </Btn>
          </>
        ) : (
          <span className={'badge b-' + (c.state === 'works' ? 'success' : 'warning')}>
            {c.state === 'works' ? 'You said it works' : 'You said it is still wrong'}
          </span>
        )}
        {c.state === 'works' && rel && isDirty(app) && (
          <Btn
            className="btn sm"
            data-act="release"
            onClick={() => {
              U.view[app.id] = 'release';
              notify();
            }}
          >
            <Icon n="rocket" s="16" />
            {'Release it as ' + verNext(rel.v, suggestKind(app))}
          </Btn>
        )}
        {c.state === 'works' && rel && aloneOffered(app, c.flow) && (
          <Btn className="btn sm" data-act="alone" disabled={busy} onClick={() => void alone()}>
            {busy ? <Spinner /> : <Icon n="rocket" s="16" />}
            {'Release only this ' + (c.kind === 'fix' ? 'fix' : 'change') + ' now'}
          </Btn>
        )}
      </div>
    </div>
  );
}

/* ---------- where it starts ---------- */
/** Where the owner is in the app right now: who they are signed in as, on which page, with which record open. */
export function reportCtx(app: AppRecord): ReportCtx | null {
  const pane = stageOf(app).panes[0],
    u = appUsers(app).find((x) => x.id === pane.uid);
  if (!u) return null;
  const screens = app.def.screens.filter((s) => s.roles.includes(u.role)),
    scr = screens.find((s) => s.id === pane.screen) || screens[0];
  if (!scr) return null;
  return {
    user: u.name,
    role: u.role,
    screen: scr.name,
    table: (pane.rec && pane.rec.table) || scr.table || null,
    record: pane.rec ? tableOf(app.def, pane.rec.table)?.one || null : null,
  };
}
/** "Report a problem" while using the app, and the way back in after "Change the plan" or "Still wrong". */
export function ReportDialog({ p }: { p: { app: string; text?: string; kind?: Kind | null; here?: boolean } }) {
  const [text, setText] = useState(p.text || '');
  const app = S.apps[p.app];
  if (!app) return null;
  const ctx = p.here ? reportCtx(app) : null;
  const send = () => {
    closeDialog();
    void startImprove(app, text, ctx, p.kind || null);
  };
  return (
    <Dialog
      title={p.here ? 'Report a problem' : 'Say what should change'}
      onClose={closeDialog}
      cls="report"
      foot={
        <>
          <Btn className="btn" onClick={closeDialog}>
            Cancel
          </Btn>
          <Btn className="btn primary" id="report-go" disabled={!text.trim()} onClick={send}>
            Send
          </Btn>
        </>
      }
    >
      <div className="col gap12">
        <Field
          id="report-text"
          label={p.here ? 'What is wrong?' : 'What is wrong, or what would you like to change?'}
          hint="Your own words are fine. You see a plan before anything changes."
        >
          <Textarea
            native
            className="textarea"
            id="report-text"
            data-autofocus
            rows={3}
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          />
        </Field>
        {ctx && (
          <p className="t-cap muted" id="report-ctx">
            {'Sent with it: you were signed in as ' +
              ctx.user +
              ' (' +
              roleName(app.def, ctx.role) +
              '), on the ' +
              ctx.screen +
              ' page' +
              (ctx.record ? ', with a ' + ctx.record.toLowerCase() + ' open.' : '.')}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** The box on the Release page: something wrong, or something missing? */
export function ImproveBox({ app }: { app: AppRecord }) {
  const [text, setText] = useState('');
  const blocked = editBlocked(app),
    ideas = suggestChanges(app).slice(0, 3),
    rel = relOf(app);
  const send = (x: string) => {
    setText('');
    void startImprove(app, x);
  };
  return (
    <div className="col gap8 improve" id="improve">
      <h3 className="widget-h">Something wrong, or something missing?</h3>
      <p className="muted">
        {'Say it in your own words. You get a plan first, and ' +
          (rel ? 'people keep version ' + rel.v + ' until you release the change.' : 'nothing changes until you say go ahead.')}
      </p>
      <Textarea
        native
        className="textarea"
        id="improve-text"
        aria-label="What is wrong, or what would you like to change?"
        placeholder="What is wrong, or what would you like to change?"
        rows={2}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <div className="row wrap">
        <Btn
          className="btn primary"
          id="improve-go"
          disabled={!text.trim() || !!blocked}
          title={blocked || undefined}
          onClick={() => send(text)}
        >
          <Icon n="wand" s="16" />
          Fix or add something
        </Btn>
        {ideas.map((x) => (
          <button key={x} className="chip" disabled={!!blocked} onClick={() => send(x)}>
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}
