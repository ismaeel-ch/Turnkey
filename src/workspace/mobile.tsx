import { useCallback, useState, useEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode, TouchEvent } from 'react';
import type { AppUser, Screen } from '@/shared/types/app';
import type { AppRecord, PhoneSheet, Tab } from '@/shared/types/workspace';
import {
  BRAND,
  S,
  U,
  activeTab,
  arr,
  chatShown,
  closeTab,
  commit,
  confirmBox,
  cx,
  me,
  modeNow,
  notify,
  online,
  openDialog,
  openTab,
  selectTab,
  setChat,
  setLive,
  setOffline,
  signOut,
  tabsNow,
  uid,
} from './core';
import { appUsers, roleName } from './engine';
import { testStats } from './tests';
import { AGENTS, PENDING, RUNS, STATIONS, deleteApp, resetAppData } from './line';
import { flowOf } from './custom';
import { REVIEWERS } from './reviewers';
import { Btn, Avatar, Empty, Icon, Logo } from './ui';
import { startWalk } from './runtime';
import { enterSolo, openShare } from './share';
import { AppLogo, isDirty, relOf } from './release';
import { Inspector, isDetail, rebuildAsk, viewOf } from './shell-a';
import { startTour } from './shell-c';

/** A row of the built app's account menu: an action, or '-' for a divider. */
export type SoloItem = '-' | { label: string; icon?: string; on: () => void };
/** What a built app's pane keeps for the phone layout: which bottom sheet is open. */
export interface PhonePane {
  sheet?: string | null;
}
/** Opens or closes a bottom sheet of a built app ('more' pages, or the account sheet). */
function setPaneSheet(pane: PhonePane, sheet: string | null): void {
  pane.sheet = sheet;
  notify();
}
/** Moves the builder's phone layout to one view of an app, closing the chat and any sheet. */
function phoneGo(app: AppRecord, view: string, chat: boolean): void {
  U.view[app.id] = view;
  if (chat) setChat(false);
  U.sheet = null;
  notify();
}

/* ===== Turnkey prototype · phone layouts =====
   On a phone nothing is a shrunken web page. A built app gets a title bar, a bottom tab bar, a floating New button, full-screen
   record pages and bottom sheets. The builder gets its own bottom navigation, a switcher for open workspaces, and opens built apps
   full screen. A built app switches by the width it is given (so a narrow pane on a desktop looks like a phone too); the builder
   switches by the width of the window. */
export function useElWidth() {
  // the width of an element that may come and go between renders
  const st = useState(0),
    ro = useRef<ResizeObserver | null>(null),
    set = st[1];
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (ro.current) {
        ro.current.disconnect();
        ro.current = null;
      }
      if (!el) return;
      const fit = () => set((old) => (el.clientWidth && el.clientWidth !== old ? el.clientWidth : old));
      fit();
      if (typeof ResizeObserver !== 'undefined') {
        ro.current = new ResizeObserver(fit);
        ro.current.observe(el);
      }
    },
    [set],
  );
  return [ref, st[0]] as const;
}
export const isCompact = (w?: number) => (w || window.innerWidth) <= 640;
export function Sheet({
  title,
  sub,
  onClose,
  children,
  cls,
  tall,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children?: ReactNode;
  cls?: string;
  tall?: boolean;
}) {
  // a panel that rises from the bottom; drag the handle down, tap outside or press Escape to close
  const ref = useRef<HTMLElement>(null),
    drag = useRef({
      on: false,
      y: 0,
    }).current;
  useEffect(() => {
    const el = ref.current;
    if (el) {
      try {
        el.focus({
          preventScroll: true,
        });
      } catch {}
    }
  }, []);
  const ts = (e: TouchEvent) => {
      drag.on = true;
      drag.y = e.touches[0].clientY;
    },
    tm = (e: TouchEvent) => {
      if (!drag.on || !ref.current) return;
      const dy = Math.max(0, e.touches[0].clientY - drag.y);
      ref.current.style.transition = 'none';
      ref.current.style.transform = 'translateY(' + dy + 'px)';
    };
  const te = (e: TouchEvent) => {
    if (!drag.on || !ref.current) return;
    drag.on = false;
    const t = e.changedTouches && e.changedTouches[0],
      dy = t ? Math.max(0, t.clientY - drag.y) : 0;
    ref.current.style.transition = '';
    ref.current.style.transform = '';
    if (dy > 90) onClose();
  };
  return (
    <div
      className={cx('sheet-wrap', cls)}
      onMouseDown={(e: MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={cx('sheet', tall && 'tall')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sheet-top" onTouchStart={ts} onTouchMove={tm} onTouchEnd={te} onTouchCancel={te}>
          <button className="sheet-grab" aria-label="Close" onClick={onClose}>
            <span />
          </button>
          <header className="sheet-head">
            <div className="col gap0 grow">
              <h2 className="t-sub2">{title}</h2>
              {sub && <span className="t-cap muted">{sub}</span>}
            </div>
            <Btn className="btn subtle icon" aria-label="Close" onClick={onClose}>
              <Icon n="dismiss" />
            </Btn>
          </header>
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
export interface SheetRowProps {
  icon?: string;
  /** shown instead of the icon: an avatar or app badge */
  av?: ReactNode;
  label: string;
  hint?: string;
  on?: boolean;
  onClick: () => void;
  check?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** shown at the end of the row: a switch or a chevron */
  end?: ReactNode;
}
export const SheetRow = ({ icon, av, label: text, hint, on, onClick, check, danger, disabled, end }: SheetRowProps) => (
  <button className={cx('sheet-i', on && 'on', danger && 'danger')} disabled={disabled} onClick={onClick}>
    {av ||
      (icon && (
        <span className="sheet-ic">
          <Icon n={icon} />
        </span>
      ))}
    <span className="col gap0 grow">
      <span className="sheet-l">{text}</span>
      {hint && <span className="t-cap muted">{hint}</span>}
    </span>
    {end}
    {check && <Icon n="check" s="16" />}
  </button>
);

/* ---------- inside a built app ---------- */
export function AppTabs({
  screens,
  scr,
  pane,
  go,
}: {
  screens: Screen[];
  scr: Screen | undefined;
  pane: PhonePane;
  go: (id: string) => void;
}) {
  // up to five places at the bottom; the rest go under More
  const max = screens.length > 5 ? 4 : 5,
    main = screens.slice(0, max),
    rest = screens.slice(max),
    inRest = !!scr && rest.some((s) => s.id === scr.id);
  return (
    <nav className="app-tabs" aria-label="Pages">
      {main.map((s) => (
        <button
          key={s.id}
          className={cx('tab-i', scr && s.id === scr.id && 'on')}
          aria-current={scr && s.id === scr.id ? 'page' : undefined}
          onClick={() => go(s.id)}
        >
          <span className="tab-ic">
            <Icon n={s.icon || ''} s="24" />
          </span>
          <span className="tab-l">{s.name}</span>
        </button>
      ))}
      {rest.length > 0 && (
        <button
          className={cx('tab-i', inRest && 'on')}
          aria-haspopup="dialog"
          aria-label={'More pages: ' + rest.map((s) => s.name).join(', ')}
          onClick={() => setPaneSheet(pane, 'more')}
        >
          <span className="tab-ic">
            <Icon n="more" s="24" />
          </span>
          <span className="tab-l">More</span>
        </button>
      )}
    </nav>
  );
}
export function AppSheets({
  app,
  pane,
  user,
  users,
  screens,
  scr,
  go,
  swap,
  solo,
}: {
  app: AppRecord;
  pane: PhonePane;
  user: AppUser;
  users: AppUser[];
  screens: Screen[];
  scr: Screen | undefined;
  go: (id: string) => void;
  swap: (u: AppUser | null) => void;
  solo?: SoloItem[] | null;
}) {
  const def = app.def,
    close = () => setPaneSheet(pane, null),
    max = screens.length > 5 ? 4 : 5;
  if (pane.sheet === 'more')
    return (
      <Sheet title="More pages" onClose={close}>
        <div className="sheet-list">
          {screens.slice(max).map((s) => (
            <SheetRow
              key={s.id}
              icon={s.icon}
              label={s.name}
              on={!!scr && s.id === scr.id}
              check={!!scr && s.id === scr.id}
              onClick={() => go(s.id)}
            />
          ))}
        </div>
      </Sheet>
    );
  return (
    <Sheet title={user.name} sub={roleName(def, user.role) + ' · ' + app.name} onClose={close}>
      <div className="sheet-h">Switch person</div>
      <div className="sheet-list">
        {users.map((u) => (
          <SheetRow
            key={u.id}
            av={<Avatar name={u.name} size="sm" />}
            label={u.name}
            hint={roleName(def, u.role)}
            on={u.id === user.id}
            check={u.id === user.id}
            onClick={() => swap(u)}
          />
        ))}
      </div>
      <div className="sheet-list">
        {arr<SoloItem>(solo).map((it, i) =>
          it === '-' ? null : (
            <SheetRow
              key={i}
              icon={it.icon}
              label={it.label}
              onClick={() => {
                close();
                it.on();
              }}
            />
          ),
        )}
        <SheetRow icon="signOut" label="Sign out" onClick={() => swap(null)} />
      </div>
    </Sheet>
  );
}

/* ---------- the builder on a phone ---------- */
export const sheetOpen = (kind: PhoneSheet['kind'], more?: Omit<PhoneSheet, 'kind'>) => {
    U.sheet = Object.assign(
      {
        kind,
      },
      more || {},
    );
    notify();
  },
  sheetClose = () => {
    U.sheet = null;
    notify();
  };
export function PhoneBar({ tabs, tab }: { tabs: Tab[]; tab: Tab | null }) {
  // title bar: home, the workspace switcher, the menu
  const app = tab && tab.app ? S.apps[tab.app] : null,
    acct = me();
  return (
    <header className="titlebar phone">
      <button className="brand" aria-label="Home" onClick={() => openTab(null)}>
        <Logo />
      </button>
      <button
        className="ws-btn"
        aria-haspopup="dialog"
        aria-label={'Open workspaces. Current: ' + (app ? app.name : 'Home')}
        data-tour="tabs"
        onClick={() => sheetOpen('tabs')}
      >
        {app ? (
          <span className={'wtab-ic acc-' + app.accent}>
            <Icon n={app.icon} s="12" />
          </span>
        ) : (
          <Icon n="home" s="16" />
        )}
        <span className="ellipsis">{app ? app.name : 'Home'}</span>
        <span className="tab-n">{tabs.length}</span>
        <Icon n="chevDown" s="16" />
      </button>
      <span className="grow" />
      {!online() && <span className="badge b-warning">Offline</span>}
      <span className="act-slot" aria-hidden="true" />
      <button className="acct" aria-haspopup="dialog" aria-label="Menu" data-tour="account" onClick={() => sheetOpen('menu')}>
        <Avatar name={acct ? acct.name : ''} size="sm" acc="blue" />
      </button>
    </header>
  );
}
export function PhoneNav({ app }: { app: AppRecord }) {
  // bottom navigation of a workspace
  const view = viewOf(app),
    chat = chatShown(),
    rel = relOf(app),
    needs = app.line.research.status === 'waiting' || !!PENDING[app.id],
    failed = testStats(app)?.failed || 0;
  const go = (v: string) => phoneGo(app, v, chat);
  const item = (id: string, icon: string, text: string, on: boolean, onClick: () => void, dot?: string | null) => (
    <button key={id} className={cx('tab-i', on && 'on')} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <span className="tab-ic">
        <Icon n={icon} s="24" />
        {dot && <i className={'tab-dot ' + dot} />}
      </span>
      <span className="tab-l">{text}</span>
    </button>
  );
  return (
    <nav className="phone-nav" aria-label="Workspace" data-tour="views">
      {item('build', 'flow', 'Build', !chat && view === 'build', () => go('build'), RUNS[app.id] ? 'live' : null)}
      {item('app', 'window', 'App', !chat && view === 'app', () => go('app'), null)}
      {item(
        'release',
        'rocket',
        'Release',
        !chat && view === 'release',
        () => go('release'),
        app.status === 'ready' && (!rel || isDirty(app)) ? 'warn' : null,
      )}
      {item(
        'chat',
        'chat',
        'Chat',
        chat,
        () => {
          setChat(!chat);
        },
        needs ? 'warn' : null,
      )}
      {item(
        'more',
        'more',
        'More',
        !chat && isDetail(view),
        () =>
          sheetOpen('more', {
            app: app.id,
          }),
        failed ? 'bad' : null,
      )}
    </nav>
  );
}
export function AppLauncher({ app }: { app: AppRecord }) {
  // the App tab on a phone: the app opens full screen, like an app, instead of inside the builder
  const def = app.def,
    users = appUsers(app),
    ready = def.screens.length > 0 && app.status === 'ready';
  if (!ready)
    return (
      <div className="launch">
        <Empty
          icon="layout"
          title="The app is not built yet"
          text="When the Screens station has passed its checks, the app opens from here."
        />
      </div>
    );
  const open = (u: AppUser | null) =>
    enterSolo(app, {
      from: 'own',
      as: u ? u.username : null,
      back: app.id,
    });
  return (
    <div className="launch scroll" data-tour="stage">
      <div className={'launch-hero acc-' + def.theme.accent}>
        <AppLogo app={app} size={72} />
        <h2 className="t-sub1">{app.name}</h2>
        <p className="muted">{def.brief ? def.brief.summary : app.request}</p>
        <Btn className="btn primary lg" onClick={() => open(null)}>
          <Icon n="open" />
          Open the app
        </Btn>
        <span className="t-cap muted">Opens full screen, the way someone you share it with sees it.</span>
      </div>
      <div className="sheet-h">Open as</div>
      <div className="sheet-list card">
        {users.map((u) => (
          <SheetRow
            key={u.id}
            av={<Avatar name={u.name} size="sm" />}
            label={u.name}
            hint={roleName(def, u.role)}
            end={<Icon n="chevRight" s="16" />}
            onClick={() => open(u)}
          />
        ))}
      </div>
      <div className="sheet-list card">
        <SheetRow icon="share" label="Share by link" hint="They see only the app" onClick={() => openShare(app)} />
        <SheetRow
          icon="playOutline"
          label="Play the walkthrough"
          hint="The agents' tour, as the acceptance test"
          disabled={!def.tour.length}
          onClick={() => startWalk(app)}
        />
        <SheetRow
          icon="reset"
          label="Reset the data"
          hint="Put the seed rows back"
          onClick={async () => {
            if (
              await confirmBox({
                title: 'Reset the data in ' + app.name + '?',
                body: 'Every table is emptied and the original seed rows are put back.',
                yes: 'Reset data',
              })
            )
              resetAppData(app);
          }}
        />
      </div>
    </div>
  );
}
export function PhoneSheets({ app }: { app: AppRecord | null }) {
  // the sheets of the builder: workspaces, menu, more, inspector
  const sh = U.sheet;
  if (!sh) return null;
  const s = S.settings,
    acct = me();
  if (sh.kind === 'tabs') {
    const tabs = tabsNow(),
      cur = activeTab();
    return (
      <Sheet cls="fixed" title="Workspaces" sub={tabs.length + ' open'} onClose={sheetClose}>
        <div className="sheet-list">
          {tabs.map((t) => {
            const a = t.app ? S.apps[t.app] : null;
            return (
              <div key={t.id} className="sheet-pair">
                <SheetRow
                  av={
                    a ? (
                      <span className={'app-badge sm acc-' + a.accent}>
                        <Icon n={a.icon} s="16" />
                      </span>
                    ) : (
                      <span className="sheet-ic">
                        <Icon n="home" />
                      </span>
                    )
                  }
                  label={a ? a.name : 'Home'}
                  hint={a ? (RUNS[a.id] ? 'Building' : a.status === 'ready' ? 'Ready' : 'Not finished') : 'Start a new app'}
                  on={t.id === cur.id}
                  check={t.id === cur.id}
                  onClick={() => {
                    U.sheet = null;
                    selectTab(t.id);
                  }}
                />
                <Btn className="btn subtle icon" aria-label={'Close ' + (a ? a.name : 'tab')} onClick={() => closeTab(t.id)}>
                  <Icon n="dismiss" />
                </Btn>
              </div>
            );
          })}
        </div>
        <div className="sheet-list">
          <SheetRow
            icon="add"
            label="New workspace"
            onClick={() => {
              const t = {
                id: uid('tab'),
                app: null,
              };
              tabsNow().push(t);
              if (S.session) S.active[S.session] = t.id;
              U.sheet = null;
              commit();
            }}
          />
        </div>
      </Sheet>
    );
  }
  if (sh.kind === 'menu') {
    const tog = (on: boolean) => (
        <span className={cx('switch-pill', on && 'on')} aria-hidden="true">
          <i />
        </span>
      ),
      act = (fn: () => unknown) => () => {
        U.sheet = null;
        fn();
        notify();
      };
    return (
      <Sheet cls="fixed" title={acct ? acct.name : ''} sub={(acct ? acct.username : '') + ' · ' + BRAND.name} onClose={sheetClose}>
        <div className="sheet-list">
          <SheetRow
            icon="sparkle"
            label="Live"
            hint={
              !online()
                ? 'Paused while you are offline. Comes back when you reconnect.'
                : modeNow().on
                  ? 'On: your sentence goes to the model'
                  : 'Off: Demo, saved builds and no model calls'
            }
            end={tog(modeNow().on)}
            onClick={() => setLive(!modeNow().on)}
          />
          <SheetRow
            icon={online() ? 'wifi' : 'wifiOff'}
            label="Online"
            hint={
              online()
                ? 'Live follows this connection. Switch off to try without it.'
                : s.offline
                  ? 'Offline (simulated). Switch on to reconnect.'
                  : 'This device is offline'
            }
            end={tog(online())}
            onClick={() => setOffline(!s.offline)}
          />
          <SheetRow
            icon="bug"
            label="Debug mode"
            hint="Events, tool calls, SQL and model calls"
            end={tog(s.debug)}
            onClick={() => {
              s.debug = !s.debug;
              commit();
            }}
          />
        </div>
        <div className="sheet-list">
          <SheetRow
            icon="bookOpen"
            label="Feature guide"
            hint="Every feature, and how to try it"
            onClick={act(() => openDialog('guide'))}
          />
          <SheetRow icon="compass" label="Take the guided tour" onClick={act(() => startTour())} />
          <SheetRow
            icon="open"
            label="Open a shared app"
            onClick={act(() =>
              openDialog('openlink', {
                text: '',
              }),
            )}
          />
          <SheetRow icon="info" label="What is real in this prototype" onClick={act(() => openDialog('about'))} />
        </div>
        <div className="sheet-list">
          <SheetRow icon="settings" label="Settings" onClick={act(() => openDialog('settings'))} />
          <SheetRow
            icon="install"
            label={s.installed ? 'Installed as an app' : 'Install as an app'}
            onClick={act(() => openDialog('install'))}
          />
          <SheetRow icon="reset" label="Reset data" onClick={act(() => openDialog('reset'))} />
          <SheetRow icon="signOut" label="Sign out" onClick={act(() => signOut())} />
        </div>
      </Sheet>
    );
  }
  if (!app) return null;
  if (sh.kind === 'more') {
    const busy = !!RUNS[app.id],
      ready = app.status === 'ready',
      go = (v: string) => () => {
        U.view[app.id] = v;
        U.sheet = null;
        if (chatShown()) setChat(false);
        notify();
      },
      act = (fn: () => unknown) => () => {
        U.sheet = null;
        fn();
        notify();
      },
      view = viewOf(app);
    return (
      <Sheet cls="fixed" title={app.name} sub="More places and actions" onClose={sheetClose}>
        <div className="sheet-h">Details, for the curious</div>
        <div className="sheet-list">
          <SheetRow
            icon="beaker"
            label="Tests"
            hint="Every test the build wrote, and how it went"
            on={view === 'tests'}
            onClick={go('tests')}
          />
          <SheetRow icon="database" label="Data" hint="Tables, rows and SQL" on={view === 'data'} onClick={go('data')} />
          <SheetRow icon="server" label="API" hint="Endpoints and who may call them" on={view === 'api'} onClick={go('api')} />
          <SheetRow icon="plug" label="Connections" hint="Outside sources the agents may use" on={view === 'conn'} onClick={go('conn')} />
        </div>
        <div className="sheet-list">
          <SheetRow icon="share" label="Share by link" disabled={!ready} onClick={act(() => openShare(app))} />
          <SheetRow
            icon="document"
            label="Export build pack"
            disabled={!ready}
            onClick={act(() =>
              openDialog('pack', {
                app: app.id,
              }),
            )}
          />
          <SheetRow
            icon="edit"
            label="Rename app"
            disabled={!ready || busy}
            onClick={act(() =>
              openDialog('rename', {
                app: app.id,
                name: app.name,
              }),
            )}
          />
          <SheetRow icon="rerun" label="Run the build again" disabled={busy} onClick={act(() => rebuildAsk(app))} />
          <SheetRow
            icon="options"
            label="Customize the workflow"
            hint="Approvals, review steps, instructions, attempts"
            onClick={act(() =>
              openDialog('workflow', {
                app: app.id,
              }),
            )}
          />
          <SheetRow
            icon="trash"
            label="Delete app"
            danger
            onClick={act(async () => {
              if (
                await confirmBox({
                  title: 'Delete ' + app.name + '?',
                  body: 'The app, its SQLite database and its chat are removed from this browser.',
                  yes: 'Delete app',
                  danger: true,
                })
              )
                deleteApp(app);
            })}
          />
        </div>
      </Sheet>
    );
  }
  if (sh.kind === 'inspector') {
    const sid = U.sel[app.id] || 'research',
      rid = String(sid).indexOf('rv_') === 0 ? String(sid).slice(3) : null,
      rv = rid && flowOf(app).reviewers.includes(rid) ? REVIEWERS[rid] : null,
      st = STATIONS.find((x) => x.id === sid) || STATIONS[0];
    return rv ? (
      <Sheet cls="fixed" tall title={rv.name} sub={rv.job} onClose={sheetClose}>
        <Inspector app={app} sid={sid} bare />
      </Sheet>
    ) : sid === 'qa' ? (
      <Sheet cls="fixed" tall title="Tests" sub={'Tester · ' + AGENTS.tester.role} onClose={sheetClose}>
        <Inspector app={app} sid="qa" bare />
      </Sheet>
    ) : (
      <Sheet cls="fixed" tall title={st.name} sub={AGENTS[st.agent].name + ' · ' + AGENTS[st.agent].role} onClose={sheetClose}>
        <Inspector app={app} sid={st.id} bare />
      </Sheet>
    );
  }
  return null;
}
