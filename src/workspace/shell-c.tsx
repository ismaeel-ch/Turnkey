import { AreaBoundary } from '@/platform/area-boundary';
import { engineProblem, storageProblem } from './errors';
import { modelHost } from '@/platform/model-client';
import { type ReactNode, Suspense, lazy, useState, useLayoutEffect, useSyncExternalStore } from 'react';
import { canPromptInstall, installHint, onInstallPrompt, promptInstall } from '@/platform/pwa/prompt';
import type { BackedDef } from '@/shared/types/app';
import type { SqlValue } from '@/shared/types/sqljs';
import type { AppRecord, Dict, Downloader, OnboardingForm, ProductTourStep, Settings, SignInForm } from '@/shared/types/workspace';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { toStyle } from '@/platform/dom';
import {
  APILOG,
  BRAND,
  CAP,
  EV,
  LS,
  MODELCALLS,
  NARROW,
  PHONE,
  S,
  SQLLOG,
  TOOLCALLS,
  U,
  activeTab,
  applyTheme,
  closeDialog,
  commit,
  copyText,
  createAccount,
  cx,
  fmtBytes,
  freshState,
  freshView,
  loadState,
  me,
  modeNow,
  myApps,
  netChanged,
  checkReach,
  netInfo,
  notify,
  online,
  openDialog,
  saveFile,
  saveNow,
  saveTimer,
  setChat,
  setLive,
  setOffline,
  signIn,
  snake,
  str,
  tabsNow,
  toast,
  uid,
  useStore,
  setNetWas,
  setS,
  setSaveTimer,
  setU,
} from './core';
import { DBX, PEEK, backupWorkspace, dbCount, dbExists, dbFlush, dbSave, initSqlite, restoreWorkspace, sqlRun } from './db';
import { appUsers, reseed } from './engine';
import { DATA_VIEWS, migrateApp } from './viewspec';
import { REC, TEMPLATES } from './builds';
import { QUESTS } from './quests';
import { TEAMS } from './team';
import { TESTS, runTestsSync, suiteOf } from './tests';
import { FLOW, isDark } from './flow';
import { LIVE, RUNS, STATIONS, deleteApp, pushChat, resumeInterrupted, runBuild, startBuild, stopRun } from './line';
import { buildPack, parseChange, planOps, runChange } from './changes';
import { AddStepDialog, REVIEW_RULES, WorkflowDialog, flowApply, flowEdit, parseFlow, reviewNow, tryFix } from './custom';
import { REVIEWERS } from './reviewers';
import { keepFix, suggestCases } from './tester';
import { AgentAv, Btn, Dialog, Field, Icon, Input, Logo, MBar, Seg, Select, Spinner, Switch, TONE_ICON } from './ui';
import { PhoneSheets } from './mobile';
import { AgentActivity, activityNow } from './activity';
import { APICACHE, stageOf } from './runtime';
import {
  AboutAppDialog,
  OpenLinkDialog,
  ShareDialog,
  SoloShell,
  enterSolo,
  exitSolo,
  openShared,
  packOf,
  linkCode,
  shareLink,
  squeeze,
  unsqueeze,
  framed,
} from './share';
import { InstallAppDialog, isDirty, logoOf, relOf, releaseApp } from './release';
import { GUIDE, GuideDialog } from './guide';
import { Home, Titlebar, Workspace, lineApp } from './shell-a';
import { DebugDrawer } from './shell-b';
import { installShortcuts, setSingleKeys } from './commands';

// The command palette and the shortcuts dialog load the first time one opens (Ctrl/Cmd+K or "?").
const PaletteDialog = lazy(() => import('./palette').then((m) => ({ default: m.PaletteDialog })));
const ShortcutsDialog = lazy(() => import('./palette').then((m) => ({ default: m.ShortcutsDialog })));

/* ===== Turnkey prototype · shell: first-run onboarding, sign-in, dialogs, guided tour, boot ===== */
/* The forms below keep their state in the view store (U), so it outlives a re-render. Components read it through a
   getter and change it only through these actions, never by writing to the store while rendering. */
const OB_START: OnboardingForm = { step: 0, name: '', user: '', pass: '', demo: true, dev: false, pick: 'clinic', tour: true, err: '' };
const obForm = (): OnboardingForm => U.ob || OB_START;
function setOb(patch: Partial<OnboardingForm> | null) {
  U.ob = patch ? { ...obForm(), ...patch } : null;
  notify();
}
const SI_START: SignInForm = { u: '', p: '', name: '', err: '', create: false };
const siForm = (): SignInForm => U.si || SI_START;
function setSi(patch: Partial<SignInForm> | null) {
  U.si = patch ? { ...siForm(), ...patch } : null;
  notify();
}
/** Create the account from the onboarding form, apply its choices, and start the first build and the tour. */
function finishOnboarding(o: OnboardingForm) {
  const a = createAccount(o.name || 'Demo user', o.user || 'demo', o.pass || 'demo');
  S.session = a.id;
  S.onboarded = true;
  S.settings.demo = o.demo;
  S.settings.debug = o.dev;
  commit();
  const pick = o.pick,
    tour = o.tour;
  setOb(null);
  if (pick)
    startBuild({
      request: REC[pick].sentence,
      tpl: pick,
    });
  if (tour) setTimeout(startTour, 900);
  notify();
}
export function Onboarding() {
  const o = obForm(),
    steps = ['Welcome', 'Your account', 'How to run', 'First app', 'Ready'],
    liveOK = online();
  const next = () => {
    if (o.step === 1) {
      const u = snake(o.user);
      if (!str(o.name) || !u) {
        setOb({ err: 'Enter a name and a username, or skip to use the demo account.' });
        return;
      }
      if (str(o.pass).length < 4) {
        setOb({ err: 'Use at least 4 characters for the password.' });
        return;
      }
      setOb({ user: u });
    }
    setOb({ err: '', step: Math.min(steps.length - 1, o.step + 1) });
  };
  const finish = () => finishOnboarding(o);
  const body = [
    () => (
      <>
        <h1 className="t-title1">Say what the work is. Get the whole app, ready to use.</h1>
        <p className="lead">
          {'A turnkey job is one that is handed over finished: you turn the key and it works. '}
          {BRAND.name}
          {
            ' turns one sentence into a complete, working app for any domain: SQLite tables, role-guarded endpoints, switchable views, a dashboard and a guided tour. You watch five builder agents and a Tester make it, and code checks every handoff.'
          }
        </p>
        <div className="ob-line" aria-hidden="true">
          {STATIONS.map((s, i) => (
            <span key={s.id} className="ob-pair">
              {i > 0 && <Icon n="arrowRight" s="16" />}
              <span className="ob-st">
                <AgentAv id={s.agent} size="sm" />
                {s.name}
              </span>
            </span>
          ))}
        </div>
        <ul className="plain ticks">
          <li>
            <Icon n="eye" s="16" />
            <span>
              <strong>Built in front of you.</strong>
              {' Every agent step, tool call and check is visible.'}
            </span>
          </li>
          <li>
            <Icon n="shield" s="16" />
            <span>
              <strong>Checked at every handoff.</strong>
              {' Agents write definitions. Code tests them and sends failures back.'}
            </span>
          </li>
          <li>
            <Icon n="storage" s="16" />
            <span>
              <strong>Yours, in this browser.</strong>
              {' Apps and data stay here, work offline, and are still here when you sign in again.'}
            </span>
          </li>
        </ul>
      </>
    ),
    () => (
      <>
        <h1 className="t-title2">Create your account</h1>
        <p className="muted">
          It keeps your workspaces apart from anyone else who uses this browser. Sign-in is demo-grade: use a made-up password.
        </p>
        <div className="form-grid one">
          <Field id="ob-name" label="Your name">
            <Input
              native
              className="input"
              id="ob-name"
              data-autofocus
              autoComplete="off"
              value={o.name}
              onInput={(e) => {
                setOb({ name: e.currentTarget.value });
              }}
            />
          </Field>
          <Field id="ob-user" label="Username">
            <Input
              native
              className="input"
              id="ob-user"
              autoComplete="off"
              value={o.user}
              onInput={(e) => {
                setOb({ user: e.currentTarget.value });
              }}
            />
          </Field>
          <Field id="ob-pass" label="Password" hint="At least 4 characters. Stored in this browser only, hashed.">
            <Input
              native
              className="input"
              id="ob-pass"
              type="password"
              autoComplete="off"
              value={o.pass}
              onInput={(e) => {
                setOb({ pass: e.currentTarget.value });
              }}
            />
          </Field>
        </div>
        {o.err && <MBar tone="warning">{o.err}</MBar>}
        <Btn
          className="btn subtle"
          onClick={() => {
            setOb({ name: 'Demo user', user: 'demo', pass: 'demo', err: '', step: 2 });
          }}
        >
          Skip and use the demo account (demo / demo)
        </Btn>
      </>
    ),
    () => (
      <>
        <h1 className="t-title2">How should the agents run?</h1>
        <p className="muted">You can switch at any time from the title bar.</p>
        <div className="choices">
          <button
            className={cx('choice', o.demo && 'on')}
            aria-pressed={o.demo}
            onClick={() => {
              setOb({ demo: true });
            }}
          >
            <span className="row">
              <Icon n="playOutline" />
              <strong>Demo</strong>
              <span className="badge b-info">Good first look</span>
            </span>
            <span className="muted">
              Replays saved builds through the real checks and the real database, with made-up data that looks like the real thing. No model
              calls, works offline.
            </span>
          </button>
          <button
            className={cx('choice', !o.demo && 'on')}
            aria-pressed={!o.demo}
            disabled={!liveOK}
            onClick={() => {
              setOb({ demo: false });
            }}
          >
            <span className="row">
              <Icon n="sparkle" />
              <strong>Live</strong>
              {!liveOK ? (
                <span className="badge b-warning">Needs internet</span>
              ) : U.live === 'ready' ? (
                <span className="badge b-success">Model connected</span>
              ) : U.live === 'unknown' ? (
                <span className="badge b-info">Checking the model</span>
              ) : (
                <span className="badge b-warning">No model connected</span>
              )}
            </span>
            <span className="muted">
              {'Sends your own sentence to the model. Each agent makes its own call, capped at '}
              {CAP}
              {' calls a session. Live follows your internet connection: it pauses when you go offline and comes back when you reconnect.'}
            </span>
          </button>
        </div>
        <Switch
          id="ob-dev"
          on={o.dev}
          onChange={(v) => {
            setOb({ dev: v });
          }}
          text="Show developer tools (debug mode): AG-UI events, tool calls, model usage, SQL"
        />
      </>
    ),
    () => (
      <>
        <h1 className="t-title2">Pick a first app</h1>
        <p className="muted">Each is one sentence. The agents build it while you take the tour.</p>
        <div className="choices three">
          {TEMPLATES.concat(QUESTS).map((id) => {
            const r = REC[id];
            return (
              <button
                key={id}
                className={cx('choice', o.pick === id && 'on')}
                aria-pressed={o.pick === id}
                onClick={() => {
                  setOb({ pick: id });
                }}
              >
                <span className="row">
                  <span className={'tpl-ic sm acc-' + r.accent}>
                    <Icon n={r.icon} />
                  </span>
                  {r.quest && (
                    <span className="badge b-outline">
                      {'Quest '}
                      {r.quest}
                    </span>
                  )}
                </span>
                <strong>{r.title}</strong>
                <span className="muted t-cap">{r.blurb}</span>
              </button>
            );
          })}
        </div>
        <Btn
          className={cx('btn subtle', !o.pick && 'on')}
          onClick={() => {
            setOb({ pick: '' });
          }}
        >
          Start with an empty workspace instead
        </Btn>
      </>
    ),
    () => (
      <>
        <h1 className="t-title2">
          {'You are set, '}
          {(o.name || 'Demo user').split(' ')[0]}
        </h1>
        <ul className="plain ticks">
          <li>
            <Icon n="person" s="16" />
            <span>
              {'Account '}
              <strong>{o.user || 'demo'}</strong>, kept in this browser
            </span>
          </li>
          <li>
            <Icon n={o.demo ? 'playOutline' : 'sparkle'} s="16" />
            <span>{o.demo ? 'Demo: saved builds, no model calls' : 'Live: your sentence goes to the model, while you are connected'}</span>
          </li>
          <li>
            <Icon n="production" s="16" />
            <span>{o.pick ? 'First app: ' + REC[o.pick].title + ', built as soon as you continue' : 'An empty workspace'}</span>
          </li>
        </ul>
        <Switch
          id="ob-tour"
          on={o.tour}
          onChange={(v) => {
            setOb({ tour: v });
          }}
          text="Show me around with a short guided tour"
        />
        <p className="muted t-cap">
          {'Tip: install '}
          {BRAND.name}
          {' as a desktop app from the title bar. Built apps and their data keep working offline.'}
        </p>
      </>
    ),
  ];
  return (
    <div className="ob">
      <div className="ob-card">
        <aside className="ob-rail">
          <div className="row">
            <Logo size={28} />
            <strong className="t-sub1">{BRAND.name}</strong>
          </div>
          <ol className="ob-steps">
            {steps.map((s, i) => (
              <li key={s} className={cx(i === o.step && 'cur', i < o.step && 'done')} aria-current={i === o.step ? 'step' : undefined}>
                <span className="ob-n">{i < o.step ? <Icon n="check" s="12" /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <p className="t-cap muted">An entry for the SSI Agent-A-Thon 2026. People and records in it are made up.</p>
        </aside>
        <main className="ob-main">
          <div className="ob-body" key={o.step}>
            {body[o.step]()}
          </div>
          <div className="ob-foot">
            {o.step > 0 && (
              <Btn
                className="btn"
                onClick={() => {
                  setOb({ step: o.step - 1, err: '' });
                }}
              >
                Back
              </Btn>
            )}
            <span className="grow" />
            {o.step < steps.length - 1 ? (
              <Btn className="btn primary" onClick={next}>
                {o.step === 0 ? 'Get started' : 'Continue'}
              </Btn>
            ) : (
              <Btn className="btn primary" onClick={finish}>
                Open my workspace
              </Btn>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
export function SignIn() {
  const f = siForm(),
    apps = Object.keys(S.apps).length,
    bytes = LS.keys().reduce((n, k) => n + LS.size(k), 0);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (f.create) {
      const u = snake(f.u);
      if (!str(f.name) || !u || str(f.p).length < 4) {
        setSi({ err: 'Enter a name, a username and a password of at least 4 characters.' });
        return;
      }
      if (S.accounts.some((a) => a.username === u)) {
        setSi({ err: 'That username is taken in this browser.' });
        return;
      }
      const a = createAccount(f.name, u, f.p);
      S.session = a.id;
      setSi(null);
      commit();
      return;
    }
    if (signIn(f.u, f.p)) {
      setSi(null);
    } else {
      setSi({ err: 'Wrong username or password.' });
    }
  };
  return (
    <div className="ob">
      <form className="signin" onSubmit={submit}>
        <div className="row">
          <Logo size={28} />
          <strong className="t-sub1">{BRAND.name}</strong>
        </div>
        <h1 className="t-title3">{f.create ? 'Create another account' : 'Welcome back'}</h1>
        {!f.create && (
          <MBar tone="success">
            {'Your work is still here: '}
            {apps}
            {' app'}
            {apps === 1 ? '' : 's'}
            {' and '}
            {fmtBytes(bytes)}
            {' of data saved in this browser.'}
          </MBar>
        )}
        {f.create && (
          <Field id="si-name" label="Your name">
            <Input
              native
              className="input"
              id="si-name"
              autoComplete="off"
              value={f.name}
              onInput={(e) => {
                setSi({ name: e.currentTarget.value });
              }}
            />
          </Field>
        )}
        <Field
          id="si-user"
          label="Username"
          hint={!f.create && S.accounts.length ? 'Accounts in this browser: ' + S.accounts.map((a) => a.username).join(', ') : ''}
        >
          <Input
            native
            className="input"
            id="si-user"
            data-autofocus
            autoComplete="off"
            value={f.u}
            onInput={(e) => {
              setSi({ u: e.currentTarget.value });
            }}
          />
        </Field>
        <Field id="si-pass" label="Password">
          <Input
            native
            className="input"
            id="si-pass"
            type="password"
            autoComplete="off"
            value={f.p}
            onInput={(e) => {
              setSi({ p: e.currentTarget.value });
            }}
          />
        </Field>
        {f.err && <MBar tone="danger">{f.err}</MBar>}
        <Btn className="btn primary lg" type="submit">
          {f.create ? 'Create account' : 'Sign in'}
        </Btn>
        <div className="row between">
          <Btn
            type="button"
            className="btn subtle sm"
            onClick={() => {
              setSi({ create: !f.create, err: '' });
            }}
          >
            {f.create ? 'Back to sign in' : 'Create another account'}
          </Btn>
          <Btn
            type="button"
            className="btn subtle sm"
            onClick={() =>
              openDialog('reset', {
                out: true,
              })
            }
          >
            Erase everything
          </Btn>
        </div>
      </form>
    </div>
  );
}

/* ---------- dialogs ---------- */
export function resetEverything() {
  Object.values(S.apps).forEach(stopRun);
  Object.keys(DBX.open).forEach((id) => {
    try {
      DBX.open[id].close();
    } catch {}
  });
  Object.keys(DBX.timers).forEach((id) => clearTimeout(DBX.timers[id] ?? undefined));
  DBX.open = {};
  DBX.size = {};
  DBX.savedAt = {};
  DBX.timers = {};
  DBX.hold = {};
  LS.keys().forEach((k) => LS.del(k));
  if (saveTimer) clearTimeout(saveTimer);
  setSaveTimer(null);
  const live = U.live,
    dl = U.dl;
  setS(freshState());
  setU(freshView());
  U.boot = 'ready';
  U.live = live;
  U.dl = dl;
  EV.length = 0;
  TOOLCALLS.length = 0;
  MODELCALLS.length = 0;
  SQLLOG.length = 0;
  APILOG.length = 0;
  APICACHE.clear();
  PEEK.clear();
  applyTheme();
  notify();
}
export function SetRow({ title, text, children }: { title: ReactNode; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="col gap0 grow">
        <strong>{title}</strong>
        <span className="muted t-cap">{text}</span>
      </div>
      {children}
    </div>
  );
}
/** Change one setting and save. */
function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  S.settings[k] = v;
  if (k === 'theme') applyTheme();
  commit();
}
/** Change fields of the open dialog's props (its form), keeping the rest. */
function patchDialog(patch: Dict<unknown>) {
  if (U.dialog) U.dialog = { ...U.dialog, props: { ...U.dialog.props, ...patch } };
  notify();
}
export function SettingsDialog() {
  const s = S.settings,
    set = setSetting,
    mode = modeNow(),
    on = online(),
    net = netInfo();
  return (
    <Dialog
      title="Settings"
      onClose={closeDialog}
      foot={
        <Btn className="btn primary" onClick={closeDialog}>
          Done
        </Btn>
      }
    >
      <div className="set-list">
        <SetRow title="Theme" text="Follows your system unless you choose.">
          <Seg
            label="Theme"
            items={[
              {
                id: 'system',
                label: 'System',
              },
              {
                id: 'light',
                label: 'Light',
              },
              {
                id: 'dark',
                label: 'Dark',
              },
            ]}
            value={s.theme}
            onChange={(v) => set('theme', v as Settings['theme'])}
          />
        </SetRow>
        <SetRow
          title="Live"
          text={
            !on
              ? 'Paused: you are offline. It comes back by itself when the connection does.'
              : mode.on
                ? 'On: you are connected, so your own sentence goes to the model. Switch off for Demo.'
                : 'Off: Demo is on. Saved builds and made-up data, no model calls.'
          }
        >
          <Switch id="set-live" label="Live" on={mode.on} disabled={!on} onChange={setLive} />
        </SetRow>
        <SetRow title="Replay speed" text="How fast saved builds and changes play.">
          <Seg
            label="Replay speed"
            items={[
              {
                id: 'normal',
                label: 'Normal',
              },
              {
                id: 'fast',
                label: 'Fast',
              },
              {
                id: 'instant',
                label: 'Instant',
              },
            ]}
            value={s.speed}
            onChange={(v) => set('speed', v)}
          />
        </SetRow>
        <SetRow title="Live model" text="Balanced passes the checks more often. Fast answers sooner.">
          <Seg
            label="Live model"
            items={[
              {
                id: 'default',
                label: 'Balanced',
              },
              {
                id: 'quick',
                label: 'Fast',
              },
            ]}
            value={s.tier}
            onChange={(v) => set('tier', v)}
          />
        </SetRow>
        <SetRow title="Debug mode" text="AG-UI events, tool calls, model usage, SQL, API calls, state, storage.">
          <Switch id="set-debug" label="Debug mode" on={s.debug} onChange={(v) => set('debug', v)} />
        </SetRow>
        <SetRow title="Simulate offline" text="Pretend the connection is gone, to see Live pause and what keeps working.">
          <Switch id="set-off" label="Simulate offline" on={s.offline} onChange={setOffline} />
        </SetRow>
        <SetRow
          title="Single-key shortcuts"
          text="Letters such as G then B, and ? for the list. Ctrl or Cmd with K always opens the commands."
        >
          <Switch id="set-keys" label="Single-key shortcuts" on={s.keys !== false} onChange={setSingleKeys} />
        </SetRow>
        <SetRow title="Agents panel" text="Show the chat beside the canvas.">
          <Switch id="set-chat" label="Agents panel" on={s.chat} onChange={(v) => set('chat', v)} />
        </SetRow>
      </div>
      <p className="muted t-cap" id="set-net">
        {'Connection: '}
        {on ? 'online' + (net ? ' (' + net + ')' : '') : s.offline ? 'offline (simulated)' : 'offline'}
        {'. Live follows it, wherever this page runs. Model: '}
        {U.live === 'ready'
          ? 'connected through this page, ' + U.calls + ' of ' + CAP + ' calls used this session.'
          : U.live === 'unknown'
            ? 'connecting.'
            : 'none connected to this copy, so saved builds and built-in changes stand in.'}
        {' Live reaches the model through Turnkey’s own server route, so it needs the connection and nothing else.'}
      </p>
    </Dialog>
  );
}
export function InstallDialog() {
  const s = S.settings;
  const offered = useSyncExternalStore(onInstallPrompt, canPromptInstall, noInstallOffer);
  const [asked, setAsked] = useState(false);
  const inFrame = framed(),
    real = offered && !inFrame; // the browser made an offer for Turnkey's manifest: its own Install dialog does the work
  const mark = (v: boolean) => {
    s.installed = v;
    commit();
    closeDialog();
    toast(
      v ? 'Installed. It opens in its own window and starts without internet.' : 'Removed. Your apps and data are untouched.',
      v ? 'success' : 'info',
    );
  };
  const install = async () => {
    setAsked(true);
    const out = await promptInstall();
    if (out === 'accepted') mark(true);
    else if (out === 'dismissed') closeDialog();
  };
  return (
    <Dialog
      title={s.installed ? BRAND.name + ' is installed' : 'Install ' + BRAND.name}
      onClose={closeDialog}
      foot={
        s.installed ? (
          <>
            <Btn className="btn" onClick={() => mark(false)}>
              Uninstall
            </Btn>
            <Btn className="btn primary" onClick={closeDialog}>
              Done
            </Btn>
          </>
        ) : (
          <>
            <Btn className="btn" onClick={closeDialog}>
              Not now
            </Btn>
            {real ? (
              <Btn className="btn primary" data-autofocus data-install="browser" onClick={install}>
                Install
              </Btn>
            ) : (
              <Btn className="btn primary" data-autofocus data-install="menu" onClick={() => mark(true)}>
                {inFrame ? 'Install' : 'I have installed it'}
              </Btn>
            )}
          </>
        )
      }
    >
      <div className="col gap12">
        <div className="install-app">
          <Logo size={40} />
          <div className="col gap0">
            <strong className="t-sub2">{BRAND.name}</strong>
            <span className="muted t-cap">Progressive web app</span>
          </div>
        </div>
        <ul className="plain ticks">
          <li>
            <Icon n="window" s="16" />
            <span>Opens in its own window from the desktop, taskbar or dock</span>
          </li>
          <li>
            <Icon n="checkCircle" s="16" />
            <span>
              <strong>Works offline:</strong>
              {' the shell, your built apps and their SQLite data, tours, saved builds, export and reset'}
            </span>
          </li>
          <li>
            <Icon n="cloudOff" s="16" />
            <span>
              <strong>Waits for internet:</strong>
              {' Live builds, changes through the model, and connections to third parties'}
            </span>
          </li>
        </ul>
        {s.installed ? null : inFrame ? (
          <MBar tone="info">
            {'This page is shown inside a frame, which cannot install anything. Open ' +
              BRAND.name +
              ' in its own browser tab to install it.'}
          </MBar>
        ) : real ? (
          <MBar tone="info">Your browser asks you to confirm.</MBar>
        ) : (
          <MBar tone="info">
            {asked ? 'The browser did not open its install dialog. ' : 'Your browser installs ' + BRAND.name + ' from its own menu. '}
            {installHint(navigator.userAgent)}
          </MBar>
        )}
      </div>
    </Dialog>
  );
}
const noInstallOffer = () => false;
export function ResetDialog() {
  const apps = S.session ? myApps() : [],
    out = !S.session;
  const act = (kind: string) => {
    if (kind === 'data') {
      let n = 0;
      apps.forEach((a) => {
        if (a.status === 'ready' && !RUNS[a.id] && dbExists(a.id)) {
          reseed(a);
          n++;
        }
      });
      commit();
      closeDialog();
      return toast('Seed data restored in ' + n + ' app' + (n === 1 ? '' : 's') + '.', 'success');
    }
    if (kind === 'apps') {
      apps.forEach(deleteApp);
      closeDialog();
      return toast('All your apps are deleted. Your account is still here.', 'success');
    }
    resetEverything();
  };
  return (
    <Dialog title="Reset data" onClose={closeDialog}>
      <p className="muted">
        {'Everything '}
        {BRAND.name}
        {' keeps is stored in this browser. Choose how far to go.'}
      </p>
      <div className="set-list">
        <SetRow title="Back up workspace" text="Saves every account, app, database and setting as one JSON file you can restore later.">
          <Btn className="btn" onClick={backupWorkspace}>
            Back up
          </Btn>
        </SetRow>
        <SetRow title="Restore a backup" text="Replaces everything in this browser with a backup file, then reloads.">
          <Btn className="btn" onClick={restoreWorkspace}>
            Restore
          </Btn>
        </SetRow>
        {!out && (
          <SetRow
            title="Restore seed data"
            text={
              'Empties the tables of your ' +
              apps.length +
              ' app' +
              (apps.length === 1 ? '' : 's') +
              ' and puts the original rows back. Tables, screens and your changes stay.'
            }
          >
            <Btn className="btn" disabled={!apps.length} onClick={() => act('data')}>
              Restore
            </Btn>
          </SetRow>
        )}
        {!out && (
          <SetRow title="Delete all my apps" text="Removes every app with its database and chat. Your account and settings stay.">
            <Btn className="btn" disabled={!apps.length} onClick={() => act('apps')}>
              Delete apps
            </Btn>
          </SetRow>
        )}
        <SetRow
          title="Erase everything"
          text="Removes all accounts, apps, databases and settings from this browser and starts again at the welcome screen."
        >
          <Btn className="btn danger" onClick={() => act('all')}>
            Erase
          </Btn>
        </SetRow>
      </div>
    </Dialog>
  );
}
/** An app picked by id, for the dialogs that work on one app. */
export type AppPick = { app: string };
/** The app's definition is complete once it can be packed, renamed or changed: these dialogs open on ready apps. */
const backed = (app: AppRecord) => app as AppRecord & { def: BackedDef };
export function PackDialog({ p }: { p: AppPick }) {
  const app = S.apps[p.app];
  if (!app) return null;
  const md = buildPack(backed(app));
  return (
    <Dialog
      wide
      title={'Build pack · ' + app.name}
      onClose={closeDialog}
      foot={
        <>
          {U.dl && (
            <Btn className="btn" onClick={() => saveFile(snake(app.name) + '-build-pack.md', md, 'text/markdown')}>
              <Icon n="download" s="16" />
              Download .md
            </Btn>
          )}
          <Btn className="btn primary" onClick={() => copyText(md, 'Build pack')}>
            <Icon n="copy" s="16" />
            Copy
          </Btn>
        </>
      }
    >
      <p className="muted t-cap">
        One document generated from the canvas state: brief, SQL, workflow, endpoints, screens and the acceptance test. It is what the team
        that builds the production version starts from.
      </p>
      <pre className="code pack">{md}</pre>
    </Dialog>
  );
}
export function RenameDialog({ p }: { p: AppPick & { name: string } }) {
  const app = S.apps[p.app];
  if (!app) return null;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const name = str(p.name);
    if (!name || name === app.name) return closeDialog();
    const pl = planOps(backed(app), [
      {
        op: 'rename_app',
        name,
      },
    ]);
    closeDialog();
    if (pl.steps.length) {
      pushChat(app, 'user', 'Rename the app to ' + name);
      runChange(backed(app), pl.steps, 'Rename the app');
    }
  };
  return (
    <Dialog title="Rename app" onClose={closeDialog}>
      <form className="col gap12" onSubmit={save}>
        <Field id="rn-name" label="App name">
          <Input
            native
            className="input"
            id="rn-name"
            data-autofocus
            value={p.name}
            onInput={(e) => {
              patchDialog({ name: e.currentTarget.value });
            }}
          />
        </Field>
        <div className="row end">
          <Btn type="button" className="btn" onClick={closeDialog}>
            Cancel
          </Btn>
          <Btn type="submit" className="btn primary">
            Rename
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
/** The Add a connection form. */
export interface AddConnForm {
  kind?: string;
  name: string;
  url: string;
  auth: string;
  err: string;
}
const ADD_CONN_START: AddConnForm = { kind: 'MCP server', name: '', url: '', auth: 'none', err: '' };
export function AddConnDialog({ p }: { p: AddConnForm }) {
  // a dialog opened without a form starts from the empty one
  const f: AddConnForm = p.kind ? p : ADD_CONN_START,
    set = (patch: Partial<AddConnForm>) => patchDialog({ ...f, ...patch });
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!str(f.name) || !/^https:\/\/\S+\.\S+/.test(str(f.url))) {
      set({ err: 'Give it a name and an https:// address.' });
      return;
    }
    const id = uid('c');
    S.custom.push({
      id,
      custom: true,
      name: str(f.name),
      kind: f.kind || 'MCP server',
      url: str(f.url),
      auth: f.auth === 'key' ? 'API key on the server' : 'No key needed',
      icon: 'plug',
      acc: 'steel',
      about: 'Added by you.',
      usedBy: 'Not used yet',
      tools: [
        {
          name: f.kind === 'MCP server' ? 'tools/list' : 'GET /',
          desc: 'Placeholder until the server lists this source’s tools.',
          args: {},
        },
      ],
    });
    S.conns[id] = true;
    U.conn = id;
    commit();
    closeDialog();
    toast(str(f.name) + ' added', 'success');
  };
  return (
    <Dialog title="Add a connection" onClose={closeDialog}>
      <form className="col gap12" onSubmit={add}>
        <Field id="ac-kind" label="Kind">
          <Select
            native
            className="select"
            id="ac-kind"
            value={f.kind}
            onChange={(e) => {
              set({ kind: e.currentTarget.value });
            }}
          >
            <option value="MCP server">MCP server (HTTP)</option>
            <option value="REST API">REST API</option>
          </Select>
        </Field>
        <Field id="ac-name" label="Name">
          <Input
            native
            className="input"
            id="ac-name"
            data-autofocus
            value={f.name}
            onInput={(e) => {
              set({ name: e.currentTarget.value });
            }}
          />
        </Field>
        <Field
          id="ac-url"
          label="Address"
          hint={f.kind === 'MCP server' ? "The server's streamable HTTP endpoint." : 'The base address of the API.'}
        >
          <Input
            native
            className="input mono"
            id="ac-url"
            placeholder="https://"
            value={f.url}
            onInput={(e) => {
              set({ url: e.currentTarget.value });
            }}
          />
        </Field>
        <Field
          id="ac-auth"
          label="Sign-in"
          hint="Keys are set as server environment variables. They never reach the browser or the repository."
        >
          <Select
            native
            className="select"
            id="ac-auth"
            value={f.auth}
            onChange={(e) => {
              set({ auth: e.currentTarget.value });
            }}
          >
            <option value="none">No key needed</option>
            <option value="key">API key, stored on the server</option>
          </Select>
        </Field>
        {f.err && <MBar tone="warning">{f.err}</MBar>}
        <div className="row end">
          <Btn type="button" className="btn" onClick={closeDialog}>
            Cancel
          </Btn>
          <Btn type="submit" className="btn primary">
            Add connection
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
export function AboutDialog() {
  const li = (items: string[]) => (
    <ul className="plain dots">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
  return (
    <Dialog
      wide
      title="What is real in Turnkey"
      onClose={closeDialog}
      foot={
        <Btn className="btn primary" onClick={closeDialog}>
          Close
        </Btn>
      }
    >
      <div className="about">
        <div>
          <h4>
            <Icon n="checkCircle" s="16" />
            Real
          </h4>
          {li([
            "SQLite runs in this page. Tables are created with CREATE TABLE from the agents' definitions and changed with ALTER TABLE.",
            "Each database is saved in this browser's storage and is still there after you sign out and back in.",
            'Every station check runs for real: links, seed rows, the permission matrix, screen mounting, the walkthrough as an acceptance test.',
            'The built app is drawn from its definition by one runtime, and every read or write goes through the role-guarded endpoints.',
            'Every view and the dashboard are computed from the rows the endpoints return for the signed-in role.',
            "The test suite is generated from each app's definition and runs for real. Anything a test writes is rolled back.",
            'Changes from chat run real migrations inside a savepoint and roll back if any check fails.',
            'In Live, each agent is its own model call on the server, streamed to this page as AG-UI events. The model key stays on the server.',
            "In the quest apps, Live runs the app's own agent team on the server, with real calls to Wikipedia, World Bank, OpenAlex, arXiv and PatentsView.",
            'Test on the Connections page calls those five sources for real through the server.',
            'A share link carries the app. The page that opens it rebuilds the app, and it has to pass every station check again there.',
            'Install is a real progressive web app, for Turnkey and for each released app with its own name and icon. A service worker keeps it working offline.',
            "Live follows the connection: the browser's online and offline signals, and whether Turnkey's own server answers.",
          ])}
        </div>
        <div>
          <h4>
            <Icon n="info" s="16" />
            Recorded or limited
          </h4>
          {li([
            "Demo replays recorded agent output, for builds and for the quest apps' agent runs. It makes no model calls, and its token figures are samples.",
            'In Demo the four review steps are rules written in code, and a standing instruction has nothing to act on, because recorded work is replayed.',
            'Connections without a server client (Microsoft Learn, MCP servers you add) show a labelled sample.',
            'Everyone who opens a share link works in their own copy, in their own browser. One database shared by everyone would need a store on the server, which the free hosting plan does not keep.',
            'Sign-in to a built app is local to this browser. It shows roles and permissions; it is not an account system.',
            'Live calls are capped per session and per day, to protect the model budget.',
          ])}
        </div>
      </div>
    </Dialog>
  );
}
/** What confirmBox puts in the dialog. */
interface ConfirmProps {
  title: string;
  body: ReactNode;
  yes?: string;
  no?: string;
  danger?: boolean;
  done: (ok: boolean) => void;
}
export function DialogHost() {
  const d = U.dialog;
  if (!d) return null;
  // openDialog's callers give each dialog the fields it reads; the dialog's props type says which
  const p = d.props as never;
  switch (d.type) {
    case 'confirm': {
      const c: ConfirmProps = p;
      return (
        <Dialog
          title={c.title}
          onClose={() => c.done(false)}
          foot={
            <>
              <Btn className="btn" onClick={() => c.done(false)}>
                {c.no || 'Cancel'}
              </Btn>
              <Btn className={cx('btn', c.danger ? 'danger' : 'primary')} data-autofocus onClick={() => c.done(true)}>
                {c.yes || 'OK'}
              </Btn>
            </>
          }
        >
          <p>{c.body}</p>
        </Dialog>
      );
    }
    case 'settings':
      return <SettingsDialog />;
    case 'install':
      return <InstallDialog />;
    case 'reset':
      return <ResetDialog />;
    case 'pack':
      return <PackDialog p={p} />;
    case 'rename':
      return <RenameDialog p={p} />;
    case 'addconn':
      return <AddConnDialog p={p} />;
    case 'about':
      return <AboutDialog />;
    case 'share':
      return <ShareDialog p={p} />;
    case 'openlink':
      return <OpenLinkDialog p={p} />;
    case 'aboutapp':
      return <AboutAppDialog p={p} />;
    case 'workflow':
      return <WorkflowDialog p={p} />;
    case 'installapp':
      return <InstallAppDialog p={p} />;
    case 'addstep':
      return <AddStepDialog p={p} />;
    case 'guide':
      return <GuideDialog p={p} />;
    case 'palette':
      return (
        <Suspense fallback={null}>
          <PaletteDialog />
        </Suspense>
      );
    case 'keys':
      return (
        <Suspense fallback={null}>
          <ShortcutsDialog />
        </Suspense>
      );
    default:
      return null;
  }
}
export function Toasts() {
  return (
    <div className="toasts" aria-live="polite">
      {U.toasts.map((t) => (
        <div key={t.id} className={'toast m-' + t.tone}>
          <Icon n={TONE_ICON[t.tone] || 'info'} />
          <span className="grow">{t.text}</span>
          <Btn
            className="btn subtle icon sm"
            aria-label="Dismiss"
            onClick={() => {
              U.toasts = U.toasts.filter((x) => x !== t);
              notify();
            }}
          >
            <Icon n="dismiss" s="12" />
          </Btn>
        </div>
      ))}
    </div>
  );
}

/* ---------- guided tour of the product ---------- */
export function tourSteps() {
  const tab = activeTab(),
    app = tab && tab.app ? S.apps[tab.app] : null,
    view = (v: string) => () => {
      if (app) U.view[app.id] = v;
    },
    s: ProductTourStep[] = [];
  s.push({
    target: 'tabs',
    title: 'Workspaces are tabs',
    body: 'Each tab holds one app with its own agents, data and chat, the way tabs work in Edge or Chrome. Press + for a new one.',
  });
  if (app)
    s.push(
      {
        target: 'line',
        prep: () => {
          U.view[app.id] = 'build';
          U.bview[app.id] = 'line';
        },
        title: 'The workflow',
        body: 'Your request, six agents, a gate after each one, and the finished app, drawn as a workflow you can pan, zoom and rearrange. Workflow, Timeline and Log show the same run three ways.',
      },
      {
        target: 'station',
        prep: () => {
          U.view[app.id] = 'build';
          U.bview[app.id] = 'line';
        },
        title: 'Checked handoffs',
        body: 'Nothing moves on until code has checked it. A failed check sends the work back to the agent, at most twice. In the clinic build the Database agent is sent back once, so you can watch it happen.',
      },
      {
        target: 'inspector',
        prep: view('build'),
        title: 'Inspect any station',
        body: 'Select an agent or a gate on the canvas to read what was produced, which checks ran, the tests generated for that station, and every attempt.',
      },
      {
        target: 'customize',
        prep: () => {
          U.view[app.id] = 'build';
          U.bview[app.id] = 'line';
        },
        title: 'Make the workflow yours',
        body: 'Press the plus on any gate to add a step: your approval, a step from the library, or an agent you describe in a sentence. You can also give an agent a standing instruction, or set how many attempts a station gets. Use the controls on the canvas, this button, or just ask in chat. Only the agents your change touches run again.',
      },
      {
        target: 'chat',
        prep: () => setChat(true),
        title: 'Talk to the agents',
        body: 'Agents report here with cards. They stop and ask before a real trade-off, and nothing that deletes data runs without your approval. Once the app is built, ask for changes in plain words.',
      },
      {
        target: 'views',
        title: 'Three steps, and the details',
        body: 'Build shows the agents at work. App is the working app. Release is where a draft becomes a numbered version you can share and install. Details keeps the tests, the data, the API and the connections one step away, for the curious.',
      },
      {
        target: 'share',
        title: 'Share only the app',
        body: 'Share makes a link that opens just this app, under its own name and icon, without the builder around it. The link carries a released version. Whoever opens it gets their own copy of the data and can install it.',
      },
      {
        target: 'stage',
        prep: view('app'),
        title: 'The working app',
        body: 'Sign in as any seeded user. Two users opens it side by side as different roles. Play walkthrough replays the acceptance test one step at a time.',
      },
      {
        target: 'vswitch',
        prep: () => {
          U.view[app.id] = 'app';
          if (!app.def.screens.length || !dbExists(app.id)) return;
          const st = stageOf(app),
            users = appUsers(app),
            p = st.panes[0];
          if (!users.some((u) => u.id === p.uid) && users[0]) p.uid = users[0].id;
          const u = users.find((x) => x.id === p.uid),
            scr = u && app.def.screens.find((x) => DATA_VIEWS.includes(x.type) && x.roles.includes(u.role));
          if (scr) {
            p.screen = scr.id;
            p.rec = null;
          }
        },
        title: 'One table, many views',
        body: 'A page opens a table in its default view. The switcher offers every view the View advisor recommended for that table: table, board, calendar, timeline, chart, pivot, tree or cards. Filters stay when you switch, and every role also gets a dashboard.',
      },
    );
  else
    s.push(
      {
        target: 'quests',
        title: 'Three quests, three apps',
        body: 'Each hackathon quest is built as its own app, and each has a team of three agents that work inside it. Build one, or all three at once.',
      },
      {
        target: 'library',
        title: 'Your app library',
        body: 'Every app you build is saved here with its data. Open it in a tab, duplicate it with its data, or delete it.',
      },
    );
  s.push(
    {
      target: 'mode',
      prep: app ? view('build') : null,
      title: 'Live and Demo',
      body: 'Live sends your own sentence to the model, and it follows your internet connection: it pauses when you go offline and comes back when you reconnect. Switch it off for Demo, which replays saved builds with made-up data that looks real and makes no model calls.',
    },
    {
      target: 'net',
      title: 'Your connection',
      body: 'This shows whether you are online. Built apps and their data live in this browser, so they keep working offline; Live, model changes and connections wait for the connection. Click here to try it without one.',
    },
    {
      target: 'debug',
      title: 'Debug mode',
      body: 'For developers: AG-UI events, tool calls, model usage, SQL, API calls, the shared state and browser storage.',
    },
    {
      target: 'account',
      title: 'Your data, your call',
      body: 'Everything is saved in this browser and is still here when you sign in again. Settings, install and reset live in this menu.',
    },
  );
  return s;
}
export function startTour() {
  if (!S.session) return;
  U.tour = {
    id: uid('tour'),
    i: 0,
    steps: tourSteps(),
  };
  notify();
}
/** Move the running tour to step i. */
function setTourStep(i: number) {
  if (U.tour) U.tour = { ...U.tour, i };
  notify();
}
export function TourLayer() {
  const T = U.tour,
    st = useState<{ x: number; y: number; w: number; h: number } | null>(null),
    rect = st[0],
    setRect = st[1],
    step = T ? T.steps[T.i] : null,
    tourId = T && T.id,
    tourStep = T && T.i;
  useLayoutEffect(() => {
    if (!T || !step) return undefined;
    let alive = true;
    if (NARROW() && step.target !== 'chat' && U.peek) U.peek = false;
    if (step.prep) step.prep();
    notify();
    let moved = false;
    const measure = () => {
      if (!alive) return;
      const el = step.target ? document.querySelector('[data-tour="' + step.target + '"]') : null;
      let r = el ? el.getBoundingClientRect() : null;
      if (el && r && !moved && (r.top < 0 || r.bottom > window.innerHeight) && el.scrollIntoView && !el.closest('.react-flow')) {
        moved = true;
        el.scrollIntoView({
          block: r.height > window.innerHeight * 0.6 ? 'start' : 'center',
        });
        r = el.getBoundingClientRect();
      } /* bring the thing being explained into view first */
      setRect((old) => {
        if (!r || r.width < 2 || r.height < 2) return null;
        const n = {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
        return old && old.x === n.x && old.y === n.y && old.w === n.w && old.h === n.h ? old : n;
      });
    };
    const a = setTimeout(measure, 90),
      iv = setInterval(measure, 350);
    window.addEventListener('resize', measure);
    return () => {
      alive = false;
      clearTimeout(a);
      clearInterval(iv);
      window.removeEventListener('resize', measure);
    };
  }, [tourId, tourStep]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per tour step; T and step are that step's
  if (!T || !step) return null;
  const W = window.innerWidth,
    H = window.innerHeight,
    pw = Math.min(340, W - 24),
    end = () => {
      U.tour = null;
      S.settings.tourDone = true;
      commit();
    },
    go = (d: number) => {
      const i = T.i + d;
      if (i < 0) return;
      if (i >= T.steps.length) return end();
      setTourStep(i);
    };
  let style: { left: string; top?: string; bottom?: string; width: string } = {
    left: (W - pw) / 2 + 'px',
    top: Math.max(40, H / 2 - 110) + 'px',
    width: pw + 'px',
  };
  if (rect) {
    const left = Math.min(Math.max(12, rect.x + rect.w / 2 - pw / 2), W - pw - 12),
      below = H - (rect.y + rect.h),
      right = W - (rect.x + rect.w);
    if (below > 220)
      style = {
        left: left + 'px',
        top: Math.max(12, rect.y + rect.h + 14) + 'px',
        width: pw + 'px',
      };
    else if (rect.y > 220 && rect.y < H)
      style = {
        left: left + 'px',
        bottom: Math.max(12, H - rect.y + 14) + 'px',
        width: pw + 'px',
      };
    else if (right > pw + 30)
      style = {
        left: rect.x + rect.w + 14 + 'px',
        top: Math.max(12, Math.min(rect.y, H - 250)) + 'px',
        width: pw + 'px',
      };
    else if (rect.x > pw + 30)
      style = {
        left: rect.x - pw - 14 + 'px',
        top: Math.max(12, Math.min(rect.y, H - 250)) + 'px',
        width: pw + 'px',
      };
    else
      style = {
        left: left + 'px',
        bottom: '16px',
        width: pw + 'px',
      };
  }
  return (
    <div
      className="tour"
      onKeyDown={(e) => {
        if (e.key === 'Escape') end();
        else if (e.key === 'ArrowRight') go(1);
        else if (e.key === 'ArrowLeft') go(-1);
      }}
    >
      <div className="tour-block" />
      {rect ? (
        <div
          className="tour-hole"
          style={{
            left: rect.x - 6 + 'px',
            top: rect.y - 6 + 'px',
            width: rect.w + 12 + 'px',
            height: rect.h + 12 + 'px',
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        className="tour-pop"
        role="dialog"
        aria-label={step.title}
        style={toStyle(style)}
        tabIndex={-1}
        ref={(el) => {
          if (el && el.dataset.i !== String(T.i)) {
            el.dataset.i = String(T.i);
            try {
              el.focus();
            } catch {}
          }
        }}
      >
        <div className="t-cap muted">
          {'Tour · '}
          {T.i + 1}
          {' of '}
          {T.steps.length}
        </div>
        <h3 className="t-sub2">{step.title}</h3>
        <p>{step.body}</p>
        <div className="row between">
          <Btn className="btn subtle sm" onClick={end}>
            Skip tour
          </Btn>
          <div className="row">
            {T.i > 0 && (
              <Btn className="btn sm" onClick={() => go(-1)}>
                Back
              </Btn>
            )}
            <Btn className="btn primary sm" onClick={() => go(1)}>
              {T.i === T.steps.length - 1 ? 'Done' : 'Next'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- root and boot ---------- */
export function Shell() {
  const tabs = tabsNow(),
    tab = activeTab(),
    app = tab && tab.app ? S.apps[tab.app] : null;
  return (
    <div className={cx('shell', S.settings.installed && 'installed', PHONE() && 'phone')}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <AreaBoundary name="The title bar">
        <Titlebar tabs={tabs} tab={tab} />
      </AreaBoundary>
      {!LS.ok && (
        <MBar tone="warning" cls="bar">
          Browser storage is not available in this view, so nothing will be kept after you close it. Open the page in its own tab to keep
          your work.
        </MBar>
      )}
      {LS.ok && storageProblem() && (
        <MBar tone={storageProblem()!.kind === 'write' ? 'warning' : 'danger'} cls="bar storage-problem">
          {storageProblem()!.text}
        </MBar>
      )}
      {!online() && (
        <MBar
          tone="warning"
          cls="bar"
          action={
            S.settings.offline ? (
              <Btn className="btn sm" onClick={() => setOffline(false)}>
                Go back online
              </Btn>
            ) : null
          }
        >
          You are offline{S.settings.demo ? '' : ', so Live is paused until the connection returns'}. Built apps, their data and saved
          builds keep working. Changes through the model and connections wait.
        </MBar>
      )}
      <main className="shell-body" id="main" tabIndex={-1}>
        <AreaBoundary name={app ? 'This app' : 'The home page'} resetKey={app ? app.id : 'home'}>
          {app ? <Workspace key={app.id} app={app} /> : <Home />}
        </AreaBoundary>
      </main>
      {S.settings.debug && (
        <AreaBoundary name="The debug drawer">
          <DebugDrawer app={app} />
        </AreaBoundary>
      )}
      {PHONE() && (
        <AreaBoundary name="The phone menu">
          <PhoneSheets app={app} />
        </AreaBoundary>
      )}
      <AreaBoundary name="The agent panel" resetKey={app ? app.id : 'home'}>
        <AgentActivity app={app} />
      </AreaBoundary>
    </div>
  );
}
function RootInner() {
  useStore();
  if (U.boot === 'loading')
    return (
      <div className="splash">
        <Logo size={44} />
        <strong className="t-sub1">{BRAND.name}</strong>
        <span className="muted row">
          <Spinner />
          Starting the SQLite engine
        </span>
      </div>
    );
  if (U.boot === 'error')
    return (
      <div className="splash" role="alert">
        <Logo size={44} />
        <strong className="t-sub1">
          {BRAND.name}
          {' could not start'}
        </strong>
        <p className="muted">{engineProblem(U.bootErr)}</p>
        <Btn className="btn primary" onClick={() => window.location.reload()}>
          Reload the page
        </Btn>
      </div>
    );
  if (U.solo && S.apps[U.solo.app]) return [<SoloShell key="solo" />, <DialogHost key="dlg" />, <Toasts key="toasts" />];
  return [
    !S.onboarded ? <Onboarding key="ob" /> : !S.session || !me() ? <SignIn key="si" /> : <Shell key="shell" />,
    <AreaBoundary key="dlg" name="This dialog">
      <DialogHost />
    </AreaBoundary>,
    <AreaBoundary key="tour" name="The guided tour">
      <TourLayer />
    </AreaBoundary>,
    <Toasts key="toasts" />,
  ];
}
/** Everything in the workspace sits inside Fluent's provider; light or dark follows the app's own setting. */
export function Root() {
  useStore(); // the theme follows the app's setting
  return (
    <FluentProvider theme={isDark() ? webDarkTheme : webLightTheme} className="fl-provider">
      <RootInner />
    </FluentProvider>
  );
}
export function probeClaude(tries: number) {
  const c = modelHost();
  if (c && typeof c.use === 'function') {
    Promise.resolve(c.use('sample')).then(
      (fn) => {
        // the host hands back the model client's sample function, or nothing
        LIVE.fn = typeof fn === 'function' ? (fn as typeof LIVE.fn) : null;
        U.live = LIVE.fn ? 'ready' : 'none';
        notify();
      },
      () => {
        U.live = 'none';
        notify();
      },
    );
    Promise.resolve(c.use('downloads')).then(
      (d) => {
        U.dl = d && typeof (d as Downloader).save === 'function' ? (d as Downloader) : null;
        notify();
      },
      () => {},
    );
    return;
  }
  if (tries < 20) setTimeout(() => probeClaude(tries + 1), 500);
  else {
    U.live = 'none';
    notify();
  }
}
export function boot() {
  installShortcuts();
  LS.probe();
  loadState();
  applyTheme();
  if (!S.shared) S.shared = {};
  Object.values(S.apps).forEach((a) => {
    try {
      migrateApp(a);
    } catch (e) {
      console.warn('Could not update a saved app', e);
    }
  });
  // the SQLite engine takes a moment to start, so let the splash paint first
  const fromLink = () => {
    const code = linkCode();
    return code
      ? openShared(code).catch((e) => {
          toast(String((e && e.message) || e), 'danger', 9000);
        })
      : Promise.resolve();
  }; // an address that ends in #app=… opens that app on its own
  window.addEventListener('hashchange', () => {
    if (U.boot === 'ready') fromLink();
  });
  setTimeout(
    () =>
      initSqlite()
        .then(() => {
          resumeInterrupted();
          return fromLink();
        })
        .then(
          () => {
            U.boot = 'ready';
            notify();
          },
          (e) => {
            U.boot = 'error';
            U.bootErr = String((e && e.message) || e);
            notify();
          },
        ),
    40,
  );
  probeClaude(0);
  const flush = () => {
    try {
      if (saveTimer) saveNow();
      Object.keys(DBX.timers).forEach((id) => {
        if (DBX.timers[id]) dbFlush(id);
      });
    } catch {}
  };
  setNetWas(online()); // Live follows the connection: listen for it coming and going
  window.addEventListener('online', () => {
    netChanged();
    void checkReach(); // the browser says the connection is back: make sure the server answers too
  });
  window.addEventListener('offline', netChanged);
  void checkReach();
  window.addEventListener('resize', notify);
  try {
    // the Network Information API is not in every browser, nor in the DOM types
    const n = navigator as Navigator & { connection?: EventTarget; mozConnection?: EventTarget; webkitConnection?: EventTarget },
      c = n.connection || n.mozConnection || n.webkitConnection;
    if (c && c.addEventListener) c.addEventListener('change', netChanged);
  } catch {}
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else void checkReach();
  });
  window.__formwork = {
    save: () => {
      Object.keys(S.apps).forEach((id) => {
        try {
          if (dbExists(id)) dbSave(id);
        } catch {}
      });
      saveNow();
    },
    state: () => S,
    view: () => U,
    teams: () => TEAMS,
    tests: () => TESTS,
    share: {
      packOf,
      squeeze,
      unsqueeze,
      shareLink,
      openShared,
      enterSolo,
      exitSolo,
    },
    flow: () => FLOW,
    dbCount,
    sql: (id: string, text: string, params?: SqlValue[]) => sqlRun(id, text, params || null, 'test'),
    guide: () => GUIDE.length,
    wf: {
      parse: parseFlow,
      parseChange,
      apply: flowApply,
      edit: flowEdit,
      rules: REVIEW_RULES,
      reviewers: REVIEWERS,
      tryFix,
      rerun: (app: AppRecord, st: string) => runBuild(lineApp(app), st),
      review: reviewNow,
      mode: modeNow,
      reach: checkReach,
      runs: () => RUNS,
      dirty: isDirty,
      relOf,
      release: releaseApp,
      logo: logoOf,
      cases: suggestCases,
      keepFix,
    },
    activity: (appId: string) => activityNow(appId),
    runTests: (app: AppRecord) => runTestsSync(app),
    suite: (id: string) =>
      suiteOf(S.apps[id]).map((x) => ({
        id: x.id,
        n: x.tests.length,
      })),
    logs: {
      EV,
      TOOLCALLS,
      MODELCALLS,
      SQLLOG,
      APILOG,
    },
  };
}

declare global {
  interface Window {
    /** hooks the browser tests read and drive (tests/e2e) */
    __formwork?: unknown;
  }
}
