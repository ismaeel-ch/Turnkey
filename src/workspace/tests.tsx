// @ts-nocheck -- converted from the prototype; types are added module by module
import { render } from '@/platform/dom';
import { S, U, ago, arr, commit, cx, emit, fmtMs, label, notify, sleep, str, toast, toolCall } from './core';
import { dbRollback, dbSavepoint, qi, ql, sqlRun } from './db';
import {
  VIEW_LABEL,
  accOf,
  apiCall,
  appUsers,
  checkBrief,
  colOf,
  deriveEndpoints,
  roleName,
  tableOf,
  testMatrix,
  tourExec,
  tourValues,
} from './engine';
import { mayOpen, viewFit, viewsOf } from './viewspec';
import { REC } from './builds';
import { TEAMS, canRunTeam, checkTeam, teamApply } from './team';
import { RUNS, SPEED, STATIONS } from './line';
import { CASE_EXPECT } from './tester';
import { AgentAv, Btn, Card, Empty, Icon, Input, Seg, Spinner } from './ui';
import { AppPane, newPane, stateLabel } from './runtime';
import { Explorer } from './views-a';
import { Dash } from './views-b';

/* ===== Turnkey prototype · the generated test suite =====
   Every app gets a suite of tests, generated from what the agents wrote: each table, link, access rule,
   workflow action, view, page, tour step and saved agent run becomes a test. Tests run against the real
   SQLite file and the real endpoints. Anything that writes runs inside a savepoint and is rolled back. */
export const TESTS = {}; // app id -> { rev, at, ms, res: { test id: { ok, actual } }, running }
export const SUITE_META = [
  {
    id: 'brief',
    name: 'Brief',
    station: 'research',
    icon: 'clipboard',
    about: 'The brief is complete enough to build from.',
  },
  {
    id: 'database',
    name: 'Database',
    station: 'database',
    icon: 'database',
    about: 'Tables, columns, links and rows in the SQLite file match the definition.',
  },
  {
    id: 'permissions',
    name: 'Permissions',
    station: 'backend',
    icon: 'shield',
    about: 'Every endpoint is called as every role. Each call must be allowed or refused exactly as the rules say.',
  },
  {
    id: 'workflow',
    name: 'Workflow',
    station: 'backend',
    icon: 'flow',
    about: 'Every workflow action moves a real record for a role that may take it, and is refused for one that may not.',
  },
  {
    id: 'agents',
    name: 'App agents',
    station: 'backend',
    icon: 'bot',
    about: "The app's own agents can write their work through the endpoints, and every saved run replays cleanly.",
  },
  {
    id: 'views',
    name: 'Views and dashboard',
    station: 'views',
    icon: 'pie',
    about: 'Every recommended view is drawn with the real rows, and the dashboard is drawn for every role.',
  },
  {
    id: 'pages',
    name: 'Pages',
    station: 'screens',
    icon: 'layout',
    about: 'Every page opens for every role that has it, and no role has a page it may not use.',
  },
  {
    id: 'acceptance',
    name: 'Acceptance',
    station: 'walkthrough',
    icon: 'beaker',
    about: 'The guided tour, played step by step as the named people.',
  },
  {
    id: 'scenarios',
    name: 'Test cases',
    station: 'tester',
    icon: 'clipboard',
    about:
      'Written by the Tester agent from the rules and user stories of the brief. Each case is played through the real endpoints as the named people.',
  },
];
export const tOk = (ok, actual) => ({
  ok: !!ok,
  actual: actual == null ? '' : String(actual),
});
export function mountCheck(vnode, sel) {
  // draw something off-screen with the real data and say whether it appeared
  const host = document.createElement('div');
  let out;
  try {
    render(vnode, host);
    const n = host.querySelectorAll(sel).length;
    out = tOk(n > 0, n > 0 ? 'drawn' : 'nothing was drawn');
  } catch (e) {
    out = tOk(false, String((e && e.message) || e));
  }
  try {
    render(null, host);
  } catch (e) {}
  return out;
}
export const SUITES = {}; // built once per revision of an app
export function suiteOf(app) {
  const c = SUITES[app.id];
  if (c && c.app === app && c.def === app.def && c.rev === app.rev) return c.suites;
  const suites = buildSuites(app);
  SUITES[app.id] = {
    app,
    def: app.def,
    rev: app.rev,
    suites,
  };
  return suites;
}
export function buildSuites(app) {
  // the tests, as { id, name, expect } per suite, with one exec() per suite that returns every result
  const def = app.def,
    users = appUsers(app),
    P = def.process,
    roles = def.brief.roles,
    userOf = (rid) => users.find((u) => u.role === rid),
    out = [],
    sql = (text, params) => sqlRun(app.id, text, params || null, 'check');
  const add = (id, tests, exec) => {
    if (tests.length)
      out.push(
        Object.assign(
          {},
          SUITE_META.find((s) => s.id === id),
          {
            tests,
            exec,
          },
        ),
      );
  };
  // brief
  const bc = checkBrief(def.brief);
  add(
    'brief',
    bc.map((c, i) => ({
      id: 'brief:' + i,
      name: c.label,
      expect: 'holds',
    })),
    () => {
      const r = {};
      checkBrief(def.brief).forEach((c, i) => {
        r['brief:' + i] = tOk(c.ok, c.detail);
      });
      return r;
    },
  );
  // database
  const dbT = [],
    dbF = {};
  def.tables.forEach((t) => {
    dbT.push({
      id: 'db:cols:' + t.name,
      name: 'Table ' + t.name + ' has its ' + (t.columns.length + 3) + ' columns',
      expect: 'every defined column exists',
    });
    dbF['db:cols:' + t.name] = () => {
      const have = sql('PRAGMA table_info(' + qi(t.name) + ')').map((r) => r.name),
        miss = t.columns
          .map((c) => c.name)
          .concat(['id', 'created_by', 'created_at'])
          .filter((n) => !have.includes(n));
      return tOk(!miss.length, miss.length ? 'missing: ' + miss.join(', ') : have.length + ' columns');
    };
    t.columns
      .filter((c) => c.type === 'ref' || c.type === 'user')
      .forEach((c) => {
        const target = c.type === 'ref' ? c.ref : 'users',
          id = 'db:link:' + t.name + '.' + c.name;
        dbT.push({
          id,
          name: t.name + '.' + c.name + ' links to ' + target,
          expect: 'a foreign key to ' + target,
        });
        dbF[id] = () => {
          const fk = sql('PRAGMA foreign_key_list(' + qi(t.name) + ')').find((r) => r.from === c.name);
          return tOk(fk && fk.table === target, fk ? 'foreign key to ' + fk.table : 'no foreign key');
        };
      });
    const req = t.columns.filter((c) => c.required && !(P && P.table === t.name && P.column === c.name));
    if (req.length) {
      const id = 'db:req:' + t.name;
      dbT.push({
        id,
        name: 'No ' + t.one.toLowerCase() + ' is missing a required value',
        expect: '0 rows with an empty ' + req.map((c) => c.name).join(', '),
      });
      dbF[id] = () => {
        const n = sql(
          'SELECT COUNT(*) AS n FROM ' +
            qi(t.name) +
            ' WHERE ' +
            req.map((c) => qi(c.name) + ' IS NULL OR ' + qi(c.name) + " = ''").join(' OR '),
        )[0].n;
        return tOk(n === 0, n ? n + (n === 1 ? ' row has' : ' rows have') + ' an empty ' + req.map((c) => c.name).join(' or ') : 'none');
      };
    }
  });
  if (P) {
    const id = 'db:states';
    dbT.push({
      id,
      name: 'Every ' + tableOf(def, P.table).one.toLowerCase() + ' has a status the workflow knows',
      expect: 'only ' + P.states.map((s) => s.id).join(', '),
    });
    dbF[id] = () => {
      const n = sql(
        'SELECT COUNT(*) AS n FROM ' +
          qi(P.table) +
          ' WHERE ' +
          qi(P.column) +
          ' NOT IN (' +
          P.states.map((s) => ql(s.id)).join(', ') +
          ')',
      )[0].n;
      return tOk(n === 0, n + ' rows with an unknown status');
    };
  }
  dbT.push({
    id: 'db:fk',
    name: 'No row points at a record that does not exist',
    expect: 'foreign_key_check finds nothing',
  });
  dbF['db:fk'] = () => {
    const r = sql('PRAGMA foreign_key_check');
    return tOk(!r.length, r.length ? r.length + ' broken links, first in ' + r[0].table : 'no broken links');
  };
  dbT.push({
    id: 'db:integrity',
    name: 'The SQLite file passes its integrity check',
    expect: 'ok',
  });
  dbF['db:integrity'] = () => {
    const r = sql('PRAGMA integrity_check'),
      v = r[0] ? String(Object.values(r[0])[0]) : 'ok';
    return tOk(v === 'ok', v);
  };
  dbT.push({
    id: 'db:users',
    name: 'Every role has someone who can sign in',
    expect: roles.length + ' roles covered',
  });
  dbF['db:users'] = () => {
    const miss = roles.filter((r) => !sql('SELECT 1 AS ok FROM "users" WHERE role = ? LIMIT 1', [r.id]).length).map((r) => r.name);
    return tOk(!miss.length, miss.length ? 'nobody is a ' + miss.join(', ') : sql('SELECT COUNT(*) AS n FROM "users"')[0].n + ' people');
  };
  add('database', dbT, () => {
    const r = {};
    dbT.forEach((x) => {
      try {
        r[x.id] = dbF[x.id]();
      } catch (e) {
        r[x.id] = tOk(false, String((e && e.message) || e));
      }
    });
    return r;
  });
  if (!P) return out;
  // permissions: every endpoint as every role
  const eps = deriveEndpoints(def).filter((e) => !e.sys),
    permT = [];
  eps.forEach((ep) =>
    roles.forEach((role) => {
      if (userOf(role.id))
        permT.push({
          id: 'perm:' + ep.id + '|' + role.id,
          name: role.name + ' · ' + ep.method + ' ' + ep.path,
          expect: ep.roles[role.id] ? (ep.roles[role.id] === 'own' ? 'allowed, own rows only' : 'allowed') : 'refused with 403',
        });
    }),
  );
  const ownT = [];
  def.tables.forEach((t) =>
    roles.forEach((role) => {
      if (accOf(def, role.id, t.name).list === 'own' && userOf(role.id))
        ownT.push({
          id: 'own:' + t.name + '|' + role.id,
          name: role.name + ' lists only their own ' + t.label.toLowerCase(),
          expect: 'every row belongs to the signed-in person',
          t,
          role,
        });
    }),
  );
  add(
    'permissions',
    permT.concat(
      ownT.map((x) => ({
        id: x.id,
        name: x.name,
        expect: x.expect,
      })),
    ),
    () => {
      const r = {};
      testMatrix(app).forEach((m) => {
        r['perm:' + m.ep + '|' + m.role] = tOk(
          m.ok,
          m.status +
            (m.status === 403
              ? ' Forbidden'
              : m.status === 200 || m.status === 201
                ? ' OK'
                : m.status === 404
                  ? ' (allowed, no such record)'
                  : m.status === 400
                    ? ' (allowed, empty body refused)'
                    : m.status === 409
                      ? ' (allowed, wrong state for this record)'
                      : ''),
        );
      });
      ownT.forEach((x) => {
        const u = userOf(x.role.id),
          res = apiCall(app, u, 'GET', '/api/' + x.t.name, {}, 'check'),
          leak = res.status === 200 ? res.data.filter((row) => row[x.t.owner || 'created_by'] !== u.id).length : -1;
        r[x.id] = tOk(
          leak === 0,
          leak < 0
            ? res.status + ' ' + res.error
            : leak
              ? leak + ' rows belong to someone else'
              : res.data.length + ' rows, all ' + u.name + "'s",
        );
      });
      return r;
    },
  );
  // workflow: each action really moves a record, and is refused for a role that may not take it
  const pt = tableOf(def, P.table),
    own = pt.owner || 'created_by',
    wfT = [
      {
        id: 'wf:reach',
        name: 'Every status can be reached from ' + stateLabel(def, pt, colOf(pt, P.column), P.initial),
        expect: P.states.length + ' statuses reachable',
      },
    ];
  P.transitions.forEach((x) => {
    const yes = roles.find((r) => x.roles.includes(r.id) && userOf(r.id)),
      no = roles.find((r) => !x.roles.includes(r.id) && userOf(r.id));
    if (yes)
      wfT.push({
        id: 'wf:do:' + x.id,
        name: '"' + x.label + '" moves a ' + pt.one.toLowerCase() + ' to ' + label(x.to).toLowerCase() + ' for ' + yes.name,
        expect: '200, status becomes ' + x.to,
        x,
        role: yes,
        allow: true,
      });
    if (no)
      wfT.push({
        id: 'wf:no:' + x.id,
        name: '"' + x.label + '" is refused for ' + no.name,
        expect: '403',
        x,
        role: no,
        allow: false,
      });
  });
  add(
    'workflow',
    wfT.map((x) => ({
      id: x.id,
      name: x.name,
      expect: x.expect,
    })),
    () => {
      const r = {},
        seen = new Set([P.initial]);
      let grew = true;
      while (grew) {
        grew = false;
        P.transitions.forEach((x) => {
          if (x.from.some((f) => seen.has(f)) && !seen.has(x.to)) {
            seen.add(x.to);
            grew = true;
          }
        });
      }
      const lost = P.states.filter((s) => !seen.has(s.id)).map((s) => s.label);
      r['wf:reach'] = tOk(!lost.length, lost.length ? 'no path to ' + lost.join(', ') : 'all reachable');
      wfT.slice(1).forEach((c) => {
        dbSavepoint(app.id, 'wf');
        try {
          const u = userOf(c.role.id),
            row = sql('SELECT "id" FROM ' + qi(pt.name) + ' ORDER BY "id" LIMIT 1')[0];
          if (!row) {
            r[c.id] = tOk(true, 'no ' + pt.label.toLowerCase() + ' to try it on');
            return;
          }
          sql('UPDATE ' + qi(pt.name) + ' SET ' + qi(P.column) + ' = ?, ' + qi(own) + ' = ? WHERE "id" = ?', [c.x.from[0], u.id, row.id]); // put one record in the right state, owned by this person, inside the savepoint
          const res = apiCall(app, u, 'POST', '/api/' + pt.name + '/' + row.id + '/' + c.x.id, {}, 'check');
          r[c.id] = c.allow
            ? tOk(
                res.status === 200 && res.data[P.column] === c.x.to,
                res.status === 200 ? 'now ' + res.data[P.column] : res.status + ' ' + res.error,
              )
            : tOk(res.status === 403, res.status + (res.status === 403 ? ' Forbidden' : ' but should be refused'));
        } catch (e) {
          r[c.id] = tOk(false, String((e && e.message) || e));
        } finally {
          dbRollback(app.id, 'wf');
        }
      });
      return r;
    },
  );
  // the app's own agents
  if (def.team) {
    const cases = (REC[app.tpl] && REC[app.tpl].cases) || [],
      runner = users.find((u) => canRunTeam(def, u.role)),
      it = tableOf(def, def.team.input.table);
    add(
      'agents',
      [
        {
          id: 'team:role',
          name: 'A role may start a run and write everything the agents write',
          expect: 'at least one role',
        },
      ].concat(
        cases.map((c, i) => ({
          id: 'team:case:' + i,
          name: 'Saved run "' + c.label + '" replays through the endpoints',
          expect: 'every row is accepted and the ' + it.one.toLowerCase() + ' is closed',
        })),
      ),
      () => {
        const r = {},
          ck = checkTeam(def, def.team);
        r['team:role'] = tOk(ck.ok, ck.detail);
        cases.forEach((c, i) => {
          dbSavepoint(app.id, 'tm');
          try {
            const made = apiCall(app, runner, 'POST', '/api/' + it.name, tourValues(app, it, c.values), 'check');
            if (made.status !== 201) {
              r['team:case:' + i] = tOk(false, made.status + ' ' + made.error);
              return;
            }
            const T = {
                table: it.name,
                row: made.data.id,
                made: {},
                notes: [],
              },
              st = apiCall(app, runner, 'POST', '/api/' + it.name + '/' + T.row + '/' + def.team.start, {}, 'check'),
              bad = [];
            let wrote = 0;
            def.team.agents.forEach((a) => {
              const did = teamApply(app, runner, T, a, c.script.find((x) => x.agent === a.id) || {});
              wrote += did.rows.length + did.updated;
              did.problems.forEach((p) => bad.push(a.name + ': ' + p));
            });
            const end = apiCall(app, runner, 'POST', '/api/' + it.name + '/' + T.row + '/' + def.team.done, {}, 'check');
            r['team:case:' + i] = tOk(
              st.status === 200 && end.status === 200 && !bad.length,
              bad.length ? bad[0] : end.status !== 200 ? end.status + ' ' + end.error : wrote + ' writes, closed as ' + end.data[P.column],
            );
          } catch (e) {
            r['team:case:' + i] = tOk(false, String((e && e.message) || e));
          } finally {
            dbRollback(app.id, 'tm');
          }
        });
        return r;
      },
    );
  }
  // views and dashboard
  const vT = [];
  def.tables.forEach((t) =>
    viewsOf(def, t).forEach((v) =>
      vT.push({
        id: 'view:' + t.name + ':' + v.type,
        name: t.label + ' opens as ' + VIEW_LABEL[v.type].toLowerCase(),
        expect: 'fits the columns and draws',
        t,
        v,
      }),
    ),
  );
  const dT = roles
    .filter((r) => userOf(r.id))
    .map((r) => ({
      id: 'dash:' + r.id,
      name: 'The dashboard draws for ' + r.name,
      expect: 'numbers and charts from the rows this role may see',
      role: r,
    }));
  add(
    'views',
    vT.concat(dT).map((x) => ({
      id: x.id,
      name: x.name,
      expect: x.expect,
    })),
    () => {
      const r = {};
      vT.forEach((x) => {
        const why = viewFit(def, x.t, x.v.type),
          u = users.find((p) => accOf(def, p.role, x.t.name).list !== 'none');
        if (why) {
          r[x.id] = tOk(false, 'does not fit: ' + why);
          return;
        }
        if (!u) {
          r[x.id] = tOk(true, 'no role reads this table');
          return;
        }
        r[x.id] = mountCheck(
          <div className="app">
            <Explorer
              app={app}
              user={u}
              pane={newPane(9)}
              scr={{
                id: 'vt_' + x.t.name,
                name: x.t.label,
                type: x.v.type,
                table: x.t.name,
                roles: [u.role],
                columns: x.t.columns.slice(0, 6).map((c) => c.name),
              }}
              test
            />
          </div>,
          '.vx-body',
        );
      });
      dT.forEach((x) => {
        r[x.id] = mountCheck(
          <div className="app">
            <Dash
              app={app}
              user={userOf(x.role.id)}
              pane={newPane(9)}
              scr={{
                id: 'vt_dash',
                name: 'Dashboard',
                type: 'dashboard',
              }}
              test
            />
          </div>,
          '.dash',
        );
      });
      return r;
    },
  );
  // pages
  const pT = [];
  def.screens.forEach((s) =>
    s.roles.forEach((rid) => {
      if (userOf(rid))
        pT.push({
          id: 'page:' + s.id + '|' + rid,
          name: roleName(def, rid) + ' can open "' + s.name + '"',
          expect: 'the page draws',
          s,
          rid,
        });
    }),
  );
  const lT = roles.map((r) => ({
    id: 'leak:' + r.id,
    name: r.name + ' has no page it may not use',
    expect: 'every page is allowed by the access rules',
    role: r,
  }));
  add(
    'pages',
    pT.concat(lT).map((x) => ({
      id: x.id,
      name: x.name,
      expect: x.expect,
    })),
    () => {
      const r = {};
      pT.forEach((x) => {
        r[x.id] = mountCheck(
          <AppPane
            app={app}
            pane={{
              uid: userOf(x.rid).id,
              screen: x.s.id,
              test: true,
            }}
          />,
          '.app-main > *',
        );
      });
      lT.forEach((x) => {
        const bad = def.screens
          .filter((s) => s.roles.includes(x.role.id) && tableOf(def, s.table) && !mayOpen(def, x.role.id, s.type, s.table))
          .map((s) => s.name);
        r[x.id] = tOk(
          !bad.length,
          bad.length ? 'not allowed: ' + bad.join(', ') : def.screens.filter((s) => s.roles.includes(x.role.id)).length + ' pages',
        );
      });
      return r;
    },
  );
  // acceptance: the tour, in order, inside one savepoint
  add(
    'acceptance',
    def.tour.map((s, i) => ({
      id: 'acc:' + i,
      name: i + 1 + '. ' + (s.say || s.do + ' ' + s.table),
      expect:
        s.do === 'denied'
          ? 'refused with 403'
          : s.do === 'see'
            ? 'the record is in the list'
            : s.do === 'create'
              ? '201 Created'
              : s.do === 'transition'
                ? '200 OK'
                : 'the page opens',
    })),
    () => {
      const r = {},
        st = {
          rows: {},
          last: null,
        };
      dbSavepoint(app.id, 'acc');
      try {
        def.tour.forEach((s, i) => {
          const x = tourExec(app, st, s);
          r['acc:' + i] = tOk(x.ok, x.detail);
        });
      } finally {
        dbRollback(app.id, 'acc');
      }
      return r;
    },
  );
  // test cases: what the Tester agent wrote, each in its own savepoint
  const cs = arr(def.cases);
  add(
    'scenarios',
    cs.map((c) => ({
      id: 'case:' + c.id,
      name: c.name,
      expect: c.steps.map((s) => CASE_EXPECT[s.do]).join(', then '),
    })),
    () => {
      const r = {};
      cs.forEach((c) => {
        const st = {
          rows: {},
          last: null,
        };
        let bad = '';
        dbSavepoint(app.id, 'tcase');
        try {
          c.steps.every((s, k) => {
            const x = tourExec(app, st, s);
            if (!x.ok) bad = 'step ' + (k + 1) + ': ' + x.detail;
            return x.ok;
          });
        } catch (e) {
          bad = String((e && e.message) || e);
        } finally {
          dbRollback(app.id, 'tcase');
        }
        r['case:' + c.id] = tOk(!bad, bad || c.steps.length + (c.steps.length === 1 ? ' step' : ' steps') + ' passed');
      });
      return r;
    },
  );
  return out;
}
export const testable = (app) => app.status === 'ready' && !!app.def.brief && !!app.def.process;
export function testStats(app) {
  // counts for badges: what the last run found, or what there is to run
  const R = TESTS[app.id],
    fresh = R && R.rev === app.rev,
    S0 = app.tests || null;
  if (fresh) {
    const v = Object.values(R.res);
    return {
      total: v.length,
      passed: v.filter((x) => x.ok).length,
      failed: v.filter((x) => !x.ok).length,
      at: R.at,
      fresh: true,
    };
  }
  return S0
    ? {
        total: S0.total,
        passed: S0.passed,
        failed: S0.failed,
        at: S0.at,
        fresh: S0.rev === app.rev,
      }
    : null;
}
export function runTestsSync(app, only) {
  // run every suite (or one station's suites) now; returns the summary
  if (!testable(app)) return null;
  const t0 = performance.now(),
    suites = suiteOf(app),
    R =
      TESTS[app.id] && TESTS[app.id].rev === app.rev
        ? TESTS[app.id]
        : (TESTS[app.id] = {
            rev: app.rev,
            res: {},
            ms: 0,
            at: 0,
          });
  const r = toolCall(
    {
      agent: 'orchestrator',
      appId: app.id,
    },
    'run_tests',
    {
      suites: suites.filter((s) => !only || only(s)).map((s) => s.id),
    },
    () => {
      suites.forEach((s) => {
        if (only && !only(s)) return;
        let got;
        try {
          got = s.exec();
        } catch (e) {
          got = {};
          s.tests.forEach((x) => {
            got[x.id] = tOk(false, String((e && e.message) || e));
          });
        }
        Object.assign(R.res, got);
      });
      const v = Object.values(R.res);
      return {
        ran: v.length,
        passed: v.filter((x) => x.ok).length,
        failed: v.filter((x) => !x.ok).length,
      };
    },
  );
  R.at = Date.now();
  R.ms = performance.now() - t0;
  const all = suites.reduce((n, s) => n + s.tests.length, 0),
    v = Object.values(R.res);
  app.tests = {
    rev: app.rev,
    at: R.at,
    total: all,
    passed: v.filter((x) => x.ok).length,
    failed: v.filter((x) => !x.ok).length,
    notRun: all - v.length,
  };
  return Object.assign(
    {
      ok: r.ok,
    },
    app.tests,
  );
}
export async function runTests(app, only) {
  // the same, suite by suite, so the screen can show progress
  if (!testable(app) || RUNS[app.id] || (TESTS[app.id] && TESTS[app.id].running)) return;
  if (TEAMS[app.id] && TEAMS[app.id].status === 'running')
    return void toast("The app's own agents are in the middle of a run. Run the tests when they have finished.", 'warning');
  const suites = suiteOf(app).filter((s) => !only || only(s)),
    R =
      TESTS[app.id] && TESTS[app.id].rev === app.rev
        ? TESTS[app.id]
        : (TESTS[app.id] = {
            rev: app.rev,
            res: {},
            ms: 0,
            at: 0,
          }),
    t0 = performance.now(),
    wait = 260 * (SPEED[S.settings.speed] || 1);
  emit('RUN_STARTED', {
    runId: 'tests',
    threadId: app.id,
    app: app.id,
    kind: 'tests',
  });
  try {
    for (const s of suites) {
      R.running = s.id;
      s.tests.forEach((x) => {
        delete R.res[x.id];
      });
      notify();
      await sleep(wait);
      emit('STEP_STARTED', {
        stepName: 'tests:' + s.id,
        app: app.id,
      });
      runTestsSync(app, (x) => x.id === s.id);
      emit('STEP_FINISHED', {
        stepName: 'tests:' + s.id,
        app: app.id,
      });
      notify();
    }
  } finally {
    R.running = null;
    R.ms = performance.now() - t0;
    emit('RUN_FINISHED', {
      runId: 'tests',
      threadId: app.id,
      app: app.id,
      status: 'ok',
    });
    commit();
  }
  const st = testStats(app);
  if (st)
    toast(
      st.failed
        ? st.failed + ' of ' + st.total + ' tests failed'
        : (only ? suites.reduce((n, s) => n + s.tests.length, 0) : st.total) + ' tests passed',
      st.failed ? 'warning' : 'success',
    );
}
export function TestRows({ app, suite, only, q }) {
  const R = TESTS[app.id] || {},
    res = R.rev === app.rev ? R.res || {} : {},
    busy = R.running === suite.id;
  const rows = suite.tests.filter((x) => (!only || (res[x.id] && !res[x.id].ok)) && (!q || x.name.toLowerCase().indexOf(q) >= 0));
  if (!rows.length) return null;
  return (
    <ul className="tests" tabIndex={0} aria-label={suite.name + ' tests'}>
      {rows.map((x) => {
        const r = res[x.id];
        return (
          <li key={x.id} className={cx('test', r ? (r.ok ? 'ok' : 'bad') : 'idle')}>
            {busy && !r ? <Spinner /> : <Icon n={r ? (r.ok ? 'checkCircle' : 'errorCircle') : 'circle'} s="16" />}
            <span className="test-n">{x.name}</span>
            <span className="test-x t-cap">{r ? r.actual || x.expect : 'expects: ' + x.expect}</span>
          </li>
        );
      })}
    </ul>
  );
}
export function TestsView({ app }) {
  if (!testable(app))
    return (
      <div className="tests-view">
        <Empty
          icon="beaker"
          title="No tests yet"
          text="When the app is built, a test suite is generated from its definition and appears here."
        />
      </div>
    );
  const suites = suiteOf(app),
    R = TESTS[app.id] || {},
    fresh = R.rev === app.rev,
    res = fresh ? R.res || {} : {},
    tv =
      U.tv[app.id] ||
      (U.tv[app.id] = {
        only: false,
        q: '',
        shut: {},
      }),
    total = suites.reduce((n, s) => n + s.tests.length, 0);
  const done = Object.values(res),
    passed = done.filter((x) => x.ok).length,
    failed = done.length - passed,
    busy = !!R.running || !!RUNS[app.id],
    q = str(tv.q).toLowerCase();
  return (
    <div className="tests-view scroll" data-tour="tests">
      <div className="tests-head">
        <div className="col gap0 grow">
          <h2 className="t-sub1">Tests</h2>
          <span className="t-cap muted">
            Generated from this app's definition. Every table, link, access rule, workflow action, view, page and tour step is a test. They
            run against the real database and endpoints, and anything they write is rolled back.
          </span>
        </div>
        <Btn className="btn primary" disabled={busy} onClick={() => runTests(app)}>
          <Icon n="play" s="16" />
          {R.running ? 'Running' : 'Run all ' + total + ' tests'}
        </Btn>
      </div>
      <div className="kpis tk">
        <div className="kpi">
          <span className="kpi-l">Tests</span>
          <span className="kpi-v">{total}</span>
          <span className="kpi-s">
            {'in '}
            {suites.length}
            {' suites'}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Passed</span>
          <span className="kpi-v ok">{passed}</span>
          <span className="kpi-s">{done.length ? Math.round((passed / done.length) * 100) + '% of those run' : 'not run yet'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Failed</span>
          <span className={cx('kpi-v', failed && 'bad')}>{failed}</span>
          <span className="kpi-s">{failed ? 'open the suite to see why' : 'none'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Last run</span>
          <span className="kpi-v sm">{fresh && R.at ? ago(R.at) : 'Not since the last change'}</span>
          <span className="kpi-s">{fresh && R.at ? 'took ' + fmtMs(R.ms) : 'run them again'}</span>
        </div>
      </div>
      <div className="row wrap">
        <Seg
          label="Which tests to show"
          items={[
            {
              id: 'all',
              label: 'All',
            },
            {
              id: 'failed',
              label: 'Failed' + (failed ? ' · ' + failed : ''),
            },
          ]}
          value={tv.only ? 'failed' : 'all'}
          onChange={(v) => {
            tv.only = v === 'failed';
            notify();
          }}
        />
        <div className="search">
          <Icon n="search" s="16" />
          <Input
            native
            className="input"
            id={'tq' + app.id}
            aria-label="Search tests"
            placeholder="Search tests"
            value={tv.q}
            onInput={(e) => {
              tv.q = e.target.value;
              notify();
            }}
          />
        </div>
      </div>
      {suites.map((s) => {
        const got = s.tests.map((x) => res[x.id]).filter(Boolean),
          ok = got.filter((x) => x.ok).length,
          bad = got.length - ok,
          shut = tv.shut[s.id] != null ? tv.shut[s.id] : !(bad || q || tv.only) && s.tests.length > 14;
        if (tv.only && !bad) return null;
        return (
          <Card key={s.id} className={cx('card suite', bad && 'has-bad')}>
            <header className="suite-h">
              <button
                className="suite-t"
                aria-expanded={!shut}
                onClick={() => {
                  tv.shut[s.id] = !shut;
                  notify();
                }}
              >
                <Icon n={shut ? 'chevRight' : 'chevDown'} s="16" />
                <AgentAv id={(STATIONS.find((x) => x.id === s.station) || {}).agent} size="sm" />
                <span className="col gap0">
                  <strong>{s.name}</strong>
                  <span className="t-cap muted">{s.about}</span>
                </span>
              </button>
              <span className={cx('badge', bad ? 'b-danger' : got.length === s.tests.length ? 'b-success' : 'b-neutral')}>
                {R.running === s.id ? <Spinner /> : null}
                {got.length ? ok + ' of ' + s.tests.length : s.tests.length + ' tests'}
              </span>
              <Btn className="btn sm" disabled={busy} onClick={() => runTests(app, (x) => x.id === s.id)}>
                <Icon n="play" s="16" />
                <span className="hide-sm">Run</span>
              </Btn>
            </header>
            {!shut && <TestRows app={app} suite={s} only={tv.only} q={q} />}
          </Card>
        );
      })}
    </div>
  );
}
export function StationTests({ app, st }) {
  // the same tests, in the inspector of the station they belong to
  if (!testable(app)) return <p className="muted">Tests appear here when the app is built.</p>;
  const suites = suiteOf(app).filter((s) => s.station === st.id),
    R = TESTS[app.id] || {},
    busy = !!R.running || !!RUNS[app.id];
  if (!suites.length) return <p className="muted">This station has no tests of its own.</p>;
  return (
    <div className="col gap12">
      <div className="row between wrap">
        <span className="muted t-cap">
          {suites.reduce((n, s) => n + s.tests.length, 0)}
          {' tests generated from what this station wrote. They run against the real database and endpoints.'}
        </span>
        <div className="row">
          <Btn className="btn sm" disabled={busy} onClick={() => runTests(app, (x) => x.station === st.id)}>
            <Icon n="play" s="16" />
            Run these tests
          </Btn>
          <Btn
            className="btn subtle sm"
            onClick={() => {
              U.view[app.id] = 'tests';
              notify();
            }}
          >
            All tests
          </Btn>
        </div>
      </div>
      {suites.map((s) => (
        <div key={s.id}>
          <h4>{s.name}</h4>
          <TestRows app={app} suite={s} />
        </div>
      ))}
    </div>
  );
}
