/* The Customise tab, the workflow and add-step dialogs, review findings and the workflow cards in chat. Split from custom.tsx so it loads the first
   time it is drawn (see later.tsx); the logic it uses stays in custom.tsx. */
import { NativeField } from '@/platform/dom';
import type { Untrusted } from '@/shared/types/app';
import type { FormEvent, ReactNode } from 'react';
import type { AppRecord, ChatMessage, Dict } from '@/shared/types/workspace';
import type { Station } from './line';
import { NARROW, PHONE, S, U, arr, chatShown, closeDialog, commit, cx, errText, notify, openDialog, setChat, str, toast } from './core';
import { AGENTS, PENDING, RUNS, STATIONS, say, stationIdx } from './line';
import { handleChat } from './changes';
import { Btn, AgentAv, Dialog, Field, Icon, MBar, Seg, Spinner, Switch } from './ui';
import { REVIEWERS } from './reviewers';
import { RerunBar, queuedRerun } from './rerun';
import {
  APPROVE_AT,
  RULES_AT,
  NOTE_MAX,
  STEP_AT,
  JOB_MAX,
  LIB,
  reviewerAt,
  stepAfter,
  stepAuto,
  stName,
  agentThe,
  blankFlow,
  normFlow,
  flowDefault,
  flowOf,
  flowSame,
  type FlowCall,
  flowApply,
  flowEdit,
  FLOW_HELP,
  answerGate,
  type BuiltApp,
  LEVELS,
  verifyFindings,
  reviewNow,
  rerunFrom,
  FlowChips,
} from './custom';

export function CustomTab({ app, st }: { app: AppRecord; st: Station }) {
  // the Customize tab of a station: what the owner may change about this step, and about the line as a whole
  const f = flowOf(app),
    rid = reviewerAt(st.id),
    rv = rid && REVIEWERS[rid],
    busy = !!RUNS[app.id],
    ready = app.status === 'ready',
    next = STATIONS[stationIdx(st.id) + 1];
  const drafts = U.noteDraft,
    key = app.id + ':' + st.agent,
    saved = f.notes[st.agent] || '',
    draft = drafts[key] != null ? drafts[key] : saved;
  const edit = (tool: string, args: Untrusted) =>
      flowEdit(app, [
        {
          tool,
          args,
        },
      ]),
    saveNote = (t: string) => {
      setNoteDraft(key);
      edit('set_note', {
        agent: st.agent,
        text: t,
      });
    };
  return (
    <div className="cust">
      <div className="cust-list">
        {APPROVE_AT.includes(st.id) && (
          <CustRow
            icon="handRight"
            title="Ask me before the line moves on"
            text={'When ' + st.name + ' has passed its checks, the build waits for your approval before ' + next.name + ' starts.'}
          >
            <Switch
              id={'cu-approve-' + st.id}
              on={!!f.approve[st.id]}
              onChange={(v) =>
                edit('set_approval', {
                  station: st.id,
                  on: v,
                })
              }
            />
          </CustRow>
        )}
        {rv && (
          <CustRow
            icon={rv.icon}
            title={'Add the ' + rv.name}
            text={rv.job + ' It only advises: nothing changes until you apply a finding.'}
          >
            <Switch
              id={'cu-review-' + st.id}
              on={f.reviewers.includes(rid)}
              onChange={(v) =>
                edit(v ? 'add_review' : 'remove_review', {
                  reviewer: rid,
                })
              }
            />
          </CustRow>
        )}
        {RULES_AT.includes(st.id) && (
          <CustRow
            icon="code"
            title="Who does this step"
            text={agentThe(st.agent) + ', or the built-in rules: plainer output, but no agent and no model call.'}
          >
            <Seg
              label="Who does this step"
              items={[
                {
                  id: 'agent',
                  label: 'Agent',
                },
                {
                  id: 'rules',
                  label: 'Rules',
                },
              ]}
              value={f.by[st.id] === 'rules' ? 'rules' : 'agent'}
              onChange={(v) =>
                edit('set_worker', {
                  station: st.id,
                  by: v,
                })
              }
            />
          </CustRow>
        )}
        <CustRow
          icon="undo"
          title="Attempts per station"
          text="How many tries an agent gets before code steps in with a repair or its safe default. Applies to every station."
        >
          <Seg
            label="Attempts per station"
            items={[1, 2, 3].map((n) => ({
              id: String(n),
              label: String(n),
            }))}
            value={String(f.attempts)}
            onChange={(n) =>
              edit('set_attempts', {
                n: Number(n),
              })
            }
          />
        </CustRow>
      </div>
      <div className="cust-note">
        <Field
          id={'cu-note-' + st.id}
          label={'Standing instruction for ' + agentThe(st.agent, true)}
          hint={
            app.mode === 'live'
              ? 'Added to every request this agent gets. ' + (NOTE_MAX - draft.length) + ' characters left.'
              : 'Added to every request this agent gets in a Live build. A saved build replays recorded work, so it does not change this one.'
          }
        >
          <NativeField
            as="textarea"
            className="textarea"
            id={'cu-note-' + st.id}
            rows="2"
            maxLength={NOTE_MAX}
            placeholder={NOTE_HINT[st.agent]}
            value={draft}
            onInput={(e: InputEvent) => {
              setNoteDraft(key, (e.target as HTMLTextAreaElement).value);
              notify();
            }}
          />
        </Field>
        <div className="row wrap">
          <Btn className="btn sm primary" disabled={str(draft) === saved} onClick={() => saveNote(draft)}>
            Save instruction
          </Btn>
          {saved && (
            <Btn className="btn sm" onClick={() => saveNote('')}>
              Clear
            </Btn>
          )}
          <span className="grow" />
          {ready && st.id !== 'research' && (
            <Btn
              className="btn sm"
              disabled={busy}
              title="Only this station and the ones after it run again"
              onClick={() => rerunFrom(app, st.id)}
            >
              <Icon n="rerun" s="16" />
              {'Run again from '}
              {st.name}
            </Btn>
          )}
          <Btn
            className="btn sm subtle"
            onClick={() => {
              U.sheet = null;
              openDialog('workflow', {
                app: app.id,
              });
            }}
          >
            <Icon n="options" s="16" />
            All settings
          </Btn>
        </div>
      </div>
    </div>
  );
}
export function WorkflowDialog({ p }: { p: { app: string } }) {
  // every workflow setting of one app in one place
  const app = S.apps[p.app];
  if (!app) return null;
  const f = flowOf(app),
    edit = (tool: string, args: Untrusted) =>
      flowEdit(app, [
        {
          tool,
          args,
        },
      ]),
    std = flowSame(f, blankFlow()),
    isDef = flowSame(f, flowDefault()),
    busy = !!RUNS[app.id];
  const openSt = (id: string) => {
    closeDialog();
    U.view[app.id] = 'build';
    U.bview[app.id] = 'line';
    U.sel[app.id] = id;
    U.follow[app.id] = false;
    U.itab[app.id] = 'custom';
    if (PHONE())
      U.sheet = {
        kind: 'inspector',
        app: app.id,
      };
    notify();
  };
  return (
    <Dialog
      wide
      cls="wf"
      title={'Workflow of ' + app.name}
      onClose={closeDialog}
      foot={
        <>
          <Btn className="btn" disabled={std} onClick={() => edit('reset', {})}>
            <Icon n="reset" s="16" />
            Reset to standard
          </Btn>
          <Btn
            className="btn"
            disabled={isDef}
            title="New apps you build start with this workflow"
            onClick={() => {
              edit('save_default', {});
              toast('Saved. New apps you build start with this workflow.', 'success');
            }}
          >
            <Icon n="save" s="16" />
            Save as my default
          </Btn>
          <Btn className="btn primary" onClick={closeDialog}>
            Done
          </Btn>
        </>
      }
    >
      <p className="muted">
        The six stations keep their order, because each one needs what the one before it made. Everything around them is yours to change,
        here, on the canvas, or by asking in chat.
      </p>
      <div className="tbl-wrap wf-tbl">
        <table className="tbl">
          <thead>
            <tr>
              <th>Station</th>
              <th>Who does it</th>
              <th>Ask me after</th>
              <th>Review step</th>
              <th>Instruction</th>
            </tr>
          </thead>
          <tbody>
            {STATIONS.map((st) => {
              const rid = reviewerAt(st.id),
                rv = rid && REVIEWERS[rid],
                rules = f.by[st.id] === 'rules',
                note = f.notes[st.agent];
              return (
                <tr key={st.id}>
                  <td data-l="Station">
                    <span className="who">
                      <AgentAv id={st.agent} size="xs" />
                      <strong>{st.name}</strong>
                    </span>
                  </td>
                  <td data-l="Who does it">
                    {RULES_AT.includes(st.id) ? (
                      <Seg
                        label={'Who does ' + st.name}
                        items={[
                          {
                            id: 'agent',
                            label: 'Agent',
                          },
                          {
                            id: 'rules',
                            label: 'Rules',
                          },
                        ]}
                        value={rules ? 'rules' : 'agent'}
                        onChange={(v) =>
                          edit('set_worker', {
                            station: st.id,
                            by: v,
                          })
                        }
                      />
                    ) : (
                      <span className="muted">{st.id === 'walkthrough' ? 'Code plays the tour' : AGENTS[st.agent].name}</span>
                    )}
                  </td>
                  <td data-l="Ask me after">
                    {APPROVE_AT.includes(st.id) ? (
                      <Switch
                        id={'wf-approve-' + st.id}
                        on={!!f.approve[st.id]}
                        onChange={(v) =>
                          edit('set_approval', {
                            station: st.id,
                            on: v,
                          })
                        }
                      />
                    ) : (
                      <span className="muted">Last step</span>
                    )}
                  </td>
                  <td data-l="Review step">
                    {rv ? (
                      <Switch
                        id={'wf-review-' + st.id}
                        on={f.reviewers.includes(rid)}
                        text={rv.short}
                        onChange={(v) =>
                          edit(v ? 'add_review' : 'remove_review', {
                            reviewer: rid,
                          })
                        }
                      />
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td data-l="Instruction">
                    <Btn
                      className="btn sm subtle wf-note"
                      title={note || 'Add an instruction for ' + agentThe(st.agent, true)}
                      onClick={() => openSt(st.id)}
                    >
                      <Icon n={note ? 'note' : 'edit'} s="16" />
                      <span className="ellipsis">{note || 'Add'}</span>
                    </Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="set-row">
        <div className="col gap0 grow">
          <strong>Attempts per station</strong>
          <span className="muted t-cap">How many tries an agent gets before code steps in with a repair or its safe default.</span>
        </div>
        <Seg
          label="Attempts per station"
          items={[1, 2, 3].map((n) => ({
            id: String(n),
            label: String(n),
          }))}
          value={String(f.attempts)}
          onChange={(n) =>
            edit('set_attempts', {
              n: Number(n),
            })
          }
        />
      </div>
      <div className="wf-sum">
        <span className="t-cap muted">{std ? 'This is the standard workflow.' : 'Different from the standard workflow:'}</span>
        <FlowChips app={app} />
        {busy && <span className="t-cap muted">A build is running. Changes to stations it has not reached yet apply to this run.</span>}
      </div>
      <p className="muted t-cap">
        {'In chat: '}
        {FLOW_HELP.replace('You can also change how I build: ', '')}
      </p>
    </Dialog>
  );
}
export function ReviewPanel({ app, id, bare }: { app: AppRecord; id: string; bare?: boolean }) {
  // the inspector of an added step: what it found, and how it is set up
  const rv = REVIEWERS[id],
    busy = !!RUNS[app.id],
    ready = app.status === 'ready',
    f = flowOf(app),
    auto = stepAuto(f, id),
    at = stepAfter(f, id),
    ag = f.agents.find((x) => x.id === id),
    R = app.reviews[id],
    D = U.noteDraft,
    key = app.id + '|job|' + id;
  const edit = (tool: string, args: Untrusted) =>
      flowEdit(app, [
        {
          tool,
          args: Object.assign(
            {
              step: id,
            },
            args,
          ),
        },
      ]),
    places = STEP_AT.filter((s) => rv.custom || stationIdx(s) >= stationIdx(rv.after));
  return (
    <section className={cx('inspector review-insp', bare && 'bare')} data-tour="inspector" aria-label={rv.name + ' inspector'}>
      <div className="insp-head">
        {!bare && (
          <>
            <AgentAv id={'rv_' + id} size="sm" />
            <strong>{rv.name}</strong>
            {rv.custom && <span className="badge b-outline">Your agent</span>}
            <span className="muted t-cap hide-sm ellipsis">{rv.job}</span>
          </>
        )}
        <span className="grow" />
        <Btn className="btn sm" disabled={busy || !ready} onClick={() => reviewNow(app, id)}>
          <Icon n="rerun" s="16" />
          Run now
        </Btn>
        <Btn className="btn sm subtle" disabled={busy && (R || {}).status === 'working'} onClick={() => edit('remove_step', {})}>
          <Icon n="dismiss" s="16" />
          Remove
        </Btn>
      </div>
      <div className="insp-body col gap12">
        <div className="step-set">
          <Field
            id={'st-mode-' + id}
            label="What it may do"
            hint={
              auto
                ? 'Each change still has to pass every check. Anything that deletes data waits for you.'
                : 'Nothing changes until you press Apply on a finding.'
            }
          >
            <Seg
              label="What this step may do"
              items={[
                {
                  id: 'advise',
                  label: 'Advise me',
                  icon: 'glasses',
                },
                {
                  id: 'apply',
                  label: 'Apply its changes',
                  icon: 'wand',
                },
              ]}
              value={auto ? 'apply' : 'advise'}
              onChange={(v) =>
                edit('set_mode', {
                  mode: v,
                })
              }
            />
          </Field>
          <Field
            id={'st-at-' + id}
            label="Where it sits"
            hint={
              rv.custom
                ? 'It reads everything built up to that point.'
                : 'It reads ' + rv.reads + ', so it cannot sit earlier than ' + stName(rv.after) + '.'
            }
          >
            <NativeField
              as="select"
              className="select"
              id={'st-at-' + id}
              value={at}
              disabled={busy}
              onChange={(e: Event) =>
                edit('move_step', {
                  after: (e.target as HTMLSelectElement).value,
                })
              }
            >
              {places.map((s) => (
                <option key={s} value={s}>
                  {'After '}
                  {stName(s)}
                </option>
              ))}
            </NativeField>
          </Field>
        </div>
        {ag && (
          <>
            <Field
              id={'st-job-' + id}
              label="Its job, in your words"
              hint={
                'Without a model it does the changes the built-in reader finds in these sentences. In a Live build it reads the app and decides for itself. ' +
                (D[key] != null ? D[key].length : ag.job.length) +
                ' of ' +
                JOB_MAX
              }
            >
              <NativeField
                as="textarea"
                className="textarea"
                id={'st-job-' + id}
                rows="3"
                maxLength={JOB_MAX}
                value={D[key] != null ? D[key] : ag.job}
                onInput={(e: InputEvent) => {
                  setNoteDraft(key, (e.target as HTMLTextAreaElement).value);
                  notify();
                }}
              />
            </Field>
            <div className="row">
              <Btn
                className="btn sm primary"
                disabled={D[key] == null || D[key].trim() === ag.job || busy}
                onClick={() => {
                  const t = D[key];
                  setNoteDraft(key);
                  edit('edit_step', {
                    job: t,
                  });
                }}
              >
                Save the job
              </Btn>
            </div>
          </>
        )}
        {R && R.note && <MBar tone="info">{R.note}</MBar>}
        <Findings app={app} id={id} />
      </div>
    </section>
  );
}
export function AddStepDialog({ p }: { p: AddStepProps }) {
  // the plus on a gate: an approval, a step from the library, or an agent described in a sentence
  const app = S.apps[p.app];
  if (!app) return null;
  const f = flowOf(app),
    st = p.after,
    busy = !!RUNS[app.id],
    canStep = STEP_AT.includes(st),
    canAsk = APPROVE_AT.includes(st),
    mode = p.mode || 'apply';
  const add = (calls: FlowCall[]) => {
      closeDialog();
      flowEdit(app, calls);
    },
    lib = LIB().filter((id) => stationIdx(REVIEWERS[id].after) <= stationIdx(st));
  const make = (e: FormEvent) => {
    e.preventDefault();
    const name = str(p.name),
      job = str(p.job);
    try {
      if (!name) throw new Error('Give the agent a name.');
      if (job.length < 8) throw new Error('Say in a sentence what it should do.');
    } catch (er) {
      return setAddStep(p, { err: errText(er) });
    }
    add([
      {
        tool: 'add_step',
        args: {
          name,
          job,
          after: st,
          mode,
        },
      },
    ]);
  };
  const ideas = [
    ['Table tidier', 'Turn every text field that repeats into a choice.'],
    ['Brand stylist', 'Use the colour teal. Make the rows compact. Use top navigation.'],
    ['Field checker', 'Add a notes field to ' + ((app.def.tables[0] || {}).label || 'the main table').toLowerCase() + '.'],
  ];
  return (
    <Dialog title={'Add a step after ' + stName(st)} cls="addstep" onClose={closeDialog}>
      <div className="col gap12">
        {canAsk && (
          <button
            className="step-pick"
            id="as-approval"
            disabled={!!f.approve[st]}
            onClick={() =>
              add([
                {
                  tool: 'set_approval',
                  args: {
                    station: st,
                    on: true,
                  },
                },
              ])
            }
          >
            <span className="av av-sm acc-blue">
              <Icon n="approved" s="16" />
            </span>
            <span className="col gap0 grow">
              <strong>Your approval</strong>
              <span className="t-cap muted">
                {f.approve[st] ? 'Already here.' : 'The build stops here until you approve it or stop it.'}
              </span>
            </span>
            <Icon n="add" s="16" />
          </button>
        )}
        {canStep ? (
          <>
            <div className="col gap4">
              <span className="t-cap muted">From the library</span>
              {lib.map((id) => {
                const rv = REVIEWERS[id],
                  on = f.reviewers.includes(id);
                return (
                  <button
                    key={id}
                    className="step-pick"
                    id={'as-' + id}
                    disabled={on}
                    onClick={() =>
                      add([
                        {
                          tool: 'add_step',
                          args: {
                            step: id,
                            after: st,
                          },
                        },
                      ])
                    }
                  >
                    <span className={'av sq av-sm acc-' + rv.acc}>
                      <Icon n={rv.icon} s="16" />
                    </span>
                    <span className="col gap0 grow">
                      <strong>{rv.short}</strong>
                      <span className="t-cap muted">
                        {on ? 'Already in this workflow, after ' + stName(stepAfter(f, id)) + '.' : rv.job}
                      </span>
                    </span>
                    <span className={'badge ' + (rv.auto ? 'b-info' : 'b-outline')}>{rv.auto ? 'Applies' : 'Advises'}</span>
                  </button>
                );
              })}
              {lib.length === 0 && <span className="muted t-cap">No library step reads what exists this early.</span>}
            </div>
            <form className="col gap8 step-new" onSubmit={make}>
              <span className="t-cap muted">Or describe an agent of your own</span>
              <Field id="as-name" label="Name">
                <NativeField
                  as="input"
                  className="input"
                  id="as-name"
                  maxLength="32"
                  placeholder="For example: Table tidier"
                  value={p.name || ''}
                  onInput={(e: InputEvent) => {
                    setAddStep(p, { name: (e.target as HTMLInputElement).value, err: '' });
                  }}
                />
              </Field>
              <Field
                id="as-job"
                label="What should it do?"
                error={p.err || null}
                hint="Plain sentences. In a Live build the agent reads the app and decides. Without a model it does the changes it can read in these sentences."
              >
                <NativeField
                  as="textarea"
                  className="textarea"
                  id="as-job"
                  rows="3"
                  maxLength={JOB_MAX}
                  placeholder="For example: Make the rows compact. Use the colour teal."
                  value={p.job || ''}
                  onInput={(e: InputEvent) => {
                    setAddStep(p, { job: (e.target as HTMLTextAreaElement).value, err: '' });
                  }}
                />
              </Field>
              <div className="row wrap gap4">
                <span className="t-cap muted">Ideas</span>
                {ideas.map((x) => (
                  <button
                    key={x[0]}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setAddStep(p, { name: x[0], job: x[1], err: '' });
                    }}
                  >
                    {x[0]}
                  </button>
                ))}
              </div>
              <div className="row wrap between">
                <Seg
                  label="What the agent may do"
                  items={[
                    {
                      id: 'apply',
                      label: 'Apply its changes',
                      icon: 'wand',
                    },
                    {
                      id: 'advise',
                      label: 'Advise me',
                      icon: 'glasses',
                    },
                  ]}
                  value={mode}
                  onChange={(v) => {
                    setAddStep(p, { mode: v });
                  }}
                />
                <Btn className="btn primary" type="submit" id="as-create" disabled={busy && false}>
                  <Icon n="add" s="16" />
                  Add this agent
                </Btn>
              </div>
            </form>
          </>
        ) : (
          <p className="muted">
            After Research there is only a brief, so an added agent has nothing to change yet. You can still ask to approve the brief.
          </p>
        )}
      </div>
    </Dialog>
  );
}
export function FlowCards({ app, m }: { app: AppRecord; m: ChatMessage }) {
  // the workflow's cards in chat
  const c = m.card as unknown as FlowCard,
    ready = app.status === 'ready',
    busy = !!RUNS[app.id],
    toCanvas = () => {
      U.view[app.id] = 'build';
      U.bview[app.id] = 'line';
      if (NARROW() && chatShown()) setChat(false);
      notify();
    };
  if (c.type === 'flow') {
    const latest = m === [...(app.chat || [])].reverse().find((x) => x.card && x.card.type === 'flow'),
      cur = JSON.stringify(normFlow(flowOf(app))),
      canUndo = !c.undone && cur === c.after && c.before !== c.after;
    return (
      <div className={cx('gcard', !c.quiet && 'ok')}>
        {!c.quiet && (
          <div className="gc-h">
            <Icon n="options" s="16" />
            Workflow updated
          </div>
        )}
        {c.items.length > 0 && (
          <ul className="plain flow-items">
            {c.items.map((x, i) => (
              <li key={i}>
                <Icon n={x.icon} s="16" />
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        )}
        {latest && <RerunBar app={app} compact />}
        <div className="row wrap">
          {c.from && ready && !(latest && queuedRerun(app.id)) && (
            <Btn className="btn sm" disabled={busy} onClick={() => rerunFrom(app, c.from || '')}>
              <Icon n="rerun" s="16" />
              {'Run again from '}
              {stName(c.from)}
            </Btn>
          )}
          <Btn className="btn sm subtle" onClick={toCanvas}>
            <Icon n="flow" s="16" />
            Show on the canvas
          </Btn>
          {!c.quiet && (
            <Btn
              className="btn sm subtle"
              disabled={!canUndo}
              onClick={() => {
                markUndone(c);
                const r = flowApply(
                  app,
                  [
                    {
                      tool: 'restore',
                      args: {
                        flow: JSON.parse(c.before),
                      },
                    },
                  ],
                  'orchestrator',
                );
                say(app, 'orchestrator', r.done[0] ? r.done[0].text : 'Undone.');
              }}
            >
              <Icon n="undo" s="16" />
              Undo
            </Btn>
          )}
        </div>
      </div>
    );
  }
  if (c.type === 'gate') {
    const live = !!(RUNS[app.id] && RUNS[app.id].gate) && c.decided == null,
      open = () => {
        U.sel[app.id] = c.station;
        U.follow[app.id] = false;
        U.itab[app.id] = 'out';
        toCanvas();
        if (PHONE()) {
          U.sheet = {
            kind: 'inspector',
            app: app.id,
          };
          notify();
        }
      };
    return (
      <div className="gcard ask">
        <div className="gc-h">
          <Icon n="handRight" s="16" />
          {'Your approval · '}
          {stName(c.station)}
        </div>
        {arr(c.facts).length > 0 && (
          <ul className="plain">
            {arr<string>(c.facts).map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        )}
        {c.decided ? (
          <span className={'badge b-' + (c.decided === 'approved' ? 'success' : 'neutral')}>
            {c.decided === 'approved' ? 'Approved' : 'Stopped here'}
          </span>
        ) : live ? (
          <div className="row wrap">
            <Btn className="btn primary sm" onClick={() => answerGate(app, true)}>
              <Icon n="check" s="16" />
              Approve and continue
            </Btn>
            <Btn className="btn sm" onClick={open}>
              See what was made
            </Btn>
            <Btn className="btn sm" onClick={() => answerGate(app, false)}>
              Stop here
            </Btn>
          </div>
        ) : (
          <span className="t-cap muted">No longer waiting for an answer.</span>
        )}
      </div>
    );
  }
  if (c.type === 'review') {
    const R = (app.reviews || {})[c.reviewer],
      rv = REVIEWERS[c.reviewer];
    if (!rv) return null;
    return (
      <div className="gcard">
        <div className="gc-h">
          <Icon n={rv.icon} s="16" />
          {rv.short}
        </div>
        {R && R.at === c.stamp ? (
          <Findings app={app} id={c.reviewer} compact />
        ) : (
          <span className="t-cap muted">{R ? 'A newer review replaced this one.' : 'This review step was removed.'}</span>
        )}
      </div>
    );
  }
  if (c.type === 'flowinfo')
    return (
      <div className="gcard">
        <div className="gc-h">
          <Icon n="options" s="16" />
          Workflow
        </div>
        <FlowChips app={app} empty="Standard: six stations, a check gate after each, three attempts." />
        <div className="row wrap">
          <Btn
            className="btn sm"
            onClick={() =>
              openDialog('workflow', {
                app: app.id,
              })
            }
          >
            <Icon n="options" s="16" />
            Open the settings
          </Btn>
          <Btn className="btn sm subtle" onClick={toCanvas}>
            <Icon n="flow" s="16" />
            Show on the canvas
          </Btn>
        </div>
      </div>
    );
  return null;
}
export const NOTE_HINT: Dict<string> = {
  researcher: 'Example: keep it to three roles at most',
  database: 'Example: every table needs a notes field',
  backend: 'Example: only managers may delete anything',
  views: 'Example: always include a calendar when there is a date',
  ui: 'Example: keep page names to two words',
};

/* ---------- what the owner sees: the Customize tab, the settings dialog, the review panel, the chat cards ---------- */
export function CustRow({ icon, title, text, children }: { icon: string; title: ReactNode; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="cust-row">
      <span className="cust-ic">
        <Icon n={icon} />
      </span>
      <div className="col gap0 grow">
        <strong>{title}</strong>
        <span className="muted t-cap">{text}</span>
      </div>
      <div className="cust-ctl">{children}</div>
    </div>
  );
}
/** the owner's unsaved text in an instruction or job field; no text forgets it */
function setNoteDraft(key: string, text?: string) {
  if (text === undefined) delete U.noteDraft[key];
  else U.noteDraft[key] = text;
}
export function Findings({ app, id, compact }: { app: AppRecord; id: string; compact?: boolean }) {
  const R = (app.reviews || {})[id],
    rv = REVIEWERS[id],
    busy = !!RUNS[app.id] || !!PENDING[app.id],
    ready = app.status === 'ready';
  if (!R)
    return (
      <p className="muted">
        {ready ? 'This review has not run yet.' : 'This step runs when the build passes ' + stName(stepAfter(flowOf(app), id)) + '.'}
      </p>
    );
  if (R.status === 'working')
    return (
      <p className="muted row">
        <Spinner />
        {'Reading '}
        {rv.reads}
      </p>
    );
  if (R.status === 'failed') return <p className="muted">The review did not finish. Run it again.</p>;
  const stale = R.rev !== app.rev,
    open = R.findings.filter((x) => x.state === 'open').length;
  return (
    <div className="findings">
      {!compact && (
        <div className="row wrap t-cap muted">
          <span>{R.by === 'model' ? 'Read by the model, one call.' : 'Read by the built-in rules, no model call.'}</span>
          {R.note && <span>{R.note}</span>}
          <span>{R.findings.length ? open + ' of ' + R.findings.length + ' open' : ''}</span>
          {stale && <span className="badge b-warning">The app changed since this review</span>}
        </div>
      )}
      {R.findings.length === 0 && (
        <p className="row">
          <Icon n="checkCircle" cls="ok-ic" />
          {'Nothing to change in '}
          {rv.reads}.
        </p>
      )}
      {R.findings.map((x) => {
        const L = LEVELS[x.level] || LEVELS.low,
          off = x.state !== 'open';
        return (
          <div key={x.id} className={cx('finding', 'f-' + x.state)}>
            <div className="row top">
              <span className={'badge ' + L.cls}>{L.text}</span>
              <div className="col gap0 grow">
                <span className="t-strong">{x.text}</span>
                {x.why && <span className="muted t-cap">{x.why}</span>}
              </div>
            </div>
            {x.fix ? (
              <div className="fix">
                <span className="t-cap muted">Fix</span>
                <code>{x.fix}</code>
              </div>
            ) : (
              <span className="t-cap muted">No one-step fix. This one is for you to weigh.</span>
            )}
            <div className="row wrap">
              {x.state === 'applied' ? (
                <span className="badge b-success">
                  <Icon n="check" s="12" />
                  Applied
                </span>
              ) : x.state === 'dismissed' ? (
                <span className="badge b-neutral">Dismissed</span>
              ) : x.state === 'applying' ? (
                <span className="muted row">
                  <Spinner />
                  Applying
                </span>
              ) : (
                <>
                  {x.fix && (
                    <Btn
                      className="btn sm primary"
                      disabled={busy || !ready || x.test === 'fail'}
                      title={!ready ? 'Available when the build has finished' : ''}
                      onClick={() => applyFinding(app, id, x.id)}
                    >
                      Apply
                    </Btn>
                  )}
                  <Btn className="btn sm" disabled={off} onClick={() => dismissFinding(app, id, x.id)}>
                    Dismiss
                  </Btn>
                </>
              )}
              {x.fix &&
                x.state === 'open' &&
                (x.test === 'pass' ? (
                  <span className="t-cap tested ok">
                    <Icon n="shield" s="12" />
                    Tried out: passes every check{x.block ? '. ' + x.block : ''}
                  </span>
                ) : x.test === 'fail' ? (
                  <span className="t-cap tested bad">
                    <Icon n="warning" s="12" />
                    {'Tried out: '}
                    {x.block}
                  </span>
                ) : x.test === 'unknown' ? (
                  <span className="t-cap muted">Tried out when you apply it</span>
                ) : !ready ? (
                  <span className="t-cap muted">Tried out when the build has finished</span>
                ) : null)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function setAddStep(p: AddStepProps, patch: Partial<AddStepProps>) {
  Object.assign(p, patch);
  notify();
}
function markUndone(c: FlowCard) {
  c.undone = true;
}
export async function applyFinding(app: AppRecord, id: string, fid: string) {
  // a finding's fix is an ordinary change request: plan, approval if it deletes data, savepoint, re-check, roll back on failure
  const R = (app.reviews || {})[id],
    f = R && R.findings.find((x) => x.id === fid);
  if (!f || f.state !== 'open' || !f.fix) return;
  if (RUNS[app.id] || PENDING[app.id]) return void toast('Wait for the current run to finish.', 'info');
  if (app.status !== 'ready') return void toast('The app has to be built before a fix can be applied.', 'info');
  const n = app.runs.length ? app.runs[app.runs.length - 1].n : 0;
  f.state = 'applying';
  notify();
  try {
    await handleChat(app as BuiltApp, f.fix, {
      rules: f.test === 'pass',
    });
  } catch (e) {
    console.error(e);
  } // a fix that was tried out with the built-in reader is applied by it too: what was tested is what runs, and it costs no model call
  const last = app.runs[app.runs.length - 1];
  f.state = last && last.n > n && last.kind === 'change' && last.status === 'ok' ? 'applied' : 'open';
  if (f.state === 'applied') {
    Object.keys(app.reviews).forEach((k) =>
      app.reviews[k].findings.forEach((x) => {
        if (x.state === 'open') {
          x.test = null;
          x.block = '';
        }
      }),
    );
    await verifyFindings(app);
  } // the app changed, so the fixes still open are tried again
  commit();
}
export function dismissFinding(app: AppRecord, id: string, fid: string) {
  const R = (app.reviews || {})[id],
    f = R && R.findings.find((x) => x.id === fid);
  if (f && f.state === 'open') {
    f.state = 'dismissed';
    commit();
  }
}
/** the dialog's props, which also hold what the owner has typed so far */
interface AddStepProps {
  app: string;
  after: string;
  mode?: string;
  name?: string;
  job?: string;
  err?: string;
}
/** the workflow's chat cards, as this module writes them */
interface FlowCard {
  type: string;
  quiet?: boolean;
  items: { icon: string; text: string }[];
  from?: string;
  undone?: boolean;
  before: string;
  after: string;
  station: string;
  decided?: string | null;
  facts?: string[];
  reviewer: string;
  stamp: number;
}
