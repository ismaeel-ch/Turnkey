/**
 * Types for the workspace's two stores in src/workspace/core.ts.
 *
 * `State` (S) is what the workspace saves to browser storage: accounts, apps, tabs and settings.
 * `ViewState` (U) is what lives only while the page is open: dialogs, toasts, selections, drafts.
 *
 * The workspace modules are typed one at a time. Fields that only untyped modules read stay loose (`Loose`) until the
 * module that owns them is typed and can say what they hold.
 */
import type { AppDef, Check, Row } from './app';

/** A value whose shape is not described yet. Narrow it where you read it. */
export type Loose = unknown;

/** A map keyed by id: app id, account id, tab id and so on. */
export type Dict<T> = Record<string, T>;

export type ThemeSetting = 'system' | 'light' | 'dark';
export type SpeedSetting = 'slow' | 'normal' | 'fast' | (string & {});

export interface Settings {
  theme: ThemeSetting;
  /** Demo mode: saved builds and no model calls. Live mode is `demo === false`. */
  demo: boolean;
  debug: boolean;
  speed: SpeedSetting;
  /** the offline test switch, standing in for a lost connection */
  offline: boolean;
  installed: boolean;
  tier: string;
  /** the docked chat is open (wide screens) */
  chat: boolean;
  tourDone: boolean;
}

export interface Account {
  id: string;
  name: string;
  username: string;
  /** hashStr of the password; this is a demo login kept in the visitor's own browser */
  pass: string;
  created: number;
}

/** A workspace tab. `app` is null for the home tab. */
export interface Tab {
  id: string;
  app: string | null;
}

/** One app the owner built. The workspace modules add their own fields; the ones every module relies on are listed. */
export interface AppRecord {
  id: string;
  /** account id */
  owner: string | null;
  name: string;
  icon: string;
  accent: string;
  request?: string;
  /** saved build id (REC key) the app came from, if any */
  tpl?: string | null;
  mode?: string;
  status: string;
  created: number;
  updated: number;
  shared?: { key: string } | null;
  def: AppDef;
  /** the state of each station of the build line, by station id */
  line: Dict<StationLine>;
  /** the owner's build workflow for this app (src/workspace/custom.tsx) */
  flow: AppFlow;
  /** reviewer agents' last reviews, by reviewer id */
  reviews: Dict<Review>;
  /** goes up by one with every change to the definition */
  rev: number;
  /** the seed rows by table, kept so "Reset data" can put them back */
  seed?: { rows: Dict<Row[]> } | null;
  /** the last permission matrix the Backend check ran */
  matrix?: { at: number; calls: number; refused: number; failed: string[] };
  /** the last ten runs of the build line, oldest first */
  runs: Run[];
  /** the conversation with the agents, newest last */
  chat: ChatMessage[];
  /** the Tester's last pass over the finished app */
  qa?: QaState | null;
  [field: string]: Loose;
}

/** A repair one agent tried after a test failed. */
export interface QaFix {
  by: string;
  text: string;
  for: string;
  ok: boolean;
  why: string;
  station: string;
}
/** One run of every test, and the repairs that followed it. */
export interface QaRound {
  n: number;
  total: number;
  failed: number;
  fails: { name: string; suite: string; actual: string }[];
  fixes: QaFix[];
}
export interface QaState {
  status: string;
  /** who wrote the cases: model, saved or rules */
  by: string;
  rounds: QaRound[];
  t0: number;
  t1: number | null;
  /** cases withdrawn because they did not match the brief */
  dropped: { id: string; why: string }[];
}

/** One step of a run, as the timeline shows it. */
export interface RunStep {
  station: string;
  agent: string;
  label: string;
  kind: string;
  t0: number;
  t1: number | null;
  ok: boolean | null;
  [field: string]: Loose;
}

/** One run of the build line: a full build, a change or a re-run. */
export interface Run {
  id: string;
  n: number;
  kind: string;
  label: string;
  mode: string;
  t0: number;
  t1: number | null;
  status: string;
  steps: RunStep[];
  calls: number;
  replayed: number;
  tokIn: number;
  tokOut: number;
  retries: number;
  [field: string]: Loose;
}

/** A card under a chat message: an approval, a list of changes, an error and so on. `type` says which. */
export interface ChatCard {
  type: string;
  [field: string]: Loose;
}

export interface ChatMessage {
  id: string;
  t: number;
  /** `user` or an agent id */
  from: string;
  text: string;
  card: ChatCard | null;
}

export interface State {
  v: 1;
  onboarded: boolean;
  accounts: Account[];
  /** the signed-in account id */
  session: string | null;
  settings: Settings;
  apps: Dict<AppRecord>;
  /** share key to app id */
  shared: Dict<string>;
  /** the owner's own build workflow, by account id */
  flows: Dict<Loose>;
  /** open tabs, by account id */
  tabs: Dict<Tab[]>;
  /** active tab id, by account id */
  active: Dict<string>;
  /** per app, user and screen preferences */
  prefs: Dict<Loose>;
  /** connector id to on/off */
  conns: Dict<boolean>;
  /** connectors the owner added */
  custom: Loose[];
}

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: string;
  text: string;
  tone: ToastTone;
}

export interface Dialog {
  type: string;
  props: Dict<Loose>;
}

/** Whether a model can be reached from this copy of the page. */
export type LiveStatus = 'unknown' | 'ready' | 'none';

/** The download helper the host page hands the workspace, when it has one. */
export interface Downloader {
  save(file: { filename: string; data: string | Blob | ArrayBuffer | Uint8Array }): Promise<unknown>;
}

export interface DebugPanel {
  tab: string;
  q: string;
  max: boolean;
  all: boolean;
}

export interface ViewState {
  boot: 'loading' | 'ready' | 'error' | (string & {});
  bootErr: string;
  toasts: Toast[];
  dialog: Dialog | null;
  tour: Loose;
  view: Dict<Loose>;
  bview: Dict<Loose>;
  sel: Dict<Loose>;
  itab: Dict<Loose>;
  runSel: Dict<Loose>;
  follow: Dict<Loose>;
  stage: Dict<Loose>;
  data: Dict<Loose>;
  api: Dict<Loose>;
  conn: Loose;
  dbg: DebugPanel;
  live: LiveStatus;
  dl: Downloader | null;
  /** model calls made this session */
  calls: number;
  savedAt: number;
  home: { text: string; note: string };
  handoff: Dict<Loose>;
  chatDraft: Dict<Loose>;
  stream: Dict<Loose>;
  showSql: Dict<Loose>;
  busy: Loose;
  connOut: Loose;
  ob: Loose;
  si: Loose;
  tv: Dict<Loose>;
  flowPos: Dict<Loose>;
  flowN: number;
  flowMap: Loose;
  solo: Loose;
  sheet: Loose;
  told: Dict<Loose>;
  noteDraft: Dict<Loose>;
  /** release form, per app */
  rel: Dict<Loose>;
  /** last Details tab, per app */
  detail: Dict<Loose>;
  /** the chat peek on narrow screens */
  peek?: boolean;
  share?: Loose;
}

/** One AG-UI event in the Debug log. */
export interface LoggedEvent {
  seq: number;
  t: number;
  type: string;
  [field: string]: Loose;
}

/** Who is making a tool call. */
export interface ToolContext {
  agent?: string;
  runId?: string;
  appId?: string;
}

export interface ToolCallRecord {
  id: string;
  t: number;
  agent?: string;
  tool: string;
  kind: string;
  args: Loose;
  result: Loose;
  ok: boolean;
  ms: number;
  app?: string;
  run?: string;
}

/** A builder agent shown on the line and in the timeline. */
export interface AgentInfo {
  name: string;
  /** icon name from src/workspace/icons.ts */
  icon: string;
  /** accent colour name */
  acc: string;
  role: string;
}

/** What a saved build's station function is given. `answer` is the owner's answer to the Researcher's question. */
export interface BuildContext {
  answer: number;
}

/** The recorded output of one station: a brief, tables, rules, views or screens. */
export type StationOutput = Dict<Loose>;
export type StationRecording = (ctx: BuildContext, attempt: number) => StationOutput;

/** A connector lookup the Researcher makes during a saved build. */
export interface SavedLookup {
  connector: string;
  tool: string;
  args: Dict<string>;
  /** what the Researcher says after the lookup */
  say: string;
  note: string;
}

/**
 * A saved build: the recorded output of every agent for one sentence. Demo mode replays it through the same checks,
 * SQLite engine and API as a live build. Quests (`quest` set) are apps that run their own agent team.
 */
export interface SavedBuild {
  id: string;
  title: string;
  icon: string;
  accent: string;
  sentence: string;
  blurb: string;
  /** words in a sentence that pick this build */
  keys: string[];
  /** token and time use per station call, `[tokens in, tokens out, ms]`; a key ending in 2 is the second attempt */
  usage: Dict<[number, number, number]>;
  /** what each agent says per station; a key ending in 2 is the second attempt */
  say: Dict<string[]>;
  lookup?: SavedLookup;
  research: StationRecording;
  database: StationRecording;
  backend: StationRecording;
  views: StationRecording;
  ui: StationRecording;
  quest?: number;
  /** the app's own agent team, by name */
  agents?: string[];
  sampleNote?: string;
  /** saved test cases (quests: sample inputs with the team's recorded run) */
  cases?: SavedCase[];
  /** the Tester's saved answer: its test cases, before they are checked */
  tester?: () => Loose;
  /** a note on a test the saved build fails on purpose */
  slip?: string;
  [field: string]: Loose;
}

/** A saved test case or sample input: the values of a new record, and for quests the team's recorded answers. */
export interface SavedCase {
  label: string;
  values: Dict<Loose>;
  script?: Loose[];
  [field: string]: Loose;
}

/** One tool a connector offers, with sample arguments. */
export interface ConnectorTool {
  name: string;
  desc: string;
  args: Dict<Loose>;
}

/** A public data source agents can call. */
export interface Connector {
  id: string;
  name: string;
  kind: string;
  url: string;
  auth: string;
  icon: string;
  acc: string;
  about: string;
  usedBy: string;
  tools: ConnectorTool[];
  [field: string]: Loose;
}

/** Who may do what with one table: the Backend agent writes one rule per table and role. */
export interface AccessRule {
  table: string;
  role: string;
  /** which records the role sees: all, its own, or none */
  list: string;
  create: boolean;
  update: string;
  delete: boolean;
}

/** Where one station of the build line is: its status, its attempts and the checks its last output got. */
export interface StationLine {
  status: string;
  attempt: number;
  attempts: Loose[];
  checks: Check[];
  facts: string[];
  note: string | null;
  /** the walkthrough's result for each tour step */
  results: { ok?: boolean; detail?: string; [field: string]: Loose }[];
  [field: string]: Loose;
}

/** An app's build workflow: stations, approvals, added agents and reviewers. */
export interface AppFlow {
  reviewers: string[];
  [field: string]: Loose;
}

/** A reviewer agent's review of an app, with its findings. */
export interface Review {
  status: string;
  findings: { state: string; [field: string]: Loose }[];
  [field: string]: Loose;
}
