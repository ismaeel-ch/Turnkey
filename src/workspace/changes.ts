import type { AppTable, BackedDef, Check, Migration, ColumnDef, ColumnType, DashWidget, Row, Screen, Untrusted } from '@/shared/types/app';
import type { AppRecord, Dict, StationLine, ToolContext } from '@/shared/types/workspace';
import {
  BRAND,
  NO_MODEL,
  U,
  arr,
  cap,
  commit,
  emit,
  errText,
  fmtMs,
  isoDate,
  label,
  modeNow,
  notify,
  setChat,
  snake,
  str,
  toast,
  liveModelOn,
} from './core';
import { colSQL, createTableSQL, dbCount, dbRelease, dbRollback, dbSavepoint, dbTables, qi, sqlPeek, sqlRun } from './db';
import {
  ACCENTS,
  LIMITS,
  TYPES,
  TYPE_ALIAS,
  TYPE_LABEL,
  VIEW_ICON,
  VIEW_LABEL,
  appUsers,
  checkBackendLive,
  checkBackendShape,
  checkLinks,
  chk,
  colOf,
  deriveEndpoints,
  findCol,
  findRole,
  findTable,
  insertSeed,
  issuesOf,
  normSchema,
  renderTest,
  roleName,
  runAcceptance,
  tableOf,
} from './engine';
import {
  DATA_VIEWS,
  VIEW_ALIAS,
  checkScreensShape,
  checkViews,
  isCat,
  isDate,
  mayOpen,
  refreshViews,
  renderViewsTest,
  viewCfg,
  viewFit,
  viewsOf,
} from './viewspec';
import { TEAMS, checkTeam } from './team';
import { runTestsSync } from './tests';
import {
  HEAD,
  PENDING,
  RUNS,
  STATIONS,
  Stopped,
  answerQuestion,
  callModel,
  newRun,
  pAccess,
  pTables,
  pace,
  pushChat,
  resetAppData,
  say,
  stationIdx,
  stepEnd,
  stepStart,
} from './line';
import { FLOW_HELP, LEVELS, NOTE_FOR, REVIEWERS, agentThe, answerGate, flowChat, flowList, flowOf, parseFlow } from './custom';
import { logChange } from './release';
import { recordTouches, snapshotDef } from './provenance';

/* ===== Turnkey prototype · changes from chat: operations, migrations, partial re-runs, build pack ===== */
export const COLOR_WORDS: Dict<string> = {
  teal: 'teal',
  blue: 'blue',
  purple: 'purple',
  violet: 'purple',
  red: 'cranberry',
  cranberry: 'cranberry',
  green: 'forest',
  forest: 'forest',
  yellow: 'marigold',
  marigold: 'marigold',
  orange: 'pumpkin',
  pumpkin: 'pumpkin',
  pink: 'pink',
  grey: 'steel',
  gray: 'steel',
  steel: 'steel',
  lavender: 'lavender',
  'royal blue': 'royalBlue',
  magenta: 'magenta',
  navy: 'navy',
  grape: 'grape',
  seafoam: 'seafoam',
};
export const ACT_WORDS: Dict<'list' | 'create' | 'update' | 'delete'> = {
  see: 'list',
  view: 'list',
  read: 'list',
  list: 'list',
  open: 'list',
  seeing: 'list',
  viewing: 'list',
  reading: 'list',
  create: 'create',
  add: 'create',
  creating: 'create',
  adding: 'create',
  edit: 'update',
  update: 'update',
  change: 'update',
  editing: 'update',
  updating: 'update',
  changing: 'update',
  delete: 'delete',
  remove: 'delete',
  deleting: 'delete',
  removing: 'delete',
};
export const ACT_VERB: Dict<string> = {
  list: 'see',
  create: 'create',
  update: 'edit',
  delete: 'delete',
};
export function inferType(name: string): { type: string; options?: string[] | null } {
  const n = String(name).toLowerCase();
  if (/\b(date|deadline|due|birthday|expiry|expires|until)\b/.test(n))
    return {
      type: 'date',
    };
  if (/\b(cost|price|amount|fee|budget|salary|total)\b/.test(n))
    return {
      type: 'money',
    };
  if (/\b(count|quantity|qty|age|score|rating|hours|days)\b/.test(n))
    return {
      type: 'number',
    };
  if (/\b(priority|urgency|severity)\b/.test(n))
    return {
      type: 'select',
      options: ['low', 'medium', 'high'],
    };
  if (/^(is|has|needs|requires)\b|\b(urgent|confirmed|paid|active|flag|approved)\b/.test(n))
    return {
      type: 'bool',
    };
  if (/\b(notes?|details?|description|comments?|summary|instructions)\b/.test(n))
    return {
      type: 'longtext',
    };
  return {
    type: 'text',
  };
}
/** What a request in chat turns into: operations to plan, a special action, or nothing this reader understands. */
export interface ParsedChange {
  ops?: Dict<Untrusted>[];
  special?: string;
  reply?: string | null;
}
export function parseChange(app: unknown, text: string): ParsedChange {
  // Demo mode: a small rule-based reader stands in for the model
  const s = String(text)
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^please\s+/i, '');
  let m: RegExpExecArray | null;
  if (/^(reset|restore) (the |all )?(demo |seed )?data$/i.test(s) || /^re-?seed/i.test(s))
    return {
      special: 'reseed',
    };
  if ((m = /^(?:rename|call) (?:the |this )?app (?:to )?["“']?(.+?)["”']?$/i.exec(s)))
    return {
      ops: [
        {
          op: 'rename_app',
          name: m[1],
        },
      ],
    };
  if ((m = /\b(top|side|rail)\s*(?:nav|navigation|menu|bar)?$/i.exec(s)) && /nav|menu|bar|rail|layout/i.test(s))
    return {
      ops: [
        {
          op: 'set_theme',
          nav: m[1].toLowerCase(),
        },
      ],
    };
  if ((m = /\b(top|side)\s*(?:nav|navigation|menu|bar)/i.exec(s)))
    return {
      ops: [
        {
          op: 'set_theme',
          nav: m[1].toLowerCase(),
        },
      ],
    };
  if (/\b(compact|dense|tighter)\b/i.test(s) && /\b(rows?|layout|density|it|app)\b/i.test(s))
    return {
      ops: [
        {
          op: 'set_theme',
          density: 'compact',
        },
      ],
    };
  if (
    (m =
      /^add (?:an? |the )?(?:chart|graph|bars?) (?:of|for|on) (?:the |all )?(.+?) (?:by|per) (?:the )?(.+?) to (?:the )?(?:dashboard|overview)$/i.exec(
        s,
      ))
  )
    return {
      ops: [
        {
          op: 'add_widget',
          table: m[1],
          by: m[2],
        },
      ],
    };
  if (
    (m =
      /^(?:make it|make the app|use|switch to|change (?:the )?(?:colou?r|theme|accent) to)\s+(?:the colou?r\s+)?([a-z ]+?)(?:\s+(?:theme|colou?r|accent))?$/i.exec(
        s,
      )) &&
    COLOR_WORDS[m[1].toLowerCase().trim()]
  )
    return {
      ops: [
        {
          op: 'set_theme',
          accent: COLOR_WORDS[m[1].toLowerCase().trim()],
        },
      ],
    };
  if (
    (m =
      /^add (?:an? |the )?(board|kanban|calendar|table|list|timeline|gantt|chart|graph|pivot|tree|hierarchy|cards|gallery|dashboard|form)(?: view| screen| page)? (?:of|for|on|with) (?:the |all )?(.+?)(?: (?:by|grouped by|per) (?:the )?(.+))?$/i.exec(
        s,
      ))
  )
    return {
      ops: [
        {
          op: 'add_view',
          type: m[1].toLowerCase(),
          table: m[2],
          by: m[3] || '',
        },
      ],
    };
  if ((m = /^(?:remove|delete|drop) (?:the )?(.+?) (?:screen|view)$/i.exec(s)))
    return {
      ops: [
        {
          op: 'remove_view',
          name: m[1],
        },
      ],
    };
  if ((m = /^(?:remove|delete|drop) (?:the )?(.+?)(?: field| column)? (?:from|in|on) (?:the )?(.+)$/i.exec(s)))
    return {
      ops: [
        {
          op: 'remove_field',
          name: m[1],
          table: m[2],
        },
      ],
    };
  if ((m = /^rename (?:the )?(.+?)(?: field| column)? (?:in|on|of) (?:the )?(.+?) to ["“']?(.+?)["”']?$/i.exec(s)))
    return {
      ops: [
        {
          op: 'rename_field',
          name: m[1],
          table: m[2],
          to: m[3],
        },
      ],
    };
  if (
    (m =
      /^(?:turn|make|convert|change) (?:the )?(.+?)(?: field| column)? (?:in|on|of) (?:the )?(.+?) (?:into|to) (?:a |an )?(?:choice|list of choices|drop-?down|select|options?)(?: field)?$/i.exec(
        s,
      ))
  )
    return {
      ops: [
        {
          op: 'to_choice',
          name: m[1],
          table: m[2],
        },
      ],
    };
  if (
    (m =
      /^(?:let|allow) (?:the )?(.+?) (?:to )?(see|view|read|list|open|create|add|edit|update|change|delete|remove) (their own |own )?(?:the |all )?(.+)$/i.exec(
        s,
      ))
  )
    return {
      ops: [
        {
          op: 'set_access',
          role: m[1],
          action: m[2].toLowerCase(),
          table: m[4],
          value: m[3] ? 'own' : true,
        },
      ],
    };
  if (
    (m =
      /^(?:stop|prevent|block) (?:the )?(.+?) from (seeing|viewing|reading|creating|adding|editing|updating|changing|deleting|removing) (?:the |their own |own |all )?(.+)$/i.exec(
        s,
      ))
  )
    return {
      ops: [
        {
          op: 'set_access',
          role: m[1],
          action: m[2].toLowerCase(),
          table: m[3],
          value: false,
        },
      ],
    };
  if ((m = /^add (?:an? |the )?(?:new )?(.+?)(?: field| column)? (?:to|on|in|for) (?:the |each |every )?(.+)$/i.exec(s))) {
    let name = m[1].trim(),
      type: string | null = null,
      options: string[] | null = null;
    const pm = /^(.+?)\s*\((?:choice|choices|options?)\s*:\s*(.+)\)$/i.exec(name);
    if (pm) {
      name = pm[1];
      type = 'select';
      options = pm[2]
        .split(/[,/]/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
    const tm = /^(text|number|date|money|yes\/no|long text|choice) (?:field )?(?:called |named )?(.+)$/i.exec(name);
    if (tm) {
      type =
        (
          {
            'yes/no': 'bool',
            'long text': 'longtext',
            choice: 'select',
          } as Dict<string>
        )[tm[1].toLowerCase()] || tm[1].toLowerCase();
      name = tm[2];
    }
    const inf = type
      ? {
          type,
          options,
        }
      : inferType(name);
    return {
      ops: [
        {
          op: 'add_field',
          table: m[2],
          name: name.replace(/^["“']|["”']$/g, ''),
          type: inf.type,
          options: inf.options,
        },
      ],
    };
  }
  return {
    reply: null,
  };
}
export function suggestChanges(app: AppRecord) {
  // example chips under the chat box, made from the app's own tables
  const def = app.def;
  if (!def.tables.length || !def.process) return [];
  const pt = tableOf(def, def.process.table) as AppTable,
    out: string[] = [],
    other = def.tables.find((t) => t !== pt) || pt;
  out.push('Add a ' + (colOf(other, 'notes') ? 'reference code' : 'notes') + ' field to ' + other.label.toLowerCase());
  const status = def.process.column,
    sel = pt.columns.find((c) => c.type === 'select' && c.name !== status);
  if (sel) out.push('Add a board of ' + pt.label.toLowerCase() + ' by ' + String(sel.label).toLowerCase());
  const dash = def.dash;
  const free = (t: AppTable, c: ColumnDef) => !(dash && dash.widgets.some((w) => w.table === t.name && w.x === c.name)),
    pairs: [AppTable, ColumnDef][] = [];
  [pt].concat(def.tables.filter((t) => t !== pt)).forEach((t) =>
    t.columns.forEach((c) => {
      if (c.type === 'select' && free(t, c)) pairs.push([t, c]);
    }),
  );
  if (pairs.length)
    out.push('Add a chart of ' + pairs[0][0].label.toLowerCase() + ' by ' + String(pairs[0][1].label).toLowerCase() + ' to the dashboard');
  const drop = other.columns.find(
    (c) =>
      !c.required &&
      c.name !== other.title &&
      c.name !== other.owner &&
      c.type !== 'ref' &&
      c.type !== 'user' &&
      !def.screens.some((s) => s.table === other.name && (s.group === c.name || s.date === c.name || s.end === c.name)),
  );
  if (drop) out.push('Remove the ' + String(drop.label).toLowerCase() + ' field from ' + other.label.toLowerCase());
  out.push('Make it ' + (def.theme.accent === 'purple' ? 'teal' : 'purple'));
  return out;
}

/* ---------- turning one operation into a checked step ---------- */
/** One entry of the app's migration log. */
export const mig = (def: { migrations: unknown[] }, sql: string, note: string): Migration => ({
  n: def.migrations.length + 1,
  at: Date.now(),
  by: 'database',
  sql,
  note,
});
export function renameEverywhere(app: AppRecord & { def: BackedDef }, t: AppTable, old: string, nn: string) {
  const def = app.def,
    P = def.process,
    mv = (o: Dict<unknown> | null | undefined) => {
      if (o && old in o) {
        o[nn] = o[old];
        delete o[old];
      }
    };
  if (t.title === old) t.title = nn;
  if (t.owner === old) t.owner = nn;
  if (P.table === t.name) {
    if (P.column === old) P.column = nn;
    P.transitions.forEach((x) => mv(x.set));
  }
  def.screens.forEach((s) => {
    if (s.table === t.name) {
      s.columns = s.columns.map((x) => (x === old ? nn : x));
      ['group', 'date', 'end', 'label'].forEach((k) => {
        if (s[k] === old) s[k] = nn;
      });
    }
    ((s.widgets || []) as Dict<Untrusted>[]).forEach((w) => {
      if (w.table === t.name) {
        if (w.column === old) w.column = nn;
        mv(w.where);
      }
    });
  });
  (def.views[t.name] || []).forEach((v: Dict<Untrusted>) => {
    ['by', 'lane', 'date', 'end', 'start', 'x', 'split', 'rows', 'cols', 'parent'].forEach((k) => {
      if (v[k] === old) v[k] = nn;
    });
    if (v.levels) v.levels = v.levels.map((x: string) => (x === old ? nn : x));
    if (v.measure && v.measure.split(':')[1] === old) v.measure = v.measure.split(':')[0] + ':' + nn;
  });
  if (def.dash) {
    def.dash.widgets.forEach((w) => {
      if (w.table !== t.name) return;
      if (w.x === old) w.x = nn;
      if (w.split === old) w.split = nn;
      if (w.measure && w.measure.split(':')[1] === old) w.measure = w.measure.split(':')[0] + ':' + nn;
      mv(w.where);
    });
    if (def.dash.date && def.dash.date.table === t.name && def.dash.date.column === old) def.dash.date.column = nn;
  }
  def.tour.forEach((st) => {
    if ((st.table || P.table) === t.name) mv(st.values);
  });
  (def.cases || []).forEach((c) =>
    c.steps.forEach((st) => {
      if ((st.table || P.table) === t.name) mv(st.values);
    }),
  );
  def.actions.forEach((a) => {
    if (a.table === t.name && a.arg === old) a.arg = nn;
  });
  arr<Row>(app.seed && app.seed.rows[t.name]).forEach((r) => mv(r));
}
export interface PlannedStep {
  station: string;
  text: string;
  sql?: string;
  destructive?: boolean;
  loss?: string;
  run(ctx: { runN: number }): void;
}
type BackedApp = AppRecord & { def: BackedDef };
const need = <X>(x: X, msg: string): NonNullable<X> => {
  if (!x) throw new Error(msg);
  return x as NonNullable<X>;
};
export function planOne(app: BackedApp, o: Untrusted): PlannedStep {
  const def = app.def,
    roleIds = def.brief.roles.map((r) => r.id);
  const T = (q: string) =>
    need(
      findTable(def, q),
      'I could not find a table called "' + q + '". The tables are ' + def.tables.map((t) => t.label).join(', ') + '.',
    );
  switch (o.op) {
    case 'add_field': {
      const t = T(o.table),
        name = need(snake(o.name), 'The new field needs a name.');
      if (colOf(t, name) || ['id', 'created_at', 'created_by'].includes(name))
        throw new Error(t.label + ' already has a ' + label(name).toLowerCase() + ' field.');
      if (t.columns.length >= LIMITS.cols) throw new Error(t.label + ' is at the limit of ' + LIMITS.cols + ' fields.');
      const type = TYPES.includes(o.type) ? o.type : TYPE_ALIAS[o.type] || 'text',
        col: ColumnDef = {
          name,
          label: str(o.label) || label(o.name),
          type: type as ColumnType,
          required: false,
        };
      if (type === 'select') {
        col.options = arr(o.options).map(snake).filter(Boolean);
        if (!col.options.length) col.options = ['low', 'medium', 'high'];
      }
      if (type === 'ref') col.ref = T(o.ref).name;
      if (type === 'user') col.role = null;
      const sql = 'ALTER TABLE ' + qi(t.name) + ' ADD COLUMN ' + colSQL(col, true);
      return {
        station: 'database',
        text: 'Add ' + col.label + ' (' + TYPE_LABEL[type].toLowerCase() + ') to ' + t.label,
        sql,
        run(ctx) {
          sqlRun(app.id, sql, null, 'database');
          t.columns.push(
            Object.assign(
              {
                by: 'database',
                run: ctx.runN,
              },
              col,
            ),
          );
          def.migrations.push(mig(def, sql, 'Added ' + t.name + '.' + col.name));
          def.screens.forEach((s) => {
            if (s.table === t.name && s.type === 'table' && s.columns.length < 7 && type !== 'longtext') s.columns.push(col.name);
          });
        },
      };
    }
    case 'remove_field': {
      const t = T(o.table),
        c = need(
          findCol(t, o.name),
          t.label + ' has no field called "' + o.name + '". Its fields are ' + t.columns.map((x) => x.label).join(', ') + '.',
        );
      if (c.name === t.title || c.name === t.owner || (def.process.table === t.name && def.process.column === c.name))
        throw new Error(c.label + ' is the title, owner or status of ' + t.label + ', so it stays.');
      if (c.type === 'ref' || c.type === 'user')
        throw new Error(
          c.label +
            ' is a link to other records. Removing a link needs a rebuild-and-copy migration, which this prototype leaves to the real build.',
        );
      const used = def.screens
        .filter((s) => s.table === t.name && (s.group === c.name || s.date === c.name || s.end === c.name))
        .map((s) => s.name);
      if (used.length) throw new Error(c.label + ' drives the ' + used.join(' and ') + ' screen. Remove that screen first.');
      const n =
        (
          sqlPeek(
            app.id,
            'SELECT COUNT(*) AS n FROM ' + qi(t.name) + ' WHERE ' + qi(c.name) + ' IS NOT NULL AND ' + qi(c.name) + " <> ''",
          )[0] || {}
        ).n || 0;
      const sql = 'ALTER TABLE ' + qi(t.name) + ' DROP COLUMN ' + qi(c.name);
      return {
        station: 'database',
        text: 'Remove ' + c.label + ' from ' + t.label,
        sql,
        destructive: Number(n) > 0,
        loss: n + ' stored value' + (n === 1 ? '' : 's') + ' will be deleted',
        run() {
          sqlRun(app.id, sql, null, 'database');
          t.columns = t.columns.filter((x) => x !== c);
          def.migrations.push(mig(def, sql, 'Removed ' + t.name + '.' + c.name));
          def.screens.forEach((s) => {
            if (s.table === t.name) {
              s.columns = s.columns.filter((x) => x !== c.name);
              if (s.label === c.name) delete s.label;
              if (!s.columns.length) s.columns = t.columns.slice(0, 4).map((x) => x.name);
            }
            if (s.widgets)
              s.widgets = s.widgets.filter((w) => !(w.table === t.name && (w.column === c.name || (w.where && c.name in w.where))));
          });
          def.tour.forEach((st) => {
            if ((st.table || def.process.table) === t.name && st.values) delete st.values[c.name];
          });
          (def.cases || []).forEach((k) =>
            k.steps.forEach((st) => {
              if ((st.table || def.process.table) === t.name && st.values) delete st.values[c.name];
            }),
          );
          def.actions = def.actions.filter((a) => !(a.table === t.name && a.arg === c.name));
        },
      };
    }
    case 'to_choice': {
      // normalise free text that repeats: the values in use become the options, and every row is rewritten to match
      const t = T(o.table),
        c = need(findCol(t, o.name), t.label + ' has no field called "' + o.name + '".');
      if (c.type === 'select') throw new Error(c.label + ' is already a choice.');
      if (c.type !== 'text' || c.name === t.title) throw new Error('Only a plain text field that is not the title can become a choice.');
      const vals = sqlPeek(
          app.id,
          'SELECT DISTINCT ' +
            qi(c.name) +
            ' AS v FROM ' +
            qi(t.name) +
            ' WHERE ' +
            qi(c.name) +
            ' IS NOT NULL AND ' +
            qi(c.name) +
            " <> ''",
        ).map((r) => String(r.v)),
        opts = vals.map(snake).filter((v, i, a) => v && a.indexOf(v) === i);
      if (opts.length < 2 || opts.length > 8)
        throw new Error(c.label + ' holds ' + opts.length + ' different values, and a choice works with 2 to 8.');
      const sql = 'UPDATE ' + qi(t.name) + ' SET ' + qi(c.name) + ' = lower(replace(trim(' + qi(c.name) + "), ' ', '_'))";
      return {
        station: 'database',
        text: 'Turn ' + c.label + ' in ' + t.label + ' into a choice of ' + opts.length,
        sql,
        run() {
          vals.forEach((v) => {
            if (snake(v) !== v)
              sqlRun(
                app.id,
                'UPDATE ' + qi(t.name) + ' SET ' + qi(c.name) + ' = ? WHERE ' + qi(c.name) + ' = ?',
                [snake(v), v],
                'database',
              );
          });
          c.type = 'select';
          c.options = opts;
          const lab: Dict<string> = {};
          vals.forEach((v) => {
            if (label(snake(v)) !== v) lab[snake(v)] = v;
          });
          if (Object.keys(lab).length) c.labels = lab;
          arr<Row>(app.seed && app.seed.rows[t.name]).forEach((r) => {
            if (r[c.name] != null && r[c.name] !== '') r[c.name] = snake(String(r[c.name]));
          });
          def.migrations.push(mig(def, sql, 'Turned ' + t.name + '.' + c.name + ' into a choice'));
        },
      };
    }
    case 'rename_field': {
      const t = T(o.table),
        c = need(findCol(t, o.name), t.label + ' has no field called "' + o.name + '".'),
        nn = need(snake(o.to), 'The field needs a new name.'),
        lab = str(o.label) || label(o.to);
      if (nn === c.name)
        return {
          station: 'screens',
          text: 'Relabel ' + c.label + ' as ' + lab,
          run() {
            c.label = lab;
          },
        };
      if (colOf(t, nn) || ['id', 'created_at', 'created_by'].includes(nn))
        throw new Error(t.label + ' already has a field called ' + lab + '.');
      const sql = 'ALTER TABLE ' + qi(t.name) + ' RENAME COLUMN ' + qi(c.name) + ' TO ' + qi(nn);
      return {
        station: 'database',
        text: 'Rename ' + c.label + ' to ' + lab + ' in ' + t.label,
        sql,
        run() {
          sqlRun(app.id, sql, null, 'database');
          const old = c.name;
          c.name = nn;
          c.label = lab;
          renameEverywhere(app, t, old, nn);
          def.migrations.push(mig(def, sql, 'Renamed ' + t.name + '.' + old + ' to ' + nn));
        },
      };
    }
    case 'add_view': {
      const type = VIEW_ALIAS[o.type] || o.type;
      need(DATA_VIEWS.includes(type) || type === 'form' || type === 'dashboard', 'I can add a ' + DATA_VIEWS.join(', ') + ' or form page.');
      if (type === 'dashboard')
        throw new Error(
          'Every role already has the dashboard. Ask me to add a chart to it, for example "add a chart of ' +
            def.tables[0].label.toLowerCase() +
            ' by ' +
            ((def.tables[0].columns.find(isCat) || {}).label || 'status').toLowerCase() +
            ' to the dashboard".',
        );
      if (def.screens.length >= LIMITS.screens) throw new Error('The app is at the limit of ' + LIMITS.screens + ' screens.');
      const t = T(o.table),
        roles = roleIds.filter((r) => mayOpen(def, r, type, t.name));
      need(roles.length, 'No role may use ' + t.label + ' that way yet.');
      const why = type === 'form' ? null : viewFit(def, t, type);
      if (why) throw new Error('A ' + VIEW_LABEL[type].toLowerCase() + ' of ' + t.label.toLowerCase() + ' ' + why + '.');
      const scr: Screen = {
        id: 's' + (Math.max.apply(null, def.screens.map((s) => +s.id.slice(1) || 0).concat([0])) + 1),
        name: '',
        type,
        table: t.name,
        roles,
        columns: t.columns
          .filter((c) => c.type !== 'longtext')
          .slice(0, 5)
          .map((c) => c.name),
        icon: VIEW_ICON[type],
      };
      const by = o.by ? findCol(t, o.by) : null;
      if (o.by && !by) throw new Error(t.label + ' has no field called "' + o.by + '".');
      if (type === 'board') {
        if (by && by.type !== 'select')
          throw new Error('A board groups cards by a choice field. ' + by.label + ' is ' + TYPE_LABEL[by.type].toLowerCase() + '.');
        scr.group = by ? by.name : (viewCfg(def, t, 'board', {}).by as string);
      }
      if (type === 'calendar' || type === 'timeline') {
        if (by && !isDate(by))
          throw new Error('A ' + type + ' needs a date field. ' + by.label + ' is ' + TYPE_LABEL[by.type].toLowerCase() + '.');
        scr.date = by ? by.name : (t.columns.find(isDate) || {}).name;
      }
      const cfg =
        type === 'form'
          ? {}
          : viewCfg(
              def,
              t,
              type,
              type === 'chart' && by
                ? {
                    x: by.name,
                  }
                : type === 'pivot' && by
                  ? {
                      rows: by.name,
                    }
                  : type === 'tree' && by
                    ? {
                        levels: [by.name],
                      }
                    : type === 'board'
                      ? {
                          by: scr.group,
                        }
                      : type === 'calendar'
                        ? {
                            date: scr.date,
                          }
                        : type === 'timeline'
                          ? {
                              start: scr.date,
                            }
                          : {},
            );
      const isNew = type !== 'form' && !viewsOf(def, t).some((v) => v.type === type),
        byText = by && ['chart', 'pivot', 'tree'].includes(type) ? ' by ' + String(by.label).toLowerCase() : '';
      let name =
        str(o.name) ||
        (type === 'board'
          ? t.label + ' by ' + String(colOf(t, scr.group)?.label).toLowerCase()
          : type === 'form'
            ? 'New ' + t.one.toLowerCase()
            : t.label + ' ' + VIEW_LABEL[type].toLowerCase() + byText);
      let k = 2;
      const base = name;
      while (def.screens.some((s) => s.name.toLowerCase() === name.toLowerCase())) name = base + ' ' + k++;
      scr.name = name;
      return {
        station: isNew || byText ? 'views' : 'screens',
        text:
          'Add a ' +
          VIEW_LABEL[type].toLowerCase() +
          ' page called "' +
          name +
          '" for ' +
          roles.map((r) => roleName(def, r)).join(', ') +
          (isNew ? ', and add ' + VIEW_LABEL[type].toLowerCase() + ' to the views of ' + t.label.toLowerCase() : ''),
        run() {
          const plan = (def.views[t.name] = def.views[t.name] || []),
            at = plan.findIndex((v) => v.type === type);
          if (type !== 'form') {
            const v = Object.assign(
              {
                type,
                why: at >= 0 ? plan[at].why : 'Added on request.',
              },
              cfg,
            );
            if (at >= 0) plan[at] = v;
            else plan.push(v);
          }
          def.screens.push(scr);
        },
      };
    }
    case 'add_widget': {
      const t = T(o.table),
        c = need(findCol(t, o.by), t.label + ' has no field called "' + o.by + '".'),
        dash = need(def.dash, 'This app has no dashboard.');
      need(isCat(c) || isDate(c), 'A chart needs a category or a date. ' + c.label + ' is ' + TYPE_LABEL[c.type].toLowerCase() + '.');
      if (dash.widgets.length >= 10) throw new Error('The dashboard is full at 10 widgets.');
      const w: DashWidget = {
        kind: isDate(c) ? 'line' : 'bar',
        label: t.label + ' by ' + String(c.label).toLowerCase(),
        table: t.name,
        x: c.name,
        split: null,
        measure: 'count',
        bucket: 'day',
        where: {},
      };
      return {
        station: 'views',
        text: 'Add "' + w.label + '" to the dashboard as ' + (w.kind === 'line' ? 'a line over time' : 'bars'),
        run() {
          dash.widgets.splice(
            Math.max(
              0,
              dash.widgets.findIndex((x) => x.kind === 'recent'),
            ),
            0,
            w,
          );
        },
      };
    }
    case 'remove_view': {
      const k = snake(o.name),
        s = need(
          def.screens.find((x) => snake(x.name) === k) || def.screens.find((x) => snake(x.name).indexOf(k) >= 0),
          'There is no screen called "' + o.name + '".',
        );
      return {
        station: 'screens',
        text: 'Remove the "' + s.name + '" screen',
        run() {
          def.screens = def.screens.filter((x) => x !== s);
        },
      };
    }
    case 'rename_app': {
      const name = need(str(o.name).slice(0, 40), 'The app needs a name.');
      return {
        station: 'screens',
        text: 'Rename the app to "' + name + '"',
        run() {
          app.name = name;
          app.renamed = true;
          def.brief.name = name;
        },
      };
    }
    case 'set_theme': {
      const acc = ACCENTS.includes(o.accent) ? o.accent : null,
        nav = ['top', 'side', 'rail'].includes(o.nav) ? o.nav : null,
        dens = ['compact', 'comfortable'].includes(o.density) ? o.density : null;
      need(
        acc || nav || dens,
        'I can change the accent colour, move the navigation to the top, the side or an icon rail, or make the rows compact.',
      );
      return {
        station: 'screens',
        text: [
          acc && 'Use the ' + label(acc).toLowerCase() + ' accent',
          nav && (nav === 'rail' ? 'Use an icon rail for navigation' : 'Move navigation to the ' + nav),
          dens && 'Use ' + dens + ' rows',
        ]
          .filter(Boolean)
          .join(', '),
        run() {
          if (acc) {
            def.theme.accent = acc;
            app.accent = acc;
          }
          if (nav) def.theme.nav = nav;
          if (dens) def.theme.density = dens;
        },
      };
    }
    case 'set_access': {
      const t = T(o.table),
        r = need(
          findRole(def, o.role),
          'I could not find a role called "' + o.role + '". The roles are ' + def.brief.roles.map((x) => x.name).join(', ') + '.',
        ),
        act = need(
          ACT_WORDS[o.action] || (['list', 'create', 'update', 'delete'].includes(o.action) ? o.action : null),
          'Access can be about seeing, creating, editing or deleting.',
        );
      const A = def.access[t.name][r.id],
        scoped = act === 'list' || act === 'update',
        v = scoped
          ? o.value === true || o.value === 'all'
            ? 'all'
            : o.value === 'own'
              ? 'own'
              : 'none'
          : o.value === true || o.value === 'all' || o.value === 'own';
      if (A[act] === v)
        throw new Error(
          r.name + ' ' + (v && v !== 'none' ? 'can already ' : 'already cannot ') + ACT_VERB[act] + ' ' + t.label.toLowerCase() + '.',
        );
      const allow = v && v !== 'none',
        dropped = allow
          ? def.tour.filter((st) => st.do === 'denied' && st.role === r.id && st.table === t.name && (st.action || 'create') === act)
          : [];
      return {
        station: 'backend',
        text:
          (allow
            ? 'Let ' + r.name + ' ' + ACT_VERB[act] + ' ' + (v === 'own' ? 'their own ' : '')
            : 'Stop ' +
              r.name +
              ' from ' +
              {
                list: 'seeing',
                create: 'creating',
                update: 'editing',
                delete: 'deleting',
              }[act] +
              ' ') +
          t.label.toLowerCase() +
          (dropped.length ? ', and drop the tour step that expected a refusal' : ''),
        run() {
          Object.assign(A, { [act]: v });
          if (dropped.length) def.tour = def.tour.filter((st) => !dropped.includes(st));
          if (allow)
            def.cases = (def.cases || [])
              .map((k) =>
                Object.assign({}, k, {
                  steps: k.steps.filter(
                    (st) => !(st.do === 'denied' && st.role === r.id && st.table === t.name && (st.action || 'create') === act),
                  ),
                }),
              )
              .filter((k) => k.steps.length); /* a test case that expected this refusal no longer applies */
          if (act === 'list' && !allow)
            def.screens.forEach((s) => {
              if (s.table === t.name && s.type !== 'dashboard' && s.type !== 'form') s.roles = s.roles.filter((x) => x !== r.id);
            });
          if (act === 'create' && !allow)
            def.screens.forEach((s) => {
              if (s.table === t.name && s.type === 'form') s.roles = s.roles.filter((x) => x !== r.id);
            });
          if (
            act === 'list' &&
            allow &&
            !def.screens.some((s) => s.table === t.name && s.type !== 'form' && s.type !== 'dashboard' && s.roles.includes(r.id))
          ) {
            const s = def.screens.find((x) => x.table === t.name && x.type === 'table');
            if (s) s.roles.push(r.id);
            else
              def.screens.push({
                id: 's' + (def.screens.length + 101),
                name: t.label,
                type: 'table',
                table: t.name,
                roles: [r.id],
                columns: t.columns.slice(0, 5).map((c) => c.name),
                icon: 'table',
              });
          }
          def.screens = def.screens.filter((s) => s.roles.length);
        },
      };
    }
    case 'add_table': {
      const nt = need(
        normSchema(
          {
            tables: [o.table],
            users: [],
          },
          def.brief,
        ).tables[0],
        'The new table needs a name and columns.',
      );
      if (tableOf(def, nt.name)) throw new Error('There is already a table called ' + nt.label + '.');
      if (def.tables.length >= LIMITS.tables) throw new Error('The app is at the limit of ' + LIMITS.tables + ' tables.');
      nt.columns.forEach((c) => {
        if (c.type === 'ref' && !tableOf(def, c.ref) && c.ref !== nt.name)
          throw new Error(nt.label + '.' + c.label + ' points to ' + c.ref + ', which does not exist.');
        if (c.type === 'select' && !(c.options || []).length) throw new Error(nt.label + '.' + c.label + ' is a choice with no options.');
      });
      need(nt.title, 'The new table needs at least one column.');
      const sql = createTableSQL(nt),
        rows = nt.rows;
      return {
        station: 'database',
        text: 'Add a ' + nt.label + ' table with ' + nt.columns.length + ' fields' + (rows.length ? ' and ' + rows.length + ' rows' : ''),
        sql,
        run(ctx) {
          sqlRun(app.id, sql, null, 'database');
          const problems: string[] = [],
            ro: Dict<Row[]> = {};
          ro[nt.name] = rows;
          insertSeed(app.id, [nt], ro, problems, 'database', def.users);
          if (problems.length) throw new Error(problems.slice(0, 3).join('; '));
          def.tables.push({
            name: nt.name,
            label: nt.label,
            one: nt.one,
            title: nt.title,
            owner: nt.owner,
            by: 'database',
            run: ctx.runN,
            columns: nt.columns.map((c) =>
              Object.assign(
                {
                  by: 'database',
                  run: ctx.runN,
                },
                c,
              ),
            ),
          });
          def.access[nt.name] = {};
          roleIds.forEach((r) => {
            def.access[nt.name][r] = {
              list: 'all',
              create: true,
              update: 'all',
              delete: false,
            };
          });
          if (app.seed) app.seed.rows[nt.name] = rows;
          def.migrations.push(mig(def, sql, 'Added table ' + nt.name));
          def.screens.push({
            id: 's' + (def.screens.length + 201),
            name: nt.label,
            type: 'table',
            table: nt.name,
            roles: roleIds.slice(),
            columns: nt.columns
              .filter((c) => c.type !== 'longtext')
              .slice(0, 5)
              .map((c) => c.name),
            icon: 'table',
          });
        },
      };
    }
    default:
      throw new Error('I do not know how to do "' + o.op + '".');
  }
}
export function planOps(app: BackedApp, ops: Untrusted) {
  const steps: PlannedStep[] = [],
    errors: string[] = [];
  arr(ops)
    .slice(0, 6)
    .forEach((o) => {
      try {
        steps.push(planOne(app, o || {}));
      } catch (e) {
        errors.push(errText(e));
      }
    });
  return {
    steps,
    errors,
  };
}
/** What re-checking one station found. */
export interface Recheck {
  checks: Check[];
  facts: string[];
  issues?: string[];
}
type ChangeCtx = ToolContext & { runN: number; before?: Dict<number> };
export const RECHECK: Dict<(app: BackedApp, ctx: ChangeCtx, steps: PlannedStep[]) => Recheck> = {
  database(app, ctx, steps) {
    const migs = steps.filter((s) => s.sql),
      checks = migs.map((s) => chk('Migration ran', true, String(s.sql).replace(/\s+/g, ' ').slice(0, 110)));
    if (!checks.length) checks.push(chk('No table changes needed', true, ''));
    checks.push(
      checkLinks(
        app,
        Object.assign({}, ctx, {
          agent: 'database',
        }),
      ),
    );
    const before = ctx.before || {},
      lost = Object.keys(before).filter((n) => tableOf(app.def, n) && dbCount(app.id, n) !== before[n]);
    checks.push(
      chk(
        'No rows were lost',
        !lost.length,
        lost.length
          ? 'row count changed in ' + lost.join(', ')
          : app.def.tables.reduce((n, t) => n + Number(dbCount(app.id, t.name)), 0) + ' rows still in place',
      ),
    );
    return {
      checks,
      facts: [migs.length + ' migration' + (migs.length === 1 ? '' : 's'), app.def.tables.length + ' tables'],
    };
  },
  backend(app, ctx) {
    const checks = checkBackendShape(app.def, {
      process: app.def.process,
      access: app.def.access,
    }).concat(
      checkBackendLive(
        app,
        Object.assign({}, ctx, {
          agent: 'backend',
        }),
      ),
    );
    if (app.def.team) checks.push(checkTeam(app.def, app.def.team));
    return {
      checks,
      facts: [deriveEndpoints(app.def).length + ' endpoints', (app.matrix ? app.matrix.calls : 0) + ' permission tests'],
    };
  },
  views(app) {
    const vw = refreshViews(app),
      checks = checkViews(app.def, vw);
    checks.push(renderViewsTest(app));
    return {
      checks,
      facts: [
        Object.keys(vw.views).reduce((k, t) => k + vw.views[t].length, 0) + ' views for ' + app.def.tables.length + ' tables',
        vw.dash.widgets.length + ' dashboard widgets',
      ],
    };
  },
  screens(app) {
    const checks = checkScreensShape(app.def, {
      screens: app.def.screens,
    });
    checks.push(renderTest(app));
    return {
      checks,
      facts: [app.def.screens.length + ' screens', label(app.def.theme.accent) + ', ' + app.def.theme.nav + ' navigation'],
    };
  },
  walkthrough(app, ctx) {
    const r = runAcceptance(
      app,
      Object.assign({}, ctx, {
        agent: 'ui',
      }),
    );
    app.line.walkthrough.results = r.results;
    return {
      checks: r.checks,
      facts: [r.results.filter((x) => x.ok).length + ' of ' + r.results.length + ' steps passed'],
    };
  },
};
export function applyChangeSync(app: BackedApp, steps: PlannedStep[], ctx: ChangeCtx) {
  // apply everything inside one savepoint, re-check every station from the first one touched, roll back if any check fails
  const backup = JSON.stringify({
    def: app.def,
    name: app.name,
    icon: app.icon,
    accent: app.accent,
    seed: app.seed,
    renamed: app.renamed,
    results: app.line.walkthrough.results,
    touched: app.touched || {},
  });
  const first = Math.min.apply(
      null,
      steps.map((s) => stationIdx(s.station)),
    ),
    per: Dict<Recheck & { issues: string[] }> = {};
  let failed: string | null = null;
  const before: Dict<number> = (ctx.before = {});
  app.def.tables.forEach((t) => {
    before[t.name] = Number(dbCount(app.id, t.name));
  });
  dbSavepoint(app.id, 'chg');
  try {
    steps.forEach((s) => {
      const snap = snapshotDef(app.def);
      s.run(ctx);
      recordTouches(app, snap, STATIONS[stationIdx(s.station)]?.agent || 'orchestrator', 'change', ctx.runN, s.text);
    });
    app.rev++;
    for (let i = first; i < STATIONS.length; i++) {
      const id = STATIONS[i].id,
        r = RECHECK[id](
          app,
          ctx,
          steps.filter((s) => s.station === id),
        );
      const issues = issuesOf(r.checks);
      per[id] = Object.assign(r, { issues });
      if (issues.length) {
        failed = id;
        break;
      }
    }
  } catch (e) {
    console.error(e);
    failed = failed || STATIONS[first].id;
    per[failed] = {
      checks: [chk('The change could be applied', false, errText(e))],
      issues: [errText(e)],
      facts: [],
    };
  }
  if (failed) {
    dbRollback(app.id, 'chg');
    const b = JSON.parse(backup);
    app.def = b.def;
    app.name = b.name;
    app.icon = b.icon;
    app.accent = b.accent;
    app.seed = b.seed;
    app.renamed = b.renamed;
    app.line.walkthrough.results = b.results;
    app.touched = b.touched;
    app.rev++;
  } else dbRelease(app.id, 'chg');
  return {
    first,
    per,
    failed,
  };
}
export async function runChange(app: BackedApp, steps: PlannedStep[], title: string) {
  const run = newRun(app, 'change', title, liveModelOn() ? 'live' : 'demo'),
    ctl = (RUNS[app.id] = {
      stop: false,
      runId: run.id,
    }),
    ctx: ChangeCtx = {
      agent: 'orchestrator',
      runId: run.id,
      appId: app.id,
      runN: run.n,
    };
  emit('RUN_STARTED', {
    runId: run.id,
    threadId: app.id,
    app: app.id,
  });
  const res = applyChangeSync(app, steps, ctx),
    first = res.first,
    keep: Dict<Partial<StationLine>> = {};
  STATIONS.forEach((st, i) => {
    const L = app.line[st.id];
    keep[st.id] = {
      checks: L.checks,
      facts: L.facts,
      attempts: L.attempts,
    };
    if (i < first) L.note = 'No change';
    else {
      L.status = 'idle';
      L.note = null;
    }
  });
  U.runSel[app.id] = null;
  U.follow[app.id] = true;
  commit();
  try {
    for (let i = first; i < STATIONS.length; i++) {
      const st = STATIONS[i],
        L = app.line[st.id],
        r = res.per[st.id];
      if (!r) break;
      U.sel[app.id] = st.id;
      L.status = 'working';
      L.attempt = 1;
      commit();
      const s1 = stepStart(run, st.id, st.agent, i === first ? 'Apply change' : 'Re-run', 'tool');
      await pace(app, 650);
      stepEnd(s1, true);
      L.status = 'checking';
      commit();
      const s2 = stepStart(run, st.id, 'orchestrator', 'Checks', 'check');
      await pace(app, 450);
      const ok = !r.issues.length;
      stepEnd(s2, ok);
      L.checks = r.checks;
      L.facts = r.facts;
      L.attempts = [
        {
          n: 1,
          ok,
          issues: r.issues.slice(0, 6),
        },
      ];
      L.status = ok ? 'ok' : 'failed';
      L.t1 = Date.now();
      emit('STATE_DELTA', {
        app: app.id,
        delta: [
          {
            op: 'replace',
            path: '/' + st.out,
            value: r.facts.join(', '),
          },
        ],
      });
      commit();
      if (!ok) {
        await pace(app, 900);
        break;
      }
      if (i < STATIONS.length - 1) {
        U.handoff[app.id] = i;
        notify();
        await pace(app, 380);
        U.handoff[app.id] = null;
      }
    }
  } catch (e) {
    if (!(e instanceof Stopped)) console.error(e);
  }
  if (res.failed) {
    const bad = res.per[res.failed];
    STATIONS.forEach((st, i) => {
      const L = app.line[st.id];
      L.status = 'ok';
      if (i >= first) {
        L.note = 'Change not applied';
        if (st.id !== res.failed) Object.assign(L, keep[st.id]);
      }
    });
    run.status = 'failed';
    say(
      app,
      'orchestrator',
      'Not applied. ' +
        STATIONS[stationIdx(res.failed)].name +
        ' failed a check, so I rolled everything back. The app is exactly as it was.',
      {
        type: 'error',
        issues: bad.issues.slice(0, 3),
      },
    );
  } else {
    STATIONS.forEach((st) => {
      app.line[st.id].status = 'ok';
    });
    steps.forEach((s) => logChange(app, s.text, s.station));
    const ts = runTestsSync(app, undefined);
    run.status = 'ok';
    say(
      app,
      'orchestrator',
      'Done. Only the stations this change touches ran again' +
        (ts
          ? ', and I regenerated the tests: ' + (ts.failed ? ts.failed + ' of ' + ts.total + ' fail.' : 'all ' + ts.total + ' pass.')
          : '.'),
      {
        type: 'changed',
        items: steps.map((s) => s.text),
        reran: STATIONS.slice(first).map((s) => s.name),
        skipped: STATIONS.slice(0, first).map((s) => s.name),
      },
    );
    toast('Change applied to ' + app.name, 'success');
  }
  run.t1 = Date.now();
  if (RUNS[app.id] === ctl) delete RUNS[app.id];
  U.handoff[app.id] = null;
  app.updated = Date.now();
  emit('RUN_FINISHED', {
    runId: run.id,
    threadId: app.id,
    app: app.id,
    status: run.status,
  });
  commit();
}
export function askApproval(app: BackedApp, steps: PlannedStep[]): Promise<boolean> {
  // human in the loop: nothing that loses data runs without a yes
  const m = say(app, 'database', 'This change deletes data, so I need your approval first.', {
    type: 'approval',
    items: steps.filter((s) => s.destructive).map((s) => s.text + ': ' + s.loss),
    decided: null,
  });
  emit('CUSTOM', {
    name: 'interrupt',
    app: app.id,
    value: {
      reason: 'approval',
    },
  });
  setChat(true);
  return new Promise((resolve) => {
    PENDING[app.id] = (ok) => {
      delete PENDING[app.id];
      if (m.card) m.card.decided = ok ? 'approved' : 'declined';
      pushChat(app, 'user', ok ? 'Approved' : 'Keep the data');
      emit('CUSTOM', {
        name: 'resume',
        app: app.id,
        value: {
          approved: ok,
        },
      });
      commit();
      resolve(ok);
    };
  });
}
export function changePrompt(app: BackedApp, text: string) {
  const def = app.def;
  return (
    HEAD('Orchestrator') +
    'The owner of the app "' +
    app.name +
    '" wrote: "' +
    text +
    '"\n\nTABLES:\n' +
    pTables(def) +
    '\n\nROLES: ' +
    def.brief.roles.map((r) => r.id).join(', ') +
    '\nSCREENS: ' +
    def.screens.map((s) => s.name + ' (' + s.type + ' on ' + s.table + ')').join('; ') +
    '\n\nACCESS:\n' +
    pAccess(def) +
    '\n\nTranslate the message into operations from this list. If it is a question, answer it in "reply" and return no operations.\n{"op":"add_field","table":"","name":"snake_case","label":"","type":"text|longtext|number|money|date|datetime|bool|select","options":[]}\n{"op":"remove_field","table":"","name":""}\n{"op":"rename_field","table":"","name":"","to":"new name"}\n{"op":"add_view","type":"table|board|calendar|timeline|chart|pivot|tree|cards|form","table":"","by":"the column a board groups by, a calendar or timeline dates by, or a chart, pivot or tree splits by"}\n{"op":"add_widget","table":"","by":"category or date column to chart on the dashboard"}\n{"op":"remove_view","name":"screen name"}\n{"op":"set_access","table":"","role":"","action":"list|create|update|delete","value":"all|own|none"}\n{"op":"set_theme","accent":"' +
    ACCENTS.join('|') +
    '","nav":"side|top|rail","density":"comfortable|compact"}\n{"op":"rename_app","name":""}\n{"op":"add_table","table":{"name":"","label":"","one":"","title":"","owner":null,"columns":[{"name":"","label":"","type":"","required":false}],"rows":[]}}\n\nFORMAT: {"reply":"one short sentence for the owner","ops":[]}'
  );
}
export const DEMO_HELP =
  'In Demo mode I understand a fixed set of changes: add, rename or remove a field, turn a text field into a choice, add a page in any view (table, board, calendar, timeline, chart, pivot, tree, cards), add a chart to the dashboard, change who may see, create, edit or delete a table, change the colour, navigation or density, rename the app, and reset the data. Try one of the suggestions below, or switch to Live for anything else.';
export async function handleChat(app: BackedApp, text: string, opt?: { rules?: boolean }) {
  // opt.rules: read this message with the built-in rules whatever the mode (a reviewer's fix that was tried out that way)
  text = str(text);
  if (!text) return;
  const r = RUNS[app.id];
  const q = app.def.brief.question;
  if (r && r.answer && q) {
    const i = /^\d$/.test(text) ? +text - 1 : q.options.findIndex((o) => o.toLowerCase().indexOf(text.toLowerCase()) >= 0);
    if (i >= 0 && i < q.options.length) return answerQuestion(app, i);
    pushChat(app, 'user', text);
    say(app, 'researcher', 'Pick one of the options on the card so I can continue.');
    return;
  }
  if (r && r.gate) {
    // the line is waiting at an approval the owner asked for
    if (/^(approve|approved|ok|okay|yes|continue|go on|go ahead|carry on|looks good|fine)\b/i.test(text)) return answerGate(app, true);
    if (/^(stop|no|cancel|halt)\b/i.test(text)) return answerGate(app, false);
    pushChat(app, 'user', text);
    say(
      app,
      'orchestrator',
      'Approve to continue, or stop here: the card above has both. To change what an agent made, stop, give that agent an instruction under Customize, and run again from its station.',
    );
    return;
  }
  pushChat(app, 'user', text);
  commit();
  if (PENDING[app.id]) return void say(app, 'orchestrator', 'Answer the approval card first.');
  const wf = opt && opt.rules ? null : parseFlow(text, app);
  if (wf) return void flowChat(app, wf); // the workflow is shared state: it can be changed at any time, also while a build runs
  if (r) return void say(app, 'orchestrator', 'A run is in progress. I will take changes when it finishes.');
  if (TEAMS[app.id] && TEAMS[app.id].status === 'running')
    return void say(app, 'orchestrator', "The app's own agents are in the middle of a run. I will take changes when they have finished.");
  if (app.status !== 'ready') return void say(app, 'orchestrator', 'The app is not built yet. Use Run again above the line.');
  let plan: ParsedChange & { mode?: string };
  const mode =
    opt && opt.rules
      ? {
          live: false,
          id: 'demo',
        }
      : modeNow();
  if (!mode.live) {
    // Demo was chosen, the connection is gone, or no model is connected: the built-in reader stands in, and says why once
    const told = U.told || (U.told = {}),
      key = app.id + ':' + mode.id;
    if (mode.id !== 'demo' && !told[key]) {
      told[key] = 1;
      say(
        app,
        'orchestrator',
        mode.id === 'offline'
          ? 'You are offline, so Live is paused. Until the connection is back I am reading changes with the built-in rules.'
          : mode.id === 'checking'
            ? 'Still connecting to the model, so I am reading this one with the built-in rules.'
            : NO_MODEL + ' I am reading changes with the built-in rules.',
      );
    }
    plan = parseChange(app, text);
    plan.mode = mode.id;
  } else {
    const tmp = {
      id: 'chat',
      calls: 0,
      tokIn: 0,
      tokOut: 0,
    };
    RUNS[app.id] = {
      stop: false,
      runId: 'chat',
    };
    U.busy = app.id;
    notify();
    try {
      plan = (await callModel(app, tmp, 'orchestrator', changePrompt(app, text), 1)) as ParsedChange;
    } catch (e) {
      plan = {
        reply: e instanceof Stopped ? 'Stopped.' : 'I could not read that: ' + errText(e),
      };
    }
    delete RUNS[app.id];
    U.busy = null;
  }
  if (plan.special === 'reseed') {
    const x = resetAppData(app);
    return void say(
      app,
      'database',
      'I emptied every table and put the ' + x.rows + ' seed rows back. Users and the schema are unchanged.',
    );
  }
  const help =
    !plan.mode || plan.mode === 'demo'
      ? DEMO_HELP
      : DEMO_HELP.replace('In Demo mode I understand', 'Without the model I understand').replace(
          'or switch to Live for anything else',
          plan.mode === 'offline' ? 'or ask again when you are back online' : 'or ask again once a model is connected',
        );
  if (!plan.ops || !plan.ops.length) return void say(app, 'orchestrator', str(plan.reply) || help + ' ' + FLOW_HELP);
  const p = planOps(app, plan.ops);
  if (!p.steps.length) return void say(app, 'orchestrator', p.errors[0] || help + ' ' + FLOW_HELP);
  const first = Math.min.apply(
    null,
    p.steps.map((s) => stationIdx(s.station)),
  );
  say(
    app,
    'orchestrator',
    (str(plan.reply) ? str(plan.reply) + ' ' : '') + 'Here is the plan.' + (p.errors.length ? ' I left out one part: ' + p.errors[0] : ''),
    {
      type: 'plan',
      steps: p.steps.map((s) => ({
        text: s.text,
        sql: s.sql || '',
      })),
      rerun: STATIONS.slice(first).map((s) => s.name),
      skip: STATIONS.slice(0, first).map((s) => s.name),
    },
  );
  if (p.steps.some((s) => s.destructive) && !(await askApproval(app, p.steps)))
    return void say(app, 'orchestrator', 'Nothing was changed.');
  await runChange(app, p.steps, text.length > 46 ? text.slice(0, 44) + '…' : text);
}

/* ---------- the build pack: one document generated from the canvas state ---------- */
export function buildPack(app: BackedApp) {
  const def = app.def,
    b = def.brief,
    L: string[] = [],
    eps = deriveEndpoints(def),
    run = app.runs[app.runs.length - 1];
  L.push(
    '# ' + app.name + ' · build pack',
    '',
    '_Generated by ' +
      BRAND.name +
      ' on ' +
      isoDate(new Date()) +
      ' from the canvas state. Mode: ' +
      (app.mode === 'live' ? 'live build' : 'saved build') +
      '._',
    '',
    '## Request',
    '',
    '> ' + app.request,
    '',
    '## Brief',
    '',
    b.summary,
    '',
  );
  L.push('**Roles**', '');
  b.roles.forEach((r) => L.push('- **' + r.name + '**: ' + r.can));
  L.push('', '**User stories**', '');
  b.stories.forEach((s) =>
    L.push('- As a ' + roleName(def, s.role).toLowerCase() + ', I want to ' + s.want + (s.so ? ', so that ' + s.so : '') + '.'),
  );
  L.push('', '**Rules**', '');
  b.rules.forEach((r) => L.push('- ' + r));
  if (b.decision) L.push('', '**Decision by the owner**: ' + b.decision.text + ' → ' + b.decision.answer);
  L.push('', '## Tables (SQLite)', '');
  dbTables(app.id).forEach((t) => L.push('```sql', t.sql + ';', '```', ''));
  if (def.migrations.length) {
    L.push('**Migrations since the first build**', '');
    def.migrations.forEach((m) => L.push('- `' + m.sql.replace(/\s+/g, ' ') + '`'));
    L.push('');
  }
  L.push('## Workflow on ' + def.process.table, '', '| Action | From | To | Roles |', '|---|---|---|---|');
  def.process.transitions.forEach((x) =>
    L.push(
      '| ' +
        x.label +
        ' | ' +
        x.from.map(label).join(', ') +
        ' | ' +
        label(x.to) +
        ' | ' +
        x.roles.map((r) => roleName(def, r)).join(', ') +
        ' |',
    ),
  );
  L.push('', '## Endpoints', '', '| Method | Path | Roles |', '|---|---|---|');
  eps.forEach((e) =>
    L.push(
      '| ' +
        e.method +
        ' | `' +
        e.path +
        '` | ' +
        (e.open
          ? 'anyone'
          : Object.keys(e.roles)
              .map((r) => roleName(def, r) + (e.roles[r] === 'own' ? ' (own)' : ''))
              .join(', ') || 'nobody') +
        ' |',
    ),
  );
  if (def.team) {
    const tr = (id: string | null) => def.process.transitions.find((x) => x.id === id)?.label;
    L.push(
      '',
      "## The app's own agents: " + def.team.title,
      '',
      def.team.about,
      '',
      'A run opens with "' +
        tr(def.team.start) +
        '" and closes with "' +
        tr(def.team.done) +
        '". The agents write through the endpoints above, as the person who started the run.',
      '',
      '| Agent | Job | Writes | Connections |',
      '|---|---|---|---|',
    );
    def.team.agents.forEach((a) =>
      L.push(
        '| ' +
          a.name +
          ' | ' +
          a.job +
          ' | ' +
          [a.writes && 'adds ' + a.writes, a.updates && 'edits ' + a.updates, a.sets.length && 'fills ' + a.sets.join(', ')]
            .filter(Boolean)
            .join('; ') +
          ' | ' +
          (a.tools.map((x) => x.connector + ' · ' + x.tool).join(', ') || 'none') +
          ' |',
      ),
    );
    if (def.team.pause)
      L.push(
        '',
        'Human in the loop: the run pauses before ' +
          def.team.agents.find((a) => a.id === def.team?.pause?.before)?.name +
          ' so a person can add a point.',
      );
  }
  L.push('', '## Views per table (recommended by the View advisor)', '', '| Table | Views | Why |', '|---|---|---|');
  def.tables.forEach((t) =>
    L.push(
      '| ' +
        t.label +
        ' | ' +
        viewsOf(def, t)
          .map((v) => VIEW_LABEL[v.type])
          .join(', ') +
        ' | ' +
        viewsOf(def, t)
          .map((v) => VIEW_LABEL[v.type] + ': ' + v.why)
          .join(' ') +
        ' |',
    ),
  );
  if (def.dash) {
    L.push(
      '',
      '## Dashboard: ' + def.dash.title,
      '',
      def.dash.date
        ? 'Date filter on `' +
            def.dash.date.table +
            '.' +
            def.dash.date.column +
            '`. Every role gets the dashboard, counted from the rows that role may see.'
        : 'Every role gets the dashboard, counted from the rows that role may see.',
      '',
    );
    def.dash.widgets.forEach((w) =>
      L.push(
        '- ' +
          {
            kpi: 'Number',
            bar: 'Bars',
            stack: 'Stacked bars',
            line: 'Line over time',
            recent: 'Latest records',
          }[w.kind] +
          ': ' +
          w.label +
          ' (`' +
          w.table +
          (w.x ? ' by ' + w.x : '') +
          (w.split ? ', split by ' + w.split : '') +
          (w.measure && w.measure !== 'count' ? ', ' + w.measure : '') +
          '`)',
      ),
    );
  }
  L.push('', '## Screens', '', '| Screen | Default view | Table | Roles |', '|---|---|---|---|');
  def.screens.forEach((s) =>
    L.push('| ' + s.name + ' | ' + VIEW_LABEL[s.type] + ' | ' + s.table + ' | ' + s.roles.map((r) => roleName(def, r)).join(', ') + ' |'),
  );
  L.push(
    '',
    'Layout: ' +
      label(def.theme.accent) +
      ' accent, ' +
      (def.theme.nav === 'rail' ? 'icon rail' : def.theme.nav + ' navigation') +
      (def.theme.density === 'compact' ? ', compact rows' : '') +
      '.',
    '',
    '## Acceptance test (the guided tour)',
    '',
  );
  def.tour.forEach((s, i) => {
    const r = app.line.walkthrough.results[i] || {};
    L.push(i + 1 + '. ' + (r.ok ? 'PASS' : 'FAIL') + ' · ' + s.say + (r.detail ? ' _(' + r.detail + ')_' : ''));
  });
  L.push('', '## Seeded users', '', 'Password for every seeded user: `demo`', '');
  appUsers(app).forEach((u) => L.push('- ' + u.name + ' · `' + u.username + '` · ' + roleName(def, u.role)));
  const fl = flowOf(app),
    fx = flowList(fl);
  L.push(
    '',
    '## Build workflow',
    '',
    fx.length
      ? 'Different from the standard workflow:'
      : 'Standard: six stations, a check gate after each, three attempts per station, no extra steps.',
    '',
  );
  fx.forEach((x) => L.push('- ' + x.text));
  NOTE_FOR.forEach((a) => {
    if (fl.notes[a]) L.push('- Instruction for ' + agentThe(a, true) + ': “' + fl.notes[a] + '”');
  });
  Object.keys(app.reviews || {}).forEach((id) => {
    const R = app.reviews[id],
      who = (REVIEWERS as Dict<{ name: string }>)[id];
    if (!R || R.status !== 'ok' || !who) return;
    L.push('', '**' + who.name + '** (' + (R.by === 'model' ? 'one model call' : 'built-in rules') + ')', '');
    if (!R.findings.length) L.push('- Nothing to change.');
    R.findings.forEach((f) =>
      L.push(
        '- ' +
          ((LEVELS as Dict<{ text: string }>)[String(f.level)] || LEVELS.low).text +
          ': ' +
          f.text +
          (f.fix
            ? ' Fix: `' +
              f.fix +
              '`' +
              (f.state === 'applied'
                ? ' (applied)'
                : f.state === 'dismissed'
                  ? ' (dismissed)'
                  : f.test === 'pass'
                    ? ' (tried out, passes every check)'
                    : '')
            : ''),
      ),
    );
  });
  if (run)
    L.push(
      '',
      '## Last run',
      '',
      '- ' + cap(run.kind) + ' "' + run.label + '", ' + run.status + ', ' + fmtMs((run.t1 || Date.now()) - run.t0),
      '- Model calls: ' + run.calls + (run.replayed ? ' (' + run.replayed + ' replayed from the saved build)' : ''),
      '- Send-backs: ' + run.retries,
    );
  return L.join('\n');
}
