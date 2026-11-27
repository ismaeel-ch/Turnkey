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
  /** single-key shortcuts such as "g b" and "?" (Ctrl/Cmd+K always works); off lets every key reach the page */
  keys: boolean;
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
/** Who made or last changed one item of an app's definition (src/workspace/provenance.ts). */
export interface Touch {
  /** an agent id, `rules` for the built-in rules, or `you` */
  by: string;
  /** the first build, a re-run of some stations, or a change the owner asked for */
  via: 'build' | 'rerun' | 'change';
  at: number;
  run?: number;
  /** the change step, in plain words */
  what?: string;
}
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
  /** set on a copy opened from a share link (share.tsx) */
  shared?: SharedInfo | null;
  /** the short link this app was saved under, and the token that lets this browser update it */
  short?: { slug: string; token: string };
  def: AppDef;
  /** the state of each station of the build line, by station id */
  line: Dict<StationLine>;
  /** the owner's build workflow for this app (src/workspace/custom.tsx) */
  flow: AppFlow;
  /** reviewer agents' last reviews, by reviewer id */
  reviews: Dict<Review>;
  /** goes up by one with every change to the definition */
  rev: number;
  /** who made or last changed each item of the definition, by item key (src/workspace/provenance.ts) */
  touched?: Dict<Touch>;
  /**
   * the rows the app started with, by table: its demo data, kept so it can be added again after it was removed.
   * A row is demo data unless it says `_demo: 0`; in a copy that started from someone's real records only `_demo: 1` is
   */
  seed?: { rows: Dict<Row[]> } | null;
  /** the last permission matrix the Backend check ran */
  matrix?: { at: number; calls: number; refused: number; failed: string[] } | null;
  /** the owner's answers to the build's questions; `q` is the Researcher's question */
  answers: { q?: number | null; [field: string]: Loose };
  /** what the Researcher looked up, shown as the brief's sources */
  lookups?: Loose[];
  /** released versions, newest first */
  releases?: Release[];
  /** changes since the first build, for the next release's notes */
  log?: { at: number; text: string; station: string }[];
  /** stays the same across versions and copies, so an installed app finds its newest copy */
  uid?: string;
  /** when the app was installed on its own in this browser */
  installed?: number;
  /** the last test run's counts, kept with the app */
  tests?: { total: number; passed: number; failed: number; at: number; rev: number; notRun?: number } | null;
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

/** One released version of an app. */
export interface Release {
  v: string;
  at: number;
  by: string;
  kind: string;
  notes: string[];
  /** the definition's fingerprint when it was released */
  sig: string | number;
  tests: { passed: number; total: number };
  /** the packed snapshot, let go for older versions to save room */
  pack: string | null;
  size: number;
  inside: { tables: number; pages: number };
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
  /** Live runs: what the server reported for every model call of the run (tokens, cache hits, cost). */
  usage?: UsageSum;
  /** The same, by agent id. */
  agentUsage?: Dict<UsageSum>;
  [field: string]: Loose;
}

/** Model calls added up: tokens (fresh prompt, output, cache read and write) and dollars. */
export interface UsageSum {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  /** Calls the server could not price (left out of `costUsd`). */
  unpriced: number;
  /** Calls whose tokens are estimates. */
  estimated: number;
}

/** A card under a chat message: an approval, a list of changes, an error and so on. `type` says which. */
export interface ChatCard {
  type: string;
  [field: string]: Loose;
}

/* The cards the build line, the change planner and the Tester put under their chat messages (`ChatCard.type`). */
export interface BriefCard {
  type: 'brief';
  summary: string;
  roles: string[];
  records: string[];
  states: string[];
  stories: number;
}
export interface TablesCard {
  type: 'tables';
  tables: { name: string; cols: number; rows: number }[];
  users: number;
}
export interface AccessCard {
  type: 'access';
  endpoints: number;
  actions: string[];
  calls: number;
  refused: number;
  team: string[] | null;
}
export interface TestsCard {
  type: 'tests';
  total: number;
  passed: number;
  failed: number;
  suites: { name: string; n: number }[];
}
export interface ViewPlanCard {
  type: 'viewplan';
  tables: { name: string; views: string[] }[];
  widgets: number;
}
export interface ScreensCard {
  type: 'screens';
  screens: { name: string; type: string }[];
  accent: string;
  nav: string;
}
export interface AcceptanceCard {
  type: 'acceptance';
  steps: { say?: string; ok: boolean; detail: string }[];
}
export interface QuestionCard {
  type: 'question';
  options: string[];
  recommended: number;
  answered: number | null;
}
export interface ApprovalCard {
  type: 'approval';
  items: string[];
  decided?: string | null;
}
export interface PlanCard {
  type: 'plan';
  steps: { text: string; sql?: string }[];
  rerun: string[];
  skip: string[];
}
export interface SentBackCard {
  type: 'sentback';
  attempt: number;
  issues: string[];
}
export interface ChangedCard {
  type: 'changed';
  items: string[];
  reran: string[];
}
export interface ReadyCard {
  type: 'ready';
}
export interface ErrorCard {
  type: 'error';
  issues?: string[];
}
/** Cards drawn by the workflow (custom.tsx) and release (release.tsx) modules, which read them themselves. */
export interface OtherCard {
  type: 'flow' | 'gate' | 'review' | 'flowinfo' | 'released';
  [field: string]: Loose;
}
export type BuilderCard =
  | BriefCard
  | TablesCard
  | AccessCard
  | TestsCard
  | ViewPlanCard
  | ScreensCard
  | AcceptanceCard
  | QuestionCard
  | ApprovalCard
  | PlanCard
  | SentBackCard
  | ChangedCard
  | ReadyCard
  | ErrorCard
  | OtherCard;

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
  custom: Connector[];
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

/** One step of the product tour: the element it points at (`data-tour`), and what to do before showing it. */
export interface ProductTourStep {
  target: string;
  title: string;
  body: string;
  prep?: (() => void) | null;
}

/** The product tour while it runs. */
export interface ProductTour {
  id: string;
  i: number;
  steps: ProductTourStep[];
}

export interface ViewState {
  boot: 'loading' | 'ready' | 'error' | (string & {});
  bootErr: string;
  toasts: Toast[];
  dialog: Dialog | null;
  tour: ProductTour | null;
  /** the workspace view (build, app, release or a Details page), per app */
  view: Dict<string>;
  /** how the Build view shows the agents: line, timeline or log, per app */
  bview: Dict<string>;
  /** the selected station, per app */
  sel: Dict<string>;
  /** the inspector's tab, per app */
  itab: Dict<string>;
  /** the run picked in the timeline and log, per app */
  runSel: Dict<string | null>;
  /** whether the selection follows the working station, per app */
  follow: Dict<boolean>;
  stage: Dict<Stage>;
  /** the Data page's state, per app */
  data: Dict<DataPanel>;
  /** the API page's state, per app */
  api: Dict<ApiPanel>;
  /** the connector open on the Connections page */
  conn: string | null;
  dbg: DebugPanel;
  live: LiveStatus;
  dl: Downloader | null;
  /** model calls made this session */
  calls: number;
  savedAt: number;
  home: { text: string; note: string };
  /** the handoff being animated between stations, per app */
  handoff: Dict<number | null>;
  chatDraft: Dict<string>;
  /** characters received so far from the model, per app */
  stream: Dict<number>;
  showSql: Dict<boolean>;
  /** the app whose chat message the orchestrator is reading */
  busy: string | null;
  /** the last connector tool tried on the Connections page */
  connOut: { id: string; tool: string; r: { ok: boolean; result: Loose }; real?: boolean; busy?: boolean } | null;
  /** the first-run onboarding form, while it is open */
  ob: OnboardingForm | null;
  /** the sign-in form, while it is open */
  si: SignInForm | null;
  tv: Dict<Loose>;
  /** where the owner dragged each node of the workflow canvas, by app id (plus ':v' for the narrow layout) */
  flowPos: Dict<Dict<{ x: number; y: number }>>;
  flowN: number;
  /** the canvas map is shown; null follows the layout */
  flowMap: boolean | null;
  /** one app open on its own, from a link or the share preview (share.tsx) */
  solo: SoloView | null;
  /** the open bottom sheet of the phone layout */
  sheet: PhoneSheet | null;
  told: Dict<Loose>;
  /** unsaved instructions and step jobs the owner is typing, by key */
  noteDraft: Dict<string>;
  /** release form, per app */
  /** the Release view's form, by app id */
  rel: Dict<{ kind: string | null; text: string | null; busy: boolean }>;
  /** last Details tab, per app */
  detail: Dict<string>;
  /** the chat peek on narrow screens */
  peek?: boolean;
  /** the share dialog's state (share.tsx) */
  share?: ShareState | null;
}

/** Where an app opened from a share link came from. */
export interface SharedInfo {
  /** hash of the link's code, the key of `State.shared` */
  key: string;
  /** who shared it, and when it was opened */
  by: string;
  at: number;
  /** the username the link signs in as, or '' for the sign-in screen */
  as: string;
  data: 'live' | 'demo';
  /** the owner's own preview of their link, replaced by the next one */
  preview: boolean;
  /** the released version, and the app's lasting id */
  ver: string;
  uid: string;
  /** release notes of that version */
  notes: string[];
  /** the short link's name, when it was opened from one */
  slug?: string;
  /** set when this copy replaced an older version and carried its records over */
  updated?: { from: string; kept: number | null; at: number; seen?: boolean };
}

/** An app open on its own, without the builder around it. */
export interface SoloView {
  app: string;
  /** the runtime's pane: who is signed in and what they look at */
  pane: Pane;
  /** a link, the owner's share preview, or the owner opening their own app */
  from: 'link' | 'preview' | 'own';
  /** the app tab to go back to */
  back: string | null;
  noInstall?: boolean;
}

/** The share dialog: which data and person the link carries, and the link once it is packed. */
export interface ShareState {
  app: string;
  data: 'live' | 'demo';
  as: string;
  code: string | null;
  busy: boolean;
  err: string;
  /** size of the packed app before compression, and the rows it carries */
  raw: number;
  rows: number;
  ver?: string;
  draft?: boolean;
  short?: string;
  shortBusy?: boolean;
  shortNote?: string;
  /** the first release is running */
  rbusy?: boolean;
}

/** The first-run onboarding: which step, the new account and the first choices. */
export interface OnboardingForm {
  step: number;
  name: string;
  user: string;
  pass: string;
  demo: boolean;
  dev: boolean;
  /** the saved build to start with, or '' for none */
  pick: string;
  tour: boolean;
  err: string;
}

/** The sign-in form, or the new-account form when `create` is on. */
export interface SignInForm {
  u: string;
  p: string;
  name: string;
  err: string;
  create: boolean;
}

/** The Data page of one app: the open table and tab, the SQL console and its last result. */
export interface DataPanel {
  table: string | null;
  tab: string;
  sql: string;
  out: { rows?: Dict<Loose>[]; msg?: string; err?: string } | null;
}

/** The API page of one app: the endpoint being tried, as whom, and the last response. */
export interface ApiPanel {
  ep: string | null;
  tab: string;
  /** the built app's user id to call as */
  uid: number | null;
  /** the record id for paths with :id */
  id: string;
  body: string;
  out: { path?: string; status: number; data?: Loose; error?: string; fields?: Dict<string>; ms?: number } | null;
}

/** One model call in the Debug log: live, or replayed from a saved build. */
export interface ModelCallRecord {
  t: number;
  app: string;
  run: string;
  agent: string;
  mode: 'live' | 'replay';
  model: string;
  tokIn: number;
  tokOut: number;
  /** live token counts are estimated from the text length */
  est?: boolean;
  ms: number;
  attempt: number;
  /** Live calls the server reported: prompt tokens read from the cache, and the cost in dollars (null: not priced). */
  cacheRead?: number;
  costUsd?: number | null;
}

/** One SQL statement in the Debug log. */
export interface SqlLogRecord {
  t: number;
  app: string;
  sql: string;
  params: Loose[] | null;
  /** a batch insert: how many rows it wrote */
  many?: number;
  ms: number;
  rows: number | null;
  changes: number;
  by: string;
  err: string | null;
}

/** One call to a built app's API in the Debug log. */
export interface ApiLogRecord {
  t: number;
  app: string;
  user: string;
  role: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  /** who called: the app, a check, the tour or the API page */
  src: string;
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
  /** set for a review step: its id */
  reviewer?: string;
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
  args: Dict<string | number | undefined>;
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
  attempts: StationAttempt[];
  checks: Check[];
  facts: string[];
  note: string | null;
  /** why the station is holding: the Researcher's question, or an approval the owner asked for */
  hold?: string | null;
  /** the agent failed every attempt and the orchestrator used the safe default */
  fellBack?: boolean;
  /** the walkthrough's result for each tour step */
  results: { ok?: boolean; detail?: string; [field: string]: Loose }[];
  [field: string]: Loose;
}

/** One attempt at a station: whether it passed its checks, and the issues it was sent back with. */
export interface StationAttempt {
  n: number;
  ok: boolean;
  issues: string[];
}

/** A bottom sheet of the builder's phone layout (mobile.tsx), and the app it is about. */
export interface PhoneSheet {
  kind: 'tabs' | 'menu' | 'more' | 'inspector';
  app?: string;
}

/** A step the owner added to the workflow: an agent of their own that runs after a station. */
export interface AddedAgent {
  id: string;
  name: string;
  job: string;
  /** the station it runs after */
  after: string;
  /** `apply` changes the app; `advise` only reports */
  mode: 'apply' | 'advise';
  icon: string;
  acc: string;
}

/** An app's build workflow: stations, approvals, added agents and reviewers (custom.tsx `normFlow` makes it valid). */
export interface AppFlow {
  /** attempts per station, 1 to 3 */
  attempts: number;
  /** station id to true: stop for the owner's approval after it */
  approve: Dict<boolean>;
  /** agent id to a note the owner left for it */
  notes: Dict<string>;
  /** station id to 'rules': built by rules, no model */
  by: Dict<string>;
  /** reviewer ids, in the order they run */
  reviewers: string[];
  agents: AddedAgent[];
  /** reviewer id to the station it runs after, when moved from its usual place */
  at: Dict<string>;
  /** reviewer id to whether it applies its own changes, when that differs from its default */
  auto: Dict<boolean>;
}

/** A reviewer or added step that can run after a station (custom.tsx REVIEWERS). */
export interface ReviewerInfo {
  id?: string;
  name: string;
  short: string;
  /** the station it runs after by default */
  after: string;
  icon: string;
  acc: string;
  reads: string;
  job: string;
  /** applies its own changes instead of asking */
  auto?: boolean;
  /** added by the owner, not one of the library's */
  custom?: boolean;
}

/** A reviewer agent's review of an app, with its findings. */
export interface Review {
  status: 'working' | 'ok' | 'failed';
  at: number;
  /** the app's revision this review read */
  rev: number;
  findings: ReviewFinding[];
  by: 'model' | 'rules';
  note: string;
}

/** One finding of a review, with the fix it proposes and whether that fix was tried out. */
export interface ReviewFinding {
  id: string;
  level: 'high' | 'medium' | 'low';
  text: string;
  why: string;
  fix: string | null;
  /** open, applying or applied */
  state: string;
  /** pass, fail or unknown once the fix was tried out; null before */
  test: string | null;
  /** why the fix would not pass, or a note on approval */
  block: string;
}

/* ---------- a built app on screen (src/workspace/runtime.tsx, views-a.tsx, views-b.tsx, room.tsx) ---------- */
/** One record of a table: what the record drawer opens. */
export interface RecordRef {
  table: string;
  id: number;
}

/** A record form being filled in: a new record (`id` null) or an edit. */
export interface PaneForm {
  table: string;
  id: number | null;
  vals: Dict<Loose>;
  errs: Dict<string>;
  err?: string;
  /** form screens: the id of the record just created */
  done?: number | null;
}

/** One filter of a data view: a column, a condition (`is`, `has`, `range`, `between` ...) and its value. */
export interface ViewFilter {
  col: string;
  op: string;
  /** a value of the column; a range name for `range`; `[from, to]` dates for `between`; null for `empty` */
  val: Loose;
}

/** What a person chose for one view: the View advisor's plan is merged under it. Every field names a column. */
export interface ViewOptions {
  by?: string | null;
  lane?: string | null;
  date?: string | null;
  start?: string | null;
  end?: string | null;
  x?: string | null;
  split?: string | null;
  measure?: string | null;
  bucket?: string | null;
  kind?: string | null;
  rows?: string | null;
  cols?: string | null;
  parent?: string | null;
  levels?: string[];
  mode?: string | null;
  zoom?: string | null;
  /** chart: show the data table under it */
  table?: boolean;
}

/** How a person left one page of a built app: view, search, filters, sorting and each view's options. */
export interface ExplorerState {
  view: string;
  q: string;
  filters: ViewFilter[];
  sort: { col: string; dir: number } | null;
  group: string;
  /** column name to hidden, once the table view has drawn */
  hidden: Dict<boolean> | null;
  page: number;
  /** closed groups (table) and open branches (tree) */
  closed: Dict<boolean>;
  open: Dict<boolean>;
  cfg: Dict<ViewOptions>;
  /** the filter being written in the filter box */
  fd: { col: string; op: string; val: Loose } | null;
  /** calendar: months or weeks from today, and the day showing all its records */
  month?: number;
  calOpen?: string | null;
  /** timeline: days from the default window */
  tlOff?: number;
}

/** A dashboard filter set by selecting a bar. */
export interface DashFilter {
  table: string;
  col: string;
  val: Loose;
}

/** A connector call made from a record's action button, and its answer. */
export interface PaneCall {
  row: number;
  name: string;
  label: string;
  res: { ok: boolean; result: Loose };
}

/** One copy of a built app on screen: who is signed in, which page, and what is open. */
export interface Pane {
  n: number;
  /** the signed-in user's id */
  uid: number | null;
  screen: string | null;
  rec: RecordRef | null;
  form: PaneForm | null;
  /** form screens' drafts, by screen id */
  forms: Dict<PaneForm>;
  /** each page's state, by screen id */
  vs: Dict<ExplorerState>;
  /** the dashboard's date range and bar filters */
  ds: { range: string; f: DashFilter[] } | null;
  /** the agent room's start form */
  tf: PaneForm | null;
  login: { u: string; p: string; err: string } | null;
  conn: PaneCall | null;
  /** phone layout: the open sheet */
  sheet?: string | null;
  /** the agent room: the case on show */
  caseId?: number | null;
  /** drawn by a check, not by a person: nothing is remembered */
  test?: boolean;
}

/** The walkthrough player: the step on show, each step's result, and what the tour remembers. */
export interface Walk {
  i: number;
  res: ({ ok?: boolean; detail?: string } | undefined)[];
  state: { rows: Dict<number>; last: RecordRef | null };
}

/** The built app's preview: one or two panes, and the walkthrough when it plays. */
export interface Stage {
  split: boolean;
  panes: Pane[];
  tour: Walk | null;
}
