import { modelProblem } from '@/shared/api-error';
import type {
  AppDef,
  AppTable,
  AppTeam,
  AppUser,
  BackedDef,
  BriefedDef,
  ColumnDef,
  Process,
  Row,
  TeamAgent,
  Untrusted,
} from '@/shared/types/app';
import type { AppRecord, Dict, Loose } from '@/shared/types/workspace';
import { ICONS } from './icons';
import {
  ACC_PICK,
  MODELCALLS,
  NO_MODEL,
  S,
  U,
  arr,
  brief,
  commit,
  cx,
  emit,
  errText,
  label,
  modeNow,
  notify,
  online,
  ring,
  sleep,
  snake,
  str,
  toast,
  toolCall,
  uid,
} from './core';
import { ACCENTS, accOf, apiCall, appUsers, chk, colOf, seedValue, tableOf } from './engine';
import type { ApiResult } from './engine';
import { REC, allConnectors, callConnector, connOn } from './builds';
import { RUNS, SPEED, Stopped, fatal } from './line';
import { TeamStreamError, jsonObject, splitToolName, streamTeam } from './team-stream';
import { Icon } from './ui';
import { rowTitle } from './runtime';

/* ===== Turnkey prototype · agent teams inside a built app =====
   Some apps do their work with agents of their own: a fact-check desk, a prior-art scout, a debate partner.
   The Backend agent writes the team as data: who the agents are, which table each one writes, and which
   workflow actions open and close a run. This engine runs any such team. Every write goes through the app's
   own API as the person who pressed Run, so the access rules apply to the agents as well. */
/** One agent's part of a team run, as the room shows it. */
export interface TeamStep {
  id: string;
  status: string;
  say: string;
  tools: { name: string; tool: string; args: unknown; ok: boolean; real?: boolean }[];
  rows: { table: string; id: number; title: string }[];
  updated: number;
  problems: string[];
  checks: string[];
  t0?: number;
  t1?: number;
}
/** A note a person added to a run. */
export interface TeamNote {
  who: string;
  text: string;
  table?: string;
  id?: number;
}
/** One run of an app's own agent team. */
export interface TeamRun {
  id: string;
  n: number;
  /** the row the team works on */
  table: string;
  row: number;
  by: number;
  live: boolean;
  /** the agent working now */
  i: number;
  steps: TeamStep[];
  /** ids of the rows this run added, by table, in order */
  made: Dict<number[]>;
  notes: TeamNote[];
  status: string;
  stop: boolean;
  wait: { text: string } | null;
  calls: number;
  tokIn: number;
  tokOut: number;
  t0: number;
  t1: number | null;
  error: string;
  ctrl?: AbortController | null;
  resume?: (() => void) | null;
  abort?: (() => void) | null;
}
/** An app with an agent team. */
type TeamApp = AppRecord & { def: BackedDef & { team: AppTeam } };
/** The writes the app's API made for one agent. */
interface TeamDid {
  rows: TeamStep['rows'];
  updated: number;
  problems: string[];
}
/** App id -> the run in progress, or the last one. */
export const TEAMS: Dict<TeamRun> = {};
export class TeamStop extends Error {}
export function normTeam(o: Untrusted, def: AppDef, P: Process | null): AppTeam | null {
  if (!o || typeof o !== 'object') return null;
  const inp = o.input || {},
    it = tableOf(def, snake(inp.table));
  if (!it || !P || P.table !== it.name) return null;
  const ic = colOf(it, snake(inp.column)) || it.columns.find((c) => c.type === 'longtext') || colOf(it, it.title);
  const trans = (id: unknown) => (P.transitions.some((x) => x.id === snake(id)) ? snake(id) : null),
    fix = (v: unknown): Dict<Loose> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict<Loose>) : {});
  const agents: TeamAgent[] = arr(o.agents)
    .map((a: Untrusted, i) => {
      a = a || {};
      const w = tableOf(def, snake(a.writes)),
        u = tableOf(def, snake(a.updates));
      return {
        id: snake(a.id || a.name) || 'agent_' + (i + 1),
        name: str(a.name) || label(a.id) || 'Agent ' + (i + 1),
        icon: (ICONS as Dict<string>)[a.icon] ? a.icon : 'bot',
        acc: ACCENTS.includes(a.acc) ? a.acc : ACC_PICK[i % ACC_PICK.length],
        job: str(a.job),
        hint: str(a.hint),
        writes: w ? w.name : null,
        updates: u ? u.name : null,
        sets: arr(a.sets)
          .map(snake)
          .filter((c) => colOf(it, c) && c !== P.column),
        fixed: fix(a.fixed),
        tools: arr(a.tools)
          .map((x: Untrusted) => ({
            connector: str(x && x.connector),
            tool: str(x && x.tool),
          }))
          .filter((x) => x.connector && x.tool),
      };
    })
    .filter((a) => a.writes || a.updates || a.sets.length)
    .slice(0, 4);
  if (agents.length < 2) return null;
  const jt = o.jump && tableOf(def, snake(o.jump.table)),
    jc = jt && colOf(jt, snake(o.jump.column));
  return {
    title: str(o.title) || 'Agent team',
    about: str(o.about),
    input: {
      table: it.name,
      column: (ic as ColumnDef).name,
    },
    agents,
    start: trans(o.start),
    done: trans(o.done),
    pause:
      o.pause && agents.some((a) => a.id === snake(o.pause.before))
        ? {
            before: snake(o.pause.before),
            text: str(o.pause.text) || 'Add something before the next agent runs, or continue.',
          }
        : null,
    jump: jc
      ? {
          table: jt.name,
          column: jc.name,
          set: fix(o.jump.set),
          label: str(o.jump.label) || 'Add your own point',
        }
      : null,
    samples: arr(o.samples)
      .map((s: Untrusted) => ({
        label: str(s && s.label),
        values: fix(s && s.values),
      }))
      .filter((s) => s.label)
      .slice(0, 4),
  };
}
export function canRunTeam(def: AppDef, role: string) {
  // may this role start a run and write everything the agents write?
  const tm = def.team,
    P = def.process;
  if (!tm || !P) return false;
  const a0 = accOf(def, role, tm.input.table);
  return (
    a0.create &&
    a0.update !== 'none' &&
    tm.agents.every(
      (a) => (!a.writes || accOf(def, role, a.writes).create) && (!a.updates || accOf(def, role, a.updates).update !== 'none'),
    ) &&
    [tm.start, tm.done].filter(Boolean).every((id) => (P.transitions.find((x) => x.id === id)?.roles || []).includes(role)) &&
    (!tm.jump || accOf(def, role, tm.jump.table).create)
  );
}
export function checkTeam(def: BriefedDef, team: AppTeam) {
  const it = tableOf(def, team.input.table) as AppTable,
    bad: string[] = [],
    linked = (t: AppTable) =>
      t.name === it.name ||
      t.columns.some(
        (c) =>
          c.type === 'ref' &&
          (c.ref === it.name ||
            def.tables.some((k) => k.name === c.ref && k.name !== t.name && k.columns.some((x) => x.type === 'ref' && x.ref === it.name))),
      );
  team.agents.forEach((a) =>
    [a.writes, a.updates].filter(Boolean).forEach((tn) => {
      if (!linked(tableOf(def, tn) as AppTable)) bad.push(a.name + ' writes ' + tn + ', which has no link back to ' + it.name);
    }),
  );
  if (!team.start || !team.done) bad.push('the team needs one workflow action that opens a run and one that closes it');
  const able = def.brief.roles.filter((r) => canRunTeam(def, r.id)).map((r) => r.name);
  if (!able.length) bad.push('no role may start a run and also write what the agents write');
  return chk(
    "The app's own agents can do their work through the API",
    !bad.length,
    bad.length ? bad.join('; ') : team.agents.map((a) => a.name).join(' → ') + ', started by ' + able.join(' or '),
  );
}
export const teamNeeds = (team: AppTeam) => {
  const out: string[] = [];
  team.agents.forEach((a) =>
    a.tools.forEach((x) => {
      if (!out.includes(x.connector)) out.push(x.connector);
    }),
  );
  return out;
};
export const teamAgentOf = (appId: string, id: string) => {
  const a = S.apps[appId],
    tm = a && a.def && a.def.team;
  return tm ? tm.agents.find((x) => x.id === id) || null : null;
};
export const sameText = (a: unknown, b: unknown) => str(a).replace(/\s+/g, ' ') === str(b).replace(/\s+/g, ' ');
export function teamCase(app: TeamApp, text: string) {
  const rec = app.tpl ? REC[app.tpl] : undefined,
    col = app.def.team.input.column;
  return ((rec && rec.cases) || []).find((c) => sameText(c.values[col], text)) || null;
} // a saved run for exactly this input, if there is one

/* ---------- running a team ---------- */
export async function tpace(T: TeamRun, ms: number) {
  const end = Date.now() + Math.max(0, ms * ((SPEED as Dict<number>)[S.settings.speed] || 1));
  for (;;) {
    if (T.stop) throw new TeamStop();
    const left = end - Date.now();
    if (left <= 0) return;
    await sleep(Math.min(120, left));
  }
}
export function teamVals(app: AppRecord, T: TeamRun, t: AppTable, row: Untrusted, fixed: Dict<Loose> | undefined): Row {
  // an agent names other rows by their position in this run; code turns that into real ids
  const out: Row = {},
    src = Object.assign({}, row, fixed),
    look = {
      user: (name: unknown) =>
        (
          appUsers(app).find((u) => sameText(u.name.toLowerCase(), String(name).toLowerCase())) || {
            id: 0,
          }
        ).id,
      ref: () => 0,
    };
  t.columns.forEach((c) => {
    if (c.type === 'ref') {
      if (c.ref === T.table) {
        out[c.name] = T.row;
        return;
      }
      const made = c.ref ? T.made[c.ref] : undefined,
        n = parseInt(src[c.name], 10);
      if (made && n > 0 && made[n - 1]) out[c.name] = made[n - 1];
      return;
    }
    const v = src[c.name];
    if (v === undefined || v === null || v === '') return;
    const r = seedValue(c, v, look);
    if (r[0] != null) out[c.name] = typeof r[0] === 'string' ? r[0].slice(0, 1500) : r[0];
  });
  return out;
}
export function teamApply(app: TeamApp, user: AppUser, T: TeamRun, a: TeamAgent, out: Untrusted): TeamDid {
  // put one agent's output into the app through its API
  const def = app.def,
    did: TeamDid = {
      rows: [],
      updated: 0,
      problems: [],
    },
    api = (m: string, p: string, b?: Row) => apiCall(app, user, m, p, b || {}, 'team'),
    err = ({ status, error, fields }: ApiResult) =>
      status +
      ' ' +
      error +
      (fields
        ? ' (' +
          Object.keys(fields)
            .map((k) => k + ' ' + fields[k])
            .join(', ') +
          ')'
        : '');
  if (a.writes) {
    const t = tableOf(def, a.writes) as AppTable;
    arr(out.rows)
      .slice(0, 12)
      .forEach((row: Untrusted) => {
        const r = api('POST', '/api/' + t.name, teamVals(app, T, t, row || {}, a.fixed));
        if (r.status === 201) {
          (T.made[t.name] = T.made[t.name] || []).push(r.data.id);
          did.rows.push({
            table: t.name,
            id: r.data.id,
            title: rowTitle(app, user, t, r.data),
          });
        } else did.problems.push(err(r));
      });
  }
  if (a.updates) {
    const t = tableOf(def, a.updates) as AppTable,
      made = T.made[t.name] || [];
    arr(out.update).forEach((u: Untrusted) => {
      const id = made[parseInt(u && u.row, 10) - 1];
      if (!id) return;
      const body = teamVals(app, T, t, u, {});
      Object.keys(body).forEach((k) => {
        if (!(k in u)) delete body[k];
      });
      if (!Object.keys(body).length) return;
      const r = api('PATCH', '/api/' + t.name + '/' + id, body);
      if (r.status === 200) did.updated++;
      else did.problems.push(err(r));
    });
  }
  if (a.sets.length && out.summary && typeof out.summary === 'object') {
    const it = tableOf(def, T.table) as AppTable,
      pick: Row = {};
    a.sets.forEach((k) => {
      if (out.summary[k] != null) pick[k] = out.summary[k];
    });
    const body = teamVals(app, T, it, pick, {});
    if (Object.keys(body).length) {
      const r = api('PATCH', '/api/' + it.name + '/' + T.row, body);
      if (r.status === 200) did.updated++;
      else did.problems.push(err(r));
    }
  }
  return did;
}
/* ---------- Live: the team runs on the server ----------
   The server (POST /api/agent/team) runs the team as a LangGraph graph with real lookups in public sources, checks
   each agent's work and can send it back once. The browser owns the app's database, so each accepted answer comes
   back as an event and is written here through the app's own API, as the person who pressed Run. */
const TEAM_COL_TYPES = ['text', 'longtext', 'number', 'money', 'date', 'datetime', 'bool', 'select', 'ref', 'user'];
const cut = (v: unknown, n: number) => str(v).slice(0, n);
function teamColumn(c: ColumnDef) {
  const type = TEAM_COL_TYPES.includes(c.type) ? c.type : 'text',
    o: { name: string; type: string; options?: string[]; ref?: string } = { name: cut(c.name, 60), type };
  if (type === 'select')
    o.options = arr(c.options)
      .map((x) => cut(x, 80))
      .slice(0, 30);
  if (type === 'ref' && c.ref) o.ref = cut(c.ref, 60);
  return o;
}
export function teamRequest(app: TeamApp, user: AppUser, T: TeamRun) {
  // what the server needs to run the team: the team, the row it works on, and the tables its answers are checked against
  const def = app.def,
    team = def.team,
    P = def.process,
    it = tableOf(def, T.table) as AppTable,
    names = [it.name];
  team.agents.forEach((a) =>
    [a.writes, a.updates].forEach((n) => {
      if (n && !names.includes(n)) names.push(n);
    }),
  );
  const row: Row = apiCall(app, user, 'GET', '/api/' + it.name + '/' + T.row, {}, 'team').data || {},
    clean: Row = {};
  it.columns.forEach((c) => {
    const v = row[c.name];
    if (v == null || v === '' || c.type === 'user' || c.type === 'ref' || (P && P.table === it.name && c.name === P.column)) return;
    clean[c.name] = typeof v === 'string' ? v.slice(0, 2000) : v;
  });
  return {
    runId: T.id,
    appName: cut(app.name, 120) || 'this app',
    team: {
      title: cut(team.title, 100),
      about: cut(team.about, 600),
      agents: team.agents.map((a) => ({
        id: cut(a.id, 60),
        name: cut(a.name, 60),
        job: cut(a.job, 600),
        hint: cut(a.hint, 600),
        writes: a.writes,
        updates: a.updates,
        sets: a.sets.slice(0, 12),
        fixed: a.fixed,
        tools: a.tools.slice(0, 6),
      })),
      pause: team.pause ? { before: team.pause.before, text: cut(team.pause.text, 300) } : null,
    },
    input: { table: it.name, column: team.input.column, text: cut(row[team.input.column], 8000), row: clean },
    tables: names
      .map((n) => tableOf(def, n))
      .filter((t): t is AppTable => !!t)
      .slice(0, 12)
      .map((t) => ({ name: t.name, one: cut(t.one, 60) || undefined, columns: t.columns.slice(0, 40).map(teamColumn) })),
    notes: T.notes.slice(-10).map((n) => ({ who: cut(n.who, 60), text: cut(n.text, 1500) })),
  };
}
export function teamServerTool(app: TeamApp, T: TeamRun, i: number, name: unknown, argText: unknown, content: unknown) {
  // a lookup the server made: logged like any connector call, and shown on the agent's step
  const { connector, tool } = splitToolName(str(name)),
    c = allConnectors().find((x) => x.id === connector) || { name: connector },
    args = jsonObject(argText),
    r = jsonObject(content),
    a = app.def.team.agents[i],
    ok = r.ok !== false;
  toolCall(
    { agent: a ? a.id : str(r.agent), runId: T.id, appId: app.id },
    c.name + ' · ' + tool,
    args,
    () => {
      if (!ok) throw new Error(str(r.text) || 'The lookup failed.');
      return { text: str(r.text) };
    },
    'connector',
  );
  if (T.steps[i]) {
    T.steps[i].tools.push({ name: c.name, tool, args: Object.values(args)[0], ok, real: true });
    notify();
  }
}
async function teamServer(app: TeamApp, user: AppUser, T: TeamRun, finishStep: (i: number, out: Untrusted) => Promise<void>) {
  const team = app.def.team,
    at = (id: unknown) => team.agents.findIndex((a) => a.id === id);
  let resume: Untrusted = null;
  for (let leg = 0; leg < 2; leg++) {
    // one request, and one more after the pause if the team has one
    const body: ReturnType<typeof teamRequest> & { resume?: Untrusted } = teamRequest(app, user, T);
    if (resume) body.resume = resume;
    T.ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const calls: Dict<{ name: string; args: string }> = {};
    let snapshot: Untrusted = null,
      result: Untrusted = null;
    try {
      for await (const ev of streamTeam(body, T.ctrl ? T.ctrl.signal : undefined)) {
        // the server's events, read field by field below
        const e: Untrusted = ev;
        if (T.stop) throw new TeamStop();
        if (e.type === 'STEP_STARTED') {
          const i = at(e.stepName);
          if (i < 0) continue;
          const st = T.steps[i];
          T.i = i;
          st.status = 'working';
          st.t0 = Date.now();
          T.calls++;
          U.calls++;
          emit('STEP_STARTED', { app: app.id, runId: T.id, stepName: team.agents[i].id, agent: team.agents[i].id, server: true });
          notify();
        } else if (e.type === 'TOOL_CALL_START') calls[e.toolCallId] = { name: e.toolCallName, args: '' };
        else if (e.type === 'TOOL_CALL_ARGS' && calls[e.toolCallId]) calls[e.toolCallId].args += str(e.delta);
        else if (e.type === 'TOOL_CALL_RESULT') {
          const c = calls[e.toolCallId] || { name: '', args: '' };
          teamServerTool(app, T, T.i, c.name, c.args, e.content);
        } else if (e.type === 'CUSTOM' && e.name === 'check') {
          const v = e.value || {},
            i = at(v.agent);
          if (i >= 0 && v.sentBack) {
            T.steps[i].checks.push(str(v.reason));
            T.calls++;
            U.calls++;
            notify();
          }
          // in the activity panel's words: a check that passed, or one that sent the work back with its reason
          const where = { app: app.id, runId: T.id, agent: v.agent, stepName: v.agent, server: true };
          if (v.sentBack) {
            emit('CUSTOM', { ...where, name: 'sent_back', value: { issues: 1, by: v.by } });
            emit('CUSTOM', { ...where, name: 'issues', value: { issues: [str(v.reason)] } });
          } else emit('CUSTOM', { ...where, name: 'checks', value: { passed: v.ok ? 1 : 0, failed: v.ok ? 0 : 1, by: v.by } });
        } else if (e.type === 'CUSTOM' && e.name === 'interrupt') snapshot = (e.value || {}).snapshot || null;
        else if (e.type === 'CUSTOM' && e.name === 'cap') emit('CUSTOM', { app: app.id, runId: T.id, name: 'cap', value: e.value });
        else if (e.type === 'STATE_DELTA') {
          for (const d of arr(e.delta)) {
            const m = /^\/outputs\/(.+)$/.exec(str(d && d.path));
            if (m && at(m[1]) >= 0) await finishStep(at(m[1]), d.value || {});
          }
        } else if (e.type === 'RUN_FINISHED') result = e.result || {};
        else if (e.type === 'RUN_ERROR') {
          const known = e.code === 'not_configured' || e.code === 'rate_limited' || e.code === 'budget' || e.code === 'spend_cap';
          const msg = known ? modelProblem(e.code) : str(e.message) || 'The team could not finish this run.';
          throw known ? fatal(msg) : new Error(msg);
        }
      }
    } catch (e) {
      if (T.stop || (e instanceof TeamStreamError && e.code === 'aborted')) throw new TeamStop();
      if (e instanceof TeamStreamError) {
        throw fatal(e.message);
      }
      throw e;
    }
    if (!result) throw new Error('The connection to the server ended before the run finished.');
    if (result.status === 'paused' && snapshot && !resume) {
      const before = T.notes.length;
      await teamWait(app, T);
      const added = T.notes.slice(before);
      resume = {
        snapshot,
        note: added.length ? { who: cut(added[added.length - 1].who, 60), text: cut(added.map((n) => n.text).join('\n'), 1500) } : null,
      };
      continue;
    }
    if (result.status === 'stopped') throw new TeamStop();
    if (result.status !== 'done') throw new Error(str(result.reason) || 'The team stopped before it finished.');
    return;
  }
  throw new Error('The team paused a second time, which this app does not expect.');
}
export function teamWait(app: TeamApp, T: TeamRun): Promise<void> {
  // human in the loop: the run pauses so the person can jump in
  T.wait = {
    text: app.def.team.pause ? app.def.team.pause.text : '',
  };
  emit('CUSTOM', {
    name: 'interrupt',
    app: app.id,
    runId: T.id,
    value: {
      reason: 'jump_in',
      text: T.wait.text,
    },
  });
  notify();
  return new Promise((res, rej) => {
    T.resume = () => {
      T.wait = null;
      T.resume = null;
      T.abort = null;
      emit('CUSTOM', {
        name: 'resume',
        app: app.id,
        runId: T.id,
        value: {
          added: T.notes.length,
        },
      });
      notify();
      res();
    };
    T.abort = () => rej(new TeamStop());
  });
}
export function teamJump(app: TeamApp, user: AppUser, text: string) {
  // the person adds a row of their own to the run
  const T = TEAMS[app.id],
    j = app.def.team.jump,
    t = j && tableOf(app.def, j.table);
  if (!T || !j || !t || !str(text)) return false;
  const r = apiCall(
    app,
    user,
    'POST',
    '/api/' + t.name,
    teamVals(
      app,
      T,
      t,
      {
        [j.column]: str(text),
      },
      j.set,
    ),
    'team',
  );
  if (r.status !== 201) {
    toast(r.status + ' ' + r.error, 'danger');
    return false;
  }
  T.notes.push({
    who: user.name,
    text: str(text),
    table: t.name,
    id: r.data.id,
  });
  commit();
  return true; // kept apart from the agents' rows, so their row numbers do not shift
}
export function stopTeam(app: AppRecord) {
  const T = TEAMS[app.id];
  if (!T || T.status !== 'running') return;
  T.stop = true;
  if (T.abort) T.abort();
  if (T.ctrl) {
    try {
      T.ctrl.abort();
    } catch {}
  }
}
export async function runTeam(app: TeamApp, user: AppUser, rowId: number, script?: Untrusted[] | null) {
  // script: a saved run (Demo). Without one, the team runs on the server with a real model and real lookups (Live).
  const def = app.def,
    team = def.team,
    it = tableOf(def, team.input.table) as AppTable,
    api = (m: string, p: string) => apiCall(app, user, m, p, {}, 'team');
  const T: TeamRun = (TEAMS[app.id] = {
    id: uid('team'),
    n: 0,
    table: it.name,
    row: rowId,
    by: user.id,
    live: !script,
    i: -1,
    steps: team.agents.map((a) => ({
      id: a.id,
      status: 'idle',
      say: '',
      tools: [],
      rows: [],
      updated: 0,
      problems: [],
      checks: [],
    })),
    made: {},
    notes: [],
    status: 'running',
    stop: false,
    wait: null,
    calls: 0,
    tokIn: 0,
    tokOut: 0,
    t0: Date.now(),
    t1: null,
    error: '',
  });
  const ev = (type: string, d: Dict<unknown>) =>
      emit(
        type,
        Object.assign(
          {
            app: app.id,
            runId: T.id,
          },
          d,
        ),
      ),
    fill = (v: unknown) => (typeof v === 'string' ? v.replace('{{jump}}', T.notes.length ? T.notes[T.notes.length - 1].text : '') : v);
  ev('RUN_STARTED', {
    threadId: app.id,
    team: team.title,
  });
  notify();
  try {
    if (team.start) {
      const r = api('POST', '/api/' + it.name + '/' + rowId + '/' + team.start);
      if (r.status !== 200) throw new Error('The run could not start. ' + r.status + ' ' + r.error);
    }
    const finishStep = async (i: number, out: Untrusted) => {
      // one agent's accepted work goes into the app, a row at a time so the room fills in as people watch
      const a = team.agents[i],
        st = T.steps[i];
      st.say = str(out.say) || a.name + ' finished.';
      const mid = uid('m');
      ev('TEXT_MESSAGE_START', {
        messageId: mid,
        role: 'assistant',
        agent: a.id,
      });
      ev('TEXT_MESSAGE_CONTENT', {
        messageId: mid,
        delta: brief(st.say, 200),
        agent: a.id,
      });
      ev('TEXT_MESSAGE_END', {
        messageId: mid,
        agent: a.id,
      });
      const did: TeamDid = {
          rows: [],
          updated: 0,
          problems: [],
        },
        part = (o: Untrusted) => {
          const d = teamApply(app, user, T, a, o);
          did.rows = did.rows.concat(d.rows);
          did.updated += d.updated;
          did.problems = did.problems.concat(d.problems);
          st.rows = did.rows;
          st.updated = did.updated;
          st.problems = did.problems;
        };
      for (const row of arr(out.rows).slice(0, 12)) {
        part({
          rows: [row],
        });
        commit();
        await tpace(T, script ? 340 : 160);
      } /* one row at a time, so the room fills in as people watch */
      part({
        update: out.update,
        summary: out.summary,
      });
      st.t1 = Date.now();
      const wrote = did.rows.length + did.updated;
      st.status = wrote || !did.problems.length ? 'ok' : 'failed';
      ev('STATE_DELTA', {
        delta: [
          {
            op: 'add',
            path: '/' + (a.writes || a.updates || it.name),
            value: did.rows.length + ' rows written, ' + did.updated + ' updated',
          },
        ],
      });
      ev('STEP_FINISHED', {
        stepName: a.id,
        agent: a.id,
      });
      commit();
      if (st.status === 'failed') throw new Error(a.name + ' could not save its work. ' + did.problems[0]);
      if (script) await tpace(T, 450);
    };
    if (script) {
      for (let i = 0; i < team.agents.length; i++) {
        const a = team.agents[i],
          st = T.steps[i];
        if (team.pause && team.pause.before === a.id) await teamWait(app, T);
        T.i = i;
        st.status = 'working';
        st.t0 = Date.now();
        notify();
        ev('STEP_STARTED', {
          stepName: a.id,
          agent: a.id,
        });
        const sc = script.find((x) => x.agent === a.id) || {};
        await tpace(T, 650);
        for (const tl of arr(sc.tools)) {
          const c = allConnectors().find((x) => x.id === tl[0]) || {
              name: tl[0],
            },
            r = callConnector(app, a.id, T.id, tl[0], tl[1], tl[2]);
          st.tools.push({
            name: c.name,
            tool: tl[1],
            args: Object.values(tl[2] || {})[0],
            ok: r.ok,
          });
          notify();
          await tpace(T, 420);
        }
        const out =
          T.notes.length && sc.jumped
            ? Object.assign({}, sc, {
                say: str(sc.say) + ' ' + str(sc.jumped.say),
                rows: arr(sc.rows).concat(
                  arr(sc.jumped.rows).map((r: Untrusted) => {
                    const o: Row = {};
                    Object.keys(r).forEach((k) => {
                      o[k] = fill(r[k]);
                    });
                    return o;
                  }),
                ),
              })
            : sc;
        ring(
          MODELCALLS,
          {
            t: Date.now(),
            app: app.id,
            run: T.id,
            agent: a.id,
            mode: 'replay',
            model: 'saved run',
            tokIn: 900 + str(sc.say).length * 4,
            tokOut: 300 + Math.round(JSON.stringify(sc.rows || sc.update || '').length / 4),
            ms: 2400,
            attempt: 1,
          },
          200,
        );
        await tpace(T, 500 + str(sc.say).length * 7);

        await finishStep(i, out);
      }
    } else await teamServer(app, user, T, finishStep);
    if (team.done) {
      const r = api('POST', '/api/' + it.name + '/' + rowId + '/' + team.done);
      if (r.status !== 200) throw new Error('The run could not be closed. ' + r.status + ' ' + r.error);
    }
    T.status = 'done';
    toast(team.title + ' finished.', 'success');
  } catch (e) {
    const stopped = e instanceof TeamStop || e instanceof Stopped;
    T.status = stopped ? 'stopped' : 'failed';
    T.error = stopped ? '' : errText(e);
    T.wait = null;
    T.steps.forEach((s) => {
      if (s.status === 'working') s.status = stopped ? 'idle' : 'failed';
    });
    if (!stopped) {
      if (!(e as { fatal?: boolean }).fatal) console.warn(e);
      ev('RUN_ERROR', {
        message: T.error,
      });
    }
  } finally {
    T.t1 = Date.now();
    U.stream[app.id] = 0;
    ev('RUN_FINISHED', {
      threadId: app.id,
      status: T.status,
    });
    commit();
  }
}
export function teamBlock(app: TeamApp, user: AppUser | null, text: string): { text: string; fix?: string[] } | null {
  // why a run cannot start right now, or null
  const team = app.def.team,
    T = TEAMS[app.id],
    mode = modeNow(),
    needs = teamNeeds(team),
    off = needs.filter((id) => !connOn(id)),
    names = (ids: string[]) =>
      ids
        .map(
          (id) =>
            (
              allConnectors().find((c) => c.id === id) || {
                name: id,
              }
            ).name,
        )
        .join(' and ');
  if (T && T.status === 'running')
    return {
      text: 'The agents are working on another run.',
    };
  if (RUNS[app.id])
    return {
      text: 'The builders are working on this app. Try again when they have finished.',
    };
  if (off.length)
    return {
      text:
        names(off) +
        (off.length > 1 ? ' are' : ' is') +
        ' switched off for this workspace, and the agents need ' +
        (off.length > 1 ? 'them' : 'it') +
        '.',
      fix: off,
    };
  if (needs.length && !online())
    return {
      text: 'You are offline. The agents use ' + names(needs) + ', which need internet.',
    };
  if (!mode.live)
    return teamCase(app, text)
      ? null
      : {
          text:
            mode.id === 'demo'
              ? 'Demo replays saved runs, so pick one of the saved cases. To run the agents on your own text, switch Live on.'
              : mode.id === 'offline'
                ? 'You are offline, so Live is paused. Pick one of the saved cases, or run your own text when you are back online.'
                : mode.id === 'checking'
                  ? 'Still connecting to the model. Pick one of the saved cases, or try again in a moment.'
                  : NO_MODEL + ' Pick one of the saved cases.',
        };
  return null;
}

/* ---------- the room itself (the screen where people start a run and watch the agents) is in room.js ---------- */
export function TeamAv({ a, size }: { a: { acc: string; name: string; icon: string }; size?: string }) {
  return (
    <span className={cx('av sq', size && 'av-' + size, 'acc-' + a.acc)} title={a.name + ' agent'}>
      <Icon n={a.icon} s={size === 'lg' ? '24' : '16'} />
    </span>
  );
}
