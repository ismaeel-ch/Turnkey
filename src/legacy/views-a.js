/* ===== Turnkey prototype · the data explorer: one table, many views =====
   Every view below draws the same rows: the ones the API returned for this user, after the search box and the filters. */
const OP_TEXT = { is: 'is', not: 'is not', has: 'contains', gt: 'is more than', lt: 'is less than', before: 'is before', after: 'is after', range: 'is', between: 'is from', empty: 'is empty', filled: 'is filled' };
const RANGES = { today: 'today', week: 'in the next 7 days', upcoming: 'today or later', past7: 'in the past 7 days', past30: 'in the past 30 days', month: 'this month' };
const opsFor = (c) => (isCat(c) ? ['is', 'not', 'empty', 'filled'] : isDate(c) ? ['range', 'before', 'after', 'empty', 'filled'] : isNum(c) ? ['gt', 'lt', 'is', 'empty'] : ['has', 'empty', 'filled']);
function inRange(v, r) { const n = dayDiff(v); if (n == null) return false; if (r === 'today') return n === 0; if (r === 'week') return n >= 0 && n < 7; if (r === 'upcoming') return n >= 0; if (r === 'past7') return n <= 0 && n > -7; if (r === 'past30') return n <= 0 && n > -30; const d = parseISO(v), t = today(); return d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear(); }
function passes(f, v) {
  const none = v == null || v === '';
  switch (f.op) {
    case 'empty': return none; case 'filled': return !none;
    case 'is': return !none && String(v) === String(f.val); case 'not': return String(v) !== String(f.val);
    case 'has': return !none && String(v).toLowerCase().indexOf(String(f.val).toLowerCase()) >= 0;
    case 'gt': return !none && Number(v) > Number(f.val); case 'lt': return !none && Number(v) < Number(f.val);
    case 'before': return !none && String(v).slice(0, 10) < String(f.val); case 'after': return !none && String(v).slice(0, 10) > String(f.val);
    case 'range': return !none && inRange(v, f.val);
    case 'between': return !none && String(v).slice(0, 10) >= f.val[0] && String(v).slice(0, 10) <= f.val[1];
    default: return true;
  }
}
function catChoices(app, user, c) { // the values a category column can take, in a stable order, so colours follow the value
  if (c.type === 'select') return c.options.map((o) => ({ key: o, label: stateLabel(app.def, { name: c._t }, c, o) }));
  if (c.type === 'bool') return [{ key: 1, label: 'Yes' }, { key: 0, label: 'No' }];
  if (c.type === 'user') return appUsers(app).filter((u) => !c.role || u.role === c.role).map((u) => ({ key: u.id, label: u.name }));
  const rt = tableOf(app.def, c.ref), res = rt ? fetchApi(app, user, '/api/' + c.ref) : null;
  return res && res.status === 200 ? res.data.slice().sort((a, b) => a.id - b.id).map((r) => ({ key: r.id, label: rowTitle(app, user, rt, r) })) : [];
}
const choices = (app, user, t, c) => catChoices(app, user, Object.assign({ _t: t.name }, c));
const prefKey = (app, user, scr) => app.id + '|' + user.id + '|' + scr.id;
function vxState(pane, scr, app, user, test) { // how this person left this page: view, filters, sorting and options are kept with the app
  const all = pane.vs || (pane.vs = {});
  if (!all[scr.id]) {
    const saved = !test && !pane.test && app && user && S.prefs ? S.prefs[prefKey(app, user, scr)] : null;
    all[scr.id] = Object.assign({ view: scr.type, q: '', filters: scr.range && scr.date ? [{ col: scr.date, op: 'range', val: scr.range }] : [], sort: null, group: '', hidden: null, page: 0, closed: {}, open: {}, cfg: {}, fd: null }, saved ? clone(saved) : {});
  }
  return all[scr.id];
}
function vxRemember(app, user, scr, st) { const P = S.prefs || (S.prefs = {}); P[prefKey(app, user, scr)] = { view: st.view, filters: st.filters, sort: st.sort, group: st.group, hidden: st.hidden, cfg: st.cfg }; saveSoon(); }
function vxCfg(def, t, scr, st, type) { // the advisor's plan, then the page's presets, then what the person chose; every column is checked again
  const base = Object.assign({}, viewsOf(def, t).find((v) => v.type === type) || {}), mine = st.cfg[type] || {};
  if (type === 'board' && scr.group) base.by = scr.group;
  if ((type === 'calendar' || type === 'timeline') && scr.date) { base.date = scr.date; base.start = scr.date; if (scr.end) base.end = scr.end; }
  const o = viewCfg(def, t, type, Object.assign({}, base, mine));
  ['split', 'lane', 'end'].forEach((k) => { if (k in mine && mine[k] == null && k in o) o[k] = null; });
  if (type === 'tree' && Array.isArray(mine.levels)) o.levels = mine.levels.filter((n) => colOf(t, n) && isCat(colOf(t, n)));
  ['mode', 'zoom', 'table'].forEach((k) => { if (mine[k] != null) o[k] = mine[k]; });
  return o;
}
function FilterBox({ app, user, t, st, set }) {
  const s0 = useState(false), open = s0[0], setOpen = s0[1], ref = useRef(), d = st.fd || (st.fd = { col: t.columns[0].name, op: '', val: '' });
  useEffect(() => { if (!open) return undefined; const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const c = colOf(t, d.col) || t.columns[0], ops = opsFor(c), op = ops.includes(d.op) ? d.op : ops[0], noVal = op === 'empty' || op === 'filled', id = 'fl_' + t.name + '_';
  const upd = (k, v) => { d[k] = v; if (k === 'col') { d.op = ''; d.val = ''; } notify(); };
  const add = (e) => { e.preventDefault(); if (!noVal && (d.val === '' || d.val == null)) return; set((s) => { s.filters.push({ col: c.name, op, val: noVal ? null : d.val }); s.page = 0; s.fd = null; }); setOpen(false); };
  let ctl = null;
  if (!noVal) ctl = isCat(c) ? html`<select class="select" id=${id + 'v'} aria-label="Value" value=${String(d.val)} onChange=${(e) => upd('val', e.target.value)}><option value="">Choose</option>${choices(app, user, t, c).map((o) => html`<option key=${o.key} value=${String(o.key)}>${o.label}</option>`)}</select>`
    : op === 'range' ? html`<select class="select" id=${id + 'v'} aria-label="Value" value=${d.val} onChange=${(e) => upd('val', e.target.value)}><option value="">Choose</option>${Object.keys(RANGES).map((k) => html`<option key=${k} value=${k}>${RANGES[k]}</option>`)}</select>`
    : html`<input class="input" id=${id + 'v'} aria-label="Value" type=${isDate(c) ? 'date' : isNum(c) ? 'number' : 'text'} value=${d.val} onInput=${(e) => upd('val', e.target.value)} />`;
  return html`<div class="menu-wrap" ref=${ref}>
    <button class=${cx('btn sm', st.filters.length && 'on')} aria-expanded=${open} onClick=${() => setOpen(!open)}><${Icon} n="filter" s="16" />Filter${st.filters.length ? ' · ' + st.filters.length : ''}</button>
    ${open && html`<form class="menu right fbox" onSubmit=${add}>
      <div class="mlabel">Show rows where</div>
      <select class="select" id=${id + 'c'} aria-label="Field" value=${c.name} onChange=${(e) => upd('col', e.target.value)}>${t.columns.map((x) => html`<option key=${x.name} value=${x.name}>${x.label}</option>`)}</select>
      <select class="select" id=${id + 'o'} aria-label="Condition" value=${op} onChange=${(e) => upd('op', e.target.value)}>${ops.map((o) => html`<option key=${o} value=${o}>${OP_TEXT[o]}</option>`)}</select>
      ${ctl}<button class="btn primary sm" type="submit">Add filter</button>
    </form>`}
  </div>`;
}
function Explorer({ app, user, pane, scr, test }) {
  const def = app.def, t = tableOf(def, scr.table), keep = !test && !pane.test, st = vxState(pane, scr, app, user, test), acc = accOf(def, user.role, t.name), res = fetchApi(app, user, '/api/' + t.name, null, test || pane.test ? 'check' : 'app');
  if (res.status !== 200) return html`<div class="scr"><${MBar} tone="danger">${res.status + ' ' + res.error}<//></div>`;
  const rec = viewsOf(def, t), recT = rec.map((v) => v.type), view = DATA_VIEWS.includes(st.view) && !viewFit(def, t, st.view) ? st.view : 'table', q = str(st.q).toLowerCase();
  let rows = res.data;
  st.filters.forEach((f) => { if (colOf(t, f.col)) rows = rows.filter((r) => passes(f, r[f.col])); });
  if (q) rows = rows.filter((r) => t.columns.some((c) => String(cellText(app, user, t, c, r[c.name], 1)).toLowerCase().indexOf(q) >= 0));
  const set = (fn) => { fn(st); if (keep) vxRemember(app, user, scr, st); notify(); }, open = (r) => { pane.rec = { table: t.name, id: r.id }; notify(); };
  const openNew = (preset) => { pane.form = { table: t.name, id: null, vals: Object.assign({}, preset || {}), errs: {} }; notify(); };
  const drill = (pairs) => set((s) => { pairs.filter(Boolean).forEach((p) => { s.filters = s.filters.filter((f) => f.col !== p.col); s.filters.push(p.op ? { col: p.col, op: p.op, val: p.val } : p.val == null || p.val === '' ? { col: p.col, op: 'empty', val: null } : { col: p.col, op: 'is', val: p.val }); }); s.view = 'table'; s.page = 0; s.group = ''; });
  const cfg = vxCfg(def, t, scr, st, view), setCfg = (k, v) => set((s) => { s.cfg[view] = Object.assign({}, s.cfg[view], { [k]: v }); });
  const P = { app, user, pane, scr, t, rows, st, cfg, setCfg, set, open, openNew, drill, canCreate: acc.create };
  const chip = (f, i) => { const c = colOf(t, f.col); if (!c) return null; const v = f.op === 'range' ? RANGES[f.val] : f.op === 'between' ? (f.val[0] === f.val[1] ? fmtDate(f.val[0]) : fmtDate(f.val[0]) + ' to ' + fmtDate(f.val[1])) : f.val == null ? '' : isCat(c) ? (choices(app, user, t, c).find((o) => String(o.key) === String(f.val)) || { label: f.val }).label : isDate(c) ? fmtDate(f.val) : f.val; return html`<span key=${i} class="chip on">${c.label} ${f.op === 'range' || (f.op === 'between' && f.val[0] === f.val[1]) ? 'is' : OP_TEXT[f.op]} ${v}<button class="chip-x" aria-label=${'Remove the filter on ' + c.label} onClick=${() => set((s) => { s.filters.splice(i, 1); s.page = 0; })}><${Icon} n="dismiss" s="12" /></button></span>`; };
  const csv = () => { const cols = t.columns, esc = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; copyText([cols.map((c) => esc(c.label)).join(',')].concat(rows.map((r) => cols.map((c) => esc(cellText(app, user, t, c, r[c.name], 1))).join(','))).join('\n'), rows.length + ' rows as CSV'); };
  const more = DATA_VIEWS.filter((v) => !recT.includes(v)), V = { table: VTable, board: VBoard, calendar: VCalendar, cards: VCards, tree: VTree, chart: VChart, pivot: VPivot, timeline: VTimeline }[view];
  return html`<div class="scr vx">
    <div class="scr-head">
      <div class="col gap0 grow"><h2 class="t-sub1">${scr.name}</h2><span class="t-cap muted">${rows.length}${rows.length !== res.data.length ? ' of ' + res.data.length : ''} ${rows.length === 1 ? t.one.toLowerCase() : t.label.toLowerCase()}${acc.list === 'own' ? ' · only yours' : ''}</span></div>
      <div class="search"><${Icon} n="search" s="16" /><input class="input" id=${'q' + scr.id + '_' + pane.n} aria-label=${'Search ' + t.label.toLowerCase()} placeholder="Search" value=${st.q || ''} onInput=${(e) => set((s) => { s.q = e.target.value; s.page = 0; })} /></div>
      ${acc.create && html`<button class="btn primary fab" onClick=${() => openNew()}><${Icon} n="add" /><span>New ${t.one.toLowerCase()}</span></button>`}
    </div>
    <div class="vx-bar">
      <div class="vswitch" role="tablist" aria-label="Ways to view this data" data-tour="vswitch">${rec.concat(recT.includes(view) ? [] : [{ type: view, why: 'Not recommended by the advisor, but it fits.' }]).map((v) => html`<button key=${v.type} role="tab" aria-selected=${v.type === view} class=${cx('vs-b', v.type === view && 'on')} title=${v.why} onClick=${() => set((s) => { s.view = v.type; })}><${Icon} n=${VIEW_ICON[v.type]} s="16" /><span>${VIEW_LABEL[v.type]}</span></button>`)}
        ${more.length > 0 && html`<${Menu} align="left" title="Views the advisor did not recommend for this table" btn=${{ cls: 'vs-b', label: 'More views', body: html`<${Icon} n="more" s="16" />` }} items=${[{ head: true, label: 'Not recommended here' }].concat(more.map((v) => { const why = viewFit(def, t, v); return { label: VIEW_LABEL[v], icon: VIEW_ICON[v], hint: why ? 'does not fit' : 'fits', disabled: !!why, on: () => set((s) => { s.view = v; }) }; }))} />`}
      </div>
      <span class="grow"></span>
      <${FilterBox} app=${app} user=${user} t=${t} st=${st} set=${set} />
      <button class="btn sm" title="Copy the rows you see as CSV" onClick=${csv}><${Icon} n="copy" s="16" /><span class="hide-sm">CSV</span></button>
    </div>
    ${st.filters.length > 0 && html`<div class="chips">${st.filters.map(chip)}<button class="btn subtle sm" onClick=${() => set((s) => { s.filters = []; s.page = 0; })}>Clear all</button></div>`}
    <div class="vx-body">${html`<${V} ...${P} />`}</div>
  </div>`;
}
const Pick = ({ id, label: text, value, onChange, opts, none }) => html`<label class="pick"><span>${text}</span><select class="select sm" id=${id} value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>${none && html`<option value="">${none}</option>`}${opts.map((o) => html`<option key=${o.name} value=${o.name}>${o.label}</option>`)}</select></label>`;
const NoRows = ({ t }) => html`<${Empty} icon="search" title=${'No ' + t.label.toLowerCase() + ' to show'} text="Nothing matches the search and filters." />`;

function VTable({ app, user, pane, scr, t, rows, st, set, open }) {
  if (!st.hidden) { st.hidden = {}; t.columns.forEach((c) => { st.hidden[c.name] = !scr.columns.includes(c.name); }); }
  const cols = t.columns.filter((c) => !st.hidden[c.name]), sort = st.sort && colOf(t, st.sort.col) ? st.sort : null, list = rows.slice(), g = colOf(t, st.group), nums = cols.filter(isNum), per = 25, pages = Math.max(1, Math.ceil(list.length / per)), page = Math.min(st.page || 0, pages - 1);
  const raw = (c, r) => (isNum(c) || isDate(c) || c.type === 'bool' ? (r[c.name] == null ? '' : r[c.name]) : String(cellText(app, user, t, c, r[c.name], 1)).toLowerCase());
  if (sort) { const c = colOf(t, sort.col); list.sort((a, b) => { const x = raw(c, a), y = raw(c, b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; }); } else if (scr.date) list.sort((a, b) => String(a[scr.date]).localeCompare(String(b[scr.date])));
  const sum = (c, l) => l.reduce((n, r) => n + (Number(r[c.name]) || 0), 0), id = 'tb' + scr.id + pane.n;
  const row = (r) => html`<tr key=${r.id} class="clickable" tabindex="0" onClick=${() => open(r)} onKeyDown=${(e) => { if (e.key === 'Enter') open(r); }}>${cols.map((c) => html`<td key=${c.name} class=${isNum(c) ? 'num' : ''} data-l=${c.label}><${Cell} app=${app} user=${user} t=${t} c=${c} v=${r[c.name]} /></td>`)}</tr>`;
  let body;
  if (g) {
    const keys = choices(app, user, t, g).concat([{ key: null, label: 'Not set' }]);
    body = keys.map((k) => { const l = list.filter((r) => (k.key == null ? r[g.name] == null || r[g.name] === '' : String(r[g.name]) === String(k.key))); if (!l.length) return null; const shut = st.closed[g.name + k.key]; return [html`<tr key=${'g' + k.key} class="grp"><td colspan=${cols.length}><button class="grp-b" aria-expanded=${!shut} onClick=${() => set((s) => { s.closed[g.name + k.key] = !shut; })}><${Icon} n=${shut ? 'chevRight' : 'chevDown'} s="16" /><strong>${k.label}</strong><span class="tab-n">${l.length}</span>${nums.map((c) => html`<span key=${c.name} class="muted t-cap">${c.label} ${fmtNum(sum(c, l))}</span>`)}</button></td></tr>`, shut ? null : l.map(row)]; });
  } else body = list.slice(page * per, page * per + per).map(row);
  return html`<div class="vopts"><${Pick} id=${id + 'g'} label="Group by" value=${st.group} none="Nothing" opts=${t.columns.filter(isCat)} onChange=${(v) => set((s) => { s.group = v || ''; })} />
      <span class="only-c"><${Pick} id=${id + 's'} label="Sort by" value=${sort ? sort.col : ''} none="Default" opts=${cols} onChange=${(v) => set((s) => { s.sort = v ? { col: v, dir: 1 } : null; })} /></span>
      <${Menu} align="left" title="Choose columns" btn=${{ cls: 'btn sm', label: 'Columns', body: html`<${Icon} n="layout" s="16" />Columns · ${cols.length}` }} items=${t.columns.map((c) => ({ label: c.label, check: !st.hidden[c.name], on: () => set((s) => { s.hidden[c.name] = !s.hidden[c.name]; }) }))} />
      <span class="grow"></span>
      ${!g && pages > 1 && html`<span class="pager"><button class="btn subtle icon sm" aria-label="Previous page" disabled=${page === 0} onClick=${() => set((s) => { s.page = page - 1; })}><${Icon} n="chevLeft" s="16" /></button><span class="t-cap">Page ${page + 1} of ${pages}</span><button class="btn subtle icon sm" aria-label="Next page" disabled=${page >= pages - 1} onClick=${() => set((s) => { s.page = page + 1; })}><${Icon} n="chevRight" s="16" /></button></span>`}</div>
    ${list.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => html`<th key=${c.name} class=${isNum(c) ? 'num' : ''} aria-sort=${sort && sort.col === c.name ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}><button class="th-btn" onClick=${() => set((s) => { s.sort = sort && sort.col === c.name ? { col: c.name, dir: -sort.dir } : { col: c.name, dir: 1 }; })}>${c.label}${sort && sort.col === c.name && html`<${Icon} n=${sort.dir > 0 ? 'arrowUp' : 'arrowDown'} s="12" />`}</button></th>`)}</tr></thead>
      <tbody>${body}</tbody>${nums.length > 0 && html`<tfoot><tr>${cols.map((c, i) => html`<td key=${c.name} class=${isNum(c) ? 'num' : ''}>${isNum(c) ? fmtNum(sum(c, list)) : i === 0 ? 'Total of ' + list.length : ''}</td>`)}</tr></tfoot>`}</table></div>` : html`<${NoRows} t=${t} />`}`;
}
function VBoard({ app, user, pane, scr, t, rows, cfg, setCfg, open }) {
  const def = app.def, g = colOf(t, cfg.by), lane = colOf(t, cfg.lane), P = g && isStatusCol(def, t, g) ? def.process : null, lab = scr.label || t.title, id = 'bd' + scr.id + pane.n;
  if (!g) return html`<${Empty} icon="board" title="No choice field to group by" />`;
  const cols = scr.columns.map((n) => colOf(t, n)).filter((c) => c && c.name !== g.name && c.name !== lab && c.type !== 'longtext').slice(0, 3);
  const drop = (e, to) => {
    e.preventDefault(); const rid = +e.dataTransfer.getData('text/plain'), r0 = rows.find((r) => r.id === rid); if (!r0 || r0[g.name] === to) return;
    if (P) { const tr = P.transitions.find((x) => x.to === to && x.from.includes(r0[g.name]) && x.roles.includes(user.role)); if (!tr) return toast(roleName(def, user.role) + ' cannot move a ' + t.one.toLowerCase() + ' from ' + label(r0[g.name]).toLowerCase() + ' to ' + label(to).toLowerCase() + '.', 'warning'); const r = apiCall(app, user, 'POST', '/api/' + t.name + '/' + rid + '/' + tr.id, {}, 'app'); toast(r.status === 200 ? tr.label + ': done' : r.status + ' ' + r.error, r.status === 200 ? 'success' : 'danger'); }
    else { const r = apiCall(app, user, 'PATCH', '/api/' + t.name + '/' + rid, { [g.name]: to }, 'app'); if (r.status !== 200) toast(r.status + ' ' + r.error, 'danger'); }
    notify();
  };
  const board = (list, key) => html`<div key=${key} class="kb">${g.options.map((o) => { const l = list.filter((r) => r[g.name] === o); return html`<section key=${o} class="kb-col" aria-label=${stateLabel(def, t, g, o)} onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => drop(e, o)}>
    <header class="kb-head"><span class=${cx('badge', P ? 'b-' + stateTone(def, t, g, o) : 'b-outline')}>${stateLabel(def, t, g, o)}</span><span class="t-cap muted">${l.length}</span></header>
    <div class="kb-list">${l.map((r) => html`<button key=${r.id} class="kb-card" draggable="true" onDragStart=${(e) => e.dataTransfer.setData('text/plain', String(r.id))} onClick=${() => open(r)}><span class="t-strong">${rowTitle(app, user, t, r, lab)}</span>${lab !== t.title && html`<span class="muted t-cap">${rowTitle(app, user, t, r)}</span>`}
      ${cols.map((c) => r[c.name] != null && r[c.name] !== '' && html`<span key=${c.name} class="kb-f"><span class="muted">${c.label}</span><span><${Cell} app=${app} user=${user} t=${t} c=${c} v=${r[c.name]} /></span></span>`)}</button>`)}${!l.length && html`<div class="kb-empty">Nothing here</div>`}</div>
  </section>`; })}</div>`;
  return html`<div class="vopts"><${Pick} id=${id + 'b'} label="Columns from" value=${g.name} opts=${t.columns.filter((c) => c.type === 'select')} onChange=${(v) => setCfg('by', v)} /><${Pick} id=${id + 'l'} label="Swimlanes" value=${lane ? lane.name : ''} none="None" opts=${t.columns.filter((c) => isCat(c) && c.name !== g.name)} onChange=${(v) => setCfg('lane', v)} />${P ? html`<span class="t-cap muted hide-sm">Drag a card to run a workflow action your role may take</span>` : null}</div>
    ${lane ? choices(app, user, t, lane).concat([{ key: null, label: 'Not set' }]).map((k) => { const l = rows.filter((r) => (k.key == null ? r[lane.name] == null : String(r[lane.name]) === String(k.key))); return l.length ? html`<section key=${String(k.key)} class="lane"><h3 class="lane-h">${k.label}<span class="tab-n">${l.length}</span></h3>${board(l, 'b')}</section>` : null; }) : board(rows, 'b')}`;
}
function VCalendar({ app, user, pane, scr, t, rows, st, cfg, setCfg, set, open, openNew, canCreate }) {
  const def = app.def, dc = colOf(t, cfg.date); if (!dc) return html`<${Empty} icon="calendar" title="No date field" />`;
  const week = cfg.mode === 'week', off = st.month || 0, base = today(), lab = scr.label || t.title, P = def.process && def.process.table === t.name ? def.process : null, isDT = dc.type === 'datetime', tk = isoDate(base), id = 'cl' + scr.id + pane.n;
  const first = week ? new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7) + off * 7) : new Date(base.getFullYear(), base.getMonth() + off, 1), start = week ? first : new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7)), byDay = {};
  rows.forEach((r) => { const a = parseISO(r[dc.name]); if (!a) return; const b = cfg.end && r[cfg.end] ? parseISO(r[cfg.end]) : null; let d = new Date(a.getFullYear(), a.getMonth(), a.getDate()), n = 0; const last = b && b >= d ? b : d; while (d <= last && n < 60) { const k = isoDate(d); (byDay[k] = byDay[k] || []).push(r); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); n++; } });
  const days = []; for (let i = 0; i < (week ? 7 : 42); i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const count = week ? 7 : days[35].getMonth() !== first.getMonth() ? 35 : 42, move = (n) => set((s) => { s.month = n; s.calOpen = null; }), end = days[count - 1];
  return html`<div class="vopts"><button class="btn subtle icon sm" aria-label=${week ? 'Previous week' : 'Previous month'} onClick=${() => move(off - 1)}><${Icon} n="chevLeft" s="16" /></button><strong class="cal-title">${week ? first.getDate() + ' ' + MON[first.getMonth()] + ' to ' + end.getDate() + ' ' + MON[end.getMonth()] : MONTH[first.getMonth()] + ' ' + first.getFullYear()}</strong><button class="btn subtle icon sm" aria-label=${week ? 'Next week' : 'Next month'} onClick=${() => move(off + 1)}><${Icon} n="chevRight" s="16" /></button><button class="btn sm" onClick=${() => move(0)}>Today</button>
      <${Seg} label="Calendar span" items=${[{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }]} value=${week ? 'week' : 'month'} onChange=${(v) => { st.month = 0; setCfg('mode', v); }} /><span class="grow"></span>
      ${t.columns.filter(isDate).length > 1 && html`<${Pick} id=${id + 'd'} label="Date from" value=${dc.name} opts=${t.columns.filter(isDate)} onChange=${(v) => setCfg('date', v)} />`}</div>
    <div class=${cx('cal-grid', week && 'wk')}>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<div key=${d} class="cal-dow">${d}</div>`)}
      ${days.slice(0, count).map((d) => { const k = isoDate(d), list = (byDay[k] || []).slice().sort((a, b) => String(a[dc.name]).localeCompare(String(b[dc.name]))), all = week || st.calOpen === k; return html`<div key=${k} class=${cx('cal-day', !week && d.getMonth() !== first.getMonth() && 'out', k === tk && 'today')}>
        <div class="cal-num"><span>${d.getDate()}</span>${canCreate && html`<button class="cal-add" aria-label=${'New ' + t.one.toLowerCase() + ' on ' + k} onClick=${() => openNew({ [dc.name]: isDT ? k + 'T09:00' : k })}><${Icon} n="add" s="12" /></button>`}</div>
        ${(all ? list : list.slice(0, 3)).map((r) => html`<button key=${r.id} class=${cx('cal-chip', P && 'tone-' + stateTone(def, t, colOf(t, P.column), r[P.column]))} title=${rowTitle(app, user, t, r) + (P ? ' · ' + stateLabel(def, t, colOf(t, P.column), r[P.column]) : '')} onClick=${() => open(r)}>${isDT && html`<span class="cal-t">${fmtTime(r[dc.name])}</span>`}<span class="ellipsis">${rowTitle(app, user, t, r, lab)}</span></button>`)}
        ${list.length > 3 && !all && html`<button class="cal-more" onClick=${() => set((s) => { s.calOpen = k; })}>+${list.length - 3} more</button>`}
      </div>`; })}</div>`;
}
function VCards({ app, user, scr, t, rows, open }) {
  const def = app.def, P = def.process && def.process.table === t.name ? def.process : null, lab = scr.label || t.title, cols = scr.columns.map((n) => colOf(t, n)).filter((c) => c && c.name !== lab && !(P && c.name === P.column) && c.type !== 'longtext').slice(0, 4), long = t.columns.find((c) => c.type === 'longtext');
  if (!rows.length) return html`<${NoRows} t=${t} />`;
  return html`<div class="cards">${rows.slice(0, 120).map((r) => html`<button key=${r.id} class="card rcard" onClick=${() => open(r)}>
    <span class="row between"><strong class="ellipsis">${rowTitle(app, user, t, r, lab)}</strong>${P && html`<span class=${'badge b-' + stateTone(def, t, colOf(t, P.column), r[P.column])}>${stateLabel(def, t, colOf(t, P.column), r[P.column])}</span>`}</span>
    ${long && r[long.name] ? html`<span class="muted t-cap clamp">${r[long.name]}</span>` : null}
    ${cols.map((c) => r[c.name] != null && r[c.name] !== '' && html`<span key=${c.name} class="kb-f"><span class="muted">${c.label}</span><span><${Cell} app=${app} user=${user} t=${t} c=${c} v=${r[c.name]} /></span></span>`)}
  </button>`)}</div>${rows.length > 120 && html`<p class="muted t-cap">Showing the first 120. Filter to narrow it down.</p>`}`;
}
function VTree({ app, user, pane, scr, t, rows, st, cfg, setCfg, set, open }) {
  const def = app.def, cats = t.columns.filter(isCat), self = cfg.parent ? colOf(t, cfg.parent) : null, byParent = self && cfg.mode !== 'groups', levels = (cfg.levels || []).filter((n) => colOf(t, n)), num = t.columns.find(isNum), P = def.process && def.process.table === t.name ? def.process : null, id = 'tr' + scr.id + pane.n, tag = P ? null : t.columns.find((c) => c.type === 'select' && (byParent || !levels.includes(c.name)));
  const isOpen = (k, depth) => (st.open[k] != null ? st.open[k] : depth < (byParent ? 2 : 1)), tog = (k, depth) => set((s) => { s.open[k] = !isOpen(k, depth); });
  const total = (l) => (num ? l.reduce((n, r) => n + (Number(r[num.name]) || 0), 0) : 0);
  const leaf = (r, depth, kids) => html`<li key=${'r' + r.id}><div class="tree-row" style=${{ paddingLeft: depth * 20 + 'px' }}>${kids ? html`<button class="tree-tog" aria-label="Expand or collapse" aria-expanded=${isOpen('p' + r.id, depth)} onClick=${() => tog('p' + r.id, depth)}><${Icon} n=${isOpen('p' + r.id, depth) ? 'chevDown' : 'chevRight'} s="16" /></button>` : html`<span class="tree-dot"></span>`}<button class="tree-leaf" onClick=${() => open(r)}><span class="ellipsis">${rowTitle(app, user, t, r, scr.label)}</span>${kids ? html`<span class="tab-n">${kids}</span>` : null}${P && html`<span class=${'badge b-' + stateTone(def, t, colOf(t, P.column), r[P.column])}>${stateLabel(def, t, colOf(t, P.column), r[P.column])}</span>`}${tag && r[tag.name] ? html`<span class="badge b-outline">${optLabel(tag, r[tag.name])}</span>` : null}</button></div></li>`;
  let body;
  if (byParent) {
    const ids = new Set(rows.map((r) => r.id)), kidsOf = (pid) => rows.filter((r) => r[self.name] === pid).sort((a, b) => a.id - b.id), walk = (r, depth) => { const k = kidsOf(r.id); return [leaf(r, depth, k.length)].concat(k.length && isOpen('p' + r.id, depth) && depth < 8 ? k.map((x) => walk(x, depth + 1)) : []); };
    body = rows.filter((r) => r[self.name] == null || !ids.has(r[self.name])).sort((a, b) => a.id - b.id).map((r) => walk(r, 0));
  } else {
    const walk = (list, depth, path) => { if (depth >= levels.length) return list.map((r) => leaf(r, depth, 0)); const c = colOf(t, levels[depth]); return choices(app, user, t, c).concat([{ key: null, label: 'Not set' }]).map((k) => { const l = list.filter((r) => (k.key == null ? r[c.name] == null || r[c.name] === '' : String(r[c.name]) === String(k.key))); if (!l.length) return null; const key = path + '/' + k.key, on = isOpen(key, depth); return [html`<li key=${key}><div class="tree-row grp" style=${{ paddingLeft: depth * 20 + 'px' }}><button class="tree-tog" aria-label="Expand or collapse" aria-expanded=${on} onClick=${() => tog(key, depth)}><${Icon} n=${on ? 'chevDown' : 'chevRight'} s="16" /></button><button class="tree-leaf" onClick=${() => tog(key, depth)}><span class="muted t-cap">${c.label}</span><strong class="ellipsis">${k.label}</strong><span class="tab-n">${l.length}</span>${num ? html`<span class="muted t-cap">${num.label} ${fmtNum(total(l))}</span>` : null}</button></div></li>`].concat(on ? walk(l, depth + 1, key) : []); }); };
    body = levels.length ? walk(rows, 0, '') : rows.map((r) => leaf(r, 0, 0));
  }
  const lv = (i) => html`<${Pick} id=${id + i} label=${i ? 'then by' : 'Nest by'} value=${levels[i] || ''} none=${i ? 'Nothing' : 'Nothing'} opts=${cats.filter((c) => !levels.slice(0, i).includes(c.name))} onChange=${(v) => { const n = levels.slice(0, i); if (v) n.push(v); setCfg('levels', n); }} />`;
  return html`<div class="vopts">${self && html`<${Seg} label="Tree shape" items=${[{ id: 'parent', label: 'Parents and children' }, { id: 'groups', label: 'Groups' }]} value=${byParent ? 'parent' : 'groups'} onChange=${(v) => setCfg('mode', v)} />`}${!byParent && [lv(0), levels.length > 0 && lv(1), levels.length > 1 && lv(2)]}<span class="grow"></span><button class="btn subtle sm" onClick=${() => set((s) => { s.open = {}; })}>Reset</button></div>
    ${rows.length ? html`<ul class="tree">${body}</ul>` : html`<${NoRows} t=${t} />`}`;
}
