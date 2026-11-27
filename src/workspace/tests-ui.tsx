/* The Tests tab and the tests under each station. Split from tests.tsx so it loads the first
   time it is drawn (see later.tsx); the logic it uses stays in tests.tsx. */
import type { AppRecord, Dict } from '@/shared/types/workspace';
import { U, ago, cx, fmtMs, notify, str } from './core';
import { RUNS, STATIONS } from './line';
import type { Station } from './line';
import { AgentAv, Btn, Card, Empty, Icon, Input, Seg, Spinner } from './ui';
import { type TestRun, TESTS, type Suite, suiteOf, testable, runTests } from './tests';

export function TestsView({ app }: { app: AppRecord }) {
  if (!testable(app))
    return (
      <div className="tests-view">
        <Empty
          icon="beaker"
          title="No tests yet"
          text="When the app is built, a test suite is generated from its definition and appears here."
        />
      </div>
    );
  const suites = suiteOf(app),
    R: Partial<TestRun> = TESTS[app.id] || {},
    fresh = R.rev === app.rev,
    res = fresh ? R.res || {} : {},
    tv = testsViewOf(app.id),
    total = suites.reduce((n, s) => n + s.tests.length, 0);
  const done = Object.values(res),
    passed = done.filter((x) => x.ok).length,
    failed = done.length - passed,
    busy = !!R.running || !!RUNS[app.id],
    q = str(tv.q).toLowerCase();
  return (
    <div className="tests-view scroll" data-tour="tests">
      <div className="tests-head">
        <div className="col gap0 grow">
          <h2 className="t-sub1">Tests</h2>
          <span className="t-cap muted">
            Generated from this app&apos;s definition. Every table, link, access rule, workflow action, view, page and tour step is a test.
            They run against the real database and endpoints, and anything they write is rolled back.
          </span>
        </div>
        <Btn className="btn primary" disabled={busy} onClick={() => runTests(app)}>
          <Icon n="play" s="16" />
          {R.running ? 'Running' : 'Run all ' + total + ' tests'}
        </Btn>
      </div>
      <div className="kpis tk">
        <div className="kpi">
          <span className="kpi-l">Tests</span>
          <span className="kpi-v">{total}</span>
          <span className="kpi-s">
            {'in '}
            {suites.length}
            {' suites'}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Passed</span>
          <span className="kpi-v ok">{passed}</span>
          <span className="kpi-s">{done.length ? Math.round((passed / done.length) * 100) + '% of those run' : 'not run yet'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Failed</span>
          <span className={cx('kpi-v', failed && 'bad')}>{failed}</span>
          <span className="kpi-s">{failed ? 'open the suite to see why' : 'none'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Last run</span>
          <span className="kpi-v sm">{fresh && R.at ? ago(R.at) : 'Not since the last change'}</span>
          <span className="kpi-s">{fresh && R.at ? 'took ' + fmtMs(R.ms || 0) : 'run them again'}</span>
        </div>
      </div>
      <div className="row wrap">
        <Seg
          label="Which tests to show"
          items={[
            {
              id: 'all',
              label: 'All',
            },
            {
              id: 'failed',
              label: 'Failed' + (failed ? ' · ' + failed : ''),
            },
          ]}
          value={tv.only ? 'failed' : 'all'}
          onChange={(v) => {
            setTestsView(app.id, { only: v === 'failed' });
          }}
        />
        <div className="search">
          <Icon n="search" s="16" />
          <Input
            native
            className="input"
            id={'tq' + app.id}
            aria-label="Search tests"
            placeholder="Search tests"
            value={tv.q}
            onInput={(e) => {
              setTestsView(app.id, { q: (e.target as HTMLInputElement).value });
            }}
          />
        </div>
      </div>
      {suites.map((s) => {
        const got = s.tests.map((x) => res[x.id]).filter(Boolean),
          ok = got.filter((x) => x.ok).length,
          bad = got.length - ok,
          shut = tv.shut[s.id] != null ? tv.shut[s.id] : !(bad || q || tv.only) && s.tests.length > 14;
        if (tv.only && !bad) return null;
        return (
          <Card key={s.id} className={cx('card suite', bad && 'has-bad')}>
            <header className="suite-h">
              <button
                className="suite-t"
                aria-expanded={!shut}
                onClick={() => {
                  setTestsView(app.id, { shut: { ...tv.shut, [s.id]: !shut } });
                }}
              >
                <Icon n={shut ? 'chevRight' : 'chevDown'} s="16" />
                <AgentAv id={STATIONS.find((x) => x.id === s.station)?.agent || ''} size="sm" />
                <span className="col gap0">
                  <strong>{s.name}</strong>
                  <span className="t-cap muted">{s.about}</span>
                </span>
              </button>
              <span className={cx('badge', bad ? 'b-danger' : got.length === s.tests.length ? 'b-success' : 'b-neutral')}>
                {R.running === s.id ? <Spinner /> : null}
                {got.length ? ok + ' of ' + s.tests.length : s.tests.length + ' tests'}
              </span>
              <Btn className="btn sm" disabled={busy} onClick={() => runTests(app, (x) => x.id === s.id)}>
                <Icon n="play" s="16" />
                <span className="hide-sm">Run</span>
              </Btn>
            </header>
            {!shut && <TestRows app={app} suite={s} only={tv.only} q={q} />}
          </Card>
        );
      })}
    </div>
  );
}
export function StationTests({ app, st }: { app: AppRecord; st: Station }) {
  // the same tests, in the inspector of the station they belong to
  if (!testable(app)) return <p className="muted">Tests appear here when the app is built.</p>;
  const suites = suiteOf(app).filter((s) => s.station === st.id),
    R: Partial<TestRun> = TESTS[app.id] || {},
    busy = !!R.running || !!RUNS[app.id];
  if (!suites.length) return <p className="muted">This station has no tests of its own.</p>;
  return (
    <div className="col gap12">
      <div className="row between wrap">
        <span className="muted t-cap">
          {suites.reduce((n, s) => n + s.tests.length, 0)}
          {' tests generated from what this station wrote. They run against the real database and endpoints.'}
        </span>
        <div className="row">
          <Btn className="btn sm" disabled={busy} onClick={() => runTests(app, (x) => x.station === st.id)}>
            <Icon n="play" s="16" />
            Run these tests
          </Btn>
          <Btn
            className="btn subtle sm"
            onClick={() => {
              U.view[app.id] = 'tests';
              notify();
            }}
          >
            All tests
          </Btn>
        </div>
      </div>
      {suites.map((s) => (
        <div key={s.id}>
          <h4>{s.name}</h4>
          <TestRows app={app} suite={s} />
        </div>
      ))}
    </div>
  );
}
export function TestRows({ app, suite, only, q }: { app: AppRecord; suite: Suite; only?: boolean; q?: string }) {
  const R: Partial<TestRun> = TESTS[app.id] || {},
    res = R.rev === app.rev ? R.res || {} : {},
    busy = R.running === suite.id;
  const rows = suite.tests.filter((x) => (!only || (res[x.id] && !res[x.id].ok)) && (!q || x.name.toLowerCase().indexOf(q) >= 0));
  if (!rows.length) return null;
  return (
    <ul className="tests" tabIndex={0} aria-label={suite.name + ' tests'}>
      {rows.map((x) => {
        const r = res[x.id];
        return (
          <li key={x.id} className={cx('test', r ? (r.ok ? 'ok' : 'bad') : 'idle')}>
            {busy && !r ? <Spinner /> : <Icon n={r ? (r.ok ? 'checkCircle' : 'errorCircle') : 'circle'} s="16" />}
            <span className="test-n">{x.name}</span>
            <span className="test-x t-cap">{r ? r.actual || x.expect : 'expects: ' + x.expect}</span>
          </li>
        );
      })}
    </ul>
  );
}
function setTestsView(appId: string, patch: Partial<TestsViewState>) {
  U.tv[appId] = { ...testsViewOf(appId), ...patch };
  notify();
}
function testsViewOf(appId: string): TestsViewState {
  return (U.tv[appId] as TestsViewState | undefined) || { only: false, q: '', shut: {} };
}
/** what the Tests view shows: only failures, a search, and which suites are folded */
interface TestsViewState {
  only: boolean;
  q: string;
  shut: Dict<boolean>;
}
