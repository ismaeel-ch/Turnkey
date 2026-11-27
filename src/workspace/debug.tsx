// The debug drawer (Settings > debug mode): events, tool calls, model calls, SQL and API logs. It loads the first
// time debug mode is on, so the page does not carry it for everyone.
import { type ReactNode } from 'react';
import { fmtUsd, promptTokens, usageLine } from '@/platform/agui/usage';
import type { AppRecord, DebugPanel, Dict } from '@/shared/types/workspace';
import {
  APILOG,
  BRAND,
  CAP,
  EV,
  LS,
  MODELCALLS,
  S,
  SQLLOG,
  TOOLCALLS,
  U,
  brief,
  cap,
  commit,
  cx,
  fmtBytes,
  fmtClock,
  fmtMs,
  fmtNum,
  notify,
  online,
  str,
} from './core';
import { backupWorkspace, restoreWorkspace } from './db';
import { TeamAv, teamAgentOf } from './team';
import { AGENTS, STATIONS } from './line';
import { flowOf } from './custom';
import { AgentAv, Btn, Icon, Input, Json, Tabs } from './ui';
import { storageText } from './shell-b';

/* ---------- debug drawer: what a developer wants to see ---------- */
/** Change the debug drawer's tab, filter or size. */
function setDbg(patch: Partial<DebugPanel>) {
  U.dbg = { ...U.dbg, ...patch };
  notify();
}
export function DebugDrawer({ app }: { app: AppRecord | null }) {
  const D = U.dbg,
    q = D.q.toLowerCase(),
    scope = app && !D.all ? app.id : null,
    appOf = (x: object) => (x as { app?: unknown }).app,
    pick = <T extends object>(list: T[], text: (x: T) => string) =>
      list
        .filter((x) => (!scope || !appOf(x) || appOf(x) === scope) && (!q || text(x).toLowerCase().indexOf(q) >= 0))
        .slice(-160)
        .reverse();
  const run = app ? app.runs[app.runs.length - 1] : null,
    mine = <T extends object>(list: T[]) => list.filter((x) => !scope || appOf(x) === scope);
  const mc = mine(MODELCALLS),
    live = mc.filter((x) => x.mode === 'live'),
    tabs = [
      {
        id: 'events',
        label: 'AG-UI events',
        count: mine(EV).length,
      },
      {
        id: 'tools',
        label: 'Tool calls',
        count: mine(TOOLCALLS).length,
      },
      {
        id: 'model',
        label: 'Model',
        count: mc.length,
      },
      {
        id: 'sql',
        label: 'SQL',
        count: mine(SQLLOG).length,
      },
      {
        id: 'api',
        label: 'API',
        count: mine(APILOG).length,
      },
      {
        id: 'state',
        label: 'State',
      },
      {
        id: 'storage',
        label: 'Storage',
      },
    ];
  const fam = (t: string) =>
    /^RUN/.test(t)
      ? 'run'
      : /^STEP/.test(t)
        ? 'step'
        : /^TOOL/.test(t)
          ? 'tool'
          : /^STATE/.test(t)
            ? 'state'
            : /^TEXT/.test(t)
              ? 'text'
              : 'custom';
  const who = (id0: unknown, app0: unknown) => {
    const id = str(id0),
      appId = str(app0);
    const ta = id && !AGENTS[id] ? teamAgentOf(appId, id) : null;
    return id && AGENTS[id] ? (
      <span className="who">
        <AgentAv id={id} size="xs" />
        <span>{AGENTS[id].name}</span>
      </span>
    ) : ta ? (
      <span className="who" title="One of the app's own agents">
        <TeamAv a={ta} size="xs" />
        <span>{ta.name}</span>
      </span>
    ) : (
      id || ''
    );
  };
  let body: ReactNode;
  if (D.tab === 'events')
    body = (
      <table className="tbl dense dbg-t">
        <tbody>
          {pick(EV, (e) => e.type + ' ' + JSON.stringify(e)).map((e) => {
            const rest: Dict<unknown> = { ...e };
            delete rest.seq;
            delete rest.t;
            delete rest.type;
            delete rest.agent;
            delete rest.app;
            return (
              <tr key={e.seq}>
                <td className="mono muted">{fmtClock(e.t)}</td>
                <td className="mono muted num">{e.seq}</td>
                <td>
                  <span className={'ev ev-' + fam(e.type)}>{e.type}</span>
                </td>
                <td>{who(e.agent, e.app)}</td>
                <td className="mono t-cap">{brief(rest, 220)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  else if (D.tab === 'tools')
    body = (
      <table className="tbl dense dbg-t">
        <thead>
          <tr>
            <th>Time</th>
            <th>Agent</th>
            <th>Tool</th>
            <th>Kind</th>
            <th>Arguments</th>
            <th>Result</th>
            <th className="num">Took</th>
          </tr>
        </thead>
        <tbody>
          {pick(TOOLCALLS, (x) => x.tool + ' ' + x.kind + ' ' + JSON.stringify(x.args)).map((x) => (
            <tr key={x.id}>
              <td className="mono muted">{fmtClock(x.t)}</td>
              <td>{who(x.agent, x.app)}</td>
              <td className="mono">{x.tool}</td>
              <td>
                <span className={'badge b-' + (x.kind === 'frontend' ? 'info' : x.kind === 'connector' ? 'warning' : 'outline')}>
                  {x.kind}
                </span>
              </td>
              <td className="mono t-cap">{brief(x.args, 120)}</td>
              <td className={cx('mono t-cap', !x.ok && 'bad-t')}>{brief(x.result, 160)}</td>
              <td className="num mono">{fmtMs(x.ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  else if (D.tab === 'model')
    body = (
      <div>
        <p className="muted t-cap pad-s">
          Live calls go to the model and count against the session cap ({U.calls}
          {' of '}
          {CAP}
          {
            ' used). Token counts for live calls are estimated at four characters per token. Replayed calls come from a saved build and show sample figures recorded with it.'
          }
        </p>
        <table className="tbl dense dbg-t">
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Source</th>
              <th>Model</th>
              <th className="num">Tokens in</th>
              <th className="num">Tokens out</th>
              <th className="num">From cache</th>
              <th className="num">Cost</th>
              <th className="num">Latency</th>
              <th className="num">Attempt</th>
            </tr>
          </thead>
          <tbody>
            {pick(MODELCALLS, (x) => x.agent + ' ' + x.mode).map((x, i) => (
              <tr key={i}>
                <td className="mono muted">{fmtClock(x.t)}</td>
                <td>{who(x.agent, x.app)}</td>
                <td>
                  <span className={'badge b-' + (x.mode === 'live' ? 'info' : 'outline')}>{x.mode === 'live' ? 'live' : 'replay'}</span>
                </td>
                <td>{x.model}</td>
                <td className="num mono">
                  {x.est ? '~' : ''}
                  {fmtNum(x.tokIn)}
                </td>
                <td className="num mono">
                  {x.est ? '~' : ''}
                  {fmtNum(x.tokOut)}
                </td>
                <td className="num mono">{x.cacheRead === undefined ? '–' : fmtNum(x.cacheRead)}</td>
                <td className="num mono">{x.mode === 'replay' ? '$0' : x.costUsd == null ? '–' : fmtUsd(x.costUsd)}</td>
                <td className="num mono">{fmtMs(x.ms)}</td>
                <td className="num mono">{x.attempt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  else if (D.tab === 'sql')
    body = (
      <table className="tbl dense dbg-t">
        <thead>
          <tr>
            <th>Time</th>
            <th>By</th>
            <th>Statement</th>
            <th>Parameters</th>
            <th className="num">Rows</th>
            <th className="num">Took</th>
          </tr>
        </thead>
        <tbody>
          {pick(SQLLOG, (x) => x.sql + ' ' + x.by).map((x, i) => (
            <tr key={i} className={x.err ? 'bad-r' : ''}>
              <td className="mono muted">{fmtClock(x.t)}</td>
              <td>{x.by}</td>
              <td className="mono t-cap" title={x.sql}>
                {x.sql.replace(/\s+/g, ' ').slice(0, 150)}
                {x.many ? '  × ' + x.many + ' rows' : ''}
                {x.err ? ' → ' + x.err : ''}
              </td>
              <td className="mono t-cap">{x.params ? brief(x.params, 60) : ''}</td>
              <td className="num mono">{x.rows != null ? x.rows : x.changes}</td>
              <td className="num mono">{fmtMs(x.ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  else if (D.tab === 'api')
    body = (
      <table className="tbl dense dbg-t">
        <thead>
          <tr>
            <th>Time</th>
            <th>From</th>
            <th>User</th>
            <th>Role</th>
            <th>Request</th>
            <th>Status</th>
            <th className="num">Took</th>
          </tr>
        </thead>
        <tbody>
          {pick(APILOG, (x) => x.method + ' ' + x.path + ' ' + x.user + ' ' + x.status).map((x, i) => (
            <tr key={i}>
              <td className="mono muted">{fmtClock(x.t)}</td>
              <td>
                {(
                  {
                    app: 'app',
                    check: 'check',
                    tour: 'tour',
                    try: 'API view',
                  } as Dict<string>
                )[x.src] || x.src}
              </td>
              <td>{x.user}</td>
              <td>{x.role}</td>
              <td className="mono">
                <span className={'verb v-' + x.method.toLowerCase()}>{x.method}</span> {x.path}
              </td>
              <td>
                <span className={'badge b-' + (x.status < 300 ? 'success' : x.status === 403 || x.status === 401 ? 'warning' : 'danger')}>
                  {x.status}
                </span>
              </td>
              <td className="num mono">{fmtMs(x.ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  else if (D.tab === 'state')
    body = app ? (
      <div className="json pad-s">
        <p className="muted t-cap">
          The shared canvas state. Agents write to it through tools and every write is sent to the page as a STATE_DELTA event. The workflow
          is part of it: your edits on the canvas are STATE_DELTA events with source user, and the orchestrator&apos;s are workflow.* tool
          calls. The built app, this drawer and the build pack all read from it.
        </p>
        <Json
          open
          v={{
            request: app.request,
            workflow: flowOf(app),
            reviews: app.reviews || {},
            brief: app.def.brief,
            schema: {
              tables: app.def.tables,
              migrations: app.def.migrations,
            },
            api: {
              workflow: app.def.process,
              access: app.def.access,
            },
            screens: app.def.screens,
            theme: app.def.theme,
            tour: app.def.tour,
            checks: Object.fromEntries(
              STATIONS.map((s) => [
                s.id,
                {
                  status: app.line[s.id].status,
                  passed: app.line[s.id].checks.filter((c) => c.ok).length,
                  of: app.line[s.id].checks.length,
                },
              ]),
            ),
            questions: app.answers,
            runs: app.runs.map((r) => ({
              id: r.id,
              kind: r.kind,
              status: r.status,
              steps: r.steps.length,
              calls: r.calls,
              retries: r.retries,
            })),
          }}
        />
      </div>
    ) : (
      <p className="muted pad-s">Open an app tab to see its state.</p>
    );
  else {
    const keys = LS.keys(),
      total = keys.reduce((n, k) => n + LS.size(k), 0);
    body = (
      <div className="pad-s col gap12">
        <p className="muted t-cap">{storageText(total)}</p>
        <div className="row">
          <Btn className="btn sm" onClick={backupWorkspace}>
            <Icon n="download" s="16" />
            Back up workspace
          </Btn>
          <Btn className="btn sm" onClick={restoreWorkspace}>
            <Icon n="open" s="16" />
            Restore
          </Btn>
        </div>
        <table className="tbl dense dbg-t">
          <thead>
            <tr>
              <th>Key</th>
              <th>Holds</th>
              <th className="num">Size</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td className="mono">{BRAND.ns + k}</td>
                <td>
                  {k === 'state'
                    ? 'Accounts, tabs, settings, app definitions, chat'
                    : k.indexOf('db:') === 0
                      ? 'SQLite file of ' + (S.apps[k.slice(3)]?.name || 'a deleted app')
                      : ''}
                </td>
                <td className="num mono">{fmtBytes(LS.size(k))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="col gap4">
          <div className="row">
            <strong>Offline cache</strong>
            <span className="badge b-outline">
              {typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller
                ? 'Active'
                : 'Not active in this tab'}
            </span>
          </div>
          <p className="muted t-cap">
            Turnkey registers a service worker and a web manifest. Cache first: the app shell, the SQLite engine and the saved builds.
            Network only: the model and agent routes under /api, and every connection.
          </p>
        </div>
      </div>
    );
  }
  const k = (name: string, v: ReactNode) => (
    <span className="kv">
      <span className="muted">{name}</span>
      <strong>{v}</strong>
    </span>
  );
  return (
    <section className={cx('debug', D.max && 'max')} aria-label="Debug">
      <div className="dbg-head">
        <Icon n="devtools" />
        <strong className="hide-sm">Debug</strong>
        <Tabs
          cls="sm"
          label="Debug"
          items={tabs}
          value={D.tab}
          onChange={(v) => {
            setDbg({ tab: v });
          }}
        />
        <span className="grow" />
        <Input
          native
          className="input sm"
          id="dbg-q"
          placeholder="Filter"
          aria-label="Filter the log"
          value={D.q}
          onInput={(e) => {
            setDbg({ q: e.currentTarget.value });
          }}
        />
        {app && (
          <Btn
            className={cx('btn subtle sm', D.all && 'on')}
            aria-pressed={!!D.all}
            title="Show every workspace, not only this tab"
            onClick={() => {
              setDbg({ all: !D.all });
            }}
          >
            All tabs
          </Btn>
        )}
        <Btn
          className="btn subtle icon sm"
          title="Clear the logs"
          aria-label="Clear the logs"
          onClick={() => {
            EV.length = 0;
            TOOLCALLS.length = 0;
            MODELCALLS.length = 0;
            SQLLOG.length = 0;
            APILOG.length = 0;
            notify();
          }}
        >
          <Icon n="broom" s="16" />
        </Btn>
        <Btn
          className="btn subtle icon sm"
          title={D.max ? 'Smaller' : 'Larger'}
          aria-label={D.max ? 'Smaller' : 'Larger'}
          onClick={() => {
            setDbg({ max: !D.max });
          }}
        >
          <Icon n={D.max ? 'chevDown' : 'chevUp'} s="16" />
        </Btn>
        <Btn
          className="btn subtle icon sm"
          aria-label="Close debug"
          title="Close"
          onClick={() => {
            S.settings.debug = false;
            commit();
          }}
        >
          <Icon n="dismiss" s="16" />
        </Btn>
      </div>
      <div className="dbg-kpis">
        {run
          ? [
              k('Last run', cap(run.kind) + ' ' + run.n + ' · ' + run.status),
              // eslint-disable-next-line react-hooks/purity -- a running run's elapsed time; the store re-renders while it runs
              k('Took', fmtMs((run.t1 || Date.now()) - run.t0)),
              k('Model calls', run.calls + (run.replayed ? ' live, ' + run.replayed + ' replayed' : '')),
              k(
                'Tokens',
                run.usage && run.usage.calls && !run.usage.estimated
                  ? fmtNum(promptTokens(run.usage) + run.usage.output)
                  : run.tokIn + run.tokOut
                    ? '~' + fmtNum(run.tokIn + run.tokOut)
                    : live.length
                      ? '0'
                      : 'sample only',
              ),
              k('Cost', run.usage && run.usage.calls ? usageLine(run.usage).split(' · ').slice(1).join(' · ') : '$0'),
              k('Send-backs', run.retries),
            ]
          : k('Run', 'none yet')}
        {k('Tool calls', mine(TOOLCALLS).length)}
        {k('SQL statements', mine(SQLLOG).length)}
        {k('API calls', mine(APILOG).length)}
        {k('Session cap', U.calls + ' of ' + CAP)}
        {k('Network', online() ? 'online' : 'offline')}
      </div>
      <div className="dbg-body scroll" tabIndex={0} role="region" aria-label="Debug details">
        {body}
      </div>
    </section>
  );
}
