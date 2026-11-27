/*
 * The Build tab as an owner first sees it: the build as a short list of steps in plain words (steps.ts), with the
 * one place the build can stop for them, and the finished app one press away. The workflow canvas, the timeline, the
 * log and the meeting stay behind "Show how it was built".
 */
import { ProgressBar } from '@fluentui/react-components';
import { AGENT_NAMES, teamFor } from '@/shared/plan';
import type { AppRecord } from '@/shared/types/workspace';
import { S, U, commit, cx, notify, setChat } from './core';
import { AgentAv, Avatar, Btn, Card, Icon, Spinner } from './ui';
import { RUNS, stopRun } from './line';
import { answerGate, flowOf, stepAfter } from './custom';
import { REVIEWERS } from './reviewers';
import { testStats } from './tests';
import { type BuildStep, type BuildSteps, type StepState, buildSteps, rulesInWords, stepsHeadline } from './steps';

/** Which face of the Build tab an app shows: the plain steps, or one of the four views of how it was built. */
export const buildMode = (app: AppRecord): string => U.bview[app.id] || (S.settings.buildDetail ? 'line' : 'steps');
/** Open or close "how it was built" for this app. The choice is remembered for the next app and the next visit. */
export function showHow(app: AppRecord, on: boolean) {
  U.bview[app.id] = on ? 'line' : 'steps';
  S.settings.buildDetail = on;
  commit();
}
/** The steps of this app's build, read from the store. */
export const stepsOf = (app: AppRecord): BuildSteps => {
  const flow = flowOf(app);
  return buildSteps({
    app,
    flow,
    reviewers: REVIEWERS,
    after: (id) => stepAfter(flow, id),
    tests: testStats(app),
    running: !!RUNS[app.id],
    names: AGENT_NAMES,
    // an app built before plans existed has none: its list comes from the stations alone
    team: app.plan ? teamFor(app.plan) : null,
  });
};

const TONE: Record<StepState, string> = { done: 'success', now: 'info', ask: 'warning', wait: 'neutral', bad: 'danger' };
const LABEL: Record<StepState, string> = { done: 'Done', now: 'Working', ask: 'Needs you', wait: 'Waiting', bad: 'Needs a look' };

function toChat(app: AppRecord) {
  setChat(true);
  setTimeout(() => {
    const el = document.getElementById('chat-' + app.id);
    if (el) el.focus();
  }, 50);
}

/** What was made so far, as a row of short tags. */
function madeTags(app: AppRecord): string[] {
  const def = app.def,
    t = testStats(app),
    views = Object.values(def.views || {}).reduce((k, v) => k + v.length, 0),
    one = (k: number, w: string) => k + ' ' + w + (k === 1 ? '' : 's');
  return [
    def.tables.length ? one(def.tables.length, 'list') : '',
    def.process ? one(def.process.states.length, 'stage') : '',
    views ? one(views, 'view') : '',
    def.screens.length ? one(def.screens.length, 'screen') : '',
    t && t.fresh ? (t.failed ? t.failed + ' of ' + one(t.total, 'check') + ' failing' : one(t.total, 'check') + ' pass') : '',
  ].filter(Boolean);
}

/** The pause for the owner: what to look at, and the two answers. */
function ApprovalAsk({ app, st }: { app: AppRecord; st: BuildStep }) {
  const rules = st.station === 'backend' ? rulesInWords(app.def) : [],
    facts = rules.length ? rules : (app.line[st.station]?.facts || []).slice(0, 4);
  return (
    <div className="step-ask">
      {(st.why || rules.length > 0) && (
        <span className="t-cap muted">{st.why || 'These decide who sees what, so the build stops here before the screens are made.'}</span>
      )}
      {facts.length > 0 && (
        <ul className="plain step-rules">
          {facts.map((x, i) => (
            <li key={i}>
              <Icon n="check" s="16" />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        <Btn className="btn primary sm" onClick={() => answerGate(app, true)}>
          Looks right, continue
        </Btn>
        <Btn className="btn sm" onClick={() => answerGate(app, false)}>
          Stop here
        </Btn>
      </div>
      <span className="t-cap muted">Something not right? Continue and ask for the change in chat once the app is built, or stop here.</span>
    </div>
  );
}

function StepRow({ app, st, i }: { app: AppRecord; st: BuildStep; i: number }) {
  return (
    <li className={cx('step', 's-' + st.state)} data-step={st.id} data-state={st.state}>
      <span className={cx('step-dot', st.state)} aria-hidden="true">
        {st.state === 'done' ? <Icon n="check" s="12" /> : i + 1}
      </span>
      {st.agent ? (
        <AgentAv id={st.agent} size="sm" />
      ) : st.kind === 'approval' ? (
        <Avatar name="You" size="sm" acc="steel" />
      ) : (
        <span className={cx('av sq av-sm', 'acc-' + (st.acc || 'steel'))} aria-hidden="true">
          <Icon n={st.icon || 'code'} s="16" />
        </span>
      )}
      <div className="step-body">
        <div className="step-top">
          <strong>{st.title}</strong>
          <span className="t-cap muted grow">{st.who}</span>
          <span className={'badge b-' + TONE[st.state]}>
            {st.state === 'now' && <Spinner />}
            {LABEL[st.state]}
          </span>
        </div>
        <span className={cx('step-text', st.state === 'wait' && 'muted')}>{st.text}</span>
        {st.ask === 'approval' && <ApprovalAsk app={app} st={st} />}
        {st.ask === 'question' && (
          <div className="row">
            <Btn className="btn primary sm" onClick={() => toChat(app)}>
              Answer in chat
            </Btn>
          </div>
        )}
      </div>
    </li>
  );
}

export function StepsView({ app }: { app: AppRecord }) {
  const busy = !!RUNS[app.id],
    B = stepsOf(app),
    head = stepsHeadline(app, B, busy),
    total = B.steps.length,
    tags = madeTags(app),
    ready = app.status === 'ready' && !busy;
  return (
    <section className="steps-view" data-tour="steps" aria-label="The build, step by step">
      <div className="steps-head">
        <div className="col gap0 grow">
          <h2 className="t-sub1">{head.title}</h2>
          <span className="muted" id="steps-sub">
            {head.sub}
          </span>
        </div>
        {busy && (
          <Btn className="btn sm" onClick={() => stopRun(app)}>
            <Icon n="stop" s="16" />
            Stop
          </Btn>
        )}
        <Btn
          className="btn sm"
          id="show-how"
          data-tour="how"
          title="The workflow, the timeline, the log and the meeting"
          onClick={() => showHow(app, true)}
        >
          <Icon n="flow" s="16" />
          Show how it was built
        </Btn>
      </div>
      <ProgressBar
        className="steps-bar"
        thickness="large"
        value={B.done}
        max={total}
        color={ready && B.at === 0 ? 'success' : 'brand'}
        aria-label="Build progress"
        aria-describedby="steps-sub"
      />
      {tags.length > 0 && (
        <div className="steps-made" aria-label="What was made">
          {tags.map((t) => (
            <span key={t} className="steps-tag">
              {t}
            </span>
          ))}
        </div>
      )}
      {ready && B.at === 0 && (
        <div className="steps-ready" role="status">
          <Icon n="checkCircle" />
          <span className="grow">
            <strong>{app.name} is ready.</strong> Open it and try every screen.
          </span>
          <Btn
            className="btn primary sm"
            id="steps-open"
            onClick={() => {
              U.view[app.id] = 'app';
              notify();
            }}
          >
            Open the app
          </Btn>
        </div>
      )}
      <Card className="card steps-card">
        <ol className="steps-list">
          {B.steps.map((st, i) => (
            <StepRow key={st.id} app={app} st={st} i={i} />
          ))}
        </ol>
      </Card>
      {B.skipped.length > 0 && (
        <div className="t-cap muted steps-skipped">
          <span>{'Not needed for this app, so ' + (B.skipped.length === 1 ? 'it did not run:' : 'they did not run:')}</span>
          <ul className="plain">
            {B.skipped.map((s) => (
              <li key={s.who}>
                <strong>{s.who}.</strong> {s.why}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
