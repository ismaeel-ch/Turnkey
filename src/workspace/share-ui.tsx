/* The share, open-link and about dialogs, and the shell of an app opened from a share link. Split from share.tsx so it loads the first
   time it is drawn (see later.tsx); the logic it uses stays in share.tsx. */
import type { FormEvent } from 'react';
import { useEffect } from 'react';
import type { BriefedDef } from '@/shared/types/app';
import type { AppRecord, Dict, ShareState, SoloView } from '@/shared/types/workspace';
import {
  S,
  U,
  arr,
  closeDialog,
  commit,
  copyText,
  errText,
  fmtBytes,
  me,
  notify,
  online,
  openDialog,
  saveFile,
  snake,
  str,
  toast,
} from './core';
import { b64, dbCount } from './db';
import { appUsers, deriveEndpoints, roleName } from './engine';
import { testStats } from './tests';
import { demoMenuItems } from './demo-data-ui';
import { Btn, Dialog, Field, Icon, Input, MBar, Seg, Select, Spinner, Textarea } from './ui';
import { AppPane } from './runtime';
import { soleUser } from './onboarding';
import type { SoloItem } from './mobile';
import {
  AppLogo,
  clearIdentity,
  draftNotes,
  installInputOf,
  isDirty,
  relOf,
  releaseApp,
  releaseBlock,
  setIdentity,
  verText,
} from './release';
import { safetyCopyOf } from './carry';
import { verCmp } from './record-steps';
import { appInstallLinks, holdInstallLinks, setInstallLinks } from '@/platform/pwa/app';
import { lastInstalledAt, onInstallPrompt } from '@/platform/pwa/prompt';
import { loadShortLink } from '@/platform/share-link';
import { unsqueeze, framed, shareLink, type Pack, settingsLists, readPack, openShared, exitSolo, keepShared, makeShare } from './share';

export function ShareDialog({ p }: { p: { app: string } }) {
  const app = S.apps[p.app],
    sh = U.share;
  if (!app || !sh) return null;
  const users = appUsers(app),
    link = sh.code ? shareLink(sh.code) : '',
    seedN = app.def.tables.reduce((n, t) => n + (((app.seed && app.seed.rows) || {})[t.name] || []).length, 0),
    liveN = app.def.tables.reduce((n, t) => n + Number(dbCount(app.id, t.name)), 0),
    kept = app.def.tables.filter((t) => settingsLists(app, app.def.tables).has(t.name)).map((t) => t.label.toLowerCase());
  const preview = async () => {
    try {
      closeDialog();
      await openShared(sh.code, {
        preview: true,
        back: app.id,
      });
    } catch (e) {
      toast(errText(e), 'danger');
    }
  };
  const rel = relOf(app),
    dirty = isDirty(app),
    block = releaseBlock(app),
    first = async () => {
      setShareBusy(true);
      notify();
      const r = await releaseApp(app, 'first', draftNotes(app));
      setShareBusy(false);
      if (r) makeShare();
      else notify();
    };
  if (!rel)
    return (
      <Dialog
        title={'Share ' + app.name}
        onClose={closeDialog}
        cls="share"
        foot={
          <>
            <Btn className="btn" onClick={closeDialog}>
              Not now
            </Btn>
            <Btn className="btn primary" id="sh-release" data-autofocus disabled={!!block || sh.rbusy} onClick={first}>
              {sh.rbusy ? <Spinner /> : <Icon n="rocket" s="16" />}Release version 1.0 and make the link
            </Btn>
          </>
        }
      >
        <div className="col gap12">
          <div className="install-app">
            <AppLogo app={app} size={48} />
            <div className="col gap0">
              <strong className="t-sub2">{app.name}</strong>
              <span className="muted t-cap">Draft · not released yet</span>
            </div>
          </div>
          <p>
            A link always carries a released version, so people never get a half-finished draft. Releasing runs every test once more and
            takes a moment.
          </p>
          {block && <MBar tone="warning">{block}</MBar>}
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title={'Share ' + app.name}
      onClose={closeDialog}
      cls="share"
      foot={
        <>
          <Btn className="btn" disabled={!sh.code} onClick={preview}>
            <Icon n="eye" s="16" />
            Preview what they see
          </Btn>
          <Btn className="btn primary" data-autofocus disabled={!sh.code} onClick={() => copyText(link, 'Link')}>
            <Icon n="copy" s="16" />
            Copy link
          </Btn>
        </>
      }
    >
      <div className="install-app">
        <AppLogo app={app} size={48} />
        <div className="col gap0 grow">
          <strong className="t-sub2">{app.name}</strong>
          <span className="muted t-cap" id="sh-ver">
            {'Version '}
            {rel.v}
            {dirty ? ' · your draft changes are not in this link' : ''}
          </span>
        </div>
        {dirty && (
          <Btn
            className="btn sm"
            onClick={() => {
              closeDialog();
              U.view[app.id] = 'release';
              notify();
            }}
          >
            Release the draft
          </Btn>
        )}
      </div>
      <p>
        {'Anyone with the link opens '}
        <strong>{app.name}</strong>
        {
          ' on its own: the app, its icon, its sign-in screen and its data. They can install it. They do not see Turnkey, the agents or your other apps.'
        }
      </p>
      <div className="share-grid">
        <Field
          id="sh-data"
          label="They start with"
          hint={
            sh.data === 'empty'
              ? (kept.length ? 'No records, only your ' + kept.join(', ') + '.' : 'No records at all.') + ' Right for a real launch.'
              : sh.data === 'live' && !dirty
                ? 'A copy of the ' + liveN + ' records as they are now. The activity history stays with you.'
                : 'The ' + seedN + ' made-up rows the List builder wrote, with dates that stay around today.'
          }
        >
          <Seg
            label="Which data the link carries"
            items={[
              {
                id: 'empty',
                label: 'Empty',
              },
              {
                id: 'demo',
                label: 'Demo data',
              },
              {
                id: 'live',
                label: 'Current records',
              },
            ]}
            value={dirty && sh.data === 'live' ? 'demo' : sh.data}
            onChange={(v) =>
              dirty && v === 'live'
                ? toast('Current records fit the draft, not version ' + rel.v + '. Release the draft to share them.', 'info')
                : setShare({ data: v as ShareState['data'] })
            }
          />
        </Field>
        {/* an app for one person has no sign-in screen, so there is nobody to choose */}
        {!soleUser(app, users) && (
          <Field id="sh-as" label="They open it as" hint="A person skips the sign-in screen. They can still switch.">
            <Select
              native
              className="select"
              id="sh-as"
              value={sh.as}
              onChange={(e) => setShare({ as: (e.target as HTMLSelectElement).value })}
            >
              <option value="">The sign-in screen</option>
              {users.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.name}
                  {' · '}
                  {roleName(app.def, u.role)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {(sh.short || sh.shortBusy) && (
        <Field id="sh-short" label="Short link" hint="Opens the newest version you share. Anyone with it can open the app.">
          <div className="row">
            <Input
              native
              className="input grow mono"
              id="sh-short"
              readOnly
              value={sh.shortBusy ? 'Saving the short link…' : sh.short}
              onFocus={(e) => e.target.select()}
            />
            <Btn
              className="btn icon"
              title="Copy the short link"
              aria-label="Copy the short link"
              disabled={!sh.short}
              onClick={() => copyText(sh.short || '', 'Short link')}
            >
              <Icon n="copy" />
            </Btn>
          </div>
        </Field>
      )}
      <Field
        id="sh-link"
        label={sh.short || sh.shortBusy ? 'Long link (holds the whole app, works without the server)' : 'Link'}
        error={sh.err || null}
        hint={
          sh.code
            ? fmtBytes(link.length) +
              ' · the app and ' +
              sh.rows +
              ' rows, compressed from ' +
              fmtBytes(sh.raw) +
              (sh.short || sh.shortBusy ? '' : ' · nothing is uploaded') +
              (sh.shortNote ? ' · ' + sh.shortNote : '')
            : 'Packing the app'
        }
      >
        <div className="row">
          <Input
            native
            className="input grow mono"
            id="sh-link"
            readOnly
            value={sh.busy ? 'Packing the app…' : link}
            onFocus={(e) => e.target.select()}
          />
          <Btn
            className="btn icon"
            title="Copy the link"
            aria-label="Copy the link"
            disabled={!sh.code}
            onClick={() => copyText(link, 'Link')}
          >
            <Icon n="copy" />
          </Btn>
        </div>
      </Field>
      <ul className="share-facts">
        <li>
          <Icon n="shield" s="16" />
          <span>
            Either link opens the app on its own. It is checked again in the browser that opens it, with the checks every agent&apos;s work
            must pass, and nothing in it runs as code.
          </span>
        </li>
        <li>
          <Icon n="people" s="16" />
          <span>
            Everyone who opens it works in their own copy, saved in their own browser. One database shared by everyone needs a small store
            on the server, which the free hosting plan does not keep.
          </span>
        </li>
        {framed() && (
          <li>
            <Icon n="info" s="16" />
            <span>
              This page is shown inside a frame, where a link cannot open a new page. Use Preview, or paste the link under Open a shared
              app.
            </span>
          </li>
        )}
      </ul>
    </Dialog>
  );
}
export function OpenLinkDialog({ p }: { p: OpenLinkProps }) {
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setOpenLink(p, { err: '', busy: true });
    notify();
    try {
      await openShared(p.text, {
        back: null,
      });
    } catch (er) {
      setOpenLink(p, { err: errText(er), busy: false });
      notify();
    }
  };
  return (
    <Dialog title="Open a shared app" onClose={closeDialog}>
      <form className="col gap12" onSubmit={go}>
        <p className="muted">Paste a Turnkey app link. The app opens on its own, with its own copy of the data in this browser.</p>
        <Field id="ol-text" label="Link" error={p.err || null}>
          <Textarea
            native
            className="textarea mono"
            id="ol-text"
            rows={4}
            data-autofocus
            placeholder="https://…#app=1.xxxxx"
            value={p.text || ''}
            onInput={(e) => {
              setOpenLink(p, { text: (e.target as HTMLTextAreaElement).value });
            }}
          />
        </Field>
        <div className="row end">
          <Btn type="button" className="btn" onClick={closeDialog}>
            Cancel
          </Btn>
          <Btn type="submit" className="btn primary" disabled={!!p.busy}>
            {p.busy ? <Spinner /> : <Icon n="open" s="16" />}Open the app
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
export function AboutAppDialog({ p }: { p: { app: string } }) {
  const app = S.apps[p.app];
  if (!app) return null;
  const def = app.def,
    st = testStats(app),
    rel = relOf(app),
    notes = app.shared ? arr<string>(app.shared.notes) : rel ? rel.notes : [],
    safe = app.shared ? safetyCopyOf(app.id) : null;
  return (
    <Dialog
      title={'About ' + app.name}
      onClose={closeDialog}
      foot={
        <Btn className="btn primary" data-autofocus onClick={closeDialog}>
          Close
        </Btn>
      }
    >
      <div className="install-app">
        <AppLogo app={app} size={48} />
        <div className="col gap0">
          <strong className="t-sub2">{app.name}</strong>
          <span className="muted t-cap" id="about-ver">
            {verText(app)}
            {app.installed ? ' · installed' : ''}
          </span>
        </div>
      </div>
      <p>{def.brief ? def.brief.summary : app.request}</p>
      {notes.length > 0 && (
        <div className="col gap4">
          <strong>What is new in this version</strong>
          <ul className="rel-notes">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="about-dl">
        <dt>Built with</dt>
        <dd>
          Turnkey. Agents wrote this app as definitions: a brief, tables, rules, views, pages and test cases. A fixed runtime runs them.
        </dd>
        <dt>Inside</dt>
        <dd>
          {def.tables.length}
          {' tables · '}
          {def.process ? deriveEndpoints(def as BriefedDef).length : 0}
          {' endpoints · '}
          {def.screens.length}
          {' pages'}
          {st ? ' · ' + st.passed + ' of ' + st.total + ' tests pass' : ''}
        </dd>
        <dt>Your data</dt>
        <dd>
          {app.shared
            ? 'A copy that lives in this browser. Nothing you enter is sent anywhere, and nobody else sees it.'
            : 'Stored in this browser, in a SQLite file.'}
        </dd>
        <dt>People</dt>
        <dd>
          {appUsers(app)
            .map((u) => u.name + ' (' + roleName(def, u.role) + ')')
            .join(', ')}
          . Every password is demo. The data is made up.
        </dd>
        {app.shared && app.shared.by ? (
          <>
            <dt>Shared by</dt>
            <dd>{app.shared.by}</dd>
          </>
        ) : null}
        {safe ? (
          <>
            <dt>Safety copy</dt>
            <dd>
              {'Your ' + safe.rows + ' records as they were on version ' + safe.ver + ', kept on this device before the update. '}
              <Btn
                className="btn sm"
                id="about-safe"
                onClick={() => saveFile(snake(app.name) + '-before-update.sqlite', b64.dec(safe.db), 'application/vnd.sqlite3')}
              >
                <Icon n="download" s="16" />
                Save it as a file
              </Btn>
            </dd>
          </>
        ) : null}
      </dl>
    </Dialog>
  );
}

/* ---------- the app-only view ---------- */
export function SoloShell() {
  const so = U.solo as SoloView, // the shell draws this only while an app is open on its own
    app = S.apps[so.app],
    shared = app.shared,
    signed = !!(S.session && me()),
    up = shared && shared.updated && !shared.updated.seen ? shared.updated : null,
    failed = shared && shared.failed && !shared.failed.seen ? shared.failed : null,
    next = so.update && !so.update.later ? so.update : null;
  useEffect(() => {
    setIdentity(app);
    // the browser installs whatever manifest the page links: while the app is open alone, that is the app's own
    const stop = holdInstallLinks(document, appInstallLinks(installInputOf(app)), app.name);
    return () => {
      stop();
      clearIdentity();
      setInstallLinks(document, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs again when the app's id, name or version changes, not on every store update
  }, [app.id, app.name, app.rev]);
  useEffect(() => {
    // the browser reports an install it made while this app was open alone: mark the app
    const since = Date.now();
    return onInstallPrompt(() => {
      if (lastInstalledAt() >= since && !app.installed) {
        app.installed = lastInstalledAt();
        commit();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener per app, not one per store update
  }, [app.id]);
  useEffect(() => {
    void checkForUpdate(app);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked once each time an app is opened on its own
  }, [app.id]);
  const extra: (SoloItem | null)[] = [
    {
      label: app.installed ? 'Installed on this device' : 'Install this app',
      icon: 'install',
      on: () =>
        openDialog('installapp', {
          app: app.id,
        }),
    },
    {
      label: 'About this app',
      icon: 'info',
      on: () =>
        openDialog('aboutapp', {
          app: app.id,
        }),
    },
    ...demoMenuItems(app),
    signed && app.shared && !app.shared.preview
      ? {
          label: 'Save a copy to my library',
          icon: 'save',
          on: () => keepShared(app),
        }
      : null,
    '-',
    {
      label: so.from === 'preview' ? 'Back to sharing' : signed ? 'Back to Turnkey' : 'Open Turnkey',
      icon: 'arrowLeft',
      on: exitSolo,
    },
  ];
  return (
    <div className="solo" data-solo={so.from}>
      {so.from === 'preview' && (
        <div className="solo-note" role="status">
          <Icon n="eye" s="16" />
          <span className="grow">Preview: this is all that someone with the link sees.</span>
          <Btn className="btn sm" onClick={exitSolo}>
            Close preview
          </Btn>
        </div>
      )}
      {up && (
        <div className="solo-note ok" role="status">
          <Icon n="sync" s="16" />
          <span className="grow">
            <strong>
              {'Updated to version '}
              {shared?.ver}
            </strong>
            {' from '}
            {up.from}
            {'. '}
            {up.kept == null
              ? 'Your earlier records could not be carried over, so it starts with sample data.'
              : 'Your ' + up.kept + ' records were kept.'}
            {up.away
              ? ' ' +
                up.away +
                ' value' +
                (up.away === 1 ? ' is' : 's are') +
                ' put away, because this version has no field for ' +
                (up.away === 1 ? 'it' : 'them') +
                '.'
              : ''}
            {shared?.notes.length ? ' New: ' + shared.notes.slice(0, 2).join(' · ') : ''}
          </span>
          <Btn
            className="btn sm"
            onClick={() => {
              up.seen = true;
              commit();
            }}
          >
            OK
          </Btn>
        </div>
      )}
      {next && (
        <div className="solo-note update" role="status" id="solo-update">
          <Icon n="sync" s="16" />
          <span className="grow">
            <strong>
              {'Version '}
              {next.ver}
              {' is ready.'}
            </strong>
            {next.kind === 'fix'
              ? ' This update fixes a problem.'
              : next.kind === 'rollback'
                ? ' The owner went back to an earlier version.'
                : ''}
            {next.notes.length ? ' What is new: ' + next.notes.slice(0, 2).join(' · ') : ''}
            {' Your records are kept.'}
          </span>
          <Btn className="btn sm primary" id="solo-update-go" disabled={!!next.busy} onClick={() => updateNow(app)}>
            {next.busy ? <Spinner /> : null}
            Update now
          </Btn>
          <Btn
            className="btn sm"
            disabled={!!next.busy}
            onClick={() => {
              next.later = true;
              notify();
            }}
          >
            Later
          </Btn>
        </div>
      )}
      {failed && (
        <div className="solo-note warn" role="status" id="solo-update-failed">
          <Icon n="warning" s="16" />
          <span className="grow">
            <strong>
              {'Version '}
              {failed.to}
              {' could not be applied here.'}
            </strong>
            {' Your records are safe and the app is still on version '}
            {shared?.ver}
            {'. Tell the person who shared it with you.'}
          </span>
          <Btn
            className="btn sm"
            onClick={() => {
              failed.seen = true;
              commit();
            }}
          >
            OK
          </Btn>
        </div>
      )}
      {so.from === 'link' && !app.installed && !so.noInstall && (
        <div className="solo-note install" role="status">
          <AppLogo app={app} size={24} />
          <span className="grow">
            {'Install '}
            <strong>{app.name}</strong>
            {' to open it from your desktop or home screen, under its own icon.'}
          </span>
          <Btn
            className="btn sm primary"
            id="solo-install"
            onClick={() =>
              openDialog('installapp', {
                app: app.id,
              })
            }
          >
            Install
          </Btn>
          <Btn
            className="btn subtle icon sm"
            aria-label="Not now"
            onClick={() => {
              so.noInstall = true;
              notify();
            }}
          >
            <Icon n="dismiss" s="16" />
          </Btn>
        </div>
      )}
      <AppPane app={app} pane={so.pane} solo={extra} />
    </div>
  );
}
/** a choice in the share dialog changed: the link is packed again */
function setShare(patch: Partial<ShareState>) {
  if (!U.share) return;
  Object.assign(U.share, patch, { code: null });
  makeShare();
}
function setShareBusy(busy: boolean) {
  if (U.share) U.share.rbusy = busy;
}
function setOpenLink(p: OpenLinkProps, patch: Partial<OpenLinkProps>) {
  Object.assign(p, patch);
}
export async function checkForUpdate(app: AppRecord, force?: boolean) {
  const sh = app.shared;
  if (!sh || sh.preview || !sh.slug || !sh.uid || !online()) return null;
  if (!force && Date.now() - (CHECKED[app.id] || 0) < 10 * 60000) return null;
  CHECKED[app.id] = Date.now();
  const got = await loadShortLink(sh.slug);
  if (!got.ok) return null;
  let pack: Pack;
  try {
    pack = readPack(await unsqueeze(got.code));
  } catch {
    return null;
  }
  const ver = str(pack.ver);
  if (str(pack.uid) !== sh.uid || !/^\d+(\.\d+){0,2}$/.test(ver) || verCmp(ver, sh.ver) <= 0) return null;
  if (sh.failed && sh.failed.to === ver) return null; // this version was tried here and could not take the records
  const so = U.solo;
  if (!so || so.app !== app.id) return null;
  so.update = {
    ver,
    kind: str(pack.kind),
    notes: arr(pack.notes)
      .map((n) => str(n).slice(0, 200))
      .filter(Boolean)
      .slice(0, 12),
    code: got.code,
  };
  notify();
  return so.update;
}
export async function updateNow(app: AppRecord) {
  const so = U.solo,
    up = so && so.app === app.id ? so.update : null;
  if (!so || !up || up.busy) return;
  up.busy = true;
  notify();
  try {
    await openShared(up.code, { slug: app.shared?.slug, back: so.back });
  } catch (e) {
    up.busy = false;
    toast(errText(e), 'danger');
  }
}
/** the dialog's props, which also hold what has been pasted so far */
interface OpenLinkProps {
  text?: string;
  err?: string;
  busy?: boolean;
}

/* ---------- updates ---------- */
/* An app that came from a short link asks that address for a newer version when it opens with a connection. It never
   updates by itself: the person is told what is new and chooses Update now or Later. Records are kept either way. */
const CHECKED: Dict<number> = {};
