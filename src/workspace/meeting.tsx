import type { AppRecord, Run, RunStep } from '@/shared/types/workspace';
import { U, cx, fmtMs, notify } from './core';
import { AgentAv, Empty, Icon, Spinner, STATUS_META, Tip } from './ui';
import { AGENTS, RUNS, STATIONS } from './line';

/** What one agent is doing right now, as a meeting tile shows it. */
export type TileState = 'talking' | 'hand' | 'flag' | 'done' | 'idle';
export interface Tile {
  id: string;
  state: TileState;
  /** the station the tile opens in the inspector, if any */
  station: string | null;
  /** one line under the name: what the agent last did, or is doing */
  caption: string;
}

const BASE = ['orchestrator', 'researcher', 'database', 'backend', 'views', 'ui'];
const ACTIVE = ['working', 'checking'];

/** The agents in the meeting: the builders, plus any review step or tester that worked in this run. */
export function meetingAgents(run: Run | undefined): string[] {
  const extra = (run?.steps || []).map((s) => s.agent).filter((id, i, a) => !BASE.includes(id) && AGENTS[id] && a.indexOf(id) === i);
  return BASE.concat(extra);
}

function lastStep(run: Run | undefined, id: string): RunStep | undefined {
  const steps = (run?.steps || []).filter((s) => s.agent === id);
  return steps[steps.length - 1];
}

/** Works out a tile from the line and the run. Pure, so the browser checks can read it through the test hook. */
export function tileOf(app: AppRecord, run: Run | undefined, id: string): Tile {
  const last = lastStep(run, id);
  if (id === 'orchestrator') {
    const busy = !!RUNS[app.id];
    if (busy && STATIONS.some((s) => app.line[s.id].status === 'waiting'))
      return { id, state: 'idle', station: null, caption: 'Paused until you answer' };
    return {
      id,
      state: busy ? 'talking' : app.status === 'failed' ? 'flag' : app.status === 'ready' ? 'done' : 'idle',
      station: null,
      caption: busy
        ? 'Running the stations and checking each handoff'
        : app.status === 'ready'
          ? 'All stations passed their checks'
          : 'Not running',
    };
  }
  const own = STATIONS.filter((s) => s.agent === id);
  if (!own.length) {
    // a review step or the tester: only the run says what it did
    const state: TileState = !last ? 'idle' : !last.t1 ? 'talking' : last.ok === false ? 'flag' : 'done';
    return {
      id,
      state,
      station: id.indexOf('rv_') === 0 ? id : id === 'tester' ? 'qa' : null,
      caption: last ? last.label : 'Not called in this run',
    };
  }
  const lines = own.map((s) => ({ s, L: app.line[s.id] }));
  const on = lines.find((x) => ACTIVE.includes(x.L.status)),
    wait = lines.find((x) => x.L.status === 'waiting'),
    bad = lines.find((x) => x.L.status === 'sentback' || x.L.status === 'failed');
  if (wait)
    return {
      id,
      state: 'hand',
      station: wait.s.id,
      caption: wait.L.hold === 'approval' ? 'Waiting for your approval of ' + wait.s.name : 'Has a question for you',
    };
  if (on) {
    const chars = U.stream[app.id];
    return {
      id,
      state: 'talking',
      station: on.s.id,
      caption:
        on.L.status === 'checking'
          ? 'Checking ' + on.s.name.toLowerCase()
          : chars
            ? 'Writing ' + on.s.makes.toLowerCase() + ', ' + chars + ' characters so far'
            : last && !last.t1
              ? last.label
              : 'Working on ' + on.s.makes.toLowerCase(),
    };
  }
  if (bad) return { id, state: 'flag', station: bad.s.id, caption: STATUS_META[bad.L.status]?.text + ': ' + bad.s.name };
  const allOk = lines.every((x) => x.L.status === 'ok');
  return {
    id,
    state: allOk ? 'done' : 'idle',
    station: own[0].id,
    caption: allOk ? 'Made ' + own.map((s) => s.makes.toLowerCase()).join(', ') : last ? last.label : 'Waiting for its turn',
  };
}

const STATE_TEXT: Record<TileState, string> = {
  talking: 'Working',
  hand: 'Hand raised',
  flag: 'Needs another try',
  done: 'Done',
  idle: 'Waiting',
};
const STATE_TONE: Record<TileState, string> = { talking: 'info', hand: 'warning', flag: 'danger', done: 'success', idle: 'neutral' };

/** How long an agent worked in this run, and in how many steps. */
function workOf(run: Run | undefined, id: string): string {
  const steps = (run?.steps || []).filter((s) => s.agent === id && s.t1);
  if (!steps.length) return '';
  const ms = steps.reduce((n, s) => n + ((s.t1 || s.t0) - s.t0), 0);
  return fmtMs(ms) + ' in ' + steps.length + (steps.length === 1 ? ' step' : ' steps');
}

/** The shared screen: whoever is speaking shares the line, so everyone sees where the build is. */
function SharedScreen({ app, presenter }: { app: AppRecord; presenter: Tile }) {
  const done = STATIONS.filter((s) => app.line[s.id].status === 'ok').length;
  return (
    <section className="meet-screen" aria-label="Shared screen">
      <div className="meet-screen-head">
        <Icon n="desktop" s="16" />
        <span className="grow">
          <strong>{AGENTS[presenter.id].name}</strong>
          {' is sharing the build line'}
        </span>
        <span className="t-cap muted">
          {done} of {STATIONS.length} stations checked
        </span>
      </div>
      <ol className="meet-board">
        {STATIONS.map((s) => {
          const L = app.line[s.id],
            meta = STATUS_META[L.status] || STATUS_META.idle;
          return (
            <li key={s.id} className={cx('meet-step', 's-' + L.status, presenter.station === s.id && 'on')}>
              <span className="meet-rail" aria-hidden="true">
                {L.status === 'ok' ? <Icon n="check" s="12" /> : ACTIVE.includes(L.status) ? <Spinner /> : null}
              </span>
              <span className="meet-step-b">
                <span className="meet-step-n">{s.name}</span>
                <span className="t-cap muted">{AGENTS[s.agent].name}</span>
              </span>
              <span className={'badge b-' + meta.tone}>{meta.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A Teams-style meeting of the agents: one tile each, the speaker highlighted, a raised hand when one needs you. */
export function MeetingView({ app, run, sel }: { app: AppRecord; run: Run | undefined; sel: string }) {
  if (!run && app.status !== 'ready' && !RUNS[app.id])
    return (
      <div className="line-wrap" data-tour="line">
        <Empty icon="people" title="No meeting yet" text="Start a build and the agents join here." />
      </div>
    );
  const tiles = meetingAgents(run).map((id) => tileOf(app, run, id)),
    builder = tiles.find((t) => t.id !== 'orchestrator' && (t.state === 'hand' || t.state === 'talking')),
    presenter = builder || tiles[0],
    hands = tiles.filter((t) => t.state === 'hand'),
    captions = (run?.steps || []).slice(-4),
    working = tiles.filter((t) => t.state === 'talking').length,
    finished = tiles.filter((t) => t.state === 'done').length;
  return (
    <div className="line-wrap meet" data-tour="line">
      <div className="meet-top">
        <h3 className="meet-title">The team on this build</h3>
        <span className="t-cap muted">
          {tiles.length}
          {' agents · '}
          {working ? working + ' working · ' : ''}
          {finished}
          {' done'}
        </span>
      </div>
      {hands.length > 0 && (
        <p className="meet-note t-cap" role="status">
          <Icon n="handRight" s="16" />
          {hands.map((t) => AGENTS[t.id].name).join(' and ')}
          {hands.length > 1 ? ' have' : ' has'} a hand raised. Answer in the chat, or approve in the bar above.
        </p>
      )}
      <div className="meet-stage">
        <div className="meet-grid" role="list" aria-label="Agents in the meeting">
          {tiles.map((t) => {
            const a = AGENTS[t.id],
              work = t.id === 'orchestrator' ? '' : workOf(run, t.id);
            return (
              <div key={t.id} role="listitem" className="meet-cell">
                <Tip text={t.station ? 'Show what ' + a.name + ' made' : a.role}>
                  <button
                    type="button"
                    className={cx('meet-tile', 'm-' + t.state, 'acc-' + a.acc, t.station && sel === t.station && 'sel')}
                    data-agent={t.id}
                    disabled={!t.station}
                    aria-label={a.name + ', ' + STATE_TEXT[t.state] + '. ' + t.caption}
                    onClick={() => {
                      if (!t.station) return;
                      U.sel[app.id] = t.station;
                      U.follow[app.id] = false;
                      notify();
                    }}
                  >
                    <span className={cx('meet-av', t.state === 'talking' && 'live')}>
                      <AgentAv id={t.id} size="lg" />
                      {t.state === 'hand' && (
                        <span className="meet-hand" aria-hidden="true">
                          <Icon n="handRight" s="12" />
                        </span>
                      )}
                    </span>
                    <span className="meet-body">
                      <span className="meet-head">
                        <strong className="meet-name">{a.name}</strong>
                        <span className={cx('meet-state badge', 'b-' + STATE_TONE[t.state])}>
                          {t.state === 'talking' && <span className="meet-eq" aria-hidden="true" />}
                          {t.state === 'done' && <Icon n="check" s="12" />}
                          {STATE_TEXT[t.state]}
                        </span>
                      </span>
                      <span className="meet-cap">{t.caption}</span>
                      {work && <span className="meet-work t-cap">{work}</span>}
                    </span>
                  </button>
                </Tip>
              </div>
            );
          })}
        </div>
        <SharedScreen app={app} presenter={presenter} />
      </div>
      {captions.length > 0 && (
        <div className="meet-captions" aria-label="Captions" aria-live="polite">
          <span className="meet-captions-h t-cap">Latest</span>
          {captions.map((s, i) => (
            <div key={i} className="meet-line">
              {AGENTS[s.agent] && <AgentAv id={s.agent} size="xs" />}
              <strong>{AGENTS[s.agent]?.name || s.agent}</strong>
              <span className="muted">{s.label}</span>
              {run && <span className="meet-at t-cap muted">{'+' + fmtMs(s.t0 - run.t0)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
