/*
 * The controls for src/workspace/history.ts: Undo and Redo in the app's header, and the Version history dialog that
 * lists every saved version with who made it, and restores one.
 */
import type { AppRecord } from '@/shared/types/workspace';
import { S, ago, closeDialog, cx, fmtClock, openDialog, useStore } from './core';
import { AGENTS } from './line';
import { historyOf, redo, redoable, restoreVersion, undo, undoable, type AppVersion } from './history';
import { AgentAv, Avatar, Btn, Dialog, Empty, Icon } from './ui';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const KEY = IS_MAC ? '⌘' : 'Ctrl+';

export const openHistory = (app: AppRecord) => openDialog('history', { app: app.id });

/** Undo, Redo and Version history, as icon buttons for the app's header. */
export function HistoryButtons({ app }: { app: AppRecord }) {
  useStore();
  if (app.status !== 'ready') return null;
  return (
    <span className="row gap4 hist-btns hide-md">
      <Btn className="btn subtle icon" aria-label="Undo" title={'Undo (' + KEY + 'Z)'} disabled={!undoable(app)} onClick={() => undo(app)}>
        <Icon n="undo" />
      </Btn>
      <Btn
        className="btn subtle icon"
        aria-label="Redo"
        title={'Redo (' + KEY + (IS_MAC ? 'Shift+Z' : 'Y') + ')'}
        disabled={!redoable(app)}
        onClick={() => redo(app)}
      >
        <Icon n="undo" cls="flip-x" />
      </Btn>
      <Btn className="btn subtle icon" aria-label="Version history" title="Version history" onClick={() => openHistory(app)}>
        <Icon n="history" />
      </Btn>
    </span>
  );
}

const whoName = (by: string) =>
  by === 'you' ? 'You' : by === 'rules' ? 'Built-in rules' : (AGENTS[by]?.name || by) + (AGENTS[by] ? ' agent' : '');

function Who({ by }: { by: string[] }) {
  const list = by.length ? by : ['orchestrator'];
  return (
    <span className="row gap4 hist-who">
      {list
        .slice(0, 3)
        .map((b) => (b === 'you' ? <Avatar key={b} name="You" size="xs" acc="steel" /> : <AgentAv key={b} id={b} size="xs" />))}
      <span className="t-cap muted">{list.map(whoName).join(', ')}</span>
    </span>
  );
}

function Row({ app, v, now, undone }: { app: AppRecord; v: AppVersion; now: boolean; undone: boolean }) {
  return (
    <li className={cx('hist-row', now && 'now', undone && 'undone')} data-version={v.id} data-kind={v.kind}>
      <div className="col gap2 grow">
        <span className="hist-what">{v.what}</span>
        <Who by={v.by} />
      </div>
      <span className="t-cap muted hist-time" title={new Date(v.at).toLocaleString()}>
        {fmtClock(v.at).slice(0, 5)} · {ago(v.at)}
      </span>
      {now ? (
        <span className="badge b-success">Now</span>
      ) : (
        <Btn className="btn sm" aria-label={'Restore: ' + v.what} onClick={() => restoreVersion(app, v.id)}>
          {undone ? 'Redo to here' : 'Restore'}
        </Btn>
      )}
    </li>
  );
}

export function HistoryDialog({ p }: { p: { app?: unknown } }) {
  useStore();
  const app = S.apps[String(p.app)];
  if (!app) return null;
  const h = historyOf(app.id),
    list = h ? h.versions.map((v, i) => ({ v, i })).reverse() : [];
  return (
    <Dialog
      title={'Version history · ' + app.name}
      wide
      cls="history"
      onClose={closeDialog}
      foot={
        <>
          <Btn className="btn" disabled={!undoable(app)} onClick={() => undo(app)}>
            <Icon n="undo" s="16" />
            Undo
          </Btn>
          <Btn className="btn" disabled={!redoable(app)} onClick={() => redo(app)}>
            <Icon n="undo" s="16" cls="flip-x" />
            Redo
          </Btn>
          <span className="grow" />
          <Btn className="btn primary" data-autofocus onClick={closeDialog}>
            Close
          </Btn>
        </>
      }
    >
      <p className="muted">
        Every change you or the agents make to this app is saved here, in this browser. Restoring a version changes the app&apos;s design
        and workflow back; the records in its tables stay. You can also press {KEY}Z to undo.
      </p>
      {list.length ? (
        <ol className="hist-list" aria-label="Versions, newest first">
          {list.map(({ v, i }) => (
            <Row key={v.id} app={app} v={v} now={i === h?.at} undone={!!h && i > h.at} />
          ))}
        </ol>
      ) : (
        <Empty icon="history" title="No versions yet" text="The first version is saved when the app is built and idle." />
      )}
    </Dialog>
  );
}
