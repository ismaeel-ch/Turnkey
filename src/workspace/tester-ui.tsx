/* The Tester's panel. Split from tester.tsx so it loads the first
   time it is drawn (see later.tsx); the logic it uses stays in tester.tsx. */
import { cx } from './core';
import { roleName } from './engine';
import { REC } from './registry';
import { TESTS, runTests, testStats, testable } from './tests';
import { AGENTS, RUNS } from './line';
import { Btn, AgentAv, Empty, Icon, MBar } from './ui';
import { type BackedApp, CASE_EXPECT } from './tester';

/* ---------- the Tester in the inspector ---------- */
export function TesterPanel({ app }: { app: BackedApp }) {
  const Q = app.qa,
    cases = app.def.cases || [],
    R = TESTS[app.id],
    res = R && R.rev === app.rev ? R.res : {},
    st = testStats(app),
    busy = !!RUNS[app.id];
  if (!Q && !cases.length)
    return (
      <section className="inspector review-insp">
        <div className="insp-head">
          <AgentAv id="tester" />
          <div className="col gap0 grow">
            <strong>Tester</strong>
            <span className="t-cap muted">{AGENTS.tester.role}</span>
          </div>
        </div>
        <div className="insp-body">
          <Empty
            icon="beaker"
            title="No test cases yet"
            text="The Tester writes them when the six stations have passed, then every test runs before the app is called ready."
          />
        </div>
      </section>
    );
  const tone = Q ? (Q.status === 'ok' ? 'success' : Q.status === 'failed' ? 'danger' : 'info') : 'neutral';
  return (
    <section className="inspector review-insp" aria-label="Tester">
      <div className="insp-head">
        <AgentAv id="tester" />
        <div className="col gap0 grow">
          <strong>Tester</strong>
          <span className="t-cap muted">{AGENTS.tester.role}</span>
        </div>
        <span className={'badge b-' + tone}>
          {Q
            ? Q.status === 'ok'
              ? 'All tests pass'
              : Q.status === 'failed'
                ? 'Tests fail'
                : Q.status === 'sentback'
                  ? 'Sent back for repair'
                  : 'Working'
            : 'Not run in this session'}
        </span>
        <Btn className="btn sm" disabled={busy || !testable(app)} onClick={() => runTests(app)}>
          <Icon n="play" s="16" />
          Run every test
        </Btn>
      </div>
      <div className="insp-body col gap12">
        <p className="muted t-cap">
          {Q && Q.by === 'model'
            ? 'The model wrote these cases from the brief.'
            : Q && Q.by === 'saved'
              ? 'These cases are part of the saved build. In a Live build the model writes them from the brief.'
              : 'Written by rules in code from the brief and the access rules. In a Live build the model writes them.'}
          {' Code plays each one against the real endpoints inside a savepoint and rolls it back.'}
          {app.tpl && REC[app.tpl] && REC[app.tpl].slip ? ' ' + REC[app.tpl].slip : ''}
        </p>
        {Q && Q.rounds.length > 0 && (
          <ol className="qa-rounds">
            {Q.rounds.map((r) => (
              <li key={r.n} className={cx('qa-round', r.failed ? 'bad' : 'ok')}>
                <div className="row gap8">
                  <Icon n={r.failed ? 'warning' : 'checkCircle'} s="16" cls={r.failed ? 'bad' : 'ok'} />
                  <strong>
                    {'Run '}
                    {r.n}
                  </strong>
                  <span className="grow">{r.failed ? r.failed + ' of ' + r.total + ' failed' : 'all ' + r.total + ' passed'}</span>
                </div>
                {r.fails.length > 0 && (
                  <ul className="plain qa-fails">
                    {r.fails.slice(0, 4).map((f, i) => (
                      <li key={i}>
                        <span className="badge b-outline">{f.suite}</span> {f.name}{' '}
                        <span className="muted">
                          {'→ '}
                          {f.actual}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.fixes.map((f, i) => (
                  <div key={i} className={cx('qa-fix', f.ok ? 'ok' : 'bad')}>
                    <AgentAv id={f.by} size="xs" />
                    <span className="grow">
                      <strong>
                        {AGENTS[f.by].name} {f.ok ? 'repaired it' : 'tried a repair'}:
                      </strong>{' '}
                      {f.text}
                      {f.ok ? '' : ' · not applied: ' + f.why}
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ol>
        )}
        {Q && Q.dropped.length > 0 && (
          <MBar tone="info">
            {Q.dropped.length}
            {' case'}
            {Q.dropped.length === 1 ? ' was' : 's were'}
            {' withdrawn: '}
            {Q.dropped.map((d) => d.why).join('; ')}
          </MBar>
        )}
        <div className="col gap4">
          <div className="row between">
            <strong>
              {cases.length}
              {' test cases'}
            </strong>
            <span className="t-cap muted">{st ? st.total - cases.length + ' more are generated from the definitions' : ''}</span>
          </div>
          <ul className="plain qa-cases">
            {cases.map((c) => {
              const r = res['case:' + c.id];
              return (
                <li key={c.id} className={cx('qa-case', r && (r.ok ? 'ok' : 'bad'))}>
                  <div className="row gap8">
                    <Icon n={!r ? 'circle' : r.ok ? 'checkCircle' : 'errorCircle'} s="16" cls={!r ? 'muted' : r.ok ? 'ok' : 'bad'} />
                    <strong className="grow">{c.name}</strong>
                    <span className="t-cap muted">
                      {c.steps.length}
                      {' step'}
                      {c.steps.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {c.why && (
                    <span className="t-cap muted">
                      {'Protects: '}
                      {c.why}
                    </span>
                  )}
                  <ol className="qa-steps">
                    {c.steps.map((s, i) => (
                      <li key={i}>
                        <span>{s.say || roleName(app.def, s.role) + ' · ' + s.do + ' ' + s.table}</span>
                        <span className="badge b-outline">{CASE_EXPECT[s.do]}</span>
                      </li>
                    ))}
                  </ol>
                  {r && !r.ok && <span className="t-cap bad-t">{r.actual}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
