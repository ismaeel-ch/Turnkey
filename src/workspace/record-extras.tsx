/**
 * The parts of a built app that make it more than lists and forms, drawn from the app's logic (src/workspace/logic.ts):
 *
 *   Inbox       "Waiting for you" on the overview: the records the signed-in person can move on, with the move buttons
 *   StagePath   where a record is on its path, as steps
 *   Moves       the stage buttons of a record; a move whose condition does not hold is shown with the reason
 *   KeyNumbers  the calculated numbers of a record (total, paid, balance) as tiles
 *   LineItems   the records that point to a record, as a small table with totals and an Add button
 *
 * Nothing here is specific to one app: all of it is read from the definition.
 */
import { formulaWords } from '@/shared/logic';
import type { AppTable, AppUser, ColumnDef, Process, StoredRow, Transition } from '@/shared/types/app';
import type { AppRecord, Pane } from '@/shared/types/workspace';
import { cx, fmtNum, label, notify, toast } from './core';
import { accOf, apiCall, colOf, roleName, tableOf } from './engine';
import { isLocked, moveBlock } from './logic';
import { Cell, cellText, fetchApi, isStatusCol, openRecord, patchPane, rowTitle, stateLabel, stateTone } from './runtime';
import { Btn, Card, Icon } from './ui';
import { isMeasure, isRate } from './viewspec';

/** The process of a table, when it is the table whose records move through stages. */
const processOf = (app: AppRecord, t: AppTable): Process | null =>
  app.def.process && app.def.process.table === t.name ? app.def.process : null;

/** A move the signed-in person may make on a record now, or would be able to if its condition held. */
export interface OpenMove {
  tr: Transition;
  /** why it cannot be made yet, in plain words; null when it can */
  block: string | null;
}
/** The moves of a record for this person: allowed for their role, from the stage the record is in. */
export function movesFor(app: AppRecord, user: AppUser, t: AppTable, row: StoredRow): OpenMove[] {
  const P = processOf(app, t);
  if (!P) return [];
  return P.transitions
    .filter((x) => x.roles.includes(user.role) && x.from.includes(String(row[P.column])))
    .map((tr) => ({ tr, block: moveBlock(app.id, app.def, t, row, tr) }));
}

/** Makes a move and tells the person what happened. */
export function makeMove(app: AppRecord, user: AppUser, t: AppTable, row: StoredRow, tr: Transition) {
  const P = processOf(app, t);
  const r = apiCall(app, user, 'POST', '/api/' + t.name + '/' + row.id + '/' + tr.id, {}, 'app');
  const ok = r.status === 200 && !!P;
  toast(
    ok
      ? tr.label + ': now ' + label(r.data[P.column]).toLowerCase()
      : r.status === 409 || r.status === 400
        ? String(r.error)
        : r.status + ' ' + r.error,
    ok ? 'success' : r.status === 409 ? 'warning' : 'danger',
  );
  notify();
  return ok;
}

/** The stage buttons of a record. A move that is held back stays visible, switched off, with the reason under it. */
export function Moves({ app, user, t, row, small }: { app: AppRecord; user: AppUser; t: AppTable; row: StoredRow; small?: boolean }) {
  const moves = movesFor(app, user, t, row);
  if (!moves.length) return null;
  const held = moves.filter((m) => m.block),
    firstOpen = moves.find((m) => !m.block);
  return (
    <span className="lg-moves">
      <span className="row wrap gap8">
        {moves.map((m) => {
          const primary = m === firstOpen;
          return (
            <Btn
              key={m.tr.id}
              className={cx('btn sm', primary && 'primary')}
              disabled={!!m.block}
              title={m.block || undefined}
              data-move={m.tr.id}
              onClick={(e: { stopPropagation(): void }) => {
                e.stopPropagation();
                makeMove(app, user, t, row, m.tr);
              }}
            >
              {m.tr.label}
            </Btn>
          );
        })}
      </span>
      {!small &&
        held.map((m) => (
          <span key={m.tr.id} className="lg-held t-cap">
            <Icon n="info" s="16" />
            <span>
              <strong>{m.tr.label}</strong>
              {': '}
              {m.block}
            </span>
          </span>
        ))}
    </span>
  );
}

/** Where a record is on its path. Stages that end the path badly (rejected, cancelled) show only when it is there. */
export function StagePath({ app, t, row }: { app: AppRecord; t: AppTable; row: StoredRow }) {
  const P = processOf(app, t);
  if (!P || P.states.length < 3) return null;
  const now = String(row[P.column]),
    here = P.states.find((s) => s.id === now);
  const path = P.states.filter((s) => s.tone !== 'danger' || s.id === now);
  const at = path.findIndex((s) => s.id === now);
  if (at < 0 || path.length > 7) return null;
  return (
    <ol className="lg-path" aria-label={'Stage: ' + (here ? here.label : label(now))}>
      {path.map((s, i) => (
        <li
          key={s.id}
          className={cx('lg-step', i < at && 'done', i === at && 'on', i === at && 'tone-' + s.tone)}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="lg-dot">{i < at ? <Icon n="check" s="12" /> : i + 1}</span>
          <span className="lg-step-l">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** A calculated field's formula in words, for the hint beside it. */
export const calcWords = (app: AppRecord, t: AppTable, c: ColumnDef) => (c.formula ? formulaWords(app.def.tables, t.name, c.formula) : '');

/** The small mark beside the name of a calculated field. */
export const CalcMark = ({ app, t, c }: { app: AppRecord; t: AppTable; c: ColumnDef }) =>
  c.formula ? (
    <span className="lg-calc" title={'Worked out by the app: ' + calcWords(app, t, c)}>
      <Icon n="calculator" s="12" />
      <span className="sr-only">calculated</span>
    </span>
  ) : null;

/** The calculated numbers of a record, which are what a person opens it for: a total, what is paid, what is left. */
export const keyNumbers = (app: AppRecord, t: AppTable) =>
  t.columns.filter((c) => c.formula && isMeasure(c) && !isStatusCol(app.def, t, c)).slice(0, 4);
export function KeyNumbers({ app, user, t, row }: { app: AppRecord; user: AppUser; t: AppTable; row: StoredRow }) {
  const cols = keyNumbers(app, t);
  if (!cols.length) return null;
  return (
    <div className="lg-stats" role="group" aria-label="Worked out by the app">
      {cols.map((c) => {
        const v = row[c.name],
          neg = typeof v === 'number' && v < 0;
        return (
          <div key={c.name} className={cx('lg-stat', neg && 'neg')} title={calcWords(app, t, c)}>
            <span className="lg-stat-l">{c.label}</span>
            <span className="lg-stat-v">
              {v == null || v === '' ? '–' : cellText(app, user, t, c, v, 0) + (isRate(c) && /percent|pct|share/.test(c.name) ? '%' : '')}
            </span>
            <span className="lg-stat-s t-cap muted">{calcWords(app, t, c)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The columns a small table of related records shows: the title, then what tells one line from another. */
function lineCols(app: AppRecord, k: AppTable, via: string): ColumnDef[] {
  const rest = k.columns.filter((c) => c.name !== via && c.name !== k.title && c.type !== 'longtext');
  const nums = rest.filter((c) => isMeasure(c)),
    stage = rest.filter((c) => isStatusCol(app.def, k, c)),
    others = rest.filter((c) => !nums.includes(c) && !stage.includes(c));
  const picked = [...others.slice(0, Math.max(0, 3 - Math.min(nums.length, 3) - stage.length)), ...nums.slice(0, 3), ...stage];
  const title = colOf(k, k.title);
  return (title ? [title] : []).concat(k.columns.filter((c) => picked.includes(c))).slice(0, 5);
}

/**
 * The records that point to this one (the lines of an order, the payments of an invoice, the tasks of a project), as
 * a table with a total under every amount. Adding a line opens its form with the link already filled in.
 */
export function LineItems({
  app,
  user,
  pane,
  t,
  k,
  row,
}: {
  app: AppRecord;
  user: AppUser;
  pane: Pane;
  t: AppTable;
  k: AppTable;
  row: StoredRow;
}) {
  const c = k.columns.find((x) => x.type === 'ref' && x.ref === t.name);
  if (!c) return null;
  const res = fetchApi(app, user, '/api/' + k.name, { filter: { [c.name]: row.id } });
  if (res.status !== 200) return null;
  const list: StoredRow[] = res.data,
    cols = lineCols(app, k, c.name),
    shown = list.slice(0, 12),
    locked = isLocked(processOf(app, t), row);
  const total = (col: ColumnDef) => {
    const vals = list.map((r) => Number(r[col.name])).filter((v) => Number.isFinite(v));
    if (!vals.length) return '';
    const sum = vals.reduce((a, b) => a + b, 0);
    return fmtNum(isRate(col) ? Math.round((sum / vals.length) * 100) / 100 : Math.round(sum * 100) / 100);
  };
  const hasTotals = list.length > 1 && cols.some((x) => isMeasure(x));
  return (
    <section className="lg-lines" data-lines={k.name}>
      <div className="row between">
        <h3 className="sec-h">
          {k.label}
          {' ('}
          {list.length})
        </h3>
        {accOf(app.def, user.role, k.name).create && !locked && (
          <Btn
            className="btn subtle sm"
            onClick={() => patchPane(pane, { form: { table: k.name, id: null, vals: { [c.name]: row.id }, errs: {} } })}
          >
            <Icon n="add" s="16" />
            {'Add ' + k.one.toLowerCase()}
          </Btn>
        )}
      </div>
      {list.length ? (
        <div className="lg-tbox">
          <table className="lg-tbl">
            <thead>
              <tr>
                {cols.map((x) => (
                  <th key={x.name} scope="col" className={cx(isMeasure(x) && 'num')}>
                    {x.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  className="lg-row"
                  tabIndex={0}
                  onClick={() => openRecord(pane, k.name, r.id)}
                  onKeyDown={(e) => e.key === 'Enter' && openRecord(pane, k.name, r.id)}
                >
                  {cols.map((x, i) => (
                    <td key={x.name} className={cx(isMeasure(x) && 'num', i === 0 && 't-strong')}>
                      {i === 0 ? rowTitle(app, user, k, r) : <Cell app={app} user={user} t={k} c={x} v={r[x.name]} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasTotals && (
              <tfoot>
                <tr>
                  {cols.map((x, i) => (
                    <td key={x.name} className={cx(isMeasure(x) && 'num')}>
                      {i === 0 ? (isMeasure(x) ? total(x) : 'Total') : isMeasure(x) ? total(x) : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
          {list.length > shown.length && (
            <p className="t-cap muted">{'And ' + (list.length - shown.length) + ' more. Open ' + k.label + ' to see all.'}</p>
          )}
        </div>
      ) : (
        <p className="muted t-cap">{locked ? 'None.' : 'None yet.'}</p>
      )}
    </section>
  );
}

/** The records that wait for the signed-in person: they are in a stage this person's kind moves on. */
export function waitingFor(
  app: AppRecord,
  user: AppUser,
  src?: string,
): { t: AppTable; rows: { row: StoredRow; moves: OpenMove[] }[] } | null {
  const P = app.def.process,
    t = P && P.states.length ? tableOf(app.def, P.table) : null;
  if (!P || !t || accOf(app.def, user.role, t.name).list === 'none') return null;
  // someone who uses the app alone has nobody to wait for: every record would be on the list
  if ((app.def.brief?.roles.length || 0) < 2) return null;
  if (!P.transitions.some((x) => x.roles.includes(user.role))) return null;
  const res = fetchApi(app, user, '/api/' + t.name, null, src);
  if (res.status !== 200) return null;
  const rows = (res.data as StoredRow[])
    .map((row) => ({ row, moves: movesFor(app, user, t, row) }))
    // a record waits for someone when they can move it on now; one that is only held back is not theirs to act on yet
    .filter((x) => x.moves.some((m) => !m.block))
    .sort((a, b) => a.row.id - b.row.id);
  return { t, rows };
}

/** "Waiting for you": on top of the overview, so the first thing a person sees is what they have to do. */
export function Inbox({ app, user, pane, src }: { app: AppRecord; user: AppUser; pane: Pane; src?: string }) {
  const w = waitingFor(app, user, src);
  if (!w) return null;
  const { t, rows } = w,
    P = app.def.process as Process,
    sc = colOf(t, P.column),
    shown = rows.slice(0, 5);
  // the fact that tells the records apart at a glance: an amount if there is one, and whose it is
  const amount = t.columns.find((c) => c.type === 'money') || t.columns.find((c) => isMeasure(c) && !isRate(c)),
    who = t.columns.find((c) => c.type === 'user' && c.name === t.owner) || t.columns.find((c) => c.type === 'user');
  return (
    <Card className="card lg-inbox" data-waiting={rows.length}>
      <div className="row between gap8">
        <h3 className="widget-h">
          <Icon n="alert" s="16" />
          Waiting for you
        </h3>
        <span className={cx('badge', rows.length ? 'b-warning' : 'b-success')}>{rows.length ? rows.length + ' to do' : 'All done'}</span>
      </div>
      {rows.length ? (
        <ul className="lg-todo">
          {shown.map(({ row }) => (
            <li key={row.id} className="lg-todo-i">
              <button className="lg-todo-open" onClick={() => openRecord(pane, t.name, row.id)}>
                <span className="t-strong ellipsis">{rowTitle(app, user, t, row)}</span>
                <span className="t-cap muted ellipsis">
                  {[
                    who && row[who.name] != null ? cellText(app, user, t, who, row[who.name], 0) : '',
                    amount && row[amount.name] != null ? amount.label + ' ' + cellText(app, user, t, amount, row[amount.name], 0) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
              <span className={'badge b-' + stateTone(app.def, t, sc, row[P.column])}>{stateLabel(app.def, t, sc, row[P.column])}</span>
              <Moves app={app} user={user} t={t} row={row} small />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted t-cap">
          {'No ' + t.label.toLowerCase() + ' need a ' + roleName(app.def, user.role).toLowerCase() + ' right now.'}
        </p>
      )}
      {rows.length > shown.length && <p className="t-cap muted">{'And ' + (rows.length - shown.length) + ' more in ' + t.label + '.'}</p>}
    </Card>
  );
}
