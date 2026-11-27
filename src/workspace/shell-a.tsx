import { Fragment, Suspense, lazy } from 'react';
import { AreaBoundary } from '@/platform/area-boundary';
import {
  BRAND,
  LS,
  NARROW,
  NO_MODEL,
  PHONE,
  S,
  U,
  ago,
  cap,
  chatShown,
  closeTab,
  commit,
  confirmBox,
  cx,
  fmtBytes,
  fmtMs,
  label,
  me,
  modeNow,
  myApps,
  initials,
  netInfo,
  notify,
  online,
  openDialog,
  openTab,
  selectTab,
  setChat,
  setLive,
  setOffline,
  signOut,
  str,
  tabsNow,
  toast,
  uid,
} from './core';
import type { BackedDef, BriefedDef } from '@/shared/types/app';
import type { AppRecord, Run, StationLine, Tab } from '@/shared/types/workspace';
import type { MenuEntry, TabItem } from './ui';
import { DBX, createTableSQL, dbCount, dbTables } from './db';
import { TYPE_LABEL, VIEW_ICON, VIEW_LABEL, accOf, colOf, deriveEndpoints, roleName, tableOf } from './engine';
import { DATA_VIEWS, VIEW_WHAT, viewFit, viewsOf } from './viewspec';
import { HOME_TEMPLATES, REC, matchTemplate } from './builds';
import { beginInterview, interviewNow, plannerReady } from './interview';
import { InterviewView } from './interview-ui';
import { QUESTS } from './quests';
import { TEAMS, TeamAv } from './team';
import { StationTests, TestsView, suiteOf, testable } from './tests';
import { BuildSummary, FlowView } from './flow';
import { type Station, AGENTS, PENDING, RUNS, STATIONS, deleteApp, duplicateApp, rebuild, startBuild, stopRun } from './line';
import { CustomTab, FlowChips, ReviewPanel, answerGate, flowList, flowOf, reviewerAt } from './custom';
import { REVIEWERS } from './reviewers';
import { TesterPanel } from './tester';
import {
  AgentAv,
  Avatar,
  Btn,
  Card,
  CheckList,
  Chip,
  Empty,
  Icon,
  Logo,
  MBar,
  Menu,
  Proto,
  Seg,
  Spinner,
  STATUS_META,
  Switch,
  Tabs,
  Textarea,
} from './ui';
import { AppLauncher, PhoneBar, PhoneNav } from './mobile';
import { StageView, stageOf, startWalk, stateLabel, stateTone } from './runtime';
import { enterSolo, keepShared, openShare, sharedApps } from './share';
import { AppLogo, ReleaseView, isDirty, relOf } from './release';
import { ApiView, ChatPanel, ConnView, DataView } from './shell-b';
import { startTour } from './shell-c';
import { RerunBar } from './rerun';
import { openPalette, openShortcuts } from './commands';
import { touchOf, touchText } from './provenance';
import { fmtUsd, usageLine } from '@/platform/agui/usage';
import { HistoryButtons, openHistory } from './history-ui';

// The meeting view of a run loads the first time it is picked.
const MeetingView = lazy(() => import('./meeting').then((m) => ({ default: m.MeetingView })));

/* ===== Turnkey prototype · shell: title bar with workspace tabs, home, workspace, the line ===== */
export function Titlebar({ tabs, tab }: { tabs: Tab[]; tab: Tab }) {
  const acct = me(),
    s = S.settings,
    on = online(),
    mode = modeNow(),
    net = netInfo();
  const addTab = () => {
    const t: Tab = {
      id: uid('tab'),
      app: null,
    };
    tabsNow().push(t);
    S.active[String(S.session)] = t.id;
    commit();
  };
  const flipNet = () => setOffline(!s.offline);
  if (PHONE()) return <PhoneBar tabs={tabs} tab={tab} />;
  return (
    <header className="titlebar">
      <button className="brand" title="New tab" onClick={() => openTab(null)}>
        <Logo />
        <span className="brand-t hide-md">{BRAND.name}</span>
      </button>
      <nav className="tabstrip" aria-label="Open workspaces" data-tour="tabs">
        {tabs.map((t) => {
          const app = t.app ? S.apps[t.app] : null,
            cur = t.id === tab.id;
          return (
            <div
              key={t.id}
              className={cx('wtab', cur && 'on')}
              title={app ? app.name : 'New tab'}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(t.id);
              }}
            >
              <button className="wtab-b" aria-current={cur ? 'page' : undefined} onClick={() => selectTab(t.id)}>
                {app ? (
                  <span className={'wtab-ic acc-' + app.accent}>
                    <Icon n={app.icon} s="12" />
                  </span>
                ) : (
                  <Icon n="tab" s="16" />
                )}
                <span className="wtab-t ellipsis">{app ? app.name : 'New tab'}</span>
                {app && RUNS[app.id] && <Spinner />}
              </button>
              <button
                className="wtab-x"
                aria-label={'Close ' + (app ? app.name : 'tab')}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                <Icon n="dismiss" s="12" />
              </button>
            </div>
          );
        })}
        <button className="newtab" aria-label="New tab" title="New tab" onClick={addTab}>
          <Icon n="add" s="16" />
        </button>
      </nav>
      <div className="tb-right">
        <span className="act-slot" />
        <span data-tour="mode" className={cx('tb-mode', mode.on && 'is-live')}>
          <Switch
            id="sw-live"
            on={mode.on}
            disabled={!on}
            onChange={setLive}
            text="Live"
            title={
              !on
                ? 'Live is paused because you are offline. It switches itself back on when the connection returns.'
                : mode.on
                  ? 'Live: you are connected, so your own sentence goes to the model. Live follows the internet connection. Switch off for Demo.'
                  : 'Demo: saved builds with made-up data, no model calls. Switch on for Live.'
            }
          />
          {!mode.on && (
            <span className={cx('badge', s.demo ? 'b-outline' : 'b-warning')} id="mode-why">
              {s.demo ? 'Demo' : 'Paused'}
            </span>
          )}
        </span>
        <Btn
          className={cx('btn subtle sm net', !on && 'is-offline')}
          data-tour="net"
          aria-pressed={!on}
          title={
            on
              ? 'Online' + (net ? ' (' + net + ')' : '') + '. Live follows this connection. Click to see what happens without it.'
              : s.offline
                ? 'Offline (simulated). Click to go back online.'
                : 'This device is offline. Live comes back when it reconnects.'
          }
          onClick={flipNet}
        >
          <Icon n={on ? 'wifi' : 'wifiOff'} s="16" />
          <span className="hide-md">{on ? 'Online' : 'Offline'}</span>
        </Btn>
        {!s.installed && (
          <Btn className="btn subtle sm hide-md" onClick={() => openDialog('install')}>
            <Icon n="install" s="16" />
            Install
          </Btn>
        )}
        <Btn
          className={cx('btn subtle icon', s.debug && 'on')}
          data-tour="debug"
          aria-pressed={s.debug}
          title="Debug mode"
          aria-label="Debug mode"
          onClick={() => {
            s.debug = !s.debug;
            commit();
          }}
        >
          <Icon n="bug" />
        </Btn>
        <Menu
          title="Help"
          btn={{
            cls: 'btn subtle icon',
            label: 'Help',
            body: <Icon n="help" />,
          }}
          items={[
            {
              label: 'Feature guide',
              icon: 'bookOpen',
              on: () => openDialog('guide'),
            },
            {
              label: 'Commands',
              icon: 'search',
              hint: /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K',
              on: openPalette,
            },
            {
              label: 'Keyboard shortcuts',
              icon: 'keyboard',
              hint: '?',
              on: openShortcuts,
            },
            {
              label: 'Take the guided tour',
              icon: 'compass',
              on: () => startTour(),
            },
            {
              label: 'Open a shared app',
              icon: 'open',
              on: () =>
                openDialog('openlink', {
                  text: '',
                }),
            },
            {
              label: 'What is real in Turnkey',
              icon: 'info',
              on: () => openDialog('about'),
            },
          ]}
        />
        <Menu
          tour="account"
          title="Account"
          btn={{
            cls: 'acct',
            label: 'Account menu ' + initials(acct?.name || ''), // the initials are visible, so the name must contain them (WCAG 2.5.3)
            body: <Avatar name={acct?.name || ''} size="sm" acc="blue" />,
          }}
          items={[
            {
              head: true,
              label: (acct?.name || '') + ' · ' + (acct?.username || ''),
            },
            {
              label: 'Settings',
              icon: 'settings',
              on: () => openDialog('settings'),
            },
            {
              label: s.installed ? 'Installed as an app' : 'Install as an app',
              icon: 'install',
              on: () => openDialog('install'),
            },
            {
              label: 'Reset data',
              icon: 'reset',
              on: () => openDialog('reset'),
            },
            '-',
            {
              label: 'Sign out',
              icon: 'signOut',
              on: signOut,
            },
          ]}
        />
      </div>
    </header>
  );
}
export function Home() {
  const acct = me(),
    apps = myApps(),
    guests = sharedApps(),
    h = U.home,
    mode = modeNow(),
    demo = !mode.live,
    hr = new Date().getHours();
  // A typed sentence is followed by a few questions and a plan to approve. A saved build stands in when no model can be
  // called; a live sentence gets the interview once the Planner is connected, and builds straight away until then.
  const guided = demo || plannerReady();
  const go = (skip?: boolean) => {
    const text = str(h.text);
    if (!text) {
      h.note = 'Describe the app in one sentence first.';
      return notify();
    }
    if (demo) {
      // no model to call right now: Demo was chosen, the connection is gone, or this copy has no model. A saved build stands in.
      const tpl = matchTemplate(text),
        why: Record<string, string> = {
          demo: 'Demo replays saved builds, and none of them matches that sentence. Pick one below, or switch Live on in the title bar to build from your own words.',
          offline:
            'You are offline, so Live is paused and only saved builds can run. None of them matches that sentence. Pick one below, or try again when you are back online.',
          checking: 'Still connecting to the model. Try again in a moment, or pick a saved build below.',
          nomodel:
            NO_MODEL +
            ' None of the saved builds matches that sentence, so pick one below. Live calls the model through Turnkey’s own server route once a model key is set there.',
        };
      if (!tpl) {
        h.note = why[mode.id];
        return notify();
      }
      if (mode.id !== 'demo')
        toast(
          mode.id === 'offline'
            ? 'You are offline, so I am replaying the closest saved build.'
            : mode.id === 'checking'
              ? 'Still connecting to the model, so I am replaying the closest saved build.'
              : NO_MODEL + ' I am replaying the closest saved build.',
          'info',
          6500,
        );
      beginInterview(REC[tpl].sentence, tpl, skip);
    } else if (guided) beginInterview(text, null, skip);
    else if (
      startBuild({
        request: text,
      })
    ) {
      h.text = '';
      h.note = '';
    }
  };
  const del = async (a: AppRecord) => {
    if (
      await confirmBox({
        title: 'Delete ' + a.name + '?',
        body: 'The app, its SQLite database and its chat are removed from this browser.',
        yes: 'Delete app',
        danger: true,
      })
    ) {
      deleteApp(a);
      toast(a.name + ' deleted', 'success');
    }
  };
  const builtOf = (id: string) => apps.find((a) => a.tpl === id && a.status !== 'failed'),
    build = (id: string) =>
      startBuild({
        request: REC[id].sentence,
        tpl: id,
      });
  const buildAll = () => {
    const todo = QUESTS.filter((id) => !builtOf(id));
    if (!todo.length) return toast('All three quest apps are already in your library.', 'info');
    todo.forEach(build);
  };
  const dup = (a: AppRecord) => {
    const c = duplicateApp(a);
    if (c) toast(c.name + ' was added to your library', 'success');
  };
  const card = (id: string) => {
    const r = REC[id],
      has = builtOf(id);
    return (
      <Card key={id} className="card tpl" data-tpl={id}>
        <span className="row gap8">
          <span className={'tpl-ic acc-' + r.accent}>
            <Icon n={r.icon} s="24" />
          </span>
          <span className="grow" />
          {r.quest && (
            <span className="badge b-outline">
              {'Quest '}
              {r.quest}
            </span>
          )}
          {has && <span className="badge b-success">In your library</span>}
        </span>
        <strong className="t-sub2">{r.title}</strong>
        <span className="muted">{r.blurb}</span>
        {r.agents && (
          <span className="row wrap gap4">
            {r.agents.map((n) => (
              <span key={n} className="badge b-outline">
                <Icon n="bot" s="12" />
                {n}
              </span>
            ))}
          </span>
        )}
        <span className="row tpl-acts">
          {has ? (
            <>
              <Btn className="btn primary sm" onClick={() => openTab(has.id)}>
                Open
              </Btn>
              <Btn className="btn sm tpl-build" onClick={() => build(id)}>
                Build another
              </Btn>
            </>
          ) : (
            <Btn className="btn primary sm tpl-build" onClick={() => build(id)}>
              <Icon n="sparkle" s="16" />
              Build this app
            </Btn>
          )}
        </span>
      </Card>
    );
  };
  const mine0 = (
    <>
      {'    '}
      <div className="row between sec" data-tour="library">
        <div className="col gap0">
          <h2 className="t-sub2">
            Your apps
            {apps.length ? (
              <>
                {' '}
                <span className="tab-n">{apps.length}</span>
              </>
            ) : null}
          </h2>
          <span className="t-cap muted">
            Every app you build is saved in this browser with its data, rules, views and screens, and is still here when you sign in again.
          </span>
        </div>
        <Btn
          className="btn sm"
          onClick={() =>
            openDialog('openlink', {
              text: '',
            })
          }
        >
          <Icon n="open" s="16" />
          Open a shared app
        </Btn>
      </div>
      {apps.length ? (
        <div className="apps">
          {apps.map((a) => (
            <Card key={a.id} className="card app-row">
              <button className="app-open" onClick={() => openTab(a.id)}>
                <AppLogo app={a} size={36} />
                <span className="col gap0 grow">
                  <strong>{a.name}</strong>
                  <span className="t-cap muted ellipsis">{a.request}</span>
                </span>
              </button>
              {a.def.team && (
                <span className="badge b-outline hide-sm">
                  <Icon n="bot" s="12" />
                  {a.def.team.agents.length}
                  {' agents'}
                </span>
              )}
              <span
                className={
                  'badge b-' +
                  (a.status === 'ready'
                    ? isDirty(a)
                      ? 'warning'
                      : 'success'
                    : a.status === 'failed'
                      ? 'danger'
                      : RUNS[a.id]
                        ? 'info'
                        : 'warning')
                }
              >
                {RUNS[a.id]
                  ? 'Building'
                  : a.status === 'ready' && relOf(a)
                    ? isDirty(a)
                      ? 'Draft · ' + relOf(a)?.v + ' is out'
                      : 'Version ' + relOf(a)?.v
                    : cap(a.status)}
              </span>
              <span className="t-cap muted hide-sm">
                {a.def.screens.length}
                {' pages · '}
                {a.def.tables.length}
                {' tables · '}
                {fmtBytes(DBX.size[a.id] || LS.size('db:' + a.id))}
                {' · '}
                {ago(a.updated)}
              </span>
              <Btn
                className="btn subtle icon"
                aria-label={'Share ' + a.name}
                title="Share by link"
                disabled={a.status !== 'ready' || !!RUNS[a.id]}
                onClick={() => openShare(a)}
              >
                <Icon n="share" />
              </Btn>
              <Btn
                className="btn subtle icon"
                aria-label={'Duplicate ' + a.name}
                title="Duplicate app with its data"
                disabled={a.status !== 'ready' || !!RUNS[a.id]}
                onClick={() => dup(a)}
              >
                <Icon n="copy" />
              </Btn>
              <Btn className="btn subtle icon" aria-label={'Delete ' + a.name} title="Delete app" onClick={() => del(a)}>
                <Icon n="trash" />
              </Btn>
            </Card>
          ))}
        </div>
      ) : (
        <p className="muted">Nothing yet. Build one of the apps above, or describe your own.</p>
      )}
    </>
  );
  const mine = apps.length ? mine0 : null;
  if (interviewNow()) return <InterviewView />;
  return (
    <div className="home scroll">
      <div className="home-in">
        <h1 className="t-title2">
          {hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}
          {', '}
          {(acct?.name || '').split(' ')[0]}. What do you want to build?
        </h1>
        <p className="lead muted">
          {guided
            ? 'Say it in one sentence. Turnkey asks a few short questions, shows you a plan in plain words, and builds only after you say yes.'
            : 'Say what the work is in one sentence. A team of agents builds the whole app, tests it and hands it over ready to use.'}
        </p>
        <div className="prompt" data-tour="prompt">
          <Textarea
            native
            className="textarea"
            id="home-prompt"
            rows={2}
            aria-label="Describe the app"
            placeholder={
              demo ? 'Try: a clinic that books patient appointments' : 'Example: a gym tracks members, class bookings and trainer schedules'
            }
            value={h.text}
            onInput={(e) => {
              h.text = e.currentTarget.value;
              h.note = '';
              notify();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                go();
              }
            }}
          />
          <div className="prompt-bar">
            <span className={cx('badge', mode.cls)} id="home-mode">
              {mode.long}
            </span>
            <span className="grow" />
            {guided && (
              <Btn className="btn subtle" id="home-skip" onClick={() => go(true)}>
                Skip the questions
              </Btn>
            )}
            <Btn className="btn primary" id="home-go" onClick={() => go()}>
              {guided ? (
                <>
                  Continue
                  <Icon n="arrowRight" />
                </>
              ) : (
                <>
                  <Icon n="sparkle" />
                  Build
                </>
              )}
            </Btn>
          </div>
        </div>
        {h.note && <MBar tone="warning">{h.note}</MBar>}
        <ol className="how" aria-label="What happens next">
          {(guided
            ? [
                ['A few questions', 'Up to five, one at a time. Skip any and the usual choice is used'],
                ['A plan you approve', 'Who uses it, what it keeps and who builds it. Nothing is built before you say yes'],
                ['A team builds it', 'Only the agents this app needs, while you look on'],
                ['Release, then improve', 'Share it by link. Later, ask for a fix or a new feature in plain words'],
              ]
            : [
                ['Describe', 'One sentence about the work'],
                ['Watch it being built', 'Agents build and test it while you look on'],
                ['Use it', 'The working app, with sample data'],
                ['Release and share', 'One link installs the app alone'],
              ]
          ).map(([title, text], i) => (
            <li key={title}>
              <span className="how-n">{i + 1}</span>
              <span>
                <strong>{title}</strong>
                <span className="t-cap muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        {mine}
        <div className="row between sec" data-tour="quests">
          <div className="col gap0">
            <h2 className="t-sub2">Hackathon quests</h2>
            <span className="t-cap muted">Each one becomes its own app, with a team of three agents that work inside it.</span>
          </div>
          <Btn className="btn sm" onClick={buildAll}>
            <Icon n="apps" s="16" />
            Build all three
          </Btn>
        </div>
        <div className="tpl-grid">{QUESTS.map(card)}</div>
        <div className="col gap0 sec">
          <h2 className="t-sub2">Business apps</h2>
          <span className="t-cap muted">Record-keeping apps with roles and a workflow.</span>
        </div>
        <div className="tpl-grid">{HOME_TEMPLATES.map(card)}</div>
        {!apps.length ? mine0 : null}
        {guests.length > 0 && (
          <>
            <div className="col gap0 sec">
              <h2 className="t-sub2">
                {'Opened from links '}
                <span className="tab-n">{guests.length}</span>
              </h2>
              <span className="t-cap muted">Apps someone shared with you. Each one is your own copy, with its own data.</span>
            </div>
            <div className="apps">
              {guests.map((a) => (
                <Card key={a.id} className="card app-row">
                  <button
                    className="app-open"
                    onClick={() =>
                      enterSolo(a, {
                        from: 'link',
                        as: a.shared?.as,
                      })
                    }
                  >
                    <span className={'tpl-ic sm acc-' + a.accent}>
                      <Icon n={a.icon} />
                    </span>
                    <span className="col gap0 grow">
                      <strong>{a.name}</strong>
                      <span className="t-cap muted ellipsis">
                        {a.shared?.by ? 'Shared by ' + a.shared.by + ' · ' : ''}
                        {a.def.tables.length}
                        {' tables · '}
                        {a.def.screens.length}
                        {' pages · opened '}
                        {ago(a.shared?.at || a.created)}
                      </span>
                    </span>
                  </button>
                  <Btn className="btn sm" onClick={() => keepShared(a)}>
                    <Icon n="save" s="16" />
                    <span className="hide-sm">Save to my apps</span>
                  </Btn>
                  <Btn className="btn subtle icon" aria-label={'Remove ' + a.name} title="Remove this copy" onClick={() => del(a)}>
                    <Icon n="trash" />
                  </Btn>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
export const VIEWS: TabItem[] = [
  {
    id: 'build',
    label: 'Build',
    icon: 'production',
    title: 'Watch the agents build it, and change how they work',
  },
  {
    id: 'app',
    label: 'App',
    icon: 'window',
    title: 'Use the working app',
  },
  {
    id: 'release',
    label: 'Release',
    icon: 'rocket',
    title: 'Versions, sharing and installing',
  },
  {
    id: 'details',
    label: 'Details',
    icon: 'wrench',
    title: 'For the curious: tests, data, API and connections',
  },
];
export const DETAILS: TabItem[] = [
  {
    id: 'tests',
    label: 'Tests',
    icon: 'beaker',
    title: 'Every test the build wrote, and how it went',
  },
  {
    id: 'data',
    label: 'Data',
    icon: 'database',
    title: 'The SQLite tables',
  },
  {
    id: 'api',
    label: 'API',
    icon: 'server',
    title: 'Endpoints and permissions',
  },
  {
    id: 'conn',
    label: 'Connections',
    icon: 'plug',
    title: 'Third-party systems',
  },
];
export const isDetail = (v: string) => DETAILS.some((d) => d.id === v);
export const viewOf = (app: AppRecord): string => U.view[app.id] || (app.status === 'ready' && !RUNS[app.id] ? 'app' : 'build'); // a finished app opens on the app itself, an unfinished one on its build
export const viewTitle = (v: string) => (VIEWS.concat(DETAILS).find((x) => x.id === v) || VIEWS[0]).title;
export const RUN_KIND: Record<string, string> = {
  build: 'Build',
  change: 'Change',
  rerun: 'Re-run',
  review: 'Review',
  step: 'Step',
};
/** The line's run functions are typed for a full definition; a run fills it in station by station, so any app may start one. */
export const lineApp = (app: AppRecord) => app as Parameters<typeof rebuild>[0];
/** The app's own agent team writes rows through the rules and screens a build replaces, so a build waits for it, as chat does. */
export const TEAM_BUSY = "The app's own agents are in the middle of a run. Run the build again when they have finished.";
export async function rebuildAsk(app: AppRecord) {
  if (RUNS[app.id]) return;
  if (TEAMS[app.id]?.status === 'running') return void toast(TEAM_BUSY, 'info');
  if (
    app.status === 'ready' &&
    !(await confirmBox({
      title: 'Run the build again?',
      body: 'The agents start from the request again. The current database and any changes you asked for are replaced.',
      yes: 'Run again',
    }))
  )
    return;
  rebuild(lineApp(app));
}
export function DetailsView({ app, view }: { app: AppRecord; view: string }) {
  // everything a developer would ask for, kept one step away from everyone else
  const pick = (v: string) => {
    U.view[app.id] = v;
    U.detail[app.id] = v;
    notify();
  };
  return (
    <div className="details">
      <div className="details-bar">
        <Tabs cls="subtabs" label="Details" items={DETAILS} value={view} onChange={pick} />
        <span className="grow" />
        <span className="t-cap muted hide-md">For the curious. You never need these pages to use, release or share the app.</span>
      </div>
      <div className="details-body">
        {view === 'tests' ? (
          <TestsView app={app} />
        ) : view === 'data' ? (
          <DataView app={app} />
        ) : view === 'api' ? (
          <ApiView app={app} />
        ) : (
          <ConnView app={app} />
        )}
      </div>
    </div>
  );
}
export function Workspace({ app }: { app: AppRecord }) {
  const view = viewOf(app),
    busy = !!RUNS[app.id],
    rel = relOf(app),
    dirty = isDirty(app);
  const st = busy
    ? ['info', 'Building']
    : app.status === 'ready'
      ? rel
        ? dirty
          ? ['warning', 'Draft · ' + rel.v + ' is out']
          : ['success', 'Version ' + rel.v]
        : ['success', 'Ready']
      : app.status === 'failed'
        ? ['danger', 'Failed']
        : app.status === 'stopped'
          ? ['warning', 'Not finished']
          : ['neutral', 'New'];
  const del = async () => {
    if (
      await confirmBox({
        title: 'Delete ' + app.name + '?',
        body: 'The app, its SQLite database and its chat are removed from this browser.',
        yes: 'Delete app',
        danger: true,
      })
    )
      deleteApp(app);
  };
  const go = (v: string) => {
    U.view[app.id] = v === 'details' ? U.detail[app.id] || 'tests' : v;
    notify();
  };
  const phone = PHONE(),
    more: (MenuEntry | '-')[] = [
      {
        label: 'Share by link',
        icon: 'share',
        disabled: app.status !== 'ready',
        on: () => openShare(app),
      },
      {
        label: 'Export build pack',
        icon: 'document',
        disabled: app.status !== 'ready',
        on: () =>
          openDialog('pack', {
            app: app.id,
          }),
      },
      {
        label: 'Version history',
        icon: 'history',
        disabled: app.status !== 'ready',
        on: () => openHistory(app),
      },
      {
        label: 'Rename app',
        icon: 'edit',
        disabled: app.status !== 'ready' || busy,
        on: () =>
          openDialog('rename', {
            app: app.id,
            name: app.name,
          }),
      },
      {
        label: 'Run the build again',
        icon: 'rerun',
        disabled: busy,
        on: () => rebuildAsk(app),
      },
      {
        label: 'Customize the workflow',
        icon: 'options',
        on: () =>
          openDialog('workflow', {
            app: app.id,
          }),
      },
      '-',
      {
        label: 'Delete app',
        icon: 'trash',
        danger: true,
        on: del,
      },
    ];
  const tabs = VIEWS.map((v): TabItem =>
    v.id === 'release' && app.status === 'ready'
      ? Object.assign({}, v, {
          count: rel ? (dirty ? 'draft' : rel.v) : 'new',
        })
      : v,
  );
  const body =
    view === 'build' ? (
      <BuildView app={app} />
    ) : view === 'release' ? (
      <ReleaseView app={app} />
    ) : isDetail(view) ? (
      <DetailsView app={app} view={view} />
    ) : null;
  if (phone)
    return (
      <div className="work phone">
        <div className="work-main">
          <div className="work-head">
            <AppLogo app={app} size={32} />
            <div className="col gap0 work-id grow">
              <strong className="ellipsis">{app.name}</strong>
              <span className="t-cap muted ellipsis">{chatShown() ? 'Ask the builders for a change' : viewTitle(view)}</span>
            </div>
            <span className={'badge b-' + st[0]}>
              {busy && <Spinner />}
              {st[1]}
            </span>
            <Btn
              className="btn subtle icon"
              aria-label="Share by link"
              title="Share by link"
              disabled={app.status !== 'ready'}
              onClick={() => openShare(app)}
            >
              <Icon n="share" />
            </Btn>
          </div>
          <AreaBoundary name={chatShown() ? 'The chat' : 'This view'} resetKey={chatShown() ? 'chat' : view}>
            <div className="view">
              {chatShown() ? (
                <ChatPanel app={app} />
              ) : view === 'app' ? (
                stageOf(app).tour ? (
                  <StageView app={app} />
                ) : (
                  <AppLauncher app={app} />
                )
              ) : (
                body
              )}
            </div>
          </AreaBoundary>
        </div>
        <PhoneNav app={app} />
      </div>
    );
  return (
    <div className="work">
      <div className="work-main">
        <div className="work-head">
          <AppLogo app={app} size={32} />
          <div className="col gap0 work-id">
            <strong className="ellipsis">{app.name}</strong>
            <span className="t-cap muted ellipsis" title={app.request}>
              {app.request}
            </span>
          </div>
          <span className={'badge b-' + st[0]} id="app-state">
            {busy && <Spinner />}
            {st[1]}
          </span>
          <span data-tour="views" className="views-wrap">
            <Tabs cls="views" label="Workspace views" items={tabs} value={isDetail(view) ? 'details' : view} onChange={go} />
          </span>
          <span className="grow" />
          <HistoryButtons app={app} />
          <Btn
            className="btn sm"
            data-tour="share"
            disabled={app.status !== 'ready'}
            title="Send a link that opens only this app"
            onClick={() => openShare(app)}
          >
            <Icon n="share" s="16" />
            <span className="hide-md">Share</span>
          </Btn>
          {!chatShown() && (
            <Btn className="btn sm" title="Ask the builders for a change" onClick={() => setChat(true)}>
              <Icon n="chat" s="16" />
              Chat
            </Btn>
          )}
          <Menu
            title="More"
            btn={{
              cls: 'btn subtle icon',
              label: 'More actions',
              body: <Icon n="more" />,
            }}
            items={more}
          />
        </div>
        {/* On a tablet the chat lies over the view, below the header, so the view tabs and Share stay in reach. */}
        <div className={'view' + (chatShown() && NARROW() ? ' has-chat' : '')}>
          <AreaBoundary name="This view" resetKey={view}>
            {view === 'app' ? <StageView app={app} /> : body}
          </AreaBoundary>
          {chatShown() && NARROW() && (
            <AreaBoundary name="The chat">
              <ChatPanel app={app} />
            </AreaBoundary>
          )}
        </div>
      </div>
      {chatShown() && !NARROW() && (
        <AreaBoundary name="The chat">
          <ChatPanel app={app} />
        </AreaBoundary>
      )}
    </div>
  );
}
export function BuildView({ app }: { app: AppRecord }) {
  const mode = U.bview[app.id] || 'line',
    busy = !!RUNS[app.id],
    sel = U.sel[app.id] || 'research';
  const run = app.runs.find((r) => r.id === U.runSel[app.id]) || app.runs[app.runs.length - 1];
  const toChat = () => {
    setChat(true);
    setTimeout(() => {
      const el = document.getElementById('chat-' + app.id);
      if (el) el.focus();
    }, 50);
  };
  return (
    <div className="build scroll">
      <BuildSummary app={app} />
      <div className="build-bar">
        <Seg
          label="How to view the agents"
          items={[
            {
              id: 'line',
              label: 'Workflow',
              icon: 'flow',
              title: 'Agents, check gates and handoffs',
            },
            {
              id: 'timeline',
              label: 'Timeline',
              icon: 'timeline',
              title: 'Who worked when',
            },
            {
              id: 'log',
              label: 'Log',
              icon: 'list',
              title: 'Every step in order',
            },
            {
              id: 'meeting',
              label: 'Meeting',
              icon: 'people',
              title: 'The agents as a meeting: who is speaking, who has a hand raised',
            },
          ]}
          value={mode}
          onChange={(v) => {
            U.bview[app.id] = v;
            notify();
          }}
        />
        {run && (
          <span className="t-cap muted hide-sm">
            {RUN_KIND[run.kind] || 'Run'} {run.n}
            {' · '}
            {/* eslint-disable-next-line react-hooks/purity -- a run's elapsed time; the store re-renders while it runs */}
            {run.status === 'running' ? 'running' : fmtMs((run.t1 || Date.now()) - run.t0)}
            {' · '}
            {run.mode === 'live' && (run.kind === 'build' || run.kind === 'rerun')
              ? run.calls + ' model calls'
              : run.replayed
                ? run.replayed + ' replayed, 0 model calls'
                : run.calls + ' model calls'}
            {run.retries ? ' · ' + run.retries + ' sent back' : ''}
          </span>
        )}
        <span className="grow" />
        {busy ? (
          <Btn className="btn sm" aria-label="Stop" title="Stop" onClick={() => stopRun(app)}>
            <Icon n="stop" s="16" />
            <span className="hide-sm">Stop</span>
          </Btn>
        ) : (
          // on a phone the four views fill the row, so the button keeps only its icon
          <Btn className="btn sm" aria-label="Run again" title="Run again" onClick={() => rebuildAsk(app)}>
            <Icon n="rerun" s="16" />
            <span className="hide-sm">Run again</span>
          </Btn>
        )}
      </div>
      <RerunBar app={app} />
      {app.line.research.status === 'waiting' && app.line.research.hold !== 'approval' && (
        <MBar
          tone="warning"
          action={
            <Btn className="btn sm" onClick={toChat}>
              Answer in chat
            </Btn>
          }
        >
          The Researcher has a question for you. The line is paused until you answer.
        </MBar>
      )}
      {busy && RUNS[app.id].gate && (
        <MBar
          tone="warning"
          action={
            <Btn className="btn sm primary" onClick={() => answerGate(app, true)}>
              Approve and continue
            </Btn>
          }
        >
          {'The line is waiting for your approval after '}
          {STATIONS.find((s) => app.line[s.id].hold === 'approval')?.name || 'this station'}, as you set it. Select the station to see what
          was made.
        </MBar>
      )}
      {PENDING[app.id] && (
        <MBar
          tone="warning"
          action={
            <Btn className="btn sm" onClick={toChat}>
              Review in chat
            </Btn>
          }
        >
          A change is waiting for your approval because it deletes data.
        </MBar>
      )}
      {!busy && (app.status === 'stopped' || app.status === 'failed') && (
        <MBar
          tone={app.status === 'failed' ? 'danger' : 'info'}
          action={
            <Btn className="btn sm" onClick={() => rebuildAsk(app)}>
              Run again
            </Btn>
          }
        >
          {app.status === 'failed' ? 'The last build failed. The log and the debug drawer show where.' : 'This build did not finish.'}
        </MBar>
      )}
      {mode === 'line' ? (
        <FlowView app={app} sel={sel} />
      ) : mode === 'timeline' ? (
        <TimelineView app={app} run={run} />
      ) : mode === 'meeting' ? (
        <Suspense fallback={null}>
          <MeetingView app={app} run={run} sel={sel} />
        </Suspense>
      ) : (
        <LogView app={app} run={run} />
      )}
      {!PHONE() && <Inspector app={app} sid={sel} />}
    </div>
  );
}
export function LineView({ app, sel }: { app: AppRecord; sel?: string | null }) {
  const hand = U.handoff[app.id];
  return (
    <div className="line-wrap" data-tour="line">
      <div className="line">
        {STATIONS.map((st, i) => [
          <StationCard key={st.id} app={app} st={st} i={i} on={sel === st.id} />,
          i < STATIONS.length - 1 && (
            <div
              key={st.id + '-c'}
              className={cx('conn', hand === i && 'go', app.line[st.id].status === 'ok' && 'done')}
              aria-hidden="true"
            >
              <span className="conn-dot" />
            </div>
          ),
        ])}
      </div>
      <div className="flow-foot">
        <span className="grow" />
        <Btn
          className="btn sm"
          data-tour="customize"
          title="Approvals, review steps, instructions and attempts"
          onClick={() =>
            openDialog('workflow', {
              app: app.id,
            })
          }
        >
          <Icon n="options" s="16" />
          Customize{flowList(flowOf(app)).length > 0 && <span className="tab-n">{flowList(flowOf(app)).length}</span>}
        </Btn>
      </div>
      <div className="orch">
        <AgentAv id="orchestrator" size="sm" />
        <span>
          <strong>Orchestrator</strong>
          {' is code, not a model. It runs the stations in order, checks every handoff, '}
          {flowOf(app).attempts === 1
            ? 'gives each station one attempt'
            : 'sends failed work back at most ' + (flowOf(app).attempts === 2 ? 'once' : 'twice')}
          , and after a change re-runs only the stations that change touches.
        </span>
      </div>
      <FlowChips app={app} />
    </div>
  );
}
export function StationCard({ app, st, i, on }: { app: AppRecord; st: Station; i: number; on: boolean }) {
  const L = app.line[st.id],
    a = AGENTS[st.agent],
    meta = STATUS_META[L.status] || STATUS_META.idle,
    passed = L.checks.filter((c) => c.ok).length,
    active = L.status === 'working' || L.status === 'checking',
    stream = U.stream[app.id];
  return (
    <button
      className={cx('station', 's-' + L.status, on && 'sel', 'acc-' + a.acc)}
      data-tour={i === 1 ? 'station' : undefined}
      aria-pressed={on}
      onClick={() => {
        U.sel[app.id] = st.id;
        U.follow[app.id] = false;
        notify();
      }}
    >
      {active && <span className="pbar" />}
      <span className="st-top">
        <AgentAv id={st.agent} size="sm" />
        <span className="t-cap muted grow">
          {i + 1}
          {' · '}
          {a.name}
          {st.id === 'walkthrough' ? ' + code' : ''}
        </span>
      </span>
      <strong className="st-name">{st.name}</strong>
      <span className="st-status">
        <span className={'badge b-' + (L.note && L.status === 'ok' ? 'neutral' : meta.tone)}>
          {active && <Spinner />}
          {L.note && L.status === 'ok' ? L.note : meta.text}
        </span>
        {L.attempt > 1 && (
          <span className="badge b-warning" title="This station was sent back">
            <Icon n="undo" s="12" />
            {'try '}
            {L.attempt}
          </span>
        )}
      </span>
      <span className="st-facts">
        {L.facts.length ? (
          L.facts.map((f, k) => <span key={k}>{f}</span>)
        ) : (
          <span className="muted">{L.status === 'working' && stream ? 'Receiving ' + stream + ' characters' : st.makes}</span>
        )}
      </span>
      <span className="st-foot">
        {L.checks.length ? (
          <span className={cx('ck', passed === L.checks.length ? 'ok' : 'bad')}>
            <Icon n={passed === L.checks.length ? 'shield' : 'warning'} s="16" />
            {passed}
            {' of '}
            {L.checks.length}
            {' checks'}
          </span>
        ) : (
          <span className="muted">No checks yet</span>
        )}
      </span>
    </button>
  );
}
export function RunChips({ app, run }: { app: AppRecord; run: Run }) {
  return app.runs.length > 1 ? (
    <div className="chips">
      {app.runs.map((r) => (
        <Chip
          key={r.id}
          on={!!(r.id === run.id)}
          title={r.label}
          onClick={() => {
            U.runSel[app.id] = r.id;
            notify();
          }}
        >
          {RUN_KIND[r.kind] || 'Run'} {r.n}
        </Chip>
      ))}
    </div>
  ) : null;
}
/** One line over the timeline: what the run's model calls cost, or that a saved build replayed for free. */
export function RunUsage({ run }: { run: Run }) {
  const u = run.usage;
  const text =
    u && u.calls
      ? u.calls + (u.calls === 1 ? ' model call' : ' model calls') + ' · ' + usageLine(u)
      : run.mode === 'live'
        ? run.status === 'running'
          ? 'No model call has finished yet.'
          : 'No model calls.'
        : 'Replayed from a saved build: no model calls, nothing spent.';
  return (
    <p className="tl-usage muted" data-calls={u?.calls ?? 0} data-cost={(u?.costUsd ?? 0).toFixed(6)}>
      <Icon n="receipt" s="14" /> {text}
    </p>
  );
}
export function TimelineView({ app, run }: { app: AppRecord; run: Run | undefined }) {
  if (!run || !run.steps.length)
    return (
      <div className="line-wrap" data-tour="line">
        <Empty icon="timeline" title="No run yet" text="Start a build to see who worked when." />
      </div>
    );
  const t0 = run.t0,
    // eslint-disable-next-line react-hooks/purity -- a running run's bars grow to now; the store re-renders while it runs
    t1 = run.t1 || Date.now(),
    span = Math.max(1, t1 - t0),
    lanes = ['orchestrator', 'researcher', 'database', 'backend', 'views', 'ui'].concat(
      run.steps.map((s) => s.agent).filter((id, i, a) => String(id).indexOf('rv_') === 0 && AGENTS[id] && a.indexOf(id) === i),
    ),
    name = (id: string) => STATIONS.find((s) => s.id === id)?.name;
  return (
    <div className="line-wrap tl" data-tour="line">
      <RunChips app={app} run={run} />
      <RunUsage run={run} />
      {lanes.map((id) => (
        <div key={id} className="tl-row">
          <div className="tl-l">
            <AgentAv id={id} size="xs" />
            <span className="hide-sm">{AGENTS[id].name}</span>
            {run.agentUsage?.[id]?.calls ? (
              <span className="tl-cost mono" title={usageLine(run.agentUsage[id])}>
                {fmtUsd(run.agentUsage[id].costUsd)}
              </span>
            ) : null}
          </div>
          <div className="tl-track">
            {run.steps
              .filter((s) => s.agent === id)
              .map((s, i) => (
                <span
                  key={i}
                  className={cx('tl-bar', 'k-' + s.kind, s.ok === false && 'bad', 'acc-' + AGENTS[id].acc)}
                  style={{
                    left: ((s.t0 - t0) / span) * 100 + '%',
                    width: Math.max(0.8, (((s.t1 || t1) - s.t0) / span) * 100) + '%',
                  }}
                  title={name(s.station) + ' · ' + s.label + ' · ' + fmtMs((s.t1 || t1) - s.t0)}
                />
              ))}
          </div>
        </div>
      ))}
      <div className="tl-row">
        <div className="tl-l" />
        <div className="tl-axis">
          <span>0 s</span>
          <span>{fmtMs(span / 2)}</span>
          <span>{fmtMs(span)}</span>
        </div>
      </div>
      <div className="tl-legend">
        <span>
          <i className="k-model" />
          Agent output
        </span>
        <span>
          <i className="k-check" />
          Code checks
        </span>
        <span>
          <i className="k-tool" />
          Applying
        </span>
        <span>
          <i className="k-wait" />
          Waiting for you
        </span>
      </div>
    </div>
  );
}
export function LogView({ app, run }: { app: AppRecord; run: Run | undefined }) {
  if (!run)
    return (
      <div className="line-wrap" data-tour="line">
        <Empty icon="list" title="No run yet" />
      </div>
    );
  return (
    <div className="line-wrap" data-tour="line">
      <RunChips app={app} run={run} />
      <div className="tbl-wrap">
        <table className="tbl dense">
          <thead>
            <tr>
              <th>At</th>
              <th>Station</th>
              <th>Who</th>
              <th>What</th>
              <th className="num">Took</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((s, i) => (
              <tr key={i}>
                <td className="mono">+{fmtMs(s.t0 - run.t0)}</td>
                <td>{STATIONS.find((x) => x.id === s.station)?.name}</td>
                <td>
                  <span className="who">
                    <AgentAv id={s.agent} size="xs" />
                    <span>{AGENTS[s.agent].name}</span>
                  </span>
                </td>
                <td>{s.label}</td>
                <td className="num mono">{s.t1 ? fmtMs(s.t1 - s.t0) : '…'}</td>
                <td>
                  {s.t1 ? (
                    <span className={'badge b-' + (s.ok === false ? 'warning' : 'success')}>{s.ok === false ? 'Not passed' : 'OK'}</span>
                  ) : (
                    <Spinner />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function Inspector({ app, sid, bare }: { app: AppRecord; sid: string; bare?: boolean }) {
  // the Tester's station is reached only after the Backend agent wrote the workflow
  if (sid === 'qa') return <TesterPanel app={app as AppRecord & { def: BackedDef }} />;
  const rid = String(sid || '').indexOf('rv_') === 0 ? String(sid).slice(3) : null;
  if (rid && rid in REVIEWERS && flowOf(app).reviewers.includes(rid)) return <ReviewPanel app={app} id={rid} bare={bare} />;
  const st = STATIONS.find((s) => s.id === sid) || STATIONS[0],
    L = app.line[st.id],
    tab = U.itab[app.id] || 'out',
    fl = flowOf(app),
    nc =
      (fl.approve[st.id] ? 1 : 0) +
      (fl.by[st.id] === 'rules' ? 1 : 0) +
      (fl.notes[st.agent] ? 1 : 0) +
      (fl.reviewers.includes(reviewerAt(st.id) || '') ? 1 : 0);
  return (
    <section className={cx('inspector', bare && 'bare')} data-tour="inspector" aria-label={st.name + ' inspector'}>
      <div className="insp-head">
        {!bare && (
          <>
            <AgentAv id={st.agent} size="sm" />
            <strong>{st.name}</strong>
            <span className="muted t-cap hide-sm">{AGENTS[st.agent].role}</span>
          </>
        )}
        <span className="grow" />
        <Tabs
          cls="sm"
          label="Inspector"
          items={[
            {
              id: 'out',
              label: 'Output',
            },
            {
              id: 'checks',
              label: 'Checks',
              count: L.checks.length || null,
            },
            {
              id: 'tests',
              label: 'Tests',
              count: testable(app)
                ? suiteOf(app)
                    .filter((s) => s.station === st.id)
                    .reduce((n, s) => n + s.tests.length, 0) || null
                : null,
            },
            {
              id: 'tries',
              label: 'Attempts',
              count: L.attempts.length > 1 ? L.attempts.length : null,
            },
            {
              id: 'custom',
              label: 'Customize',
              icon: 'options',
              count: nc || null,
              tour: 'custom-tab',
            },
          ]}
          value={tab}
          onChange={(v) => {
            U.itab[app.id] = v;
            notify();
          }}
        />
      </div>
      <div className="insp-body">
        {tab === 'custom' ? (
          <CustomTab app={app} st={st} />
        ) : tab === 'checks' ? (
          <CheckList checks={L.checks} />
        ) : tab === 'tests' ? (
          <StationTests app={app} st={st} />
        ) : tab === 'tries' ? (
          <Attempts L={L} />
        ) : (
          <StationOut app={app} st={st} />
        )}
      </div>
    </section>
  );
}
export function Attempts({ L }: { L: StationLine }) {
  if (!L.attempts.length) return <p className="muted">Nothing has run at this station yet.</p>;
  return (
    <>
      <ol className="tries">
        {L.attempts.map((a) => (
          <li key={a.n} className={a.ok ? 'ok' : 'bad'}>
            <strong>
              {'Attempt '}
              {a.n}
              {': '}
              {a.ok ? 'passed every check' : 'sent back'}
            </strong>
            {a.issues.length > 0 && (
              <ul>
                {a.issues.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {L.fellBack && (
        <MBar tone="warning">The agent did not pass in three attempts, so the orchestrator used the safe default for this station.</MBar>
      )}
    </>
  );
}
export function AccessMatrix({ app }: { app: AppRecord }) {
  const def = app.def,
    roles = def.brief?.roles || [];
  return (
    <div className="tbl-wrap">
      <table className="tbl dense">
        <thead>
          <tr>
            <th>Table</th>
            {roles.map((r) => (
              <th key={r.id}>{r.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {def.tables.map((t) => (
            <tr key={t.name}>
              <td>
                <strong>{t.label}</strong>
              </td>
              {roles.map((r) => {
                const a = accOf(def, r.id, t.name),
                  bits = [
                    a.list !== 'none' && 'see ' + a.list,
                    a.create && 'create',
                    a.update !== 'none' && 'edit ' + a.update,
                    a.delete && 'delete',
                  ].filter((b): b is string => !!b);
                return (
                  <td key={r.id}>
                    {bits.length ? (
                      bits.map((b) => (
                        <Fragment key={b}>
                          <span className={cx('badge', /own/.test(b) ? 'b-warning' : 'b-outline')}>{b}</span>{' '}
                        </Fragment>
                      ))
                    ) : (
                      <span className="muted">No access</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function StationOut({ app, st }: { app: AppRecord; st: Station }) {
  const def = app.def,
    pending = (
      <p className="muted">
        {st.makes}
        {' will appear here when '}
        {AGENTS[st.agent].name}
        {' has finished and the checks have passed.'}
      </p>
    );
  if (st.id === 'research') {
    const b = def.brief;
    if (!b) return pending;
    return (
      <div className="out-grid">
        <div className="out-c wide">
          <p className="lead">{b.summary}</p>
          {b.decision && (
            <MBar tone="info">
              <strong>Your decision.</strong> {b.decision.text} {b.decision.answer}.
            </MBar>
          )}
        </div>
        <div className="out-c">
          <h4>Roles</h4>
          <ul className="plain">
            {b.roles.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>
                <span className="muted">
                  {' · '}
                  {r.can}
                </span>
              </li>
            ))}
          </ul>
          <h4>Records</h4>
          <ul className="plain">
            {b.entities.map((e) => (
              <li key={e.name}>
                <strong>{label(e.name)}</strong>
                <span className="muted">
                  {' · '}
                  {e.what}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="out-c">
          <h4>User stories</h4>
          <ul className="plain">
            {b.stories.map((s, i) => (
              <li key={i}>
                {'As a '}
                <strong>{roleName(def, s.role).toLowerCase()}</strong>
                {', I want to '}
                {s.want}
                {s.so ? ', so that ' + s.so : ''}.
              </li>
            ))}
          </ul>
        </div>
        <div className="out-c">
          <h4>
            {'Process on '}
            {label(b.process.entity).toLowerCase()}
          </h4>
          <div className="flow">
            {b.process.states.map((s, i) => [
              i > 0 && <Icon key={'a' + i} n="arrowRight" s="12" />,
              <span key={s} className="badge b-outline">
                {label(s)}
              </span>,
            ])}
          </div>
          <p className="muted t-cap">{b.process.note}</p>
          <h4>Rules</h4>
          <ul className="plain">
            {b.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {b.sources.length > 0 && (
            <>
              <h4>Looked up</h4>
              {b.sources.map((s, i) => (
                <p key={i} className="t-cap">
                  {s.connector}, {'"'}
                  {s.query}
                  {'": '}
                  {s.titles.join(', ')}
                  {'. '}
                  <Proto>Sample response</Proto>
                </p>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }
  if (st.id === 'database') {
    if (!def.tables.length) return pending;
    const sql = !!U.showSql[app.id],
      live = dbTables(app.id);
    return (
      <div>
        <div className="row between wrap">
          <span className="muted t-cap">
            {def.tables.length}
            {' tables, plus users and activity. Each one was created from its definition with CREATE TABLE'}
            {def.migrations.length
              ? ', then changed by ' + def.migrations.length + ' migration' + (def.migrations.length > 1 ? 's' : '')
              : ''}
            .
          </span>
          <Switch
            id={'sql-' + app.id}
            on={sql}
            onChange={(v) => {
              U.showSql[app.id] = v;
              notify();
            }}
            text="Show SQL"
          />
        </div>
        <div className="tables">
          {def.tables.map((t) => (
            <Card key={t.name} className="card flat tcard">
              <div className="row between">
                <strong>{t.label}</strong>
                <span className="t-cap muted mono">
                  {t.name}
                  {' · '}
                  {dbCount(app.id, t.name)}
                  {' rows'}
                </span>
              </div>
              {sql ? (
                <pre className="code">{(live.find((x) => x.name === t.name) || {}).sql || createTableSQL(t)}</pre>
              ) : (
                <table className="tbl dense">
                  <tbody>
                    {t.columns.map((c) => (
                      <tr key={c.name}>
                        <td className="mono">{c.name}</td>
                        <td>
                          {TYPE_LABEL[c.type]}
                          {c.type === 'ref' ? ' → ' + c.ref : c.type === 'user' ? ' → users' + (c.role ? ' (' + c.role + ')' : '') : ''}
                        </td>
                        <td className="muted t-cap">
                          {[
                            c.required && 'required',
                            t.title === c.name && 'title',
                            t.owner === c.name && 'owner',
                            c.type === 'select' && (c.options || []).length + ' options',
                            (c.run || 0) > 1 && 'added by change ' + c.run,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ))}
        </div>
        {def.migrations.length > 0 && (
          <>
            <h4>Migrations</h4>
            <ul className="plain">
              {def.migrations.map((m) => (
                <li key={m.n}>
                  <code>{m.sql.replace(/\s+/g, ' ')}</code>
                  <span className="muted t-cap">
                    {' · '}
                    {ago(m.at)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }
  if (st.id === 'backend') {
    const P = def.process;
    if (!P) return pending;
    const sc = colOf(tableOf(def, P.table), P.column),
      pill = (s: string) => (
        <span className={'badge b-' + stateTone(def, tableOf(def, P.table), sc, s)}>{stateLabel(def, tableOf(def, P.table), sc, s)}</span>
      );
    return (
      <div className="out-grid">
        <div className="out-c wide">
          <h4>
            {'Workflow on '}
            {P.table}.{P.column}
          </h4>
          <div className="tbl-wrap">
            <table className="tbl dense">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Who may do it</th>
                </tr>
              </thead>
              <tbody>
                {P.transitions.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.label}</strong>
                    </td>
                    <td>
                      {x.from.map((f) => (
                        <Fragment key={f}>{pill(f)} </Fragment>
                      ))}
                    </td>
                    <td>{pill(x.to)}</td>
                    <td>{x.roles.map((r) => roleName(def, r)).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="out-c wide">
          <h4>Access rules</h4>
          <AccessMatrix app={app} />
          <p className="muted t-cap">
            {'"own" means only rows whose owner is the signed-in user. '}
            {/* a workflow is written only after the brief, so the definition has one here */}
            {deriveEndpoints(def as BriefedDef).length}
            {' endpoints are derived from these rules; the API view lists and tests them.'}
          </p>
        </div>
        {def.team && (
          <div className="out-c wide">
            <h4>
              {"The app's own agents: "}
              {def.team.title}
            </h4>
            <p className="muted t-cap">
              {def.team.about}
              {' A run opens with "'}
              {P.transitions.find((x) => x.id === def.team?.start)?.label}
              {'" and closes with "'}
              {P.transitions.find((x) => x.id === def.team?.done)?.label}
              {'". The agents'} write through the endpoints above, as the person who started the run.
            </p>
            <div className="tbl-wrap">
              <table className="tbl dense">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Job</th>
                    <th>Writes</th>
                    <th>Connections</th>
                  </tr>
                </thead>
                <tbody>
                  {def.team.agents.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className="who">
                          <TeamAv a={a} size="xs" />
                          <strong>{a.name}</strong>
                        </span>
                      </td>
                      <td>{a.job}</td>
                      <td className="t-cap">
                        {[a.writes && 'adds ' + a.writes, a.updates && 'edits ' + a.updates, a.sets.length && 'fills ' + a.sets.join(', ')]
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                      <td className="t-cap">
                        {a.tools.length ? a.tools.map((x) => x.connector + ' · ' + x.tool).join(', ') : <span className="muted">None</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {def.team.pause && (
              <p className="muted t-cap">
                {'Human in the loop: the run pauses before '}
                {def.team.agents.find((a) => a.id === def.team?.pause?.before)?.name}
                {' so a person can add a point.'}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
  if (st.id === 'views') {
    if (!def.dash || !Object.keys(def.views || {}).length) return pending;
    const KIND: Record<string, string> = {
      kpi: 'Number',
      bar: 'Bars',
      stack: 'Stacked bars',
      line: 'Line over time',
      recent: 'Latest records',
    };
    return (
      <div className="out-grid">
        <div className="out-c wide">
          <p className="muted t-cap">
            The View advisor reads the columns of each table and recommends the views they can carry. Code checks every recommendation
            against the rule for that view, then mounts each one with the real rows.
          </p>
          <div className="tbl-wrap">
            <table className="tbl dense viewplan">
              <thead>
                <tr>
                  <th>Table</th>
                  {DATA_VIEWS.map((v) => (
                    <th key={v} title={VIEW_WHAT[v]}>
                      {VIEW_LABEL[v]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {def.tables.map((t) => (
                  <tr key={t.name}>
                    <td>
                      <strong>{t.label}</strong>
                    </td>
                    {DATA_VIEWS.map((v) => {
                      const rec = viewsOf(def, t).find((x) => x.type === v),
                        why = viewFit(def, t, v);
                      return (
                        <td key={v} title={rec ? rec.why : why ? 'Does not fit: it ' + why : 'Fits, but was not recommended'}>
                          {rec ? (
                            <span className="badge b-success">
                              <Icon n="check" s="12" />
                              Yes
                            </span>
                          ) : why ? (
                            <span className="muted">No</span>
                          ) : (
                            <span className="badge b-outline">Fits</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="out-c">
          <h4>Why these views</h4>
          {def.tables.map((t) => (
            <div key={t.name}>
              <p className="t-strong">{t.label}</p>
              <ul className="plain">
                {viewsOf(def, t).map((v) => (
                  <li key={v.type}>
                    <span className="badge b-outline">
                      <Icon n={VIEW_ICON[v.type]} s="12" />
                      {VIEW_LABEL[v.type]}
                    </span>{' '}
                    <span className="muted">{v.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="out-c">
          <h4>
            {'Dashboard: '}
            {def.dash.title}
          </h4>
          <ul className="plain">
            {def.dash.widgets.map((w, i) => (
              <li key={i}>
                <span className="badge b-outline">{KIND[w.kind]}</span> {w.label}
                <span className="muted t-cap">
                  {' · '}
                  {w.table}
                  {w.x ? ' by ' + w.x : ''}
                  {w.split ? ', split by ' + w.split : ''}
                  {w.measure && w.measure !== 'count' ? ', ' + w.measure.replace(':', ' of ') : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted t-cap">
            {def.dash.date ? 'The date filter uses ' + def.dash.date.table + '.' + def.dash.date.column + '.' : 'No date filter.'}
            {' Every role gets this dashboard, counted from the rows that role may see.'}
          </p>
        </div>
      </div>
    );
  }
  if (st.id === 'screens') {
    if (!def.screens.length) return pending;
    return (
      <div>
        <p className="muted t-cap">
          {touchText(touchOf(app, 'theme'), 'Made by the UI agent').replace(/^Made by/, 'Layout chosen by') + ': '}
          <span className={'swatch acc-' + def.theme.accent} />
          {label(def.theme.accent)}
          {' accent, '}
          {def.theme.nav === 'rail' ? 'icon rail' : def.theme.nav + ' navigation'}
          {def.theme.density === 'compact' ? ', compact rows' : ''}. Each page opens one table in a default view, and people can switch to
          any other view the advisor recommended for that table.
        </p>
        <div className="screens">
          {def.screens.map((s) => (
            <Card key={s.id} className="card flat scard">
              <span className="scard-ic">
                <Icon n={VIEW_ICON[s.type]} />
              </span>
              <div className="col gap4 grow">
                <strong>{s.name}</strong>
                <span className="t-cap muted">
                  {VIEW_LABEL[s.type]}
                  {' on '}
                  {s.table}
                  {s.group ? ', grouped by ' + s.group : ''}
                  {s.date ? ', dated by ' + s.date : ''}
                  {s.range ? ', ' + s.range + ' only' : ''}
                </span>
                {touchOf(app, 'screen:' + s.id) && (
                  <span className="t-cap muted touch-note">{touchText(touchOf(app, 'screen:' + s.id))}</span>
                )}
                <span className="row wrap gap4">
                  {s.roles.map((r) => (
                    <span key={r} className="badge b-outline">
                      {roleName(def, r)}
                    </span>
                  ))}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  if (!def.tour.length) return pending;
  const res = app.line.walkthrough.results || [];
  return (
    <div>
      <div className="row between wrap">
        <span className="muted t-cap">
          The UI agent wrote these steps from the user stories. Code plays them against the real endpoints inside a savepoint, then rolls
          back.
        </span>
        <Btn className="btn sm" onClick={() => startWalk(app)}>
          <Icon n="playOutline" s="16" />
          Play it in the app
        </Btn>
      </div>
      <ol className="tour-list">
        {def.tour.map((s, i) => {
          const r = res[i];
          return (
            <li key={i} className={r ? (r.ok ? 'ok' : 'bad') : ''}>
              <Icon n={r ? (r.ok ? 'checkCircle' : 'errorCircle') : 'circle'} />
              <div>
                <div>{s.say}</div>
                <div className="t-cap muted mono">
                  {roleName(def, s.role)}
                  {' · '}
                  {s.do}
                  {s.transition ? ' ' + s.transition : ''}
                  {s.action ? ' ' + s.action : ''}
                  {s.table ? ' · ' + s.table : ''}
                  {r ? ' · ' + r.detail : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
