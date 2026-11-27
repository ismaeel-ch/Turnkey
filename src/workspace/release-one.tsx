import { useState } from 'react';
import type { RecordStep } from '@/shared/types/app';
import type { AppRecord, ChangeSet, Release } from '@/shared/types/workspace';
import { S, arr, commit, emit, errText, me, toast, toolCall } from './core';
import { dbDrop } from './db';
import { pushChat, newRun } from './line';
import { runTestsSync } from './tests';
import { appBusy } from './history';
import { carryData } from './carry';
import { kindOf } from './change-plan';
import { applyChangeSync, planOps } from './changes';
import { inverseSteps } from './record-steps';
import { appFromPack, packOf, readPack, squeeze, unsqueeze } from './share';
import {
  appSig,
  baseOf,
  draftLog,
  draftSteps,
  publish,
  relHistory,
  relList,
  relOf,
  releaseBlock,
  verNext,
  waitingChanges,
} from './release';
import type { Waiting } from './release';
import { Btn, Field, Icon, MBar, Spinner } from './ui';

/* ===== Turnkey · one change released on its own =====
   The draft can hold a fix the owner needs out today beside a new feature that is only half done. Releasing the draft
   would send both, so a change the owner approved can go out on its own: Turnkey takes the live version, makes that
   change again on top of it, checks it and releases it as the next number. The draft itself is not touched: it still
   holds every change, and what was left out keeps waiting for the next release and is checked again on top of the new
   version. This works because each change is kept as the operations that made it (`ChangeSet`), not as a diff. */

type BackedApp = Parameters<typeof planOps>[0];
type Kind = 'fix' | 'feature';
const KIND_WORD: Record<Kind, string> = { fix: 'Fix', feature: 'New feature' };
let going = false;

/** Why the changes `ids` cannot go out on their own right now, or null. */
export function aloneBlock(app: AppRecord, ids: string[]): string | null {
  const live = relOf(app),
    w = waitingChanges(app);
  if (!live) return 'Release version 1.0 first. After that, one change can go out on its own.';
  const why = releaseBlock(app);
  if (why) return why;
  if (appBusy(app)) return 'Wait until the agents have finished.';
  if (!live.pack) return 'The copy of version ' + live.v + ' was let go to save room, so this change can only go out with the whole draft.';
  if (!ids.length || ids.some((id) => !w.some((x) => x.set && x.id === id))) return 'That change is no longer waiting in the draft.';
  if (w.length < 2) return 'Nothing else is waiting, so release the draft as it is.';
  return null;
}

/** The version number the changes `ids` would go out as. */
export const aloneVersion = (app: AppRecord, ids: string[]) => {
  const live = relOf(app);
  return live ? verNext(live.v, kindOf(draftLog(app).filter((x) => x.group && ids.includes(x.group)))) : '';
};

const listWords = (a: string[]) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
const quoted = (a: string[]) => listWords(a.map((t) => '"' + t + '"'));

/**
 * Releases the waiting changes `ids` on their own, as the next number after the live version. The draft keeps every
 * change; what was left out stays waiting and is tested again on top of the new version. Returns the new release, or
 * null when nothing was released (the owner is told why).
 */
export async function releaseAlone(app: AppRecord, ids: string[]): Promise<Release | null> {
  const block = aloneBlock(app, ids);
  if (block) {
    toast(block, 'warning');
    return null;
  }
  if (going) return null;
  going = true;
  try {
    return await release(app, ids);
  } finally {
    going = false;
  }
}

async function release(app: AppRecord, ids: string[]): Promise<Release | null> {
  const live = relOf(app) as Release,
    all = waitingChanges(app),
    picked = all.filter((w) => w.set && ids.includes(w.id)),
    left = all.filter((w) => !picked.includes(w)),
    sets = picked.map((w) => w.set as ChangeSet),
    kind = kindOf(draftLog(app).filter((x) => x.group && ids.includes(x.group))),
    v = verNext(live.v, kind),
    names = picked.map((w) => w.title),
    fail = (why: string) => {
      pushChat(
        app,
        'orchestrator',
        'Nothing was released. ' +
          quoted(names) +
          ' could not be made on its own on top of version ' +
          live.v +
          ': ' +
          why.replace(/\.$/, '') +
          '. It is still in the draft, and goes out when you release the whole draft.',
      );
      toast('Nothing was released: ' + why, 'warning');
      commit();
      return null;
    };
  let tmp: AppRecord | null = null;
  try {
    const pack = readPack(await unsqueeze(live.pack as string));
    if (aloneBlock(app, ids)) return null; // something started while the version was being unpacked
    tmp = appFromPack(pack, 'one' + Date.now(), true);
    const T = tmp as BackedApp;
    // the owner's records, moved back to the shape the live version has, so the change meets the records it will meet
    if (!carryData(app, tmp, inverseSteps(draftSteps(app)))) return fail('the records could not be copied into it');
    const n0 = T.def.migrations.length,
      run = newRun(tmp, 'change', 'On its own: ' + names.join(', ').slice(0, 60), 'demo');
    for (const set of sets) {
      const p = planOps(T, set.ops);
      if (p.errors.length || p.steps.length !== arr(set.ops).length)
        return fail(p.errors[0] || 'it needs something that is only in the draft');
      const res = applyChangeSync(T, p.steps, { agent: 'orchestrator', runId: run.id, appId: T.id, runN: run.n });
      if (res.failed) return fail((res.per[res.failed]?.issues[0] || 'a check failed') + ' (it may need a change that is still waiting)');
    }
    const ts = runTestsSync(tmp);
    if (!ts) return fail('its tests could not run');
    if (ts.failed) return fail(ts.failed + ' of ' + ts.total + ' tests fail on it');
    const steps = T.def.migrations
        .slice(n0)
        .map((m) => m.step)
        .filter((x): x is RecordStep => !!x),
      notes = picked
        .flatMap((w) => w.notes)
        .filter((x, i, a) => a.indexOf(x) === i)
        .slice(0, 12),
      out = packOf(tmp, { data: 'demo', as: '' });
    out.ver = v;
    out.uid = app.uid;
    out.notes = notes;
    out.kind = kind;
    out.history = relHistory(app).concat([{ v, steps }]);
    if (app.short) out.slug = app.short.slug;
    const code = await squeeze(JSON.stringify(out));
    if (relOf(app) !== live || appBusy(app)) return fail('the app changed while it was being packed');
    // what stays waiting is counted from the new version: its notes and migrations move after it
    const base = baseOf(app),
      waitLog = draftLog(app).filter((x) => !(x.group && ids.includes(x.group))),
      waitMig = app.def.migrations.filter((m) => (!base || m.at > base.at) && !(m.group && ids.includes(m.group)));
    const rel: Release = {
      v,
      at: Date.now(),
      by: me()?.name || '',
      kind,
      notes,
      sig: appSig(tmp),
      tests: { passed: ts.passed, total: ts.total },
      pack: code,
      size: code.length,
      inside: { tables: tmp.def.tables.length, pages: tmp.def.screens.length },
      steps,
      start: live.start,
      left: left.map((w) => w.title),
    };
    waitLog.forEach((x) => {
      x.at = rel.at + 1;
    });
    waitMig.forEach((m) => {
      m.at = rel.at + 1;
    });
    app.releases = [rel].concat(relList(app));
    app.releases.slice(6).forEach((r) => {
      r.pack = null;
    });
    app.takenBack = null;
    toolCall(
      { agent: 'orchestrator', appId: app.id },
      'release_version',
      { version: v, kind, alone: names.length, waiting: left.length },
      () => ({
        released: v,
        tests: ts.passed + ' of ' + ts.total,
      }),
    );
    emit('STATE_DELTA', { app: app.id, source: 'user', delta: [{ op: 'add', path: '/releases/0', value: { version: v, kind } }] });
    publish(app, rel, tmp); // reads the copy's records before it returns
    const again = runTestsSync(app),
      still = left.map((w) => w.title);
    pushChat(
      app,
      'orchestrator',
      'Version ' +
        v +
        ' is released with only ' +
        quoted(names) +
        '. All ' +
        ts.total +
        ' tests passed first. ' +
        (still.length ? listWords(still) + (still.length === 1 ? ' is' : ' are') + ' still waiting in the draft' : 'The draft') +
        (again
          ? again.failed
            ? ', and ' + again.failed + ' of ' + again.total + ' tests fail on it on top of ' + v + '. Fix those before the next release.'
            : '. It has been checked again on top of ' + v + ': all ' + again.total + ' tests pass.'
          : '.'),
      { type: 'released', v, kind, notes },
    );
    app.updated = Date.now();
    toast('Version ' + v + ' of ' + app.name + ' is released with only this change.', 'success');
    commit();
    return rel;
  } catch (e) {
    return fail(errText(e));
  } finally {
    if (tmp) {
      dbDrop(tmp.id);
      delete S.apps[tmp.id];
    }
  }
}

/** One waiting change, with its button and the question before it goes out. */
function WaitingItem({ app, w, open, onOpen }: { app: AppRecord; w: Waiting; open: boolean; onOpen(x: boolean): void }) {
  const [busy, setBusy] = useState(false);
  const ids = [w.id],
    why = w.set ? aloneBlock(app, ids) : null,
    v = w.set ? aloneVersion(app, ids) : '',
    others = waitingChanges(app).filter((x) => x.id !== w.id).length;
  const go = async () => {
    setBusy(true);
    await releaseAlone(app, ids);
    setBusy(false);
    onOpen(false);
  };
  return (
    <li className="rel-wait-item" data-change={w.id || 'other'}>
      <div className="row wrap gap8">
        <span className={'badge ' + (w.kind === 'fix' ? 'b-warning' : 'b-outline')}>{w.kind ? KIND_WORD[w.kind] : 'Other'}</span>
        <strong className="grow">{w.title}</strong>
        {w.set && !open && (
          <Btn
            className="btn subtle sm"
            data-act="alone"
            disabled={!!why}
            title={why || 'People get only this change now'}
            onClick={() => onOpen(true)}
          >
            <Icon n="rocket" s="16" />
            {'Release on its own as ' + v}
          </Btn>
        )}
      </div>
      {w.notes.length > 1 || w.notes[0] !== w.title ? (
        <ul className="rel-notes">
          {w.notes.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ul>
      ) : null}
      {open && (
        <MBar
          tone="info"
          action={
            <span className="row gap8">
              <Btn className="btn primary sm" data-act="alone-go" disabled={busy || !!why} onClick={() => void go()}>
                {busy ? <Spinner /> : <Icon n="rocket" s="16" />}
                {'Release version ' + v}
              </Btn>
              <Btn className="btn sm" data-act="alone-no" disabled={busy} onClick={() => onOpen(false)}>
                Not now
              </Btn>
            </span>
          }
        >
          <span id="rel-alone-ask">
            {'People get version ' +
              v +
              ' with only this ' +
              (w.kind === 'fix' ? 'fix' : 'change') +
              '. The other ' +
              (others === 1 ? 'change keeps' : others + ' changes keep') +
              ' waiting in the draft, and ' +
              (others === 1 ? 'is' : 'are') +
              ' checked again on top of ' +
              v +
              '. Every test runs first. If one fails, nothing is released.'}
          </span>
        </MBar>
      )}
    </li>
  );
}

/** The changes waiting in the draft, each of which can go out on its own. Shown when more than one is waiting. */
export function WaitingList({ app }: { app: AppRecord }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = waitingChanges(app);
  if (!relOf(app) || list.length < 2) return null;
  return (
    <Field
      id="rel-wait"
      label="Waiting in the draft"
      hint="Each change you asked for since the live version. One that is ready can go out on its own while the rest keep waiting."
    >
      <ul className="plain rel-wait" id="rel-wait">
        {list.map((w) => (
          <WaitingItem key={w.id || 'other'} app={app} w={w} open={open === w.id} onOpen={(x) => setOpen(x ? w.id : null)} />
        ))}
      </ul>
    </Field>
  );
}
