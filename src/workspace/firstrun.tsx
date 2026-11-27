import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AppTable, AppUser, Screen } from '@/shared/types/app';
import type { AppRecord, Dict, Pane } from '@/shared/types/workspace';
import { S, cx, notify, saveSoon } from './core';
import { sqlPeek } from './db';
import { Btn, Empty, Icon } from './ui';
import {
  emptyDash,
  emptyList,
  guideFor,
  hasExamples,
  isDone,
  type FirstAction,
  type Guide,
  type Progress,
  type TourStop,
  type TourTarget,
} from './onboarding';

/* ===== Turnkey · first use of a built app: the welcome, the tour, the checklist and the empty screens =====
   The words come from onboarding.ts, which works them out from the app's definition. Here they are drawn, and what
   each person has seen is remembered per app and per person, next to their view choices (S.prefs). The welcome is
   shown once. The tour and the checklist are offered, never started for the person. */

/** What one person has seen of an app's first-use guide. */
interface Seen {
  /** the welcome was closed, or the person moved on to another screen */
  welcome?: boolean;
  /** the checklist: on show, folded to its title, or hidden */
  list?: 'open' | 'min' | 'off';
  /** the person opened a record */
  opened?: boolean;
  /** the screens the person opened, by id */
  screens?: Dict<boolean>;
}
// view choices are kept under app|person|screen id; no screen id starts with "~"
const keyOf = (app: AppRecord, user: AppUser) => app.id + '|' + user.id + '|~first';
const seenOf = (app: AppRecord, user: AppUser): Seen => ((S.prefs || {})[keyOf(app, user)] as Seen | undefined) || {};
function setSeen(app: AppRecord, user: AppUser, patch: Partial<Seen>) {
  const P = S.prefs || (S.prefs = {});
  P[keyOf(app, user)] = { ...seenOf(app, user), ...patch };
  saveSoon();
  notify();
}
/** The person looking at the app made it: it is one of their own apps, not a copy opened from a link. */
const isOwner = (app: AppRecord) => !app.shared && !!S.session && app.owner === S.session;
const guideOf = (app: AppRecord, user: AppUser): Guide => guideFor(app.def, user.role, { owner: isOwner(app), demo: hasExamples(app) });
/** "Dr. Ayesha Khan" is greeted as "Dr. Ayesha", "Hamza Qureshi" as "Hamza". */
const firstName = (name: string) => {
  const p = name.trim().split(/\s+/);
  return /^(dr|mr|mrs|ms|prof)\.?$/i.test(p[0]) && p[1] ? p[0] + ' ' + p[1] : p[0];
};

/* ---------- store actions ---------- */
/** Notes what the person has opened, so the checklist can tick itself. Opening a second screen closes the welcome. */
function noteUse(app: AppRecord, user: AppUser, screen: string | null, opened: boolean) {
  const s = seenOf(app, user),
    was = s.screens || {},
    patch: Partial<Seen> = {};
  if (opened && !s.opened) patch.opened = true;
  if (screen && !was[screen]) {
    patch.screens = { ...was, [screen]: true };
    if (!s.welcome && Object.keys(was).length) patch.welcome = true;
  }
  if (Object.keys(patch).length) setSeen(app, user, patch);
}
/** Opens the screen an action names and, when it adds a record, the form for it. */
function runAction(pane: Pane, a: FirstAction) {
  Object.assign(pane, {
    screen: a.screen || pane.screen,
    rec: null,
    sheet: null,
    form: a.create ? { table: a.create, id: null, vals: {}, errs: {} } : null,
  });
  notify();
}
function setStop(pane: Pane, stop: number | null) {
  pane.guide = stop == null ? null : { stop };
  notify();
}
/** Starts the tour on the screen that lists this person's records, with nothing open over it. */
function startTour(app: AppRecord, user: AppUser, pane: Pane) {
  const g = guideOf(app, user);
  if (!g.stops.length) return;
  Object.assign(pane, { screen: g.home || pane.screen, rec: null, form: null, sheet: null, guide: { stop: 0 } });
  setSeen(app, user, { welcome: true });
}
/** Forgets what this person has seen, so the welcome shows again. "Replay first run" in the builder uses it. */
export function replayFirstRun(app: AppRecord, user: AppUser, pane: Pane) {
  if (S.prefs) delete S.prefs[keyOf(app, user)];
  Object.assign(pane, { guide: null, rec: null, form: null, sheet: null });
  saveSoon();
  notify();
}
/** An entry of the person menu, and of the account sheet on a phone. */
export interface GuideEntry {
  label: string;
  icon: string;
  on: () => void;
}
/** "Show me around" and "Getting started" for the person menu: both stay there for good. */
export function guideMenu(app: AppRecord, user: AppUser, pane: Pane): GuideEntry[] {
  const g = guideOf(app, user),
    items: GuideEntry[] = [];
  if (g.stops.length) items.push({ label: 'Show me around', icon: 'compass', on: () => startTour(app, user, pane) });
  if (g.checklist.length)
    items.push({ label: 'Getting started', icon: 'tasks', on: () => setSeen(app, user, { list: 'open', welcome: true }) });
  return items;
}

function progressOf(app: AppRecord, user: AppUser, seen: Seen): Progress {
  const rows = sqlPeek(app.id, 'SELECT DISTINCT table_name, action FROM "activity" WHERE user_id = ?', [user.id]);
  return {
    opened: !!seen.opened,
    seen: seen.screens || {},
    did: new Set(rows.map((r) => String(r.table_name) + '|' + String(r.action))),
    demo: hasExamples(app),
  };
}

/* ---------- the welcome ---------- */
function Welcome({
  app,
  user,
  pane,
  guide,
  compact,
  builder,
  alone,
}: {
  app: AppRecord;
  user: AppUser;
  pane: Pane;
  guide: Guide;
  compact: boolean;
  builder: boolean;
  alone: boolean;
}) {
  const seen = seenOf(app, user);
  const close = () => setSeen(app, user, { welcome: true });
  const act = () => {
    if (guide.action) runAction(pane, guide.action);
    // pressing the main button is a yes to being guided: the checklist comes with it
    setSeen(app, user, { welcome: true, list: seen.list || 'open' });
  };
  return (
    <section className={cx('fr-card fr-welcome', compact && 'fr-sheet')} aria-label="Welcome">
      <div className="row between">
        <h2 className="t-sub1">
          {'Welcome, '}
          {firstName(user.name)}
        </h2>
        <Btn className="btn subtle icon sm" aria-label="Close the welcome" onClick={close}>
          <Icon n="dismiss" s="16" />
        </Btn>
      </div>
      <p>
        {alone ? (
          <>
            {'This is '}
            <strong>{app.name}</strong>
            {'. Here you can:'}
          </>
        ) : (
          <>
            {'You are here as '}
            <strong>{guide.roleName}</strong>
            {'. In '}
            {app.name}
            {' you can:'}
          </>
        )}
      </p>
      <ul className="fr-points">
        {guide.points.map((p) => (
          <li key={p}>
            <Icon n="check" s="16" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <div className="row wrap">
        {guide.action && (
          <Btn className="btn primary" onClick={act}>
            {guide.action.label}
          </Btn>
        )}
        {guide.stops.length > 0 && (
          <Btn className="btn" onClick={() => startTour(app, user, pane)}>
            Show me around (1 minute)
          </Btn>
        )}
        <Btn className="btn subtle" onClick={close}>
          Not now
        </Btn>
      </div>
      {hasExamples(app) && <p className="t-cap muted">The records here are demo data. They are marked &quot;Demo&quot;.</p>}
      {builder && !alone && isOwner(app) && (
        <p className="t-cap muted">
          Your people will see a welcome like this for their own job. Choose someone under &quot;Preview as&quot; to see theirs.
        </p>
      )}
    </section>
  );
}

/* ---------- the checklist ---------- */
function Checklist({ app, user, pane, guide }: { app: AppRecord; user: AppUser; pane: Pane; guide: Guide }) {
  const seen = seenOf(app, user),
    min = seen.list === 'min',
    prog = progressOf(app, user, seen),
    items = guide.checklist.map((it) => ({ it, ok: isDone(it, prog) })),
    done = items.filter((x) => x.ok).length,
    next = items.find((x) => !x.ok);
  return (
    <section className="fr-card fr-list" aria-label="Getting started">
      <div className="row between">
        <button className="fr-toggle" aria-expanded={!min} onClick={() => setSeen(app, user, { list: min ? 'open' : 'min' })}>
          <Icon n={min ? 'chevRight' : 'chevDown'} s="16" />
          <strong>Getting started</strong>
          <span className="badge b-outline">
            {done}
            {' of '}
            {items.length}
          </span>
        </button>
        <Btn
          className="btn subtle icon sm"
          aria-label="Hide the checklist"
          title="Hide the checklist. It stays under your name at the top."
          onClick={() => setSeen(app, user, { list: 'off' })}
        >
          <Icon n="dismiss" s="16" />
        </Btn>
      </div>
      {!min &&
        (next ? (
          <ul className="fr-items">
            {items.map(({ it, ok }) => (
              <li key={it.id} className={cx(ok && 'ok')}>
                <Icon n={ok ? 'checkCircle' : 'circle'} s="16" />
                <span className="col gap0 grow">
                  <span>
                    <span className="fr-sr">{ok ? 'Done: ' : 'To do: '}</span>
                    {it.text}
                  </span>
                  {it.note && <span className="t-cap muted">{it.note}</span>}
                </span>
                {it === next.it && it.go && (
                  <Btn className="btn sm" onClick={() => it.go && runAction(pane, it.go)}>
                    Do it
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="row wrap">
            <span className="grow">You&apos;re set up.</span>
            <Btn className="btn sm" onClick={() => setSeen(app, user, { list: 'off' })}>
              Done
            </Btn>
          </div>
        ))}
    </section>
  );
}

/* ---------- the tour ---------- */
/** Where each stop points, inside this app's own frame. The first match that is on the page is used. */
const TARGETS: Record<TourTarget, string[]> = {
  nav: ['.app-tabs', '.app-nav'],
  list: ['.vx-body'],
  add: ['.scr-head .fab'],
  status: ['.vx-body .badge:not(.b-outline)', '.vx-body .kb-head', '.vx-body'],
};
interface Spot {
  /** the frame's size */
  W: number;
  H: number;
  /** the part being explained, measured from the frame's corner; null when it is not on the page */
  at: { x: number; y: number; w: number; h: number } | null;
}
function measure(layer: HTMLElement | null, stop: TourStop, scroll: boolean): Spot | null {
  const root = layer ? layer.closest('.app') : null;
  if (!root) return null;
  const el = TARGETS[stop.target].map((sel) => root.querySelector(sel)).find((x) => !!x) || null,
    box = root.getBoundingClientRect();
  let r = el ? el.getBoundingClientRect() : null;
  // bring the part into view only when none of it shows: a long list that starts on the page stays where it is
  if (el && r && scroll && (r.bottom < box.top + 48 || r.top > box.bottom - 48)) {
    el.scrollIntoView({ block: 'center' });
    r = el.getBoundingClientRect();
  }
  return {
    W: Math.round(box.width),
    H: Math.round(box.height),
    at:
      r && r.width > 2 && r.height > 2
        ? { x: Math.round(r.left - box.left), y: Math.round(r.top - box.top), w: Math.round(r.width), h: Math.round(r.height) }
        : null,
  };
}
const sameSpot = (a: Spot | null, b: Spot | null) => JSON.stringify(a) === JSON.stringify(b);
/** One bubble at a time, beside the part it explains. Arrow keys move, Escape skips. */
function AppTour({ app, user, pane, guide }: { app: AppRecord; user: AppUser; pane: Pane; guide: Guide }) {
  const i = pane.guide ? pane.guide.stop : 0,
    stop = guide.stops[i],
    layer = useRef<HTMLDivElement>(null),
    spot = useState<Spot | null>(null);
  useLayoutEffect(() => {
    if (!stop) return undefined;
    let first = true;
    const look = () => {
      const now = measure(layer.current, stop, first);
      first = false;
      spot[1]((old) => (sameSpot(old, now) ? old : now));
    };
    const a = setTimeout(look, 60),
      iv = setInterval(look, 350);
    window.addEventListener('resize', look);
    return () => {
      clearTimeout(a);
      clearInterval(iv);
      window.removeEventListener('resize', look);
    };
  }, [i, stop]); // eslint-disable-line react-hooks/exhaustive-deps -- measured again for each stop; the setter never changes
  if (!stop) return null;
  const end = (finished: boolean) => {
    // back to the top of the page, where the checklist is
    const main = layer.current ? layer.current.closest('.app')?.querySelector('.app-main') : null;
    if (main) main.scrollTop = 0;
    setStop(pane, null);
    // finishing the tour is a yes to being guided: the checklist follows unless the person hid it
    if (finished && !seenOf(app, user).list && guide.checklist.length) setSeen(app, user, { list: 'open' });
  };
  const go = (d: number) => {
    if (i + d < 0) return;
    if (i + d >= guide.stops.length) return end(true);
    setStop(pane, i + d);
  };
  const s = spot[0],
    at = s ? s.at : null,
    W = s ? s.W : 360,
    H = s ? s.H : 480,
    pw = Math.min(320, W - 24);
  let pos: { left: number; top?: number; bottom?: number } = { left: Math.max(12, (W - pw) / 2), top: Math.max(24, H / 2 - 100) };
  if (at) {
    const left = Math.min(Math.max(12, at.x + at.w / 2 - pw / 2), W - pw - 12);
    if (H - (at.y + at.h) > 200) pos = { left, top: at.y + at.h + 12 };
    else if (at.y > 200) pos = { left, bottom: H - at.y + 12 };
    else pos = { left, bottom: 16 };
  }
  const px = (n: number | undefined) => (n == null ? undefined : Math.round(n) + 'px');
  return (
    <div
      className="fr-tour"
      ref={layer}
      onKeyDown={(e) => {
        if (e.key === 'Escape') end(false);
        else if (e.key === 'ArrowRight') go(1);
        else if (e.key === 'ArrowLeft') go(-1);
      }}
    >
      {at ? (
        <div className="fr-hole" style={{ left: px(at.x - 4), top: px(at.y - 4), width: px(at.w + 8), height: px(at.h + 8) }} />
      ) : (
        <div className="fr-dim" />
      )}
      <div
        className="fr-pop"
        role="dialog"
        aria-label={stop.title}
        style={{ left: px(pos.left), top: px(pos.top), bottom: px(pos.bottom), width: px(pw) }}
        tabIndex={-1}
        ref={(el) => {
          // move focus to each new bubble, so the keyboard and a screen reader follow the tour
          if (el && el.dataset.i !== String(i)) {
            el.dataset.i = String(i);
            el.focus({ preventScroll: true });
          }
        }}
      >
        <div className="t-cap muted">
          {'Stop '}
          {i + 1}
          {' of '}
          {guide.stops.length}
        </div>
        <h3 className="t-sub2">{stop.title}</h3>
        <p>{stop.text}</p>
        <div className="row between">
          <Btn className="btn subtle sm" onClick={() => end(false)}>
            Skip
          </Btn>
          <div className="row">
            {i > 0 && (
              <Btn className="btn sm" onClick={() => go(-1)}>
                Back
              </Btn>
            )}
            <Btn className="btn primary sm" onClick={() => go(1)}>
              {i === guide.stops.length - 1 ? 'Done' : 'Next'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- what the app's page draws ---------- */
/**
 * The first-use guide of the signed-in person, drawn above their screen: the welcome the first time, the checklist
 * once they asked for it, and the tour while it runs. `quiet` is set while the builder plays its walkthrough, which
 * signs in as one person after another and must not be greeted.
 */
export function FirstRun({
  app,
  user,
  pane,
  scr,
  compact,
  builder,
  alone,
  quiet,
}: {
  app: AppRecord;
  user: AppUser;
  pane: Pane;
  scr: Screen | undefined;
  compact: boolean;
  builder: boolean;
  alone: boolean;
  quiet: boolean;
}) {
  const screen = scr ? scr.id : null,
    opened = !!pane.rec;
  // before the browser paints, so a welcome that the person has moved on from is never drawn on the next screen
  useLayoutEffect(() => {
    if (!quiet) noteUse(app, user, screen, opened);
  }, [app, user, screen, opened, quiet]);
  if (quiet) return null;
  const seen = seenOf(app, user),
    guide = guideOf(app, user);
  // while the tour runs, the page under it stays as it is
  if (pane.guide) return null;
  if (!seen.welcome && guide.points.length > 0)
    return <Welcome app={app} user={user} pane={pane} guide={guide} compact={compact} builder={builder} alone={alone} />;
  if ((seen.list === 'open' || seen.list === 'min') && guide.checklist.length > 0)
    return <Checklist app={app} user={user} pane={pane} guide={guide} />;
  return null;
}

/** The running tour, drawn over the whole app frame. */
export function FirstTour({ app, user, pane }: { app: AppRecord; user: AppUser; pane: Pane }) {
  return pane.guide ? <AppTour app={app} user={user} pane={pane} guide={guideOf(app, user)} /> : null;
}

/* ---------- empty screens ---------- */
/**
 * A list with nothing in it says why, by what this person may do: an Add button for someone who may add, who adds
 * them for someone who may not, and "Clear filters" when the search and filters are what hide the records.
 * `children` is room for one more, quieter button (the owner's "Add demo data").
 */
export function EmptyList({
  app,
  user,
  t,
  total,
  onAdd,
  onClear,
  children,
}: {
  app: AppRecord;
  user: AppUser;
  t: AppTable;
  /** records this person may see before the search and filters */
  total: number;
  onAdd: () => void;
  onClear: () => void;
  children?: ReactNode;
}) {
  const e = emptyList(app.def, t, user.role, total);
  return (
    <Empty icon={e.icon} title={e.title} text={e.text}>
      {(e.button || children) && (
        <div className="row wrap">
          {e.button && (
            <Btn className={cx('btn', e.button === 'add' && 'primary')} onClick={e.button === 'add' ? onAdd : onClear}>
              {e.button === 'add' && <Icon n="add" s="16" />}
              {e.label}
            </Btn>
          )}
          {children}
        </div>
      )}
    </Empty>
  );
}
/** A dashboard before the first record: what will be here, and the way to add the first one if this person may. */
export function EmptyDash({ app, user, t, onAdd }: { app: AppRecord; user: AppUser; t: AppTable; onAdd: () => void }) {
  const e = emptyDash(app.def, t, user.role);
  return (
    <Empty icon={e.icon} title={e.title} text={e.text}>
      {e.button && (
        <Btn className="btn primary" onClick={onAdd}>
          <Icon n="add" s="16" />
          {e.label}
        </Btn>
      )}
    </Empty>
  );
}
