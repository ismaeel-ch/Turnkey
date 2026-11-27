import { NARROW, S, U, activeTab, chatShown, closeDialog, commit, notify, openTab, setChat, str, toast } from './core';
import { Btn, Chip, Dialog, Empty, Icon, Input } from './ui';
import { openShare } from './share';
import { startTour } from './shell-c';
import type { AppRecord } from '@/shared/types/workspace';

/** Where a guide entry's button takes you: a view of the open app, or one of a few workspace actions. */
export interface GuideGo {
  label: string;
  view?: string;
  act?: 'home' | 'tour' | 'debug' | 'chat' | 'share';
}
export interface GuideGroup {
  id: string;
  name: string;
  icon?: string;
}
export interface GuideEntry {
  /** the GuideGroup id */
  g: string;
  icon: string;
  title: string;
  what: string;
  how: string[];
  go?: GuideGo;
}
/** The guide dialog's props, kept on U.dialog.props so the search and section survive a re-render. */
export interface GuideProps {
  q?: string;
  g?: string;
}

/* ===== Turnkey prototype · the feature guide =====
   Every feature in one place: what it is, how to try it, and a button that takes you there. */
export const GUIDE_GROUPS: GuideGroup[] = [
  {
    id: 'start',
    name: 'Getting started',
    icon: 'rocket',
  },
  {
    id: 'build',
    name: 'Building',
    icon: 'flow',
  },
  {
    id: 'tests',
    name: 'Testing',
    icon: 'beaker',
  },
  {
    id: 'app',
    name: 'The app',
    icon: 'window',
  },
  {
    id: 'change',
    name: 'Changing',
    icon: 'chat',
  },
  {
    id: 'share',
    name: 'Sharing and phones',
    icon: 'share',
  },
  {
    id: 'data',
    name: 'Data and plumbing',
    icon: 'database',
  },
];
export const GUIDE: GuideEntry[] = [
  {
    g: 'start',
    icon: 'sparkle',
    title: 'Describe an app in one sentence',
    what: 'You type what the app is for. Six agents turn the sentence into a working app with tables, rules, views and pages.',
    how: ['Go to Home.', 'Pick one of the six saved builds, or switch Live on and type your own sentence.', 'Press Build.'],
    go: {
      label: 'Go to Home',
      act: 'home',
    },
  },
  {
    g: 'start',
    icon: 'play',
    title: 'Live and Demo',
    what: 'Live sends your own sentence to the model. It follows your internet connection and nothing else: it pauses by itself when you go offline, comes back by itself when you reconnect, and does not depend on where the app is running. Demo replays saved builds with made-up data and makes no model calls, so it always works and costs nothing.',
    how: [
      'Use the Live switch in the title bar (on a phone: the menu behind your initials).',
      'Press Online next to it to try going offline: Live pauses, and saved builds and built-in changes take over.',
      'Go back online: Live switches itself on again.',
      'In Live, each station makes one model call, and each change by chat makes one.',
    ],
  },
  {
    g: 'start',
    icon: 'person',
    title: 'Accounts, and finding your work again',
    what: "Everything you build is saved in this browser: the app definitions in local storage, and each app's database as a SQLite file. Sign in again and it is all there.",
    how: ['Open the account menu and choose Sign out.', 'Sign in again. Your apps, their data and their chat are back.'],
  },
  {
    g: 'start',
    icon: 'compass',
    title: 'Guided tour',
    what: 'A step-by-step tour that points at each part of the builder.',
    how: ['Open Help and choose Take the guided tour.'],
    go: {
      label: 'Start the tour',
      act: 'tour',
    },
  },
  {
    g: 'build',
    icon: 'flow',
    title: 'The workflow canvas',
    what: "The build drawn as a workflow with React Flow: your request, the six agents, a gate after each one, the steps you added, the send-back arrows, the finished app, and the app's own agents if it has any.",
    how: [
      'Open an app and stay on Build.',
      'Drag the background to pan. Use the zoom buttons or pinch. Drag a node to move it.',
      'Select an agent to read what it wrote. Select a gate to see its checks and tests.',
      'Map shows a small overview. Reset layout puts every node back.',
    ],
    go: {
      label: 'Show the workflow',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'bot',
    title: 'The six agents',
    what: "Researcher writes the brief. Database designs the tables and seed rows. Backend writes the workflow and who may do what. View advisor recommends how each table is best viewed, designs the dashboard and picks the layout of the agents' room. UI lays out the pages, designs the app icon and writes the tour. Tester writes test cases from the brief and sends failures back for repair. The Orchestrator is code, not a model.",
    how: ['Select each agent node on the canvas.', 'Read its Output tab in the inspector.'],
    go: {
      label: 'Show the workflow',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'shield',
    title: 'Check gates and send-backs',
    what: "Code checks every handoff. If an agent's work fails a check it is sent back with the exact reasons, at most twice unless you set fewer attempts. On the last try code mends what it can, and if that fails a safe default is used, so a build always ends with a working app.",
    how: ['Build CareDesk: the Database agent is sent back once.', 'Select the Database node and open Attempts.'],
    go: {
      label: 'Show the workflow',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'questionChat',
    title: 'Your decisions',
    what: 'The agents stop for you whenever a decision is yours: the Researcher asks one question about a real trade-off before anything is built, any change that would delete data waits for your approval, and you can add approvals of your own after any station.',
    how: [
      'Start a build and answer the question card in the chat.',
      'Later, ask to remove a field. The change waits until you approve it.',
    ],
  },
  {
    g: 'build',
    icon: 'options',
    title: 'Customise the workflow',
    what: 'The build workflow is yours to change, and it is shared state: you edit it on the canvas, in the inspector or in the settings, and the orchestrator edits it when you ask in chat. Every change is one state update, and only the agents it touches run again. The six stations keep their order, because each one needs what the one before it made.',
    how: [
      'On Build, press Customize under the canvas to see every setting in one place.',
      'Or press the plus on a gate to add a step, or the options button on an agent.',
      'Or ask in chat: “ask me before the screens are built”, “add a normalise step”, “allow 2 attempts”, “show the workflow”.',
      'Save as my default makes new apps start with your workflow. Reset to standard puts it back.',
    ],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'handRight',
    title: 'Approvals where you want them',
    what: 'Any station from Research to Screens can stop the line when it has passed its checks and wait for your approval before the next one starts. Stopping instead of approving ends the run; a run that kept the earlier stations puts the app back exactly as it was.',
    how: [
      'Press the plus on a gate and choose Your approval, or switch it on under Customize.',
      'Run the build. When it reaches that gate, the chat shows an approval card.',
      'Press See what was made, then Approve and continue, or Stop here.',
    ],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'shieldKey',
    title: 'Steps from the library',
    what: 'Six ready-made steps can be added after a station. Four advise: Data, Security, Insight and Wording reviews. Two apply their changes: Normalise tables, which turns free text that repeats into a choice, and Style the UI. Any step can be switched between advising and applying, and moved later in the flow. An advising step changes nothing by itself. Each finding comes with a fix written as an ordinary change request, and once the app is built every fix is tried out in a savepoint and put back, so you know it passes every check before you press Apply. In Demo the reviewers are rules; in Live each one is one model call.',
    how: [
      'Press the plus on a gate and pick a step. On a finished app that step runs at once; nothing else runs again.',
      'Select the step on the canvas to read its findings and change its settings.',
      'Press Apply on a finding. It goes through the same plan, approval, savepoint and re-check as any change you ask for.',
    ],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'bot',
    title: 'An agent of your own in the workflow',
    what: 'You can add an agent that is not in the library: give it a name, say in plain sentences what it should do, and choose where it sits. Set to apply, its changes go through the same checks as a change you ask for in chat, and anything that deletes data still waits for you. In a Live build the agent reads the app and decides. Without a model it does the changes the built-in reader finds in your sentences, and says which ones it could not read.',
    how: [
      'Press the plus on a gate and fill in Or describe an agent of your own.',
      'Example: name it Brand stylist, job “Use the colour teal. Make the rows compact.”',
      'Or ask in chat: “add an agent called Table tidier after database that turns every text field that repeats into a choice”.',
      'Select its node to change its job, its place, or whether it advises or applies.',
    ],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'tests',
    icon: 'beaker',
    title: 'Test cases written by the Tester',
    what: "The Tester is the seventh station. It reads the rules and user stories of the brief and writes test cases as data: who does what, and what must happen. Code plays each case against the real endpoints inside a savepoint. When one fails, the orchestrator sends it back to the agent that owns the failing part, applies that agent's repair as a checked change and runs every test again, at most twice. In Demo the cases come from the saved build or from rules; in Live the model writes them.",
    how: [
      'Build the Sales bidding desk. Its saved build keeps one slip on purpose.',
      'Watch the Tests station: one case fails, Backend repairs the rule, the second run passes.',
      'Select the Tests station to read every case, its steps and each run.',
    ],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'note',
    title: 'Instructions, attempts and who does a step',
    what: 'Each agent can carry a standing instruction that is added to every request it gets in a Live build. Stations get 1, 2 or 3 attempts before code steps in with a repair or its safe default. Views and Screens can be handed to the built-in rules instead of their agent: plainer output, no model call.',
    how: [
      'Select a station and open its Customize tab.',
      'Type an instruction and press Save instruction, or ask in chat: “tell the UI agent to keep page names short”.',
      'Set Attempts per station, or switch Who does this step to Rules.',
    ],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'build',
    icon: 'rerun',
    title: 'Run again from one station',
    what: 'When only a later step should change, the stations before it are kept: a run from Views replays Views, Screens and the Walkthrough and leaves the brief, the tables, your records and the rules alone. In a Live build that means fewer model calls. If a check fails, or you stop it, the app goes back to exactly what it was.',
    how: ["Open a station's Customize tab and press Run again from that station.", 'Or ask in chat: “run again from views”.'],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'share',
    icon: 'rocket',
    title: 'Releases and versions',
    what: 'Building gives you a draft. Releasing turns it into a numbered version: every test runs once more, the notes say what changed, and a snapshot is kept. Later changes go into a new draft until you release again as a fix, new features or a big change. Any kept version can be opened on its own or made the draft again.',
    how: [
      'Open Release and press Release version 1.0.',
      'Ask for a change in chat. The app now shows Draft, and the notes are written from what changed.',
      'Release again, then look under Versions.',
    ],
    go: {
      label: 'Open Release',
      view: 'release',
    },
  },
  {
    g: 'share',
    icon: 'install',
    title: 'The app on its own: icon, link, install, updates',
    what: 'A share link carries a released version and opens the app alone, under its own name and its own icon. The UI agent designs the icon as data (symbol, shape, fill and mark) and code draws it. Whoever opens the link can install the app. Opening the link of a newer version updates their copy and keeps their records. Inside this prototype installing is simulated; the hosted build gives each released app its own address and web manifest.',
    how: [
      'On Release, try Another design, or save the icon as a PNG.',
      'Press Share by link, then Preview what they see.',
      'In the app-only view, open the person menu for Install this app and About this app.',
    ],
    go: {
      label: 'Open Release',
      view: 'release',
    },
  },
  {
    g: 'app',
    icon: 'team',
    title: "The agents' room",
    what: 'An app with agents of its own gets a room built for what they produce. The View advisor picks the panels from a fixed catalog: two sides face to face, a list with what belongs to each record underneath, groups, a scorecard with a weighted total, or options side by side. The outcome leads the page, the rows appear while the agents write them, and the workflow actions for your role sit under the outcome.',
    how: [
      'Build Debate partner or the Sales bidding desk and open the app.',
      'Open the Debate room or the Bid room and run a saved case.',
      'Add a point of your own when the run pauses, then act on the outcome.',
    ],
    go: {
      label: 'Open the app',
      view: 'app',
    },
  },
  {
    g: 'build',
    icon: 'timeline',
    title: 'Timeline and log',
    what: 'Two other ways to see the same run: who worked when, and every step in order with its duration.',
    how: ['On Build, switch from Workflow to Timeline or Log.'],
    go: {
      label: 'Show the build',
      view: 'build',
    },
  },
  {
    g: 'tests',
    icon: 'beaker',
    title: 'A generated test suite',
    what: 'When an app is built, a test suite is generated from its definition: every table, link, access rule, workflow action, view, page, tour step and saved agent run becomes a test. They run against the real database and endpoints, and anything they write is rolled back.',
    how: [
      'Open Tests and press Run all.',
      'Run one suite with its Run button, or the tests of one station from its gate on the canvas.',
      'Filter to Failed, or search by name.',
      'After every change by chat the suite is generated and run again.',
    ],
    go: {
      label: 'Open the tests',
      view: 'tests',
    },
  },
  {
    g: 'app',
    icon: 'pie',
    title: 'Overview comes first',
    what: 'Every app opens on its Overview: key numbers and charts over the rows the signed-in role may see. Select a number or a bar to filter the rest, change the date range, or drill through to the records.',
    how: [
      'Open the App view and sign in as anyone.',
      'Select a bar in a chart. The other widgets filter to it.',
      'Use See the records to open the matching rows.',
    ],
    go: {
      label: 'Open the app',
      view: 'app',
    },
  },
  {
    g: 'app',
    icon: 'table',
    title: 'One table, many views',
    what: "The same rows as a table, board, calendar, timeline, chart, pivot, tree or cards. The View advisor recommends the ones that fit each table; the rest are under More. Search, filter, group, sort and copy as CSV work in every view, and each person's choices are remembered.",
    how: ['Open a page with records.', 'Switch views with the tabs above the rows.', 'Add a filter, then switch view: the filter stays.'],
    go: {
      label: 'Open the app',
      view: 'app',
    },
  },
  {
    g: 'app',
    icon: 'lock',
    title: 'People, roles and rules',
    what: 'The Database agent seeds people for every role. The Backend agent decides what each role may list, create, change and delete, and which workflow actions it may take. The rules are enforced in the endpoints, not only hidden in the pages.',
    how: ['Sign in as two different people and compare what they see.', 'On a desktop, Two users opens the app twice side by side.'],
    go: {
      label: 'Open the app',
      view: 'app',
    },
  },
  {
    g: 'app',
    icon: 'form',
    title: 'Records and the workflow',
    what: 'Create and edit records in generated forms, move them through the workflow with one button, and see related records and the activity history on each record.',
    how: ['Open a record.', 'Press a workflow action. The status changes and the activity is logged.'],
    go: {
      label: 'Open the app',
      view: 'app',
    },
  },
  {
    g: 'app',
    icon: 'team',
    title: "The app's own agents",
    what: "The three hackathon quests are apps with a team of three agents inside: Fact Desk, Prior Art Scout and Second Opinion. The team writes its work into the app's tables through the same endpoints and rules as a person, and you can watch every step.",
    how: [
      'Build a quest app and open its Agents page.',
      'Pick a saved case and press Run.',
      'In Second Opinion, add your own argument while they work.',
    ],
  },
  {
    g: 'app',
    icon: 'playOutline',
    title: 'The walkthrough',
    what: 'The UI agent writes a tour of the app. It is played for real, as the named people, and doubles as the acceptance test.',
    how: ['In the App view press Play walkthrough.'],
    go: {
      label: 'Open the app',
      view: 'app',
    },
  },
  {
    g: 'change',
    icon: 'chat',
    title: 'Change the app by chat',
    what: 'Ask for a change in plain words. It becomes a list of operations, runs inside a database savepoint, and only the stations it touches run again. If a check fails afterwards, everything is rolled back.',
    how: [
      'Open the Agents panel.',
      'Try a suggestion, such as adding a field or a board.',
      'Watch which stations run again on the canvas.',
    ],
    go: {
      label: 'Open the chat',
      act: 'chat',
    },
  },
  {
    g: 'share',
    icon: 'share',
    title: 'Share an app by link',
    what: 'A link that opens only the app: no builder, no agents, none of your other apps. The link carries the app and its starting rows, compressed, so nothing is uploaded. Whoever opens it gets their own copy of the data in their own browser.',
    how: [
      "Press Share in the app's header.",
      'Choose demo data or the current records, and who they open it as.',
      'Copy the link, or press Preview what they see.',
      "To open someone else's link here, use Open a shared app.",
    ],
    go: {
      label: 'Share this app',
      act: 'share',
    },
  },
  {
    g: 'share',
    icon: 'phone',
    title: 'Built for phones',
    what: 'On a phone a built app behaves like an app: a title bar, a bottom tab bar, a floating New button, records that open as full pages, forms and menus as bottom sheets, and lists instead of wide tables. The builder gets its own bottom navigation and opens built apps full screen.',
    how: ['Open the page on a phone, or make the window narrow.', 'In the builder, open App and press Open the app.'],
  },
  {
    g: 'data',
    icon: 'database',
    title: 'The database',
    what: 'Each app has its own SQLite file with tables created from the definition. Browse the rows, read the schema, and run SQL.',
    how: ['Open Data.', 'Pick a table, or type a query in the SQL box.'],
    go: {
      label: 'Open Data',
      view: 'data',
    },
  },
  {
    g: 'data',
    icon: 'server',
    title: 'The API',
    what: 'Endpoints are derived from the tables and the rules. See every endpoint, which roles may call it, and the result of calling each one as each role.',
    how: ['Open API.', 'Pick an endpoint and call it as a role.'],
    go: {
      label: 'Open API',
      view: 'api',
    },
  },
  {
    g: 'data',
    icon: 'plug',
    title: 'Connections',
    what: 'Outside sources the agents and the built apps may use: Wikipedia, Microsoft Learn, World Bank, OpenAlex, arXiv, PatentsView, and your own. Test on the Connections page calls Wikipedia, Microsoft Learn (search), World Bank, OpenAlex, arXiv and PatentsView for real through Turnkey’s server; the others show a labelled sample.',
    how: ['Open Connections.', 'Switch one on, test it, or add your own.'],
    go: {
      label: 'Open Connections',
      view: 'conn',
    },
  },
  {
    g: 'data',
    icon: 'apps',
    title: 'Library and workspaces',
    what: 'Every app you build is kept in your library. Open several at once in tabs, duplicate an app with its data, or delete it.',
    how: ['Go to Home and look under Your apps.', 'Open a second app: it gets its own tab.'],
    go: {
      label: 'Go to Home',
      act: 'home',
    },
  },
  {
    g: 'data',
    icon: 'bug',
    title: 'Debug mode',
    what: 'A drawer with the raw material: the event stream in AG-UI terms, every tool call, every model call with its prompt and tokens, every SQL statement and every API call.',
    how: ['Press the bug button in the title bar.'],
    go: {
      label: 'Switch debug on',
      act: 'debug',
    },
  },
  {
    g: 'data',
    icon: 'wifiOff',
    title: 'Offline and install',
    what: 'Built apps, their data and saved builds work without internet. Live pauses until the connection returns, and so do changes through the model and connections to other systems. Install adds Turnkey, or one built app, to your desktop with its own icon, and a service worker keeps it working offline.',
    how: [
      'Press Online in the title bar to try going offline, or really disconnect your device.',
      'Open a built app: it still works.',
      'Ask for a change in chat: the built-in rules read it while Live is paused.',
    ],
  },
  {
    g: 'data',
    icon: 'document',
    title: 'Build pack',
    what: "One document generated from the app's definition: the brief, the SQL, the workflow, the endpoints, the views, the pages and the acceptance test.",
    how: ['Open the More menu of an app.', 'Choose Export build pack.'],
  },
];
export function guideGo(go: GuideGo, app: AppRecord | null): void {
  const need = () => {
    toast('Open or build an app first.', 'info');
  };
  if (go.view) {
    if (!app) return need();
    closeDialog();
    U.sheet = null;
    if (U.solo) U.solo = null;
    U.view[app.id] = go.view;
    if (chatShown() && NARROW()) setChat(false);
    notify();
    return;
  }
  if (go.act === 'home') {
    closeDialog();
    openTab(null);
    return;
  }
  if (go.act === 'tour') {
    closeDialog();
    startTour();
    return;
  }
  if (go.act === 'debug') {
    S.settings.debug = true;
    closeDialog();
    commit();
    return;
  }
  if (go.act === 'chat') {
    if (!app) return need();
    closeDialog();
    setChat(true);
    return;
  }
  if (go.act === 'share') {
    if (!app || app.status !== 'ready') {
      need();
      return;
    }
    openShare(app);
    return;
  }
}
/** Changes the open guide's search or section. The props live on U.dialog, so they outlast a re-render. */
function setGuide(patch: GuideProps): void {
  if (U.dialog && U.dialog.type === 'guide') Object.assign(U.dialog.props, patch);
  notify();
}
export function GuideDialog({ p }: { p: GuideProps }) {
  const tab = S.session ? activeTab() : null,
    app = tab && tab.app ? S.apps[tab.app] : null,
    q = str(p.q).toLowerCase(),
    g = p.g || 'all';
  const list = GUIDE.filter(
    (x) => (g === 'all' || x.g === g) && (!q || (x.title + ' ' + x.what + ' ' + x.how.join(' ')).toLowerCase().indexOf(q) >= 0),
  );
  return (
    <Dialog wide cls="guide" title="Feature guide" onClose={closeDialog}>
      <div className="guide-bar">
        <div className="search grow">
          <Icon n="search" s="16" />
          <Input
            native
            className="input"
            id="guide-q"
            aria-label="Search the guide"
            placeholder={'Search ' + GUIDE.length + ' features'}
            value={p.q || ''}
            onInput={(e) => {
              setGuide({ q: e.currentTarget.value });
            }}
          />
        </div>
      </div>
      <div className="chips guide-groups" role="group" aria-label="Sections">
        {[{ id: 'all', name: 'Everything' } as GuideGroup].concat(GUIDE_GROUPS).map((x) => (
          <Chip
            key={x.id}
            on={!!(g === x.id)}
            aria-pressed={g === x.id}
            onClick={() => {
              setGuide({ g: x.id });
            }}
          >
            {x.icon && <Icon n={x.icon} s="16" />}
            {x.name}
          </Chip>
        ))}
      </div>
      <div className="guide-list">
        {list.length ? (
          list.map((x) => (
            <article key={x.title} className="card guide-i">
              <header className="row">
                <span className="guide-ic">
                  <Icon n={x.icon} />
                </span>
                <h3 className="t-sub2 grow">{x.title}</h3>
                <span className="badge b-outline hide-sm">{GUIDE_GROUPS.find((y) => y.id === x.g)?.name}</span>
              </header>
              <p>{x.what}</p>
              <ol className="guide-how">
                {x.how.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
              {x.go && (
                <div className="row">
                  <Btn className="btn sm" onClick={() => x.go && guideGo(x.go, app)}>
                    <Icon n="arrowRight" s="16" />
                    {x.go.label}
                  </Btn>
                  {(x.go.view || x.go.act === 'share' || x.go.act === 'chat') && !app ? (
                    <span className="t-cap muted">Needs an open app</span>
                  ) : null}
                </div>
              )}
            </article>
          ))
        ) : (
          <Empty icon="search" title="Nothing matches" text="Try a shorter word." />
        )}
      </div>
    </Dialog>
  );
}
