/* ===== Turnkey prototype · runtime: draws a built app from its definition =====
   Nothing here is specific to one app. Tables, columns, roles, workflow, screens and layout all come from
   the definition the agents wrote, and every read or write goes through apiCall (the role-guarded backend). */
const APICACHE = new Map();
function fetchApi(app, user, path, body, src) {
  const key = app.id + '|' + user.id + '|' + path + '|' + (body ? JSON.stringify(body) : '') + '|' + (DBX.ver[app.id] || 0) + '|' + app.rev;
  if (APICACHE.has(key)) return APICACHE.get(key);
  if (APICACHE.size > 600) APICACHE.clear();
  const res = apiCall(app, user, 'GET', path, body, src || 'app'); APICACHE.set(key, res); return res;
}
const userName = (app, id) => { const u = appUsers(app).find((x) => x.id === id); return u ? u.name : id == null ? '' : 'User #' + id; };
const isStatusCol = (def, t, c) => !!(def.process && def.process.table === t.name && def.process.column === c.name);
const optLabel = (c, v) => (c && c.labels && c.labels[v]) || label(v); // a choice may carry its own wording (PatentsView, arXiv)
const stateLabel = (def, t, c, v) => { if (isStatusCol(def, t, c)) { const s = def.process.states.find((x) => x.id === v); if (s) return s.label; } return optLabel(c, v); };
const stateTone = (def, t, c, v) => { if (isStatusCol(def, t, c)) { const s = def.process.states.find((x) => x.id === v); if (s) return s.tone; } return 'neutral'; };
function cellText(app, user, t, c, v, depth) {
  if (v == null || v === '' || !c) return '';
  switch (c.type) {
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'bool': return v ? 'Yes' : 'No';
    case 'money': case 'number': return fmtNum(v);
    case 'select': return stateLabel(app.def, t, c, v);
    case 'user': return userName(app, v);
    case 'ref': { const rt = tableOf(app.def, c.ref); if (!rt) return '#' + v; if ((depth || 0) > 1) return rt.one + ' #' + v; const res = fetchApi(app, user, '/api/' + c.ref), row = res.status === 200 ? res.data.find((r) => r.id === v) : null; return row ? cellText(app, user, rt, colOf(rt, rt.title), row[rt.title], (depth || 0) + 1) || rt.one + ' #' + v : rt.one + ' #' + v; }
    default: return String(v);
  }
}
const rowTitle = (app, user, t, row, col) => cellText(app, user, t, colOf(t, col || t.title), row[col || t.title], 0) || t.one + ' #' + row.id;
function Cell({ app, user, t, c, v }) {
  if (v == null || v === '') return html`<span class="muted">–</span>`;
  if (c.type === 'select') return html`<span class=${cx('badge', isStatusCol(app.def, t, c) ? 'b-' + stateTone(app.def, t, c, v) : 'b-outline')}>${stateLabel(app.def, t, c, v)}</span>`;
  if (c.type === 'user') return html`<span class="who"><${Avatar} name=${userName(app, v)} size="xs" /><span>${userName(app, v)}</span></span>`;
  return cellText(app, user, t, c, v, 0);
}
const newPane = (n) => ({ n, uid: null, screen: null, rec: null, form: null, forms: {}, vs: {}, ds: null, tf: null, login: null, conn: null });
function stageOf(app) { return U.stage[app.id] || (U.stage[app.id] = { split: false, panes: [newPane(0), newPane(1)], tour: null }); }

function AppPane({ app, pane, solo }) {
  const box = useElWidth(), compact = !pane.test && isCompact(box[1]);
  const def = app.def, users = appUsers(app), user = users.find((u) => u.id === pane.uid);
  if (!def.screens.length || !users.length) return html`<div class="app-empty"><${Empty} icon="layout" title="No screens yet" text="The app appears here when the UI agent has assembled its screens." /></div>`;
  if (!user) return html`<${AppLogin} app=${app} pane=${pane} users=${users} solo=${solo} />`;
  const screens = def.screens.filter((s) => s.roles.includes(user.role)), scr = screens.find((s) => s.id === pane.screen) || screens[0];
  const go = (id) => { pane.screen = id; pane.rec = null; pane.form = null; pane.sheet = null; notify(); }, th = def.theme, navKind = ['top', 'rail'].includes(th.nav) ? th.nav : 'side';
  const swap = (u) => { pane.uid = u ? u.id : null; pane.screen = null; pane.rec = null; pane.form = null; pane.sheet = null; notify(); };
  const nav = (cls) => html`<nav class=${'app-nav ' + cls} aria-label="Screens">${screens.map((s) => html`<button key=${s.id} class=${cx('nav-i', scr && s.id === scr.id && 'on')} aria-current=${scr && s.id === scr.id ? 'page' : undefined} title=${s.name} onClick=${() => go(s.id)}><${Icon} n=${s.icon} s=${cls === 'rail' ? '20' : '16'} /><span>${s.name}</span></button>`)}</nav>`;
  const items = [{ head: true, label: 'Switch user' }].concat(users.map((u) => ({ label: u.name, hint: roleName(def, u.role), check: u.id === user.id, on: () => swap(u) })), ['-', { label: 'Sign out', icon: 'signOut', on: () => swap(null) }], solo && solo.length ? ['-'].concat(solo) : []);
  return html`<div class=${cx('app', 'acc-' + th.accent, 'nav-' + navKind, th.density === 'compact' && 'dense', compact && 'compact')} ref=${box[0]}>
    <header class="app-head">
      <span class="app-logo"><${Icon} n=${def.theme.icon} /></span><strong class="app-name ellipsis">${compact && scr ? scr.name : app.name}</strong>
      ${!compact && navKind === 'top' ? nav('top') : html`<span class="grow"></span>`}
      ${compact ? html`<button class="persona" aria-haspopup="dialog" aria-label=${'Signed in as ' + user.name + '. People and account'} onClick=${() => { pane.sheet = 'me'; notify(); }}><${Avatar} name=${user.name} size="sm" /></button>`
        : html`<${Menu} align="right" title="Switch user or sign out" btn=${{ cls: 'persona', label: 'Signed in as ' + user.name, body: html`<${Avatar} name=${user.name} size="sm" /><span class="col gap0 persona-t"><span class="t-strong ellipsis">${user.name}</span><span class="t-cap muted">${roleName(def, user.role)}</span></span><${Icon} n="chevDown" s="16" />` }} items=${items} />`}
    </header>
    <div class="app-body">
      ${!compact && navKind !== 'top' && nav(navKind)}
      <main class="app-main">${scr ? html`<${Screen} key=${scr.id + ':' + user.id} app=${app} user=${user} pane=${pane} scr=${scr} />` : html`<${Empty} icon="lock" title="Nothing to open" text=${roleName(def, user.role) + ' has no screens.'} />`}</main>
      ${pane.rec && html`<${RecordDrawer} app=${app} user=${user} pane=${pane} compact=${compact} />`}
    </div>
    ${compact && html`<${AppTabs} screens=${screens} scr=${scr} pane=${pane} go=${go} />`}
    ${pane.form && html`<${RecordForm} app=${app} user=${user} pane=${pane} />`}
    ${compact && pane.sheet && html`<${AppSheets} app=${app} pane=${pane} user=${user} users=${users} screens=${screens} scr=${scr} go=${go} swap=${swap} solo=${solo} />`}
  </div>`;
}
function AppLogin({ app, pane, users, solo }) {
  const def = app.def, f = pane.login || (pane.login = { u: '', p: '', err: '' });
  const login = (u, p) => { const r = apiCall(app, null, 'POST', '/api/login', { username: u, password: p }, 'app'); if (r.status === 200) { pane.uid = r.data.id; pane.screen = null; pane.login = null; } else f.err = r.error; notify(); };
  return html`<div class=${cx('app app-login', 'acc-' + def.theme.accent)}><div class="login-card">
    <${AppLogo} app=${app} size=${64} />
    <h2 class="t-sub1">Sign in to ${app.name}</h2>
    <p class="muted">These users were seeded by the Database agent. Every password is <code>demo</code>.</p>
    <div class="persona-grid">${users.map((u) => html`<button key=${u.id} class="persona-btn" onClick=${() => login(u.username, 'demo')}><${Avatar} name=${u.name} /><span class="col gap0"><span class="t-strong">${u.name}</span><span class="t-cap muted">${roleName(def, u.role)} · ${u.username}</span></span></button>`)}</div>
    <form class="login-form" onSubmit=${(e) => { e.preventDefault(); login(f.u, f.p); }}>
      <input class="input" id=${'lu' + app.id + pane.n} aria-label="Username" placeholder="Username" autocomplete="off" value=${f.u} onInput=${(e) => { f.u = e.target.value; }} />
      <input class="input" id=${'lp' + app.id + pane.n} aria-label="Password" type="password" placeholder="Password" autocomplete="off" value=${f.p} onInput=${(e) => { f.p = e.target.value; }} />
      <button class="btn primary" type="submit">Sign in</button>
    </form>
    ${f.err && html`<${MBar} tone="danger">${f.err}<//>`}
    ${solo && solo.length > 0 && html`<div class="login-foot"><span class="t-cap muted">Built with ${BRAND.name}</span><span class="grow"></span>${solo.filter((it) => it !== '-' && (it.icon === 'info' || it.icon === 'arrowLeft')).map((it, i) => html`<button key=${i} type="button" class="btn subtle sm" onClick=${it.on}>${it.label}</button>`)}</div>`}
  </div></div>`;
}
function Screen({ app, user, pane, scr }) { // a page is a dashboard, a form, the agents console, or one table opened in its default view
  if (scr.type === 'dashboard') return html`<${Dash} app=${app} user=${user} pane=${pane} scr=${scr} />`;
  if (scr.type === 'form') return html`<${FormScreen} app=${app} user=${user} pane=${pane} scr=${scr} />`;
  if (scr.type === 'agents') return html`<${TeamConsole} app=${app} user=${user} pane=${pane} scr=${scr} />`;
  return html`<${Explorer} app=${app} user=${user} pane=${pane} scr=${scr} />`;
}
function formCols(app, user, t, isNew) { const def = app.def, acc = accOf(def, user.role, t.name); return t.columns.filter((c) => !isStatusCol(def, t, c) && !(isNew && t.owner === c.name && acc.list === 'own')); }
function FieldInput({ app, user, c, f, idp }) {
  const def = app.def, id = idp + c.name, v = f.vals[c.name], set = (x) => { f.vals[c.name] = x; if (f.errs) delete f.errs[c.name]; notify(); };
  let ctl;
  if (c.type === 'longtext') ctl = html`<textarea class="textarea" id=${id} rows="3" value=${v || ''} onInput=${(e) => set(e.target.value)}></textarea>`;
  else if (c.type === 'bool') ctl = html`<${Switch} id=${id} on=${!!v} onChange=${(x) => set(x ? 1 : 0)} text=${v ? 'Yes' : 'No'} />`;
  else if (c.type === 'select') ctl = html`<select class="select" id=${id} value=${v || ''} onChange=${(e) => set(e.target.value || null)}><option value="">${c.required ? 'Choose…' : 'None'}</option>${c.options.map((o) => html`<option key=${o} value=${o}>${optLabel(c, o)}</option>`)}</select>`;
  else if (c.type === 'user') ctl = html`<select class="select" id=${id} value=${v == null ? '' : String(v)} onChange=${(e) => set(e.target.value ? +e.target.value : null)}><option value="">${c.required ? 'Choose…' : 'Nobody'}</option>${appUsers(app).filter((u) => !c.role || u.role === c.role).map((u) => html`<option key=${u.id} value=${String(u.id)}>${u.name}${c.role ? '' : ' · ' + roleName(def, u.role)}</option>`)}</select>`;
  else if (c.type === 'ref') { const rt = tableOf(def, c.ref), res = fetchApi(app, user, '/api/' + c.ref); ctl = res.status === 200 ? html`<select class="select" id=${id} value=${v == null ? '' : String(v)} onChange=${(e) => set(e.target.value ? +e.target.value : null)}><option value="">${c.required ? 'Choose…' : 'None'}</option>${res.data.map((r) => html`<option key=${r.id} value=${String(r.id)}>${rowTitle(app, user, rt, r)}</option>`)}</select>` : html`<input class="input" id=${id} type="number" min="1" placeholder=${rt.one + ' number'} value=${v == null ? '' : v} onInput=${(e) => set(e.target.value || null)} />`; }
  else ctl = html`<input class="input" id=${id} type=${c.type === 'date' ? 'date' : c.type === 'datetime' ? 'datetime-local' : c.type === 'number' || c.type === 'money' ? 'number' : 'text'} step=${c.type === 'money' ? '0.01' : c.type === 'number' ? 'any' : undefined} value=${v == null ? '' : v} onInput=${(e) => set(e.target.value === '' ? null : e.target.value)} />`;
  return html`<${Field} id=${id} label=${c.label + (c.required ? ' *' : '')} error=${f.errs && f.errs[c.name]} cls=${c.type === 'longtext' ? 'wide' : ''}>${ctl}<//>`;
}
function saveForm(app, user, t, f, cols) {
  const body = {}; cols.forEach((c) => { const v = f.vals[c.name]; body[c.name] = v === undefined ? null : v; });
  const r = f.id ? apiCall(app, user, 'PATCH', '/api/' + t.name + '/' + f.id, body, 'app') : apiCall(app, user, 'POST', '/api/' + t.name, body, 'app');
  if (r.status === 200 || r.status === 201) { f.errs = {}; f.err = ''; return r.data; }
  f.errs = r.fields || {}; f.err = r.status + ' ' + r.error; return null;
}
function RecordForm({ app, user, pane }) {
  const f = pane.form, t = tableOf(app.def, f.table), cols = formCols(app, user, t, !f.id), close = () => { pane.form = null; notify(); };
  const save = (e) => { e.preventDefault(); const row = saveForm(app, user, t, f, cols); if (row) { toast(t.one + (f.id ? ' saved' : ' created'), 'success'); pane.form = null; pane.rec = { table: t.name, id: row.id }; } notify(); };
  return html`<div class="app-modal" onMouseDown=${(e) => { if (e.target === e.currentTarget) close(); }}><form class="app-dialog" onSubmit=${save} onKeyDown=${(e) => { if (e.key === 'Escape') close(); }}>
    <div class="dhead"><h2 class="t-sub1 grow">${f.id ? 'Edit ' + t.one.toLowerCase() : 'New ' + t.one.toLowerCase()}</h2><button type="button" class="btn subtle icon" aria-label="Close" onClick=${close}><${Icon} n="dismiss" /></button></div>
    <div class="dbody"><div class="form-grid">${cols.map((c) => html`<${FieldInput} key=${c.name} app=${app} user=${user} c=${c} f=${f} idp=${'f' + pane.n + '_'} />`)}</div>${f.err && html`<${MBar} tone="danger">${f.err}<//>`}</div>
    <div class="dfoot"><button type="button" class="btn" onClick=${close}>Cancel</button><button type="submit" class="btn primary">${f.id ? 'Save' : 'Create'}</button></div>
  </form></div>`;
}
function FormScreen({ app, user, pane, scr }) {
  const t = tableOf(app.def, scr.table), forms = pane.forms || (pane.forms = {}), f = forms[scr.id] || (forms[scr.id] = { table: t.name, id: null, vals: {}, errs: {}, done: null }), cols = formCols(app, user, t, true);
  const save = (e) => { e.preventDefault(); const row = saveForm(app, user, t, f, cols); if (row) { f.done = row.id; f.vals = {}; toast(t.one + ' created', 'success'); } notify(); };
  return html`<div class="scr">
    <div class="scr-head"><div class="col gap0 grow"><h2 class="t-sub1">${scr.name}</h2><span class="t-cap muted">Creates one ${t.one.toLowerCase()}. Fields marked * are required.</span></div></div>
    <form class="form-page" onSubmit=${save}>
      ${f.done && html`<${MBar} tone="success" action=${html`<button type="button" class="btn sm" onClick=${() => { pane.rec = { table: t.name, id: f.done }; notify(); }}>Open it</button>`}>${t.one} #${f.done} was created.<//>`}
      <div class="form-grid">${cols.map((c) => html`<${FieldInput} key=${c.name} app=${app} user=${user} c=${c} f=${f} idp=${'p' + pane.n + scr.id + '_'} />`)}</div>
      ${f.err && html`<${MBar} tone="danger">${f.err}<//>`}
      <div class="row"><button class="btn primary" type="submit">Create ${t.one.toLowerCase()}</button></div>
    </form></div>`;
}
function RecordDrawer({ app, user, pane, compact }) {
  const def = app.def, t = tableOf(def, pane.rec.table), close = () => { pane.rec = null; pane.conn = null; notify(); }; if (!t) return null;
  const res = fetchApi(app, user, '/api/' + t.name + '/' + pane.rec.id);
  const back = compact ? html`<button class="btn subtle icon" aria-label="Back" onClick=${close}><${Icon} n="arrowLeft" /></button>` : null, shut = compact ? null : html`<button class="btn subtle icon" aria-label="Close" onClick=${close}><${Icon} n="dismiss" /></button>`;
  if (res.status !== 200) return html`<aside class="drawer"><div class="drawer-head">${back}<strong class="grow">${t.one}</strong>${shut}</div><div class="drawer-body"><${MBar} tone="warning">${res.status === 404 ? user.name + ' cannot open this ' + t.one.toLowerCase() + ', or it no longer exists.' : res.status + ' ' + res.error}<//></div></aside>`;
  const row = res.data, acc = accOf(def, user.role, t.name), P = def.process && def.process.table === t.name ? def.process : null, sc = P ? colOf(t, P.column) : null;
  const trs = P ? P.transitions.filter((x) => x.roles.includes(user.role) && x.from.includes(row[P.column])) : [];
  const act = (tr) => { const r = apiCall(app, user, 'POST', '/api/' + t.name + '/' + row.id + '/' + tr.id, {}, 'app'); toast(r.status === 200 ? tr.label + ': now ' + label(r.data[P.column]).toLowerCase() : r.status + ' ' + r.error, r.status === 200 ? 'success' : 'danger'); notify(); };
  const del = async () => { if (!(await confirmBox({ title: 'Delete this ' + t.one.toLowerCase() + '?', body: 'It is removed from the database. Reset data brings the seed rows back.', yes: 'Delete', danger: true }))) return; const r = apiCall(app, user, 'DELETE', '/api/' + t.name + '/' + row.id, {}, 'app'); if (r.status === 200) { toast(t.one + ' deleted', 'success'); pane.rec = null; } else toast(r.status + ' ' + r.error, 'danger'); notify(); };
  const canEdit = acc.update === 'all' || (acc.update === 'own' && row[t.owner || 'created_by'] === user.id);
  const edit = () => { const vals = {}; t.columns.forEach((c) => { vals[c.name] = row[c.name]; }); pane.form = { table: t.name, id: row.id, vals, errs: {} }; notify(); };
  const kids = def.tables.filter((k) => k.name !== t.name && k.columns.some((c) => c.type === 'ref' && c.ref === t.name) && accOf(def, user.role, k.name).list !== 'none');
  const log = fetchApi(app, user, '/api/' + t.name + '/' + row.id + '/activity'), out = pane.conn && pane.conn.row === row.id ? pane.conn : null;
  const runAction = (a) => { const c = allConnectors().find((x) => x.id === a.connector) || { name: a.connector }; if (!connOn(a.connector)) return toast(c.name + ' is switched off under Connections.', 'warning'); if (!needNet(a.label)) return; pane.conn = { row: row.id, name: c.name, label: a.label, res: callConnector(app, 'ui', null, a.connector, a.tool, { query: String(row[a.arg] || '') }) }; notify(); };
  return html`<aside class="drawer" aria-label=${t.one + ' details'}>
    <div class="drawer-head">${back}<div class="col gap0 grow"><span class="t-cap muted">${t.one} #${row.id}</span><strong class="t-sub2">${rowTitle(app, user, t, row)}</strong></div>${shut}</div>
    <div class="drawer-body">
      ${P && html`<div class="row wrap"><span class=${'badge b-' + stateTone(def, t, sc, row[P.column])}>${stateLabel(def, t, sc, row[P.column])}</span>${trs.map((x, i) => html`<button key=${x.id} class=${cx('btn sm', i === 0 && 'primary')} onClick=${() => act(x)}>${x.label}</button>`)}${!trs.length && html`<span class="t-cap muted">No workflow action for a ${roleName(def, user.role).toLowerCase()} at this status</span>`}</div>`}
      <dl class="fields">${t.columns.filter((c) => !isStatusCol(def, t, c)).map((c) => html`<div key=${c.name} class=${cx('f', c.type === 'longtext' && 'wide')}><dt>${c.label}</dt><dd><${Cell} app=${app} user=${user} t=${t} c=${c} v=${row[c.name]} /></dd></div>`)}</dl>
      ${(canEdit || acc.delete || def.actions.some((a) => a.table === t.name)) && html`<div class="row wrap">${canEdit && html`<button class="btn sm" onClick=${edit}><${Icon} n="edit" s="16" />Edit</button>`}${acc.delete && html`<button class="btn sm" onClick=${del}><${Icon} n="trash" s="16" />Delete</button>`}${def.actions.filter((a) => a.table === t.name).map((a) => html`<button key=${a.id} class="btn sm" disabled=${!online()} title=${online() ? 'Calls the ' + a.connector + ' connection' : 'Needs internet'} onClick=${() => runAction(a)}><${Icon} n="plug" s="16" />${a.label}</button>`)}</div>`}
      ${out && html`<section class="conn-out"><div class="row between"><h3 class="sec-h">${out.label} · ${out.name}</h3><${Proto}>Sample response<//></div>${out.res.ok ? html`<ul class="rel">${arr(out.res.result.results).map((x, i) => html`<li key=${i}><a class="rel-i" href=${x.url} target="_blank" rel="noopener noreferrer"><span class="col gap0 grow"><span class="t-strong">${x.title}</span><span class="t-cap muted">${x.excerpt}</span></span><${Icon} n="open" s="16" /></a></li>`)}</ul>` : html`<${MBar} tone="warning">${out.res.result.error}<//>`}</section>`}
      ${kids.map((k) => html`<${Related} key=${k.name} app=${app} user=${user} pane=${pane} t=${t} k=${k} row=${row} />`)}
      <section><h3 class="sec-h">Activity</h3>${log.status === 200 && log.data.length ? html`<ul class="act">${log.data.map((a) => html`<li key=${a.id}><span class="t-strong">${a.who || 'Someone'}</span> ${a.action}${a.detail ? ' · ' + a.detail : ''}<span class="muted t-cap"> · ${fmtDateTime(a.at)}</span></li>`)}</ul>` : html`<p class="muted t-cap">Nothing since it was created${row.created_at ? ' on ' + fmtDate(row.created_at) : ''}.</p>`}</section>
    </div></aside>`;
}
function Related({ app, user, pane, t, k, row }) {
  const def = app.def, c = k.columns.find((x) => x.type === 'ref' && x.ref === t.name), res = fetchApi(app, user, '/api/' + k.name, { filter: { [c.name]: row.id } }), P = def.process && def.process.table === k.name ? def.process : null;
  if (res.status !== 200) return null;
  return html`<section><div class="row between"><h3 class="sec-h">${k.label} (${res.data.length})</h3>${accOf(def, user.role, k.name).create && html`<button class="btn subtle sm" onClick=${() => { pane.form = { table: k.name, id: null, vals: { [c.name]: row.id }, errs: {} }; notify(); }}><${Icon} n="add" s="16" />Add</button>`}</div>
    ${res.data.length ? html`<ul class="rel">${res.data.slice(0, 6).map((r) => html`<li key=${r.id}><button class="rel-i" onClick=${() => { pane.rec = { table: k.name, id: r.id }; pane.conn = null; notify(); }}><span class="ellipsis grow">${rowTitle(app, user, k, r)}</span>${P && html`<span class=${'badge b-' + stateTone(def, k, colOf(k, P.column), r[P.column])}>${stateLabel(def, k, colOf(k, P.column), r[P.column])}</span>`}</button></li>`)}</ul>` : html`<p class="muted t-cap">None yet.</p>`}</section>`;
}

/* ---------- the stage: the built app, as one or two users, with the walkthrough player ---------- */
function startWalk(app) { const st = stageOf(app); st.tour = { i: 0, res: [], state: { rows: {}, last: null } }; st.panes[0].form = null; U.view[app.id] = 'app'; notify(); }
function StageView({ app }) {
  const st = stageOf(app), def = app.def, ready = def.screens.length > 0 && dbExists(app.id);
  if (!ready) return html`<div class="stage" data-tour="stage"><${Empty} icon="layout" title="The app is not built yet" text="When the Screens station has passed its checks, the working app appears here." /></div>`;
  const users = appUsers(app), p0 = st.panes[0];
  const setUser = (pane, id) => { pane.uid = id; pane.screen = null; pane.rec = null; pane.form = null; notify(); };
  const split = () => { st.split = !st.split; if (st.split && st.panes[1].uid == null) { const cur = users.find((u) => u.id === p0.uid), other = users.find((u) => !cur || u.role !== cur.role); if (!cur && users[0]) p0.uid = users[0].id; st.panes[1].uid = other ? other.id : null; } notify(); };
  const reset = async () => { if (await confirmBox({ title: 'Reset the data in ' + app.name + '?', body: 'Every table is emptied and the original seed rows are put back. Tables, users and screens stay as they are.', yes: 'Reset data' })) resetAppData(app); };
  return html`<div class="stage" data-tour="stage">
    <div class="stage-bar">
      <label class="t-cap muted hide-sm" for=${'pv' + app.id}>Preview as</label>
      <select class="select sm" id=${'pv' + app.id} aria-label="Preview as" value=${p0.uid == null ? '' : String(p0.uid)} onChange=${(e) => setUser(p0, e.target.value ? +e.target.value : null)}><option value="">Sign-in screen</option>${users.map((u) => html`<option key=${u.id} value=${String(u.id)}>${u.name} · ${roleName(def, u.role)}</option>`)}</select>
      <button class=${cx('btn sm', st.split && 'on')} aria-pressed=${st.split} title="Open the app twice, as two different users, to see the access rules side by side" onClick=${split}><${Icon} n="split" s="16" /><span class="hide-sm">Two users</span></button>
      <span class="grow"></span>
      ${REC[app.tpl] && html`<span class="hide-sm"><${Proto}>${'Made-up data' + (REC[app.tpl].sampleNote ? '. ' + REC[app.tpl].sampleNote : '')}<//></span>`}
      <button class="btn sm" data-tour="walk" disabled=${!def.tour.length} onClick=${() => startWalk(app)}><${Icon} n="playOutline" s="16" /><span class="hide-sm">Play walkthrough</span></button>
      <button class="btn sm" onClick=${reset}><${Icon} n="reset" s="16" /><span class="hide-sm">Reset data</span></button>
    </div>
    <div class=${cx('devices', st.split && 'two')}>
      <div class="device"><${AppPane} app=${app} pane=${p0} /></div>
      ${st.split && html`<div class="device"><${AppPane} app=${app} pane=${st.panes[1]} /></div>`}
    </div>
    ${st.tour && html`<${WalkPlayer} app=${app} st=${st} />`}
  </div>`;
}
function WalkPlayer({ app, st }) {
  const T = st.tour, steps = app.def.tour, step = steps[T.i], done = T.i >= steps.length, r = T.res[T.i], p = st.panes[0];
  const exec = (i) => { const x = tourExec(app, T.state, steps[i]); T.res[i] = { ok: x.ok, detail: x.detail }; if (x.user) { p.uid = x.user.id; p.form = null; } if (x.screen) p.screen = x.screen; p.rec = x.rec || null; p.vs = {}; };
  const close = () => { st.tour = null; notify(); };
  return html`<div class="walk" role="dialog" aria-label="Walkthrough">
    <div class="row between"><strong>Walkthrough</strong><button class="btn subtle icon sm" aria-label="Close walkthrough" onClick=${close}><${Icon} n="dismiss" s="16" /></button></div>
    <div class="walk-dots" aria-hidden="true">${steps.map((s, i) => html`<span key=${i} class=${cx('dot', i === T.i && 'cur', T.res[i] && (T.res[i].ok ? 'ok' : 'bad'))}></span>`)}</div>
    ${done ? html`<p><strong>${T.res.filter((x) => x && x.ok).length} of ${steps.length} steps passed.</strong> These are the steps the Walkthrough station ran as the acceptance test. Here they made real records, so use Reset data to clear them.</p>
      <div class="row"><button class="btn primary sm" onClick=${close}>Done</button><button class="btn sm" onClick=${() => startWalk(app)}>Play again</button></div>`
    : html`<p class="t-cap muted">Step ${T.i + 1} of ${steps.length} · as ${roleName(app.def, step.role)}</p><p>${step.say}</p>
      ${r && html`<div class=${cx('walk-res', r.ok ? 'ok' : 'bad')}><${Icon} n=${r.ok ? 'checkCircle' : 'errorCircle'} s="16" /><span class="mono">${r.detail}</span></div>`}
      <div class="row">${!r ? html`<button class="btn primary sm" onClick=${() => { exec(T.i); notify(); }}><${Icon} n="play" s="16" />Do it</button>` : html`<button class="btn primary sm" onClick=${() => { T.i++; notify(); }}>${T.i === steps.length - 1 ? 'Finish' : 'Next step'}</button>`}
        <button class="btn subtle sm" onClick=${() => { for (let i = T.i; i < steps.length; i++) if (!T.res[i]) exec(i); T.i = steps.length; notify(); }}>Run all</button></div>`}
  </div>`;
}
