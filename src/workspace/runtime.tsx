// @ts-nocheck -- converted from the prototype; types are added module by module
import { BRAND, U, arr, confirmBox, cx, fmtDate, fmtDateTime, fmtNum, label, needNet, notify, online, toast } from './core';
import { DBX, dbExists } from './db';
import { accOf, apiCall, appUsers, colOf, roleName, tableOf, tourExec } from './engine';
import { REC, allConnectors, callConnector, connOn } from './builds';
import { TeamConsole } from './room';
import { resetAppData } from './line';
import { Avatar, Btn, Empty, Field, Icon, Input, MBar, Menu, Proto, Select, Switch, Textarea } from './ui';
import { AppSheets, AppTabs, isCompact, useElWidth } from './mobile';
import { Explorer } from './views-a';
import { Dash } from './views-b';
import { AppLogo } from './release';

/* ===== Turnkey prototype · runtime: draws a built app from its definition =====
   Nothing here is specific to one app. Tables, columns, roles, workflow, screens and layout all come from
   the definition the agents wrote, and every read or write goes through apiCall (the role-guarded backend). */
export const APICACHE = new Map();
export function fetchApi(app, user, path, body, src) {
  const key = app.id + '|' + user.id + '|' + path + '|' + (body ? JSON.stringify(body) : '') + '|' + (DBX.ver[app.id] || 0) + '|' + app.rev;
  if (APICACHE.has(key)) return APICACHE.get(key);
  if (APICACHE.size > 600) APICACHE.clear();
  const res = apiCall(app, user, 'GET', path, body, src || 'app');
  APICACHE.set(key, res);
  return res;
}
export const userName = (app, id) => {
  const u = appUsers(app).find((x) => x.id === id);
  return u ? u.name : id == null ? '' : 'User #' + id;
};
export const isStatusCol = (def, t, c) => !!(def.process && def.process.table === t.name && def.process.column === c.name);
export const optLabel = (c, v) => (c && c.labels && c.labels[v]) || label(v); // a choice may carry its own wording (PatentsView, arXiv)
export const stateLabel = (def, t, c, v) => {
  if (isStatusCol(def, t, c)) {
    const s = def.process.states.find((x) => x.id === v);
    if (s) return s.label;
  }
  return optLabel(c, v);
};
export const stateTone = (def, t, c, v) => {
  if (isStatusCol(def, t, c)) {
    const s = def.process.states.find((x) => x.id === v);
    if (s) return s.tone;
  }
  return 'neutral';
};
export function cellText(app, user, t, c, v, depth) {
  if (v == null || v === '' || !c) return '';
  switch (c.type) {
    case 'date':
      return fmtDate(v);
    case 'datetime':
      return fmtDateTime(v);
    case 'bool':
      return v ? 'Yes' : 'No';
    case 'money':
    case 'number':
      return fmtNum(v);
    case 'select':
      return stateLabel(app.def, t, c, v);
    case 'user':
      return userName(app, v);
    case 'ref': {
      const rt = tableOf(app.def, c.ref);
      if (!rt) return '#' + v;
      if ((depth || 0) > 1) return rt.one + ' #' + v;
      const res = fetchApi(app, user, '/api/' + c.ref),
        row = res.status === 200 ? res.data.find((r) => r.id === v) : null;
      return row ? cellText(app, user, rt, colOf(rt, rt.title), row[rt.title], (depth || 0) + 1) || rt.one + ' #' + v : rt.one + ' #' + v;
    }
    default:
      return String(v);
  }
}
export const rowTitle = (app, user, t, row, col?) =>
  cellText(app, user, t, colOf(t, col || t.title), row[col || t.title], 0) || t.one + ' #' + row.id;
export function Cell({ app, user, t, c, v }) {
  if (v == null || v === '') return <span className="muted">–</span>;
  if (c.type === 'select')
    return (
      <span className={cx('badge', isStatusCol(app.def, t, c) ? 'b-' + stateTone(app.def, t, c, v) : 'b-outline')}>
        {stateLabel(app.def, t, c, v)}
      </span>
    );
  if (c.type === 'user')
    return (
      <span className="who">
        <Avatar name={userName(app, v)} size="xs" />
        <span>{userName(app, v)}</span>
      </span>
    );
  return cellText(app, user, t, c, v, 0);
}
export const newPane = (n) => ({
  n,
  uid: null,
  screen: null,
  rec: null,
  form: null,
  forms: {},
  vs: {},
  ds: null,
  tf: null,
  login: null,
  conn: null,
});
export function stageOf(app) {
  return (
    U.stage[app.id] ||
    (U.stage[app.id] = {
      split: false,
      panes: [newPane(0), newPane(1)],
      tour: null,
    })
  );
}
export function AppPane({ app, pane, solo }) {
  const box = useElWidth(),
    compact = !pane.test && isCompact(box[1]);
  const def = app.def,
    users = appUsers(app),
    user = users.find((u) => u.id === pane.uid);
  if (!def.screens.length || !users.length)
    return (
      <div className="app-empty">
        <Empty icon="layout" title="No screens yet" text="The app appears here when the UI agent has assembled its screens." />
      </div>
    );
  if (!user) return <AppLogin app={app} pane={pane} users={users} solo={solo} />;
  const screens = def.screens.filter((s) => s.roles.includes(user.role)),
    scr = screens.find((s) => s.id === pane.screen) || screens[0];
  const go = (id) => {
      pane.screen = id;
      pane.rec = null;
      pane.form = null;
      pane.sheet = null;
      notify();
    },
    th = def.theme,
    navKind = ['top', 'rail'].includes(th.nav) ? th.nav : 'side';
  const swap = (u) => {
    pane.uid = u ? u.id : null;
    pane.screen = null;
    pane.rec = null;
    pane.form = null;
    pane.sheet = null;
    notify();
  };
  const nav = (cls) => (
    <nav className={'app-nav ' + cls} aria-label="Screens">
      {screens.map((s) => (
        <button
          key={s.id}
          className={cx('nav-i', scr && s.id === scr.id && 'on')}
          aria-current={scr && s.id === scr.id ? 'page' : undefined}
          title={s.name}
          onClick={() => go(s.id)}
        >
          <Icon n={s.icon} s={cls === 'rail' ? '20' : '16'} />
          <span>{s.name}</span>
        </button>
      ))}
    </nav>
  );
  const items = [
    {
      head: true,
      label: 'Switch user',
    },
  ].concat(
    users.map((u) => ({
      label: u.name,
      hint: roleName(def, u.role),
      check: u.id === user.id,
      on: () => swap(u),
    })),
    [
      '-',
      {
        label: 'Sign out',
        icon: 'signOut',
        on: () => swap(null),
      },
    ],
    solo && solo.length ? ['-'].concat(solo) : [],
  );
  return (
    <div
      className={cx('app', 'acc-' + th.accent, 'nav-' + navKind, th.density === 'compact' && 'dense', compact && 'compact')}
      ref={box[0]}
    >
      <header className="app-head">
        <span className="app-logo">
          <Icon n={def.theme.icon} />
        </span>
        <strong className="app-name ellipsis">{compact && scr ? scr.name : app.name}</strong>
        {!compact && navKind === 'top' ? nav('top') : <span className="grow" />}
        {compact ? (
          <button
            className="persona"
            aria-haspopup="dialog"
            aria-label={'Signed in as ' + user.name + '. People and account'}
            onClick={() => {
              pane.sheet = 'me';
              notify();
            }}
          >
            <Avatar name={user.name} size="sm" />
          </button>
        ) : (
          <Menu
            align="right"
            title="Switch user or sign out"
            btn={{
              cls: 'persona',
              label: 'Signed in as ' + user.name,
              body: (
                <>
                  <Avatar name={user.name} size="sm" />
                  <span className="col gap0 persona-t">
                    <span className="t-strong ellipsis">{user.name}</span>
                    <span className="t-cap muted">{roleName(def, user.role)}</span>
                  </span>
                  <Icon n="chevDown" s="16" />
                </>
              ),
            }}
            items={items}
          />
        )}
      </header>
      <div className="app-body">
        {!compact && navKind !== 'top' && nav(navKind)}
        <main className="app-main">
          {scr ? (
            <Screen key={scr.id + ':' + user.id} app={app} user={user} pane={pane} scr={scr} />
          ) : (
            <Empty icon="lock" title="Nothing to open" text={roleName(def, user.role) + ' has no screens.'} />
          )}
        </main>
        {pane.rec && <RecordDrawer app={app} user={user} pane={pane} compact={compact} />}
      </div>
      {compact && <AppTabs screens={screens} scr={scr} pane={pane} go={go} />}
      {pane.form && <RecordForm app={app} user={user} pane={pane} />}
      {compact && pane.sheet && (
        <AppSheets app={app} pane={pane} user={user} users={users} screens={screens} scr={scr} go={go} swap={swap} solo={solo} />
      )}
    </div>
  );
}
export function AppLogin({ app, pane, users, solo }) {
  const def = app.def,
    f =
      pane.login ||
      (pane.login = {
        u: '',
        p: '',
        err: '',
      });
  const login = (u, p) => {
    const r = apiCall(
      app,
      null,
      'POST',
      '/api/login',
      {
        username: u,
        password: p,
      },
      'app',
    );
    if (r.status === 200) {
      pane.uid = r.data.id;
      pane.screen = null;
      pane.login = null;
    } else f.err = r.error;
    notify();
  };
  return (
    <div className={cx('app app-login', 'acc-' + def.theme.accent)}>
      <div className="login-card">
        <AppLogo app={app} size={64} />
        <h2 className="t-sub1">
          {'Sign in to '}
          {app.name}
        </h2>
        <p className="muted">
          {'These users were seeded by the Database agent. Every password is '}
          <code>demo</code>.
        </p>
        <div className="persona-grid">
          {users.map((u) => (
            <button key={u.id} className="persona-btn" onClick={() => login(u.username, 'demo')}>
              <Avatar name={u.name} />
              <span className="col gap0">
                <span className="t-strong">{u.name}</span>
                <span className="t-cap muted">
                  {roleName(def, u.role)}
                  {' · '}
                  {u.username}
                </span>
              </span>
            </button>
          ))}
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            login(f.u, f.p);
          }}
        >
          <Input
            native
            className="input"
            id={'lu' + app.id + pane.n}
            aria-label="Username"
            placeholder="Username"
            autoComplete="off"
            value={f.u}
            onInput={(e) => {
              f.u = e.target.value;
            }}
          />
          <Input
            native
            className="input"
            id={'lp' + app.id + pane.n}
            aria-label="Password"
            type="password"
            placeholder="Password"
            autoComplete="off"
            value={f.p}
            onInput={(e) => {
              f.p = e.target.value;
            }}
          />
          <Btn className="btn primary" type="submit">
            Sign in
          </Btn>
        </form>
        {f.err && <MBar tone="danger">{f.err}</MBar>}
        {solo && solo.length > 0 && (
          <div className="login-foot">
            <span className="t-cap muted">
              {'Built with '}
              {BRAND.name}
            </span>
            <span className="grow" />
            {solo
              .filter((it) => it !== '-' && (it.icon === 'info' || it.icon === 'arrowLeft'))
              .map((it, i) => (
                <Btn key={i} type="button" className="btn subtle sm" onClick={it.on}>
                  {it.label}
                </Btn>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
export function Screen({ app, user, pane, scr }) {
  // a page is a dashboard, a form, the agents console, or one table opened in its default view
  if (scr.type === 'dashboard') return <Dash app={app} user={user} pane={pane} scr={scr} />;
  if (scr.type === 'form') return <FormScreen app={app} user={user} pane={pane} scr={scr} />;
  if (scr.type === 'agents') return <TeamConsole app={app} user={user} pane={pane} scr={scr} />;
  return <Explorer app={app} user={user} pane={pane} scr={scr} />;
}
export function formCols(app, user, t, isNew) {
  const def = app.def,
    acc = accOf(def, user.role, t.name);
  return t.columns.filter((c) => !isStatusCol(def, t, c) && !(isNew && t.owner === c.name && acc.list === 'own'));
}
export function FieldInput({ app, user, c, f, idp }) {
  const def = app.def,
    id = idp + c.name,
    v = f.vals[c.name],
    set = (x) => {
      f.vals[c.name] = x;
      if (f.errs) delete f.errs[c.name];
      notify();
    };
  let ctl;
  if (c.type === 'longtext')
    ctl = <Textarea native className="textarea" id={id} rows="3" value={v || ''} onInput={(e) => set(e.target.value)} />;
  else if (c.type === 'bool') ctl = <Switch id={id} on={!!v} onChange={(x) => set(x ? 1 : 0)} text={v ? 'Yes' : 'No'} />;
  else if (c.type === 'select')
    ctl = (
      <Select native className="select" id={id} value={v || ''} onChange={(e) => set(e.target.value || null)}>
        <option value="">{c.required ? 'Choose…' : 'None'}</option>
        {c.options.map((o) => (
          <option key={o} value={o}>
            {optLabel(c, o)}
          </option>
        ))}
      </Select>
    );
  else if (c.type === 'user')
    ctl = (
      <Select
        native
        className="select"
        id={id}
        value={v == null ? '' : String(v)}
        onChange={(e) => set(e.target.value ? +e.target.value : null)}
      >
        <option value="">{c.required ? 'Choose…' : 'Nobody'}</option>
        {appUsers(app)
          .filter((u) => !c.role || u.role === c.role)
          .map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.name}
              {c.role ? '' : ' · ' + roleName(def, u.role)}
            </option>
          ))}
      </Select>
    );
  else if (c.type === 'ref') {
    const rt = tableOf(def, c.ref),
      res = fetchApi(app, user, '/api/' + c.ref);
    ctl =
      res.status === 200 ? (
        <Select
          native
          className="select"
          id={id}
          value={v == null ? '' : String(v)}
          onChange={(e) => set(e.target.value ? +e.target.value : null)}
        >
          <option value="">{c.required ? 'Choose…' : 'None'}</option>
          {res.data.map((r) => (
            <option key={r.id} value={String(r.id)}>
              {rowTitle(app, user, rt, r)}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          native
          className="input"
          id={id}
          type="number"
          min="1"
          placeholder={rt.one + ' number'}
          value={v == null ? '' : v}
          onInput={(e) => set(e.target.value || null)}
        />
      );
  } else
    ctl = (
      <Input
        native
        className="input"
        id={id}
        type={
          c.type === 'date'
            ? 'date'
            : c.type === 'datetime'
              ? 'datetime-local'
              : c.type === 'number' || c.type === 'money'
                ? 'number'
                : 'text'
        }
        step={c.type === 'money' ? '0.01' : c.type === 'number' ? 'any' : undefined}
        value={v == null ? '' : v}
        onInput={(e) => set(e.target.value === '' ? null : e.target.value)}
      />
    );
  return (
    <Field id={id} label={c.label + (c.required ? ' *' : '')} error={f.errs && f.errs[c.name]} cls={c.type === 'longtext' ? 'wide' : ''}>
      {ctl}
    </Field>
  );
}
export function saveForm(app, user, t, f, cols) {
  const body = {};
  cols.forEach((c) => {
    const v = f.vals[c.name];
    body[c.name] = v === undefined ? null : v;
  });
  const r = f.id
    ? apiCall(app, user, 'PATCH', '/api/' + t.name + '/' + f.id, body, 'app')
    : apiCall(app, user, 'POST', '/api/' + t.name, body, 'app');
  if (r.status === 200 || r.status === 201) {
    f.errs = {};
    f.err = '';
    return r.data;
  }
  f.errs = r.fields || {};
  f.err = r.status + ' ' + r.error;
  return null;
}
export function RecordForm({ app, user, pane }) {
  const f = pane.form,
    t = tableOf(app.def, f.table),
    cols = formCols(app, user, t, !f.id),
    close = () => {
      pane.form = null;
      notify();
    };
  const save = (e) => {
    e.preventDefault();
    const row = saveForm(app, user, t, f, cols);
    if (row) {
      toast(t.one + (f.id ? ' saved' : ' created'), 'success');
      pane.form = null;
      pane.rec = {
        table: t.name,
        id: row.id,
      };
    }
    notify();
  };
  return (
    <div
      className="app-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <form
        className="app-dialog"
        onSubmit={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <div className="dhead">
          <h2 className="t-sub1 grow">{f.id ? 'Edit ' + t.one.toLowerCase() : 'New ' + t.one.toLowerCase()}</h2>
          <Btn type="button" className="btn subtle icon" aria-label="Close" onClick={close}>
            <Icon n="dismiss" />
          </Btn>
        </div>
        <div className="dbody">
          <div className="form-grid">
            {cols.map((c) => (
              <FieldInput key={c.name} app={app} user={user} c={c} f={f} idp={'f' + pane.n + '_'} />
            ))}
          </div>
          {f.err && <MBar tone="danger">{f.err}</MBar>}
        </div>
        <div className="dfoot">
          <Btn type="button" className="btn" onClick={close}>
            Cancel
          </Btn>
          <Btn type="submit" className="btn primary">
            {f.id ? 'Save' : 'Create'}
          </Btn>
        </div>
      </form>
    </div>
  );
}
export function FormScreen({ app, user, pane, scr }) {
  const t = tableOf(app.def, scr.table),
    forms = pane.forms || (pane.forms = {}),
    f =
      forms[scr.id] ||
      (forms[scr.id] = {
        table: t.name,
        id: null,
        vals: {},
        errs: {},
        done: null,
      }),
    cols = formCols(app, user, t, true);
  const save = (e) => {
    e.preventDefault();
    const row = saveForm(app, user, t, f, cols);
    if (row) {
      f.done = row.id;
      f.vals = {};
      toast(t.one + ' created', 'success');
    }
    notify();
  };
  return (
    <div className="scr">
      <div className="scr-head">
        <div className="col gap0 grow">
          <h2 className="t-sub1">{scr.name}</h2>
          <span className="t-cap muted">
            {'Creates one '}
            {t.one.toLowerCase()}. Fields marked * are required.
          </span>
        </div>
      </div>
      <form className="form-page" onSubmit={save}>
        {f.done && (
          <MBar
            tone="success"
            action={
              <Btn
                type="button"
                className="btn sm"
                onClick={() => {
                  pane.rec = {
                    table: t.name,
                    id: f.done,
                  };
                  notify();
                }}
              >
                Open it
              </Btn>
            }
          >
            {t.one}
            {' #'}
            {f.done}
            {' was created.'}
          </MBar>
        )}
        <div className="form-grid">
          {cols.map((c) => (
            <FieldInput key={c.name} app={app} user={user} c={c} f={f} idp={'p' + pane.n + scr.id + '_'} />
          ))}
        </div>
        {f.err && <MBar tone="danger">{f.err}</MBar>}
        <div className="row">
          <Btn className="btn primary" type="submit">
            {'Create '}
            {t.one.toLowerCase()}
          </Btn>
        </div>
      </form>
    </div>
  );
}
export function RecordDrawer({ app, user, pane, compact }) {
  const def = app.def,
    t = tableOf(def, pane.rec.table),
    close = () => {
      pane.rec = null;
      pane.conn = null;
      notify();
    };
  if (!t) return null;
  const res = fetchApi(app, user, '/api/' + t.name + '/' + pane.rec.id);
  const back = compact ? (
      <Btn className="btn subtle icon" aria-label="Back" onClick={close}>
        <Icon n="arrowLeft" />
      </Btn>
    ) : null,
    shut = compact ? null : (
      <Btn className="btn subtle icon" aria-label="Close" onClick={close}>
        <Icon n="dismiss" />
      </Btn>
    );
  if (res.status !== 200)
    return (
      <aside className="drawer">
        <div className="drawer-head">
          {back}
          <strong className="grow">{t.one}</strong>
          {shut}
        </div>
        <div className="drawer-body">
          <MBar tone="warning">
            {res.status === 404
              ? user.name + ' cannot open this ' + t.one.toLowerCase() + ', or it no longer exists.'
              : res.status + ' ' + res.error}
          </MBar>
        </div>
      </aside>
    );
  const row = res.data,
    acc = accOf(def, user.role, t.name),
    P = def.process && def.process.table === t.name ? def.process : null,
    sc = P ? colOf(t, P.column) : null;
  const trs = P ? P.transitions.filter((x) => x.roles.includes(user.role) && x.from.includes(row[P.column])) : [];
  const act = (tr) => {
    const r = apiCall(app, user, 'POST', '/api/' + t.name + '/' + row.id + '/' + tr.id, {}, 'app');
    toast(
      r.status === 200 ? tr.label + ': now ' + label(r.data[P.column]).toLowerCase() : r.status + ' ' + r.error,
      r.status === 200 ? 'success' : 'danger',
    );
    notify();
  };
  const del = async () => {
    if (
      !(await confirmBox({
        title: 'Delete this ' + t.one.toLowerCase() + '?',
        body: 'It is removed from the database. Reset data brings the seed rows back.',
        yes: 'Delete',
        danger: true,
      }))
    )
      return;
    const r = apiCall(app, user, 'DELETE', '/api/' + t.name + '/' + row.id, {}, 'app');
    if (r.status === 200) {
      toast(t.one + ' deleted', 'success');
      pane.rec = null;
    } else toast(r.status + ' ' + r.error, 'danger');
    notify();
  };
  const canEdit = acc.update === 'all' || (acc.update === 'own' && row[t.owner || 'created_by'] === user.id);
  const edit = () => {
    const vals = {};
    t.columns.forEach((c) => {
      vals[c.name] = row[c.name];
    });
    pane.form = {
      table: t.name,
      id: row.id,
      vals,
      errs: {},
    };
    notify();
  };
  const kids = def.tables.filter(
    (k) =>
      k.name !== t.name && k.columns.some((c) => c.type === 'ref' && c.ref === t.name) && accOf(def, user.role, k.name).list !== 'none',
  );
  const log = fetchApi(app, user, '/api/' + t.name + '/' + row.id + '/activity'),
    out = pane.conn && pane.conn.row === row.id ? pane.conn : null;
  const runAction = (a) => {
    const c = allConnectors().find((x) => x.id === a.connector) || {
      name: a.connector,
    };
    if (!connOn(a.connector)) return toast(c.name + ' is switched off under Connections.', 'warning');
    if (!needNet(a.label)) return;
    pane.conn = {
      row: row.id,
      name: c.name,
      label: a.label,
      res: callConnector(app, 'ui', null, a.connector, a.tool, {
        query: String(row[a.arg] || ''),
      }),
    };
    notify();
  };
  return (
    <aside className="drawer" aria-label={t.one + ' details'}>
      <div className="drawer-head">
        {back}
        <div className="col gap0 grow">
          <span className="t-cap muted">
            {t.one}
            {' #'}
            {row.id}
          </span>
          <strong className="t-sub2">{rowTitle(app, user, t, row)}</strong>
        </div>
        {shut}
      </div>
      <div className="drawer-body">
        {P && (
          <div className="row wrap">
            <span className={'badge b-' + stateTone(def, t, sc, row[P.column])}>{stateLabel(def, t, sc, row[P.column])}</span>
            {trs.map((x, i) => (
              <Btn key={x.id} className={cx('btn sm', i === 0 && 'primary')} onClick={() => act(x)}>
                {x.label}
              </Btn>
            ))}
            {!trs.length && (
              <span className="t-cap muted">
                {'No workflow action for a '}
                {roleName(def, user.role).toLowerCase()}
                {' at this status'}
              </span>
            )}
          </div>
        )}
        <dl className="fields">
          {t.columns
            .filter((c) => !isStatusCol(def, t, c))
            .map((c) => (
              <div key={c.name} className={cx('f', c.type === 'longtext' && 'wide')}>
                <dt>{c.label}</dt>
                <dd>
                  <Cell app={app} user={user} t={t} c={c} v={row[c.name]} />
                </dd>
              </div>
            ))}
        </dl>
        {(canEdit || acc.delete || def.actions.some((a) => a.table === t.name)) && (
          <div className="row wrap">
            {canEdit && (
              <Btn className="btn sm" onClick={edit}>
                <Icon n="edit" s="16" />
                Edit
              </Btn>
            )}
            {acc.delete && (
              <Btn className="btn sm" onClick={del}>
                <Icon n="trash" s="16" />
                Delete
              </Btn>
            )}
            {def.actions
              .filter((a) => a.table === t.name)
              .map((a) => (
                <Btn
                  key={a.id}
                  className="btn sm"
                  disabled={!online()}
                  title={online() ? 'Calls the ' + a.connector + ' connection' : 'Needs internet'}
                  onClick={() => runAction(a)}
                >
                  <Icon n="plug" s="16" />
                  {a.label}
                </Btn>
              ))}
          </div>
        )}
        {out && (
          <section className="conn-out">
            <div className="row between">
              <h3 className="sec-h">
                {out.label}
                {' · '}
                {out.name}
              </h3>
              <Proto>Sample response</Proto>
            </div>
            {out.res.ok ? (
              <ul className="rel">
                {arr(out.res.result.results).map((x, i) => (
                  <li key={i}>
                    <a className="rel-i" href={x.url} target="_blank" rel="noopener noreferrer">
                      <span className="col gap0 grow">
                        <span className="t-strong">{x.title}</span>
                        <span className="t-cap muted">{x.excerpt}</span>
                      </span>
                      <Icon n="open" s="16" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <MBar tone="warning">{out.res.result.error}</MBar>
            )}
          </section>
        )}
        {kids.map((k) => (
          <Related key={k.name} app={app} user={user} pane={pane} t={t} k={k} row={row} />
        ))}
        <section>
          <h3 className="sec-h">Activity</h3>
          {log.status === 200 && log.data.length ? (
            <ul className="act">
              {log.data.map((a) => (
                <li key={a.id}>
                  <span className="t-strong">{a.who || 'Someone'}</span> {a.action}
                  {a.detail ? ' · ' + a.detail : ''}
                  <span className="muted t-cap">
                    {' · '}
                    {fmtDateTime(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted t-cap">Nothing since it was created{row.created_at ? ' on ' + fmtDate(row.created_at) : ''}.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
export function Related({ app, user, pane, t, k, row }) {
  const def = app.def,
    c = k.columns.find((x) => x.type === 'ref' && x.ref === t.name),
    res = fetchApi(app, user, '/api/' + k.name, {
      filter: {
        [c.name]: row.id,
      },
    }),
    P = def.process && def.process.table === k.name ? def.process : null;
  if (res.status !== 200) return null;
  return (
    <section>
      <div className="row between">
        <h3 className="sec-h">
          {k.label}
          {' ('}
          {res.data.length})
        </h3>
        {accOf(def, user.role, k.name).create && (
          <Btn
            className="btn subtle sm"
            onClick={() => {
              pane.form = {
                table: k.name,
                id: null,
                vals: {
                  [c.name]: row.id,
                },
                errs: {},
              };
              notify();
            }}
          >
            <Icon n="add" s="16" />
            Add
          </Btn>
        )}
      </div>
      {res.data.length ? (
        <ul className="rel">
          {res.data.slice(0, 6).map((r) => (
            <li key={r.id}>
              <button
                className="rel-i"
                onClick={() => {
                  pane.rec = {
                    table: k.name,
                    id: r.id,
                  };
                  pane.conn = null;
                  notify();
                }}
              >
                <span className="ellipsis grow">{rowTitle(app, user, k, r)}</span>
                {P && (
                  <span className={'badge b-' + stateTone(def, k, colOf(k, P.column), r[P.column])}>
                    {stateLabel(def, k, colOf(k, P.column), r[P.column])}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted t-cap">None yet.</p>
      )}
    </section>
  );
}

/* ---------- the stage: the built app, as one or two users, with the walkthrough player ---------- */
export function startWalk(app) {
  const st = stageOf(app);
  st.tour = {
    i: 0,
    res: [],
    state: {
      rows: {},
      last: null,
    },
  };
  st.panes[0].form = null;
  U.view[app.id] = 'app';
  notify();
}
export function StageView({ app }) {
  const st = stageOf(app),
    def = app.def,
    ready = def.screens.length > 0 && dbExists(app.id);
  if (!ready)
    return (
      <div className="stage" data-tour="stage">
        <Empty
          icon="layout"
          title="The app is not built yet"
          text="When the Screens station has passed its checks, the working app appears here."
        />
      </div>
    );
  const users = appUsers(app),
    p0 = st.panes[0];
  const setUser = (pane, id) => {
    pane.uid = id;
    pane.screen = null;
    pane.rec = null;
    pane.form = null;
    notify();
  };
  const split = () => {
    st.split = !st.split;
    if (st.split && st.panes[1].uid == null) {
      const cur = users.find((u) => u.id === p0.uid),
        other = users.find((u) => !cur || u.role !== cur.role);
      if (!cur && users[0]) p0.uid = users[0].id;
      st.panes[1].uid = other ? other.id : null;
    }
    notify();
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
  return (
    <div className="stage" data-tour="stage">
      <div className="stage-bar">
        <label className="t-cap muted hide-sm" htmlFor={'pv' + app.id}>
          Preview as
        </label>
        <Select
          native
          className="select sm"
          id={'pv' + app.id}
          aria-label="Preview as"
          value={p0.uid == null ? '' : String(p0.uid)}
          onChange={(e) => setUser(p0, e.target.value ? +e.target.value : null)}
        >
          <option value="">Sign-in screen</option>
          {users.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.name}
              {' · '}
              {roleName(def, u.role)}
            </option>
          ))}
        </Select>
        <Btn
          className={cx('btn sm', st.split && 'on')}
          aria-pressed={st.split}
          title="Open the app twice, as two different users, to see the access rules side by side"
          onClick={split}
        >
          <Icon n="split" s="16" />
          <span className="hide-sm">Two users</span>
        </Btn>
        <span className="grow" />
        {REC[app.tpl] && (
          <span className="hide-sm">
            <Proto>{'Made-up data' + (REC[app.tpl].sampleNote ? '. ' + REC[app.tpl].sampleNote : '')}</Proto>
          </span>
        )}
        <Btn className="btn sm" data-tour="walk" disabled={!def.tour.length} onClick={() => startWalk(app)}>
          <Icon n="playOutline" s="16" />
          <span className="hide-sm">Play walkthrough</span>
        </Btn>
        <Btn className="btn sm" onClick={reset}>
          <Icon n="reset" s="16" />
          <span className="hide-sm">Reset data</span>
        </Btn>
      </div>
      <div className={cx('devices', st.split && 'two')}>
        <div className="device">
          <AppPane app={app} pane={p0} />
        </div>
        {st.split && (
          <div className="device">
            <AppPane app={app} pane={st.panes[1]} />
          </div>
        )}
      </div>
      {st.tour && <WalkPlayer app={app} st={st} />}
    </div>
  );
}
export function WalkPlayer({ app, st }) {
  const T = st.tour,
    steps = app.def.tour,
    step = steps[T.i],
    done = T.i >= steps.length,
    r = T.res[T.i],
    p = st.panes[0];
  const exec = (i) => {
    const x = tourExec(app, T.state, steps[i]);
    T.res[i] = {
      ok: x.ok,
      detail: x.detail,
    };
    if (x.user) {
      p.uid = x.user.id;
      p.form = null;
    }
    if (x.screen) p.screen = x.screen;
    p.rec = x.rec || null;
    p.vs = {};
  };
  const close = () => {
    st.tour = null;
    notify();
  };
  return (
    <div className="walk" role="dialog" aria-label="Walkthrough">
      <div className="row between">
        <strong>Walkthrough</strong>
        <Btn className="btn subtle icon sm" aria-label="Close walkthrough" onClick={close}>
          <Icon n="dismiss" s="16" />
        </Btn>
      </div>
      <div className="walk-dots" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={i} className={cx('dot', i === T.i && 'cur', T.res[i] && (T.res[i].ok ? 'ok' : 'bad'))} />
        ))}
      </div>
      {done ? (
        <>
          <p>
            <strong>
              {T.res.filter((x) => x && x.ok).length}
              {' of '}
              {steps.length}
              {' steps passed.'}
            </strong>
            {
              ' These are the steps the Walkthrough station ran as the acceptance test. Here they made real records, so use Reset data to clear them.'
            }
          </p>
          <div className="row">
            <Btn className="btn primary sm" onClick={close}>
              Done
            </Btn>
            <Btn className="btn sm" onClick={() => startWalk(app)}>
              Play again
            </Btn>
          </div>
        </>
      ) : (
        <>
          <p className="t-cap muted">
            {'Step '}
            {T.i + 1}
            {' of '}
            {steps.length}
            {' · as '}
            {roleName(app.def, step.role)}
          </p>
          <p>{step.say}</p>
          {r && (
            <div className={cx('walk-res', r.ok ? 'ok' : 'bad')}>
              <Icon n={r.ok ? 'checkCircle' : 'errorCircle'} s="16" />
              <span className="mono">{r.detail}</span>
            </div>
          )}
          <div className="row">
            {!r ? (
              <Btn
                className="btn primary sm"
                onClick={() => {
                  exec(T.i);
                  notify();
                }}
              >
                <Icon n="play" s="16" />
                Do it
              </Btn>
            ) : (
              <Btn
                className="btn primary sm"
                onClick={() => {
                  T.i++;
                  notify();
                }}
              >
                {T.i === steps.length - 1 ? 'Finish' : 'Next step'}
              </Btn>
            )}
            <Btn
              className="btn subtle sm"
              onClick={() => {
                for (let i = T.i; i < steps.length; i++) if (!T.res[i]) exec(i);
                T.i = steps.length;
                notify();
              }}
            >
              Run all
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
