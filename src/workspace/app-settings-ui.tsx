import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Tab, TabList } from '@fluentui/react-components';
import type { AppUser } from '@/shared/types/app';
import type { AppRecord, Pane } from '@/shared/types/workspace';
import { cx, label, notify, toast } from './core';
import { importAppDb } from './db';
import { ACCENTS, VIEW_LABEL, appUsers, roleName } from './engine';
import { exportSqlite } from './export';
import { addDemoData, canAddDemoData, demoCounts } from './demo-data';
import { askRemoveDemo, askStartOver } from './demo-data-ui';
import { Avatar, Btn, Field, Icon, Input, MBar, Seg, Select, Switch } from './ui';
import {
  CURRENCIES,
  DATE_STYLES,
  NUMBER_STYLES,
  SETTINGS_SCREEN,
  adminRoles,
  fmtOf,
  formatSample,
  isListPage,
  roleIds,
  settingsOf,
  viewChoices,
} from './app-settings';
import { limitsOf } from './limits';
import {
  addPerson,
  removePerson,
  renamePerson,
  renameStage,
  resetFormats,
  setAdmin,
  setAppName,
  setFirstView,
  setFormats,
  setHome,
  setLimit,
  setLook,
  setPersonRole,
  settingsBlocked,
  type Outcome,
} from './app-admin';

/* ===== Turnkey · the Settings page every built app has =====
   One page, opened from the gear in the app's header by the people who run the app. Each section is a card of plain
   controls, and every control changes the app at once (src/workspace/app-admin.ts): there is no Save for the page as a
   whole, as in the settings of Microsoft 365 apps. A refused change says why in a message. */

interface Section {
  id: string;
  label: string;
  icon: string;
}
/** The sections this app has: one with no stages has no Stages section. */
export function settingsSections(app: AppRecord): Section[] {
  const stages = !!app.def.process && app.def.process.states.length > 0;
  return [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'people', label: 'People', icon: 'people' },
    ...(stages ? [{ id: 'stages', label: 'Stages', icon: 'flow' }] : []),
    ...(limitsOf(app.def).length ? [{ id: 'limits', label: 'Limits', icon: 'scales' }] : []),
    { id: 'formats', label: 'Formats', icon: 'number' },
    { id: 'pages', label: 'Pages', icon: 'layout' },
    { id: 'data', label: 'Data', icon: 'database' },
  ];
}
/** Opens one section of Settings in a pane. */
export function openSettings(pane: Pane, section?: string) {
  Object.assign(pane, { screen: SETTINGS_SCREEN, rec: null, form: null, sheet: null, setTab: section || pane.setTab || 'general' });
  notify();
}
/** Says why a change was refused. A change that went through needs no words: the page shows it. */
const tell = (r: Outcome, done?: string) => {
  if (!r.ok) toast(r.why, 'warning');
  else if (done) toast(done, 'success');
  return r.ok;
};
const accentName = (a: string) => label(a.replace(/([A-Z])/g, ' $1').toLowerCase());

/** One card of the page: a heading, a line of help and its controls. */
function Block({
  id,
  title,
  help,
  children,
  danger,
}: {
  id?: string;
  title: string;
  help?: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className={cx('set-card', danger && 'danger')} id={id} aria-label={title}>
      <header className="set-card-h">
        <h3 className="t-sub2">{title}</h3>
        {help && <p className="muted t-cap">{help}</p>}
      </header>
      {children}
    </section>
  );
}
/** One setting on a line: its name and help on the left, its control on the right. */
function Line({ name, help, children, id }: { name: ReactNode; help?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="set-line">
      <div className="col gap0 set-line-t">
        <label className="t-strong" htmlFor={id}>
          {name}
        </label>
        {help && <span className="muted t-cap">{help}</span>}
      </div>
      <div className="set-line-c">{children}</div>
    </div>
  );
}
/** A text box that changes the app when the person leaves it or presses Enter, and goes back on Escape. */
function CommitInput({
  value,
  onCommit,
  id,
  label: aria,
  disabled,
  cls,
  max,
  numeric,
}: {
  value: string;
  onCommit: (v: string) => boolean;
  id?: string;
  label?: string;
  disabled?: boolean;
  cls?: string;
  max?: number;
  /** a number: phones show the number keys */
  numeric?: boolean;
}) {
  // the key makes a fresh box whenever the value changes underneath, or a change is refused
  const [turn, setTurn] = useState(0);
  const done = (el: HTMLInputElement) => {
    if (el.value.trim() === value) return;
    if (!onCommit(el.value)) setTurn(turn + 1);
  };
  return (
    <Input
      key={value + '|' + turn}
      className={cx('input', cls)}
      id={id}
      aria-label={aria}
      defaultValue={value}
      disabled={disabled}
      maxLength={max || 60}
      inputMode={numeric ? 'decimal' : undefined}
      autoComplete="off"
      onBlur={(e) => done(e.currentTarget)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

interface PartProps {
  app: AppRecord;
  user: AppUser;
  off: boolean;
  idp: string;
}
function General({ app, off, idp }: PartProps) {
  const th = app.def.theme;
  return (
    <>
      <Block title="Name" help="Shown in the header, on the sign-in screen and wherever the app is listed.">
        <Field label="App name" id={idp + 'name'}>
          <CommitInput
            id={idp + 'name'}
            cls="set-name"
            value={app.name}
            max={40}
            disabled={off}
            onCommit={(v) => tell(setAppName(app, v))}
          />
        </Field>
      </Block>
      <Block title="Look" help="The colour of the header and of what is selected, where the pages are listed, and how tall the rows are.">
        <div className="col gap8">
          <span className="t-strong" id={idp + 'acc'}>
            Colour
          </span>
          <div className="set-swatches" role="radiogroup" aria-labelledby={idp + 'acc'}>
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={th.accent === a}
                aria-label={accentName(a)}
                title={accentName(a)}
                disabled={off}
                className={cx('set-swatch', 'acc-' + a, th.accent === a && 'on')}
                onClick={() => tell(setLook(app, { accent: a }))}
              >
                {th.accent === a && <Icon n="check" s="16" />}
              </button>
            ))}
          </div>
        </div>
        <Line name="Navigation" help="Where the list of pages sits on a wide screen. A phone always has tabs at the bottom.">
          <Seg
            label="Navigation"
            value={['top', 'rail'].includes(th.nav) ? th.nav : 'side'}
            items={[
              { id: 'side', label: 'Side' },
              { id: 'top', label: 'Top' },
              { id: 'rail', label: 'Icon rail' },
            ]}
            onChange={(v) => !off && tell(setLook(app, { nav: v }))}
          />
        </Line>
        <Line name="Rows" help="Compact rows fit more records on a screen.">
          <Seg
            label="Rows"
            value={th.density === 'compact' ? 'compact' : 'comfortable'}
            items={[
              { id: 'comfortable', label: 'Comfortable' },
              { id: 'compact', label: 'Compact' },
            ]}
            onChange={(v) => !off && tell(setLook(app, { density: v }))}
          />
        </Line>
      </Block>
    </>
  );
}

function People({ app, user, off, idp }: PartProps) {
  const def = app.def,
    users = appUsers(app),
    roles = roleIds(def),
    admins = adminRoles(def);
  const [name, setName] = useState(''),
    [role, setRole] = useState(roles[0] || '');
  const add = () => {
    if (tell(addPerson(app, name, role), name.trim() + ' can now sign in.')) setName('');
  };
  return (
    <>
      <Block title="People" help="Everyone who can sign in, and what kind of person each one is. That decides what they see and may do.">
        <ul className="set-people">
          {users.map((u) => (
            <li key={u.id} className="set-person">
              <Avatar name={u.name} size="sm" />
              <CommitInput
                cls="sm set-person-n"
                label={'Name of ' + u.name}
                value={u.name}
                disabled={off}
                onCommit={(v) => tell(renamePerson(app, u.id, v))}
              />
              {u.id === user.id && <span className="badge b-outline">You</span>}
              <span className="grow" />
              <Select
                className="select sm set-person-r"
                aria-label={'Kind of person: ' + u.name}
                value={u.role}
                disabled={off || roles.length < 2}
                onChange={(e) => tell(setPersonRole(app, u.id, e.target.value))}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleName(def, r)}
                  </option>
                ))}
              </Select>
              <Btn
                className="btn subtle icon sm set-person-x"
                aria-label={'Remove ' + u.name}
                title={u.id === user.id ? 'You cannot remove yourself' : 'Remove ' + u.name}
                disabled={off || u.id === user.id}
                onClick={() => tell(removePerson(app, u.id, user.id), u.name + ' was removed.')}
              >
                <Icon n="trash" s="16" />
              </Btn>
            </li>
          ))}
        </ul>
        <form
          className="set-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label="Add a person" id={idp + 'pn'} cls="grow">
            <Input
              className="input"
              id={idp + 'pn'}
              placeholder="Full name"
              autoComplete="off"
              maxLength={60}
              value={name}
              disabled={off}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Kind of person" id={idp + 'pr'}>
            <Select className="select" id={idp + 'pr'} value={role} disabled={off} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleName(def, r)}
                </option>
              ))}
            </Select>
          </Field>
          <Btn className="btn primary set-add-b" type="submit" disabled={off || !name.trim()}>
            <Icon n="personAdd" s="16" />
            Add
          </Btn>
        </form>
        <p className="muted t-cap">
          {
            'A new person signs in from the "Choose who you are" screen. This app keeps its people in this browser, so there is no invitation email.'
          }
        </p>
      </Block>
      <Block title="Who can open Settings" help="Only these kinds of people see the gear in the header.">
        {roles.map((r) => (
          <Line key={r} name={roleName(def, r)} id={idp + 'ad' + r} help={def.brief?.roles.find((x) => x.id === r)?.can}>
            <Switch
              id={idp + 'ad' + r}
              label={roleName(def, r) + ' can open Settings'}
              on={admins.includes(r)}
              disabled={off}
              onChange={(on) => tell(setAdmin(app, r, on))}
            />
          </Line>
        ))}
      </Block>
    </>
  );
}

function Stages({ app, off, idp }: PartProps) {
  const P = app.def.process;
  if (!P) return null;
  const t = app.def.tables.find((x) => x.name === P.table);
  return (
    <Block
      title="Stage names"
      help={
        'What each stage of ' +
        (t ? t.one.toLowerCase() : 'a record') +
        ' is called on badges, boards and buttons. The order and who may move a record stay as built.'
      }
    >
      {P.states.map((s, i) => (
        <div key={s.id} className="set-stage">
          <span className="set-stage-n muted t-cap">{i + 1}</span>
          <span className={'badge b-' + s.tone}>{s.label}</span>
          <span className="grow" />
          <CommitInput
            cls="sm set-stage-i"
            id={idp + 'st' + s.id}
            label={'Name of stage ' + (i + 1)}
            value={s.label}
            max={30}
            disabled={off}
            onCommit={(v) => tell(renameStage(app, s.id, v))}
          />
        </div>
      ))}
    </Block>
  );
}

function Limits({ app, off, idp }: PartProps) {
  const F = fmtOf(app.def);
  return (
    <Block
      title="Limits"
      help="The numbers in the app's rules. A new number applies to the next record that is saved or moved; records already past a stage stay where they are."
    >
      {limitsOf(app.def).map((L, i) => {
        const t = app.def.tables.find((x) => x.name === L.table);
        return (
          <div key={L.key} className="set-line set-limit">
            <div className="col gap0 set-line-t">
              <label className="t-strong" htmlFor={idp + 'lm' + i}>
                {L.label + (t ? ' · ' + t.label : '')}
              </label>
              {L.uses.map((u, j) => (
                <span key={j} className="muted t-cap">
                  {u.says.replace(/\.$/, '') + '.'}
                </span>
              ))}
            </div>
            <div className="set-line-c">
              {L.money && F.sign && <span className="muted">{F.sign}</span>}
              <CommitInput
                id={idp + 'lm' + i}
                cls="set-limit-i"
                value={String(L.value)}
                max={14}
                numeric
                disabled={off}
                onCommit={(v) => tell(setLimit(app, L.key, Number(v.replace(/[\s,]/g, ''))))}
              />
              {L.percent && <span className="muted">%</span>}
            </div>
          </div>
        );
      })}
    </Block>
  );
}

function Formats({ app, off, idp }: PartProps) {
  const f = settingsOf(app.def).formats;
  return (
    <Block title="Numbers, money and dates" help="How every list, record, chart and total in the app writes them.">
      <p className="set-sample" aria-live="polite">
        <span className="muted t-cap">For example</span>
        <strong>{formatSample(f)}</strong>
      </p>
      <Line name="Currency" id={idp + 'cur'} help="Put in front of every amount of money.">
        <Select
          className="select"
          id={idp + 'cur'}
          value={f.currency}
          disabled={off}
          onChange={(e) => tell(setFormats(app, { currency: e.target.value }))}
        >
          <option value="">None, just the number</option>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name + ' (' + c.sign + ')'}
            </option>
          ))}
        </Select>
      </Line>
      <Line name="Numbers" id={idp + 'num'} help="The marks between thousands and before decimals.">
        <Select
          className="select"
          id={idp + 'num'}
          value={f.numbers}
          disabled={off}
          onChange={(e) => tell(setFormats(app, { numbers: e.target.value as typeof f.numbers }))}
        >
          {NUMBER_STYLES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </Select>
      </Line>
      <Line name="Dates" id={idp + 'dat'}>
        <Select
          className="select"
          id={idp + 'dat'}
          value={f.dates}
          disabled={off}
          onChange={(e) => tell(setFormats(app, { dates: e.target.value as typeof f.dates }))}
        >
          {DATE_STYLES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </Select>
      </Line>
      <Line name="Clock">
        <Seg
          label="Clock"
          value={f.clock}
          items={[
            { id: '24', label: '14:05' },
            { id: '12', label: '2:05 PM' },
          ]}
          onChange={(v) => !off && tell(setFormats(app, { clock: v as typeof f.clock }))}
        />
      </Line>
      <Line name="Week starts on" help="The first column of the calendar.">
        <Seg
          label="Week starts on"
          value={f.weekStart}
          items={[
            { id: 'mon', label: 'Monday' },
            { id: 'sun', label: 'Sunday' },
          ]}
          onChange={(v) => !off && tell(setFormats(app, { weekStart: v as typeof f.weekStart }))}
        />
      </Line>
      <div className="set-foot">
        <Btn className="btn sm" disabled={off || !app.def.settings} onClick={() => tell(resetFormats(app))}>
          <Icon n="reset" s="16" />
          Back to the usual formats
        </Btn>
      </div>
    </Block>
  );
}

function Pages({ app, off, idp }: PartProps) {
  const def = app.def,
    set = settingsOf(def),
    roles = roleIds(def),
    lists = def.screens.filter((s) => isListPage(s) && viewChoices(def, s).length > 1);
  return (
    <>
      <Block title="First page" help="The page each kind of person lands on after signing in.">
        {roles.map((r) => {
          const mine = def.screens.filter((s) => s.roles.includes(r));
          return (
            <Line key={r} name={roleName(def, r)} id={idp + 'hm' + r}>
              <Select
                className="select"
                id={idp + 'hm' + r}
                value={mine.some((s) => s.id === set.home[r]) ? set.home[r] : ''}
                disabled={off || mine.length < 2}
                onChange={(e) => tell(setHome(app, r, e.target.value))}
              >
                <option value="">{mine[0] ? mine[0].name + ' (as built)' : 'No pages'}</option>
                {mine.slice(1).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Line>
          );
        })}
      </Block>
      {lists.length > 0 && (
        <Block
          title="How each list opens"
          help="The view a list shows first. Each person can still switch views, and the app remembers their own choice."
        >
          {lists.map((s) => (
            <Line key={s.id} name={s.name} id={idp + 'vw' + s.id}>
              <Select
                className="select"
                id={idp + 'vw' + s.id}
                value={set.views[s.id] || s.type}
                disabled={off}
                onChange={(e) => tell(setFirstView(app, s.id, e.target.value))}
              >
                {viewChoices(def, s).map((v) => (
                  <option key={v} value={v}>
                    {(VIEW_LABEL[v] || label(v)) + (v === s.type ? ' (as built)' : '')}
                  </option>
                ))}
              </Select>
            </Line>
          ))}
        </Block>
      )}
    </>
  );
}

function Data({ app, off }: PartProps) {
  const n = demoCounts(app);
  return (
    <>
      <Block
        title="Demo data"
        help="The made-up records the app came with, so there was something to look at. Records people added are never removed with them."
      >
        <Line
          name={n.demo ? n.demo + ' demo record' + (n.demo === 1 ? '' : 's') : 'No demo data'}
          help={n.own + ' record' + (n.own === 1 ? '' : 's') + ' added by people'}
        >
          {n.demo > 0 ? (
            <Btn className="btn set-demo-rm" disabled={off} onClick={() => void askRemoveDemo(app)}>
              <Icon n="broom" s="16" />
              Remove demo data
            </Btn>
          ) : (
            <Btn className="btn set-demo-add" disabled={off || !canAddDemoData(app)} onClick={() => addDemoData(app)}>
              <Icon n="add" s="16" />
              Add demo data again
            </Btn>
          )}
        </Line>
      </Block>
      <Block title="Copy and restore" help="The whole database as one SQLite file: every list, the people and the history.">
        <Line name="Download a copy" help="Opens in any SQLite tool. Keep one before a big change.">
          <Btn className="btn set-export" onClick={() => exportSqlite(app)}>
            <Icon n="download" s="16" />
            Download .sqlite
          </Btn>
        </Line>
        <Line name="Restore from a copy" help="Replaces every record with what the file holds. You are asked first.">
          <Btn className="btn set-import" disabled={off} onClick={() => void importAppDb(app)}>
            <Icon n="arrowExport" s="16" />
            Choose a file
          </Btn>
        </Line>
      </Block>
      <Block title="Danger zone" danger help="These cannot be undone from here.">
        <Line
          name="Start over"
          help="Empties every list, deletes the records people added and the history, and puts the demo data back. People, rules and pages stay."
        >
          <Btn className="btn danger set-startover" disabled={off} onClick={() => void askStartOver(app)}>
            <Icon n="warning" s="16" />
            Start over
          </Btn>
        </Line>
      </Block>
    </>
  );
}

const PARTS: Record<string, (p: PartProps) => ReactNode> = {
  general: General,
  people: People,
  stages: Stages,
  limits: Limits,
  formats: Formats,
  pages: Pages,
  data: Data,
};

export function SettingsPage({ app, user, pane, compact }: { app: AppRecord; user: AppUser; pane: Pane; compact: boolean }) {
  const sections = settingsSections(app),
    cur = sections.find((s) => s.id === pane.setTab) || sections[0],
    blocked = settingsBlocked(app),
    Part = PARTS[cur.id],
    admins = adminRoles(app.def).map((r) => roleName(app.def, r));
  return (
    <div className={cx('scr set', compact && 'narrow')} data-settings={cur.id}>
      <div className="set-head">
        <h2 className="t-title3">Settings</h2>
        <p className="muted t-cap">
          {'Changes apply at once, for everyone who uses ' + app.name + '. Only ' + admins.join(' and ') + ' can open this page.'}
        </p>
      </div>
      {blocked && <MBar tone="warning">{blocked}</MBar>}
      <div className="set-body">
        <TabList
          className="set-nav"
          aria-label="Settings sections"
          vertical={!compact}
          size={compact ? 'small' : 'medium'}
          selectedValue={cur.id}
          onTabSelect={(e, d) => openSettings(pane, String(d.value))}
        >
          {sections.map((s) => (
            <Tab key={s.id} value={s.id} className={cx('set-tab', s.id === cur.id && 'on')} icon={<Icon n={s.icon} />}>
              {s.label}
            </Tab>
          ))}
        </TabList>
        <div className="set-main" role="tabpanel" aria-label={cur.label}>
          <Part app={app} user={user} off={!!blocked} idp={'set' + pane.n + '-'} />
        </div>
      </div>
    </div>
  );
}
