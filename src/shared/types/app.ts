/**
 * The definition of a built app (`app.def`): what each station of the build line writes. Station 1 (Researcher)
 * writes the brief, 2 (Database) the tables and seed users, 3 (Backend) the workflow, access rules and team, 4 (View
 * advisor and UI) the views, dashboard, screens and theme, 5 (Tester) the tour that is played as an acceptance test.
 *
 * Tables and columns use the shared SQL types (`src/shared/sql/types.ts`), which the server validates against too.
 */
import type { ColumnDef, TableDef } from '@/shared/sql/types';
import type { Dict, Loose } from './workspace';

export type { ColumnDef, TableDef };

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
  decision: Loose;
  sources: Loose[];
}

/* ---------- station 2: tables and seed users ---------- */
/** A table of a built app: the Database agent always gives it a label and a name for one record. */
export type AppTable = TableDef & { label: string; one: string };
/** A seeded sign-in of the built app. Passwords are the demo password; the app lives in the visitor's browser. */
export interface SeedUser {
  name: string;
  role: string;
  username: string;
  password: string;
}
/** A row of the built app's database, as SQLite returns it. */
export type Row = Dict<Loose>;
/** A signed-in person of the built app, as the `users` table returns them. */
export interface AppUser {
  id: number;
  name: string;
  username: string;
  role: string;
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
export interface AppTeam {
  title: string;
  input: { table: string; column: string };
  [field: string]: Loose;
}

/* ---------- station 4 and 5: screens and the tour ---------- */
export interface Screen {
  id: string;
  name: string;
  type: string;
  table: string;
  roles: string[];
  columns?: string[];
  icon?: string;
  group?: string;
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
export interface Theme {
  accent: string;
  nav: string;
  icon: string;
  density?: string;
}

export interface AppDef {
  brief: Brief | null;
  tables: AppTable[];
  users: SeedUser[];
  process: Process | null;
  access: AccessMap;
  team: AppTeam | null;
  views: Dict<Loose[]>;
  dash: Loose;
  screens: Screen[];
  theme: Theme;
  tour: TourStep[];
  actions: Loose[];
  migrations: Loose[];
  cases?: Loose[];
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
