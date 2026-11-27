/*
 * Commands and keyboard shortcuts. Every command the palette offers is listed here, built fresh from the state each
 * time the palette opens, so it only offers what can be done right now. The palette itself (palette.tsx) loads on
 * first use; this file stays small because it ships with the page.
 */
import { keyName, type Rankable } from '@/platform/command-match';
import type { AppRecord, Settings } from '@/shared/types/workspace';
import {
  S,
  U,
  activeTab,
  applyTheme,
  chatShown,
  closeDialog,
  commit,
  me,
  modeNow,
  myApps,
  notify,
  online,
  openDialog,
  openTab,
  setChat,
  setLive,
} from './core';
import { RUNS, stopRun } from './line';
import { toggleAgentsPanel } from './activity';
import { DETAILS, VIEWS, rebuildAsk } from './shell-a';
import { buildMode, showHow } from './build-mode';
import { openShare } from './share';
import { redo, redoable, undo, undoable } from './history';
import { openHistory } from './history-ui';
import { startTour } from './shell-c';

export interface Command extends Rankable {
  id: string;
  /** an icon name from icons.ts */
  icon: string;
  /** the shortcut that runs it too, as keyName writes it ("mod+k", "g b") */
  keys?: string;
  run: () => void;
}

/** The app in the active tab, if there is one. */
function currentApp(): AppRecord | null {
  const t = activeTab();
  return t && t.app ? S.apps[t.app] || null : null;
}

export function goView(v: string) {
  const app = currentApp();
  if (!app) return;
  U.view[app.id] = v === 'details' ? U.detail[app.id] || 'tests' : v;
  if (DETAILS.some((d) => d.id === v)) U.detail[app.id] = v;
  if (chatShown() && window.innerWidth <= 640) U.peek = false; // on a phone the chat covers the view
  notify();
}

function setTheme(t: Settings['theme']) {
  S.settings.theme = t;
  applyTheme();
  commit();
}

function newApp() {
  openTab(null);
  // the home page draws on the next frame; then the sentence box takes focus
  setTimeout(() => document.getElementById('home-prompt')?.focus(), 50);
}

export const openPalette = () => openDialog('palette');
export const openShortcuts = () => openDialog('keys');

const VIEW_KEYS: Record<string, string> = { build: 'g b', app: 'g a', release: 'g r', details: 'g d' };

/** Everything the palette can do right now, in the order it lists them when nothing is typed. */
export function commandsNow(): Command[] {
  const app = currentApp();
  const busy = !!(app && RUNS[app.id]);
  const ready = !!app && app.status === 'ready';
  const mode = modeNow();
  const out: Command[] = [];
  const add = (c: Command) => out.push(c);

  add({ id: 'go-home', group: 'Go to', title: 'Home', icon: 'home', keys: 'g h', keywords: 'start new tab', run: () => openTab(null) });
  if (app) {
    for (const v of VIEWS)
      add({
        id: 'view-' + v.id,
        group: 'Go to',
        title: String(v.label) + ' view',
        icon: v.icon || 'window',
        keys: VIEW_KEYS[v.id],
        keywords: v.title,
        run: () => goView(v.id),
      });
    for (const v of DETAILS)
      add({
        id: 'view-' + v.id,
        group: 'Go to',
        title: String(v.label),
        icon: v.icon || 'window',
        keywords: 'details ' + v.title,
        run: () => goView(v.id),
      });
  }
  for (const a of myApps().slice(0, 20))
    if (!app || a.id !== app.id)
      add({
        id: 'open-' + a.id,
        group: 'Apps',
        title: 'Open ' + a.name,
        icon: a.icon || 'window',
        keywords: 'switch app ' + (a.request || ''),
        run: () => openTab(a.id),
      });

  add({ id: 'new-app', group: 'Build', title: 'Build a new app', icon: 'sparkle', keywords: 'create start describe', run: newApp });
  if (app && busy)
    add({ id: 'stop', group: 'Build', title: 'Stop the build', icon: 'stop', keywords: 'cancel halt run', run: () => stopRun(app) });
  if (app && !busy)
    add({
      id: 'rebuild',
      group: 'Build',
      title: 'Run the build again',
      icon: 'rerun',
      keywords: 'start rebuild restart run',
      run: () => void rebuildAsk(app),
    });
  if (app) {
    const plain = buildMode(app) === 'steps';
    add({
      id: 'build-how',
      group: 'Build',
      title: plain ? 'Show how it was built' : 'Show the build as plain steps',
      icon: plain ? 'flow' : 'tasks',
      keywords: 'workflow canvas timeline log meeting agents steps list simple',
      run: () => {
        U.view[app.id] = 'build';
        showHow(app, plain);
      },
    });
  }
  if (app)
    add({
      id: 'workflow',
      group: 'Build',
      title: 'Customize the workflow',
      icon: 'options',
      keywords: 'steps stations agents',
      run: () => openDialog('workflow', { app: app.id }),
    });

  if (app && ready) {
    if (undoable(app))
      add({
        id: 'undo',
        group: 'Changes',
        title: 'Undo the last change',
        icon: 'undo',
        keys: 'mod+z',
        keywords: 'revert back',
        run: () => undo(app),
      });
    if (redoable(app))
      add({
        id: 'redo',
        group: 'Changes',
        title: 'Redo',
        icon: 'undo',
        keys: 'mod+shift+z',
        keywords: 'again forward',
        run: () => redo(app),
      });
    add({
      id: 'history',
      group: 'Changes',
      title: 'Version history',
      icon: 'history',
      keywords: 'versions restore undo',
      run: () => openHistory(app),
    });
  }

  if (online())
    add({
      id: 'live',
      group: 'Mode',
      title: mode.on ? 'Switch to Demo' : 'Switch Live on',
      icon: mode.on ? 'wifiOff' : 'wifi',
      keywords: 'live demo model toggle mode',
      run: () => setLive(!mode.on),
    });

  if (app && ready) {
    add({ id: 'share', group: 'Share', title: 'Share by link', icon: 'share', keywords: 'send link copy', run: () => openShare(app) });
    add({
      id: 'export',
      group: 'Share',
      title: 'Export build pack',
      icon: 'arrowExport',
      keywords: 'download save file pack',
      run: () => openDialog('pack', { app: app.id }),
    });
  }

  add({
    id: 'agents',
    group: 'Panels',
    title: 'Show or hide the agents at work',
    icon: 'team',
    keys: 't',
    keywords: 'activity panel team who working',
    run: toggleAgentsPanel,
  });
  if (app)
    add({
      id: 'chat',
      group: 'Panels',
      title: chatShown() ? 'Close the chat' : 'Open the chat',
      icon: 'chat',
      keys: 'c',
      keywords: 'ask builders change',
      run: () => setChat(!chatShown()),
    });
  add({
    id: 'debug',
    group: 'Panels',
    title: S.settings.debug ? 'Close the debug drawer' : 'Open the debug drawer',
    icon: 'bug',
    keywords: 'debug events tool calls',
    run: () => {
      S.settings.debug = !S.settings.debug;
      commit();
    },
  });

  const themes: [Settings['theme'], string][] = [
    ['light', 'Use the light theme'],
    ['dark', 'Use the dark theme'],
    ['system', 'Follow the system theme'],
  ];
  for (const [t, title] of themes)
    if (S.settings.theme !== t)
      add({
        id: 'theme-' + t,
        group: 'Theme',
        title,
        icon: t === 'dark' ? 'dark' : t === 'light' ? 'lightbulb' : 'color',
        keywords: 'theme colour color appearance',
        run: () => setTheme(t),
      });

  add({
    id: 'settings',
    group: 'Help',
    title: 'Settings',
    icon: 'settings',
    keywords: 'preferences options',
    run: () => openDialog('settings'),
  });
  add({ id: 'keys', group: 'Help', title: 'Keyboard shortcuts', icon: 'keyboard', keys: '?', keywords: 'keys help', run: openShortcuts });
  add({ id: 'guide', group: 'Help', title: 'Feature guide', icon: 'bookOpen', keywords: 'help docs', run: () => openDialog('guide') });
  add({ id: 'tour', group: 'Help', title: 'Take the guided tour', icon: 'compass', keywords: 'help walkthrough', run: startTour });
  return out;
}

/** The shortcuts the "?" dialog lists. Single keys can be switched off in Settings (WCAG 2.1.4). */
export const SHORTCUTS: { keys: string; text: string; single: boolean }[] = [
  { keys: 'mod+k', text: 'Open the command palette', single: false },
  { keys: 'mod+z', text: 'Undo the last change to the app', single: false },
  { keys: 'mod+shift+z', text: 'Redo it', single: false },
  { keys: '?', text: 'Show these shortcuts', single: true },
  { keys: 'g h', text: 'Go home', single: true },
  { keys: 'g b', text: 'Go to the Build view', single: true },
  { keys: 'g a', text: 'Go to the App view', single: true },
  { keys: 'g r', text: 'Go to the Release view', single: true },
  { keys: 'g d', text: 'Go to the Details view', single: true },
  { keys: 'c', text: 'Open or close the chat', single: true },
  { keys: 't', text: 'Show or hide the agents at work', single: true },
];

export const singleKeysOn = () => S.settings.keys !== false;
export function setSingleKeys(v: boolean) {
  S.settings.keys = v;
  commit();
}

/** True while focus is somewhere that takes typing, so single keys must reach it. */
function typing(t: EventTarget | null) {
  const el = t instanceof Element ? t : null;
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]');
}

/** Shortcuts only work in the workspace itself: not on the welcome pages, a shared app opened alone, or in the tour. */
const inWorkspace = () => U.boot === 'ready' && S.onboarded && !!S.session && !!me() && !U.solo && !U.tour;

let pending: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const clearPending = () => {
  pending = null;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
};

/** Runs the shortcut for one key press. Returns true when it used the key. Exported for the browser checks. */
export function handleKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || !inWorkspace()) return false;
  const name = keyName(e);
  if (!name) return false;
  if (name === 'mod+k') {
    if (U.dialog && U.dialog.type === 'palette') closeDialog();
    else if (!U.dialog) openPalette();
    else return false;
    return true;
  }
  if (U.dialog || !singleKeysOn() || typing(e.target)) {
    clearPending();
    return false;
  }
  const app = currentApp();
  if (pending === 'g') {
    clearPending();
    const view = { b: 'build', a: 'app', r: 'release', d: 'details' }[name.toLowerCase()];
    if (name.toLowerCase() === 'h') openTab(null);
    else if (view && app) goView(view);
    else return false;
    return true;
  }
  if (name === 'g') {
    pending = 'g';
    pendingTimer = setTimeout(clearPending, 1500);
    return true;
  }
  if (name === '?') openShortcuts();
  else if (name === 't') toggleAgentsPanel();
  else if (name === 'c' && app) setChat(!chatShown());
  else return false;
  return true;
}

let installed = false;
/** Listens for shortcuts on the whole page. Call once, after boot. */
export function installShortcuts() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', (e) => {
    if (handleKey(e)) e.preventDefault();
  });
}
