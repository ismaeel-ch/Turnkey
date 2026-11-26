/* ===== Turnkey prototype · share an app by link, and the app-only view =====
   A share link carries the app itself: the five definitions the agents wrote and the rows to start with, compressed into the part of
   the address after the #. Nothing is uploaded. Whoever opens the link gets the app on its own, without the builder around it, and
   their own copy of the data in their own browser. A link is untrusted input, so it goes through the same normalisers and checks as
   an agent's output, and nothing in it is ever run as code. */
const SHARE = { maxCode: 900000, maxJson: 5000000, maxRows: 400 };
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
async function pipeBytes(bytes, through, cap) { // run bytes through a compression stream, refusing to grow past the cap
  const reader = new Blob([bytes]).stream().pipeThrough(through).getReader(), parts = []; let n = 0;
  for (;;) { const r = await reader.read(); if (r.done) break; n += r.value.length; if (cap && n > cap) { try { reader.cancel(); } catch (e) {} throw new Error('This link holds more than an app can.'); } parts.push(r.value); }
  const out = new Uint8Array(n); let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; }); return out;
}
async function squeeze(text) { const raw = new TextEncoder().encode(text); if (typeof CompressionStream === 'function') { try { return '1.' + b64u(await pipeBytes(raw, new CompressionStream('deflate-raw'))); } catch (e) {} } return '0.' + b64u(raw); }
async function unsqueeze(code) {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(code); if (!m) throw new Error('That is not a Turnkey app link.');
  let bytes; try { bytes = unb64u(m[2]); } catch (e) { throw new Error('The link is damaged. Ask for it to be sent again.'); }
  if (m[1] === '0') return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream !== 'function') throw new Error('This browser is too old to open a compressed app link.');
  try { return new TextDecoder().decode(await pipeBytes(bytes, new DecompressionStream('deflate-raw'), SHARE.maxJson)); } catch (e) { throw new Error(/more than an app/.test(String(e && e.message)) ? e.message : 'The link is damaged. Ask for it to be sent again.'); }
}
const framed = () => { try { return window.self !== window.top; } catch (e) { return true; } };
const shareCode = (input) => { const s = str(input).trim(), m = /#app=([01]\.[A-Za-z0-9_-]+)/.exec(s) || /^([01]\.[A-Za-z0-9_-]+)$/.exec(s); return m ? m[1] : null; };
const shareLink = (code) => { let base = ''; try { base = location.origin && location.origin !== 'null' && /^https?:/.test(location.protocol) ? location.origin + location.pathname : ''; } catch (e) {} return (base || 'https://formwork.example/') + '#app=' + code; };

function packOf(app, o) { // everything a browser needs to rebuild the app: what each station wrote, and the rows to start with
  const def = app.def, live = o.data === 'live', strip = (c) => { const x = Object.assign({}, c); delete x.by; delete x.run; return x; }, rowsOf = {};
  if (live) {
    const pos = {}, upos = {}, raw = {}; sqlRun(app.id, 'SELECT "id" FROM "users" ORDER BY "id"', null, 'share').forEach((u, i) => { upos[u.id] = i + 1; });
    def.tables.forEach((t) => { raw[t.name] = sqlRun(app.id, 'SELECT * FROM ' + qi(t.name) + ' ORDER BY "id" LIMIT ' + SHARE.maxRows, null, 'share'); pos[t.name] = {}; raw[t.name].forEach((r, i) => { pos[t.name][r.id] = i + 1; }); });
    def.tables.forEach((t) => { rowsOf[t.name] = raw[t.name].map((r) => { const x = {}; t.columns.forEach((c) => { const v = r[c.name]; if (v == null || v === '') return; x[c.name] = c.type === 'ref' ? (pos[c.ref] || {})[v] || null : c.type === 'user' ? upos[v] || null : c.type === 'bool' ? !!v : v; }); if (!t.owner && upos[r.created_by]) x._by = upos[r.created_by]; return x; }); });
  } else def.tables.forEach((t) => { rowsOf[t.name] = ((app.seed && app.seed.rows) || {})[t.name] || []; });
  const brief = Object.assign({}, def.brief); delete brief.sources;
  return { f: 'formwork-app', v: 1, name: app.name, request: app.request, tpl: app.tpl || null, data: live ? 'live' : 'demo', as: o.as || null, by: me() ? me().name : '',
    research: brief,
    database: { tables: def.tables.map((t) => ({ name: t.name, label: t.label, one: t.one, title: t.title, owner: t.owner, columns: t.columns.map(strip), rows: rowsOf[t.name] })), users: def.users.map((u) => ({ name: u.name, role: u.role })) },
    backend: { process: def.process, access: def.access, team: def.team },
    views: { views: Object.keys(def.views || {}).map((t) => ({ table: t, use: def.views[t] })), dashboard: def.dash, board: def.board || null },
    screens: { screens: def.screens, theme: def.theme, tour: def.tour, actions: def.actions }, tests: { cases: def.cases || [] } };
}
function readPack(json) { let p; try { p = JSON.parse(json); } catch (e) { throw new Error('The link is damaged. Ask for it to be sent again.'); } if (!p || p.f !== 'formwork-app' || p.v !== 1 || typeof p.research !== 'object' || typeof p.database !== 'object') throw new Error('That link does not hold a Turnkey app.'); return p; }
function appFromPack(pack, key, preview) { // rebuild the app station by station. Each part must pass the same checks an agent's output must pass.
  const id = uid('app'), app = { id, owner: 'guest', shared: { key, by: str(pack.by).slice(0, 60), at: Date.now(), as: str(pack.as).slice(0, 40), data: pack.data === 'live' ? 'live' : 'demo', preview: !!preview, ver: /^\d+(\.\d+){0,2}$/.test(str(pack.ver)) ? str(pack.ver) : '', uid: /^[A-Za-z0-9_-]{4,40}$/.test(str(pack.uid)) ? str(pack.uid) : '', notes: arr(pack.notes).map((n) => str(n).slice(0, 200)).filter(Boolean).slice(0, 12) }, name: str(pack.name).slice(0, 40) || 'Shared app', icon: 'apps', accent: 'blue', request: str(pack.request).slice(0, 600), tpl: REC[pack.tpl] ? pack.tpl : null, mode: 'demo', status: 'new', created: Date.now(), updated: Date.now(), def: blankDef(), seed: null, line: {}, runs: [], chat: [], answers: {}, rev: 0, renamed: true };
  STATIONS.forEach((s) => { app.line[s.id] = blankLine(); }); S.apps[id] = app;
  const run = newRun(app, 'open', 'Opened from a link', 'demo'), parts = [['research', pack.research], ['database', pack.database], ['backend', pack.backend], ['views', pack.views], ['screens', pack.screens], ['walkthrough', null]];
  try {
    parts.forEach((x) => {
      const st = x[0], L = app.line[st], r = APPLY[st](app, x[1], run, 1), bad = r.checks.filter((c) => !c.ok);
      L.attempt = 1; L.checks = r.checks; L.facts = r.facts; L.attempts = [{ n: 1, ok: !bad.length, issues: bad.map((c) => c.label + (c.detail ? ': ' + c.detail : '')) }]; L.status = bad.length ? 'failed' : 'ok'; L.t1 = Date.now(); app.rev++;
      if (bad.length && st !== 'walkthrough') throw new Error('The ' + STATIONS.find((s) => s.id === st).name.toLowerCase() + ' part of this link did not pass its checks (' + bad[0].label + ').');
      if (st === 'research' && pack.research && pack.research.decision && typeof pack.research.decision === 'object') app.def.brief.decision = { text: str(pack.research.decision.text).slice(0, 300), answer: str(pack.research.decision.answer).slice(0, 300) };
    });
  } catch (e) { run.status = 'failed'; dbDrop(id); delete S.apps[id]; throw e; }
  app.def.cases = normCases(pack.tests, app.def); app.rev++;
  run.status = 'ok'; run.t1 = Date.now(); app.status = 'ready'; app.updated = Date.now();
  pushChat(app, 'orchestrator', 'This app was opened from a share link' + (app.shared.by ? ' sent by ' + app.shared.by : '') + '. Its definition passed every check again in this browser, and its data is a copy that lives here.');
  dbSave(id); return app;
}
async function openShared(input, o) { // from a link, a pasted code, or the owner's preview
  o = o || {}; const code = shareCode(input); if (!code) throw new Error('That is not a Turnkey app link. A link ends with #app= followed by a long code.');
  if (code.length > SHARE.maxCode) throw new Error('That link is too long to be an app.');
  if (!S.shared) S.shared = {};
  const key = 'k' + hashStr(code); let app = S.shared[key] ? S.apps[S.shared[key]] : null, fresh = false;
  if (!app || app.status !== 'ready' || !dbExists(app.id)) {
    const pack = readPack(await unsqueeze(code)); if (app) deleteApp(app);
    if (o.preview) Object.values(S.apps).filter((a) => a.shared && a.shared.preview).forEach((a) => { delete S.shared[a.shared.key]; deleteApp(a); }); // one preview copy at a time
    app = appFromPack(pack, key, o.preview); S.shared[key] = app.id; fresh = true;
    const old = !o.preview && app.shared.uid ? Object.values(S.apps).find((a) => a.id !== app.id && a.owner === 'guest' && a.shared && !a.shared.preview && a.shared.uid === app.shared.uid && a.status === 'ready' && dbExists(a.id)) : null;
    if (old && verCmp(app.shared.ver, old.shared.ver) > 0) { // a newer version of an app this browser already has: update it and keep the records
      const kept = carryData(old, app); app.shared.updated = { from: old.shared.ver || 'an earlier version', kept: kept ? kept.rows : null, at: Date.now() }; if (old.installed) app.installed = old.installed; deleteApp(old);
      emit('CUSTOM', { name: 'app_updated', app: app.id, value: { from: app.shared.updated.from, to: app.shared.ver, rowsKept: kept ? kept.rows : 0 } });
    }
  }
  if (!o.preview && app.shared.preview) app.shared.preview = false; // opened for real: keep the copy
  enterSolo(app, { from: o.preview ? 'preview' : 'link', as: app.shared.as, back: o.back || null }); commit(); return app;
}
function enterSolo(app, o) { o = o || {}; const pane = newPane(7), u = o.as ? appUsers(app).find((x) => x.username === o.as) : null; if (u) pane.uid = u.id; U.solo = { app: app.id, pane, from: o.from || 'link', back: o.back || null }; U.dialog = null; U.sheet = null; U.toasts = []; U.tour = null; notify(); }
function exitSolo() { const so = U.solo; U.solo = null; U.sheet = null; try { if (/#app=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch (e) {} if (so && so.back && S.apps[so.back]) { openTab(so.back); } commit(); }
function keepShared(app) { // a guest copy becomes one of your own apps
  if (!me() || !app.shared) return; let name = app.name, k = 2; while (myApps().some((a) => a.name === name)) name = app.name + ' ' + k++;
  delete S.shared[app.shared.key]; app.owner = S.session; app.name = name; delete app.shared; app.updated = Date.now(); runTestsSync(app); U.solo = null; openTab(app.id); toast(name + ' is in your library now. You can change it by chat like any app you built.', 'success'); commit();
}
const sharedApps = () => Object.values(S.apps).filter((a) => a.owner === 'guest' && a.shared && !a.shared.preview && a.status === 'ready').sort((a, b) => b.updated - a.updated);

/* ---------- the share dialog ---------- */
function openShare(app) { U.share = { app: app.id, data: 'demo', as: '', code: null, busy: true, err: '', raw: 0, rows: 0 }; openDialog('share', { app: app.id }); makeShare(); }
async function makeShare() {
  const sh = U.share, app = sh && S.apps[sh.app]; if (!app) return; const tag = sh.data + '|' + sh.as; sh.busy = true; sh.err = ''; notify();
  try { const rel = relOf(app); if (!rel) { sh.code = null; sh.busy = false; return notify(); } // a link carries a released version
    const dirty = isDirty(app); let pack; sh.ver = rel.v; sh.draft = dirty;
    if (dirty) { if (!rel.pack) throw new Error('The snapshot of version ' + rel.v + ' is gone. Release the draft to share it.'); pack = readPack(await unsqueeze(rel.pack)); pack.as = sh.as || null; pack.by = me() ? me().name : ''; }
    else { pack = packOf(app, sh); pack.ver = rel.v; pack.uid = app.uid; pack.notes = rel.notes; }
    const json = JSON.stringify(pack), code = await squeeze(json); if (U.share !== sh || tag !== sh.data + '|' + sh.as) return; sh.code = code; sh.raw = json.length; sh.rows = pack.database.tables.reduce((n, t) => n + t.rows.length, 0); } catch (e) { sh.code = null; sh.err = String((e && e.message) || e); }
  sh.busy = false; notify();
}
function ShareDialog({ p }) {
  const app = S.apps[p.app], sh = U.share; if (!app || !sh) return null;
  const users = appUsers(app), link = sh.code ? shareLink(sh.code) : '', set = (k, v) => { sh[k] = v; sh.code = null; makeShare(); }, seedN = app.def.tables.reduce((n, t) => n + (((app.seed && app.seed.rows) || {})[t.name] || []).length, 0), liveN = app.def.tables.reduce((n, t) => n + dbCount(app.id, t.name), 0);
  const preview = async () => { try { closeDialog(); await openShared(sh.code, { preview: true, back: app.id }); } catch (e) { toast(String((e && e.message) || e), 'danger'); } };
  const rel = relOf(app), dirty = isDirty(app), block = releaseBlock(app), first = async () => { sh.rbusy = true; notify(); const r = await releaseApp(app, 'first', draftNotes(app)); sh.rbusy = false; if (r) makeShare(); else notify(); };
  if (!rel) return html`<${Dialog} title=${'Share ' + app.name} onClose=${closeDialog} cls="share" foot=${html`<button class="btn" onClick=${closeDialog}>Not now</button><button class="btn primary" id="sh-release" data-autofocus disabled=${!!block || sh.rbusy} onClick=${first}>${sh.rbusy ? html`<${Spinner} />` : html`<${Icon} n="rocket" s="16" />`}Release version 1.0 and make the link</button>`}>
    <div class="col gap12"><div class="install-app"><${AppLogo} app=${app} size=${48} /><div class="col gap0"><strong class="t-sub2">${app.name}</strong><span class="muted t-cap">Draft · not released yet</span></div></div>
      <p>A link always carries a released version, so people never get a half-finished draft. Releasing runs every test once more and takes a moment.</p>
      ${block && html`<${MBar} tone="warning">${block}<//>`}</div><//>`;
  return html`<${Dialog} title=${'Share ' + app.name} onClose=${closeDialog} cls="share" foot=${html`<button class="btn" disabled=${!sh.code} onClick=${preview}><${Icon} n="eye" s="16" />Preview what they see</button><button class="btn primary" data-autofocus disabled=${!sh.code} onClick=${() => copyText(link, 'Link')}><${Icon} n="copy" s="16" />Copy link</button>`}>
    <div class="install-app"><${AppLogo} app=${app} size=${48} /><div class="col gap0 grow"><strong class="t-sub2">${app.name}</strong><span class="muted t-cap" id="sh-ver">Version ${rel.v}${dirty ? ' · your draft changes are not in this link' : ''}</span></div>${dirty && html`<button class="btn sm" onClick=${() => { closeDialog(); U.view[app.id] = 'release'; notify(); }}>Release the draft</button>`}</div>
    <p>Anyone with the link opens <strong>${app.name}</strong> on its own: the app, its icon, its sign-in screen and its data. They can install it. They do not see Turnkey, the agents or your other apps.</p>
    <div class="share-grid">
      <${Field} id="sh-data" label="They start with" hint=${sh.data === 'live' ? 'A copy of the ' + liveN + ' records as they are now. The activity history stays with you.' : 'The ' + seedN + ' made-up rows the Database agent wrote, with dates that stay around today.'}><${Seg} label="Which data the link carries" items=${[{ id: 'demo', label: 'Demo data' }, { id: 'live', label: 'Current records' }]} value=${dirty ? 'demo' : sh.data} onChange=${(v) => (dirty && v === 'live' ? toast('Current records fit the draft, not version ' + rel.v + '. Release the draft to share them.', 'info') : set('data', v))} /><//>
      <${Field} id="sh-as" label="They open it as" hint="A person skips the sign-in screen. They can still switch."><select class="select" id="sh-as" value=${sh.as} onChange=${(e) => set('as', e.target.value)}><option value="">The sign-in screen</option>${users.map((u) => html`<option key=${u.id} value=${u.username}>${u.name} · ${roleName(app.def, u.role)}</option>`)}</select><//>
    </div>
    <${Field} id="sh-link" label="Link" error=${sh.err || null} hint=${sh.code ? fmtBytes(link.length) + ' · the app and ' + sh.rows + ' rows, compressed from ' + fmtBytes(sh.raw) + ' · nothing is uploaded' : 'Packing the app'}>
      <div class="row"><input class="input grow mono" id="sh-link" readonly value=${sh.busy ? 'Packing the app…' : link} onFocus=${(e) => e.target.select()} /><button class="btn icon" title="Copy the link" aria-label="Copy the link" disabled=${!sh.code} onClick=${() => copyText(link, 'Link')}><${Icon} n="copy" /></button></div><//>
    <ul class="share-facts">
      <li><${Icon} n="shield" s="16" /><span>The link is the app. It is checked again, station by station, in the browser that opens it, and nothing in it runs as code.</span></li>
      <li><${Icon} n="people" s="16" /><span>Everyone who opens it works in their own copy, saved in their own browser. One database shared by everyone needs a small store on the server, which the free hosting plan does not keep.</span></li>
      ${framed() && html`<li><${Icon} n="info" s="16" /><span>Inside this prototype viewer a link cannot open a new page, so use Preview, or paste the link under Open a shared app.</span></li>`}
    </ul><//>`;
}
function OpenLinkDialog({ p }) {
  const go = async (e) => { e.preventDefault(); p.err = ''; p.busy = true; notify(); try { await openShared(p.text, { back: null }); } catch (er) { p.err = String((er && er.message) || er); p.busy = false; notify(); } };
  return html`<${Dialog} title="Open a shared app" onClose=${closeDialog}><form class="col gap12" onSubmit=${go}>
    <p class="muted">Paste a Turnkey app link. The app opens on its own, with its own copy of the data in this browser.</p>
    <${Field} id="ol-text" label="Link" error=${p.err || null}><textarea class="textarea mono" id="ol-text" rows="4" data-autofocus placeholder="https://…#app=1.xxxxx" value=${p.text || ''} onInput=${(e) => { p.text = e.target.value; }}></textarea><//>
    <div class="row end"><button type="button" class="btn" onClick=${closeDialog}>Cancel</button><button type="submit" class="btn primary" disabled=${!!p.busy}>${p.busy ? html`<${Spinner} />` : html`<${Icon} n="open" s="16" />`}Open the app</button></div></form><//>`;
}
function AboutAppDialog({ p }) {
  const app = S.apps[p.app]; if (!app) return null; const def = app.def, st = testStats(app);
  return html`<${Dialog} title=${'About ' + app.name} onClose=${closeDialog} foot=${html`<button class="btn primary" data-autofocus onClick=${closeDialog}>Close</button>`}>
    <div class="install-app"><${AppLogo} app=${app} size=${48} /><div class="col gap0"><strong class="t-sub2">${app.name}</strong><span class="muted t-cap" id="about-ver">${verText(app)}${app.installed ? ' · installed' : ''}</span></div></div>
    <p>${def.brief ? def.brief.summary : app.request}</p>
    ${(app.shared ? arr(app.shared.notes) : relOf(app) ? relOf(app).notes : []).length > 0 && html`<div class="col gap4"><strong>What is new in this version</strong><ul class="rel-notes">${(app.shared ? app.shared.notes : relOf(app).notes).map((n, i) => html`<li key=${i}>${n}</li>`)}</ul></div>`}
    <dl class="about-dl"><dt>Built with</dt><dd>Turnkey. Agents wrote this app as definitions: a brief, tables, rules, views, pages and test cases. A fixed runtime runs them.</dd>
      <dt>Inside</dt><dd>${def.tables.length} tables · ${def.process ? deriveEndpoints(def).length : 0} endpoints · ${def.screens.length} pages${st ? ' · ' + st.passed + ' of ' + st.total + ' tests pass' : ''}</dd>
      <dt>Your data</dt><dd>${app.shared ? 'A copy that lives in this browser. Nothing you enter is sent anywhere, and nobody else sees it.' : 'Stored in this browser, in a SQLite file.'}</dd>
      <dt>People</dt><dd>${appUsers(app).map((u) => u.name + ' (' + roleName(def, u.role) + ')').join(', ')}. Every password is demo. The data is made up.</dd>
      ${app.shared && app.shared.by ? html`<dt>Shared by</dt><dd>${app.shared.by}</dd>` : null}</dl><//>`;
}

/* ---------- the app-only view ---------- */
function SoloShell() {
  const so = U.solo, app = S.apps[so.app], signed = !!(S.session && me()), up = app.shared && app.shared.updated && !app.shared.updated.seen ? app.shared.updated : null;
  useEffect(() => { setIdentity(app); return clearIdentity; }, [app.id, app.name, app.rev]);
  const reset = async () => { if (await confirmBox({ title: 'Reset the data in ' + app.name + '?', body: 'Every table is emptied and the rows the app started with are put back.', yes: 'Reset data' })) resetAppData(app); };
  const extra = [{ label: app.installed ? 'Installed on this device' : 'Install this app', icon: 'install', on: () => openDialog('installapp', { app: app.id }) }, { label: 'About this app', icon: 'info', on: () => openDialog('aboutapp', { app: app.id }) }, { label: 'Reset the data', icon: 'reset', on: reset }, signed && app.shared && !app.shared.preview ? { label: 'Save a copy to my library', icon: 'save', on: () => keepShared(app) } : null, '-', { label: so.from === 'preview' ? 'Back to sharing' : signed ? 'Back to Turnkey' : 'Open Turnkey', icon: 'arrowLeft', on: exitSolo }].filter(Boolean);
  return html`<div class="solo" data-solo=${so.from}>
    ${so.from === 'preview' && html`<div class="solo-note" role="status"><${Icon} n="eye" s="16" /><span class="grow">Preview: this is all that someone with the link sees.</span><button class="btn sm" onClick=${exitSolo}>Close preview</button></div>`}
    ${up && html`<div class="solo-note ok" role="status"><${Icon} n="sync" s="16" /><span class="grow"><strong>Updated to version ${app.shared.ver}</strong> from ${up.from}. ${up.kept == null ? 'Your earlier records could not be carried over, so it starts with sample data.' : 'Your ' + up.kept + ' records were kept.'}${app.shared.notes.length ? ' New: ' + app.shared.notes.slice(0, 2).join(' · ') : ''}</span><button class="btn sm" onClick=${() => { up.seen = true; commit(); }}>OK</button></div>`}
    ${so.from === 'link' && !app.installed && !so.noInstall && html`<div class="solo-note install" role="status"><${AppLogo} app=${app} size=${24} /><span class="grow">Install <strong>${app.name}</strong> to open it from your desktop or home screen, under its own icon.</span><button class="btn sm primary" id="solo-install" onClick=${() => openDialog('installapp', { app: app.id })}>Install</button><button class="btn subtle icon sm" aria-label="Not now" onClick=${() => { so.noInstall = true; notify(); }}><${Icon} n="dismiss" s="16" /></button></div>`}
    <${AppPane} app=${app} pane=${so.pane} solo=${extra} />
  </div>`;
}
