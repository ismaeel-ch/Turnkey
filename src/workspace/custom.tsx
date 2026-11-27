import type { AppTable, BackedDef, BriefedDef, ColumnDef, Untrusted } from '@/shared/types/app';
import type { AppFlow, AppRecord, Dict, AddedAgent, Review, ReviewFinding, Run } from '@/shared/types/workspace';
import type { Station } from './line';
import { teamFor } from '@/shared/plan/team';
import {
  NO_MODEL,
  PHONE,
  S,
  U,
  NARROW,
  arr,
  cap,
  chatShown,
  clone,
  commit,
  confirmBox,
  emit,
  errText,
  label,
  notify,
  online,
  setChat,
  sleep,
  snake,
  str,
  toast,
  toolCall,
  uid,
  liveModelOn,
} from './core';
import { dbCount, dbExists, dbRollback, dbSavepoint, qi, sqlPeek } from './db';
import type { SqlRow } from '@/shared/types/sqljs';
import { ACCENTS, LIMITS, accOf, colOf, tableOf } from './engine';
import { TESTS, runTestsSync } from './tests';
import {
  AGENTS,
  HEAD,
  PENDING,
  RUNS,
  STATIONS,
  Stopped,
  callModel,
  ctxOf,
  newRun,
  pAccess,
  pFlow,
  pTables,
  pace,
  teamPlanOf,
  pushChat,
  runBuild,
  say,
  stationIdx,
  stepEnd,
  stepStart,
} from './line';
import { applyChangeSync, parseChange, planOps } from './changes';
import type { ParsedChange } from './changes';
import { keepFix } from './tester';
import { Icon } from './ui';
import { TEAM_BUSY, rebuildAsk } from './shell-a';
import { buildMode } from './build-mode';
import { TEAMS } from './team';
import { REVIEWERS, regStep } from './reviewers';
import type { Reviewer } from './reviewers';
import { queueRerun } from './rerun';

/* ===== Turnkey prototype · the workflow is yours: approvals, review steps, instructions, attempts =====
   The build workflow is shared state (app.flow). The owner edits it on the canvas, in the inspector or in the settings dialog.
   The orchestrator edits it when asked in chat, by calling the same tools as frontend tool calls. Either way the change is one
   STATE_DELTA on /workflow, and only the agents that change touches run again.
   What can change: where the line stops for the owner's approval, which review steps sit after a station (from a fixed catalog),
   a standing instruction per agent, how many attempts a station gets, and whether an agent or the built-in rules do a step.
   What cannot: the order of the six stations, because each one needs what the one before it made. */
export const APPROVE_AT = ['research', 'database', 'backend', 'views', 'screens']; // stations the line can stop after
export const RULES_AT = ['views', 'screens']; // stations the owner can give to code instead of the agent
/** Stations code can do. A plan may also give the rules step to code (one kind of person, no stages); the owner cannot. */
export const CODE_AT = ['backend', ...RULES_AT];
export const NOTE_FOR = ['researcher', 'database', 'backend', 'views', 'ui'];
export const NOTE_MAX = 280;
export const STEP_AT = ['database', 'backend', 'views', 'screens', 'walkthrough'],
  STEP_MAX = 8,
  STEP_ICONS = ['bot', 'wand', 'sparkle', 'puzzle', 'target', 'glasses', 'tag', 'wrench'],
  JOB_MAX = 400;
export const LIB = () => Object.keys(REVIEWERS).filter((k) => !REVIEWERS[k].custom); // the library; agents the owner described are registered beside it, one id each
export const reviewerAt = (stId: string) => ['data', 'security', 'insight', 'wording'].find((id) => REVIEWERS[id].after === stId) || null;
export const stepAfter = (f: AppFlow, id: string): string => (f.at && f.at[id]) || REVIEWERS[id]?.after;
export const stepAuto = (f: AppFlow, id: string) => (f.auto && id in f.auto ? !!f.auto[id] : !!REVIEWERS[id]?.auto);
export const stepsAt = (f: AppFlow, stId: string) => f.reviewers.filter((id) => REVIEWERS[id] && stepAfter(f, id) === stId);
export const normAgent = (a: Untrusted, i: number): AddedAgent | null => {
  a = a || {};
  const name = str(a.name).replace(/\s+/g, ' ').slice(0, 32),
    job = str(a.job).replace(/\s+/g, ' ').slice(0, JOB_MAX),
    id = /^x[a-z0-9_]{3,24}$/.test(str(a.id)) ? a.id : null;
  return id && name && job
    ? {
        id,
        name,
        job,
        after: STEP_AT.includes(a.after) ? a.after : 'screens',
        mode: a.mode === 'advise' ? 'advise' : 'apply',
        icon: STEP_ICONS.includes(a.icon) ? a.icon : STEP_ICONS[i % STEP_ICONS.length],
        acc: ACCENTS.includes(a.acc) ? a.acc : ['grape', 'seafoam', 'marigold', 'magenta', 'navy', 'pumpkin'][i % 6],
      }
    : null;
};
export const stName = (id: string): string => STATIONS.find((s) => s.id === id)?.name || label(id);
export const firstStationOf = (agent: string) => STATIONS.findIndex((s) => s.agent === agent);
export const agentThe = (id: string, low?: boolean) => {
  // the builder agents' names are plain nouns ("List builder"), so they read without the word "agent"
  const t = 'The ' + AGENTS[id].name;
  return low ? 't' + t.slice(1) : t;
};

/* ---------- the workflow as data ---------- */
export const blankFlow = (): AppFlow => ({
  attempts: 3,
  approve: {},
  notes: {},
  by: {},
  reviewers: [],
  agents: [],
  at: {},
  auto: {},
});
export function normFlow(f: Untrusted): AppFlow {
  // whatever was stored, shared or typed becomes a valid workflow: unknown stations, agents and reviewers are dropped
  const o = blankFlow();
  f = f && typeof f === 'object' ? f : {};
  const n = Math.round(Number(f.attempts));
  o.attempts = n >= 1 && n <= 3 ? n : 3;
  APPROVE_AT.forEach((s) => {
    if (f.approve && f.approve[s]) o.approve[s] = true;
  });
  NOTE_FOR.forEach((a) => {
    const t = str(f.notes && f.notes[a])
      .replace(/\s+/g, ' ')
      .slice(0, NOTE_MAX);
    if (t) o.notes[a] = t;
  });
  CODE_AT.forEach((s) => {
    if (f.by && f.by[s] === 'rules') o.by[s] = 'rules';
  });
  arr(f.agents).forEach((a: Untrusted, i) => {
    const x = normAgent(a, i);
    if (x && o.agents.length < 6 && !o.agents.some((y) => y.id === x.id)) {
      o.agents.push(x);
      regStep(x.id, {
        custom: true,
        name: x.name,
        short: x.name,
        after: x.after,
        icon: x.icon,
        acc: x.acc,
        reads: 'the app so far',
        job: x.job,
        auto: x.mode === 'apply',
      });
    }
  });
  arr<string>(f.reviewers).forEach((id) => {
    if (
      REVIEWERS[id] &&
      (!REVIEWERS[id].custom || o.agents.some((a) => a.id === id)) &&
      !o.reviewers.includes(id) &&
      o.reviewers.length < STEP_MAX
    )
      o.reviewers.push(id);
  });
  o.agents = o.agents.filter((a) => o.reviewers.includes(a.id));
  o.reviewers.forEach((id) => {
    const lib = !REVIEWERS[id].custom,
      to = f.at && f.at[id];
    if (lib && STEP_AT.includes(to) && to !== REVIEWERS[id].after && stationIdx(to) >= stationIdx(REVIEWERS[id].after)) o.at[id] = to;
    if (f.auto && id in f.auto && !!f.auto[id] !== !!REVIEWERS[id].auto && lib) o.auto[id] = !!f.auto[id];
  });
  const order = arr<string>(f.reviewers);
  o.reviewers.sort((a, b) => stationIdx(stepAfter(o, a)) - stationIdx(stepAfter(o, b)) || order.indexOf(a) - order.indexOf(b));
  return o;
}
export const flowDefault = () => normFlow((S.flows || {})[String(S.session)]);
export function flowOf(app: AppRecord): AppFlow {
  if (!app.flow) app.flow = blankFlow();
  if (!app.reviews) app.reviews = {};
  return app.flow;
}
export const flowSame = (a: unknown, b: unknown) => JSON.stringify(normFlow(a)) === JSON.stringify(normFlow(b));
export function flowList(f: AppFlow) {
  // the workflow in words: one short line for each thing that differs from the standard one
  const out: { icon: string; text: string }[] = [];
  APPROVE_AT.forEach((s) => {
    if (f.approve[s])
      out.push({
        icon: 'handRight',
        text: 'Asks you after ' + stName(s),
      });
  });
  f.reviewers.forEach((id) =>
    out.push({
      icon: REVIEWERS[id].icon,
      text:
        (REVIEWERS[id].custom ? 'Your agent “' + REVIEWERS[id].name + '”' : REVIEWERS[id].short) +
        ' after ' +
        stName(stepAfter(f, id)) +
        (stepAuto(f, id) ? ', applies its changes' : ''),
    }),
  );
  CODE_AT.forEach((s) => {
    if (f.by[s] === 'rules')
      out.push({
        icon: 'code',
        text: stName(s) + ' built by rules',
      });
  });
  NOTE_FOR.forEach((a) => {
    if (f.notes[a])
      out.push({
        icon: 'note',
        text: 'Instruction for ' + agentThe(a, true),
      });
  });
  if (f.attempts !== 3)
    out.push({
      icon: 'undo',
      text: f.attempts + (f.attempts === 1 ? ' attempt' : ' attempts') + ' per station',
    });
  return out;
}

/* ---------- the tools that change it. The owner's clicks and the orchestrator's tool calls both land here. ---------- */
/** What a workflow tool did: `same` when nothing changed, else the delta and a line for the chat. */
export interface FlowResult {
  same?: boolean;
  text: string;
  op?: string;
  path?: string;
  value?: unknown;
  icon?: string;
  /** a step to run now that it is in the workflow */
  review?: string;
  /** the station a build should run again from */
  from?: number | null;
}
export const FLOW_TOOLS: Dict<(app: AppRecord, a: Untrusted) => FlowResult> = {
  set_approval(app, a) {
    const s = a.station,
      f = flowOf(app),
      on = !!a.on;
    if (!APPROVE_AT.includes(s))
      throw new Error(
        s === 'walkthrough'
          ? 'The walkthrough is the last step, so there is nothing after it to hold back. The app is ready the moment it passes.'
          : 'I do not know that station.',
      );
    if (!!f.approve[s] === on)
      return {
        same: true,
        text: on ? 'I already stop after ' + stName(s) + ' for your approval.' : 'I was not stopping after ' + stName(s) + '.',
      };
    if (on) f.approve[s] = true;
    else delete f.approve[s];
    return {
      path: '/workflow/approve/' + s,
      value: on,
      icon: 'handRight',
      text: on
        ? 'I will stop after ' + stName(s) + ' and wait for your approval before ' + stName(STATIONS[stationIdx(s) + 1].id) + ' starts.'
        : 'I will no longer stop after ' + stName(s) + '.',
    };
  },
  add_step(app, a) {
    // a step from the library, or an agent the owner describes: a name, a job in plain words, and where it sits
    const f = flowOf(app);
    let id: string = a.step,
      rv: Reviewer | null = id ? REVIEWERS[id] : null;
    const after = a.after,
      mode = a.mode === 'advise' ? 'advise' : a.mode === 'apply' ? 'apply' : null;
    if (after && !STEP_AT.includes(after))
      throw new Error(
        after === 'research'
          ? 'After Research there is only a brief, and nothing an added agent could change yet. Steps can sit after Database, Backend, Views, Screens or Walkthrough.'
          : 'Steps can sit after Database, Backend, Views, Screens or Walkthrough.',
      );
    if (f.reviewers.length >= STEP_MAX && !(rv && f.reviewers.includes(id)))
      throw new Error(
        'A workflow holds up to ' + STEP_MAX + ' added steps, so the build stays quick and the spend stays small. Remove one first.',
      );
    if (!id) {
      const name = str(a.name)
          .replace(/\s+/g, ' ')
          .replace(/^(an?|the) /i, '')
          .replace(/ agent$/i, '')
          .slice(0, 32),
        job = str(a.job).replace(/\s+/g, ' ').slice(0, JOB_MAX);
      if (!name) throw new Error('The agent needs a name, for example “Table tidier”.');
      if (job.length < 8)
        throw new Error('Say in a sentence what ' + name + ' should do, for example “Make the rows compact. Use the colour teal.”');
      if (f.agents.length >= 6) throw new Error('A workflow holds up to six agents of your own. Remove one first.');
      if (f.agents.some((x) => x.name.toLowerCase() === name.toLowerCase()))
        throw new Error('There is already an agent called ' + name + ' in this workflow.');
      const ag = normAgent(
        {
          id:
            'x' +
            uid('')
              .replace(/[^a-z0-9]/gi, '')
              .toLowerCase()
              .slice(-8),
          name: cap(name),
          job,
          after: after || 'screens',
          mode: mode || 'apply',
        },
        f.agents.length,
      );
      if (!ag) throw new Error('The agent needs a name and a job.');
      f.agents.push(ag);
      f.reviewers.push(ag.id);
      rv = regStep(ag.id, {
        custom: true,
        name: ag.name,
        short: ag.name,
        after: ag.after,
        icon: ag.icon,
        acc: ag.acc,
        reads: 'the app so far',
        job: ag.job,
        auto: ag.mode === 'apply',
      });
      id = ag.id;
      return {
        op: 'add',
        path: '/workflow/agents/-',
        value: {
          name: ag.name,
          after: ag.after,
          mode: ag.mode,
        },
        icon: ag.icon,
        review: id,
        text:
          'Created your agent “' +
          ag.name +
          '” after ' +
          stName(ag.after) +
          '. ' +
          (ag.mode === 'apply'
            ? 'Its changes are applied when they pass every check.'
            : 'It advises: nothing changes until you apply a finding.'),
      };
    }
    if (!rv || (rv.custom && !f.agents.some((x) => x.id === id)))
      throw new Error(
        'The steps in the library are: ' +
          LIB()
            .map((k) => REVIEWERS[k].short.toLowerCase())
            .join(', ') +
          '. Or describe an agent of your own.',
      );
    if (f.reviewers.includes(id))
      return {
        same: true,
        text: rv.short + ' is already in the workflow, after ' + stName(stepAfter(f, id)) + '.',
      };
    if (after && stationIdx(after) < stationIdx(rv.after))
      throw new Error(rv.short + ' reads ' + rv.reads + ', so it cannot sit before ' + stName(rv.after) + '.');
    f.reviewers.push(id);
    if (after && after !== rv.after) f.at[id] = after;
    if (mode && (mode === 'apply') !== !!rv.auto) f.auto[id] = mode === 'apply';
    return {
      op: 'add',
      path: '/workflow/reviewers/-',
      value: id,
      icon: rv.icon,
      review: id,
      text:
        'Added ' +
        rv.short +
        ' after ' +
        stName(stepAfter(f, id)) +
        '. ' +
        (stepAuto(f, id)
          ? 'Its changes are applied when they pass every check.'
          : 'It only advises: nothing changes until you apply a finding.'),
    };
  },
  remove_step(app, a) {
    const id = a.step,
      rv = REVIEWERS[id],
      f = flowOf(app);
    if (!rv) throw new Error('I do not know that step.');
    if (!f.reviewers.includes(id))
      return {
        same: true,
        text: 'There is no ' + rv.short.toLowerCase() + ' in this workflow.',
      };
    const was = stepAfter(f, id);
    f.reviewers = f.reviewers.filter((x) => x !== id);
    f.agents = f.agents.filter((x) => x.id !== id);
    delete f.at[id];
    delete f.auto[id];
    delete app.reviews[id];
    if (U.sel[app.id] === 'rv_' + id) U.sel[app.id] = was;
    return {
      op: 'remove',
      path: '/workflow/reviewers/' + id,
      value: null,
      icon: rv.icon,
      text: 'Removed ' + (rv.custom ? 'your agent “' + rv.name + '”' : rv.short) + '. What it already changed stays in the app.',
    };
  },
  move_step(app, a) {
    const id = a.step,
      rv = REVIEWERS[id],
      f = flowOf(app),
      to = a.after;
    if (!rv || !f.reviewers.includes(id)) throw new Error('That step is not in this workflow.');
    if (!STEP_AT.includes(to)) throw new Error('Steps can sit after Database, Backend, Views, Screens or Walkthrough.');
    if (stepAfter(f, id) === to)
      return {
        same: true,
        text: rv.short + ' already sits after ' + stName(to) + '.',
      };
    if (!rv.custom && stationIdx(to) < stationIdx(rv.after))
      throw new Error(rv.short + ' reads ' + rv.reads + ', so it cannot sit before ' + stName(rv.after) + '.');
    if (rv.custom) {
      (f.agents.find((x) => x.id === id) as AddedAgent).after = to;
      rv.after = to;
    } else if (to === rv.after) delete f.at[id];
    else f.at[id] = to;
    delete app.reviews[id];
    return {
      path: '/workflow/steps/' + id + '/after',
      value: to,
      icon: rv.icon,
      review: id,
      text: 'Moved ' + rv.short + ' to after ' + stName(to) + '.',
    };
  },
  set_mode(app, a) {
    const id = a.step,
      rv = REVIEWERS[id],
      f = flowOf(app),
      auto = a.mode === 'apply';
    if (!rv || !f.reviewers.includes(id)) throw new Error('That step is not in this workflow.');
    if (stepAuto(f, id) === auto)
      return {
        same: true,
        text: rv.short + (auto ? ' already applies its changes.' : ' already only advises.'),
      };
    if (rv.custom) {
      (f.agents.find((x) => x.id === id) as AddedAgent).mode = auto ? 'apply' : 'advise';
      rv.auto = auto;
    } else if (auto === !!rv.auto) delete f.auto[id];
    else f.auto[id] = auto;
    return {
      path: '/workflow/steps/' + id + '/mode',
      value: auto ? 'apply' : 'advise',
      icon: auto ? 'wand' : 'glasses',
      text: auto
        ? rv.short + ' will apply its changes itself. Each one still has to pass every check, and anything that deletes data waits for you.'
        : rv.short + ' will only advise. Nothing changes until you apply a finding.',
    };
  },
  edit_step(app, a) {
    const id = a.step,
      rv = REVIEWERS[id],
      f = flowOf(app),
      ag = f.agents.find((x) => x.id === id);
    if (!rv || !ag) throw new Error('Only an agent of your own can be rewritten.');
    const job = str(a.job).replace(/\s+/g, ' ').slice(0, JOB_MAX);
    if (job.length < 8) throw new Error('Say in a sentence what ' + ag.name + ' should do.');
    if (job === ag.job)
      return {
        same: true,
        text: ag.name + ' already has that job.',
      };
    ag.job = job;
    rv.job = job;
    AGENTS['rv_' + id].role = job;
    delete app.reviews[id];
    return {
      path: '/workflow/agents/' + id + '/job',
      value: job,
      icon: 'edit',
      review: id,
      text: 'Rewrote what “' + ag.name + '” does.',
    };
  },
  add_review(app, a) {
    return FLOW_TOOLS.add_step(app, {
      step: a.reviewer,
    });
  },
  remove_review(app, a) {
    return FLOW_TOOLS.remove_step(app, {
      step: a.reviewer,
    });
  },
  set_note(app, a) {
    const ag = a.agent,
      f = flowOf(app),
      t = str(a.text).replace(/\s+/g, ' ').slice(0, NOTE_MAX);
    if (!NOTE_FOR.includes(ag))
      throw new Error('I can keep an instruction for the ' + NOTE_FOR.map((id) => AGENTS[id].name).join(', ').replace(/, ([^,]+)$/, ' and $1') + '.');
    if ((f.notes[ag] || '') === t)
      return {
        same: true,
        text: t ? agentThe(ag) + ' already has that instruction.' : agentThe(ag) + ' has no instruction to clear.',
      };
    if (t) f.notes[ag] = t;
    else delete f.notes[ag];
    const liveApp = app.mode === 'live';
    return {
      path: '/workflow/notes/' + ag,
      value: t || null,
      icon: 'note',
      from: t && liveApp ? firstStationOf(ag) : null,
      text: t
        ? agentThe(ag) +
          ' will be told, every time: “' +
          t +
          '”.' +
          (liveApp ? '' : ' A saved build replays recorded work, so this takes effect in Live builds.')
        : 'Cleared the instruction for ' + agentThe(ag, true) + '.',
    };
  },
  set_attempts(app, a) {
    const n = Math.round(Number(a.n)),
      f = flowOf(app);
    if (!(n >= 1 && n <= 3)) throw new Error('A station can have 1, 2 or 3 attempts.');
    if (f.attempts === n)
      return {
        same: true,
        text: 'Stations already get ' + n + (n === 1 ? ' attempt.' : ' attempts.'),
      };
    f.attempts = n;
    return {
      path: '/workflow/attempts',
      value: n,
      icon: 'undo',
      text:
        n === 1
          ? 'Each station gets one attempt. If its checks fail I repair what I can or use the safe default, and nothing is sent back.'
          : 'Each station gets ' +
            n +
            ' attempts: failed work is sent back ' +
            (n === 2 ? 'once' : 'twice') +
            ' at most, then I use the safe default.',
    };
  },
  set_worker(app, a) {
    const s = a.station,
      by = a.by === 'rules' ? 'rules' : 'agent',
      f = flowOf(app),
      st = STATIONS[stationIdx(s)];
    if (!RULES_AT.includes(s))
      throw new Error(
        s === 'walkthrough'
          ? 'The walkthrough is already played by code.'
          : s === 'backend'
            ? 'The workflow and the access rules decide who may do what, so that step keeps its agent. The rules can build the views and the screens.'
            : 'The ' +
              (s === 'research' ? 'brief' : 'tables') +
              ' cannot be written by rules: the rest of the app is built from them, so that step keeps its agent. The rules can build the views and the screens.',
      );
    if ((f.by[s] === 'rules' ? 'rules' : 'agent') === by)
      return {
        same: true,
        text: stName(s) + ' is already done by ' + (by === 'rules' ? 'the built-in rules.' : agentThe(st.agent, true) + '.'),
      };
    if (by === 'rules') f.by[s] = 'rules';
    else delete f.by[s];
    return {
      path: '/workflow/by/' + s,
      value: by,
      icon: by === 'rules' ? 'code' : AGENTS[st.agent].icon,
      from: stationIdx(s),
      text:
        by === 'rules'
          ? stName(s) + ' will be built by the built-in rules: plainer output, no agent and no model call.'
          : stName(s) + ' is back with ' + agentThe(st.agent, true) + '.',
    };
  },
  reset(app) {
    if (flowSame(flowOf(app), blankFlow()))
      return {
        same: true,
        text: 'This app already uses the standard workflow.',
      };
    app.flow = blankFlow();
    app.reviews = {};
    if (String(U.sel[app.id] || '').indexOf('rv_') === 0) U.sel[app.id] = 'research';
    return {
      path: '/workflow',
      value: 'standard',
      icon: 'reset',
      text: 'The workflow is back to the standard one: six stations and the Tester, a gate after each, three attempts, no added steps.',
    };
  },
  restore(app, a) {
    // undo: put back the workflow a card remembers
    app.flow = normFlow(a.flow);
    Object.keys(app.reviews).forEach((id) => {
      if (!app.flow.reviewers.includes(id)) delete app.reviews[id];
    });
    return {
      path: '/workflow',
      value: 'restored',
      icon: 'undo',
      text: 'Put the workflow back the way it was.',
    };
  },
  save_default(app) {
    if (!S.flows) S.flows = {};
    S.flows[String(S.session)] = clone(normFlow(flowOf(app)));
    return {
      path: '/defaults/workflow',
      value: flowList(flowOf(app)).length ? 'custom' : 'standard',
      icon: 'save',
      text: 'New apps you build will start with this workflow.',
    };
  },
};
/** One call of a workflow tool, from a click or from the chat. */
export interface FlowCall {
  tool: string;
  args?: Untrusted;
}
export type FlowApplied = ReturnType<typeof flowApply>;
export function flowApply(app: AppRecord, calls: FlowCall[], by: string) {
  // by: 'you' (canvas, inspector, dialog) or 'orchestrator' (asked in chat, so each change is a frontend tool call)
  const before = JSON.stringify(normFlow(flowOf(app))),
    done: { icon?: string; text: string; same?: boolean }[] = [],
    errors: string[] = [],
    fx: { review: string[]; from: number | null } = {
      review: [],
      from: null,
    },
    ctx = {
      agent: 'orchestrator',
      appId: app.id,
      runId: (RUNS[app.id] || {}).runId,
    };
  arr<FlowCall>(calls).forEach((c) => {
    const fn = FLOW_TOOLS[c.tool];
    let r: FlowResult | null = null;
    if (!fn) return void errors.push('I do not know how to do that to the workflow.');
    if (by === 'orchestrator') {
      const t = toolCall(
        ctx,
        'workflow.' + c.tool,
        c.args || {},
        () => {
          const out = fn(app, c.args || {});
          r = out;
          return {
            changed: !out.same,
            note: out.text,
          };
        },
        'frontend',
      );
      if (!t.ok) return void errors.push(t.result.error);
    } else {
      try {
        r = fn(app, c.args || {});
      } catch (e) {
        return void errors.push(errText(e));
      }
    }
    if (!r) return;
    if (r.same)
      return void done.push({
        icon: 'info',
        text: r.text,
        same: true,
      });
    emit('STATE_DELTA', {
      app: app.id,
      source: by === 'you' ? 'user' : 'agent',
      delta: [
        {
          op: r.op || 'replace',
          path: r.path,
          value: r.value,
        },
      ],
    });
    done.push({
      icon: r.icon,
      text: r.text,
    });
    if (r.review) fx.review.push(r.review);
    if (r.from != null && r.from >= 0 && (fx.from == null || r.from < fx.from)) fx.from = r.from;
  });
  app.flow = normFlow(app.flow);
  app.updated = Date.now();
  commit();
  return {
    done,
    errors,
    fx,
    before,
    after: JSON.stringify(app.flow),
    changed: JSON.stringify(app.flow) !== before,
  };
}
export function flowAfter(app: AppRecord, res: FlowApplied, by: string) {
  // say what changed, then let only the agents it touches run again
  const real = res.done.filter((d) => !d.same),
    ready = app.status === 'ready',
    busy = !!RUNS[app.id],
    from = res.fx.from != null && ready ? STATIONS[res.fx.from].id : null;
  if (by === 'you') {
    if (res.errors.length) toast(res.errors[0], 'warning');
    if (real.length)
      say(
        app,
        'orchestrator',
        'From the canvas: ' + real.map((d) => d.text).join(' '),
        from
          ? {
              type: 'flow',
              items: [],
              before: res.before,
              after: res.after,
              from,
              quiet: true,
            }
          : null,
      );
  } else {
    const same = res.done.filter((d) => d.same);
    if (!real.length) say(app, 'orchestrator', res.errors[0] || (same[0] && same[0].text) || 'Nothing to change.');
    else
      say(
        app,
        'orchestrator',
        'Done.' + (res.errors.length ? ' One part I left out: ' + res.errors[0] : '') + (same.length ? ' ' + same[0].text : ''),
        {
          type: 'flow',
          items: real,
          before: res.before,
          after: res.after,
          from,
        },
      );
  }
  // the stations the change touches run again on their own, a few seconds after the last edit (src/workspace/rerun.tsx)
  if (from && res.fx.from != null) queueRerun(app, res.fx.from, (a, st, auto) => rerunFrom(a, st, true, auto));
  // a review step that was just added reads the app as it is now. Only the new reviewers work, one after the other; no station runs again.
  if (ready && !busy && !PENDING[app.id])
    (async () => {
      for (const id of res.fx.review) {
        if (flowOf(app).reviewers.includes(id)) await reviewNow(app, id);
      }
    })();
  else if (!ready && !busy)
    res.fx.review.forEach((id) => {
      if (flowOf(app).reviewers.includes(id))
        say(app, 'rv_' + id, 'I will read ' + REVIEWERS[id].reads + ' when the build passes ' + stName(stepAfter(flowOf(app), id)) + '.');
    });
}
export function flowEdit(app: AppRecord, calls: FlowCall[]) {
  const res = flowApply(app, calls, 'you');
  flowAfter(app, res, 'you');
  return res;
}

/* ---------- chat: a message about the workflow becomes tool calls ---------- */
export const ST_WORDS: [RegExp, string][] = [
  [/\b(brief|research(er)?|planner|requirements?)\b/, 'research'],
  [/\b(tables?|database|schema|data model|sqlite)\b/, 'database'],
  [/\b(back ?end|endpoints?|api|access rules?|rules|permissions?)\b/, 'backend'],
  [/\b(views?|view advisor|advisor|dashboards?|charts?)\b/, 'views'],
  [/\b(screens?|pages?|ui|layout|front ?end)\b/, 'screens'],
  [/\b(walk ?through|tour|acceptance( test)?|app is (ready|finished|done))\b/, 'walkthrough'],
];
export const AG_WORDS: [RegExp, string][] = [
  [/\b(research(er)?|planner)\b/, 'researcher'],
  [/\b(database|data|tables?|schema|lists? builder)\b/, 'database'],
  [/\b(back ?end|rules? builder)\b/, 'backend'],
  [/\b(view advisor|views?|advisor|dashboards?)\b/, 'views'],
  [/\b(ui|screens?|pages?|front ?end|design(er)?|layout)\b/, 'ui'],
];
export const RV_WORDS: [RegExp, string][] = [
  [/\b(security|access|permissions?|rights)\b/, 'security'],
  [/\b(data|schema|tables?|database|lists?)\b/, 'data'],
  [/\b(insights?|dashboards?|analytics|charts?)\b/, 'insight'],
  [/\b(wording|labels?|copy|ux|usability|text|pages?)\b/, 'wording'],
];
export const pickWord = (list: [RegExp, string][], s: string) => {
  let best: { at: number; id: string } | null = null;
  for (const x of list) {
    const m = x[0].exec(s);
    if (m && (!best || m.index < best.at))
      best = {
        at: m.index,
        id: x[1],
      };
  }
  return best ? best.id : null;
};
export const NUMW: Dict<number> = {
  one: 1,
  two: 2,
  three: 3,
  1: 1,
  2: 2,
  3: 3,
  once: 1,
  twice: 2,
};
export const FLOW_HELP =
  'You can also change how I build: “ask me before the screens are built”, “add a normalise step”, “add an agent called Brand stylist after screens that uses the colour teal”, “add a security review”, “allow 2 attempts”, “tell the Screen designer to keep page names short”, “let the rules build the views”, “run again from views”, “show the workflow”.';
export const STEP_WORDS: [RegExp, string][] = [
  [/\b(normali[sz](e|er|ation|ing)?|tidy(ing)? (up )?(the )?tables|clean(ing)? (up )?(the )?tables)\b/, 'normalize'],
  [/\b(styl(e|ist|ing)|ui customi[sz]ation|polish(ing)? (the )?ui|look and feel)\b/, 'style'],
];
export function stepByWords(q: string, app?: AppRecord | null) {
  // a step this workflow has, or one from the library, named loosely
  const s = str(q).toLowerCase().trim(),
    mine = app ? flowOf(app).agents : [],
    own =
      mine.find((a) => a.name.toLowerCase() === s) ||
      mine.find((a) => s && (a.name.toLowerCase().includes(s) || s.includes(a.name.toLowerCase())));
  return own ? own.id : pickWord(STEP_WORDS, s) || (/review|check/.test(s) ? pickWord(RV_WORDS, s) : null);
}
/** What a chat message asks of the workflow, or null when it is not about the workflow. */
export interface FlowAsk {
  show?: boolean;
  calls?: FlowCall[];
  rerun?: string;
  review?: string;
  reply?: string;
}
export function parseFlow(text: string, app?: AppRecord | null): FlowAsk | null {
  // null when the message is not about the workflow
  const raw = String(text)
      .trim()
      .replace(/[.!?]+$/, ''),
    s = raw
      .toLowerCase()
      .replace(/^(please|can you|could you|i want you to|i'd like you to|i would like you to)\s+/, '')
      .replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  const all = /\b(every|each|all)\b/;
  if (
    /^(show|list|open|what is|what's) (me )?(the |my |this |our )?(build )?workflow( settings| customi[sz]ations?| changes)?$/.test(s) ||
    /^how is (the|this) (build )?workflow (set up|customi[sz]ed)$/.test(s) ||
    /^customi[sz]e (the |this )?(build )?workflow$/.test(s) ||
    /^workflow( settings)?$/.test(s)
  )
    return {
      show: true,
    };
  if (
    /^(reset|restore) (the |my |this )?(build )?workflow( to (the )?(standard|default)( one)?)?$/.test(s) ||
    /^(use|go back to|back to) the standard workflow$/.test(s)
  )
    return {
      calls: [
        {
          tool: 'reset',
        },
      ],
    };
  if (
    /^(save|keep|use|make|set) (this |the )?(build )?workflow (as |for )?(my |the )?default( workflow)?( for new apps)?$/.test(s) ||
    /^make this my default( workflow)?$/.test(s)
  )
    return {
      calls: [
        {
          tool: 'save_default',
        },
      ],
    };
  if (
    (m =
      /^(?:re-?run|run again|rebuild|redo|run|build again)(?: the build| it)?(?: again)? from (?:the )?(.+?)(?: station| step| agent)?(?: on(?:wards?)?)?$/.exec(
        s,
      ))
  ) {
    const st = pickWord(ST_WORDS, m[1]);
    if (st)
      return {
        rerun: st,
      };
  }
  if ((m = /^(?:run|redo|repeat|do|start) (?:the |a |an )?(.+?) (?:review|check)(?:er)?(?: again| now)?$/.exec(s))) {
    const id = pickWord(RV_WORDS, m[1]);
    if (id)
      return {
        review: id,
      };
  }
  // steps the owner adds to the workflow: one from the library, or an agent described in a sentence
  const afterOf = (t: string | undefined) => (t ? pickWord(ST_WORDS, t) : null),
    nameOf = (t: string) =>
      str(t)
        .replace(/^["“']|["”']$/g, '')
        .trim();
  if (
    (m =
      /^(?:add|create|make|build|insert) (?:a |an )?(?:new |custom |my own )?agent (?:called|named) ["“']?(.+?)["”']?(?: after (?:the )?([a-z -]+?)(?: station| step| agent)?)?(?:\s*[:,]\s*|\s+(?:that|to|which|who)\s+)(.+)$/i.exec(
        raw,
      )) ||
    (m =
      /^(?:add|create|make|build|insert) (?:a |an )?(?:new |custom )?(.+?) agent(?: after (?:the )?([a-z -]+?)(?: station| step| agent)?)?(?:\s*[:,]\s*|\s+(?:that|to|which|who)\s+)(.+)$/i.exec(
        raw,
      ))
  ) {
    const lib = pickWord(STEP_WORDS, m[1].toLowerCase()),
      aft = afterOf(str(m[2]).toLowerCase()) || afterOf((/\bafter (?:the )?([a-z -]+?)(?: station| step)?$/i.exec(m[3]) || [])[1]);
    return {
      calls: [
        {
          tool: 'add_step',
          args:
            lib && !/[.;]/.test(m[3]) && m[3].length < 12
              ? {
                  step: lib,
                  after: aft || undefined,
                }
              : {
                  name: nameOf(m[1]),
                  job: m[3].replace(/\s+after (?:the )?[a-z -]+?(?: station| step)?$/i, ''),
                  after: aft || undefined,
                },
        },
      ],
    };
  }
  if (
    (m =
      /^(?:add|include|insert|use|create) (?:a |an |the )?(.+?)(?: step| agent)?(?: (?:after|to) (?:the )?([a-z -]+?)(?: station| step)?)?$/.exec(
        s,
      )) &&
    !/review/.test(m[1]) &&
    pickWord(STEP_WORDS, m[1]) &&
    (/\b(step|agent)\b/.test(s) || /^(normali[sz]er?|normali[sz]e (the )?tables|ui stylist|style the ui|tidy (up )?the tables)$/.test(m[1]))
  )
    return {
      calls: [
        {
          tool: 'add_step',
          args: {
            step: pickWord(STEP_WORDS, m[1]),
            after: afterOf(m[2]) || undefined,
          },
        },
      ],
    };
  if ((m = /^(?:remove|drop|delete|take out) (?:the |my )?(.+?)(?: step| agent)$/.exec(s)) && !/review|instruction|note/.test(m[1])) {
    const id = stepByWords(m[1], app);
    if (id)
      return {
        calls: [
          {
            tool: 'remove_step',
            args: {
              step: id,
            },
          },
        ],
      };
  }
  if (
    (m = /^move (?:the |my )?(.+?)(?: step| agent| review(?:er)?)? (?:to )?(?:after|behind) (?:the )?([a-z -]+?)(?: station| step)?$/.exec(
      s,
    ))
  ) {
    const id = stepByWords(m[1] + (/review/.test(s) ? ' review' : ''), app),
      to = afterOf(m[2]);
    if (id && to)
      return {
        calls: [
          {
            tool: 'move_step',
            args: {
              step: id,
              after: to,
            },
          },
        ],
      };
  }
  if (
    (m =
      /^(?:let|make|have) (?:the |my )?(.+?)(?: step| agent| review(?:er)?)? (apply (?:its|their|the|his|her) (?:own )?(?:changes|fixes|findings)(?: itself| automatically| on its own)?|(?:only|just) advise|advise only)$/.exec(
        s,
      ))
  ) {
    const id = stepByWords(m[1] + (/review/.test(s) ? ' review' : ''), app);
    if (id)
      return {
        calls: [
          {
            tool: 'set_mode',
            args: {
              step: id,
              mode: /^apply/.test(m[2]) ? 'apply' : 'advise',
            },
          },
        ],
      };
  }
  if ((m = /^(?:run|redo|repeat|start) (?:the |my )?(.+?)(?: step| agent)(?: again| now)?$/.exec(s))) {
    const id = stepByWords(m[1], app);
    if (id)
      return {
        review: id,
      };
  }
  // standing instructions come first, because an instruction may itself contain words like "approve" or "two attempts"
  if (
    (m = /^(?:clear|remove|delete|forget|drop) (?:the )?(.+?)(?:'s| agent's)? (?:standing )?(?:notes?|instructions?)$/i.exec(raw)) ||
    (m =
      /^(?:clear|remove|delete|forget|drop) (?:the )?(?:standing )?(?:notes?|instructions?) (?:for|of|to) (?:the )?(.+?)(?: agent)?$/i.exec(
        raw,
      ))
  ) {
    const ag = pickWord(AG_WORDS, m[1].toLowerCase());
    if (ag && /agent|researcher|planner|advisor|builder|designer/i.test(raw))
      return {
        calls: [
          {
            tool: 'set_note',
            args: {
              agent: ag,
              text: '',
            },
          },
        ],
      };
  }
  if (
    (m =
      /^(?:please )?(?:tell|ask|instruct|remind|brief) (?:the )?(researcher|research agent|planner|list builder|rules builder|screen designer|view advisor|(?:[a-z -]+?) agent)(?:\s*[:,]\s*|\s+to\s+|\s+that\s+|\s+)(.+)$/i.exec(
        raw,
      )) ||
    (m =
      /^(?:note|instruction|standing instruction) (?:for|to) (?:the )?(researcher|research agent|planner|list builder|rules builder|screen designer|view advisor|(?:[a-z -]+?) agent)\s*[:,]\s*(.+)$/i.exec(
        raw,
      ))
  ) {
    const ag = pickWord(AG_WORDS, m[1].toLowerCase());
    if (ag && str(m[2]))
      return {
        calls: [
          {
            tool: 'set_note',
            args: {
              agent: ag,
              text: cap(str(m[2])),
            },
          },
        ],
      };
  }
  if (
    (m = /\b(one|two|three|[123])\s+(?:attempts?|tries|try)\b/.exec(s)) ||
    (m = /\b(?:attempts?|tries) (?:to|of|at|=) ?(one|two|three|[123])\b/.exec(s))
  )
    return {
      calls: [
        {
          tool: 'set_attempts',
          args: {
            n: NUMW[m[1]],
          },
        },
      ],
    };
  if (/\b(don't|do not|never) (send (the )?(work|it|anything) back|retry)\b/.test(s) || /\bno (retries|send-?backs?)\b/.test(s))
    return {
      calls: [
        {
          tool: 'set_attempts',
          args: {
            n: 1,
          },
        },
      ],
    };
  if ((m = /\bsend (?:the |failed )?(?:work|it) back (?:at most |only |up to )?(once|twice)\b/.exec(s)))
    return {
      calls: [
        {
          tool: 'set_attempts',
          args: {
            n: NUMW[m[1]] + 1,
          },
        },
      ],
    };
  if (
    (m =
      /^(?:add|include|insert|use|turn on|switch on|enable|i want) (?:an? |the |every |all (?:the |four )?)?(.*?) ?(?:review|check)(?:er|ers|s)?(?: steps?)?(?: (?:after|to|on|for|of) .+)?$/.exec(
        s,
      ))
  ) {
    if (all.test(s))
      return {
        calls: ['data', 'security', 'insight', 'wording'].map((id) => ({
          tool: 'add_review',
          args: {
            reviewer: id,
          },
        })),
      };
    const id = pickWord(RV_WORDS, m[1] + ' ' + s.replace(/^.*?(?:review|check)(?:er|ers|s)?/, ''));
    if (id)
      return {
        calls: [
          {
            tool: 'add_review',
            args: {
              reviewer: id,
            },
          },
        ],
      };
    if (!str(m[1]))
      return {
        reply:
          'The review steps I can add are: ' +
          ['data', 'security', 'insight', 'wording']
            .map((k) => REVIEWERS[k].short.toLowerCase() + ' (after ' + stName(REVIEWERS[k].after) + ')')
            .join(', ') +
          '. Say for example “add a security review”.',
      };
  }
  if (
    (m =
      /^(?:remove|drop|delete|turn off|switch off|disable|skip|no more) (?:the |all (?:the )?|every )?(.*?) ?(?:review|check)(?:er|ers|s)?(?: steps?)?$/.exec(
        s,
      ))
  ) {
    if (all.test(s) || !str(m[1]))
      return {
        calls: ['data', 'security', 'insight', 'wording'].map((id) => ({
          tool: 'remove_review',
          args: {
            reviewer: id,
          },
        })),
      };
    const id = pickWord(RV_WORDS, m[1]);
    if (id)
      return {
        calls: [
          {
            tool: 'remove_review',
            args: {
              reviewer: id,
            },
          },
        ],
      };
  }
  if (
    (m = /^(?:let|have|make) (?:the )?(?:built-?in )?(?:rules|code) (?:build|do|make|write|handle|lay out) (?:the )?(.+)$/.exec(s)) ||
    (m = /^(?:build|do|make|write|lay out) (?:the )?(.+?) (?:with|by|using) (?:the )?(?:built-?in )?(?:rules|code)$/.exec(s)) ||
    (m = /^(?:use|switch to) (?:the )?(?:built-?in )?(?:rules|code) for (?:the )?(.+)$/.exec(s)) ||
    (m = /^(?:skip|drop|turn off|switch off|do without) the (.+?) agent$/.exec(s))
  ) {
    const st = pickWord(ST_WORDS, m[1]);
    if (st)
      return {
        calls: [
          {
            tool: 'set_worker',
            args: {
              station: st,
              by: 'rules',
            },
          },
        ],
      };
  }
  if (
    (m = /^(?:give|hand) (?:the )?(.+?) back to (?:the|its) .*agent$/.exec(s)) ||
    (m = /^(?:use|bring back|turn on|switch on) the (?:.+? )?agent (?:for|on) (?:the )?(.+)$/.exec(s)) ||
    (m = /^let the (?:.+? )?agent (?:build|do|make|write|lay out) (?:the )?(.+?)(?: again)?$/.exec(s))
  ) {
    const st = pickWord(ST_WORDS, m[1]);
    if (st)
      return {
        calls: [
          {
            tool: 'set_worker',
            args: {
              station: st,
              by: 'agent',
            },
          },
        ],
      };
  }
  // approvals: "ask me before the screens are built", "pause after the database", "let me approve the tables", "stop asking me"
  const place = (rest: string): string[] | 'first' | null => {
    // which station to stop after
    const r = rest.replace(
      /\bare (built|made|created|written|designed|laid out)\b|\bis (built|made|created|written)\b|\b(get|gets) (built|made)\b|\bstarts?\b|\bruns?\b|\b(station|step|agent)\b|\byou (build|make|create|write|design|lay out|start)\b/g,
      ' ',
    );
    if (all.test(r)) return APPROVE_AT.slice();
    const st = pickWord(ST_WORDS, r);
    if (!st) return null;
    if (/\bbefore\b/.test(rest)) {
      const i = stationIdx(st) - 1;
      return i < 0 ? 'first' : [STATIONS[i].id];
    }
    return [st];
  };
  const offRe = /^(?:stop|don't|do not|no longer|never|quit) (?:asking|ask|pausing|pause|waiting|wait|stopping|checking with me)\b(.*)$/,
    noMore =
      /^(?:no more |remove (?:the |all (?:the )?|every )?|drop (?:the |all )?|turn off (?:the |all )?|switch off (?:the |all )?)(?:approvals?|pauses?|approval steps?)(.*)$/;
  if ((m = offRe.exec(s)) || (m = noMore.exec(s))) {
    const p = /\b(before|after|at)\b/.test(m[1]) ? place(m[1]) : APPROVE_AT.slice();
    if (p === 'first')
      return {
        reply: 'Research is the first step, so there is no pause before it to remove.',
      };
    if (p)
      return {
        calls: p.map((st) => ({
          tool: 'set_approval',
          args: {
            station: st,
            on: false,
          },
        })),
      };
  }
  const wants =
    /\b(ask me|ask for my|check with me|wait for (me|my)|my (approval|ok|okay|go-ahead|sign-?off)|approv|pause|hold|sign off|stop (and|for|before|after)|let me (see|check|review|look|approve|sign))\b/.test(
      s,
    );
  if (wants && ((m = /\b(before|after|at|once|when|on)\b(.+)$/.exec(s)) || all.test(s))) {
    const p = place(m ? m[0] : s);
    if (p === 'first')
      return {
        reply:
          'Research is the first step, so there is nothing to approve before it. I can stop after Research instead: say “ask me after research”.',
      };
    if (p)
      return {
        calls: p.map((st) => ({
          tool: 'set_approval',
          args: {
            station: st,
            on: true,
          },
        })),
      };
  }
  if (
    (m =
      /^(?:let me|i want to|i'd like to|i would like to) (?:approve|review|check|see|look at|sign off(?: on)?) (?:the )?(.+?)(?: first| before .+| myself)?$/.exec(
        s,
      ))
  ) {
    const st = pickWord(ST_WORDS, m[1]);
    if (st && st !== 'walkthrough')
      return {
        calls: [
          {
            tool: 'set_approval',
            args: {
              station: st,
              on: true,
            },
          },
        ],
      };
  }
  return null;
}
export async function flowChat(app: AppRecord, wf: FlowAsk) {
  if (wf.reply) return void say(app, 'orchestrator', wf.reply);
  if (wf.show)
    return void say(
      app,
      'orchestrator',
      flowList(flowOf(app)).length
        ? "This is how this app's workflow differs from the standard one."
        : 'This app uses the standard workflow: six stations, a check gate after each, three attempts and no extra steps.',
      {
        type: 'flowinfo',
      },
    );
  if (wf.rerun) return void rerunFrom(app, wf.rerun, true);
  if (wf.review) {
    if (!flowOf(app).reviewers.includes(wf.review)) {
      const r0 = flowApply(
        app,
        [
          {
            tool: 'add_review',
            args: {
              reviewer: wf.review,
            },
          },
        ],
        'orchestrator',
      );
      return void flowAfter(app, r0, 'orchestrator');
    }
    return void reviewNow(app, wf.review, true);
  }
  const res = flowApply(app, wf.calls || [], 'orchestrator');
  flowAfter(app, res, 'orchestrator');
}
export function flowTips(app: AppRecord) {
  // example chips: things the owner has not switched on yet
  const f = flowOf(app),
    out: string[] = [];
  if (!f.approve.views && !f.approve.screens) out.push('Ask me before the screens are built');
  if (!f.reviewers.includes('security')) out.push('Add a security review');
  else if (!f.reviewers.includes('insight')) out.push('Add an insight review');
  if (!out.length && f.attempts === 3) out.push('Allow 2 attempts');
  return out.slice(0, 2);
}

/* ---------- approval, where the owner put it ---------- */
/**
 * Human in the loop: the workflow graph stops after this station until the owner approves. The graph does the
 * waiting; this shows the approval card and records the owner's decision on it.
 */
export function showGate(app: AppRecord, run: Run, st: Station) {
  const L = app.line[st.id];
  L.status = 'waiting';
  L.hold = 'approval';
  const s = stepStart(run, st.id, 'orchestrator', 'Waiting for your approval', 'wait'),
    next = STATIONS[stationIdx(st.id) + 1];
  // A pause that comes from the plan gives the plan's own reason; one the owner switched on is theirs.
  const plan = teamPlanOf(app),
    planned = plan ? teamFor(plan).pauses.find((p) => p.after === st.id) : undefined;
  const m = say(
    app,
    'orchestrator',
    (planned ? 'The plan stops here. ' + planned.why + ' ' : 'You asked me to stop after ' + st.name + '. ') +
      'Look at what ' +
      (L.byRules ? 'the rules' : AGENTS[st.agent].name) +
      ' made, then approve it and ' +
      (next ? next.name + ' starts.' : 'the Tester starts.'),
    {
      type: 'gate',
      station: st.id,
      facts: L.facts.slice(0, 3),
      decided: null,
    },
  );
  // On a phone the plain list of steps shows this pause in plain words with its own buttons, so stay there instead of
  // covering it with the chat. Anywhere else the chat card is the way to answer.
  if (!(NARROW() && (U.view[app.id] || 'build') === 'build' && buildMode(app) === 'steps')) setChat(true);
  return {
    decided(ok: boolean) {
      if (m.card) m.card.decided = ok ? 'approved' : 'stopped';
      L.hold = null;
      stepEnd(s, ok);
      pushChat(app, 'user', ok ? 'Approved' : 'Stop here');
      if (ok) {
        L.status = 'ok';
        L.approved = Date.now();
      }
      commit();
    },
    cancel() {
      stepEnd(s, false);
      if (m.card) m.card.decided = 'stopped';
      L.hold = null;
    },
  };
}
export function answerGate(app: AppRecord, ok: boolean) {
  const r = RUNS[app.id];
  if (r && r.gate) {
    r.gate(ok);
    if (ok && PHONE() && chatShown()) setChat(false);
  }
}

/* ---------- review steps: one reviewer reads one station's output and advises ---------- */
export type Level = ReviewFinding['level'];
/** what a reviewer finds, before it is numbered and tried out */
export type Finding = Pick<ReviewFinding, 'level' | 'text' | 'why' | 'fix'>;
/** an app whose brief and workflow exist, which is what a change request needs */
export type BuiltApp = AppRecord & { def: BackedDef };
export const LEVELS: Record<Level, { text: string; cls: string; n: number }> = {
  high: {
    text: 'Important',
    cls: 'b-danger',
    n: 0,
  },
  medium: {
    text: 'Worth a look',
    cls: 'b-warning',
    n: 1,
  },
  low: {
    text: 'Small',
    cls: 'b-neutral',
    n: 2,
  },
};
export const rankFindings = (list: Finding[]) => {
  const seen: Dict<number> = {};
  return list
    .filter((f) => f && f.text && !seen[f.text] && (seen[f.text] = 1))
    .sort((a, b) => LEVELS[a.level].n - LEVELS[b.level].n)
    .slice(0, 4);
};
export const byCol = (c: { label?: string }) =>
  /\b(to|by|on|per|in|at|for)$/i.test(c.label || '') ? '"' + lc(c.label) + '"' : lc(c.label); // a label that ends in a preposition is quoted, so the request does not read "by assigned to to the dashboard"
export const lc = (s: unknown) =>
  String(s || '')
    .split(' ')
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(' '); // lower case, but an acronym such as HR or IP keeps its capitals
export const REVIEW_RULES: Dict<(app: AppRecord) => Finding[]> = {
  // Demo, and the fallback when no model answers: code reads the definition the way the reviewer would
  data(app) {
    const def = app.def,
      out: Finding[] = [],
      main = def.process ? def.process.table : def.brief && def.brief.process.entity;
    def.tables.forEach((t) => {
      const cols = t.columns,
        room = cols.length < LIMITS.cols,
        named = (re: RegExp) => cols.some((c) => re.test(c.name) || re.test(snake(c.label)));
      if (t.name === main && room && !cols.some((c) => c.type === 'date' || c.type === 'datetime'))
        out.push({
          level: 'medium',
          text: 'The ' + t.label + ' table has no date field, so nothing can be planned, sorted by time or put on a calendar.',
          why: 'It is the table that moves through the workflow.',
          fix: 'Add a due date field to ' + lc(t.label),
        });
      if (room && !cols.some((c) => c.type === 'longtext') && !named(/note|comment|description|detail|summary/))
        out.push({
          level: t.name === main ? 'medium' : 'low',
          text: 'The ' + t.label + ' table has nowhere to write free-text notes.',
          why: 'Without one, people put notes into fields meant for something else.',
          fix: 'Add a notes field to ' + lc(t.label),
        });
      const n = Number(dbCount(app.id, t.name));
      if (n > 0 && n < 5)
        out.push({
          level: 'low',
          text: 'Only ' + n + ' sample rows in the ' + t.label + ' table, so its charts and boards will look thin.',
          why: 'More rows arrive as people use the app.',
          fix: null,
        });
      const lone = cols.find((c) => c.type === 'select' && arr(c.options).length < 2);
      if (lone)
        out.push({
          level: 'low',
          text: label(lone.name) + ' in ' + t.label + ' offers a single choice, so it says nothing.',
          why: 'A choice field needs at least two options.',
          fix: 'Remove the ' + lc(lone.label) + ' field from ' + lc(t.label),
        });
    });
    return rankFindings(out);
  },
  security(app) {
    const def = app.def as BriefedDef,
      out: Finding[] = [],
      roles = def.brief.roles,
      main = def.process && def.process.table;
    def.tables.forEach((t) =>
      roles.forEach((r) => {
        const a = accOf(def, r.id, t.name),
          mine = t.owner && (colOf(t, t.owner) || {}).role === r.id,
          who = lc(r.name),
          what = lc(t.label);
        if (mine && a.list === 'all')
          out.push({
            level: 'high',
            text: r.name + ' can see every record in ' + t.label + ', not only their own.',
            why: 'Each ' + lc(t.one) + ' belongs to one ' + who + ' through the ' + lc(label(t.owner)) + ' field.',
            fix: 'Let ' + who + ' see their own ' + what,
          });
        else if (mine && a.update === 'all')
          out.push({
            level: 'medium',
            text: r.name + ' can edit every record in ' + t.label + ', not only their own.',
            why: 'Each ' + lc(t.one) + ' belongs to one ' + who + ' through the ' + lc(label(t.owner)) + ' field.',
            fix: 'Let ' + who + ' edit their own ' + what,
          });
        if (a.delete && t.name === main)
          out.push({
            level: 'medium',
            text: r.name + ' can delete ' + what + '. A deleted record takes its history with it.',
            why: 'The workflow already has a state for work that is cancelled or closed.',
            fix: 'Stop ' + who + ' from deleting ' + what,
          });
      }),
    );
    const wide = roles.filter((r) => def.tables.length > 1 && def.tables.every((t) => accOf(def, r.id, t.name).delete));
    wide.forEach((r) => {
      const t = def.tables.find((x) => x.name !== main) || def.tables[0];
      out.push({
        level: 'low',
        text: r.name + ' can delete from every table.',
        why: 'Deleting a ' + lc(t.one) + ' also breaks the records that point at it.',
        fix: 'Stop ' + lc(r.name) + ' from deleting ' + lc(t.label),
      });
    });
    return rankFindings(out);
  },
  insight(app) {
    const def = app.def,
      out: Finding[] = [],
      W = (def.dash && def.dash.widgets) || [],
      main = tableOf(def, def.process ? def.process.table : '') || def.tables[0],
      statusCol = def.process && def.process.column;
    const charted = (t: AppTable, c: ColumnDef) => W.some((w) => w.table === t.name && (w.x === c.name || w.split === c.name));
    if (main && !W.some((w) => w.kind === 'line')) {
      const d = main.columns.find((c) => c.type === 'date' || c.type === 'datetime');
      if (d && !charted(main, d))
        out.push({
          level: 'medium',
          text: 'The dashboard shows totals, but no trend over time.',
          why: 'A line by ' + lc(d.label) + ' shows whether ' + lc(main.label) + ' are going up or down.',
          fix: 'Add a chart of ' + lc(main.label) + ' by ' + byCol(d) + ' to the dashboard',
        });
    }
    [main].concat(def.tables.filter((t) => t !== main)).forEach((t) => {
      if (!t) return;
      t.columns.forEach((c) => {
        const few =
          c.type === 'select' ||
          c.type === 'bool' ||
          c.type === 'user' ||
          (c.type === 'ref' && !!c.ref && tableOf(def, c.ref) && Number(dbCount(app.id, c.ref)) <= 6);
        if (few && !(t === main && c.name === statusCol) && !charted(t, c))
          out.push({
            level: 'low',
            text: 'Nothing on the dashboard breaks ' + lc(t.label) + ' down by ' + lc(c.label) + '.',
            why: 'It is a category people will ask about.',
            fix: 'Add a chart of ' + lc(t.label) + ' by ' + byCol(c) + ' to the dashboard',
          });
      });
    });
    return rankFindings(out).slice(0, 3);
  },
  wording(app) {
    const def = app.def as BriefedDef,
      out: Finding[] = [],
      scr = def.screens || [],
      theme = def.theme || {};
    if (scr.length >= 7 && theme.nav === 'top')
      out.push({
        level: 'medium',
        text: scr.length + ' pages do not fit comfortably in a menu across the top.',
        why: 'A menu down the side keeps every page name readable.',
        fix: 'Use side navigation',
      });
    const wide = scr.find((s) => s.type === 'table' && arr(s.columns).length >= 5);
    if (wide && theme.density !== 'compact')
      out.push({
        level: 'low',
        text: wide.name + ' shows ' + wide.columns.length + ' columns in roomy rows.',
        why: 'Compact rows fit more records on a screen.',
        fix: 'Make the rows compact',
      });
    const twins = scr.find((s, i) =>
      scr.some((o, j) => j < i && o.table === s.table && o.type === s.type && o.roles.join() === s.roles.join()),
    );
    if (twins)
      out.push({
        level: 'medium',
        text: twins.name + ' shows the same records in the same way as another page, for the same people.',
        why: 'Two pages that look alike make people wonder which one to use.',
        fix: 'Remove the ' + twins.name + ' screen',
      });
    def.tables.forEach((t) =>
      t.columns.forEach((c) => {
        if (/_/.test(String(c.label)) || /\bid$/i.test(String(c.label))) {
          const nice = cap(
            lc(c.label)
              .replace(/_/g, ' ')
              .replace(/\s+id$/, '')
              .trim(),
          );
          if (nice && nice !== c.label)
            out.push({
              level: 'low',
              text: 'The field label “' + c.label + '” in ' + t.label + ' reads like a column name.',
              why: 'People see labels, not the database.',
              fix: 'Rename ' + lc(c.label) + ' in ' + lc(t.label) + ' to "' + nice + '"',
            });
        }
      }),
    );
    const long = scr.find((s) => s.name.length > 24);
    if (long)
      out.push({
        level: 'low',
        text: 'The page name “' + long.name + '” is ' + long.name.length + ' characters long and will be cut off in the menu.',
        why: 'Two or three words are enough for a page name.',
        fix: null,
      });
    const solo = def.brief.roles.find((r) => scr.filter((s) => s.roles.includes(r.id) && s.type !== 'dashboard').length === 1);
    if (solo)
      out.push({
        level: 'low',
        text: solo.name + ' has a single page besides the overview.',
        why: 'That can be right for a narrow role. Check that it covers what they need to do.',
        fix: null,
      });
    return rankFindings(out);
  },
};
REVIEW_RULES.normalize = (app) => {
  // free text that repeats, and the same fact kept twice
  const def = app.def,
    out: Finding[] = [];
  if (!dbExists(app.id)) return out;
  def.tables.forEach((t) =>
    t.columns.forEach((c) => {
      if (c.type !== 'text' || c.name === t.title) return;
      let rows: SqlRow[] = [];
      try {
        rows = sqlPeek(
          app.id,
          'SELECT ' +
            qi(c.name) +
            ' AS v, COUNT(*) AS n FROM ' +
            qi(t.name) +
            ' WHERE ' +
            qi(c.name) +
            ' IS NOT NULL AND ' +
            qi(c.name) +
            " <> '' GROUP BY 1",
        );
      } catch {
        rows = [];
      }
      const total = rows.reduce((n, r) => n + Number(r.n), 0);
      if (rows.length >= 2 && rows.length <= 5 && total >= rows.length * 2)
        out.push({
          level: 'medium',
          text:
            c.label + ' in ' + t.label + ' is free text, yet only ' + rows.length + ' different values are used across ' + total + ' rows.',
          why: 'As a choice the spelling stays the same, and the field can drive boards, charts and filters.',
          fix: 'Turn ' + lc(c.label) + ' in ' + lc(t.label) + ' into a choice',
        });
    }),
  );
  def.tables.forEach((t) =>
    t.columns.forEach((c) => {
      const p = c.type === 'ref' ? tableOf(def, c.ref) : null;
      if (!p || p.name === t.name) return;
      t.columns.forEach((d) => {
        if (d.type === 'text' && d.name !== t.title && d.name === p.title)
          out.push({
            level: 'high',
            text: t.label + ' keeps its own ' + d.label + ' although it links to ' + p.label + ', which already has it.',
            why: 'The same fact kept in two places goes out of step.',
            fix: 'Remove the ' + lc(d.label) + ' field from ' + lc(t.label),
          });
      });
    }),
  );
  return rankFindings(out);
};
REVIEW_RULES.style = (app) => {
  // the layout against the amount of data and pages
  const def = app.def,
    th = def.theme || {},
    n = (def.screens || []).length,
    out: Finding[] = [];
  if (!n) return out;
  if (th.density !== 'compact' && def.tables.some((t) => t.columns.length >= 8))
    out.push({
      level: 'medium',
      text: 'At least one table has eight or more fields, and the rows are set to comfortable.',
      why: 'Compact rows show more of a wide table without scrolling sideways.',
      fix: 'Make the rows compact',
    });
  if (th.nav === 'top' && n > 6)
    out.push({
      level: 'medium',
      text: 'The top bar holds ' + n + ' pages and will wrap on a laptop.',
      why: 'A side menu has room for long lists of pages.',
      fix: 'Use side navigation',
    });
  if (th.nav === 'side' && n <= 4)
    out.push({
      level: 'low',
      text: 'Only ' + n + ' pages sit in a full side menu.',
      why: 'A top bar gives the content the whole width.',
      fix: 'Use top navigation',
    });
  return rankFindings(out);
};
/** The name a built-in review goes by in its prompt. The owner sees the plain name; the prompt keeps the role the server recognises. */
const PROMPT_AS: Record<string, string> = { data: 'Data reviewer', security: 'Security reviewer' };
export function reviewPrompt(app: AppRecord, id: string) {
  const def = app.def as BriefedDef,
    rv = REVIEWERS[id];
  const ctx = {
    data: 'TABLES (name:type, * = required):\n' + pTables(def),
    security:
      'ROLES: ' +
      def.brief.roles.map((r) => r.id + ' (' + r.can + ')').join('; ') +
      '\n\nUSER STORIES:\n' +
      def.brief.stories.map((x) => '- ' + x.role + ': ' + x.want).join('\n') +
      '\n\nTABLES:\n' +
      pTables(def) +
      '\n\nACCESS:\n' +
      (def.process ? pAccess(def) : ''),
    insight:
      'TABLES:\n' +
      pTables(def) +
      '\n\nDASHBOARD WIDGETS: ' +
      JSON.stringify(
        ((def.dash || {}).widgets || []).map((w) => ({
          kind: w.kind,
          table: w.table,
          x: w.x,
          split: w.split,
        })),
      ),
    wording:
      'SCREENS: ' +
      (def.screens || [])
        .map((s) => s.name + ' (' + s.type + ' on ' + s.table + ', ' + arr(s.columns).length + ' columns, for ' + s.roles.join('|') + ')')
        .join('; ') +
      '\nLAYOUT: ' +
      JSON.stringify(def.theme) +
      '\n\nTABLES:\n' +
      pTables(def),
  }[id];
  const all =
    'TABLES (name:type, * = required):\n' +
    pTables(def) +
    (def.process ? '\n\nACCESS:\n' + pAccess(def) + '\n\nWORKFLOW:\n' + pFlow(def as BackedDef) : '') +
    (def.screens && def.screens.length
      ? '\n\nSCREENS: ' +
        def.screens.map((s) => s.name + ' (' + s.type + ' on ' + s.table + ')').join('; ') +
        '\nLAYOUT: ' +
        JSON.stringify({
          accent: def.theme.accent,
          nav: def.theme.nav,
          density: def.theme.density,
        })
      : '');
  return (
    HEAD(PROMPT_AS[id] || rv.name) +
    (stepAuto(flowOf(app), id)
      ? 'You are a step in the build workflow of the app "' +
        app.name +
        '". Your job: ' +
        rv.job +
        ' You propose changes; code applies each one only if it passes every check.'
      : 'You review one step of the build and advise the owner. Your job: ' + rv.job + ' You change nothing yourself.') +
    '\n\n' +
    (ctx || all) +
    '\n\nList at most 4 findings that matter to the people who will use this app. Leave out anything that is fine. For each finding, "fix" is ONE change request the owner could send, written like one of these lines, or null when no such change fixes it:\n- Add a <name> field to <table>\n- Remove the <field> field from <table>\n- Rename <field> in <table> to "<new name>"\n- Let <role> see|create|edit|delete their own <table>\n- Stop <role> from seeing|creating|editing|deleting <table>\n- Add a chart of <table> by <column> to the dashboard\n- Add a board|calendar|timeline|chart|pivot|tree|cards of <table> by <column>\n- Remove the <screen name> screen\n- Turn <field> in <table> into a choice\n- Use side navigation\n- Use the colour <name>\n- Make the rows compact\n\nFORMAT: {"findings":[{"level":"high|medium|low","text":"one sentence: what is wrong","why":"one short sentence","fix":"one change request, or null"}]}'
  );
}
export const normFindings = (o: Untrusted) =>
  rankFindings(
    arr<Untrusted>(o && o.findings).flatMap((f): Finding[] =>
      f && str(f.text)
        ? [
            {
              level: lc(f.level) in LEVELS ? (lc(f.level) as Level) : 'low',
              text: str(f.text).slice(0, 220),
              why: str(f.why).slice(0, 180),
              fix:
                str(f.fix) && lc(f.fix) !== 'null'
                  ? str(f.fix)
                      .replace(/[.!]+$/, '')
                      .slice(0, 160)
                  : null,
            },
          ]
        : [],
    ),
  );
export function tryFix(app: BuiltApp, fix: string): { test: string; block: string } {
  // would this change pass every check? Apply it for real inside a savepoint, run the checks, then put everything back
  let plan: Partial<ParsedChange>;
  try {
    plan = parseChange(app, fix);
  } catch {
    plan = {};
  }
  if (!plan.ops || !plan.ops.length)
    return {
      test: 'unknown',
      block: '',
    };
  const p = planOps(app, plan.ops);
  if (!p.steps.length)
    return {
      test: 'fail',
      block: p.errors[0] || 'It cannot be applied to this app.',
    };
  const keep = JSON.stringify({
      def: app.def,
      name: app.name,
      icon: app.icon,
      accent: app.accent,
      seed: app.seed,
      renamed: app.renamed,
      matrix: app.matrix || null,
      results: app.line.walkthrough.results,
    }),
    rev = app.rev,
    T = TESTS[app.id],
    fresh = T && T.rev === rev,
    tsum = app.tests && app.tests.rev === rev;
  let res = null,
    err = '';
  dbSavepoint(app.id, 'dry');
  try {
    res = applyChangeSync(app, p.steps, {
      agent: 'orchestrator',
      runId: 'dry',
      appId: app.id,
      runN: 0,
    });
  } catch (e) {
    err = errText(e);
  }
  dbRollback(app.id, 'dry');
  const b = JSON.parse(keep);
  app.def = b.def;
  app.name = b.name;
  app.icon = b.icon;
  app.accent = b.accent;
  app.seed = b.seed;
  app.renamed = b.renamed;
  app.matrix = b.matrix;
  app.line.walkthrough.results = b.results;
  app.rev = rev + 3;
  if (fresh) T.rev = app.rev;
  if (tsum && app.tests) app.tests.rev = app.rev; // the definition is what it was, so what the tests found still holds
  Object.keys(app.reviews || {}).forEach((k) => {
    if (app.reviews[k].rev === rev) app.reviews[k].rev = app.rev;
  }); // and so does every review that was up to date
  if (err || !res)
    return {
      test: 'fail',
      block: err || 'It could not be applied.',
    };
  if (res.failed) {
    const bad = res.per[res.failed] || {};
    return {
      test: 'fail',
      block: stName(res.failed) + ' would fail: ' + ((bad.issues || [])[0] || 'a check'),
    };
  }
  return {
    test: 'pass',
    block: p.steps.some((s) => s.destructive) ? 'It deletes data, so you will be asked to approve it.' : '',
  };
}
export async function verifyFindings(app: AppRecord, only?: string) {
  // once the whole app exists, every proposed fix is tried out and put back, so Apply is never a surprise
  const out = {
    n: 0,
    pass: 0,
  };
  if (app.status !== 'ready') return out;
  const mine = !RUNS[app.id];
  if (mine)
    RUNS[app.id] = {
      stop: false,
      runId: 'verify',
    }; // nothing else may change the app between two try-outs
  try {
    for (const id of Object.keys(app.reviews || {})) {
      const R = app.reviews[id];
      if ((only && only !== id) || !R || R.status !== 'ok') continue;
      for (const f of R.findings) {
        if (!f.fix || f.state !== 'open' || f.test) continue;
        try {
          Object.assign(f, tryFix(app as BuiltApp, f.fix));
        } catch (e) {
          console.error(e);
          f.test = 'unknown';
          f.block = '';
        }
        out.n++;
        if (f.test === 'pass') out.pass++;
        notify();
        await sleep(0);
      }
    }
  } finally {
    if (mine) delete RUNS[app.id];
  }
  commit();
  return out;
}
export async function runReview(app: AppRecord, id: string, run: Run, own?: boolean) {
  // advisory: a reviewer never stops the line. own: asked for on a finished app, outside a build
  const rv = REVIEWERS[id],
    who = 'rv_' + id,
    auto = stepAuto(flowOf(app), id),
    st = STATIONS[stationIdx(stepAfter(flowOf(app), id))],
    model = liveModelOn() && (own || app.mode === 'live');
  const R: Review = (app.reviews[id] = {
    status: 'working',
    at: Date.now(),
    rev: app.rev,
    findings: [],
    by: model ? 'model' : 'rules',
    note: '',
  });
  if (U.follow[app.id] !== false && !own) U.sel[app.id] = who;
  emit('STEP_STARTED', {
    stepName: 'review_' + id,
    runId: run.id,
    app: app.id,
  });
  commit();
  const s = stepStart(
    run,
    st.id,
    who,
    (rv.custom ? 'Your agent' : auto ? 'Step' : 'Review') + (model ? ' · model call' : ' · rules'),
    model ? 'model' : 'tool',
  );
  let list: Finding[] | null = null;
  try {
    if (model) {
      try {
        list = normFindings(await callModel(app, run, who, reviewPrompt(app, id), 1));
      } catch (e) {
        if (e instanceof Stopped) throw e;
        R.by = 'rules';
        R.note = 'The model did not answer (' + errText(e).replace(/\.$/, '') + '), so the built-in rules did this review.';
      }
    }
    if (!list) {
      await pace(app, 950);
      list = REVIEW_RULES[id] ? REVIEW_RULES[id](app) : customRules(app, rv);
      if (rv.custom && !model)
        R.note = list.length
          ? 'Without a model this agent does the changes the built-in reader finds in its instruction. In a Live build it reads the app and decides for itself.'
          : 'Without a model this agent can only do what the built-in reader finds in its instruction, and it found no change there. Write the job as plain changes, or switch Live on.';
    }
  } catch (e) {
    stepEnd(s, false);
    R.status = 'failed';
    commit();
    throw e;
  }
  stepEnd(s, true);
  R.findings = list.map((f, i) => ({
    id: id + '_' + (i + 1),
    level: f.level,
    text: f.text,
    why: f.why || '',
    fix: f.fix || null,
    state: 'open',
    test: null,
    block: '',
  }));
  R.status = 'ok';
  R.at = Date.now();
  R.rev = app.rev;
  if (own) {
    R.rev = app.rev;
    await verifyFindings(app, id);
    if (auto) applyAuto(app, run, id, true);
  }
  emit('STATE_DELTA', {
    app: app.id,
    source: 'agent',
    delta: [
      {
        op: 'replace',
        path: '/reviews/' + id,
        value: R.findings.length + ' findings',
      },
    ],
  });
  emit('STEP_FINISHED', {
    stepName: 'review_' + id,
    runId: run.id,
    app: app.id,
  });
  const n = R.findings.length;
  const did = R.findings.filter((f) => f.state === 'applied').length;
  say(
    app,
    who,
    !n
      ? R.note && rv.custom
        ? R.note
        : 'I read ' + rv.reads + ' and found nothing I would change.'
      : auto
        ? own
          ? 'I read ' +
            rv.reads +
            ' and applied ' +
            did +
            ' of ' +
            n +
            (n === 1 ? ' change' : ' changes') +
            '. Each one passed every check first.'
          : 'I read ' +
            rv.reads +
            ' and propose ' +
            n +
            (n === 1 ? ' change' : ' changes') +
            '. I apply them when the app is complete, each one checked first.'
        : 'I read ' + rv.reads + '. ' + n + (n === 1 ? ' thing' : ' things') + ' to look at. Nothing changes until you apply one.',
    {
      type: 'review',
      reviewer: id,
      stamp: R.at,
    },
  );
  commit();
}
export async function reviewNow(app: AppRecord, id: string, viaChat?: boolean) {
  // run one review on a finished app. Only this reviewer works; no station runs again.
  const rv = REVIEWERS[id],
    tell = (t: string) => (viaChat ? say(app, 'orchestrator', t) : toast(t, 'info'));
  if (!rv) return;
  if (RUNS[app.id] || PENDING[app.id]) return void tell('A run is in progress. I will take that when it has finished.');
  if (TEAMS[app.id]?.status === 'running') return void tell(TEAM_BUSY);
  if (app.status !== 'ready') return void tell(rv.short + ' runs when the build passes ' + stName(stepAfter(flowOf(app), id)) + '.');
  const run = newRun(app, stepAuto(flowOf(app), id) ? 'step' : 'review', rv.short, liveModelOn() ? 'live' : 'demo'),
    ctl = (RUNS[app.id] = {
      stop: false,
      runId: run.id,
    });
  emit('RUN_STARTED', {
    runId: run.id,
    threadId: app.id,
    app: app.id,
  });
  U.runSel[app.id] = null;
  commit();
  try {
    await runReview(app, id, run, true);
    run.status = 'ok';
  } catch (e) {
    run.status = e instanceof Stopped ? 'stopped' : 'failed';
    if (!(e instanceof Stopped)) {
      if (!(e as { fatal?: boolean } | null)?.fatal) console.error(e);
      say(app, 'orchestrator', 'The review stopped. ' + errText(e), {
        type: 'error',
      });
    }
  }
  run.t1 = Date.now();
  if (RUNS[app.id] === ctl) delete RUNS[app.id];
  U.stream[app.id] = 0;
  app.updated = Date.now();
  emit('RUN_FINISHED', {
    runId: run.id,
    threadId: app.id,
    app: app.id,
    status: run.status,
  });
  commit();
}
export function customRules(app: AppRecord, rv: Reviewer) {
  // an agent the owner described, without a model: every sentence of its job that reads as a change becomes one
  const out: Finding[] = [];
  str(rv.job)
    .split(/(?<=[.!?;])\s+|\n+|\s+(?:and then|then)\s+/i)
    .map((x) => x.trim().replace(/[.!?;]+$/, ''))
    .filter(Boolean)
    .slice(0, 8)
    .forEach((sent) => {
      let plan: ParsedChange | null = null;
      try {
        plan = parseChange(app, sent);
      } catch {
        plan = null;
      }
      if (plan && plan.ops && plan.ops.length)
        out.push({
          level: 'medium',
          text: sent,
          why: 'From the job you gave this agent.',
          fix: sent,
        });
    });
  return out;
}
export function applyAuto(app: AppRecord, run: Run, only?: string, own?: boolean) {
  // steps set to apply: every proposed change goes through the same checked pipeline as a change asked for in chat
  const f = flowOf(app),
    out = {
      n: 0,
      ok: 0,
    };
  f.reviewers.forEach((id) => {
    const R = (app.reviews || {})[id];
    if ((only && only !== id) || !R || R.status !== 'ok' || !stepAuto(f, id)) return;
    const items: string[] = [];
    R.findings.forEach((x) => {
      if (!x.fix || x.state !== 'open' || x.test === 'fail') return;
      out.n++;
      const r = keepFix(app as BuiltApp, x.fix, ctxOf(app, run, 'rv_' + id));
      if (r.ok) {
        x.state = 'applied';
        x.test = 'pass';
        x.block = '';
        out.ok++;
        items.push(r.items.join('; '));
      } else {
        x.test = 'fail';
        x.block = r.why;
      }
    });
    if (items.length) {
      Object.keys(app.reviews).forEach((k) => {
        app.reviews[k].rev = app.rev;
      });
      if (!own)
        say(
          app,
          'rv_' + id,
          'Applied ' + items.length + (items.length === 1 ? ' change' : ' changes') + '. Each one passed every check first.',
          {
            type: 'changed',
            items,
            reran: [],
            skipped: [],
          },
        );
    }
  });
  if (out.ok && own) {
    Object.keys(app.reviews).forEach((k) => {
      app.reviews[k].rev = app.rev;
      app.reviews[k].findings.forEach((x) => {
        if (x.state === 'open' && k !== only) {
          x.test = null;
          x.block = '';
        }
      });
    });
    runTestsSync(app);
  }
  return out;
}

/* ---------- running again from one station: the stations before it are kept ---------- */
/** `auto`: the re-run queued after a workflow edit (src/workspace/rerun.tsx), which asks only when the database would be rebuilt. */
export async function rerunFrom(app: AppRecord, stId: string, viaChat?: boolean, auto?: boolean) {
  const i = stationIdx(stId),
    tell = (t: string) => (viaChat ? say(app, 'orchestrator', t) : toast(t, 'info'));
  if (i < 0) return;
  if (RUNS[app.id] || PENDING[app.id]) return void tell('A run is in progress. I will take that when it has finished.');
  if (app.status !== 'ready')
    return void tell('The app is not built yet, so there is nothing to keep. Use Run again to build it from the start.');
  if (i === 0) return void rebuildAsk(app);
  const again = STATIONS.slice(i).map((s) => s.name),
    kept = STATIONS.slice(0, i).map((s) => s.name);
  if (U.sheet) {
    U.sheet = null;
    notify();
  } // on a phone the question must not open behind the sheet it was asked from
  if (
    !auto &&
    !(await confirmBox({
      title: 'Run again from ' + STATIONS[i].name + '?',
      body:
        again.join(', ') +
        (again.length > 1 ? ' run' : ' runs') +
        ' again. ' +
        kept.join(', ') +
        (kept.length > 1 ? ' stay as they are.' : ' stays as it is.') +
        ' Changes you asked for at the stations that run again are replaced.' +
        (i === 1
          ? ' The database is rebuilt, so its records are replaced by the sample rows.'
          : ' Your records stay, and if a check fails the app is put back exactly as it is now.'),
      yes: 'Run again',
    }))
  )
    return;
  if (app.mode === 'live') {
    if (!online())
      return void tell('You are offline, so Live is paused. This app was built by the model; run it again when you are back online.');
    if (U.live !== 'ready') return void tell(NO_MODEL + ' This app was built by the model, so its stations cannot run again here.');
  }
  U.view[app.id] = 'build';
  runBuild(app as BuiltApp, stId);
}
export function FlowChips({ app, empty }: { app: AppRecord; empty?: string }) {
  const list = flowList(flowOf(app));
  return list.length ? (
    <div className="flow-chips">
      {list.map((x) => (
        <span key={x.text} className="badge b-outline">
          <Icon n={x.icon} s="12" />
          {x.text}
        </span>
      ))}
    </div>
  ) : empty ? (
    <span className="muted t-cap">{empty}</span>
  ) : null;
}
