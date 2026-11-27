/* The Release tab, the release card in chat, and the install and go-back dialogs. Split from release.tsx so it loads the first
   time it is drawn (see later.tsx); the logic it uses stays in release.tsx. */
import { Suspense, lazy, useState, useSyncExternalStore } from 'react';
import type { AppRecord, ChatMessage, Dict, Release, StartWith, ViewState } from '@/shared/types/workspace';
import {
  NARROW,
  S,
  U,
  ago,
  arr,
  cap,
  chatShown,
  closeDialog,
  commit,
  cx,
  emit,
  errText,
  label,
  notify,
  openDialog,
  saveFile,
  setChat,
  snake,
  toast,
} from './core';
import { testStats } from './tests';
import { RUNS } from './line';
import { Btn, Card, Dialog, Empty, Field, Icon, MBar, Proto, Seg, Spinner, Textarea } from './ui';
import { framed, openShare, openShared, settingsLists, startWith } from './share';
import { appBusy } from './history';
import { verNext } from './record-steps';
import { canPromptInstall, installHint, onInstallPrompt, promptInstall } from '@/platform/pwa/prompt';
import {
  LOGO_SHAPES,
  LOGO_FILLS,
  LOGO_MARKS,
  normLogo,
  logoOf,
  AppLogo,
  logoUrl,
  relList,
  relOf,
  isDirty,
  REL_KIND,
  logChange,
  draftLog,
  suggestKind,
  draftNotes,
  aloneOffered,
  releaseBlock,
  releaseApp,
  recordCounts,
  recordTotal,
  undoneBy,
  goBackBlock,
  goBackTo,
  canBringBack,
  bringBack,
  AWAY_KEPT,
  verText,
} from './release';

export function GoBackDialog({ p }: { p: { app: string; v: string } }) {
  const [why, setWhy] = useState(''),
    [busy, setBusy] = useState(false);
  const app = S.apps[p.app],
    rel = app ? relList(app).find((r) => r.v === p.v) : null,
    live = app ? relOf(app) : null;
  if (!app || !rel || !live) return null;
  const same = rel === live,
    undone = undoneBy(app, rel),
    counts = recordCounts(app).filter((t) => t.n),
    total = counts.reduce((n, t) => n + t.n, 0),
    next = verNext(live.v, 'fix');
  const go = async () => {
    setBusy(true);
    await goBackTo(app, rel, why);
    closeDialog();
  };
  return (
    <Dialog
      title={same ? 'Drop the draft changes?' : 'Go back to version ' + rel.v + '?'}
      onClose={closeDialog}
      cls="goback"
      foot={
        <>
          <Btn className="btn" onClick={closeDialog}>
            Cancel
          </Btn>
          <Btn className="btn primary" id="goback-go" data-autofocus disabled={busy} onClick={go}>
            {busy ? <Spinner /> : <Icon n="undo" s="16" />}
            {same ? 'Drop the draft changes' : 'Go back to ' + rel.v}
          </Btn>
        </>
      }
    >
      <div className="col gap12">
        <div className="col gap4">
          <strong>What comes back</strong>
          <span>
            {'The app as it was in version '}
            {rel.v}
            {', released '}
            {new Date(rel.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            {': its lists, rules, views and pages.'}
          </span>
        </div>
        {undone.length > 0 && (
          <div className="col gap4">
            <strong>What goes away for now</strong>
            <ul className="rel-notes" id="goback-undone">
              {undone.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <MBar tone="success">
          <strong>Your records: nothing is deleted.</strong>
          {total
            ? ' All ' + total + ' stay (' + counts.map((t) => t.n + ' ' + t.label.toLowerCase()).join(', ') + ').'
            : ' There are no records in the app yet.'}
          {' Values in a field that version '}
          {rel.v}
          {' does not have are put away for ' + AWAY_KEPT + ' and come back when that field does.'}
        </MBar>
        {!same && (
          <>
            <p className="muted">
              {'It goes out at once as version '}
              {next}
              {', the same as '}
              {rel.v}
              {'. People only ever move to a higher number, so an older one would reach nobody.'}
            </p>
            <Field id="goback-why" label="What went wrong? (optional)" hint="Kept with what was taken back, to help the fix.">
              <Textarea
                native
                className="textarea"
                id="goback-why"
                rows={2}
                value={why}
                onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)}
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
export function ReleaseView({ app }: { app: AppRecord }) {
  const rel = relOf(app),
    dirty = isDirty(app),
    block = releaseBlock(app),
    st = testStats(app),
    R = relForm(app.id);
  const kind = rel ? R.kind || suggestKind(app) : 'first',
    v = rel ? verNext(rel.v, kind) : '1.0',
    text = R.text != null ? R.text : draftNotes(app).join('\n'),
    can = !block && (!rel || dirty),
    // a real launch starts empty; a later version starts new people the way the one before it did
    start: StartWith = R.start || (rel ? startWith(rel.start) : 'empty'),
    waiting = rel ? draftLog(app).length : 0,
    taken = app.takenBack || null;
  const go = async () => {
    setRelForm(app.id, { busy: true });
    const r = await releaseApp(
      app,
      kind,
      text
        .split('\n')
        .map((x) => x.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean),
      { start },
    );
    setRelForm(app.id, r ? { busy: false, text: null, kind: null, start: null } : { busy: false });
  };
  const kinds = [
    {
      id: 'fix',
      label: 'Fixes · ' + (rel ? verNext(rel.v, 'fix') : ''),
      title: 'Bug fixes and small corrections',
    },
    {
      id: 'feature',
      label: 'New features · ' + (rel ? verNext(rel.v, 'feature') : ''),
      title: 'New fields, pages, views or rules',
    },
    {
      id: 'major',
      label: 'Big change · ' + (rel ? verNext(rel.v, 'major') : ''),
      title: 'The app works differently now',
    },
  ];
  if (!app.def.screens.length)
    return (
      <div className="release scroll">
        <div className="release-in">
          <Journey app={app} />
          <Empty
            icon="rocket"
            title="Nothing to release yet"
            text="When the build has finished and its tests pass, you release version 1.0 from here."
          />
        </div>
      </div>
    );
  return (
    <div className="release scroll" data-tour="release">
      <div className="release-in">
        <Journey app={app} />
        <Card className="card rel-now">
          <AppLogo app={app} size={72} />
          <div className="col gap4 grow">
            <span className="row wrap gap8">
              <h2 className="t-sub1">{app.name}</h2>
              {rel ? (
                <span className={'badge ' + (dirty ? 'b-warning' : 'b-success')} id="rel-state">
                  {dirty ? 'Version ' + rel.v + ' is out · draft has changes' : 'Version ' + rel.v + ' · up to date'}
                </span>
              ) : (
                <span className="badge b-outline" id="rel-state">
                  Draft · not released yet
                </span>
              )}
            </span>
            <dl className="rel-two">
              <div>
                <dt>Live</dt>
                <dd id="rel-live">
                  {rel
                    ? 'Version ' +
                      rel.v +
                      ', released ' +
                      ago(rel.at) +
                      (rel.by ? ' by ' + rel.by : '') +
                      (rel.back ? ', the same as ' + rel.back : '') +
                      '. This is what people with the link or the installed app have.'
                    : 'Nothing yet. Releasing makes this the version people get when you share or install the app.'}
                </dd>
              </div>
              <div>
                <dt>Draft</dt>
                <dd id="rel-draft">
                  {!rel
                    ? 'The app as you built it. Only you can see it.'
                    : dirty
                      ? (waiting ? waiting + ' change' + (waiting === 1 ? '' : 's') + ' waiting' : 'Changes waiting') +
                        '. Only you can see ' +
                        (waiting === 1 ? 'it' : 'them') +
                        ' until you release.'
                      : 'The same as the live version. Any change you ask for goes here first, and people get it when you release.'}
                </dd>
              </div>
            </dl>
            <span className="row wrap gap8 t-cap">
              {st ? (
                <span className={cx('ck', st.fresh && st.failed ? 'bad' : 'ok')}>
                  <Icon n={st.fresh && st.failed ? 'warning' : 'checkCircle'} s="16" />
                  {st.fresh ? st.passed + ' of ' + st.total + ' tests pass' : st.total + ' tests run again before a release'}
                </span>
              ) : null}
              <Btn
                className="btn subtle sm"
                onClick={() => {
                  U.view[app.id] = 'tests';
                  notify();
                }}
              >
                Open the tests
              </Btn>
            </span>
          </div>
        </Card>
        {rel && (
          <Suspense fallback={null}>
            <Card className="card rel-improve">
              <ImproveBox app={app} />
            </Card>
          </Suspense>
        )}
        {(!rel || dirty) && (
          <Card className="card rel-form">
            <h3 className="widget-h">{rel ? 'Release the draft as version ' + v : 'Before you release'}</h3>
            {!rel && (
              <ul className="plain ticks" id="rel-ready">
                <li className={st && st.fresh && st.failed ? 'bad' : undefined}>
                  <Icon n={st && st.fresh && st.failed ? 'warning' : 'checkCircle'} s="16" />
                  <span>
                    {st && st.fresh
                      ? st.failed
                        ? st.failed + ' of ' + st.total + ' checks fail. Version 1.0 goes out only when every check passes.'
                        : 'Every check passes: ' + st.passed + ' of ' + st.total + '.'
                      : 'Every check runs once more when you release.'}
                  </span>
                </li>
              </ul>
            )}
            {rel && aloneOffered(app) && (
              <Suspense fallback={null}>
                <WaitingList app={app} />
              </Suspense>
            )}
            <StartChoice app={app} value={start} first={!rel} onChange={(x) => setRelForm(app.id, { start: x })} />
            {rel && (
              <Field
                id="rel-kind"
                label="What kind of release is it?"
                hint="The agents suggest one from what changed. The number follows your choice."
              >
                <Seg
                  label="Kind of release"
                  items={kinds}
                  value={kind}
                  onChange={(k) => {
                    setRelForm(app.id, { kind: k });
                  }}
                />
              </Field>
            )}
            <Field
              id="rel-notes"
              label={rel ? 'What is new' : 'First release, becomes version 1.0'}
              hint={
                rel
                  ? 'Written from the ' +
                    draftLog(app).length +
                    ' change' +
                    (draftLog(app).length === 1 ? '' : 's') +
                    ' since version ' +
                    rel.v +
                    '. One line each. Edit them freely: people see these when they update.'
                  : 'One line each. People see these in About this app. Turnkey chooses the number: you do not have to.'
              }
            >
              <Textarea
                native
                className="textarea"
                id="rel-notes"
                rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
                value={text}
                onInput={(e) => {
                  setRelForm(app.id, { text: (e.target as HTMLTextAreaElement).value });
                }}
              />
            </Field>
            {block && (
              <MBar
                tone="warning"
                action={
                  /tests fail/.test(block) ? (
                    <Btn
                      className="btn sm"
                      onClick={() => {
                        U.view[app.id] = 'tests';
                        notify();
                      }}
                    >
                      Open the tests
                    </Btn>
                  ) : null
                }
              >
                {block}
              </MBar>
            )}
            <div className="row wrap">
              <Btn className="btn primary" id="rel-go" disabled={!can || R.busy} onClick={go}>
                {R.busy ? <Spinner /> : <Icon n="rocket" s="16" />}
                {'Release version '}
                {v}
              </Btn>
              <span className="t-cap muted">Every test runs once more first. If one fails, nothing is released.</span>
            </div>
          </Card>
        )}
        <Card className="card rel-share">
          <h3 className="widget-h">Share and install</h3>
          <div className="rel-share-grid">
            <div className="col gap8">
              <p className="muted">
                {rel
                  ? 'The link opens ' +
                    app.name +
                    ' alone, with its own name, icon and sign-in. It carries version ' +
                    rel.v +
                    (dirty ? ', not the draft' : '') +
                    '.'
                  : 'A link carries a released version, so release version 1.0 first.'}
              </p>
              <div className="row wrap">
                <Btn className="btn primary" id="rel-share" disabled={!rel} onClick={() => openShare(app)}>
                  <Icon n="share" s="16" />
                  Share by link
                </Btn>
                <Btn className="btn" disabled={!rel || !rel.pack} onClick={() => rel && openVersion(app, rel)}>
                  <Icon n="eye" s="16" />
                  See what they get
                </Btn>
              </div>
              <ul className="plain ticks">
                <li>
                  <Icon n="install" s="16" />
                  <span>Whoever opens the link can install the app. It gets its own window, its own icon and its own data.</span>
                </li>
                <li>
                  <Icon n="sync" s="16" />
                  <span>
                    When you release a newer version the short link opens it at once, and an installed app offers the update the next time
                    it opens. Their records are kept.
                  </span>
                </li>
              </ul>
            </div>
            <div className="rel-icon">
              <div className="row gap12 rel-icons">
                <AppLogo app={app} size={96} />
                <AppLogo app={app} size={48} />
                <AppLogo app={app} size={24} />
              </div>
              <span className="t-cap muted" id="rel-logo-text">
                {logoOf(app).by === 'you' ? 'Your pick' : 'Designed by the UI agent'}
                {': '}
                {logoText(app).toLowerCase()}.
              </span>
              <div className="row wrap">
                <Btn className="btn sm" id="rel-logo-next" disabled={!!RUNS[app.id]} onClick={() => redesignLogo(app)}>
                  <Icon n="wand" s="16" />
                  Another design
                </Btn>
                <Btn className="btn sm" onClick={() => saveLogo(app)}>
                  <Icon n="download" s="16" />
                  Save the icon
                </Btn>
              </div>
            </div>
          </div>
        </Card>
        <Card className="card rel-hist">
          <h3 className="widget-h">
            Versions
            {relList(app).length ? (
              <>
                {' '}
                <span className="tab-n">{relList(app).length}</span>
              </>
            ) : null}
          </h3>
          {taken && (
            <MBar
              tone="info"
              action={
                canBringBack(app) ? (
                  <Btn className="btn sm" id="rel-bring-back" disabled={appBusy(app)} onClick={() => bringBack(app)}>
                    Put them back in the draft
                  </Btn>
                ) : null
              }
            >
              <span id="rel-taken">
                <strong>{'You went back from version ' + taken.from + ' to ' + taken.to + '.'}</strong>
                {' Taken out: ' + sentence(taken.items.map((x) => x.replace(/\.$/, '')).join('; '))}
                {taken.why ? ' What went wrong: ' + sentence(taken.why) : ''}
                {canBringBack(app)
                  ? ' Putting them back changes only the draft. People keep what they have until you release.'
                  : ' Ask for them again in the chat when you want them back.'}
              </span>
            </MBar>
          )}
          {relList(app).length ? (
            <ol className="rel-list">
              {relList(app).map((r, i) => (
                <li key={r.v} className="rel-item">
                  <div className="row wrap gap8">
                    <strong className="t-sub2">{r.v}</strong>
                    <span className={'badge ' + (i === 0 ? 'b-success' : 'b-outline')}>
                      {i === 0 ? 'Current' : REL_KIND[r.kind] || 'Release'}
                    </span>
                    {i === 0 && r.kind !== 'first' ? <span className="badge b-outline">{REL_KIND[r.kind]}</span> : null}
                    {r.back ? <span className="badge b-outline">{'Same as ' + r.back}</span> : null}
                    {r.left && r.left.length ? <span className="badge b-outline">On its own</span> : null}
                    <span className="t-cap muted grow" title={new Date(r.at).toLocaleString()}>
                      {new Date(r.at).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {r.by ? ' · ' + r.by : ''}
                      {' · '}
                      {r.tests.passed}
                      {' of '}
                      {r.tests.total}
                      {' tests passed · '}
                      {r.inside.tables}
                      {' tables, '}
                      {r.inside.pages}
                      {' pages'}
                    </span>
                    <Btn
                      className="btn subtle sm"
                      disabled={!r.pack}
                      title={r.pack ? 'Open this version on its own' : 'This snapshot was let go to save room'}
                      onClick={() => openVersion(app, r)}
                    >
                      Open
                    </Btn>
                    {(i > 0 || dirty) && (
                      <Btn
                        className="btn subtle sm"
                        disabled={!r.pack || !!RUNS[app.id]}
                        title={
                          r.pack
                            ? i > 0
                              ? 'Make this the live version again. No records are deleted.'
                              : 'Make the draft the same as this version again. No records are deleted.'
                            : 'This snapshot was let go to save room'
                        }
                        onClick={() => askGoBack(app, r)}
                      >
                        {i > 0 ? 'Go back to this' : 'Drop the draft changes'}
                      </Btn>
                    )}
                  </div>
                  <ul className="rel-notes">
                    {r.notes.map((n, k) => (
                      <li key={k}>{n}</li>
                    ))}
                  </ul>
                  {r.left && r.left.length ? (
                    <span className="t-cap muted">
                      {'Left waiting in the draft: ' + sentence(wordList(r.left.map((x) => x.replace(/\.$/, ''))))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No version yet. The first release is 1.0.</p>
          )}
        </Card>
        <Card className="card rel-export" id="rel-export">
          <h3 className="widget-h">Export the deliverable</h3>
          <p className="muted">
            One document made from the app as it is now{rel && dirty ? ' (the draft, not version ' + rel.v + ')' : ''}: the brief, tables,
            rules, screens, tests, which agent made what and the run timeline. Hand it to the team that builds the production version.
          </p>
          <div className="row wrap">
            <Btn className="btn primary" id="exp-md" onClick={() => runExport(app, 'exportMarkdown')}>
              <Icon n="download" s="16" />
              Document (.md)
            </Btn>
            <Btn className="btn" id="exp-pdf" onClick={() => runExport(app, 'exportPdf')}>
              <Icon n="download" s="16" />
              PDF (print)
            </Btn>
            <Btn className="btn" id="exp-html" onClick={() => runExport(app, 'exportPage')}>
              <Icon n="download" s="16" />
              Page (.html)
            </Btn>
            <Btn className="btn" id="exp-sqlite" onClick={() => runExport(app, 'exportSqlite')}>
              <Icon n="download" s="16" />
              Database (.sqlite)
            </Btn>
            <Btn className="btn" id="exp-zip" onClick={() => runExport(app, 'exportZip')}>
              <Icon n="download" s="16" />
              Everything (.zip)
            </Btn>
          </div>
          <span className="t-cap muted">
            PDF opens your browser&apos;s print dialog: choose Save as PDF. The zip holds the document, the page, the database and the
            app&apos;s definition.
          </span>
        </Card>
      </div>
    </div>
  );
}
export function ReleaseCard({ app, m }: { app: AppRecord; m: ChatMessage }) {
  const c = m.card || { type: 'released' };
  return (
    <div className="gcard ok">
      <div className="gc-h">
        <Icon n="rocket" s="16" />
        {'Version '}
        {String(c.v)}
        {' released'}
      </div>
      <ul className="plain flow-items">
        {arr(c.notes)
          .slice(0, 6)
          .map((n, i) => (
            <li key={i}>
              <Icon n="check" s="12" />
              <span>{n}</span>
            </li>
          ))}
      </ul>
      <div className="row wrap">
        <Btn className="btn primary sm" disabled={!relOf(app)} onClick={() => openShare(app)}>
          <Icon n="share" s="16" />
          Share by link
        </Btn>
        <Btn
          className="btn sm"
          onClick={() => {
            U.view[app.id] = 'release';
            if (NARROW() && chatShown()) setChat(false);
            notify();
          }}
        >
          Versions
        </Btn>
      </div>
    </div>
  );
}
export function InstallAppDialog({ p }: { p: { app: string } }) {
  const offered = useSyncExternalStore(onInstallPrompt, canPromptInstall, noOffer);
  const [asked, setAsked] = useState(false);
  const app = S.apps[p.app];
  if (!app) return null;
  const on = !!app.installed,
    ver = verText(app),
    inFrame = framed(),
    // the browser made an offer for this app's manifest: its own Install dialog does the work
    real = offered && !inFrame;
  const set = (v: boolean) => {
    markInstalled(app.id, v);
    closeDialog();
    toast(
      v
        ? app.name + ' is installed. It opens in its own window with its own icon.'
        : app.name +
            ' is no longer marked as installed here. To remove the app itself, use Uninstall in its own window menu. Its link still works.',
      v ? 'success' : 'info',
    );
  };
  const install = async () => {
    setAsked(true);
    const out = await promptInstall();
    if (out === 'accepted') set(true);
    else if (out === 'dismissed') closeDialog();
  };
  return (
    <Dialog
      title={on ? app.name + ' is installed' : 'Install ' + app.name}
      onClose={closeDialog}
      foot={
        on ? (
          <>
            <Btn className="btn" onClick={() => set(false)}>
              Uninstall
            </Btn>
            <Btn className="btn primary" data-autofocus onClick={closeDialog}>
              Done
            </Btn>
          </>
        ) : (
          <>
            <Btn className="btn" onClick={closeDialog}>
              Not now
            </Btn>
            {real ? (
              <Btn className="btn primary" data-autofocus id="inst-go" data-install="browser" onClick={install}>
                <Icon n="install" s="16" />
                Install
              </Btn>
            ) : (
              <Btn className="btn primary" data-autofocus id="inst-go" data-install={inFrame ? 'shown' : 'menu'} onClick={() => set(true)}>
                <Icon n="install" s="16" />
                {inFrame ? 'Install' : 'I have installed it'}
              </Btn>
            )}
          </>
        )
      }
    >
      <div className="col gap12">
        <div className="install-app">
          <AppLogo app={app} size={56} />
          <div className="col gap0">
            <strong className="t-sub2">{app.name}</strong>
            <span className="muted t-cap">
              {ver}
              {' · its own app, not Turnkey'}
            </span>
          </div>
        </div>
        <ul className="plain ticks">
          <li>
            <Icon n="window" s="16" />
            <span>Opens in its own window from the desktop, taskbar, dock or home screen, under this icon</span>
          </li>
          <li>
            <Icon n="checkCircle" s="16" />
            <span>
              <strong>Works offline:</strong>
              {' every page, the sign-in and your records, which stay on this device'}
            </span>
          </li>
          <li>
            <Icon n="sync" s="16" />
            <span>
              <strong>Updates:</strong>
              {' the app looks for a newer version when it opens, asks before it updates, and keeps your records'}
            </span>
          </li>
          {app.def.team ? (
            <li>
              <Icon n="cloudOff" s="16" />
              <span>
                <strong>Waits for internet:</strong>
                {" the app's own agents, when they run live"}
              </span>
            </li>
          ) : null}
        </ul>
        {on ? null : inFrame ? (
          <MBar tone="info">
            <Proto>Simulated here</Proto>
            {
              ' A page inside a frame cannot install anything, so this shows the flow. Open the link in its own browser tab and the browser offers Install for this app alone.'
            }
          </MBar>
        ) : real ? (
          <MBar tone="info">Your browser asks you to confirm. The app keeps this name and icon.</MBar>
        ) : (
          <MBar tone="info" cls="inst-hint">
            {asked ? 'The browser did not open its install dialog. ' : 'Your browser installs this app from its own menu. '}
            {installHint(navigator.userAgent)}
          </MBar>
        )}
      </div>
    </Dialog>
  );
}
const runExport = (app: AppRecord, name: ExportName) =>
  void import('./export').then(
    (m) => void m[name](app),
    (e: unknown) => toast('The export could not be made: ' + errText(e), 'danger'),
  );
// The box for saying what is wrong or missing loads the first time the Release page of a released app shows.
const ImproveBox = lazy(() => import('./improve').then((m) => ({ default: m.ImproveBox })));
// Releasing one change on its own loads when the draft holds more than one.
const WaitingList = lazy(() => import('./release-one').then((m) => ({ default: m.WaitingList })));
export const logoText = (app: AppRecord) => {
  const lg = logoOf(app);
  return (
    'A ' +
    label(lg.glyph).toLowerCase() +
    ' symbol on a ' +
    label(lg.accent).toLowerCase() +
    ' ' +
    LOGO_WORD[lg.fill] +
    ' ' +
    LOGO_WORD[lg.shape] +
    (lg.mark !== 'none' ? ', with ' + LOGO_WORD[lg.mark] : '')
  );
};
export async function saveLogo(app: AppRecord) {
  try {
    const b = await logoPng(app, 512);
    if (await saveFile(snake(app.name) + '-icon.png', b, 'image/png')) toast('Icon saved as a 512 pixel PNG.', 'success');
  } catch (e) {
    toast(errText(e), 'warning');
  }
}
export function redesignLogo(app: AppRecord) {
  // "another design": the next shape, fill and mark. In the hosted build the UI agent is asked again.
  const th = app.def.theme,
    lg = Object.assign({}, th.logo || normLogo(null, th, app.name)),
    n = (lg.turn || 0) + 1;
  lg.shape = LOGO_SHAPES[(LOGO_SHAPES.indexOf(lg.shape) + 1) % 5];
  lg.fill = LOGO_FILLS[(LOGO_FILLS.indexOf(lg.fill) + (n % 2 ? 1 : 2)) % 4];
  lg.mark = LOGO_MARKS[(LOGO_MARKS.indexOf(lg.mark) + 1) % 4];
  lg.turn = n;
  lg.by = 'you';
  th.logo = lg;
  app.rev++;
  app.updated = Date.now();
  logChange(app, 'Redesign the app icon', 'screens');
  emit('STATE_DELTA', {
    app: app.id,
    source: 'user',
    delta: [
      {
        op: 'replace',
        path: '/theme/logo',
        value: {
          shape: lg.shape,
          fill: lg.fill,
          mark: lg.mark,
        },
      },
    ],
  });
  commit();
}
export async function openVersion(app: AppRecord, rel: Release) {
  if (!rel.pack) return toast('The snapshot of version ' + rel.v + ' was let go to save room. Its notes are still here.', 'info');
  try {
    await openShared(rel.pack, {
      preview: true,
      back: app.id,
    });
  } catch (e) {
    toast(errText(e), 'danger');
  }
}
export function askGoBack(app: AppRecord, rel: Release) {
  const why = goBackBlock(app, rel);
  if (why) return toast(why, 'warning');
  openDialog('goback', { app: app.id, v: rel.v });
}

/* ---------- the Release view ---------- */
export function Journey({ app }: { app: AppRecord }) {
  // where this app stands, in four plain steps
  const st = testStats(app),
    ready = app.status === 'ready',
    rel = relOf(app),
    dirty = isDirty(app),
    busy = !!RUNS[app.id],
    go = (v: string) => () => {
      U.view[app.id] = v;
      notify();
    };
  const steps: { id: string; n: string; done: boolean; now?: boolean; bad?: boolean; sub: string; go?: () => void }[] = [
    {
      id: 'build',
      n: 'Build',
      done: ready,
      now: busy,
      sub: busy ? 'The agents are working' : ready ? 'Built and checked' : cap(app.status),
      go: go('build'),
    },
    {
      id: 'tests',
      n: 'Test',
      done: ready && !!st && st.fresh && !st.failed,
      bad: !!st && st.fresh && st.failed > 0,
      sub: st ? (st.fresh ? st.passed + ' of ' + st.total + ' pass' : st.total + ' tests ready') : 'After the build',
      go: go('tests'),
    },
    {
      id: 'release',
      n: 'Release',
      done: !!rel && !dirty,
      sub: rel ? (dirty ? 'Version ' + rel.v + ' is out, the draft is newer' : 'Version ' + rel.v) : 'Not released yet',
    },
    {
      id: 'share',
      n: 'Share and install',
      done: false,
      sub: rel ? 'One link, the app alone' : 'After the first release',
    },
  ];
  return (
    <ol className="journey" aria-label="Where this app stands">
      {steps.map((s, i) => (
        <li key={s.id} className={cx('jstep', s.done && 'done', s.bad && 'bad', s.now && 'now')}>
          <span className="jdot">
            {s.now ? <Spinner /> : s.done ? <Icon n="check" s="16" /> : s.bad ? <Icon n="warning" s="16" /> : i + 1}
          </span>
          {s.go ? (
            <button className="jtext" onClick={s.go}>
              <strong>{s.n}</strong>
              <span className="t-cap muted">{s.sub}</span>
            </button>
          ) : (
            <span className="jtext">
              <strong>{s.n}</strong>
              <span className="t-cap muted">{s.sub}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
function setRelForm(id: string, patch: Partial<RelForm>) {
  U.rel[id] = { ...relForm(id), ...patch };
  notify();
}
/** Ends a line the owner typed, or a list of them, with a full stop. */
const sentence = (x: string) => (/[.!?]$/.test(x.trim()) ? x.trim() : x.trim() + '.');
/** What a person who opens the app for the first time starts with. People who already have it keep their own records. */
function StartChoice({
  app,
  value,
  first,
  onChange,
}: {
  app: AppRecord;
  value: StartWith;
  first: boolean;
  onChange: (x: StartWith) => void;
}) {
  const [open, setOpen] = useState(false);
  const seedN = app.def.tables.reduce((n, t) => n + (((app.seed && app.seed.rows) || {})[t.name] || []).length, 0),
    total = recordTotal(app),
    keep = settingsLists(app, app.def.tables),
    kept = app.def.tables.filter((t) => keep.has(t.name)).map((t) => t.label.toLowerCase()),
    items: { id: StartWith; name: string; text: string; usual?: boolean }[] = [
      {
        id: 'empty',
        name: 'Empty',
        text: (kept.length ? 'Only your ' + wordList(kept) : 'No records') + '. Right for a real launch.',
        usual: true,
      },
      {
        id: 'demo',
        name: 'Demo data',
        text: 'The ' + seedN + ' made-up records the app was built with. Right for showing people how it works.',
      },
      {
        id: 'live',
        name: 'The records as they are now',
        text: total + ' record' + (total === 1 ? '' : 's') + ', with everything you added or changed while trying the app.',
      },
    ],
    now = items.find((x) => x.id === value) || items[0];
  if (!first && !open)
    return (
      <div className="row wrap gap8" id="rel-start">
        <span>
          {'New people start with: '}
          <strong>{now.name.toLowerCase()}</strong>
          {'. People who already have the app keep their own records.'}
        </span>
        <Btn className="btn subtle sm" id="rel-start-change" onClick={() => setOpen(true)}>
          Change
        </Btn>
      </div>
    );
  return (
    <div className="col gap8" id="rel-start">
      <strong className="t-sub2" id="rel-start-h">
        {first ? 'What should your people start with?' : 'What should new people start with?'}
      </strong>
      {!first && <span className="t-cap muted">People who already have the app keep their own records.</span>}
      <div className="choices three" role="group" aria-labelledby="rel-start-h">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={cx('choice', it.id === value && 'on')}
            aria-pressed={it.id === value}
            data-start={it.id}
            onClick={() => onChange(it.id)}
          >
            <span className="row wrap gap8">
              <strong>{it.name}</strong>
              {it.usual ? <span className="badge b-outline">Usual choice</span> : null}
            </span>
            <span className="t-cap muted">{it.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
const noOffer = () => false;
/** Marks an app as installed on its own in this browser, or not. */
function markInstalled(id: string, v: boolean) {
  const a = S.apps[id];
  if (!a) return;
  if (v) a.installed = Date.now();
  else delete a.installed;
  commit();
}

// The exports (document, PDF, page, database, zip) load the first time one is asked for.
type ExportName = 'exportMarkdown' | 'exportPage' | 'exportPdf' | 'exportSqlite' | 'exportZip';
export const LOGO_WORD: Dict<string> = {
  squircle: 'rounded square',
  circle: 'circle',
  hexagon: 'hexagon',
  shield: 'shield',
  tile: 'tile',
  gradient: 'gradient',
  solid: 'solid colour',
  split: 'two-tone split',
  ring: 'ring',
  none: '',
  dot: 'a dot',
  spark: 'a spark',
  bar: 'an underline',
};
export function logoPng(app: AppRecord, size?: number) {
  // a real PNG, drawn from the same data
  return new Promise<Blob>((res, rej) => {
    const img = new Image(),
      s = size || 512;
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = s;
        cv.height = s;
        (cv.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, s, s);
        cv.toBlob((b) => (b ? res(b) : rej(new Error('The icon could not be drawn.'))), 'image/png');
      } catch (e) {
        rej(e);
      }
    };
    img.onerror = () => rej(new Error('The icon could not be drawn.'));
    img.src = logoUrl(app, s);
  });
}
const relForm = (id: string): RelForm => U.rel[id] || { kind: null, text: null, busy: false };
const wordList = (a: string[]) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
/** The Release view's form, kept in the view state so it outlives a re-render. */
type RelForm = ViewState['rel'][string];
