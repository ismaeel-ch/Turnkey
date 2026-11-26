/* ===== Turnkey prototype · phone layouts =====
   On a phone nothing is a shrunken web page. A built app gets a title bar, a bottom tab bar, a floating New button, full-screen
   record pages and bottom sheets. The builder gets its own bottom navigation, a switcher for open workspaces, and opens built apps
   full screen. A built app switches by the width it is given (so a narrow pane on a desktop looks like a phone too); the builder
   switches by the width of the window. */
function useElWidth() { // the width of an element that may come and go between renders
  const st = useState(0), ro = useRef(null), set = st[1];
  const ref = useRef((el) => { if (ro.current) { ro.current.disconnect(); ro.current = null; } if (!el) return; const fit = () => set((old) => (el.clientWidth && el.clientWidth !== old ? el.clientWidth : old)); fit(); if (typeof ResizeObserver !== 'undefined') { ro.current = new ResizeObserver(fit); ro.current.observe(el); } }).current;
  return [ref, st[0]];
}
const isCompact = (w) => (w || window.innerWidth) <= 640;
function Sheet({ title, sub, onClose, children, cls, tall }) { // a panel that rises from the bottom; drag the handle down, tap outside or press Escape to close
  const ref = useRef(), drag = useRef({ on: false, y: 0 }).current;
  useEffect(() => { const el = ref.current; if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} } }, []);
  const ts = (e) => { drag.on = true; drag.y = e.touches[0].clientY; }, tm = (e) => { if (!drag.on || !ref.current) return; const dy = Math.max(0, e.touches[0].clientY - drag.y); ref.current.style.transition = 'none'; ref.current.style.transform = 'translateY(' + dy + 'px)'; };
  const te = (e) => { if (!drag.on || !ref.current) return; drag.on = false; const t = e.changedTouches && e.changedTouches[0], dy = t ? Math.max(0, t.clientY - drag.y) : 0; ref.current.style.transition = ''; ref.current.style.transform = ''; if (dy > 90) onClose(); };
  return html`<div class=${cx('sheet-wrap', cls)} onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section class=${cx('sheet', tall && 'tall')} role="dialog" aria-modal="true" aria-label=${title} tabindex="-1" ref=${ref} onKeyDown=${(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div class="sheet-top" onTouchStart=${ts} onTouchMove=${tm} onTouchEnd=${te} onTouchCancel=${te}>
        <button class="sheet-grab" aria-label="Close" onClick=${onClose}><span></span></button>
        <header class="sheet-head"><div class="col gap0 grow"><h2 class="t-sub2">${title}</h2>${sub && html`<span class="t-cap muted">${sub}</span>`}</div><button class="btn subtle icon" aria-label="Close" onClick=${onClose}><${Icon} n="dismiss" /></button></header>
      </div>
      <div class="sheet-body">${children}</div>
    </section></div>`;
}
const SheetRow = ({ icon, av, label: text, hint, on, onClick, check, danger, disabled, end }) => html`<button class=${cx('sheet-i', on && 'on', danger && 'danger')} disabled=${disabled} onClick=${onClick}>${av || (icon && html`<span class="sheet-ic"><${Icon} n=${icon} /></span>`)}<span class="col gap0 grow"><span class="sheet-l">${text}</span>${hint && html`<span class="t-cap muted">${hint}</span>`}</span>${end}${check && html`<${Icon} n="check" s="16" />`}</button>`;

/* ---------- inside a built app ---------- */
function AppTabs({ screens, scr, pane, go }) { // up to five places at the bottom; the rest go under More
  const max = screens.length > 5 ? 4 : 5, main = screens.slice(0, max), rest = screens.slice(max), inRest = !!scr && rest.some((s) => s.id === scr.id);
  return html`<nav class="app-tabs" aria-label="Pages">${main.map((s) => html`<button key=${s.id} class=${cx('tab-i', scr && s.id === scr.id && 'on')} aria-current=${scr && s.id === scr.id ? 'page' : undefined} onClick=${() => go(s.id)}><span class="tab-ic"><${Icon} n=${s.icon} s="24" /></span><span class="tab-l">${s.name}</span></button>`)}
    ${rest.length > 0 && html`<button class=${cx('tab-i', inRest && 'on')} aria-haspopup="dialog" aria-label=${'More pages: ' + rest.map((s) => s.name).join(', ')} onClick=${() => { pane.sheet = 'more'; notify(); }}><span class="tab-ic"><${Icon} n="more" s="24" /></span><span class="tab-l">More</span></button>`}</nav>`;
}
function AppSheets({ app, pane, user, users, screens, scr, go, swap, solo }) {
  const def = app.def, close = () => { pane.sheet = null; notify(); }, max = screens.length > 5 ? 4 : 5;
  if (pane.sheet === 'more') return html`<${Sheet} title="More pages" onClose=${close}><div class="sheet-list">${screens.slice(max).map((s) => html`<${SheetRow} key=${s.id} icon=${s.icon} label=${s.name} on=${scr && s.id === scr.id} check=${scr && s.id === scr.id} onClick=${() => go(s.id)} />`)}</div><//>`;
  return html`<${Sheet} title=${user.name} sub=${roleName(def, user.role) + ' · ' + app.name} onClose=${close}>
    <div class="sheet-h">Switch person</div>
    <div class="sheet-list">${users.map((u) => html`<${SheetRow} key=${u.id} av=${html`<${Avatar} name=${u.name} size="sm" />`} label=${u.name} hint=${roleName(def, u.role)} on=${u.id === user.id} check=${u.id === user.id} onClick=${() => swap(u)} />`)}</div>
    <div class="sheet-list">${arr(solo).map((it, i) => (it === '-' ? null : html`<${SheetRow} key=${i} icon=${it.icon} label=${it.label} onClick=${() => { close(); it.on(); }} />`))}<${SheetRow} icon="signOut" label="Sign out" onClick=${() => swap(null)} /></div><//>`;
}

/* ---------- the builder on a phone ---------- */
const sheetOpen = (kind, more) => { U.sheet = Object.assign({ kind }, more || {}); notify(); }, sheetClose = () => { U.sheet = null; notify(); };
function PhoneBar({ tabs, tab }) { // title bar: home, the workspace switcher, the menu
  const app = tab && tab.app ? S.apps[tab.app] : null, acct = me();
  return html`<header class="titlebar phone">
    <button class="brand" aria-label="Home" onClick=${() => openTab(null)}><${Logo} /></button>
    <button class="ws-btn" aria-haspopup="dialog" aria-label=${'Open workspaces. Current: ' + (app ? app.name : 'Home')} data-tour="tabs" onClick=${() => sheetOpen('tabs')}>
      ${app ? html`<span class=${'wtab-ic acc-' + app.accent}><${Icon} n=${app.icon} s="12" /></span>` : html`<${Icon} n="home" s="16" />`}<span class="ellipsis">${app ? app.name : 'Home'}</span><span class="tab-n">${tabs.length}</span><${Icon} n="chevDown" s="16" /></button>
    <span class="grow"></span>
    ${!online() && html`<span class="badge b-warning">Offline</span>`}
    <button class="acct" aria-haspopup="dialog" aria-label="Menu" data-tour="account" onClick=${() => sheetOpen('menu')}><${Avatar} name=${acct.name} size="sm" acc="blue" /></button>
  </header>`;
}
function PhoneNav({ app }) { // bottom navigation of a workspace
  const view = viewOf(app), chat = chatShown(), rel = relOf(app), needs = app.line.research.status === 'waiting' || !!PENDING[app.id], st = testStats(app);
  const go = (v) => { U.view[app.id] = v; if (chat) setChat(false); U.sheet = null; notify(); };
  const item = (id, icon, text, on, onClick, dot) => html`<button key=${id} class=${cx('tab-i', on && 'on')} aria-current=${on ? 'page' : undefined} onClick=${onClick}><span class="tab-ic"><${Icon} n=${icon} s="24" />${dot && html`<i class=${'tab-dot ' + dot}></i>`}</span><span class="tab-l">${text}</span></button>`;
  return html`<nav class="phone-nav" aria-label="Workspace" data-tour="views">
    ${item('build', 'flow', 'Build', !chat && view === 'build', () => go('build'), RUNS[app.id] ? 'live' : null)}
    ${item('app', 'window', 'App', !chat && view === 'app', () => go('app'))}
    ${item('release', 'rocket', 'Release', !chat && view === 'release', () => go('release'), app.status === 'ready' && (!rel || isDirty(app)) ? 'warn' : null)}
    ${item('chat', 'chat', 'Chat', chat, () => { setChat(!chat); }, needs ? 'warn' : null)}
    ${item('more', 'more', 'More', !chat && isDetail(view), () => sheetOpen('more', { app: app.id }), st && st.failed ? 'bad' : null)}
  </nav>`;
}
function AppLauncher({ app }) { // the App tab on a phone: the app opens full screen, like an app, instead of inside the builder
  const def = app.def, users = appUsers(app), ready = def.screens.length > 0 && app.status === 'ready';
  if (!ready) return html`<div class="launch"><${Empty} icon="layout" title="The app is not built yet" text="When the Screens station has passed its checks, the app opens from here." /></div>`;
  const open = (u) => enterSolo(app, { from: 'own', as: u ? u.username : null, back: app.id });
  return html`<div class="launch scroll" data-tour="stage">
    <div class=${'launch-hero acc-' + def.theme.accent}><${AppLogo} app=${app} size=${72} /><h2 class="t-sub1">${app.name}</h2><p class="muted">${def.brief ? def.brief.summary : app.request}</p>
      <button class="btn primary lg" onClick=${() => open(null)}><${Icon} n="open" />Open the app</button><span class="t-cap muted">Opens full screen, the way someone you share it with sees it.</span></div>
    <div class="sheet-h">Open as</div>
    <div class="sheet-list card">${users.map((u) => html`<${SheetRow} key=${u.id} av=${html`<${Avatar} name=${u.name} size="sm" />`} label=${u.name} hint=${roleName(def, u.role)} end=${html`<${Icon} n="chevRight" s="16" />`} onClick=${() => open(u)} />`)}</div>
    <div class="sheet-list card"><${SheetRow} icon="share" label="Share by link" hint="They see only the app" onClick=${() => openShare(app)} /><${SheetRow} icon="playOutline" label="Play the walkthrough" hint="The agents' tour, as the acceptance test" disabled=${!def.tour.length} onClick=${() => startWalk(app)} /><${SheetRow} icon="reset" label="Reset the data" hint="Put the seed rows back" onClick=${async () => { if (await confirmBox({ title: 'Reset the data in ' + app.name + '?', body: 'Every table is emptied and the original seed rows are put back.', yes: 'Reset data' })) resetAppData(app); }} /></div>
  </div>`;
}
function PhoneSheets({ app }) { // the sheets of the builder: workspaces, menu, more, inspector
  const sh = U.sheet; if (!sh) return null; const s = S.settings, acct = me();
  if (sh.kind === 'tabs') { const tabs = tabsNow(), cur = activeTab();
    return html`<${Sheet} cls="fixed" title="Workspaces" sub=${tabs.length + ' open'} onClose=${sheetClose}><div class="sheet-list">${tabs.map((t) => { const a = t.app ? S.apps[t.app] : null; return html`<div key=${t.id} class="sheet-pair"><${SheetRow} av=${a ? html`<span class=${'app-badge sm acc-' + a.accent}><${Icon} n=${a.icon} s="16" /></span>` : html`<span class="sheet-ic"><${Icon} n="home" /></span>`} label=${a ? a.name : 'Home'} hint=${a ? (RUNS[a.id] ? 'Building' : a.status === 'ready' ? 'Ready' : 'Not finished') : 'Start a new app'} on=${t.id === cur.id} check=${t.id === cur.id} onClick=${() => { U.sheet = null; selectTab(t.id); }} /><button class="btn subtle icon" aria-label=${'Close ' + (a ? a.name : 'tab')} onClick=${() => closeTab(t.id)}><${Icon} n="dismiss" /></button></div>`; })}</div>
      <div class="sheet-list"><${SheetRow} icon="add" label="New workspace" onClick=${() => { const t = { id: uid('tab'), app: null }; tabsNow().push(t); S.active[S.session] = t.id; U.sheet = null; commit(); }} /></div><//>`; }
  if (sh.kind === 'menu') { const tog = (on) => html`<span class=${cx('switch-pill', on && 'on')} aria-hidden="true"><i></i></span>`, act = (fn) => () => { U.sheet = null; fn(); notify(); };
    return html`<${Sheet} cls="fixed" title=${acct.name} sub=${acct.username + ' · ' + BRAND.name} onClose=${sheetClose}>
      <div class="sheet-list"><${SheetRow} icon="sparkle" label="Live" hint=${!online() ? 'Paused while you are offline. Comes back when you reconnect.' : modeNow().on ? 'On: your sentence goes to the model' : 'Off: Demo, saved builds and no model calls'} end=${tog(modeNow().on)} onClick=${() => setLive(!modeNow().on)} />
        <${SheetRow} icon=${online() ? 'wifi' : 'wifiOff'} label="Online" hint=${online() ? 'Live follows this connection. Switch off to try without it.' : s.offline ? 'Offline (simulated). Switch on to reconnect.' : 'This device is offline'} end=${tog(online())} onClick=${() => setOffline(!s.offline)} />
        <${SheetRow} icon="bug" label="Debug mode" hint="Events, tool calls, SQL and model calls" end=${tog(s.debug)} onClick=${() => { s.debug = !s.debug; commit(); }} /></div>
      <div class="sheet-list"><${SheetRow} icon="bookOpen" label="Feature guide" hint="Every feature, and how to try it" onClick=${act(() => openDialog('guide'))} /><${SheetRow} icon="compass" label="Take the guided tour" onClick=${act(() => startTour())} /><${SheetRow} icon="open" label="Open a shared app" onClick=${act(() => openDialog('openlink', { text: '' }))} /><${SheetRow} icon="info" label="What is real in this prototype" onClick=${act(() => openDialog('about'))} /></div>
      <div class="sheet-list"><${SheetRow} icon="settings" label="Settings" onClick=${act(() => openDialog('settings'))} /><${SheetRow} icon="install" label=${s.installed ? 'Installed as an app' : 'Install as an app'} onClick=${act(() => openDialog('install'))} /><${SheetRow} icon="reset" label="Reset data" onClick=${act(() => openDialog('reset'))} /><${SheetRow} icon="signOut" label="Sign out" onClick=${act(() => signOut())} /></div><//>`; }
  if (!app) return null;
  if (sh.kind === 'more') { const busy = !!RUNS[app.id], ready = app.status === 'ready', go = (v) => () => { U.view[app.id] = v; U.sheet = null; if (chatShown()) setChat(false); notify(); }, act = (fn) => () => { U.sheet = null; fn(); notify(); }, view = viewOf(app);
    return html`<${Sheet} cls="fixed" title=${app.name} sub="More places and actions" onClose=${sheetClose}>
      <div class="sheet-h">Details, for the curious</div>
      <div class="sheet-list"><${SheetRow} icon="beaker" label="Tests" hint="Every test the build wrote, and how it went" on=${view === 'tests'} onClick=${go('tests')} /><${SheetRow} icon="database" label="Data" hint="Tables, rows and SQL" on=${view === 'data'} onClick=${go('data')} /><${SheetRow} icon="server" label="API" hint="Endpoints and who may call them" on=${view === 'api'} onClick=${go('api')} /><${SheetRow} icon="plug" label="Connections" hint="Outside sources the agents may use" on=${view === 'conn'} onClick=${go('conn')} /></div>
      <div class="sheet-list"><${SheetRow} icon="share" label="Share by link" disabled=${!ready} onClick=${act(() => openShare(app))} /><${SheetRow} icon="document" label="Export build pack" disabled=${!ready} onClick=${act(() => openDialog('pack', { app: app.id }))} /><${SheetRow} icon="edit" label="Rename app" disabled=${!ready || busy} onClick=${act(() => openDialog('rename', { app: app.id, name: app.name }))} /><${SheetRow} icon="rerun" label="Run the build again" disabled=${busy} onClick=${act(() => rebuildAsk(app))} /><${SheetRow} icon="options" label="Customize the workflow" hint="Approvals, review steps, instructions, attempts" onClick=${act(() => openDialog('workflow', { app: app.id }))} />
        <${SheetRow} icon="trash" label="Delete app" danger=${true} onClick=${act(async () => { if (await confirmBox({ title: 'Delete ' + app.name + '?', body: 'The app, its SQLite database and its chat are removed from this browser.', yes: 'Delete app', danger: true })) deleteApp(app); })} /></div><//>`; }
  if (sh.kind === 'inspector') { const sid = U.sel[app.id] || 'research', rid = String(sid).indexOf('rv_') === 0 ? String(sid).slice(3) : null, rv = rid && flowOf(app).reviewers.includes(rid) ? REVIEWERS[rid] : null, st = STATIONS.find((x) => x.id === sid) || STATIONS[0];
    return rv ? html`<${Sheet} cls="fixed" tall=${true} title=${rv.name} sub=${rv.job} onClose=${sheetClose}><${Inspector} app=${app} sid=${sid} bare=${true} /><//>` : sid === 'qa' ? html`<${Sheet} cls="fixed" tall=${true} title="Tests" sub=${'Tester · ' + AGENTS.tester.role} onClose=${sheetClose}><${Inspector} app=${app} sid="qa" bare=${true} /><//>` : html`<${Sheet} cls="fixed" tall=${true} title=${st.name} sub=${AGENTS[st.agent].name + ' · ' + AGENTS[st.agent].role} onClose=${sheetClose}><${Inspector} app=${app} sid=${st.id} bare=${true} /><//>`; }
  return null;
}
