/* ===== Turnkey prototype · the view catalog, the View advisor's output, screens =====
   The catalog is a registry: a view is one component plus one rule that says which tables it fits.
   The View advisor agent recommends views per table; code checks every recommendation against the rule. */
const DATA_VIEWS = ['table', 'board', 'calendar', 'timeline', 'chart', 'pivot', 'tree', 'cards'];
const VIEW_ALIAS = { list: 'table', grid: 'table', kanban: 'board', graph: 'chart', charts: 'chart', hierarchy: 'tree', gallery: 'cards', card: 'cards', gantt: 'timeline', schedule: 'calendar' };
const VIEW_WHAT = { table: 'Rows and columns with sorting, grouping and totals', board: 'Cards in columns, moved by drag and drop', calendar: 'Records on the days they happen', timeline: 'Bars across time, one lane per group', chart: 'Counts and sums by category or over time', pivot: 'Two fields crossed, with totals', tree: 'Records nested under groups or parents', cards: 'A gallery of records for scanning' };
const isCat = (c) => ['select', 'user', 'ref', 'bool'].includes(c.type), isDate = (c) => c.type === 'date' || c.type === 'datetime', isNum = (c) => c.type === 'number' || c.type === 'money';
function viewFit(def, t, type) { // null when the view fits the table, otherwise the reason it does not
  const cats = t.columns.filter(isCat).length, dates = t.columns.filter(isDate).length, sels = t.columns.filter((c) => c.type === 'select').length;
  switch (type) {
    case 'table': case 'cards': return null;
    case 'board': return sels ? null : 'needs a choice field to make the columns';
    case 'calendar': case 'timeline': return dates ? null : 'needs a date field';
    case 'chart': return cats || dates ? null : 'needs a category or a date to plot';
    case 'pivot': return cats >= 2 ? null : 'needs two category fields to cross';
    case 'tree': return cats ? null : 'needs a category or a link to nest by';
    default: return 'is not in the view catalog';
  }
}
const guessEnd = (t, start) => { const c = t.columns.find((x) => x.type === 'date' && x.name !== start && /end|until|due|finish/.test(x.name)); return c ? c.name : null; };
const normMeasure = (t, m) => { const x = /^(sum|avg):(.+)$/.exec(String(m || '')); return x && colOf(t, snake(x[2])) && isNum(colOf(t, snake(x[2]))) ? x[1] + ':' + snake(x[2]) : 'count'; };
function viewCfg(def, t, type, u) { // fills in the columns a view needs, keeping the advisor's choices when they are valid
  u = u || {}; const P = def.process && def.process.table === t.name ? def.process : null, status = P ? P.column : null;
  const col = (n, test) => { const c = colOf(t, snake(n)); return c && (!test || test(c)) ? c.name : null; };
  const cats = t.columns.filter(isCat), dates = t.columns.filter(isDate), sels = t.columns.filter((c) => c.type === 'select'), self = t.columns.find((c) => c.type === 'ref' && c.ref === t.name);
  const firstCat = (skip) => (cats.find((c) => c.name !== skip && c.type !== 'bool' && c.name !== (self && self.name)) || cats.find((c) => c.name !== skip) || {}).name || null;
  switch (type) {
    case 'board': return { by: col(u.by || u.group, (c) => c.type === 'select') || status || (sels[0] || {}).name || null, lane: col(u.lane, isCat) };
    case 'calendar': { const d = col(u.date, isDate) || (dates[0] || {}).name || null; return { date: d, end: col(u.end, (c) => c.type === 'date') || guessEnd(t, d) }; }
    case 'timeline': { const s = col(u.start || u.date, isDate) || (dates[0] || {}).name || null; return { start: s, end: col(u.end, isDate) || guessEnd(t, s), lane: col(u.lane, isCat) || (cats.find((c) => c.type === 'user') || cats.find((c) => c.name !== status) || {}).name || null }; }
    case 'chart': return { kind: ['bar', 'stack', 'line', 'area'].includes(u.kind) ? u.kind : null, x: col(u.x, (c) => isCat(c) || isDate(c)) || status || firstCat() || (dates[0] || {}).name || null, split: col(u.split, isCat), measure: normMeasure(t, u.measure), bucket: ['day', 'week', 'month'].includes(u.bucket) ? u.bucket : 'day' };
    case 'pivot': { const r = col(u.rows, isCat) || firstCat(status) || status; return { rows: r, cols: col(u.cols, isCat) || (status && status !== r ? status : firstCat(r)), measure: normMeasure(t, u.measure) }; }
    case 'tree': { const lv = arr(u.levels).map((n) => col(n, isCat)).filter(Boolean).slice(0, 3); return { parent: self ? self.name : null, levels: lv.length ? lv : [firstCat(status), status].filter(Boolean).slice(0, 2) }; }
    default: return {};
  }
}
function normDashWidget(w, def) {
  w = w || {}; const kind = ['kpi', 'bar', 'stack', 'line', 'recent'].includes(w.kind) ? w.kind : w.kind === 'count' || w.kind === 'sum' ? 'kpi' : w.kind === 'by' ? 'bar' : null, t = tableOf(def, snake(w.table)); if (!kind || !t) return null;
  const x = colOf(t, snake(w.x || w.column)), split = colOf(t, snake(w.split)), where = {};
  if (w.where && typeof w.where === 'object') Object.keys(w.where).forEach((k) => { const c = colOf(t, snake(k)); if (c) where[c.name] = c.type === 'select' ? snake(w.where[k]) : w.where[k]; });
  if ((kind === 'bar' || kind === 'stack') && !(x && isCat(x))) return null;
  if (kind === 'line' && !(x && isDate(x))) return null;
  if (kind === 'stack' && !(split && isCat(split))) return null;
  return { kind, label: str(w.label) || label(kind + ' ' + t.name), table: t.name, x: x ? x.name : null, split: split ? split.name : null, measure: normMeasure(t, w.measure || (w.kind === 'sum' && w.column ? 'sum:' + w.column : '')), bucket: ['day', 'week', 'month'].includes(w.bucket) ? w.bucket : 'day', where };
}
function normViews(o, def) {
  o = o || {}; const views = {}, d = o.dashboard || {}; def.tables.forEach((t) => { views[t.name] = []; });
  arr(o.views).forEach((v) => { const t = tableOf(def, snake(v && v.table)); if (!t) return; arr(v.use).forEach((u) => { u = typeof u === 'string' ? { type: u } : u || {}; let type = String(u.type || '').toLowerCase(); type = VIEW_ALIAS[type] || type; if (!type || views[t.name].some((x) => x.type === type)) return; views[t.name].push(Object.assign({ type, why: str(u.why) || VIEW_WHAT[type] || '' }, DATA_VIEWS.includes(type) && !viewFit(def, t, type) ? viewCfg(def, t, type, u) : {})); }); });
  def.tables.forEach((t) => { if (!views[t.name].some((x) => x.type === 'table')) views[t.name].push({ type: 'table', why: VIEW_WHAT.table }); });
  const dt = tableOf(def, snake(d.date && d.date.table)), dc = dt && colOf(dt, snake(d.date.column)), all = arr(d.widgets), widgets = all.map((w) => normDashWidget(w, def)).filter(Boolean).slice(0, 10);
  return { views, dash: { title: str(d.title) || 'Dashboard', date: dc && isDate(dc) ? { table: dt.name, column: dc.name } : null, widgets }, dropped: all.length - widgets.length };
}
function mendViews(o, def) { // last attempt: keep what fits from the advisor's answer and fill the gaps by rule, instead of failing the build
  const vw = normViews(o, def), sug = normViews(suggestViews(def), def);
  def.tables.forEach((t) => { const ok = vw.views[t.name].filter((v) => !viewFit(def, t, v.type)); vw.views[t.name] = ok.length >= 2 ? ok : ok.concat(sug.views[t.name].filter((v) => !ok.some((k) => k.type === v.type))); });
  if (!vw.dash.widgets.some((w) => w.kind === 'kpi') || !vw.dash.widgets.some((w) => ['bar', 'stack', 'line'].includes(w.kind))) vw.dash = sug.dash;
  return vw;
}
function checkViews(def, vw) {
  const out = [], thin = def.tables.filter((t) => vw.views[t.name].length < 2).map((t) => t.label), misfit = [];
  def.tables.forEach((t) => vw.views[t.name].forEach((v) => { const why = viewFit(def, t, v.type); if (why) misfit.push(label(v.type) + ' on ' + t.name + ' ' + why); }));
  out.push(chk('Every table can be seen in at least two ways', !thin.length, thin.length ? 'only one view for ' + thin.join(', ') : def.tables.map((t) => t.label + ': ' + vw.views[t.name].length).join(', ')));
  out.push(chk('Every recommended view fits its table', !misfit.length, misfit.length ? misfit.slice(0, 3).join('; ') : 'checked against the catalog rules'));
  const k = vw.dash.widgets.filter((w) => w.kind === 'kpi').length, c = vw.dash.widgets.filter((w) => w.kind === 'bar' || w.kind === 'stack' || w.kind === 'line').length;
  out.push(chk('The dashboard has numbers and charts', k >= 1 && c >= 1, k + ' numbers, ' + c + ' charts' + (vw.dropped ? ', ' + vw.dropped + ' unusable widgets left out' : '')));
  return out;
}
function suggestViews(def) { // the rule-based plan: used when the advisor cannot pass, and for tables added later
  const P = def.process, pt = tableOf(def, P.table), views = def.tables.map((t) => ({ table: t.name, use: DATA_VIEWS.filter((v) => !viewFit(def, t, v)).map((v) => ({ type: v })) }));
  const cat = pt.columns.find((c) => isCat(c) && c.name !== P.column), date = pt.columns.find(isDate), w = [{ kind: 'kpi', label: pt.label, table: pt.name }];
  P.states.slice(0, 3).forEach((s) => w.push({ kind: 'kpi', label: s.label, table: pt.name, where: { [P.column]: s.id } }));
  w.push({ kind: 'bar', label: pt.label + ' by ' + label(P.column).toLowerCase(), table: pt.name, x: P.column });
  if (date) w.push({ kind: 'line', label: pt.label + ' over time', table: pt.name, x: date.name, bucket: 'day' });
  if (cat) w.push({ kind: 'stack', label: pt.label + ' by ' + cat.label.toLowerCase(), table: pt.name, x: cat.name, split: P.column });
  w.push({ kind: 'recent', label: 'Latest ' + pt.label.toLowerCase(), table: pt.name });
  return { views, dashboard: { title: 'Dashboard', date: date ? { table: pt.name, column: date.name } : null, widgets: w } };
}
function refreshViews(app) { // after a change to the tables: keep the advisor's plan where it still fits, and fill the gaps by rule
  const def = app.def, sug = suggestViews(def), ruleFor = (t) => (sug.views.find((v) => v.table === t.name) || { use: [] }).use;
  const use = (t) => { const kept = ((def.views || {})[t.name] || []).filter((v) => !viewFit(def, t, v.type)); return kept.length >= 2 ? kept : kept.concat(ruleFor(t).filter((v) => !kept.some((k) => k.type === v.type))); };
  let vw = normViews({ views: def.tables.map((t) => ({ table: t.name, use: use(t) })), dashboard: def.dash || sug.dashboard }, def);
  if (checkViews(def, vw).some((c) => !c.ok)) vw = normViews({ views: def.tables.map((t) => ({ table: t.name, use: use(t) })), dashboard: sug.dashboard }, def);
  def.views = vw.views; def.dash = vw.dash; return vw;
}
function migrateApp(app) { // apps saved by an earlier version of this page get what the View advisor would have written
  app.flow = normFlow(app.flow); if (!app.reviews) app.reviews = {}; // and the standard workflow, which is theirs to change
  Object.keys(app.reviews).forEach((k) => { const R = app.reviews[k]; if (!REVIEWERS[k] || !R || R.status !== 'ok' || !app.flow.reviewers.includes(k)) delete app.reviews[k]; else arr(R.findings).forEach((f) => { if (f.state === 'applying') f.state = 'open'; }); }); // a review that was cut off by a reload is dropped
  const def = app.def; if (!def || !def.theme) return;
  STATIONS.forEach((s) => { if (!app.line[s.id]) app.line[s.id] = blankLine(); });
  if (def.team === undefined) def.team = null; if (def.team && !def.board && def.tables.length && def.process) def.board = suggestBoard(def); if (!def.team) def.board = null; if (!def.theme.density) def.theme.density = 'comfortable'; if (!def.views) def.views = {};
  if (def.screens.length && def.screens[0].type !== 'dashboard' && def.screens.some((s) => s.type === 'dashboard')) def.screens.sort((a, b) => (b.type === 'dashboard') - (a.type === 'dashboard')); // the overview comes first
  if (!def.process || !def.tables.length || !def.brief || (def.dash && Object.keys(def.views).length)) return;
  const vw = refreshViews(app), L = app.line.views, roleIds = def.brief.roles.map((r) => r.id);
  let dash = def.screens.find((s) => s.type === 'dashboard'); if (!dash) { dash = { id: 's' + (def.screens.length + 301), name: 'Dashboard', type: 'dashboard', table: def.process.table, roles: [], columns: [], icon: 'pie', auto: true }; def.screens.push(dash); }
  roleIds.forEach((r) => { if (!def.screens.some((s) => s.type === 'dashboard' && s.roles.includes(r))) dash.roles.push(r); });
  if (app.line.backend.status === 'ok') { L.status = 'ok'; L.attempt = 1; L.checks = checkViews(def, vw); L.facts = [Object.keys(vw.views).reduce((k, t) => k + vw.views[t].length, 0) + ' views for ' + def.tables.length + ' tables', vw.dash.widgets.length + ' dashboard widgets']; L.attempts = [{ n: 1, ok: true, issues: [] }]; L.note = 'Added by the update'; }
  app.rev = (app.rev || 0) + 1;
}
function viewsOf(def, t) { const v = (def.views && def.views[t.name]) || []; return v.length ? v : [{ type: 'table', why: VIEW_WHAT.table }]; }
function renderViewsTest(app) { // mount every recommended view of every table, and the dashboard, with the real data
  const def = app.def, users = appUsers(app), host = document.createElement('div'), fails = []; let n = 0;
  def.tables.forEach((t) => { const u = users.find((x) => accOf(def, x.role, t.name).list !== 'none'); if (!u) return; viewsOf(def, t).forEach((v) => { n++; const scr = { id: 'vt_' + t.name, name: t.label, type: v.type, table: t.name, roles: [u.role], columns: t.columns.slice(0, 6).map((c) => c.name) }; try { render(html`<div class="app"><${Explorer} app=${app} user=${u} pane=${newPane(9)} scr=${scr} test=${true} /></div>`, host); if (!host.querySelector('.vx-body')) throw new Error('nothing drawn'); } catch (e) { fails.push(label(v.type) + ' on ' + t.name + ': ' + ((e && e.message) || e)); } }); });
  const boss = users[users.length - 1]; if (boss) { n++; try { render(html`<div class="app"><${Dash} app=${app} user=${boss} pane=${newPane(9)} scr=${{ id: 'vt_dash', name: 'Dashboard', type: 'dashboard' }} test=${true} /></div>`, host); if (!host.querySelector('.dash')) throw new Error('nothing drawn'); } catch (e) { fails.push('Dashboard: ' + ((e && e.message) || e)); } }
  try { render(null, host); } catch (e) {}
  return chk('Every view and the dashboard draw with the real data', !fails.length, fails.length ? fails.slice(0, 3).join('; ') : n + ' views mounted');
}

/* ---------- screens: which pages each role gets, and the layout ---------- */
const mayOpen = (def, r, type, tn) => (type === 'dashboard' ? true : type === 'agents' ? canRunTeam(def, r) : type === 'form' ? accOf(def, r, tn).create : accOf(def, r, tn).list !== 'none');
function normUI(o, def) {
  o = o || {}; const roleIds = def.brief.roles.map((r) => r.id), th = o.theme || {}; let n = 0;
  const screens = arr(o.screens).map((s) => {
    s = s || {}; let type = String(s.type || 'table').toLowerCase(); type = VIEW_ALIAS[type] || type; if (!VIEW_TYPES.includes(type)) type = 'table';
    if (type === 'agents' && !def.team) return null;
    const t = tableOf(def, snake(s.table)) || (type === 'dashboard' ? tableOf(def, def.process.table) : type === 'agents' ? tableOf(def, def.team.input.table) : null);
    if (t && DATA_VIEWS.includes(type) && viewFit(def, t, type)) type = 'table';
    const scr = { id: 's' + ++n, name: str(s.name) || (t ? t.label : 'Screen ' + n), type, table: t ? t.name : snake(s.table), roles: arr(s.roles).map(snake).filter((r) => roleIds.includes(r)), columns: t ? arr(s.columns).map(snake).filter((c) => colOf(t, c)) : [], icon: ICONS[s.icon] ? s.icon : VIEW_ICON[type] };
    if (t) scr.roles = (scr.roles.length ? scr.roles : roleIds).filter((r) => mayOpen(def, r, type, t.name));
    if (t && !scr.columns.length) scr.columns = t.columns.filter((c) => c.type !== 'longtext').slice(0, 6).map((c) => c.name);
    if (t) { const lb = colOf(t, snake(s.label)), g = colOf(t, snake(s.group)), d = colOf(t, snake(s.date)), e = colOf(t, snake(s.end)); if (lb) scr.label = lb.name; if (g && g.type === 'select') scr.group = g.name; if (d && isDate(d)) scr.date = d.name; if (e && e.type === 'date') scr.end = e.name; if (['today', 'week', 'upcoming'].includes(s.range)) { const rd = scr.date || (t.columns.find(isDate) || {}).name; if (rd) { scr.range = s.range; scr.date = rd; } } }
    return scr;
  }).filter(Boolean).slice(0, LIMITS.screens);
  if (def.team && !screens.some((s) => s.type === 'agents')) screens.unshift({ id: 's' + ++n, name: 'Agents', type: 'agents', table: def.team.input.table, roles: roleIds.filter((r) => canRunTeam(def, r)), columns: [], icon: 'bot', auto: true });
  let dash = screens.find((s) => s.type === 'dashboard'); // a dashboard is always there, for every role
  if (!dash) { dash = { id: 's' + ++n, name: (def.dash && def.dash.title) || 'Dashboard', type: 'dashboard', table: def.process.table, roles: [], columns: [], icon: 'pie', auto: true }; screens.push(dash); }
  roleIds.forEach((r) => { if (!screens.some((s) => s.type === 'dashboard' && s.roles.includes(r))) dash.roles.push(r); });
  screens.sort((a, b) => (b.type === 'dashboard') - (a.type === 'dashboard')); // the overview comes first, for everyone
  const tour = arr(o.tour).map((x) => { x = x || {}; return { role: snake(x.role), user: str(x.user).toLowerCase() || null, do: ['open', 'create', 'see', 'transition', 'denied'].includes(x.do) ? x.do : 'open', screen: str(x.screen), table: snake(x.table), values: x.values && typeof x.values === 'object' ? x.values : {}, transition: snake(x.transition), action: snake(x.action), say: str(x.say) }; }).filter((x) => roleIds.includes(x.role)).slice(0, 10);
  const actions = arr(o.actions).map((a) => ({ id: snake(a.id || a.label), label: str(a.label), table: snake(a.table), connector: str(a.connector), tool: str(a.tool), arg: snake(a.arg) })).filter((a) => a.id && tableOf(def, a.table));
  return { theme: { accent: ACCENTS.includes(th.accent) ? th.accent : 'blue', nav: ['top', 'rail', 'side'].includes(th.nav) ? th.nav : 'side', icon: ICONS[th.icon] ? th.icon : 'apps', density: th.density === 'compact' ? 'compact' : 'comfortable' }, screens, tour, actions };
}
function checkScreensShape(def, ui) {
  const out = [], S0 = ui.screens, roles = def.brief.roles;
  const ghost = S0.filter((s) => !tableOf(def, s.table)).map((s) => s.name);
  out.push(chk('Every screen points at a real table and real columns', S0.length > 0 && !ghost.length, ghost.length ? 'no table behind: ' + ghost.join(', ') : S0.length + ' screens'));
  const lone = roles.filter((r) => !S0.some((s) => s.type !== 'dashboard' && s.roles.includes(r.id))).map((r) => r.name);
  out.push(chk('Every role has at least one working screen', !lone.length, lone.length ? 'no screen for ' + lone.join(', ') : ''));
  const misfit = S0.filter((s) => DATA_VIEWS.includes(s.type) && tableOf(def, s.table) && viewFit(def, tableOf(def, s.table), s.type)).map((s) => s.name + ' (' + s.type + ')');
  out.push(chk('Each screen opens a view its table supports', !misfit.length, misfit.length ? misfit.join(', ') : S0.map((s) => VIEW_LABEL[s.type]).filter((v, i, a) => a.indexOf(v) === i).join(', ')));
  const leak = []; S0.forEach((s) => { if (!tableOf(def, s.table) || s.type === 'dashboard') return; s.roles.forEach((r) => { if (!mayOpen(def, r, s.type, s.table)) leak.push(s.name + ' for ' + roleName(def, r)); }); if (!s.roles.length) leak.push(s.name + ' has no roles'); });
  out.push(chk('Screens only show what the role may use', !leak.length, leak.length ? 'not permitted: ' + leak.slice(0, 4).join(', ') : ''));
  const noDash = roles.filter((r) => !S0.some((s) => s.type === 'dashboard' && s.roles.includes(r.id))).map((r) => r.name);
  out.push(chk('Every role can open the dashboard', !noDash.length, noDash.length ? 'missing for ' + noDash.join(', ') : 'a dashboard is always part of the app'));
  return out;
}
