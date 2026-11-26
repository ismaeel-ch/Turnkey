// @ts-nocheck -- converted from the prototype; types are added module by module
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
  label,
  modeNow,
  notify,
  online,
  ring,
  sleep,
  snake,
  str,
  toast,
  uid,
} from './core';
import { qi, sqlPeek } from './db';
import { ACCENTS, accOf, apiCall, appUsers, chk, colOf, seedValue, tableOf } from './engine';
import { REC, allConnectors, callConnector, connOn } from './builds';
import { RUNS, SPEED, Stopped, callModel } from './line';
import { Icon } from './ui';
import { rowTitle } from './runtime';

/* ===== Turnkey prototype · agent teams inside a built app =====
   Some apps do their work with agents of their own: a fact-check desk, a prior-art scout, a debate partner.
   The Backend agent writes the team as data: who the agents are, which table each one writes, and which
   workflow actions open and close a run. This engine runs any such team. Every write goes through the app's
   own API as the person who pressed Run, so the access rules apply to the agents as well. */
export const TEAMS = {}; // app id -> the run in progress, or the last one
export class TeamStop extends Error {}
export function normTeam(o, def, P) {
  if (!o || typeof o !== 'object') return null;
  const inp = o.input || {},
    it = tableOf(def, snake(inp.table));
  if (!it || !P || P.table !== it.name) return null;
  const ic = colOf(it, snake(inp.column)) || it.columns.find((c) => c.type === 'longtext') || colOf(it, it.title);
  const trans = (id) => (P.transitions.some((x) => x.id === snake(id)) ? snake(id) : null),
    fix = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const agents = arr(o.agents)
    .map((a, i) => {
      a = a || {};
      const w = tableOf(def, snake(a.writes)),
        u = tableOf(def, snake(a.updates));
      return {
        id: snake(a.id || a.name) || 'agent_' + (i + 1),
        name: str(a.name) || label(a.id) || 'Agent ' + (i + 1),
        icon: ICONS[a.icon] ? a.icon : 'bot',
        acc: ACCENTS.includes(a.acc) ? a.acc : ACC_PICK[i % ACC_PICK.length],
        job: str(a.job),
        hint: str(a.hint),
        proto: str(a.proto),
        writes: w ? w.name : null,
        updates: u ? u.name : null,
        sets: arr(a.sets)
          .map(snake)
          .filter((c) => colOf(it, c) && c !== P.column),
        fixed: fix(a.fixed),
        tools: arr(a.tools)
          .map((x) => ({
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
      column: ic.name,
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
      .map((s) => ({
        label: str(s && s.label),
        values: fix(s && s.values),
      }))
      .filter((s) => s.label)
      .slice(0, 4),
  };
}
export function canRunTeam(def, role) {
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
    [tm.start, tm.done].filter(Boolean).every((id) =>
      (
        P.transitions.find((x) => x.id === id) || {
          roles: [],
        }
      ).roles.includes(role),
    ) &&
    (!tm.jump || accOf(def, role, tm.jump.table).create)
  );
}
export function checkTeam(def, team) {
  const it = tableOf(def, team.input.table),
    bad = [],
    linked = (t) =>
      t.name === it.name ||
      t.columns.some(
        (c) =>
          c.type === 'ref' &&
          (c.ref === it.name ||
            def.tables.some((k) => k.name === c.ref && k.name !== t.name && k.columns.some((x) => x.type === 'ref' && x.ref === it.name))),
      );
  team.agents.forEach((a) =>
    [a.writes, a.updates].filter(Boolean).forEach((tn) => {
      if (!linked(tableOf(def, tn))) bad.push(a.name + ' writes ' + tn + ', which has no link back to ' + it.name);
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
export const teamNeeds = (team) => {
  const out = [];
  team.agents.forEach((a) =>
    a.tools.forEach((x) => {
      if (!out.includes(x.connector)) out.push(x.connector);
    }),
  );
  return out;
};
export const teamAgentOf = (appId, id) => {
  const a = S.apps[appId],
    tm = a && a.def && a.def.team;
  return tm ? tm.agents.find((x) => x.id === id) || null : null;
};
export const sameText = (a, b) => str(a).replace(/\s+/g, ' ') === str(b).replace(/\s+/g, ' ');
export function teamCase(app, text) {
  const rec = REC[app.tpl],
    col = app.def.team.input.column;
  return ((rec && rec.cases) || []).find((c) => sameText(c.values[col], text)) || null;
} // a saved run for exactly this input, if there is one

/* ---------- running a team ---------- */
export async function tpace(T, ms) {
  const end = Date.now() + Math.max(0, ms * (SPEED[S.settings.speed] || 1));
  for (;;) {
    if (T.stop) throw new TeamStop();
    const left = end - Date.now();
    if (left <= 0) return;
    await sleep(Math.min(120, left));
  }
}
export function teamVals(app, T, t, row, fixed) {
  // an agent names other rows by their position in this run; code turns that into real ids
  const out = {},
    src = Object.assign({}, row, fixed),
    look = {
      user: (name) =>
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
      const made = T.made[c.ref],
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
export function teamApply(app, user, T, a, out) {
  // put one agent's output into the app through its API
  const def = app.def,
    did = {
      rows: [],
      updated: 0,
      problems: [],
    },
    api = (m, p, b) => apiCall(app, user, m, p, b || {}, 'team'),
    err = (r) =>
      r.status +
      ' ' +
      r.error +
      (r.fields
        ? ' (' +
          Object.keys(r.fields)
            .map((k) => k + ' ' + r.fields[k])
            .join(', ') +
          ')'
        : '');
  if (a.writes) {
    const t = tableOf(def, a.writes);
    arr(out.rows)
      .slice(0, 12)
      .forEach((row) => {
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
    const t = tableOf(def, a.updates),
      made = T.made[t.name] || [];
    arr(out.update).forEach((u) => {
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
    const it = tableOf(def, T.table),
      pick = {};
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
export function teamPrompt(app, user, T, a) {
  const def = app.def,
    team = def.team,
    it = tableOf(def, T.table),
    P = def.process,
    clean = (t, r) => {
      const o = {};
      t.columns.forEach((c) => {
        if (r[c.name] != null && r[c.name] !== '' && c.type !== 'user' && !(c.type === 'ref' && c.ref === T.table))
          o[c.name] = c.type === 'ref' && T.made[c.ref] ? T.made[c.ref].indexOf(r[c.name]) + 1 : r[c.name];
      });
      return o;
    };
  const cols = (t, skip) =>
    t.columns
      .filter(
        (c) =>
          !(c.type === 'ref' && (c.ref === T.table || (!T.made[c.ref] && c.ref !== t.name))) &&
          !(P.table === t.name && c.name === P.column) &&
          c.type !== 'user' &&
          !(skip && c.name in skip),
      )
      .map(
        (c) =>
          c.name +
          ':' +
          c.type +
          (c.type === 'select'
            ? '[' + c.options.join('|') + ']'
            : c.type === 'ref'
              ? ' (the number of a ' + c.ref + ' row under WORK SO FAR)'
              : ''),
      )
      .join(', ');
  const row = apiCall(app, user, 'GET', '/api/' + it.name + '/' + T.row, {}, 'team').data || {};
  const work =
    Object.keys(T.made)
      .map((tn) => {
        const t = tableOf(def, tn);
        return (
          tn +
          ':\n' +
          T.made[tn]
            .map(
              (id, i) =>
                i + 1 + '. ' + JSON.stringify(clean(t, sqlPeek(app.id, 'SELECT * FROM ' + qi(tn) + ' WHERE id = ?', [id])[0] || {})),
            )
            .join('\n')
        );
      })
      .join('\n\n') || '(nothing yet)';
  const fmt = ['"say":"one sentence on what you did"'];
  if (a.writes) fmt.push('"rows":[{...}] where each row has these columns of ' + a.writes + ': ' + cols(tableOf(def, a.writes), a.fixed));
  if (a.updates)
    fmt.push('"update":[{"row":the number of a ' + a.updates + ' row, ...}] with any of these columns: ' + cols(tableOf(def, a.updates)));
  if (a.sets.length)
    fmt.push(
      '"summary":{...} with these columns of the ' +
        it.one.toLowerCase() +
        ': ' +
        a.sets
          .map((k) => {
            const c = colOf(it, k);
            return k + ':' + c.type + (c.type === 'select' ? '[' + c.options.join('|') + ']' : '');
          })
          .join(', '),
    );
  return (
    'You are ' +
    a.name +
    ', one of ' +
    team.agents.length +
    ' agents inside the app "' +
    app.name +
    '". ' +
    team.about +
    '\nYOUR JOB: ' +
    a.job +
    (a.hint ? ' ' + a.hint : '') +
    (a.proto ? '\nNOTE: ' + a.proto : '') +
    '\n\nTHE ' +
    it.one.toUpperCase() +
    ' YOU ARE WORKING ON:\n' +
    JSON.stringify(clean(it, row)) +
    '\n\nWORK SO FAR:\n' +
    work +
    (T.notes.length
      ? '\n\nADDED BY PEOPLE DURING THIS RUN (take these into account):\n' + T.notes.map((n) => '- ' + n.who + ': ' + n.text).join('\n')
      : '') +
    '\n\nReply with ONE JSON object and nothing else, no prose and no code fences: {' +
    fmt.join(', ') +
    '}\nRules: at most 6 rows. Keep every text under 280 characters. A choice column takes exactly one of its listed options. Dates are YYYY-MM-DD. Do not invent citations, links or statistics.'
  );
}
export async function teamLive(app, user, T, a) {
  const prompt = teamPrompt(app, user, T, a);
  try {
    return await callModel(app, T, a.id, prompt, 1, T);
  } catch (e) {
    if (e instanceof Stopped || e.fatal) throw e;
    return callModel(
      app,
      T,
      a.id,
      prompt + '\n\nYour last answer was not usable: ' + e.message + '. Reply with the JSON object only.',
      2,
      T,
    );
  }
}
export function teamWait(app, T) {
  // human in the loop: the run pauses so the person can jump in
  T.wait = {
    text: app.def.team.pause.text,
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
export function teamJump(app, user, text) {
  // the person adds a row of their own to the run
  const T = TEAMS[app.id],
    j = app.def.team.jump,
    t = tableOf(app.def, j.table);
  if (!T || !str(text)) return false;
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
export function stopTeam(app) {
  const T = TEAMS[app.id];
  if (!T || T.status !== 'running') return;
  T.stop = true;
  if (T.abort) T.abort();
  if (T.ctrl) {
    try {
      T.ctrl.abort();
    } catch (e) {}
  }
}
export async function runTeam(app, user, rowId, script) {
  // script: a saved run (Demo). Without one, every agent makes its own model call (Live).
  const def = app.def,
    team = def.team,
    it = tableOf(def, team.input.table),
    api = (m, p) => apiCall(app, user, m, p, {}, 'team');
  const T = (TEAMS[app.id] = {
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
  const ev = (type, d) =>
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
    fill = (v) => (typeof v === 'string' ? v.replace('{{jump}}', T.notes.length ? T.notes[T.notes.length - 1].text : '') : v);
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
    for (let i = 0; i < team.agents.length; i++) {
      const a = team.agents[i],
        st = T.steps[i];
      let out;
      if (team.pause && team.pause.before === a.id) await teamWait(app, T);
      T.i = i;
      st.status = 'working';
      st.t0 = Date.now();
      notify();
      ev('STEP_STARTED', {
        stepName: a.id,
        agent: a.id,
      });
      if (script) {
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
        out =
          T.notes.length && sc.jumped
            ? Object.assign({}, sc, {
                say: str(sc.say) + ' ' + str(sc.jumped.say),
                rows: arr(sc.rows).concat(
                  arr(sc.jumped.rows).map((r) => {
                    const o = {};
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
      } else out = await teamLive(app, user, T, a);
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
      const did = {
          rows: [],
          updated: 0,
          problems: [],
        },
        part = (o) => {
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
      await tpace(T, 450);
    }
    if (team.done) {
      const r = api('POST', '/api/' + it.name + '/' + rowId + '/' + team.done);
      if (r.status !== 200) throw new Error('The run could not be closed. ' + r.status + ' ' + r.error);
    }
    T.status = 'done';
    toast(team.title + ' finished.', 'success');
  } catch (e) {
    const stopped = e instanceof TeamStop || e instanceof Stopped;
    T.status = stopped ? 'stopped' : 'failed';
    T.error = stopped ? '' : String((e && e.message) || e);
    T.wait = null;
    T.steps.forEach((s) => {
      if (s.status === 'working') s.status = stopped ? 'idle' : 'failed';
    });
    if (!stopped) {
      if (!e.fatal) console.warn(e);
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
export function teamBlock(app, user, text) {
  // why a run cannot start right now, or null
  const team = app.def.team,
    T = TEAMS[app.id],
    mode = modeNow(),
    needs = teamNeeds(team),
    off = needs.filter((id) => !connOn(id)),
    names = (ids) =>
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
export function TeamAv({ a, size }) {
  return (
    <span className={cx('av sq', size && 'av-' + size, 'acc-' + a.acc)} title={a.name + ' agent'}>
      <Icon n={a.icon} s={size === 'lg' ? '24' : '16'} />
    </span>
  );
}
