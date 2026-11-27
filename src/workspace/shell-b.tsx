import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppTable, BackedDef, BriefedDef } from '@/shared/types/app';
import type {
  ApiPanel,
  AppRecord,
  BuilderCard,
  ChatMessage,
  Connector,
  ConnectorTool,
  DataPanel,
  Dict,
  Loose,
} from '@/shared/types/workspace';
import {
  LS,
  S,
  U,
  ago,
  arr,
  commit,
  copyText,
  cx,
  errText,
  dayOffset,
  fmtBytes,
  fmtClock,
  fmtMs,
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
  toolCall,
} from './core';
import { DBX, dbBytes, dbCount, dbDump, dbExists, dbTables, importAppDb, qi, sqlPeek, sqlRun } from './db';
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
import { allConnectors, callConnector, connOn } from './connections';
import { AGENTS, PENDING, RUNS, answerQuestion } from './line';
import { DemoActions } from './demo-data-ui';
import { editBlocked, editFromCanvas, handleChat, suggestChanges } from './changes';
import { flowTips } from './custom';
import { AgentAv, Btn, Card, Chip, Empty, Field, Icon, Input, Json, MBar, Proto, Select, Spinner, Switch, Tabs, Textarea } from './ui';
import { isStatusCol, startWalk } from './runtime';
import { latestTouchOfTable, touchOf, touchShort, touchText } from './provenance';
import { later } from './later';

// Loaded the first time they are drawn, to keep them out of the first page load.
const ReleaseCard = later(() => import('./release-ui'), 'ReleaseCard');
const FlowCards = later(() => import('./custom-ui'), 'FlowCards');

// Improving an app after it is built (the plan card, its questions, try it) loads the first time one of its cards shows.
const ChangePlanCard = lazy(() => import('./improve').then((m) => ({ default: m.ChangePlanCard })));
const UnderstandBox = lazy(() => import('./improve').then((m) => ({ default: m.UnderstandBox })));
const TryItCard = lazy(() => import('./improve').then((m) => ({ default: m.TryItCard })));

/** Who made a table, and who changed it last if that was later. Apps saved before this was recorded say the Database agent. */
function tableTouchText(app: AppRecord, table: string) {
  const made = touchOf(app, 'table:' + table),
    last = latestTouchOfTable(app, table),
    first = touchText(made, 'Created by the List builder from the definition');
  return last && made && last.at > made.at && last !== made
    ? first + '. Last change: ' + touchText(last).replace(/^./, (c) => c.toLowerCase())
    : first;
}

/* ===== Turnkey prototype · shell: data, API and connections views, the agents chat, the debug drawer ===== */
export function Grid({ rows, mask }: { rows: Dict<unknown>[]; mask?: boolean }) {
  if (!rows.length) return <p className="muted pad">No rows.</p>;
  const keys = Object.keys(rows[0]);
  // Wide tables scroll sideways, so the wrapper is a named, focusable region that keyboard users can scroll.
  return (
    <div className="tbl-wrap" role="region" aria-label="Rows" tabIndex={0}>
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
                <td key={k} className={typeof r[k] === 'number' ? 'num mono' : String(r[k] ?? '').length <= 24 ? 'nw' : ''}>
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
  if (!liveTool(c.id, tool.name)) {
    // no server client for this tool yet: show the labelled sample
    U.connOut = { id: c.id, tool: tool.name, r: callConnector(app, 'orchestrator', null, c.id, tool.name, tool.args), real: false };
    return notify();
  }
  U.connOut = { id: c.id, tool: tool.name, r: { ok: true, result: { status: 'Calling ' + c.name + '…' } }, real: true, busy: true };
  notify();
  void liveConnector(c.id, tool.args).then((r) => {
    // the debug drawer's Tool calls list shows the real call like any other
    toolCall(
      { agent: 'orchestrator', appId: app.id },
      c.name + ' · ' + tool.name,
      tool.args,
      () => {
        if (!r.ok) throw new Error(String(r.result));
        return r.result;
      },
      'connector',
    );
    if (!U.connOut || U.connOut.id !== c.id || U.connOut.tool !== tool.name) return; // the owner moved on
    U.connOut = { id: c.id, tool: tool.name, r, real: r.ok };
    if (!r.ok) {
      // the source failed or could not be reached: say why, and show the sample beside it
      const sample = callConnector(app, 'orchestrator', null, c.id, tool.name, tool.args);
      U.connOut = { id: c.id, tool: tool.name, r: { ok: false, result: { error: r.result, sample: sample.result } }, real: false };
    }
    notify();
  });
}
/** Connectors the server can call for real (`src/server/connectors`), through `/api/connectors/<id>`. */
const SERVER_CONNECTORS = ['wikipedia', 'worldbank', 'openalex', 'arxiv', 'patentsview', 'mslearn'];
/** Tools of those connectors that stay samples: the server client only searches. */
const SAMPLE_TOOLS = ['microsoft_docs_fetch'];
function liveTool(id: string, tool: string): boolean {
  return SERVER_CONNECTORS.includes(id) && !SAMPLE_TOOLS.includes(tool);
}
/** The text to search for: the first text argument of the tool's example, which the owner may have edited. */
function queryOf(args: Dict<unknown> | undefined): string {
  const vals = Object.values(args || {}).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
  return vals.map(String).join(' ').trim().slice(0, 200);
}
/** One real call through this app's own server route. The browser never talks to the source itself. */
async function liveConnector(id: string, args: Dict<unknown> | undefined): Promise<{ ok: boolean; result: Loose }> {
  const q = queryOf(args);
  try {
    const res = await fetch('/api/connectors/' + encodeURIComponent(id) + '?limit=3&q=' + encodeURIComponent(q), { cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; items?: unknown; message?: unknown } | null;
    if (body && body.ok === true && Array.isArray(body.items)) return { ok: true, result: { query: q, items: body.items } };
    return { ok: false, result: typeof body?.message === 'string' ? body.message : 'The server answered ' + res.status + '.' };
  } catch {
    return { ok: false, result: 'The server could not be reached.' };
  }
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
/** The field types the owner can pick when adding a field by hand. Links to other tables are made in chat. */
const EDIT_TYPES = ['text', 'longtext', 'number', 'money', 'date', 'bool', 'select'];
/** Edit a table's fields on the canvas itself: add, rename or remove one. Each edit is planned like a chat change,
 *  so the plan card shows what runs again, removing stored values asks first, and only the touched stations re-run. */
function FieldEditor({ app, table }: { app: AppRecord & { def: BackedDef }; table: AppTable }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const [pick, setPick] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blocked = editBlocked(app);
  const fixed = new Set([table.title, table.owner, app.def.process.table === table.name ? app.def.process.column : '']);
  const editable = table.columns.filter((c) => !fixed.has(c.name) && c.type !== 'ref' && c.type !== 'user');
  const field = editable.find((c) => c.name === pick) || null;
  const go = async (op: Record<string, unknown>, after: () => void) => {
    setBusy(true);
    setErr(null);
    const why = await editFromCanvas(app, op, 'Data page');
    setBusy(false);
    if (why) setErr(why);
    else after();
  };
  const off = busy || !!blocked;
  return (
    <div className="field-edit pad" role="group" aria-label={'Edit the fields of ' + table.label}>
      <div className="row wrap">
        <strong className="t-cap">Add a field</strong>
        <Input
          className="input sm"
          aria-label="New field name"
          placeholder="Name, for example Notes"
          value={name}
          disabled={off}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Select
          native
          className="select sm"
          aria-label="New field type"
          value={type}
          disabled={off}
          onChange={(e) => setType(e.currentTarget.value)}
        >
          {EDIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        {type === 'select' && (
          <Input
            className="input sm"
            aria-label="Choices, separated by commas"
            placeholder="Choices: low, medium, high"
            value={options}
            disabled={off}
            onChange={(e) => setOptions(e.currentTarget.value)}
          />
        )}
        <Btn
          className="btn sm primary"
          disabled={off || !name.trim()}
          onClick={() =>
            go(
              {
                op: 'add_field',
                table: table.name,
                name: name.trim(),
                type,
                options:
                  type === 'select'
                    ? options
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean)
                    : undefined,
              },
              () => {
                setName('');
                setOptions('');
              },
            )
          }
        >
          <Icon n="add" s="16" />
          Add field
        </Btn>
      </div>
      <div className="row wrap">
        <strong className="t-cap">Change a field</strong>
        <Select
          native
          className="select sm"
          aria-label="Field to change"
          value={pick}
          disabled={off}
          onChange={(e) => setPick(e.currentTarget.value)}
        >
          <option value="">Pick a field</option>
          {editable.map((c) => (
            <option key={c.name} value={c.name}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          className="input sm"
          aria-label="New name for the field"
          placeholder="New name"
          value={to}
          disabled={off || !field}
          onChange={(e) => setTo(e.currentTarget.value)}
        />
        <Btn
          className="btn sm"
          disabled={off || !field || !to.trim()}
          onClick={() =>
            field && go({ op: 'rename_field', table: table.name, name: field.name, to: to.trim() }, () => (setTo(''), setPick('')))
          }
        >
          Rename
        </Btn>
        <Btn
          className="btn sm"
          disabled={off || !field}
          onClick={() => field && go({ op: 'remove_field', table: table.name, name: field.name }, () => setPick(''))}
        >
          Remove
        </Btn>
      </div>
      <p className="t-cap muted">
        {blocked ||
          'Your edit goes to the builders like a message in the chat: they show the plan, ask before deleting stored values, and run again only the stations the edit touches.'}
      </p>
      {err && <MBar tone="danger">{err}</MBar>}
    </div>
  );
}
export function DataView({ app }: { app: AppRecord }) {
  if (!dbExists(app.id) || !app.def.tables.length)
    return <Empty icon="database" title="No database yet" text="The List builder creates the SQLite tables at the second station." />;
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
          <DemoActions app={app} />
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
            <>
              {tdef && <FieldEditor app={app as AppRecord & { def: BackedDef }} table={tdef} />}
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
            </>
          ) : D.tab === 'ddl' ? (
            <pre className="code pad">{cur.sql};</pre>
          ) : (
            <div className="console pad">
              <p className="muted t-cap">
                Runs on the real SQLite file in this browser. Writes are kept, so use Start over to undo experiments.
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
      <Empty icon="server" title="No endpoints yet" text="The Rules builder writes the workflow and access rules at the third station." />
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
          {cur.kind === 'MCP server' && SERVER_CONNECTORS.includes(cur.id)
            ? 'An MCP server. Test on the search tool calls it for real through Turnkey’s own server route; the fetch tool shows a labelled sample.'
            : cur.kind === 'MCP server'
              ? 'An MCP server you added. Turnkey has no server client for it, so Test shows a labelled sample.'
              : SERVER_CONNECTORS.includes(cur.id)
                ? 'Test calls it for real through Turnkey’s own server route, so no key ever reaches the browser.'
                : 'Turnkey has no server client for it yet, so Test shows a labelled sample.'}
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
              {out.busy ? (
                <span className="badge b-info">Calling…</span>
              ) : out.real ? (
                <span className="badge b-success">Live response</span>
              ) : (
                <Proto>Sample response</Proto>
              )}
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
                Approve and remove
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
      if (c.plan)
        return (
          <Suspense fallback={null}>
            <ChangePlanCard app={app} c={c} />
          </Suspense>
        );
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
    case 'understand':
      return (
        <Suspense fallback={null}>
          <UnderstandBox app={app} c={c} />
        </Suspense>
      );
    case 'tryit':
      return (
        <Suspense fallback={null}>
          <TryItCard app={app} c={c} />
        </Suspense>
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
  const settled = !RUNS[app.id] && !PENDING[app.id];
  // Settling shows the suggestions under the log, which makes it shorter, so scroll again then too.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [n, app.id, answered, settled]);
  // A card can grow after it is first drawn (a part that loads on first use, a list that fills in). While the log is
  // at its end, keep it there, so a new question is not left half hidden under the suggestions.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let atEnd = true;
    const onScroll = () => {
      atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    const ro = new ResizeObserver(() => {
      if (atEnd) el.scrollTop = el.scrollHeight;
    });
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      for (const c of Array.from(el.children)) ro.observe(c);
    };
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true });
    watch();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [app.id]);
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
