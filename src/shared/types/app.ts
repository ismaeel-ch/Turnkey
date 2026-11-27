/**
 * The definition of a built app (`app.def`): what each station of the build line writes. Station 1 (Researcher)
 * writes the brief, 2 (Database) the tables and seed users, 3 (Backend) the workflow, access rules and team, 4 (View
 * advisor and UI) the views, dashboard, screens and theme, 5 (Tester) the tour that is played as an acceptance test.
 *
 * Tables and columns use the shared SQL types (`src/shared/sql/types.ts`), which the server validates against too.
 */
import type { ColumnDef, ColumnType, TableDef } from '@/shared/sql/types';
import type { Dict, Loose } from './workspace';

export type { ColumnDef, ColumnType, TableDef };

/**
 * Model output, a saved build or a share link before a normaliser has checked it. Normalisers read it field by field
 * and coerce every value they keep, so nothing typed as `Untrusted` reaches the rest of the app.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above: this is the one place unchecked JSON enters
export type Untrusted = any;

/* ---------- station 1: the brief ---------- */
export interface Role {
  /** snake_case id */
  id: string;
  name: string;
  /** what the role does, in a sentence */
  can: string;
}
export interface Entity {
  name: string;
  what: string;
}
export interface Story {
  role: string;
  want: string;
  so: string;
}
export interface BriefQuestion {
  text: string;
  options: string[];
  recommended: number;
}
export interface Brief {
  name: string;
  summary: string;
  roles: Role[];
  entities: Entity[];
  /** the one record that moves through states */
  process: { entity: string; states: string[]; note: string };
  stories: Story[];
  rules: string[];
  question: BriefQuestion | null;
  /** the owner's answer to the brief's question */
  decision: { text: string; answer: string } | null;
  sources: BriefSource[];
}
/** A connector lookup the Researcher made for the brief, with the titles it found. */
export interface BriefSource {
  connector: string;
  tool?: string;
  query: string;
  note?: string;
  titles: string[];
}

/* ---------- station 2: tables and seed users ---------- */
/** A table of a built app: the Database agent always gives it a label and a name for one record. */
export type AppTable = Omit<TableDef, 'columns'> & {
  columns: AppColumn[];
  label: string;
  one: string;
  /** the agent that added it, and the change run that did */
  by?: string;
  run?: number;
};
/** A column of a built app; a change run that added it says so. */
export type AppColumn = ColumnDef & {
  by?: string;
  run?: number;
};
/** A seeded sign-in of the built app. Passwords are the demo password; the app lives in the visitor's browser. */
export interface SeedUser {
  name: string;
  role: string;
  username: string;
  password: string;
}
/** A row of the built app's database, as SQLite returns it. */
export type Row = Dict<Loose>;
/** A row of an app table read back through the API: it always has its id. */
export type StoredRow = Row & { id: number };
/** A signed-in person of the built app, as the `users` table returns them. */
export interface AppUser {
  id: number;
  name: string;
  username: string;
  role: string;
  /** a made-up person who came with the demo data; the sign-in screen says so */
  example?: boolean;
}

/* ---------- station 3: workflow, access, team ---------- */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export interface ProcessState {
  id: string;
  label: string;
  tone: Tone;
}
export interface Transition {
  id: string;
  label: string;
  from: string[];
  to: string;
  roles: string[];
  /** columns the transition also sets; `:me`, `:today` and `:now` are filled in when it runs */
  set: Dict<Loose>;
}
export interface Process {
  table: string;
  column: string;
  states: ProcessState[];
  initial: string;
  transitions: Transition[];
}
/** Which records a role may see or change: all of them, the ones it owns, or none. */
export type Scope = 'all' | 'own' | 'none';
export interface Permission {
  list: Scope;
  create: boolean;
  update: Scope;
  delete: boolean;
}
/** Permissions by table name, then by role id. */
export type AccessMap = Dict<Dict<Permission>>;
/** An app's own agent team (src/workspace/team.tsx). */
export interface TeamAgent {
  id: string;
  name: string;
  icon: string;
  acc: string;
  job: string;
  hint: string;
  /** the table it adds rows to, and the one it edits */
  writes: string | null;
  updates: string | null;
  /** columns of the input table it fills */
  sets: string[];
  fixed: Dict<Loose>;
  tools: { connector: string; tool: string }[];
}
export interface AppTeam {
  title: string;
  about: string;
  input: { table: string; column: string };
  agents: TeamAgent[];
  /** the workflow actions that open and close a run */
  start: string | null;
  done: string | null;
  /** human in the loop: the run waits before this agent */
  pause: { before: string; text: string } | null;
  /** a person may add a row of their own to a run: where it goes, what is filled in, and the button's words */
  jump: { table: string; column: string; set: Dict<Loose>; label: string } | null;
  /** sample inputs offered in the room */
  samples: { label: string; values: Dict<Loose> }[];
}

/* ---------- the agent room (src/workspace/room.tsx) ---------- */
/** How a board panel draws the rows of one table. */
export type BoardLayout = 'versus' | 'list' | 'groups' | 'scores' | 'options';
/** One panel of the agent room: a table the team writes, drawn in one layout. Every field names a column of `table`. */
export interface BoardPanel {
  table: string;
  layout: BoardLayout;
  title: string;
  /** the choice column that splits the rows (versus, groups) */
  by: string | null;
  badge: string | null;
  text: string | null;
  tag: string | null;
  meter: string | null;
  rank: string | null;
  score: string | null;
  weight: string | null;
  /** the top of the score scale; 0 picks one from the rows */
  max: number;
  link: string | null;
  flag: string | null;
  /** rows with this reference empty are the ones not drawn under a parent */
  loose: string | null;
  /** a reference to the same table: which row this one answers */
  reply: string | null;
  facts: string[];
  sides: string[];
  only: string[];
  /** rows of a child table drawn under each row, joined on `via` */
  children: (BoardPanel & { via: string }) | null;
}
/** The agent room: its panels and which columns of the input table hold the outcome. */
export interface Board {
  /** `views` when the View advisor laid it out, `rules` when code did */
  by: string;
  why: string;
  verdict: { pick: string | null; meter: string | null; text: string | null; date: string | null };
  panels: BoardPanel[];
}

/* ---------- station 4: views and the dashboard ---------- */
/** A view the View advisor recommends for a table, with the columns it needs (`by`, `date`, `x` and so on). */
export interface ViewSpec {
  type: string;
  why: string;
  [setting: string]: Loose;
}
export type DashWidgetKind = 'kpi' | 'bar' | 'stack' | 'line' | 'recent';
export interface DashWidget {
  kind: DashWidgetKind;
  label: string;
  table: string;
  x: string | null;
  split: string | null;
  /** `count`, or `sum:column` / `avg:column` */
  measure: string;
  bucket: string;
  where: Dict<Loose>;
}
export interface Dash {
  title: string;
  /** the date column the dashboard's date filter works on */
  date: { table: string; column: string } | null;
  widgets: DashWidget[];
}
/** A custom action that calls a connector from a record. */
export interface AppAction {
  id: string;
  label: string;
  table: string;
  connector: string;
  tool: string;
  arg: string;
}

/* ---------- station 4 and 5: screens and the tour ---------- */
export interface Screen {
  id: string;
  name: string;
  type: string;
  table: string;
  roles: string[];
  /** the columns a table screen shows */
  columns: string[];
  icon?: string;
  /** board: the choice column that makes the columns */
  group?: string;
  /** calendar and timeline: the date column, and the end date */
  date?: string;
  end?: string;
  /** the column shown as the card or row label */
  label?: string;
  range?: string;
  /** added by code, not by the UI agent */
  auto?: boolean;
  /** older dashboard screens kept their own widgets; read as saved */
  widgets?: Dict<Untrusted>[];
  [field: string]: Loose;
}
export interface TourStep {
  role: string;
  user?: string | null;
  do: string;
  screen?: string;
  table?: string;
  values?: Dict<Loose>;
  /** for `denied`: the action that must be refused */
  action?: string;
  transition?: string;
  say?: string;
  [field: string]: Loose;
}
/** A saved test: tour steps played against the app's API. */
/** A test case the Tester wrote from the brief, in the tour's step vocabulary. */
export interface TestCase {
  id: string;
  name: string;
  /** the rule or user story it protects */
  why: string;
  steps: TourStep[];
}
/** The app's own icon as data (src/workspace/release.tsx draws it). */
export interface Logo {
  glyph: string | null;
  shape: string;
  fill: string;
  mark: string;
  /** who chose it: ui, rules or you */
  by: string;
  /** how often the owner asked for another design */
  turn?: number;
}
export interface Theme {
  accent: string;
  nav: string;
  icon: string;
  density?: string;
  /** the app's own icon: shape, fill and mark */
  logo?: Logo | null;
}

/** One schema change made after the first build. */
/** One change to a table that every device's records must follow when it updates (src/workspace/record-steps.ts). */
export type RecordStep =
  | { op: 'rename_field'; table: string; from: string; to: string }
  | { op: 'to_choice'; table: string; column: string }
  | { op: 'add_field'; table: string; column: string }
  | { op: 'remove_field'; table: string; column: string };
export interface Migration {
  n: number;
  at: number;
  by: string;
  sql: string;
  note: string;
  /** what the records must do to follow this change on another device */
  step?: RecordStep;
}
export interface AppDef {
  brief: Brief | null;
  tables: AppTable[];
  users: SeedUser[];
  process: Process | null;
  access: AccessMap;
  team: AppTeam | null;
  views: Dict<ViewSpec[]>;
  dash: Dash | null;
  screens: Screen[];
  theme: Theme;
  tour: TourStep[];
  actions: AppAction[];
  migrations: Migration[];
  cases?: TestCase[];
  /** the room layout of an app with a team (src/workspace/room.tsx) */
  board?: Board | null;
}
/** A definition past station 1: it has a brief. */
export type BriefedDef = AppDef & { brief: Brief };
/** A definition past station 3: it has a brief and a workflow. */
export type BackedDef = BriefedDef & { process: Process };

/* ---------- checks ---------- */
/** One check a station's output must pass. Failed checks go back to the agent as feedback. */
export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}
