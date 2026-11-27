import { useState, type ReactNode } from 'react';
import {
  AGENT_NAMES,
  accessRows,
  answerText,
  cardsToAsk,
  stagePath,
  teamFor,
  type PlanSpec,
  type PlanTeam,
  type QuestionCard,
} from '@/shared/plan';
import type { Interview } from '@/shared/types/interview';
import { AGENTS } from './agents';
import { cx } from './core';
import {
  answerInWords,
  backToQuestions,
  buildIt,
  changeAnswer,
  confirmTicks,
  currentCard,
  interviewNow,
  leaveInterview,
  pickOption,
  planNow,
  retryPlanner,
  reviewPlan,
  setDemoData,
  skipCard,
  takesWords,
  ticksOf,
  takeUsual,
} from './interview';
import { STATIONS } from './line';
import { REVIEWERS } from './reviewers';
import { Btn, Card, Icon, Input, MBar, Spinner, Switch, refocus, useFocusOnArrive } from './ui';

/* ===== The interview before a build, as the owner sees it =====
   Two screens on the Home tab after "Continue": the question cards with the plan filling in beside them, then the
   plan to approve. Both draw the same plan (src/shared/plan), so what the cards show is what "Build it" builds. */

const count = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
const kinds = (n: number) => count(n, 'kind of person', 'kinds of people');
const aOrAn = (word: string) => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;
/** the Planner is the first agent on the line (read when drawn: line.ts and this file import each other) */
const plannerId = () => STATIONS[0].agent;

/** An agent's square badge: a builder agent, a reviewer, or the owner. */
function Who({ id }: { id: string }) {
  const a = AGENTS[id] || REVIEWERS[id];
  if (!a)
    return (
      <span className="av sq av-sm iv-you" aria-hidden="true">
        <Icon n="person" s="16" />
      </span>
    );
  return (
    <span className={'av sq av-sm acc-' + a.acc} aria-hidden="true">
      <Icon n={a.icon} s="16" />
    </span>
  );
}

function Section({ title, badge, cls, children }: { title: string; badge?: ReactNode; cls?: string; children: ReactNode }) {
  return (
    <Card className={cx('card iv-sec', cls)}>
      <div className="row between gap8">
        <h3 className="t-sub2">{title}</h3>
        {badge}
      </div>
      {children}
    </Card>
  );
}
/** A section the plan cannot fill in yet, saying what it waits for. */
const Waiting = ({ children }: { children: ReactNode }) => <div className="iv-wait muted">{children}</div>;

/* ---------- the parts of a plan ---------- */

function People({ plan }: { plan: PlanSpec }) {
  return (
    <Section title="Who uses it" badge={<span className="badge b-neutral">{kinds(plan.people.length)}</span>} cls="iv-people">
      <ul className="iv-list">
        {plan.people.map((p) => (
          <li key={p.id} className="iv-person">
            <Icon n="person" />
            <span className="col gap0">
              <strong>{p.name}</strong>
              <span className="t-cap muted">{p.can}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Moves({ plan, waiting }: { plan: PlanSpec; waiting?: QuestionCard | null }) {
  const st = plan.stages,
    moved = st ? plan.lists.find((l) => l.name === st.list) : plan.lists[0],
    one = moved ? moved.one : 'record',
    path = st ? stagePath(st) : null;
  return (
    <Section title={'How ' + aOrAn(one) + ' moves'} cls="iv-moves">
      {waiting ? (
        <Waiting>
          {'Waiting for your answer: '}
          {waiting.title}
        </Waiting>
      ) : st && path ? (
        <>
          <div className="iv-flow">
            {path.main.map((s, i) => (
              <span key={s} className="row gap4">
                {i > 0 && <Icon n="chevRight" s="16" cls="muted" />}
                <span className="iv-stage">{s}</span>
              </span>
            ))}
          </div>
          {path.also.length > 0 && (
            <div className="iv-flow iv-also">
              <span className="t-cap muted">Also</span>
              {path.also.map((s) => (
                <span key={s} className="iv-stage">
                  {s}
                </span>
              ))}
            </div>
          )}
          {st.note && <p className="muted">{st.note}</p>}
        </>
      ) : (
        <p className="muted">
          {'No approval steps. '}
          {aOrAn(one).replace(/^a/, 'A')}
          {' is saved as soon as it is added.'}
        </p>
      )}
    </Section>
  );
}

/** The lists as tags (beside the questions) or as a table with every field (on the plan). */
function Keeps({ plan, full }: { plan: PlanSpec; full?: boolean }) {
  const fields = plan.lists.reduce((n, l) => n + l.fields.length, 0),
    badge = (
      <span className="badge b-neutral">
        {count(plan.lists.length, 'list', 'lists')}
        {full ? ', ' + count(fields, 'field', 'fields') : ''}
      </span>
    );
  if (!full)
    return (
      <Section title="What it keeps" badge={badge} cls="iv-keeps">
        <div className="row wrap gap8">
          {plan.lists.map((l) => (
            <span key={l.name} className="iv-stage">
              <Icon n="table" s="16" />
              {l.label}
            </span>
          ))}
        </div>
        <p className="t-cap muted">Each one is a list of records with its own screens.</p>
      </Section>
    );
  return (
    <Section title="What it keeps" badge={badge} cls="iv-keeps">
      <div className="iv-tbox">
        <table className="iv-tbl">
          <thead>
            <tr>
              <th scope="col">List</th>
              <th scope="col">What each record holds</th>
            </tr>
          </thead>
          <tbody>
            {plan.lists.map((l) => (
              <tr key={l.name}>
                <th scope="row">
                  {l.label}
                  {l.settings && <span className="badge b-outline iv-set">Starter settings</span>}
                </th>
                <td>{l.fields.map((f) => f.label).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.lists.some((l) => l.settings) && (
        <p className="t-cap muted">Starter settings such as categories and limits are not demo data. They stay.</p>
      )}
    </Section>
  );
}

function Access({ plan }: { plan: PlanSpec }) {
  const rows = accessRows(plan);
  if (!rows.length) return null;
  return (
    <Section title="Who can see and do what" cls="iv-access">
      <div className="iv-tbox">
        <table className="iv-tbl">
          <thead>
            <tr>
              <td />
              {plan.people.map((p) => (
                <th key={p.id} scope="col" className="c">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.what}>
                <th scope="row">{r.what}</th>
                {r.cells.map((c, i) => (
                  <td key={i} className={'c iv-' + c.tone}>
                    {c.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Rules({ plan }: { plan: PlanSpec }) {
  if (!plan.rules.length) return null;
  return (
    <Section title="Rules" cls="iv-rules">
      <ul className="iv-list">
        {plan.rules.map((r) => (
          <li key={r} className="iv-rule">
            <Icon n="check" s="16" cls="iv-yes" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const demoText = (on: boolean) =>
  on
    ? 'Made-up records and people, marked as demo data, so every screen has something to show. You remove them in one step when you are done.'
    : 'Off. The app starts empty: only the people who sign in and the starter settings are there.';

/** Demo data beside the questions: what was chosen, or that it is asked last. */
function Demo({ iv, plan }: { iv: Interview; plan: PlanSpec }) {
  const open = !iv.answers.demo_data;
  return (
    <Section title="Demo data" badge={<span className="badge iv-demo">Demo</span>} cls="iv-demodata">
      {open ? (
        <Waiting>Asked last. You choose whether the app starts with made-up records to try.</Waiting>
      ) : (
        <p>{demoText(plan.demoData)}</p>
      )}
    </Section>
  );
}

/** The plan's switches: demo data is the owner's to flip; the overview and helpers are stated. */
function Extras({ plan }: { plan: PlanSpec }) {
  return (
    <Section title="Extras" cls="iv-extras">
      <Switch id="iv-demo" on={plan.demoData} onChange={setDemoData} text={<strong>Demo data</strong>} />
      <p className="t-cap muted" id="iv-demo-text">
        {demoText(plan.demoData)}
      </p>
      {plan.overview && (
        <>
          <strong>Overview</strong>
          <p className="t-cap muted">A first screen with the numbers and charts that matter for this app.</p>
        </>
      )}
      {plan.helpers && (
        <>
          <strong>AI helpers inside the app</strong>
          <p className="t-cap muted">{plan.helpers}</p>
        </>
      )}
    </Section>
  );
}

function Assumed({ iv, plan }: { iv: Interview; plan: PlanSpec }) {
  const assumed = plan.answers.filter((a) => a.by === 'assumed' && a.slot !== 'demo_data'),
    gaps = plan.notInThisVersion;
  if (!assumed.length && !gaps.length) return null;
  return (
    <div className="col gap16">
      {assumed.length > 0 && (
        <Section title="I assumed" cls="iv-assumed">
          <ul className="iv-list">
            {assumed.map((a) => (
              <li key={a.slot} className="row between gap8">
                <span>
                  {a.question} <strong>{a.answer}</strong>
                </span>
                {iv.cards.some((c) => c.id === a.slot) && (
                  <button className="iv-link" onClick={() => changeAnswer(a.slot)} aria-label={'Change the answer to: ' + a.question}>
                    Change
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {gaps.length > 0 && (
        <Section title="Not in this version" cls="iv-gaps">
          <p className="t-cap muted">You asked for these or would expect them. Turnkey cannot build them yet and says so now.</p>
          <ul className="iv-list">
            {gaps.map((g) => (
              <li key={g.ask}>
                {g.ask}
                {'. '}
                <span className="muted">
                  {g.instead}
                  {/[.!?]$/.test(g.instead) ? '' : '.'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const teamLine = (t: PlanTeam) => count(t.agents, 'agent', 'agents') + (t.pauses.length ? ', and one pause for you' : '');

/** Who works on it: the agents the plan needs, each with its reason, the owner's pause, and who is not needed. */
function Team({ plan, title }: { plan: PlanSpec; title: string }) {
  const t = teamFor(plan),
    rows: { id: string; who: string; why: string; tag: string }[] = [];
  t.steps.forEach((s) => {
    if (s.by === 'agent' && s.agent) rows.push({ id: s.agent, who: s.who, why: s.why, tag: s.name });
    t.reviews.filter((r) => r.after === s.id).forEach((r) => rows.push({ id: r.id, who: r.who, why: r.why, tag: 'Added for this app' }));
    t.pauses
      .filter((p) => p.after === s.id)
      .forEach((p) => rows.push({ id: 'you', who: 'You', why: p.why, tag: 'A pause for your approval' }));
  });
  return (
    <Section title={title} badge={<span className="badge b-info">{teamLine(t)}</span>} cls="iv-team">
      <ul className="iv-list iv-agents">
        {rows.map((r) => (
          <li key={r.id + r.tag} className="iv-agent" data-agent={r.id}>
            <Who id={r.id} />
            <span className="col gap0 grow">
              <span className="iv-agent-top">
                <strong>{r.who}</strong>
                <span className="badge b-outline">{r.tag}</span>
              </span>
              <span className="t-cap muted">{r.why}</span>
            </span>
          </li>
        ))}
        {t.notNeeded.map((n) => (
          <li key={n.agent} className="iv-agent off" data-off={n.agent}>
            <span className="av sq av-sm iv-off" aria-hidden="true">
              <Icon n="dismiss" s="16" />
            </span>
            <span className="col gap0 grow">
              <span className="muted">
                {n.who}
                {': not needed'}
              </span>
              <span className="t-cap muted">{n.why}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ---------- the Planner's side: what it says, the answers, the card ---------- */

function PlannerHead({ sub }: { sub: string }) {
  return (
    <div className="row gap8">
      <Who id={plannerId()} />
      <span className="col gap0">
        <strong>{AGENT_NAMES[plannerId()] || AGENTS[plannerId()].name}</strong>
        <span className="t-cap muted">{sub}</span>
      </span>
    </div>
  );
}

/** The answers so far, each with Change. */
function Answered({ iv, except }: { iv: Interview; except?: string }) {
  const done = cardsToAsk(iv.cards, iv.answers).filter((c) => iv.answers[c.id] && c.id !== except);
  if (!done.length) return null;
  return (
    <ul className="iv-list iv-answered">
      {done.map((c) => (
        <li key={c.id} className="col gap4" data-card={c.id}>
          <span className="t-cap muted">{c.title}</span>
          <span className="row gap8 end">
            <button className="iv-link t-cap" onClick={() => changeAnswer(c.id)} aria-label={'Change the answer to: ' + c.title}>
              Change
            </button>
            <span className="iv-me">
              {answerText(c, iv.answers[c.id])}
              {iv.answers[c.id].by === 'usual' && <span className="t-cap muted"> · usual choice</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AskCard({ iv, card }: { iv: Interview; card: QuestionCard }) {
  const [words, setWords] = useState('');
  const head = useFocusOnArrive<HTMLHeadingElement>();
  const asked = cardsToAsk(iv.cards, iv.answers),
    many = card.kind === 'many',
    picked = many ? ticksOf(iv, card) : iv.answers[card.id]?.picked || [];
  const sayIt = () => {
    answerInWords(card.id, words);
    setWords('');
  };
  return (
    <Card className="card iv-ask" data-card={card.id}>
      <span className="badge b-info iv-n" id="iv-n">
        {'Question '}
        {asked.indexOf(card) + 1}
        {' of '}
        {asked.length}
      </span>
      <h3 className="t-sub2" id="iv-q" tabIndex={-1} ref={head} aria-describedby="iv-n">
        {card.title}
      </h3>
      <p className="t-cap muted">
        {"Why I'm asking: "}
        {card.why.charAt(0).toUpperCase() + card.why.slice(1)}
      </p>
      <div className="col gap8" role="group" aria-labelledby="iv-q">
        {card.options.map((o) => {
          const on = picked.includes(o.id);
          return (
            <button
              key={o.id}
              className={cx('iv-opt', on && 'on')}
              aria-pressed={on}
              data-opt={o.id}
              onClick={() => pickOption(card.id, o.id)}
            >
              <span className="row between gap8">
                <strong>{o.label}</strong>
                {card.usual.includes(o.id) && <span className="badge b-outline">Usual choice</span>}
              </span>
              {o.desc && <span className="t-cap muted">{o.desc}</span>}
            </button>
          );
        })}
      </div>
      {many && (
        <Btn className="btn primary iv-next" disabled={!picked.length} onClick={() => confirmTicks(card.id)}>
          Continue
        </Btn>
      )}
      {takesWords(iv) && (
        <div className="row gap8">
          <Input
            className="input grow"
            cls="grow"
            aria-label="Answer in your own words"
            placeholder="Or tell me in your own words"
            value={words}
            maxLength={240}
            onChange={(e) => setWords(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && words.trim()) sayIt();
            }}
          />
          {words.trim() && (
            <Btn className="btn" onClick={sayIt}>
              Send
            </Btn>
          )}
        </div>
      )}
      <div className="row between wrap gap8">
        <button className="iv-link iv-skip" onClick={() => skipCard(card.id)}>
          Skip this one
        </button>
        <button className="iv-link iv-usual" onClick={takeUsual}>
          Use the usual choices and show me the plan
        </button>
      </div>
    </Card>
  );
}

/** After the last answer: the one way on, to the plan. */
function AllAsked() {
  const head = useFocusOnArrive<HTMLHeadingElement>();
  return (
    <>
      <div className="row gap8">
        <Icon n="checkCircle" cls="iv-yes" />
        <h3 className="t-sub2" tabIndex={-1} ref={head}>
          {"That's everything I need"}
        </h3>
      </div>
      <p>Check the plan once, then I start building.</p>
      <Btn className="btn primary iv-review" onClick={reviewPlan}>
        Review the plan
      </Btn>
    </>
  );
}

function PlannerError({ iv }: { iv: Interview }) {
  return (
    <MBar
      tone="danger"
      action={
        <Btn className="btn sm" onClick={retryPlanner}>
          Try again
        </Btn>
      }
    >
      {iv.draft ? 'The plan could not be written. ' : 'The questions could not be written. '}
      {iv.error}
    </MBar>
  );
}

function Chat({ iv, plan }: { iv: Interview; plan: PlanSpec | null }) {
  const card = iv.busy ? null : currentCard(iv),
    onPlan = iv.step === 'plan' && !!plan;
  return (
    <aside className="iv-chat" aria-label="Planner">
      <PlannerHead sub={onPlan ? 'Wrote the plan from your answers' : 'Asks before anything is built'} />
      {iv.busy === 'asking' && (
        <div className="iv-bubble row gap8" role="status">
          <Spinner />
          Reading your sentence and writing the questions.
        </div>
      )}
      {iv.reflect && <div className="iv-bubble">{iv.reflect}</div>}
      <Answered iv={iv} except={card?.id} />
      {iv.error && <PlannerError iv={iv} />}
      {card && <AskCard key={card.id} iv={iv} card={card} />}
      {!onPlan && !card && iv.draft && !iv.error && (
        <Card className="card iv-done">
          {iv.busy === 'writing' ? (
            <div className="row gap8" role="status">
              <Spinner />
              Writing the plan from your answers.
            </div>
          ) : (
            <AllAsked />
          )}
        </Card>
      )}
      {onPlan && plan && (
        <>
          <div className="iv-bubble">
            {'Here is the plan. Read it once. '}
            You can flip the demo data switch yourself, or change any answer.
          </div>
          {plan.notInThisVersion.length > 0 && (
            <div className="iv-bubble">
              {plan.notInThisVersion.length === 1 ? 'One thing' : plan.notInThisVersion.length + ' things'}
              {' you might expect '}
              {plan.notInThisVersion.length === 1 ? 'is' : 'are'}
              {' not possible yet. See "Not in this version", so there are no surprises later.'}
            </div>
          )}
          <Card className="card iv-ready">
            <h3 className="t-sub2">
              {'Ready to build '}
              {plan.name}?
            </h3>
            <p className="t-cap muted">{summaryOf(plan)}</p>
            <div className="row wrap gap8">
              <Btn className="btn primary" onClick={buildIt}>
                Build it
              </Btn>
              {iv.cards.length > 0 && (
                <Btn className="btn" onClick={backToQuestions}>
                  Change something
                </Btn>
              )}
            </div>
          </Card>
        </>
      )}
    </aside>
  );
}

const summaryOf = (plan: PlanSpec) =>
  [
    count(plan.lists.length, 'list', 'lists'),
    kinds(plan.people.length),
    plan.stages ? count(plan.stages.stages.length, 'stage', 'stages') : '',
    count(teamFor(plan).agents, 'agent', 'agents'),
  ]
    .filter(Boolean)
    .join(', ');

/* ---------- the two screens ---------- */

function Steps({ iv }: { iv: Interview }) {
  const onPlan = iv.step === 'plan';
  const step = (n: number, text: string, state: 'done' | 'on' | '') => (
    <li className={cx('iv-st', state)} aria-current={state === 'on' ? 'step' : undefined}>
      <span className="iv-st-n">{state === 'done' ? <Icon n="check" s="12" /> : n}</span>
      <span className="iv-st-l">{text}</span>
    </li>
  );
  return (
    <div className="iv-top">
      <ol className="iv-steps" aria-label="Steps">
        {step(1, 'Describe', 'done')}
        {step(2, 'Questions', onPlan ? 'done' : 'on')}
        {step(3, 'Plan', onPlan ? 'on' : '')}
        {step(4, 'Build', '')}
      </ol>
      <Btn
        className="btn subtle sm iv-over"
        onClick={() => {
          leaveInterview();
          refocus(['#home-prompt']);
        }}
      >
        <Icon n="arrowLeft" s="16" />
        Start over
      </Btn>
    </div>
  );
}

/** Screen 2: the plan so far on the canvas, the Planner's cards beside it. */
function Questions({ iv, plan }: { iv: Interview; plan: PlanSpec | null }) {
  const asked = cardsToAsk(iv.cards, iv.answers),
    open = (slot: string) => asked.find((c) => c.id === slot && !iv.answers[c.id]) || null;
  return (
    <div className="iv-shell">
      <section className="iv-canvas" aria-label="Your plan so far" tabIndex={0}>
        <div className="row between wrap gap8">
          <div className="col gap0">
            <h2 className="t-sub1" id="iv-name">
              {plan ? plan.name : 'Your app'}
            </h2>
            <p className="muted">Your plan so far. It fills in as you answer, and you can change any answer.</p>
          </div>
          {plan && (
            <span className="badge b-info" id="iv-sum">
              {summaryOf(plan)}
            </span>
          )}
        </div>
        {plan ? (
          <div className="iv-grid">
            <People plan={plan} />
            <Keeps plan={plan} />
            <Moves plan={plan} waiting={open('approval')} />
            <Rules plan={plan} />
            <Demo iv={iv} plan={plan} />
            <Team plan={plan} title="Who builds it" />
          </div>
        ) : (
          <Waiting>{iv.error ? 'The plan appears here once the questions are written.' : 'The plan appears here in a moment.'}</Waiting>
        )}
      </section>
      <Chat iv={iv} plan={plan} />
    </div>
  );
}

/** Screen 3: the plan to approve. Nothing is built until "Build it". */
function PlanScreen({ iv, plan }: { iv: Interview; plan: PlanSpec }) {
  const t = teamFor(plan),
    head = useFocusOnArrive<HTMLHeadingElement>();
  const actions = (big?: boolean) => (
    <div className="row wrap gap8">
      {iv.cards.length > 0 && (
        <Btn className="btn iv-change" onClick={backToQuestions}>
          Change something
        </Btn>
      )}
      <Btn className={cx('btn primary iv-build', big && 'lg')} onClick={buildIt}>
        <Icon n="sparkle" />
        Build it
      </Btn>
    </div>
  );
  return (
    <div className="iv-shell">
      <section className="iv-canvas" aria-label="The plan" tabIndex={0}>
        <div className="col gap4">
          <span className="t-cap muted">{"Here is what I'll build"}</span>
          <h1 className="t-title2" id="iv-name" tabIndex={-1} ref={head}>
            {plan.name}
          </h1>
          <p className="lead muted">{plan.summary}</p>
        </div>
        <Card className="card flat iv-act">
          <div className="col gap0 grow">
            <strong>Nothing is built until you press Build it.</strong>
            <span className="t-cap muted">
              {teamLine(t)}
              {'. You can still change anything afterwards.'}
            </span>
          </div>
          {actions()}
        </Card>
        <div className="iv-grid">
          <People plan={plan} />
          <Moves plan={plan} />
        </div>
        <Keeps plan={plan} full />
        <Access plan={plan} />
        <div className="iv-grid">
          <Extras plan={plan} />
          <Assumed iv={iv} plan={plan} />
        </div>
        <Team plan={plan} title="Who works on it" />
        <div className="row end">{actions(true)}</div>
      </section>
      <Chat iv={iv} plan={plan} />
    </div>
  );
}

/** The Home tab while an interview is open. */
export function InterviewView() {
  const iv = interviewNow();
  if (!iv) return null;
  const plan = planNow(iv);
  return (
    <div className={'iv scroll iv-on-' + iv.step} data-step={iv.step}>
      <Steps iv={iv} />
      {iv.step === 'plan' && plan ? <PlanScreen iv={iv} plan={plan} /> : <Questions iv={iv} plan={plan} />}
    </div>
  );
}
