/* ===== Turnkey prototype · shell: title bar with workspace tabs, home, workspace, the line ===== */
function Titlebar({ tabs, tab }) {
  const acct = me(), s = S.settings, on = online(), mode = modeNow(), net = netInfo();
  const addTab = () => { const t = { id: uid('tab'), app: null }; tabsNow().push(t); S.active[S.session] = t.id; commit(); };
  const flipNet = () => setOffline(!s.offline);
  if (PHONE()) return html`<${PhoneBar} tabs=${tabs} tab=${tab} />`;
  return html`<header class="titlebar">
    <button class="brand" title="New tab" onClick=${() => openTab(null)}><${Logo} /><span class="brand-t hide-md">${BRAND.name}</span></button>
    <div class="tabstrip" role="tablist" aria-label="Workspaces" data-tour="tabs">
      ${tabs.map((t) => { const app = t.app ? S.apps[t.app] : null, cur = t.id === tab.id; return html`<div key=${t.id} class=${cx('wtab', cur && 'on')} role="tab" aria-selected=${cur} tabindex="0" title=${app ? app.name : 'New tab'} onClick=${() => selectTab(t.id)} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTab(t.id); } }} onAuxClick=${(e) => { if (e.button === 1) closeTab(t.id); }}>
        ${app ? html`<span class=${'wtab-ic acc-' + app.accent}><${Icon} n=${app.icon} s="12" /></span>` : html`<${Icon} n="tab" s="16" />`}
        <span class="wtab-t ellipsis">${app ? app.name : 'New tab'}</span>
        ${app && RUNS[app.id] && html`<${Spinner} />`}
        <button class="wtab-x" aria-label=${'Close ' + (app ? app.name : 'tab')} onClick=${(e) => { e.stopPropagation(); closeTab(t.id); }}><${Icon} n="dismiss" s="12" /></button>
      </div>`; })}
      <button class="newtab" aria-label="New tab" title="New tab" onClick=${addTab}><${Icon} n="add" s="16" /></button>
    </div>
    <div class="tb-right">
      <span data-tour="mode" class=${cx('tb-mode', mode.on && 'is-live')}><${Switch} id="sw-live" on=${mode.on} disabled=${!on} onChange=${setLive} text="Live" title=${!on ? 'Live is paused because you are offline. It switches itself back on when the connection returns.' : mode.on ? 'Live: you are connected, so your own sentence goes to the model. Live follows the internet connection. Switch off for Demo.' : 'Demo: saved builds with made-up data, no model calls. Switch on for Live.'} />${!mode.on && html`<span class=${cx('badge', s.demo ? 'b-outline' : 'b-warning')} id="mode-why">${s.demo ? 'Demo' : 'Paused'}</span>`}</span>
      <button class=${cx('btn subtle sm net', !on && 'is-offline')} data-tour="net" aria-pressed=${!on} title=${on ? 'Online' + (net ? ' (' + net + ')' : '') + '. Live follows this connection. Click to see what happens without it.' : s.offline ? 'Offline (simulated). Click to go back online.' : 'This device is offline. Live comes back when it reconnects.'} onClick=${flipNet}><${Icon} n=${on ? 'wifi' : 'wifiOff'} s="16" /><span class="hide-md">${on ? 'Online' : 'Offline'}</span></button>
      ${!s.installed && html`<button class="btn subtle sm hide-md" onClick=${() => openDialog('install')}><${Icon} n="install" s="16" />Install</button>`}
      <button class=${cx('btn subtle icon', s.debug && 'on')} data-tour="debug" aria-pressed=${s.debug} title="Debug mode" aria-label="Debug mode" onClick=${() => { s.debug = !s.debug; commit(); }}><${Icon} n="bug" /></button>
      <${Menu} title="Help" btn=${{ cls: 'btn subtle icon', label: 'Help', body: html`<${Icon} n="help" />` }} items=${[{ label: 'Feature guide', icon: 'bookOpen', on: () => openDialog('guide') }, { label: 'Take the guided tour', icon: 'compass', on: () => startTour() }, { label: 'Open a shared app', icon: 'open', on: () => openDialog('openlink', { text: '' }) }, { label: 'What is real in this prototype', icon: 'info', on: () => openDialog('about') }]} />
      <${Menu} tour="account" title="Account" btn=${{ cls: 'acct', label: 'Account menu', body: html`<${Avatar} name=${acct.name} size="sm" acc="blue" />` }} items=${[{ head: true, label: acct.name + ' · ' + acct.username }, { label: 'Settings', icon: 'settings', on: () => openDialog('settings') }, { label: s.installed ? 'Installed as an app' : 'Install as an app', icon: 'install', on: () => openDialog('install') }, { label: 'Reset data', icon: 'reset', on: () => openDialog('reset') }, '-', { label: 'Sign out', icon: 'signOut', on: signOut }]} />
    </div>
  </header>`;
}
function Home() {
  const acct = me(), apps = myApps(), guests = sharedApps(), h = U.home, mode = modeNow(), demo = !mode.live, hr = new Date().getHours();
  const go = () => {
    const text = str(h.text); if (!text) { h.note = 'Describe the app in one sentence first.'; return notify(); }
    if (demo) { // no model to call right now: Demo was chosen, the connection is gone, or this copy has no model. A saved build stands in.
      const tpl = matchTemplate(text), why = { demo: 'Demo replays saved builds, and none of them matches that sentence. Pick one below, or switch Live on in the title bar to build from your own words.', offline: 'You are offline, so Live is paused and only saved builds can run. None of them matches that sentence. Pick one below, or try again when you are back online.', checking: 'Still connecting to the model. Try again in a moment, or pick a saved build below.', nomodel: NO_MODEL + ' None of the saved builds matches that sentence, so pick one below. Inside Claude the model comes from the viewer; the hackathon build calls its own server route.' };
      if (!tpl) { h.note = why[mode.id]; return notify(); }
      if (mode.id !== 'demo') toast(mode.id === 'offline' ? 'You are offline, so I am replaying the closest saved build.' : mode.id === 'checking' ? 'Still connecting to the model, so I am replaying the closest saved build.' : NO_MODEL + ' I am replaying the closest saved build.', 'info', 6500);
      h.note = ''; h.text = ''; startBuild({ request: REC[tpl].sentence, tpl }); }
    else if (startBuild({ request: text })) { h.text = ''; h.note = ''; }
  };
  const del = async (a) => { if (await confirmBox({ title: 'Delete ' + a.name + '?', body: 'The app, its SQLite database and its chat are removed from this browser.', yes: 'Delete app', danger: true })) { deleteApp(a); toast(a.name + ' deleted', 'success'); } };
  const builtOf = (id) => apps.find((a) => a.tpl === id && a.status !== 'failed'), build = (id) => startBuild({ request: REC[id].sentence, tpl: id });
  const buildAll = () => { const todo = QUESTS.filter((id) => !builtOf(id)); if (!todo.length) return toast('All three quest apps are already in your library.', 'info'); todo.forEach(build); };
  const dup = (a) => { const c = duplicateApp(a); if (c) toast(c.name + ' was added to your library', 'success'); };
  const card = (id) => { const r = REC[id], has = builtOf(id); return html`<div key=${id} class="card tpl" data-tpl=${id}>
    <span class="row gap8"><span class=${'tpl-ic acc-' + r.accent}><${Icon} n=${r.icon} s="24" /></span><span class="grow"></span>${r.quest && html`<span class="badge b-outline">Quest ${r.quest}</span>`}${has && html`<span class="badge b-success">In your library</span>`}</span>
    <strong class="t-sub2">${r.title}</strong><span class="muted">${r.blurb}</span>
    ${r.agents && html`<span class="row wrap gap4">${r.agents.map((n) => html`<span key=${n} class="badge b-outline"><${Icon} n="bot" s="12" />${n}</span>`)}</span>`}
    <span class="row tpl-acts">${has ? html`<button class="btn primary sm" onClick=${() => openTab(has.id)}>Open</button><button class="btn sm tpl-build" onClick=${() => build(id)}>Build another</button>` : html`<button class="btn primary sm tpl-build" onClick=${() => build(id)}><${Icon} n="sparkle" s="16" />Build this app</button>`}</span>
  </div>`; };
  const mine0 = html`    <div class="row between sec" data-tour="library"><div class="col gap0"><h2 class="t-sub2">Your apps${apps.length ? html` <span class="tab-n">${apps.length}</span>` : null}</h2><span class="t-cap muted">Every app you build is saved in this browser with its data, rules, views and screens, and is still here when you sign in again.</span></div><button class="btn sm" onClick=${() => openDialog('openlink', { text: '' })}><${Icon} n="open" s="16" />Open a shared app</button></div>
    ${apps.length ? html`<div class="apps">${apps.map((a) => html`<div key=${a.id} class="card app-row">
      <button class="app-open" onClick=${() => openTab(a.id)}><${AppLogo} app=${a} size=${36} /><span class="col gap0 grow"><strong>${a.name}</strong><span class="t-cap muted ellipsis">${a.request}</span></span></button>
      ${a.def.team && html`<span class="badge b-outline hide-sm"><${Icon} n="bot" s="12" />${a.def.team.agents.length} agents</span>`}
      <span class=${'badge b-' + (a.status === 'ready' ? (isDirty(a) ? 'warning' : 'success') : a.status === 'failed' ? 'danger' : RUNS[a.id] ? 'info' : 'warning')}>${RUNS[a.id] ? 'Building' : a.status === 'ready' && relOf(a) ? (isDirty(a) ? 'Draft · ' + relOf(a).v + ' is out' : 'Version ' + relOf(a).v) : cap(a.status)}</span>
      <span class="t-cap muted hide-sm">${a.def.screens.length} pages · ${a.def.tables.length} tables · ${fmtBytes(DBX.size[a.id] || LS.size('db:' + a.id))} · ${ago(a.updated)}</span>
      <button class="btn subtle icon" aria-label=${'Share ' + a.name} title="Share by link" disabled=${a.status !== 'ready' || !!RUNS[a.id]} onClick=${() => openShare(a)}><${Icon} n="share" /></button>
      <button class="btn subtle icon" aria-label=${'Duplicate ' + a.name} title="Duplicate app with its data" disabled=${a.status !== 'ready' || !!RUNS[a.id]} onClick=${() => dup(a)}><${Icon} n="copy" /></button>
      <button class="btn subtle icon" aria-label=${'Delete ' + a.name} title="Delete app" onClick=${() => del(a)}><${Icon} n="trash" /></button>
    </div>`)}</div>` : html`<p class="muted">Nothing yet. Build one of the apps above, or describe your own.</p>`}`;
  const mine = apps.length ? mine0 : null;
  return html`<div class="home scroll"><div class="home-in">
    <h1 class="t-title2">${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, ${acct.name.split(' ')[0]}. What do you want to build?</h1>
    <p class="lead muted">Say what the work is in one sentence. A team of agents builds the whole app, tests it and hands it over ready to use.</p>
    <div class="prompt" data-tour="prompt">
      <textarea class="textarea" id="home-prompt" rows="2" aria-label="Describe the app" placeholder=${demo ? 'Try: a clinic that books patient appointments' : 'Example: a gym tracks members, class bookings and trainer schedules'} value=${h.text} onInput=${(e) => { h.text = e.target.value; h.note = ''; notify(); }} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } }}></textarea>
      <div class="prompt-bar"><span class=${cx('badge', mode.cls)} id="home-mode">${mode.long}</span><span class="grow"></span><button class="btn primary" onClick=${go}><${Icon} n="sparkle" />Build</button></div>
    </div>
    ${h.note && html`<${MBar} tone="warning">${h.note}<//>`}
    <ol class="how" aria-label="How it works"><li><span class="how-n">1</span><span><strong>Describe</strong><span class="t-cap muted">One sentence about the work</span></span></li><li><span class="how-n">2</span><span><strong>Watch it being built</strong><span class="t-cap muted">Agents build and test it while you look on</span></span></li><li><span class="how-n">3</span><span><strong>Use it</strong><span class="t-cap muted">The working app, with sample data</span></span></li><li><span class="how-n">4</span><span><strong>Release and share</strong><span class="t-cap muted">One link installs the app alone</span></span></li></ol>
    ${mine}
    <div class="row between sec" data-tour="quests"><div class="col gap0"><h2 class="t-sub2">Hackathon quests</h2><span class="t-cap muted">Each one becomes its own app, with a team of three agents that work inside it.</span></div><button class="btn sm" onClick=${buildAll}><${Icon} n="apps" s="16" />Build all three</button></div>
    <div class="tpl-grid">${QUESTS.map(card)}</div>
    <div class="col gap0 sec"><h2 class="t-sub2">Business apps</h2><span class="t-cap muted">Record-keeping apps with roles and a workflow.</span></div>
    <div class="tpl-grid">${TEMPLATES.map(card)}</div>
    ${!apps.length ? mine0 : null}
    ${guests.length > 0 && html`<div class="col gap0 sec"><h2 class="t-sub2">Opened from links <span class="tab-n">${guests.length}</span></h2><span class="t-cap muted">Apps someone shared with you. Each one is your own copy, with its own data.</span></div>
      <div class="apps">${guests.map((a) => html`<div key=${a.id} class="card app-row">
        <button class="app-open" onClick=${() => enterSolo(a, { from: 'link', as: a.shared.as })}><span class=${'tpl-ic sm acc-' + a.accent}><${Icon} n=${a.icon} /></span><span class="col gap0 grow"><strong>${a.name}</strong><span class="t-cap muted ellipsis">${a.shared.by ? 'Shared by ' + a.shared.by + ' · ' : ''}${a.def.tables.length} tables · ${a.def.screens.length} pages · opened ${ago(a.shared.at)}</span></span></button>
        <button class="btn sm" onClick=${() => keepShared(a)}><${Icon} n="save" s="16" /><span class="hide-sm">Save to my apps</span></button>
        <button class="btn subtle icon" aria-label=${'Remove ' + a.name} title="Remove this copy" onClick=${() => del(a)}><${Icon} n="trash" /></button>
      </div>`)}</div>`}
  </div></div>`;
}
const VIEWS = [{ id: 'build', label: 'Build', icon: 'production', title: 'Watch the agents build it, and change how they work' }, { id: 'app', label: 'App', icon: 'window', title: 'Use the working app' }, { id: 'release', label: 'Release', icon: 'rocket', title: 'Versions, sharing and installing' }, { id: 'details', label: 'Details', icon: 'wrench', title: 'For the curious: tests, data, API and connections' }];
const DETAILS = [{ id: 'tests', label: 'Tests', icon: 'beaker', title: 'Every test the build wrote, and how it went' }, { id: 'data', label: 'Data', icon: 'database', title: 'The SQLite tables' }, { id: 'api', label: 'API', icon: 'server', title: 'Endpoints and permissions' }, { id: 'conn', label: 'Connections', icon: 'plug', title: 'Third-party systems' }];
const isDetail = (v) => DETAILS.some((d) => d.id === v);
const viewOf = (app) => U.view[app.id] || (app.status === 'ready' && !RUNS[app.id] ? 'app' : 'build'); // a finished app opens on the app itself, an unfinished one on its build
const viewTitle = (v) => (VIEWS.concat(DETAILS).find((x) => x.id === v) || VIEWS[0]).title;
const RUN_KIND = { build: 'Build', change: 'Change', rerun: 'Re-run', review: 'Review', step: 'Step' };
async function rebuildAsk(app) { if (RUNS[app.id]) return; if (app.status === 'ready' && !(await confirmBox({ title: 'Run the build again?', body: 'The agents start from the request again. The current database and any changes you asked for are replaced.', yes: 'Run again' }))) return; rebuild(app); }
function DetailsView({ app, view }) { // everything a developer would ask for, kept one step away from everyone else
  const pick = (v) => { U.view[app.id] = v; U.detail[app.id] = v; notify(); };
  return html`<div class="details"><div class="details-bar"><${Tabs} cls="subtabs" label="Details" items=${DETAILS} value=${view} onChange=${pick} /><span class="grow"></span><span class="t-cap muted hide-md">For the curious. You never need these pages to use, release or share the app.</span></div>
    <div class="details-body">${view === 'tests' ? html`<${TestsView} app=${app} />` : view === 'data' ? html`<${DataView} app=${app} />` : view === 'api' ? html`<${ApiView} app=${app} />` : html`<${ConnView} app=${app} />`}</div></div>`;
}
function Workspace({ app }) {
  const view = viewOf(app), busy = !!RUNS[app.id], rel = relOf(app), dirty = isDirty(app);
  const st = busy ? ['info', 'Building'] : app.status === 'ready' ? (rel ? (dirty ? ['warning', 'Draft · ' + rel.v + ' is out'] : ['success', 'Version ' + rel.v]) : ['success', 'Ready']) : app.status === 'failed' ? ['danger', 'Failed'] : app.status === 'stopped' ? ['warning', 'Not finished'] : ['neutral', 'New'];
  const del = async () => { if (await confirmBox({ title: 'Delete ' + app.name + '?', body: 'The app, its SQLite database and its chat are removed from this browser.', yes: 'Delete app', danger: true })) deleteApp(app); };
  const go = (v) => { U.view[app.id] = v === 'details' ? U.detail[app.id] || 'tests' : v; notify(); };
  const phone = PHONE(), more = [{ label: 'Share by link', icon: 'share', disabled: app.status !== 'ready', on: () => openShare(app) }, { label: 'Export build pack', icon: 'document', disabled: app.status !== 'ready', on: () => openDialog('pack', { app: app.id }) }, { label: 'Rename app', icon: 'edit', disabled: app.status !== 'ready' || busy, on: () => openDialog('rename', { app: app.id, name: app.name }) }, { label: 'Run the build again', icon: 'rerun', disabled: busy, on: () => rebuildAsk(app) }, { label: 'Customize the workflow', icon: 'options', on: () => openDialog('workflow', { app: app.id }) }, '-', { label: 'Delete app', icon: 'trash', danger: true, on: del }];
  const tabs = VIEWS.map((v) => (v.id === 'release' && app.status === 'ready' ? Object.assign({}, v, { count: rel ? (dirty ? 'draft' : rel.v) : 'new' }) : v));
  const body = view === 'build' ? html`<${BuildView} app=${app} />` : view === 'release' ? html`<${ReleaseView} app=${app} />` : isDetail(view) ? html`<${DetailsView} app=${app} view=${view} />` : null;
  if (phone) return html`<div class="work phone">
    <div class="work-main">
      <div class="work-head">
        <${AppLogo} app=${app} size=${32} />
        <div class="col gap0 work-id grow"><strong class="ellipsis">${app.name}</strong><span class="t-cap muted ellipsis">${chatShown() ? 'Ask the builders for a change' : viewTitle(view)}</span></div>
        <span class=${'badge b-' + st[0]}>${busy && html`<${Spinner} />`}${st[1]}</span>
        <button class="btn subtle icon" aria-label="Share by link" title="Share by link" disabled=${app.status !== 'ready'} onClick=${() => openShare(app)}><${Icon} n="share" /></button>
      </div>
      <div class="view">${chatShown() ? html`<${ChatPanel} app=${app} />` : view === 'app' ? (stageOf(app).tour ? html`<${StageView} app=${app} />` : html`<${AppLauncher} app=${app} />`) : body}</div>
    </div>
    <${PhoneNav} app=${app} />
  </div>`;
  return html`<div class="work">
    <div class="work-main">
      <div class="work-head">
        <${AppLogo} app=${app} size=${32} />
        <div class="col gap0 work-id"><strong class="ellipsis">${app.name}</strong><span class="t-cap muted ellipsis" title=${app.request}>${app.request}</span></div>
        <span class=${'badge b-' + st[0]} id="app-state">${busy && html`<${Spinner} />`}${st[1]}</span>
        <span data-tour="views" class="views-wrap"><${Tabs} cls="views" label="Workspace views" items=${tabs} value=${isDetail(view) ? 'details' : view} onChange=${go} /></span>
        <span class="grow"></span>
        <button class="btn sm" data-tour="share" disabled=${app.status !== 'ready'} title="Send a link that opens only this app" onClick=${() => openShare(app)}><${Icon} n="share" s="16" /><span class="hide-md">Share</span></button>
        ${!chatShown() && html`<button class="btn sm" title="Ask the builders for a change" onClick=${() => setChat(true)}><${Icon} n="chat" s="16" />Chat</button>`}
        <${Menu} title="More" btn=${{ cls: 'btn subtle icon', label: 'More actions', body: html`<${Icon} n="more" />` }} items=${more} />
      </div>
      <div class="view">${view === 'app' ? html`<${StageView} app=${app} />` : body}</div>
    </div>
    ${chatShown() && html`<${ChatPanel} app=${app} />`}
  </div>`;
}
function BuildView({ app }) {
  const mode = U.bview[app.id] || 'line', busy = !!RUNS[app.id], sel = U.sel[app.id] || 'research';
  const run = app.runs.find((r) => r.id === U.runSel[app.id]) || app.runs[app.runs.length - 1];
  const toChat = () => { setChat(true); setTimeout(() => { const el = document.getElementById('chat-' + app.id); if (el) el.focus(); }, 50); };
  return html`<div class="build scroll">
    <${BuildSummary} app=${app} />
    <div class="build-bar">
      <${Seg} label="How to view the agents" items=${[{ id: 'line', label: 'Workflow', icon: 'flow', title: 'Agents, check gates and handoffs' }, { id: 'timeline', label: 'Timeline', icon: 'timeline', title: 'Who worked when' }, { id: 'log', label: 'Log', icon: 'list', title: 'Every step in order' }]} value=${mode} onChange=${(v) => { U.bview[app.id] = v; notify(); }} />
      ${run && html`<span class="t-cap muted hide-sm">${RUN_KIND[run.kind] || 'Run'} ${run.n} · ${run.status === 'running' ? 'running' : fmtMs((run.t1 || Date.now()) - run.t0)} · ${run.mode === 'live' && (run.kind === 'build' || run.kind === 'rerun') ? run.calls + ' model calls' : run.replayed ? run.replayed + ' replayed, 0 model calls' : run.calls + ' model calls'}${run.retries ? ' · ' + run.retries + ' sent back' : ''}</span>`}
      <span class="grow"></span>
      ${busy ? html`<button class="btn sm" onClick=${() => stopRun(app)}><${Icon} n="stop" s="16" />Stop</button>` : html`<button class="btn sm" onClick=${() => rebuildAsk(app)}><${Icon} n="rerun" s="16" />Run again</button>`}
    </div>
    ${app.line.research.status === 'waiting' && app.line.research.hold !== 'approval' && html`<${MBar} tone="warning" action=${html`<button class="btn sm" onClick=${toChat}>Answer in chat</button>`}>The Researcher has a question for you. The line is paused until you answer.<//>`}
    ${busy && RUNS[app.id].gate && html`<${MBar} tone="warning" action=${html`<button class="btn sm primary" onClick=${() => answerGate(app, true)}>Approve and continue</button>`}>The line is waiting for your approval after ${(STATIONS.find((s) => app.line[s.id].hold === 'approval') || {}).name || 'this station'}, as you set it. Select the station to see what was made.<//>`}
    ${PENDING[app.id] && html`<${MBar} tone="warning" action=${html`<button class="btn sm" onClick=${toChat}>Review in chat</button>`}>A change is waiting for your approval because it deletes data.<//>`}
    ${!busy && (app.status === 'stopped' || app.status === 'failed') && html`<${MBar} tone=${app.status === 'failed' ? 'danger' : 'info'} action=${html`<button class="btn sm" onClick=${() => rebuild(app)}>Run again</button>`}>${app.status === 'failed' ? 'The last build failed. The log and the debug drawer show where.' : 'This build did not finish.'}<//>`}
    ${mode === 'line' ? html`<${FlowView} app=${app} sel=${sel} />` : mode === 'timeline' ? html`<${TimelineView} app=${app} run=${run} />` : html`<${LogView} app=${app} run=${run} />`}
    ${!PHONE() && html`<${Inspector} app=${app} sid=${sel} />`}
  </div>`;
}
function LineView({ app, sel }) {
  const hand = U.handoff[app.id];
  return html`<div class="line-wrap" data-tour="line">
    <div class="line">${STATIONS.map((st, i) => [html`<${StationCard} key=${st.id} app=${app} st=${st} i=${i} on=${sel === st.id} />`, i < STATIONS.length - 1 && html`<div key=${st.id + '-c'} class=${cx('conn', hand === i && 'go', app.line[st.id].status === 'ok' && 'done')} aria-hidden="true"><span class="conn-dot"></span></div>`])}</div>
    <div class="flow-foot"><span class="grow"></span><button class="btn sm" data-tour="customize" title="Approvals, review steps, instructions and attempts" onClick=${() => openDialog('workflow', { app: app.id })}><${Icon} n="options" s="16" />Customize${flowList(flowOf(app)).length > 0 && html`<span class="tab-n">${flowList(flowOf(app)).length}</span>`}</button></div>
    <div class="orch"><${AgentAv} id="orchestrator" size="sm" /><span><strong>Orchestrator</strong> is code, not a model. It runs the stations in order, checks every handoff, ${flowOf(app).attempts === 1 ? 'gives each station one attempt' : 'sends failed work back at most ' + (flowOf(app).attempts === 2 ? 'once' : 'twice')}, and after a change re-runs only the stations that change touches.</span></div>
    <${FlowChips} app=${app} />
  </div>`;
}
function StationCard({ app, st, i, on }) {
  const L = app.line[st.id], a = AGENTS[st.agent], meta = STATUS_META[L.status] || STATUS_META.idle, passed = L.checks.filter((c) => c.ok).length, active = L.status === 'working' || L.status === 'checking', stream = U.stream[app.id];
  return html`<button class=${cx('station', 's-' + L.status, on && 'sel', 'acc-' + a.acc)} data-tour=${i === 1 ? 'station' : undefined} aria-pressed=${on} onClick=${() => { U.sel[app.id] = st.id; U.follow[app.id] = false; notify(); }}>
    ${active && html`<span class="pbar"></span>`}
    <span class="st-top"><${AgentAv} id=${st.agent} size="sm" /><span class="t-cap muted grow">${i + 1} · ${a.name}${st.id === 'walkthrough' ? ' + code' : ''}</span></span><strong class="st-name">${st.name}</strong>
    <span class="st-status"><span class=${'badge b-' + (L.note && L.status === 'ok' ? 'neutral' : meta.tone)}>${active && html`<${Spinner} />`}${L.note && L.status === 'ok' ? L.note : meta.text}</span>${L.attempt > 1 && html`<span class="badge b-warning" title="This station was sent back"><${Icon} n="undo" s="12" />try ${L.attempt}</span>`}</span>
    <span class="st-facts">${L.facts.length ? L.facts.map((f, k) => html`<span key=${k}>${f}</span>`) : html`<span class="muted">${L.status === 'working' && stream ? 'Receiving ' + stream + ' characters' : st.makes}</span>`}</span>
    <span class="st-foot">${L.checks.length ? html`<span class=${cx('ck', passed === L.checks.length ? 'ok' : 'bad')}><${Icon} n=${passed === L.checks.length ? 'shield' : 'warning'} s="16" />${passed} of ${L.checks.length} checks</span>` : html`<span class="muted">No checks yet</span>`}</span>
  </button>`;
}
function RunChips({ app, run }) { return app.runs.length > 1 ? html`<div class="chips">${app.runs.map((r) => html`<button key=${r.id} class=${cx('chip', r.id === run.id && 'on')} title=${r.label} onClick=${() => { U.runSel[app.id] = r.id; notify(); }}>${RUN_KIND[r.kind] || 'Run'} ${r.n}</button>`)}</div>` : null; }
function TimelineView({ app, run }) {
  if (!run || !run.steps.length) return html`<div class="line-wrap" data-tour="line"><${Empty} icon="timeline" title="No run yet" text="Start a build to see who worked when." /></div>`;
  const t0 = run.t0, t1 = run.t1 || Date.now(), span = Math.max(1, t1 - t0), lanes = ['orchestrator', 'researcher', 'database', 'backend', 'views', 'ui'].concat(run.steps.map((s) => s.agent).filter((id, i, a) => String(id).indexOf('rv_') === 0 && AGENTS[id] && a.indexOf(id) === i)), name = (id) => (STATIONS.find((s) => s.id === id) || {}).name;
  return html`<div class="line-wrap tl" data-tour="line">
    <${RunChips} app=${app} run=${run} />
    ${lanes.map((id) => html`<div key=${id} class="tl-row"><div class="tl-l"><${AgentAv} id=${id} size="xs" /><span class="hide-sm">${AGENTS[id].name}</span></div><div class="tl-track">${run.steps.filter((s) => s.agent === id).map((s, i) => html`<span key=${i} class=${cx('tl-bar', 'k-' + s.kind, s.ok === false && 'bad', 'acc-' + AGENTS[id].acc)} style=${{ left: ((s.t0 - t0) / span) * 100 + '%', width: Math.max(0.8, (((s.t1 || t1) - s.t0) / span) * 100) + '%' }} title=${name(s.station) + ' · ' + s.label + ' · ' + fmtMs((s.t1 || t1) - s.t0)}></span>`)}</div></div>`)}
    <div class="tl-row"><div class="tl-l"></div><div class="tl-axis"><span>0 s</span><span>${fmtMs(span / 2)}</span><span>${fmtMs(span)}</span></div></div>
    <div class="tl-legend"><span><i class="k-model"></i>Agent output</span><span><i class="k-check"></i>Code checks</span><span><i class="k-tool"></i>Applying</span><span><i class="k-wait"></i>Waiting for you</span></div>
  </div>`;
}
function LogView({ app, run }) {
  if (!run) return html`<div class="line-wrap" data-tour="line"><${Empty} icon="list" title="No run yet" /></div>`;
  return html`<div class="line-wrap" data-tour="line"><${RunChips} app=${app} run=${run} />
    <div class="tbl-wrap"><table class="tbl dense"><thead><tr><th>At</th><th>Station</th><th>Who</th><th>What</th><th class="num">Took</th><th>Result</th></tr></thead>
    <tbody>${run.steps.map((s, i) => html`<tr key=${i}><td class="mono">+${fmtMs(s.t0 - run.t0)}</td><td>${(STATIONS.find((x) => x.id === s.station) || {}).name}</td><td><span class="who"><${AgentAv} id=${s.agent} size="xs" /><span>${AGENTS[s.agent].name}</span></span></td><td>${s.label}</td><td class="num mono">${s.t1 ? fmtMs(s.t1 - s.t0) : '…'}</td><td>${s.t1 ? html`<span class=${'badge b-' + (s.ok === false ? 'warning' : 'success')}>${s.ok === false ? 'Not passed' : 'OK'}</span>` : html`<${Spinner} />`}</td></tr>`)}</tbody></table></div>
  </div>`;
}
function Inspector({ app, sid, bare }) {
  if (sid === 'qa') return html`<${TesterPanel} app=${app} bare=${bare} />`;
  const rid = String(sid || '').indexOf('rv_') === 0 ? String(sid).slice(3) : null; if (rid && REVIEWERS[rid] && flowOf(app).reviewers.includes(rid)) return html`<${ReviewPanel} app=${app} id=${rid} bare=${bare} />`;
  const st = STATIONS.find((s) => s.id === sid) || STATIONS[0], L = app.line[st.id], tab = U.itab[app.id] || 'out', fl = flowOf(app), nc = (fl.approve[st.id] ? 1 : 0) + (fl.by[st.id] === 'rules' ? 1 : 0) + (fl.notes[st.agent] ? 1 : 0) + (fl.reviewers.includes(reviewerAt(st.id)) ? 1 : 0);
  return html`<section class=${cx('inspector', bare && 'bare')} data-tour="inspector" aria-label=${st.name + ' inspector'}>
    <div class="insp-head">${!bare && html`<${AgentAv} id=${st.agent} size="sm" /><strong>${st.name}</strong><span class="muted t-cap hide-sm">${AGENTS[st.agent].role}</span>`}<span class="grow"></span>
      <${Tabs} cls="sm" label="Inspector" items=${[{ id: 'out', label: 'Output' }, { id: 'checks', label: 'Checks', count: L.checks.length || null }, { id: 'tests', label: 'Tests', count: testable(app) ? suiteOf(app).filter((s) => s.station === st.id).reduce((n, s) => n + s.tests.length, 0) || null : null }, { id: 'tries', label: 'Attempts', count: L.attempts.length > 1 ? L.attempts.length : null }, { id: 'custom', label: 'Customize', icon: 'options', count: nc || null, tour: 'custom-tab' }]} value=${tab} onChange=${(v) => { U.itab[app.id] = v; notify(); }} /></div>
    <div class="insp-body">${tab === 'custom' ? html`<${CustomTab} app=${app} st=${st} />` : tab === 'checks' ? html`<${CheckList} checks=${L.checks} />` : tab === 'tests' ? html`<${StationTests} app=${app} st=${st} />` : tab === 'tries' ? html`<${Attempts} L=${L} />` : html`<${StationOut} app=${app} st=${st} />`}</div>
  </section>`;
}
function Attempts({ L }) {
  if (!L.attempts.length) return html`<p class="muted">Nothing has run at this station yet.</p>`;
  return html`<ol class="tries">${L.attempts.map((a) => html`<li key=${a.n} class=${a.ok ? 'ok' : 'bad'}><strong>Attempt ${a.n}: ${a.ok ? 'passed every check' : 'sent back'}</strong>${a.issues.length > 0 && html`<ul>${a.issues.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>`}</li>`)}</ol>
    ${L.fellBack && html`<${MBar} tone="warning">The agent did not pass in three attempts, so the orchestrator used the safe default for this station.<//>`}`;
}
function AccessMatrix({ app }) {
  const def = app.def, roles = def.brief.roles;
  return html`<div class="tbl-wrap"><table class="tbl dense"><thead><tr><th>Table</th>${roles.map((r) => html`<th key=${r.id}>${r.name}</th>`)}</tr></thead>
    <tbody>${def.tables.map((t) => html`<tr key=${t.name}><td><strong>${t.label}</strong></td>${roles.map((r) => { const a = accOf(def, r.id, t.name), bits = [a.list !== 'none' && 'see ' + a.list, a.create && 'create', a.update !== 'none' && 'edit ' + a.update, a.delete && 'delete'].filter(Boolean); return html`<td key=${r.id}>${bits.length ? bits.map((b, i) => html`<span key=${i} class=${cx('badge', /own/.test(b) ? 'b-warning' : 'b-outline')}>${b}</span> `) : html`<span class="muted">No access</span>`}</td>`; })}</tr>`)}</tbody></table></div>`;
}
function StationOut({ app, st }) {
  const def = app.def, pending = html`<p class="muted">${st.makes} will appear here when ${AGENTS[st.agent].name} has finished and the checks have passed.</p>`;
  if (st.id === 'research') {
    const b = def.brief; if (!b) return pending;
    return html`<div class="out-grid">
      <div class="out-c wide"><p class="lead">${b.summary}</p>${b.decision && html`<${MBar} tone="info"><strong>Your decision.</strong> ${b.decision.text} ${b.decision.answer}.<//>`}</div>
      <div class="out-c"><h4>Roles</h4><ul class="plain">${b.roles.map((r) => html`<li key=${r.id}><strong>${r.name}</strong><span class="muted"> · ${r.can}</span></li>`)}</ul>
        <h4>Records</h4><ul class="plain">${b.entities.map((e) => html`<li key=${e.name}><strong>${label(e.name)}</strong><span class="muted"> · ${e.what}</span></li>`)}</ul></div>
      <div class="out-c"><h4>User stories</h4><ul class="plain">${b.stories.map((s, i) => html`<li key=${i}>As a <strong>${roleName(def, s.role).toLowerCase()}</strong>, I want to ${s.want}${s.so ? ', so that ' + s.so : ''}.</li>`)}</ul></div>
      <div class="out-c"><h4>Process on ${label(b.process.entity).toLowerCase()}</h4><div class="flow">${b.process.states.map((s, i) => [i > 0 && html`<${Icon} key=${'a' + i} n="arrowRight" s="12" />`, html`<span key=${s} class="badge b-outline">${label(s)}</span>`])}</div><p class="muted t-cap">${b.process.note}</p>
        <h4>Rules</h4><ul class="plain">${b.rules.map((r, i) => html`<li key=${i}>${r}</li>`)}</ul>
        ${b.sources.length > 0 && html`<h4>Looked up</h4>${b.sources.map((s, i) => html`<p key=${i} class="t-cap">${s.connector}, "${s.query}": ${s.titles.join(', ')}. <${Proto}>Sample response<//></p>`)}`}</div>
    </div>`;
  }
  if (st.id === 'database') {
    if (!def.tables.length) return pending; const sql = !!U.showSql[app.id], live = dbTables(app.id);
    return html`<div>
      <div class="row between wrap"><span class="muted t-cap">${def.tables.length} tables, plus users and activity. Each one was created from its definition with CREATE TABLE${def.migrations.length ? ', then changed by ' + def.migrations.length + ' migration' + (def.migrations.length > 1 ? 's' : '') : ''}.</span><${Switch} id=${'sql-' + app.id} on=${sql} onChange=${(v) => { U.showSql[app.id] = v; notify(); }} text="Show SQL" /></div>
      <div class="tables">${def.tables.map((t) => html`<div key=${t.name} class="card flat tcard"><div class="row between"><strong>${t.label}</strong><span class="t-cap muted mono">${t.name} · ${dbCount(app.id, t.name)} rows</span></div>
        ${sql ? html`<pre class="code">${(live.find((x) => x.name === t.name) || {}).sql || createTableSQL(t)}</pre>` : html`<table class="tbl dense"><tbody>${t.columns.map((c) => html`<tr key=${c.name}><td class="mono">${c.name}</td><td>${TYPE_LABEL[c.type]}${c.type === 'ref' ? ' → ' + c.ref : c.type === 'user' ? ' → users' + (c.role ? ' (' + c.role + ')' : '') : ''}</td><td class="muted t-cap">${[c.required && 'required', t.title === c.name && 'title', t.owner === c.name && 'owner', c.type === 'select' && c.options.length + ' options', c.run > 1 && 'added by change ' + c.run].filter(Boolean).join(' · ')}</td></tr>`)}</tbody></table>`}</div>`)}</div>
      ${def.migrations.length > 0 && html`<h4>Migrations</h4><ul class="plain">${def.migrations.map((m) => html`<li key=${m.n}><code>${m.sql.replace(/\s+/g, ' ')}</code><span class="muted t-cap"> · ${ago(m.at)}</span></li>`)}</ul>`}
    </div>`;
  }
  if (st.id === 'backend') {
    const P = def.process; if (!P) return pending; const sc = colOf(tableOf(def, P.table), P.column), pill = (s) => html`<span class=${'badge b-' + stateTone(def, tableOf(def, P.table), sc, s)}>${stateLabel(def, tableOf(def, P.table), sc, s)}</span>`;
    return html`<div class="out-grid">
      <div class="out-c wide"><h4>Workflow on ${P.table}.${P.column}</h4><div class="tbl-wrap"><table class="tbl dense"><thead><tr><th>Action</th><th>From</th><th>To</th><th>Who may do it</th></tr></thead><tbody>${P.transitions.map((x) => html`<tr key=${x.id}><td><strong>${x.label}</strong></td><td>${x.from.map((f) => [pill(f), ' '])}</td><td>${pill(x.to)}</td><td>${x.roles.map((r) => roleName(def, r)).join(', ')}</td></tr>`)}</tbody></table></div></div>
      <div class="out-c wide"><h4>Access rules</h4><${AccessMatrix} app=${app} /><p class="muted t-cap">"own" means only rows whose owner is the signed-in user. ${deriveEndpoints(def).length} endpoints are derived from these rules; the API view lists and tests them.</p></div>
      ${def.team && html`<div class="out-c wide"><h4>The app's own agents: ${def.team.title}</h4><p class="muted t-cap">${def.team.about} A run opens with "${(P.transitions.find((x) => x.id === def.team.start) || {}).label}" and closes with "${(P.transitions.find((x) => x.id === def.team.done) || {}).label}". The agents write through the endpoints above, as the person who started the run.</p>
        <div class="tbl-wrap"><table class="tbl dense"><thead><tr><th>Agent</th><th>Job</th><th>Writes</th><th>Connections</th></tr></thead><tbody>${def.team.agents.map((a) => html`<tr key=${a.id}><td><span class="who"><${TeamAv} a=${a} size="xs" /><strong>${a.name}</strong></span></td><td>${a.job}</td><td class="t-cap">${[a.writes && 'adds ' + a.writes, a.updates && 'edits ' + a.updates, a.sets.length && 'fills ' + a.sets.join(', ')].filter(Boolean).join(' · ')}</td><td class="t-cap">${a.tools.length ? a.tools.map((x) => x.connector + ' · ' + x.tool).join(', ') : html`<span class="muted">None</span>`}</td></tr>`)}</tbody></table></div>
        ${def.team.pause && html`<p class="muted t-cap">Human in the loop: the run pauses before ${(def.team.agents.find((a) => a.id === def.team.pause.before) || {}).name} so a person can add a point.</p>`}</div>`}
    </div>`;
  }
  if (st.id === 'views') {
    if (!def.dash || !Object.keys(def.views || {}).length) return pending; const KIND = { kpi: 'Number', bar: 'Bars', stack: 'Stacked bars', line: 'Line over time', recent: 'Latest records' };
    return html`<div class="out-grid">
      <div class="out-c wide"><p class="muted t-cap">The View advisor reads the columns of each table and recommends the views they can carry. Code checks every recommendation against the rule for that view, then mounts each one with the real rows.</p>
        <div class="tbl-wrap"><table class="tbl dense viewplan"><thead><tr><th>Table</th>${DATA_VIEWS.map((v) => html`<th key=${v} title=${VIEW_WHAT[v]}>${VIEW_LABEL[v]}</th>`)}</tr></thead>
        <tbody>${def.tables.map((t) => html`<tr key=${t.name}><td><strong>${t.label}</strong></td>${DATA_VIEWS.map((v) => { const rec = viewsOf(def, t).find((x) => x.type === v), why = viewFit(def, t, v); return html`<td key=${v} title=${rec ? rec.why : why ? 'Does not fit: it ' + why : 'Fits, but was not recommended'}>${rec ? html`<span class="badge b-success"><${Icon} n="check" s="12" />Yes</span>` : why ? html`<span class="muted">No</span>` : html`<span class="badge b-outline">Fits</span>`}</td>`; })}</tr>`)}</tbody></table></div></div>
      <div class="out-c"><h4>Why these views</h4>${def.tables.map((t) => html`<div key=${t.name}><p class="t-strong">${t.label}</p><ul class="plain">${viewsOf(def, t).map((v) => html`<li key=${v.type}><span class="badge b-outline"><${Icon} n=${VIEW_ICON[v.type]} s="12" />${VIEW_LABEL[v.type]}</span> <span class="muted">${v.why}</span></li>`)}</ul></div>`)}</div>
      <div class="out-c"><h4>Dashboard: ${def.dash.title}</h4><ul class="plain">${def.dash.widgets.map((w, i) => html`<li key=${i}><span class="badge b-outline">${KIND[w.kind]}</span> ${w.label}<span class="muted t-cap"> · ${w.table}${w.x ? ' by ' + w.x : ''}${w.split ? ', split by ' + w.split : ''}${w.measure && w.measure !== 'count' ? ', ' + w.measure.replace(':', ' of ') : ''}</span></li>`)}</ul>
        <p class="muted t-cap">${def.dash.date ? 'The date filter uses ' + def.dash.date.table + '.' + def.dash.date.column + '.' : 'No date filter.'} Every role gets this dashboard, counted from the rows that role may see.</p></div>
    </div>`;
  }
  if (st.id === 'screens') {
    if (!def.screens.length) return pending;
    return html`<div><p class="muted t-cap">Layout chosen by the UI agent: <span class=${'swatch acc-' + def.theme.accent}></span>${label(def.theme.accent)} accent, ${def.theme.nav === 'rail' ? 'icon rail' : def.theme.nav + ' navigation'}${def.theme.density === 'compact' ? ', compact rows' : ''}. Each page opens one table in a default view, and people can switch to any other view the advisor recommended for that table.</p>
      <div class="screens">${def.screens.map((s) => html`<div key=${s.id} class="card flat scard"><span class="scard-ic"><${Icon} n=${VIEW_ICON[s.type]} /></span><div class="col gap4 grow"><strong>${s.name}</strong><span class="t-cap muted">${VIEW_LABEL[s.type]} on ${s.table}${s.group ? ', grouped by ' + s.group : ''}${s.date ? ', dated by ' + s.date : ''}${s.range ? ', ' + s.range + ' only' : ''}</span><span class="row wrap gap4">${s.roles.map((r) => html`<span key=${r} class="badge b-outline">${roleName(def, r)}</span>`)}</span></div></div>`)}</div></div>`;
  }
  if (!def.tour.length) return pending; const res = app.line.walkthrough.results || [];
  return html`<div><div class="row between wrap"><span class="muted t-cap">The UI agent wrote these steps from the user stories. Code plays them against the real endpoints inside a savepoint, then rolls back.</span><button class="btn sm" onClick=${() => startWalk(app)}><${Icon} n="playOutline" s="16" />Play it in the app</button></div>
    <ol class="tour-list">${def.tour.map((s, i) => { const r = res[i]; return html`<li key=${i} class=${r ? (r.ok ? 'ok' : 'bad') : ''}><${Icon} n=${r ? (r.ok ? 'checkCircle' : 'errorCircle') : 'circle'} /><div><div>${s.say}</div><div class="t-cap muted mono">${roleName(def, s.role)} · ${s.do}${s.transition ? ' ' + s.transition : ''}${s.action ? ' ' + s.action : ''}${s.table ? ' · ' + s.table : ''}${r ? ' · ' + r.detail : ''}</div></div></li>`; })}</ol></div>`;
}
