/*
 * Agent activity: a panel that shows which agent is working, on what step, which tools it called, who handed work
 * to whom, and which checks sent work back. It reads AG-UI events: the workspace's own log (EV) and, through the
 * bus in src/platform/agui/activity.ts, the events of agents that run on the server. A second tab, "How it works",
 * draws the build team and the workflow this app runs on, plus the app's own agent team when it has one.
 */
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  FluentProvider,
  OverlayDrawer,
  Switch,
  Tab,
  TabList,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';
import { deriveActivity, subscribeAgentEvents } from '@/platform/agui/activity';
import type { ActivityItem, ActivityKind, ActivityModel, AgentState, AgentStatus, RawAgentEvent } from '@/platform/agui/activity';
import type { AppRecord, AppFlow, Dict, ReviewerInfo } from '@/shared/types/workspace';
import { EV, PHONE, S, cap, cx, emit, fmtClock } from './core';
import { AGENTS } from './agents';
import { STATIONS } from './line';
import { REVIEWERS, flowOf } from './custom';
import { isDark } from './flow';
import { Icon } from './ui';

// custom.tsx is not typed yet; these say what its exports hold
const REVS = REVIEWERS as Dict<ReviewerInfo>;
const flowOfApp = (app: AppRecord): AppFlow => flowOf(app);

/** What the panel shows for one agent. */
export interface AgentCard {
  id: string;
  name: string;
  icon: string;
  acc: string;
  role: string;
}

/* ---------- who is who ---------- */

// the roles of agent `step` on the server (src/shared/agent-contract.ts), as the builder agent that plays them
const ROLE_AGENT: Dict<string> = {
  research: 'researcher',
  database: 'database',
  backend: 'backend',
  views: 'views',
  screens: 'ui',
  walkthrough: 'ui',
  tests: 'tester',
};

/** The agent a step belongs to, when the event does not name one. */
export function agentOfEvent(e: RawAgentEvent | null | undefined): string | null {
  const s = e && e.stepName;
  if (typeof s !== 'string') return null;
  const st = STATIONS.find((x) => x.id === s);
  if (st) return st.agent;
  if (s === 'tests') return 'tester';
  if (s.startsWith('review_')) return 'rv_' + s.slice(7);
  return null;
}

/** Name, icon, colour and job of an agent: a builder, a reviewer, or one of an app's own team. */
export function agentInfo(id: string | null | undefined, app?: AppRecord | null): AgentCard {
  id = id || '';
  const key = AGENTS[id] ? id : ROLE_AGENT[id];
  const a = key && AGENTS[key];
  if (a) return { id, name: a.name, icon: a.icon, acc: a.acc, role: a.role };
  const t = app && app.def && app.def.team && app.def.team.agents.find((x) => x.id === id);
  if (t) return { id, name: t.name, icon: t.icon || 'bot', acc: t.acc || 'steel', role: t.job };
  for (const other of Object.values(S.apps || {})) {
    const o = other.def && other.def.team && other.def.team.agents.find((x) => x.id === id);
    if (o) return { id, name: o.name, icon: o.icon || 'bot', acc: o.acc || 'steel', role: o.job };
  }
  return { id, name: cap(String(id || 'Agent').replace(/_/g, ' ')), icon: 'bot', acc: 'steel', role: '' };
}

function Av({ info, size }: { info: AgentCard; size?: 'xs' }) {
  return (
    <span className={cx('av sq', size && 'av-' + size, 'acc-' + info.acc)} title={info.name + ' agent'} aria-hidden="true">
      <Icon n={info.icon} s={size === 'xs' ? '12' : '16'} />
    </span>
  );
}

/* ---------- the model, from the events ---------- */

let cache: { key: string; model: ActivityModel | null } = { key: '', model: null };
/** The activity of one app (or of every app with no id), derived from the event log. */
export function activityNow(appId?: string | null): ActivityModel {
  const last = EV.length ? EV[EV.length - 1].seq : 0;
  const key = (appId || '*') + ':' + EV.length + ':' + last;
  let model = cache.model;
  if (cache.key !== key || !model) {
    model = deriveActivity(EV, { agentOf: agentOfEvent, app: appId || null });
    cache = { key, model };
  }
  return model;
}

// server agents publish their AG-UI events on the bus; the workspace log keeps them with everything else
let bridged = false;
export function startActivityBridge() {
  if (bridged) return;
  bridged = true;
  subscribeAgentEvents((e) => {
    const { type, ...rest } = e;
    delete rest.seq; // the log numbers and times its own events
    delete rest.t;
    emit(type, rest);
  });
}

/* ---------- words ---------- */

const STEP_WORDS: Dict<string> = {
  guard: 'checking the request',
  draft: 'writing a draft',
  validate: 'checking the draft',
  repair: 'fixing the draft',
  finish: 'finishing',
};
type StepRef = Pick<ActivityItem, 'step' | 'server'>;
const stepName = (it: StepRef): string => {
  if (!it.step) return 'a step';
  if (it.server) return STEP_WORDS[it.step] || it.step;
  const st = STATIONS.find((x) => x.id === it.step);
  if (st) return st.name;
  if (it.step === 'tests') return 'Tests';
  if (it.step.startsWith('review_')) return REVS[it.step.slice(7)]?.short || 'a review';
  return cap(it.step.replace(/_/g, ' '));
};
// "the Research station", "the security review", "Tests": how a step reads in a sentence
const stepPhrase = (it: StepRef): string => {
  if (!it.server && STATIONS.some((x) => x.id === it.step)) return 'the ' + stepName(it) + ' station';
  if (!it.server && it.step && it.step.startsWith('review_')) return 'the ' + stepName(it).toLowerCase();
  return stepName(it);
};
const plural = (n: number | undefined, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's');

function sentence(it: ActivityItem, app: AppRecord | null): string {
  const who = it.agent ? agentInfo(it.agent, app).name : 'The run';
  switch (it.kind) {
    case 'run_started':
      return 'A run started.';
    case 'run_finished':
      return it.status === 'failed' ? 'The run ended without passing.' : 'The run finished.';
    case 'run_failed':
      return 'The run stopped. ' + it.text;
    case 'step_started':
      return it.server ? who + ' is ' + stepName(it) + ' on the server.' : who + ' started ' + stepPhrase(it) + '.';
    case 'step_finished':
      return it.server ? who + ' finished ' + stepName(it) + '.' : who + ' finished ' + stepPhrase(it) + '.';
    case 'message':
      return it.text;
    case 'tool_call':
      return who + ' called ' + it.text + '.';
    case 'checks':
      return it.failed
        ? 'Code checked the hand-off: ' + it.passed + ' passed, ' + it.failed + ' failed.'
        : 'Code checked the hand-off: all ' + plural(it.passed, 'check') + ' passed.';
    case 'sent_back':
      return 'A check failed, so the work went back to ' + who + ' (' + plural(it.failed, 'problem') + ').';
    case 'issues':
      return 'The check found ' + plural(it.failed, 'problem') + (it.text ? ': ' + it.text : '.');
    case 'waiting':
      return it.reason === 'approval'
        ? 'Waiting for your approval before going on.'
        : it.reason === 'jump_in'
          ? 'Paused so you can add a point of your own.'
          : 'Waiting for your answer' + (it.text ? ': ' + it.text : '.');
    case 'resumed':
      return 'Carried on.';
    case 'state':
      return 'Updated the shared state: ' + it.text + '.';
    case 'handoff':
      return agentInfo(it.from, app).name + ' handed the work to ' + who + '.';
    default:
      return '';
  }
}

const KIND_ICON: Record<ActivityKind, string> = {
  run_started: 'flow',
  run_finished: 'checkCircle',
  run_failed: 'errorCircle',
  step_started: 'play',
  step_finished: 'check',
  message: 'comment',
  tool_call: 'wrench',
  checks: 'shield',
  sent_back: 'undo',
  issues: 'warning',
  waiting: 'handRight',
  resumed: 'forward',
  state: 'braces',
  handoff: 'arrowRight',
};
type Filter = 'all' | 'steps' | 'tools' | 'checks';
const FILTERS: Record<Filter, (it: ActivityItem) => boolean> = {
  all: () => true,
  steps: (it) =>
    ['step_started', 'step_finished', 'handoff', 'waiting', 'resumed', 'run_started', 'run_finished', 'run_failed'].includes(it.kind),
  tools: (it) => it.kind === 'tool_call',
  checks: (it) => ['checks', 'sent_back', 'issues'].includes(it.kind),
};
const STATE_BADGE: Record<AgentState, { color: 'brand' | 'warning' | 'success' | 'danger' | 'informative'; text: string }> = {
  working: { color: 'brand', text: 'Working' },
  waiting: { color: 'warning', text: 'Waiting for you' },
  done: { color: 'success', text: 'Done' },
  failed: { color: 'danger', text: 'Stopped' },
  idle: { color: 'informative', text: 'Not started' },
};

/* ---------- styles (Fluent tokens) ---------- */

const useStyles = makeStyles({
  launch: {
    position: 'fixed',
    left: 0,
    top: '50%',
    transform: 'translateY(-50%) rotate(180deg)',
    writingMode: 'vertical-rl',
    minWidth: 0,
    height: 'auto',
    padding: tokens.spacingVerticalM + ' ' + tokens.spacingHorizontalXS,
    borderTopLeftRadius: tokens.borderRadiusLarge,
    borderBottomLeftRadius: tokens.borderRadiusLarge,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    zIndex: 40,
    boxShadow: tokens.shadow8,
  },
  launchPhone: { top: 'auto', bottom: '96px', transform: 'rotate(180deg)' },
  drawer: { width: '440px', maxWidth: '100vw' },
  head: { paddingBottom: tokens.spacingVerticalS },
  bar: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  grow: { flexGrow: 1 },
  section: { marginTop: tokens.spacingVerticalL },
  sectionTitle: { display: 'block', marginBottom: tokens.spacingVerticalS },
  roster: { display: 'grid', gap: tokens.spacingVerticalXS },
  agent: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingVerticalXS + ' ' + tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    border: '1px solid ' + tokens.colorNeutralStroke2,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  agentOn: { border: '1px solid ' + tokens.colorBrandStroke1, backgroundColor: tokens.colorBrandBackground2 },
  sub: { color: tokens.colorNeutralForeground3, display: 'block' },
  feed: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: tokens.spacingVerticalXS },
  item: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingVerticalXS + ' 0',
    borderBottom: '1px solid ' + tokens.colorNeutralStroke3,
  },
  itemText: { overflowWrap: 'anywhere' },
  meta: { display: 'flex', gap: tokens.spacingHorizontalXS, alignItems: 'center', color: tokens.colorNeutralForeground3 },
  quote: { fontStyle: 'italic', color: tokens.colorNeutralForeground2 },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
  bad: { color: tokens.colorPaletteRedForeground1 },
  good: { color: tokens.colorPaletteGreenForeground1 },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    padding: tokens.spacingVerticalXS + ' ' + tokens.spacingHorizontalS,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    margin: tokens.spacingVerticalXXS + ' 0 0',
  },
  empty: { color: tokens.colorNeutralForeground3, padding: tokens.spacingVerticalL + ' 0' },
  pipe: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0 },
  station: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingVerticalS + ' ' + tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    border: '1px solid ' + tokens.colorNeutralStroke2,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: tokens.spacingVerticalXXS + ' 0 ' + tokens.spacingVerticalXXS + ' 22px',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXS, marginTop: tokens.spacingVerticalXXS },
  steps: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  para: { display: 'block', marginBottom: tokens.spacingVerticalS, color: tokens.colorNeutralForeground2 },
});

type Styles = ReturnType<typeof useStyles>;

/* ---------- the panel ---------- */

export function AgentActivity({ app }: { app: AppRecord | null }) {
  const c = useStyles();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>('activity');
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState<Dict<boolean>>({});
  useEffect(() => startActivityBridge(), []);
  const scope = all || !app ? null : app.id;
  const model = activityNow(scope);
  const working = Object.values(model.agents).filter((a) => a.state === 'working' || a.state === 'waiting').length;
  const theme = isDark() ? webDarkTheme : webLightTheme;

  const roster = rosterOf(app, model);
  const items = model.items.filter(FILTERS[filter]).slice().reverse();

  return (
    <FluentProvider theme={theme} className="act-root" style={{ background: 'transparent' }}>
      <Button
        className={mergeClasses('act-launch', c.launch, PHONE() && c.launchPhone)}
        appearance={working ? 'primary' : 'secondary'}
        icon={<Icon n="team" s="16" />}
        aria-expanded={open}
        aria-label={'Agent activity' + (working ? ', ' + plural(working, 'agent') + ' working' : '')}
        onClick={() => setOpen(!open)}
      >
        {working ? 'Agents · ' + working + ' working' : 'Agents'}
      </Button>
      <OverlayDrawer
        open={open}
        position="end"
        modalType="non-modal"
        onOpenChange={(_, d) => setOpen(d.open)}
        className={mergeClasses('act-panel', c.drawer)}
        aria-label="Agent activity"
      >
        <DrawerHeader className={c.head}>
          <DrawerHeaderTitle
            action={<Button appearance="subtle" aria-label="Close" icon={<Icon n="dismiss" s="16" />} onClick={() => setOpen(false)} />}
          >
            Agents at work
          </DrawerHeaderTitle>
          <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(String(d.value))} aria-label="Agent panel">
            <Tab value="activity" className="act-tab-activity">
              Activity
            </Tab>
            <Tab value="how" className="act-tab-how">
              How it works
            </Tab>
          </TabList>
        </DrawerHeader>
        <DrawerBody>
          {tab === 'activity' ? (
            <>
              <div className={c.bar}>
                <Text size={200} className={c.grow}>
                  {scope && app ? 'This app: ' + app.name : 'Every app in this workspace'}
                </Text>
                {app && <Switch className="act-all" label="All apps" checked={all} onChange={(_, d) => setAll(d.checked)} />}
              </div>
              <div className={c.section}>
                <Text weight="semibold" className={c.sectionTitle}>
                  Who is working
                </Text>
                {roster.length ? (
                  <div className={c.roster}>
                    {roster.map(({ info, st }) => {
                      const b = STATE_BADGE[st.state];
                      return (
                        <div
                          key={info.id}
                          className={mergeClasses('act-agent', c.agent, st.state === 'working' && c.agentOn)}
                          data-agent={info.id}
                          data-state={st.state}
                        >
                          <Av info={info} />
                          <div>
                            <Text weight="semibold">{info.name}</Text>
                            <Text size={200} className={c.sub}>
                              {st.step ? 'On ' + stepName({ step: st.step, server: false }) : info.role}
                              {st.tools ? ' · ' + plural(st.tools, 'tool call') : ''}
                              {st.sentBack ? ' · sent back ' + (st.sentBack === 1 ? 'once' : st.sentBack + ' times') : ''}
                            </Text>
                          </div>
                          <Badge appearance="tint" color={b.color} size="small">
                            {b.text}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Text className={c.empty}>No agents yet.</Text>
                )}
              </div>
              <div className={c.section}>
                <div className={c.bar}>
                  <Text weight="semibold" className={c.grow}>
                    What happened
                  </Text>
                </div>
                <TabList size="small" selectedValue={filter} onTabSelect={(_, d) => setFilter(d.value as Filter)} aria-label="Show">
                  <Tab value="all">Everything</Tab>
                  <Tab value="steps">Steps and hand-offs</Tab>
                  <Tab value="tools">Tool calls</Tab>
                  <Tab value="checks">Checks</Tab>
                </TabList>
                {items.length ? (
                  <ol className={mergeClasses('act-feed', c.feed)} aria-live="polite">
                    {items.map((it) => {
                      const info = it.agent ? agentInfo(it.agent, app) : agentInfo('orchestrator', app);
                      const k = it.kind + ':' + it.seq + ':' + (it.toolCallId || '');
                      const tone =
                        it.kind === 'sent_back' || it.kind === 'issues' || it.kind === 'waiting'
                          ? c.warn
                          : it.kind === 'run_failed' || (it.kind === 'checks' && it.failed)
                            ? c.bad
                            : it.kind === 'checks' || it.kind === 'run_finished'
                              ? c.good
                              : undefined;
                      return (
                        <li key={k} className={mergeClasses('act-item', c.item)} data-kind={it.kind} data-agent={it.agent || ''}>
                          <Av info={info} size="xs" />
                          <div>
                            <div className={c.meta}>
                              <span className={tone}>
                                <Icon n={KIND_ICON[it.kind] || 'circle'} s="12" />
                              </span>
                              <Text size={100}>
                                {info.name}
                                {it.t ? ' · ' + fmtClock(it.t) : ''}
                                {it.server ? ' · server' : ''}
                                {it.attempt ? ' · attempt ' + it.attempt : ''}
                              </Text>
                            </div>
                            <Text size={200} className={mergeClasses(c.itemText, it.kind === 'message' && c.quote, tone)}>
                              {sentence(it, app)}
                            </Text>
                            {it.kind === 'tool_call' && (it.args || it.result) && (
                              <>
                                <Button
                                  size="small"
                                  appearance="transparent"
                                  className="act-more"
                                  onClick={() => setShown({ ...shown, [k]: !shown[k] })}
                                  aria-expanded={!!shown[k]}
                                >
                                  {shown[k] ? 'Hide input and result' : 'Show input and result'}
                                </Button>
                                {shown[k] && (
                                  <>
                                    {it.args && <pre className={c.code}>{'Input  ' + it.args}</pre>}
                                    {it.result && <pre className={c.code}>{'Result ' + it.result}</pre>}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <Text className={mergeClasses('act-empty', c.empty)} block>
                    {model.items.length
                      ? 'Nothing of this kind yet.'
                      : "No agent has worked here yet. Start a build, or run an app's team, and every step shows here as it happens."}
                  </Text>
                )}
              </div>
            </>
          ) : (
            <HowItWorks app={app} model={activityNow(app ? app.id : null)} c={c} />
          )}
        </DrawerBody>
      </OverlayDrawer>
    </FluentProvider>
  );
}

/** The agents to list: this app's team (builders, reviewers it uses, its own team) and anyone else seen in the events. */
function rosterOf(app: AppRecord | null, model: ActivityModel): { info: AgentCard; st: AgentStatus }[] {
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  if (app) {
    STATIONS.forEach((s) => add(s.agent));
    if (AGENTS.tester) add('tester');
    const f = flowOfApp(app);
    (f.reviewers || []).forEach((r) => add('rv_' + r));
    if (app.def && app.def.team) app.def.team.agents.forEach((a) => add(a.id));
  }
  Object.keys(model.agents)
    .filter((id) => id !== 'orchestrator')
    .forEach(add);
  return ids.map((id) => ({
    info: agentInfo(id, app),
    st: model.agents[id] || ({ id, state: 'idle', step: null, steps: 0, tools: 0, sentBack: 0, last: 0 } satisfies AgentStatus),
  }));
}

/* ---------- how it works ---------- */

function HowItWorks({ app, model, c }: { app: AppRecord | null; model: ActivityModel; c: Styles }) {
  const f = app ? flowOfApp(app) : null;
  const attempts = f && f.attempts >= 1 && f.attempts <= 3 ? f.attempts : 3;
  const team = app && app.def && app.def.team;
  const stateOf = (id: string): AgentState => (model.agents[id] ? model.agents[id].state : 'idle');
  const stations = STATIONS.concat(
    AGENTS.tester ? [{ id: 'tests', name: 'Tests', agent: 'tester', out: 'tests', makes: 'Test cases, run and repaired' }] : [],
  );
  return (
    <div className="act-how">
      <Text className={c.para}>
        {'Turnkey builds an app with a team of agents. Each agent does one job and hands its work to the next. Code, not a model, checks every hand-off: if a check fails, the work goes back to the same agent with the problems listed, up to ' +
          plural(attempts, 'attempt') +
          ' per station.'}
      </Text>

      <div className={c.section}>
        <Text weight="semibold" className={c.sectionTitle}>
          {app ? 'The workflow this app is built on' : 'The standard build workflow'}
        </Text>
        <ol className={c.pipe}>
          <li className={mergeClasses('hiw-station', c.station)} data-station="request">
            <span className="av sq acc-steel" aria-hidden="true">
              <Icon n="person" s="16" />
            </span>
            <div>
              <Text weight="semibold">You</Text>
              <Text size={200} className={c.sub}>
                Describe the app in one sentence.
              </Text>
            </div>
          </li>
          {stations.map((st, i) => {
            const info = agentInfo(st.agent, app);
            const s = stateOf(st.agent);
            const reviewers = f ? (f.reviewers || []).filter((r) => REVS[r] && REVS[r].after === st.id) : [];
            const asks = f && f.approve && f.approve[st.id];
            const byRules = f && f.by && f.by[st.id] === 'rules';
            return (
              <li key={st.id}>
                <div className={c.link}>
                  <Icon n="arrowDown" s="12" />
                  {i === 0 ? 'the request' : 'hand-off, checked by code'}
                </div>
                <div className={mergeClasses('hiw-station', c.station, s === 'working' && c.agentOn)} data-station={st.id} data-state={s}>
                  <Av info={info} />
                  <div>
                    <div className={c.bar}>
                      <Text weight="semibold" className={c.grow}>
                        {i + 1 + '. ' + st.name}
                      </Text>
                      {s !== 'idle' && (
                        <Badge appearance="tint" size="small" color={STATE_BADGE[s].color}>
                          {STATE_BADGE[s].text}
                        </Badge>
                      )}
                    </div>
                    <Text size={200} className={c.sub}>
                      {(byRules ? 'Built by rules, no model' : info.name) + ' · makes ' + String(st.makes).toLowerCase()}
                    </Text>
                    {(reviewers.length > 0 || asks) && (
                      <div className={c.chips}>
                        {reviewers.map((r) => (
                          <Badge key={r} appearance="outline" size="small" icon={<Icon n={REVS[r].icon} s="12" />}>
                            {'Then ' + REVS[r].name}
                          </Badge>
                        ))}
                        {asks && (
                          <Badge appearance="outline" size="small" color="warning" icon={<Icon n="handRight" s="12" />}>
                            Asks for your approval
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          <li>
            <div className={c.link}>
              <Icon n="arrowDown" s="12" />
              every test passes
            </div>
            <div className={mergeClasses('hiw-station', c.station)} data-station="app">
              <span className="av sq acc-forest" aria-hidden="true">
                <Icon n="rocket" s="16" />
              </span>
              <div>
                <Text weight="semibold">The app</Text>
                <Text size={200} className={c.sub}>
                  Its own SQLite database, rules, views, pages and tests. You can release it and share it.
                </Text>
              </div>
            </div>
          </li>
        </ol>
        <Text size={200} className={c.para} style={{ marginTop: tokens.spacingVerticalS }}>
          The Orchestrator is code, not a model. It runs the stations in order, stops for your answer or approval when the workflow asks for
          it, and you can change the workflow: add a review, ask for approval after a station, or build a station by rules.
        </Text>
      </div>

      <div className={c.section}>
        <Text weight="semibold" className={c.sectionTitle}>
          One agent&apos;s turn
        </Text>
        <div className={c.steps}>
          {['Check the request', 'Write a draft', 'Check the draft', 'Fix what failed', 'Hand over'].map((s, i, a) => (
            <span key={s} className={c.steps}>
              <Badge appearance={i === 3 ? 'outline' : 'tint'} color={i === 3 ? 'warning' : 'brand'}>
                {s}
              </Badge>
              {i < a.length - 1 && <Icon n="arrowRight" s="12" />}
            </span>
          ))}
        </div>
        <Text size={200} className={c.para} style={{ marginTop: tokens.spacingVerticalS }}>
          {'In Live mode each turn runs on the server and streams its steps to this panel as AG-UI events. The draft must match a fixed shape; when it does not, the agent gets the problems back and tries again, at most ' +
            plural(attempts, 'time') +
            '. In Demo mode the same steps replay from a saved build, so nothing calls a model.'}
        </Text>
      </div>

      {team && (
        <div className={c.section}>
          <Text weight="semibold" className={c.sectionTitle}>
            {team.title || "This app's own team"}
          </Text>
          <Text size={200} className={c.para}>
            {team.about}
          </Text>
          <ol className={c.pipe}>
            {team.agents.map((a, i) => {
              const info = agentInfo(a.id, app);
              const s = stateOf(a.id);
              const tools = (a.tools || []).map((t) => t.connector + (t.tool ? ' · ' + t.tool.replace(/_/g, ' ') : ''));
              return (
                <li key={a.id}>
                  {i > 0 && (
                    <div className={c.link}>
                      <Icon n="arrowDown" s="12" />
                      {team.pause && team.pause.before === a.id ? 'pauses so a person can add a point' : 'hands over its rows'}
                    </div>
                  )}
                  <div className={mergeClasses('hiw-team', c.station, s === 'working' && c.agentOn)} data-agent={a.id} data-state={s}>
                    <Av info={info} />
                    <div>
                      <Text weight="semibold">{a.name}</Text>
                      <Text size={200} className={c.sub}>
                        {a.job}
                      </Text>
                      {tools.length > 0 && (
                        <div className={c.chips}>
                          {tools.map((t) => (
                            <Badge key={t} appearance="outline" size="small" icon={<Icon n="plug" s="12" />}>
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
