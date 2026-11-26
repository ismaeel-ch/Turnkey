import { type ReactNode, useLayoutEffect, useRef } from 'react';
import type { BackedDef, BriefedDef } from '@/shared/types/app';
import type {
  ApiPanel,
  AppRecord,
  BuilderCard,
  ChatMessage,
  Connector,
  ConnectorTool,
  DataPanel,
  DebugPanel,
  Dict,
} from '@/shared/types/workspace';
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
  ago,
  arr,
  brief,
  cap,
  commit,
  confirmBox,
  copyText,
  cx,
  errText,
  dayOffset,
  fmtBytes,
  fmtClock,
  fmtMs,
  fmtNum,
  label,
  modeNow,
  needNet,
  notify,
  online,
  openDialog,
  saveFile,
  setChat,
  str,
  toast,
} from './core';
import {
  DBX,
  backupWorkspace,
  dbBytes,
  dbCount,
  dbDump,
  dbExists,
  dbTables,
  importAppDb,
  qi,
  restoreWorkspace,
  sqlPeek,
  sqlRun,
} from './db';
import { sqliteFileName, workspaceStorage } from '@/platform/storage';
import {
  TYPE_LABEL,
  VIEW_ICON,
  VIEW_LABEL,
  apiCall,
  appUsers,
  checkBackendLive,
  colOf,
  deriveEndpoints,
  type Endpoint,
  issuesOf,
  roleName,
  tableOf,
} from './engine';
import { allConnectors, callConnector, connOn } from './builds';
import { TeamAv, teamAgentOf } from './team';
import { AGENTS, PENDING, RUNS, STATIONS, answerQuestion, resetAppData } from './line';
import { handleChat, suggestChanges } from './changes';
import { FlowCards, flowOf, flowTips } from './custom';
import { AgentAv, Btn, Card, Chip, Empty, Field, Icon, Input, Json, MBar, Proto, Select, Spinner, Switch, Tabs, Textarea } from './ui';
import { isStatusCol, startWalk } from './runtime';
import { ReleaseCard } from './release';
import { latestTouchOfTable, touchOf, touchShort, touchText } from './provenance';

/** Who made a table, and who changed it last if that was later. Apps saved before this was recorded say the Database agent. */
function tableTouchText(app: AppRecord, table: string) {
  const made = touchOf(app, 'table:' + table),
    last = latestTouchOfTable(app, table),
    first = touchText(made, 'Created by the Database agent from the definition');
  return last && made && last.at > made.at && last !== made
    ? first + '. Last change: ' + touchText(last).replace(/^./, (c) => c.toLowerCase())
    : first;
}

/* ===== Turnkey prototype · shell: data, API and connections views, the agents chat, the debug drawer ===== */
export function Grid({ rows, mask }: { rows: Dict<unknown>[]; mask?: boolean }) {
  if (!rows.length) return <p className="muted pad">No rows.</p>;
  const keys = Object.keys(rows[0]);
  return (
    <div className="tbl-wrap">
      <table className="tbl dense">
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k} className="mono">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k} className={typeof r[k] === 'number' ? 'num mono' : ''}>
                  {r[k] == null ? (
                    <span className="muted">NULL</span>
                  ) : mask && k === 'password' ? (
                    '••••'
                  ) : String(r[k]).length > 70 ? (
                    String(r[k]).slice(0, 70) + '…'
                  ) : (
                    String(r[k])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
/** Where the workspace keeps its data, in one sentence for the storage panel. */
export function storageText(total: number) {
  const st = workspaceStorage()?.status();
  const what = 'the workspace state as JSON, and one SQLite file per app, base64-encoded. ' + fmtBytes(total) + ' used';
  if (!LS.ok)
    return (
      'Browser storage is not available in this view (' + LS.why + '), so everything lives in memory and is lost when the page closes.'
    );
  if (st && st.mode === 'indexeddb')
    return (
      "Everything is kept in this browser's IndexedDB: " +
      what +
      (st.unsaved ? ', ' + st.unsaved + ' change' + (st.unsaved === 1 ? '' : 's') + ' still being saved' : '') +
      '. Browsers allow hundreds of megabytes here.' +
      (st.full ? ' The last save was refused because the disk is full: ' + st.why : '')
    );
  return "Everything is kept in this browser's localStorage: " + what + '; browsers usually allow about 5 MB.';
}
/* Page state lives in the view store (U) so it outlives a re-render. Components read it through these getters and change
   it only through these actions, never by writing to the store while rendering. */
const DATA_START: DataPanel = { table: null, tab: 'rows', sql: 'SELECT role, COUNT(*) AS people FROM users GROUP BY role', out: null };
const dataOf = (appId: string): DataPanel => U.data[appId] || DATA_START;
function setData(appId: string, patch: Partial<DataPanel>) {
  U.data[appId] = { ...dataOf(appId), ...patch };
  notify();
}
const API_START: ApiPanel = { ep: null, tab: 'try', uid: null, id: '1', body: '{}', out: null };
const apiOf = (appId: string): ApiPanel => U.api[appId] || API_START;
function setApi(appId: string, patch: Partial<ApiPanel>) {
  U.api[appId] = { ...apiOf(appId), ...patch };
  notify();
}
/** Call one tool of a connector from the Connections page and keep the answer to show. */
function tryConnector(app: AppRecord, c: Connector, tool: ConnectorTool) {
  if (!connOn(c.id)) return toast('Switch ' + c.name + ' on first.', 'warning');
  if (!needNet('Testing a connection')) return;
  U.connOut = { id: c.id, tool: tool.name, r: callConnector(app, 'orchestrator', null, c.id, tool.name, tool.args) };
  notify();
}
function setChatDraft(appId: string, text: string) {
  U.chatDraft[appId] = text;
  notify();
}
/** Send a message to the builders and clear the draft. */
function sendChat(app: AppRecord, text: string) {
  const t = str(text);
  if (!t) return;
  setChatDraft(app.id, '');
  // handleChat reads the brief's question first; the chat is open on built apps and on builds past the Researcher
  handleChat(app as AppRecord & { def: BackedDef }, t);
}
export function DataView({ app }: { app: AppRecord }) {
  if (!dbExists(app.id) || !app.def.tables.length)
    return <Empty icon="database" title="No database yet" text="The Database agent creates the SQLite tables at the second station." />;
  const D = dataOf(app.id);
  const tables = dbTables(app.id),
    cur = tables.find((t) => t.name === D.table) || tables.find((t) => t.name !== 'users' && t.name !== 'activity') || tables[0],
    tdef = tableOf(app.def, cur.name);
  const runSql = () => {
    try {
      const r = sqlRun(app.id, D.sql, null, 'console');
      setData(app.id, {
        out: Array.isArray(r) ? { rows: r } : { msg: 'Done. ' + r.changes + ' row' + (r.changes === 1 ? '' : 's') + ' changed.' },
      });
    } catch (e) {
      setData(app.id, { out: { err: errText(e) } });
    }
    commit();
  };
  const reset = async () => {
    if (
      await confirmBox({
        title: 'Reset the data in ' + app.name + '?',
        body: 'Every table is emptied and the original seed rows are put back. Tables, users and screens stay as they are.',
        yes: 'Reset data',
      })
    )
      resetAppData(app);
  };
  const tabs = [
    {
      id: 'rows',
      label: 'Rows',
      count: Number(dbCount(app.id, cur.name)),
    },
    {
      id: 'cols',
      label: 'Columns',
    },
    {
      id: 'ddl',
      label: 'CREATE TABLE',
    },
    {
      id: 'console',
      label: 'SQL console',
    },
  ];
  return (
    <div className="split">
      <aside className="side" aria-label="Tables">
        <div className="side-h">Tables</div>
        <div className="side-list">
          {tables.map((t) => (
            <button
              key={t.name}
              className={cx('side-i', t.name === cur.name && 'on')}
              onClick={() => {
                setData(app.id, { table: t.name });
              }}
            >
              <Icon n="table" s="16" />
              <span className="grow ellipsis mono">{t.name}</span>
              <span className="t-cap muted">{dbCount(app.id, t.name)}</span>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <span className="t-cap muted">SQLite file</span>
          <strong>{fmtBytes(DBX.size[app.id] || LS.size('db:' + app.id))}</strong>
          <span className="t-cap muted">
            {LS.ok
              ? 'Saved in this browser' + (DBX.savedAt[app.id] ? ', ' + ago(DBX.savedAt[app.id]) : '')
              : 'Not saved: storage is unavailable here'}
          </span>
          <Btn className="btn sm" onClick={() => saveFile(sqliteFileName(app.name), dbBytes(app.id), 'application/vnd.sqlite3')}>
            <Icon n="download" s="16" />
            Export .sqlite
          </Btn>
          <Btn className="btn sm" onClick={() => importAppDb(app)}>
            <Icon n="open" s="16" />
            Import .sqlite
          </Btn>
          <Btn className="btn sm" onClick={() => copyText(dbDump(app.id), 'SQL dump')}>
            <Icon n="copy" s="16" />
            Copy as SQL
          </Btn>
          <Btn className="btn sm" onClick={reset}>
            <Icon n="reset" s="16" />
            Reset data
          </Btn>
        </div>
      </aside>
      <div className="main">
        <div className="main-head">
          <strong className="mono">{cur.name}</strong>
          <span className="muted t-cap hide-sm touch-note">{tdef ? tableTouchText(app, cur.name) : 'System table'}</span>
          <span className="grow" />
          <Tabs
            cls="sm"
            label="Table"
            items={tabs}
            value={D.tab}
            onChange={(v) => {
              setData(app.id, { tab: v });
            }}
          />
        </div>
        <div className="main-body scroll" tabIndex={0} role="region" aria-label={'Table ' + cur.name}>
          {D.tab === 'rows' ? (
            <Grid rows={sqlPeek(app.id, 'SELECT * FROM ' + qi(cur.name) + ' ORDER BY "id" DESC LIMIT 200')} mask />
          ) : D.tab === 'cols' ? (
            <Grid
              rows={sqlPeek(app.id, 'PRAGMA table_info(' + qi(cur.name) + ')').map((c) => {
                const col = tdef && colOf(tdef, String(c.name));
                return {
                  column: c.name,
                  type: c.type,
                  required: c.notnull ? 'yes' : '',
                  default: c.dflt_value,
                  key: c.pk ? 'primary key' : '',
                  meaning: col ? TYPE_LABEL[col.type] : '',
                  'made by': col ? touchShort(touchOf(app, 'col:' + cur.name + '.' + String(c.name))) : '',
                };
              })}
            />
          ) : D.tab === 'ddl' ? (
            <pre className="code pad">{cur.sql};</pre>
          ) : (
            <div className="console pad">
              <p className="muted t-cap">
                Runs on the real SQLite file in this browser. Writes are kept, so use Reset data to undo experiments.
              </p>
              <Textarea
                native
                className="textarea mono"
                id={'sql-in-' + app.id}
                rows={4}
                aria-label="SQL"
                value={D.sql}
                onInput={(e) => {
                  setData(app.id, { sql: e.currentTarget.value });
                }}
              />
              <div className="row">
                <Btn className="btn primary sm" onClick={runSql}>
                  <Icon n="play" s="16" />
                  Run
                </Btn>
                {[
                  'SELECT name, sql FROM sqlite_master',
                  'SELECT * FROM activity ORDER BY id DESC LIMIT 20',
                  'PRAGMA foreign_key_check',
                ].map((q) => (
                  <Chip
                    key={q}
                    className="mono"
                    onClick={() => {
                      setData(app.id, { sql: q });
                    }}
                  >
                    {q.length > 34 ? q.slice(0, 34) + '…' : q}
                  </Chip>
                ))}
              </div>
              {D.out &&
                (D.out.err ? (
                  <MBar tone="danger">{D.out.err}</MBar>
                ) : D.out.msg ? (
                  <MBar tone="success">{D.out.msg}</MBar>
                ) : (
                  <Grid rows={(D.out.rows || []).slice(0, 200)} />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export function sampleBody(app: AppRecord, ep: Endpoint) {
  const def = app.def,
    users = appUsers(app);
  if (ep.id === 'auth.login')
    return {
      username: users[0] ? users[0].username : '',
      password: 'demo',
    };
  const t = tableOf(def, ep.table);
  if (!t) return {};
  if (ep.action === 'create') {
    const o: Dict<unknown> = {};
    t.columns.forEach((c) => {
      if (!c.required || isStatusCol(def, t, c)) return;
      o[c.name] =
        c.type === 'select'
          ? (c.options || [])[0]
          : c.type === 'ref'
            ? 1
            : c.type === 'user'
              ? (
                  users.find((u) => !c.role || u.role === c.role) || {
                    id: 1,
                  }
                ).id
              : c.type === 'date'
                ? dayOffset(1)
                : c.type === 'datetime'
                  ? dayOffset(1) + 'T10:00'
                  : c.type === 'number' || c.type === 'money'
                    ? 1
                    : c.type === 'bool'
                      ? true
                      : 'Created through the API';
    });
    return o;
  }
  if (ep.action === 'update') {
    const c = t.columns.find((x) => x.type === 'text');
    return c
      ? {
          [c.name]: 'Changed through the API',
        }
      : {};
  }
  return {};
}
export function ApiView({ app }: { app: AppRecord }) {
  const def = app.def;
  if (!def.process || !dbExists(app.id))
    return (
      <Empty icon="server" title="No endpoints yet" text="The Backend agent writes the workflow and access rules at the third station." />
    );
  const A = apiOf(app.id);
  // the Backend agent writes the workflow only after the brief, so the definition has one here
  const bdef = def as BriefedDef;
  const eps = deriveEndpoints(bdef),
    ep = eps.find((e) => e.id === A.ep) || eps.find((e) => e.action === 'list') || eps[0],
    users = appUsers(app),
    user = users.find((u) => u.id === A.uid) || users[0];
  const groups: [string, Endpoint[]][] = [
    ['Sign-in', eps.filter((e) => e.sys)],
    ...def.tables.map((t): [string, Endpoint[]] => [t.label, eps.filter((e) => e.table === t.name)]),
  ];
  const pick = (e: Endpoint) => {
    setApi(app.id, { ep: e.id, body: JSON.stringify(sampleBody(app, e), null, 2), out: null });
  };
  const send = () => {
    let body = {};
    try {
      body = A.body.trim() ? JSON.parse(A.body) : {};
    } catch {
      setApi(app.id, { out: { status: 0, error: 'The body is not valid JSON.' } });
      return;
    }
    const path = ep.path.replace(':id', A.id || '1'),
      r = apiCall(app, ep.open ? null : user, ep.method, path, body, 'try');
    setApi(app.id, { out: { path, ...r } });
  };
  const retest = () => {
    const c = checkBackendLive(app as AppRecord & { def: BriefedDef }, {
      agent: 'orchestrator',
      appId: app.id,
    });
    toast(c.every((x) => x.ok) ? c[0].detail : 'A permission test failed: ' + issuesOf(c)[0], c.every((x) => x.ok) ? 'success' : 'danger');
    commit();
  };
  const allowed = ep.open || !!ep.roles[user.role];
  return (
    <div className="split">
      <aside className="side wide" aria-label="Endpoints">
        <div className="side-h">Endpoints ({eps.length})</div>
        <div className="side-list">
          {groups.map((g) => (
            <div key={g[0]}>
              <div className="side-g">{g[0]}</div>
              {g[1].map((e) => (
                <button key={e.id} className={cx('side-i', e.id === ep.id && 'on')} onClick={() => pick(e)}>
                  <span className={'verb v-' + e.method.toLowerCase()}>{e.method}</span>
                  <span className="grow ellipsis mono">{e.path.replace('/api', '')}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="main">
        <div className="main-head">
          <span className={'verb v-' + ep.method.toLowerCase()}>{ep.method}</span>
          <strong className="mono">{ep.path}</strong>
          <span className="grow" />
          <Tabs
            cls="sm"
            label="API"
            items={[
              {
                id: 'try',
                label: 'Try it',
              },
              {
                id: 'matrix',
                label: 'Permission matrix',
              },
            ]}
            value={A.tab}
            onChange={(v) => {
              setApi(app.id, { tab: v });
            }}
          />
        </div>
        <div className="main-body scroll pad">
          {A.tab === 'matrix' ? (
            <>
              <div className="row between wrap">
                <span className="muted t-cap">
                  {
                    'Every endpoint against every role. The Backend station calls each cell for real: allowed cells must get through, the rest must return 403. '
                  }
                  {app.matrix
                    ? 'Last run: ' +
                      app.matrix.calls +
                      ' calls, ' +
                      app.matrix.refused +
                      ' refused as intended, ' +
                      ago(app.matrix.at) +
                      '.'
                    : ''}
                </span>
                <Btn className="btn sm" onClick={retest}>
                  <Icon n="shield" s="16" />
                  Run the tests again
                </Btn>
              </div>
              <div className="tbl-wrap">
                <table className="tbl dense">
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      {bdef.brief.roles.map((r) => (
                        <th key={r.id}>{r.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eps
                      .filter((e) => !e.sys)
                      .map((e) => (
                        <tr key={e.id}>
                          <td>
                            <span className={'verb v-' + e.method.toLowerCase()}>{e.method}</span>{' '}
                            <span className="mono">{e.path.replace('/api', '')}</span>
                          </td>
                          {bdef.brief.roles.map((r) => {
                            const v = e.roles[r.id],
                              bad = app.matrix && app.matrix.failed.includes(e.id + '|' + r.id);
                            return (
                              <td key={r.id}>
                                {bad ? (
                                  <span className="badge b-danger">Test failed</span>
                                ) : v ? (
                                  <span className={cx('badge', v === 'own' ? 'b-warning' : 'b-success')}>
                                    <Icon n="check" s="12" />
                                    {v === 'own' ? 'own rows' : 'allowed'}
                                  </span>
                                ) : (
                                  <span className="muted">403</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="api-grid">
              <div className="col gap12">
                <div className="code">{ep.sql}</div>
                <p className="muted t-cap">
                  {ep.open
                    ? 'Open to anyone.'
                    : 'Allowed: ' +
                      (Object.keys(ep.roles)
                        .map((r) => roleName(def, r) + (ep.roles[r] === 'own' ? ' (own rows)' : ''))
                        .join(', ') || 'nobody') +
                      '.'}
                </p>
                {!ep.open && (
                  <Field id={'api-u-' + app.id} label="Call as">
                    <Select
                      native
                      className="select"
                      id={'api-u-' + app.id}
                      value={String(user.id)}
                      onChange={(e) => {
                        setApi(app.id, { uid: +e.currentTarget.value, out: null });
                      }}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.name}
                          {' · '}
                          {roleName(def, u.role)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {/:id/.test(ep.path) && (
                  <Field id={'api-id-' + app.id} label="Record id">
                    <Input
                      native
                      className="input"
                      id={'api-id-' + app.id}
                      type="number"
                      min="1"
                      value={A.id}
                      onInput={(e) => {
                        setApi(app.id, { id: e.currentTarget.value });
                      }}
                    />
                  </Field>
                )}
                {ep.method !== 'GET' && ep.method !== 'DELETE' && (
                  <Field id={'api-b-' + app.id} label="JSON body">
                    <Textarea
                      native
                      className="textarea mono"
                      id={'api-b-' + app.id}
                      rows={6}
                      value={A.body}
                      onInput={(e) => {
                        setApi(app.id, { body: e.currentTarget.value });
                      }}
                    />
                  </Field>
                )}
                <div className="row">
                  <Btn className="btn primary" onClick={send}>
                    <Icon n="send" s="16" />
                    Send
                  </Btn>
                  {!allowed && (
                    <span className="t-cap muted">
                      {roleName(def, user.role)}
                      {' is not allowed here. Send it anyway to see the refusal.'}
                    </span>
                  )}
                </div>
              </div>
              <div className="col gap8">
                <h4>Response</h4>
                {A.out ? (
                  <>
                    <div className="row">
                      <span
                        className={
                          'badge b-' +
                          (A.out.status >= 200 && A.out.status < 300
                            ? 'success'
                            : A.out.status === 403 || A.out.status === 401
                              ? 'warning'
                              : 'danger')
                        }
                      >
                        {A.out.status || 'Error'}
                      </span>
                      <span className="mono t-cap">
                        {ep.method} {A.out.path}
                      </span>
                      {A.out.ms != null && <span className="t-cap muted">{fmtMs(A.out.ms)}</span>}
                    </div>
                    <pre className="code tall">
                      {JSON.stringify(
                        A.out.error
                          ? {
                              error: A.out.error,
                              fields: A.out.fields,
                            }
                          : A.out.data,
                        null,
                        2,
                      )}
                    </pre>
                  </>
                ) : (
                  <p className="muted">Send a request to see what the backend returns. Writes made here are real.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export function ConnView({ app }: { app: AppRecord }) {
  const list = allConnectors(),
    cur = list.find((c) => c.id === U.conn) || list[0],
    off = !online(),
    out = U.connOut && U.connOut.id === cur.id ? U.connOut : null;
  const test = (tool: ConnectorTool) => tryConnector(app, cur, tool);
  return (
    <div className="connv">
      {off && (
        <MBar tone="warning">
          You are offline. Connections reach third parties over the internet, so they are paused. Built apps and their data keep working.
        </MBar>
      )}
      <div className="row between wrap">
        <div className="col gap0">
          <h2 className="t-sub1">Connections</h2>
          <span className="muted">Third-party systems the agents and built apps may call. Any REST API or MCP server can be added.</span>
        </div>
        <Btn className="btn primary" onClick={() => openDialog('addconn')}>
          <Icon n="add" />
          Add connection
        </Btn>
      </div>
      <div className="conn-grid">
        {list.map((c) => (
          <Card key={c.id} className={cx('card conn-card', cur.id === c.id && 'sel')}>
            <div className="row">
              <button
                className="conn-main"
                onClick={() => {
                  U.conn = c.id;
                  notify();
                }}
              >
                <span className={'tpl-ic sm acc-' + (c.acc || 'steel')}>
                  <Icon n={c.icon || 'plug'} />
                </span>
                <span className="col gap0 grow">
                  <strong>{c.name}</strong>
                  <span className="t-cap muted">
                    {c.kind}
                    {' · '}
                    {c.auth}
                  </span>
                </span>
              </button>
              <Switch
                id={'conn-' + c.id}
                on={connOn(c.id)}
                onChange={(v) => {
                  S.conns[c.id] = v;
                  commit();
                }}
                title={'Allow ' + c.name + ' in this workspace'}
              />
            </div>
            <p className="muted t-cap">{c.about}</p>
            <span className={'badge b-' + (!connOn(c.id) ? 'neutral' : off ? 'warning' : 'success')}>
              {!connOn(c.id) ? 'Off' : off ? 'Needs internet' : 'Connected'}
            </span>
          </Card>
        ))}
      </div>
      <Card className="card flat conn-detail">
        <div className="row between wrap">
          <div className="col gap0">
            <strong className="t-sub2">{cur.name}</strong>
            <span className="mono t-cap">{cur.url}</span>
          </div>
          {!!cur.custom && (
            <Btn
              className="btn sm"
              onClick={() => {
                S.custom = S.custom.filter((x) => x.id !== cur.id);
                delete S.conns[cur.id];
                U.conn = null;
                commit();
              }}
            >
              <Icon n="trash" s="16" />
              Remove
            </Btn>
          )}
        </div>
        <p className="muted t-cap">
          {'Used by: '}
          {cur.usedBy}
          {'. '}
          {cur.kind === 'MCP server'
            ? 'The real build opens an MCP client for each run and closes it at the end.'
            : 'The real build calls it from the server route, so no key ever reaches the browser.'}
        </p>
        <div className="tbl-wrap">
          <table className="tbl dense">
            <thead>
              <tr>
                <th>Tool</th>
                <th>What it does</th>
                <th>Example arguments</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cur.tools.map((t) => (
                <tr key={t.name}>
                  <td className="mono">{t.name}</td>
                  <td>{t.desc}</td>
                  <td className="mono t-cap">{JSON.stringify(t.args)}</td>
                  <td>
                    <Btn className="btn sm" disabled={off} title={off ? 'Needs internet' : 'Call this tool'} onClick={() => test(t)}>
                      Test
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {out && (
          <div className="col gap4">
            <div className="row">
              <strong>{out.tool}</strong>
              <Proto>Sample response</Proto>
            </div>
            <div className="json code">
              <Json v={out.r.result} open />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- chat with generative UI cards ---------- */
export function ChatCard({ app, m }: { app: AppRecord; m: ChatMessage }) {
  // the build line, the change planner and the Tester write these cards; each `type` has the shape BuilderCard gives it
  const c = m.card as BuilderCard | null;
  if (!c) return null;
  switch (c.type) {
    case 'brief':
      return (
        <div className="gcard">
          <div className="gc-h">
            <Icon n="clipboard" s="16" />
            Brief
          </div>
          <p>{c.summary}</p>
          <div className="gc-row">
            <span className="muted">Roles</span>
            <span className="row wrap gap4">
              {c.roles.map((r) => (
                <span key={r} className="badge b-outline">
                  {r}
                </span>
              ))}
            </span>
          </div>
          <div className="gc-row">
            <span className="muted">Records</span>
            <span className="row wrap gap4">
              {c.records.map((r) => (
                <span key={r} className="badge b-outline">
                  {r}
                </span>
              ))}
            </span>
          </div>
          <div className="gc-row">
            <span className="muted">Process</span>
            <span>{c.states.join(' → ')}</span>
          </div>
        </div>
      );
    case 'tables':
      return (
        <div className="gcard">
          <div className="gc-h">
            <Icon n="database" s="16" />
            SQLite tables
          </div>
          {c.tables.map((t) => (
            <div key={t.name} className="gc-row">
              <strong>{t.name}</strong>
              <span className="muted">
                {t.cols}
                {' columns · '}
                {t.rows}
                {' rows'}
              </span>
            </div>
          ))}
          <div className="gc-row">
            <strong>Users</strong>
            <span className="muted">
              {c.users}
              {' seeded, password demo'}
            </span>
          </div>
        </div>
      );
    case 'access':
      return (
        <div className="gcard">
          <div className="gc-h">
            <Icon n="shield" s="16" />
            Endpoints and rules
          </div>
          <div className="gc-row">
            <span className="muted">Endpoints</span>
            <span>{c.endpoints}</span>
          </div>
          <div className="gc-row">
            <span className="muted">Workflow</span>
            <span className="row wrap gap4">
              {c.actions.map((a) => (
                <span key={a} className="badge b-outline">
                  {a}
                </span>
              ))}
            </span>
          </div>
          <div className="gc-row">
            <span className="muted">Tested</span>
            <span>
              {c.calls}
              {' calls, '}
              {c.refused}
              {' refused as intended'}
            </span>
          </div>
          {c.team && (
            <div className="gc-row">
              <span className="muted">App agents</span>
              <span className="row wrap gap4">
                {c.team.map((a) => (
                  <span key={a} className="badge b-outline">
                    <Icon n="bot" s="12" />
                    {a}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      );
    case 'tests':
      return (
        <div className={cx('gcard', c.failed ? 'warn' : 'ok')}>
          <div className="gc-h">
            <Icon n="beaker" s="16" />
            {'Test suite · '}
            {c.passed}
            {' of '}
            {c.total}
            {' pass'}
          </div>
          <div className="row wrap gap4">
            {c.suites.map((s) => (
              <span key={s.name} className="badge b-outline">
                {s.name} {s.n}
              </span>
            ))}
          </div>
          <div className="row">
            <Btn
              className="btn sm"
              onClick={() => {
                U.view[app.id] = 'tests';
                notify();
              }}
            >
              <Icon n="beaker" s="16" />
              Open the tests
            </Btn>
          </div>
        </div>
      );
    case 'viewplan':
      return (
        <div className="gcard">
          <div className="gc-h">
            <Icon n="pie" s="16" />
            Views and dashboard
          </div>
          {c.tables.map((t) => (
            <div key={t.name} className="gc-row top">
              <strong>{t.name}</strong>
              <span className="row wrap gap4">
                {t.views.map((v) => (
                  <span key={v} className="badge b-outline">
                    <Icon n={VIEW_ICON[v]} s="12" />
                    {VIEW_LABEL[v]}
                  </span>
                ))}
              </span>
            </div>
          ))}
          <div className="gc-row">
            <span className="muted">Dashboard</span>
            <span>
              {c.widgets}
              {' widgets, for every role'}
            </span>
          </div>
        </div>
      );
    case 'screens':
      return (
        <div className="gcard">
          <div className="gc-h">
            <Icon n="layout" s="16" />
            Screens
          </div>
          <div className="row wrap gap4">
            {c.screens.map((s) => (
              <span key={s.name} className="badge b-outline">
                <Icon n={VIEW_ICON[s.type]} s="12" />
                {s.name}
              </span>
            ))}
          </div>
          <div className="gc-row">
            <span className="muted">Layout</span>
            <span>
              <span className={'swatch acc-' + c.accent} />
              {label(c.accent)}
              {', '}
              {c.nav === 'rail' ? 'icon rail' : c.nav + ' navigation'}
            </span>
          </div>
        </div>
      );
    case 'acceptance':
      return (
        <div className="gcard">
          <div className="gc-h">
            <Icon n="tasks" s="16" />
            Acceptance test
          </div>
          <ol className="gc-steps">
            {c.steps.map((s, i) => (
              <li key={i} className={s.ok ? 'ok' : 'bad'}>
                <Icon n={s.ok ? 'checkCircle' : 'errorCircle'} s="16" />
                <span>{s.say}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case 'ready':
      return (
        <div className="gcard ok">
          <div className="row wrap">
            <Btn
              className="btn primary sm"
              onClick={() => {
                U.view[app.id] = 'app';
                notify();
              }}
            >
              <Icon n="window" s="16" />
              Open the app
            </Btn>
            <Btn className="btn sm" onClick={() => startWalk(app)}>
              <Icon n="playOutline" s="16" />
              Play the walkthrough
            </Btn>
            <Btn
              className="btn sm"
              onClick={() =>
                openDialog('pack', {
                  app: app.id,
                })
              }
            >
              <Icon n="document" s="16" />
              Build pack
            </Btn>
          </div>
        </div>
      );
    case 'question': {
      const live = RUNS[app.id] && RUNS[app.id].answer && c.answered == null;
      return (
        <div className="gcard ask">
          <div className="gc-h">
            <Icon n="questionChat" s="16" />
            Your call
          </div>
          <div className="col gap4">
            {c.options.map((o, i) => (
              <button key={i} className={cx('opt', c.answered === i && 'on')} disabled={!live} onClick={() => answerQuestion(app, i)}>
                <span className="grow">{o}</span>
                {i === c.recommended && <span className="badge b-info">Recommended</span>}
                {c.answered === i && <Icon n="check" s="16" />}
              </button>
            ))}
          </div>
          {c.answered == null && !live && <span className="t-cap muted">No longer waiting for an answer.</span>}
        </div>
      );
    }
    case 'approval': {
      const live = !!PENDING[app.id] && c.decided == null;
      return (
        <div className="gcard ask">
          <div className="gc-h">
            <Icon n="warning" s="16" />
            Approval needed
          </div>
          <ul className="plain">
            {c.items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          {c.decided ? (
            <span className={'badge b-' + (c.decided === 'approved' ? 'success' : 'neutral')}>
              {c.decided === 'approved' ? 'Approved' : 'Declined'}
            </span>
          ) : live ? (
            <div className="row">
              <Btn className="btn danger sm" onClick={() => PENDING[app.id](true)}>
                Approve and delete
              </Btn>
              <Btn className="btn sm" onClick={() => PENDING[app.id](false)}>
                Keep the data
              </Btn>
            </div>
          ) : (
            <span className="t-cap muted">No longer waiting for an answer.</span>
          )}
        </div>
      );
    }
    case 'plan':
      return (
        <div className="gcard">
          <div className="gc-h">
            <Icon n="branch" s="16" />
            Change plan
          </div>
          <ol className="gc-plan">
            {c.steps.map((s, i) => (
              <li key={i}>
                <span>{s.text}</span>
                {s.sql && <code>{s.sql.replace(/\s+/g, ' ')}</code>}
              </li>
            ))}
          </ol>
          <div className="gc-row">
            <span className="muted">Runs again</span>
            <span>{c.rerun.join(' → ')}</span>
          </div>
          {c.skip.length > 0 && (
            <div className="gc-row">
              <span className="muted">Untouched</span>
              <span>{c.skip.join(', ')}</span>
            </div>
          )}
        </div>
      );
    case 'sentback':
      return (
        <div className="gcard warn">
          <div className="gc-h">
            <Icon n="undo" s="16" />
            {'Sent back · attempt '}
            {c.attempt}
          </div>
          <ul className="plain">
            {c.issues.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      );
    case 'changed':
      return (
        <div className="gcard ok">
          <div className="gc-h">
            <Icon n="checkCircle" s="16" />
            Applied
          </div>
          <ul className="plain">
            {c.items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <div className="gc-row">
            <span className="muted">Ran again</span>
            <span>{c.reran.join(' → ')}</span>
          </div>
        </div>
      );
    case 'error':
      return (
        <div className="gcard bad">
          {arr(c.issues).length ? (
            <ul className="plain">
              {(c.issues || []).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
          <div className="row wrap">
            <Btn
              className="btn sm"
              onClick={() => {
                S.settings.debug = true;
                commit();
              }}
            >
              <Icon n="bug" s="16" />
              Open debug
            </Btn>
          </div>
        </div>
      );
    case 'flow':
    case 'gate':
    case 'review':
    case 'flowinfo':
      return <FlowCards app={app} m={m} />;
    case 'released':
      return <ReleaseCard app={app} m={m} />;
    default:
      return null;
  }
}
export function Msg({ app, m }: { app: AppRecord; m: ChatMessage }) {
  const mine = m.from === 'user',
    a = AGENTS[m.from];
  return (
    <div className={cx('msg', mine && 'me')}>
      {!mine && <AgentAv id={m.from} size="sm" />}
      <div className="msg-b">
        {!mine && (
          <div className="msg-who">
            <strong>{a ? a.name : 'System'}</strong>
            <span className="t-cap muted">{fmtClock(m.t).slice(0, 5)}</span>
          </div>
        )}
        {m.text && <div className="msg-t">{m.text}</div>}
        {m.card && <ChatCard app={app} m={m} />}
      </div>
    </div>
  );
}
export function ChatPanel({ app }: { app: AppRecord }) {
  const ref = useRef<HTMLDivElement>(null),
    busy = !!RUNS[app.id],
    n = app.chat.length,
    last = app.chat[n - 1],
    draft = U.chatDraft[app.id] || '';
  const answered = last && last.card ? String(last.card.answered) + String(last.card.decided) : '';
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [n, app.id, answered]);
  const send = (text?: string) => sendChat(app, text != null ? text : draft);
  const waiting = busy && (RUNS[app.id].answer || RUNS[app.id].gate),
    idle = !busy && !PENDING[app.id],
    ftips = idle ? flowTips(app) : [],
    tips = app.status === 'ready' && idle ? suggestChanges(app).slice(0, ftips.length ? 4 : 5) : [];
  return (
    <aside className="chat" data-tour="chat" aria-label="Agents">
      <div className="chat-head">
        <strong>Builders</strong>
        <span className={cx('badge', modeNow().cls)} title={modeNow().long}>
          {modeNow().text}
        </span>
        {!online() && S.settings.demo && <span className="badge b-warning">Offline</span>}
        <span className="grow" />
        <span className="chat-avs" aria-hidden="true">
          {['researcher', 'database', 'backend', 'ui'].map((id) => (
            <AgentAv key={id} id={id} size="xs" />
          ))}
        </span>
        <Btn className="btn subtle icon sm" aria-label="Hide the agents panel" title="Hide" onClick={() => setChat(false)}>
          <Icon n="panelRight" s="16" />
        </Btn>
      </div>
      <div className="msgs" ref={ref} aria-live="polite">
        {app.chat.map((m) => (
          <Msg key={m.id} app={app} m={m} />
        ))}
        {U.busy === app.id && (
          <div className="msg">
            <AgentAv id="orchestrator" size="sm" />
            <div className="msg-b">
              <div className="msg-t">
                <Spinner />
                {' Reading your message'}
              </div>
            </div>
          </div>
        )}
      </div>
      {tips.length > 0 && (
        <div className="chat-tips">
          <span className="t-cap muted">Try a change</span>
          {tips.map((t) => (
            <Chip key={t} onClick={() => send(t)}>
              {t}
            </Chip>
          ))}
        </div>
      )}
      {ftips.length > 0 && (
        <div className="chat-tips flow-tips">
          <span className="t-cap muted">Change how it is built</span>
          {ftips.map((t) => (
            <Chip key={t} onClick={() => send(t)}>
              <Icon n="options" s="12" />
              {t}
            </Chip>
          ))}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          native
          className="textarea"
          id={'chat-' + app.id}
          rows={2}
          aria-label="Message the agents"
          placeholder={
            waiting
              ? RUNS[app.id].gate
                ? 'Approve above, or type approve'
                : 'Pick an option above, or type its number'
              : app.status === 'ready'
                ? 'Ask for a change to the app or to the workflow'
                : busy
                  ? 'The agents are building. You can still change the workflow.'
                  : 'Say how it should be built, or run the build'
          }
          value={draft}
          onInput={(e) => {
            setChatDraft(app.id, e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Btn className="btn primary icon" type="submit" aria-label="Send" disabled={!draft.trim()}>
          <Icon n="send" />
        </Btn>
      </form>
    </aside>
  );
}

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
            <Proto>Simulated here</Proto>
          </div>
          <p className="muted t-cap">
            The real build registers a service worker and a web manifest. Cache first: the app shell, the SQLite engine and the saved
            builds. Network only: the agent route (/api/copilotkit) and every connection.
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
              k('Tokens', run.tokIn + run.tokOut ? '~' + fmtNum(run.tokIn + run.tokOut) : live.length ? '0' : 'sample only'),
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
