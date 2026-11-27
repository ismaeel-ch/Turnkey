# Changelog

All notable changes to Turnkey. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions are semantic versions. Each release lists the pull requests merged into it.

## [Unreleased]

### Added

- Every built app has its own Settings page, opened from a gear in the app's header by the people who run it. It
  has six sections. General: the app's name, colour, navigation and row height. People: add a person, rename them,
  change what kind of person they are, remove them, and choose which kinds of people may open Settings. Stages: what
  each stage is called. Formats: currency, thousands and decimal marks, date style, 12 or 24 hour clock and the day
  the week starts on. Pages: the page each kind of person lands on and the view each list opens in. Data: remove or
  add back the demo data, download or restore the database, and Start over. Each choice applies at once with no
  agent run, is kept with the app (so a share link, a release and an earlier version carry it), and is noted for the
  next release. The builder has a Settings button above the app that opens the page as someone who may.

## [0.5.8] - 2026-11-28

Built apps work things out: calculated fields, rules, moves with a condition, locked stages, and four new samples.

### Added

- Built apps can work things out. A field can be calculated from a formula (a line total, an order total from its
  lines, what is left of a budget), a rule can refuse a save with a plain sentence, a move can be held back until a
  condition is met or a field is filled in, and a stage can lock its records. The Planner writes these into the plan,
  and the plan screen lists them under "What the app works out and checks".
- Record pages show a stage path, the worked-out numbers, and linked records as lines with totals. The overview
  starts with "Waiting for you": the records the signed-in person can take forward.
- Four saved builds that use all of it, under "Apps that work things out" on Home: Order desk with budgets, Vet
  practice, Project planner and Service dispatch.

- Fourteen fields fit in one list of a plan (ten before), and a built table keeps sixteen.

### Fixed

- Found by building four free-text prompts on the real model: a condition from the plan lands on the move it belongs
  to when two moves join the same stages; a walkthrough booking that hits a taken time moves to the next free day; a
  step that adds a line joins the record the walkthrough just made; a move step always moves the record with stages;
  a test case the app refuses by one of its own approved rules is withdrawn instead of being sent for repair.
- A change through the chat cannot rename or remove a field that a formula, rule or condition reads. It says what
  reads the field.

## [0.5.7] - 2026-11-27

Built apps look like Fluent 2 products.

### Changed

- Built apps follow Fluent 2 the way Planner, Lists and Power Apps do. The page is grey and everything on it is a
  raised white surface instead of an outlined box. Navigation rows are neutral, and the open page carries a short
  accent bar and an accent icon; pages across the top are a bar of underlined tabs under the header, no longer
  buttons on the brand colour. The person menu in the header is plain text on the brand colour, not a white box.
  List pages get a command bar (underlined view tabs, quiet Filter and Copy CSV), a quiet header row, 44 px rows and
  the first column as the record's name. Dashboards, boards, the calendar, the record pane, sign-in and the
  first-use cards use the same surfaces, in light, dark and on a phone.
  ([#283](https://github.com/ismaeel-ch/Turnkey/pull/283))

## [0.5.6] - 2026-11-27

The workspace follows Fluent 2's type ramp, corner radii and control sizes.

### Changed

- Text sizes and corner radii across the welcome, Home, questions, plan, build steps, Release and Details screens
  are steps of Fluent 2's ramps: captions are 12 px, body text is 14 px. The Home prompt has one frame, and main
  actions such as "Build this app" and "Open the app" are standard size.
  ([#286](https://github.com/ismaeel-ch/Turnkey/pull/286))

### Fixed

- In dark, the step markers on Release and a title bar tab under the pointer no longer turn pure black.
  ([#286](https://github.com/ismaeel-ch/Turnkey/pull/286))

## [0.5.5] - 2026-11-27

A release now reaches every browser on its next visit, a built app can be changed and released from the agents chat,
the agents at work are shown in a new way, and smaller fixes.

### Added

- The agents chat can change a built app and release it: say "release" and a card offers the version, the kind of
  change, what new people start with and the notes. After a release, a change typed in chat gets questions and a plan
  first. ([#275](https://github.com/ismaeel-ch/Turnkey/pull/275))

### Changed

- The agents chat, the Meeting view, the Timeline and the Log are redesigned. Under the chat's title a strip says
  who is working on what, with one segment per step. An agent's turn reads as one block, a thin line marks each
  handover, cards are white Fluent cards, and the message box is one framed field with a note that agents can make
  mistakes. The Meeting view shows a card per agent with its state, what it is doing and how long it worked, next
  to the build line as a rail. The Log is a feed down one rail instead of a table.
  ([#284](https://github.com/ismaeel-ch/Turnkey/pull/284))
- The welcome note no longer names the organiser, and the docs have a demo video script.
  ([#271](https://github.com/ismaeel-ch/Turnkey/pull/271))

### Fixed

- A browser that visited before gets the new version on its next visit (the offline copy is used only when there is
  no network), and a tab left open shows an Update button when a new version is out. Before, the first visit after a
  release still showed the previous version. ([#277](https://github.com/ismaeel-ch/Turnkey/pull/277))
- Views: the clinic's demo visit notes match their appointments, an empty calendar month points to the next record,
  timeline labels stay readable over the Today line, and on phones the pivot's Total row and the timeline scroll
  sideways instead of piling up. ([#273](https://github.com/ismaeel-ch/Turnkey/pull/273))
- Guided build: no empty gap above the onboarding form on phones, the stage arrows in the plan end each wrapped line,
  and a step's status badge stays on the right. ([#281](https://github.com/ismaeel-ch/Turnkey/pull/281))

## [0.5.4] - 2026-11-27

A tidier row of view tabs on every list page of a built app, fixes found by ten more real builds on new sentences,
and plain words with a way on to Demo when no model can be reached.

### Fixed

- The More views button is a small square like the tabs instead of a wide framed box, the tabs lose their heavy
  outline and scroll sideways instead of wrapping, Filter and Copy CSV sit on the same row as the tabs, and the
  search box shows its icon again. ([#267](https://github.com/ismaeel-ch/Turnkey/pull/267))
- Live builds on new sentences: charts of amounts add them up instead of counting rows, a walkthrough step that
  says someone cannot see other people's records passes when their list leaves those records out, two pages never
  share a name, and a model answer that corrects itself is read without a repair call.
  ([#270](https://github.com/ismaeel-ch/Turnkey/pull/270))
- When no model can be reached, the guided questions and a failed build say why in plain words and offer "Use Demo
  instead". A busy model provider counts as busy, and the bars over Build no longer hide their buttons under the
  canvas. ([#265](https://github.com/ismaeel-ch/Turnkey/pull/265))

## [0.5.3] - 2026-11-27

Changing a built app and putting out a new version is easy to find and always possible.

### Fixed

- The Release page always offers the next version. With nothing changed since the last release it says how to get
  to the next one, and "Release again without changes" lets the owner release anyway once they say why. The box for
  asking a change is there before version 1.0 too, the finished build has a "Change something" button that opens
  it, and the Help guide no longer points at a button that was not there. ([#259](https://github.com/ismaeel-ch/Turnkey/pull/259))

## [0.5.2] - 2026-11-27

A faster first visit on phones, the expense manager as a sample, fairer Live builds, a guided flow that keeps the
keyboard's place, and the Your apps cards fixed.

### Added

- The expense manager is a guided Demo sample, with different plans for "Just me" and for a company. ([#247](https://github.com/ismaeel-ch/Turnkey/pull/247))

### Changed

- On a first visit the server draws the whole welcome screen, and the workspace loads on the first tap. Phone
  Lighthouse goes from about 58 to 95-99. ([#249](https://github.com/ismaeel-ch/Turnkey/pull/249)) ([#254](https://github.com/ismaeel-ch/Turnkey/pull/254))
- Each visitor gets a share of the daily model budget, so one person cannot pause Live for everyone. ([#244](https://github.com/ismaeel-ch/Turnkey/pull/244))
- Guided Live builds waste fewer retries: the View advisor is told which views fit each table, and the Tester can
  change and delete records and drops cases no change could fix. ([#252](https://github.com/ismaeel-ch/Turnkey/pull/252))

### Fixed

- Each card under Your apps is one line again: logo and name on the left, the share, duplicate and delete buttons
  side by side, and a long description cut short. The Pages list and the Release summary cards had the same fault. ([#256](https://github.com/ismaeel-ch/Turnkey/pull/256))
- The guided build flow keeps the keyboard's place: each new part takes the focus, the first-use tour keeps Tab
  inside its bubble, and the build's steps announce a pause and the finish. ([#246](https://github.com/ismaeel-ch/Turnkey/pull/246))
- A one-person app's tour no longer expects someone to be refused, and the expense manager is proven on the real
  model. ([#250](https://github.com/ismaeel-ch/Turnkey/pull/250))

## [0.5.1] - 2026-11-27

Polish on the guided build: one name per agent, Demo builds that do what their plan says, a faster first load, and
Try a sample through the questions and plan.

### Added

- Release one change on its own while the rest of the draft waits. ([#231](https://github.com/ismaeel-ch/Turnkey/pull/231))
- Try a sample asks its one question and shows the plan before it builds the sales bidding desk. ([#236](https://github.com/ismaeel-ch/Turnkey/pull/236))

### Changed

- Every agent goes by the name the plan gives it, everywhere: Planner, List builder, Rules builder, View advisor,
  Screen designer, Tester, Access checker and List checker. A Demo build started from its plan runs the reviews and
  the pause that plan lists. ([#240](https://github.com/ismaeel-ch/Turnkey/pull/240))
- The first page load is 496 KB instead of 590 KB: saved builds and screens opened on demand load on first use. ([#238](https://github.com/ismaeel-ch/Turnkey/pull/238))
- The README, the judge walk and the submission lead with the guided build. ([#234](https://github.com/ismaeel-ch/Turnkey/pull/234)) ([#242](https://github.com/ismaeel-ch/Turnkey/pull/242))

### Fixed

- Five fixes in the guided flow: rules for people an answer removed, the steps bar on phones, a pause opening the
  chat over the steps on phones, the agents panel log scrolling, and plain words in first-release notes. ([#233](https://github.com/ismaeel-ch/Turnkey/pull/233))
- Saved runs follow field renames, for every app with a team. ([#230](https://github.com/ismaeel-ch/Turnkey/pull/230))
- The live site check walks the rest of the guided flow. ([#228](https://github.com/ismaeel-ch/Turnkey/pull/228))

## [0.5.0] - 2026-11-27

The guided build. Turnkey asks a few questions, shows a plan in plain words, builds exactly that plan with a team
picked for it, and lets the owner remove the demo data, hand the app to its first users, and fix or extend it after
the first release.

### Added

- Before a Live build Turnkey asks up to five questions (who it is for, approvals, who sees what, demo data), each
  with the usual choice marked, then shows the plan: people, lists and fields, stages, who can do what, and what is
  not in this version. The build starts when the owner approves it. ([#214](https://github.com/ismaeel-ch/Turnkey/pull/214)) ([#223](https://github.com/ismaeel-ch/Turnkey/pull/223)) ([#225](https://github.com/ismaeel-ch/Turnkey/pull/225))
- The Planner: the agent that reads the sentence, writes the questions and the plan, and replaces the Researcher's
  call in a planned build. The plan is one shared type with its own checks. ([#205](https://github.com/ismaeel-ch/Turnkey/pull/205)) ([#211](https://github.com/ismaeel-ch/Turnkey/pull/211))
- A build follows the plan the owner approved. The lists and fields are held to it, the team is picked by code from
  it (five agents for a personal tracker, seven for a company app, never more than eight), and apps for one person
  and apps with no stages build end to end. ([#221](https://github.com/ismaeel-ch/Turnkey/pull/221))
- Demo data is marked, can be removed in one step, and never takes the owner's own records with it. ([#216](https://github.com/ismaeel-ch/Turnkey/pull/216))
- First use of a built app: choose who you are, a welcome, a short tour, a checklist, and screens that say what to
  do when they are empty. ([#215](https://github.com/ismaeel-ch/Turnkey/pull/215))
- After a release the owner says what is wrong or missing and gets a plan before anything changes; only the steps
  the change needs run again. ([#224](https://github.com/ismaeel-ch/Turnkey/pull/224))
- Release 1.0 asks what people start with (empty, demo data or the owner's records), and the Release page says what
  is live and what is in the draft. ([#218](https://github.com/ismaeel-ch/Turnkey/pull/218))

### Changed

- Build opens on a plain list of steps; the workflow canvas is behind "Show how it was built". Saved builds show
  their plan in the same words, and an app with no stages no longer reads "0 stages". ([#209](https://github.com/ismaeel-ch/Turnkey/pull/209)) ([#220](https://github.com/ismaeel-ch/Turnkey/pull/220))
- Going back a version or updating keeps every record, and installed apps find updates by themselves. ([#207](https://github.com/ismaeel-ch/Turnkey/pull/207))
- The cost line of a planned build counts the Planner's own calls. ([#226](https://github.com/ismaeel-ch/Turnkey/pull/226))

## [0.4.7] - 2026-11-27

A faster first load, a UI pass over the newest features, and steadier CI.

### Changed

- The debug drawer and the meeting view load the first time they open, not with the page. ([#202](https://github.com/ismaeel-ch/Turnkey/pull/202))
- The first page loads faster on a phone. The welcome screen shows without waiting for the SQLite engine, which is
  fetched once that screen is up; the icon symbols ship once instead of twice; React Flow loads after the first
  screen. Lighthouse on a simulated phone: largest paint 7.9 s to about 6.2 s, page JavaScript
  592 KB to 563 KB gzip. The feature guide loads the first time it opens. ([#201](https://github.com/ismaeel-ch/Turnkey/pull/201))

### Fixed

- UI pass over the features merged overnight: the dark mode switch, dropdown borders, the Look menu, and phone
  layouts. ([#199](https://github.com/ismaeel-ch/Turnkey/pull/199))

### Tests

- CI retries the browser install, and the command palette checks wait for it to open. ([#195](https://github.com/ismaeel-ch/Turnkey/pull/195))

## [0.4.6] - 2026-11-27

Edit fields on the Data page, change an app's look on the App page, and visual regression tests.

### Added

- Edit fields on the Data page; only the stations the edit touches run again. ([#192](https://github.com/ismaeel-ch/Turnkey/pull/192))
- Change the app's look on the App page; Rename follows the same busy rules. ([#194](https://github.com/ismaeel-ch/Turnkey/pull/194))

### Fixed

- Run again waits while the app's own agent team is running, and says why. ([#170](https://github.com/ismaeel-ch/Turnkey/pull/170))
- The Tester passes a denied step on 404 only when the record itself is not found; link-preview lookups are cached
  and capped. ([#187](https://github.com/ismaeel-ch/Turnkey/pull/187))

### Changed

- The docs and the Judge walk cover Try a sample, the Meeting view and canvas edits. ([#196](https://github.com/ismaeel-ch/Turnkey/pull/196))

### Tests

- Visual regression tests: 22 screenshots of the main screens, desktop and phone, light and dark, compared in CI.
  ([#138](https://github.com/ismaeel-ch/Turnkey/pull/138))

## [0.4.5] - 2026-11-27

The agents shown as a meeting, and Live Tester fixes.

### Added

- The agents can be shown as a Teams-style meeting. ([#191](https://github.com/ismaeel-ch/Turnkey/pull/191))

### Fixed

- The Live Tester fills in skipped workflow steps and treats "cannot see" on a closed table as passing. ([#183](https://github.com/ismaeel-ch/Turnkey/pull/183))

### Tests

- The production smoke test makes one Microsoft Learn search through the site's connector route.

## [0.4.4] - 2026-11-27

Drag workflow steps from a palette, a Tester fix for hidden records, and phone layout fixes.

### Added

- Drag workflow steps onto a gate from a palette above the canvas. ([#140](https://github.com/ismaeel-ch/Turnkey/pull/140))
- A Microsoft Learn connector, called through its keyless MCP server. ([#188](https://github.com/ismaeel-ch/Turnkey/pull/188))
- Team runs show what their model calls cost; unpriced models count toward the daily cap. ([#185](https://github.com/ismaeel-ch/Turnkey/pull/185))

### Fixed

- The Tester counts a record hidden from a person as refused, so a correct access test no longer fails with 404;
  two React key warnings are gone. ([#179](https://github.com/ismaeel-ch/Turnkey/pull/179))
- Phone: Build numbers sit in two rows, and the page scrolls past toasts. ([#181](https://github.com/ismaeel-ch/Turnkey/pull/181))

## [0.4.3] - 2026-11-26

Link previews, retries for public sources, better charts in built apps, and layout fixes on phones and tablets.

### Added

- Link previews for Turnkey and for shared apps, plus robots.txt and a sitemap. ([#173](https://github.com/ismaeel-ch/Turnkey/pull/173))
- Public sources are retried with backoff, and the app says plainly when one is down. ([#136](https://github.com/ismaeel-ch/Turnkey/pull/136))

### Fixed

- Built apps read years as years, total rows average scores, and sparse charts draw columns. ([#174](https://github.com/ismaeel-ch/Turnkey/pull/174))
- Dialog layout, the Agents button over pages, and other UI issues. ([#135](https://github.com/ismaeel-ch/Turnkey/pull/135))
- The workflow canvas does not animate while it is hidden. ([#158](https://github.com/ismaeel-ch/Turnkey/pull/158))
- A share save that wrote nothing gives its place in the daily quota back. ([#160](https://github.com/ismaeel-ch/Turnkey/pull/160))

### Changed

- README has fresh screenshots of the Fluent UI and a demo GIF from sentence to app; the README demo path runs as
  a scripted check with screenshots. ([#167](https://github.com/ismaeel-ch/Turnkey/pull/167)) ([#165](https://github.com/ismaeel-ch/Turnkey/pull/165))
- The workspace drops its lint exemption block and unnecessary type casts. ([#162](https://github.com/ismaeel-ch/Turnkey/pull/162))

### Tests

- The new features are checked at phone and tablet sizes. ([#169](https://github.com/ismaeel-ch/Turnkey/pull/169))

## [0.4.2] - 2026-11-26

Undo, redo and version history, a command palette, and the cost of each run and agent.

### Added

- Undo, redo and version history for an app. ([#150](https://github.com/ismaeel-ch/Turnkey/pull/150))
- A command palette (Ctrl/Cmd+K) and keyboard shortcuts. ([#146](https://github.com/ismaeel-ch/Turnkey/pull/146))
- Each run and each agent shows what it spent: tokens, cache hits and cost. ([#152](https://github.com/ismaeel-ch/Turnkey/pull/152))

### Fixed

- Undo, redo, new versions and automatic re-runs wait while the app's own agent team is running. ([#155](https://github.com/ismaeel-ch/Turnkey/pull/155)) ([#156](https://github.com/ismaeel-ch/Turnkey/pull/156))
- A call whose provider reports no usage still counts toward the daily dollar cap. ([#153](https://github.com/ismaeel-ch/Turnkey/pull/153))
- The server stops the upstream model stream when the reader leaves early. ([#144](https://github.com/ismaeel-ch/Turnkey/pull/144))
- On-demand chunks are kept offline, so a Demo build runs with no connection. ([#148](https://github.com/ismaeel-ch/Turnkey/pull/148))

### Changed

- More workspace modules are typed (runtime, views, room), with typed store actions and strict lint. ([#85](https://github.com/ismaeel-ch/Turnkey/pull/85)) ([#154](https://github.com/ismaeel-ch/Turnkey/pull/154))

## [0.4.1] - 2026-11-26

Live builds pass on a real model, each agent role uses the model that fits it, and the first page load is back under
its size budget.

### Fixed

- Live builds on a real model finish with every test passing: the test runner picks the person a test names, a
  refused workflow step counts as a refusal, and the Backend repair can grant "see their own" access without
  repeating fixes it already tried. ([#141](https://github.com/ismaeel-ch/Turnkey/pull/141))
- The first page load is back under the bundle budget: zod no longer loads with the page and React Flow loads on
  first use. ([#139](https://github.com/ismaeel-ch/Turnkey/pull/139))

### Changed

- Researcher, Database and Backend use Sonnet; views, screens, tour, Tester, repairs, reviews and chat changes use
  Haiku (`LLM_QUICK_ROLES` changes the list). Daily caps reset at midnight UTC and the cap message says what still
  works; output tokens default to 16,000. ([#141](https://github.com/ismaeel-ch/Turnkey/pull/141))
- CSS rules for classes nothing renders are removed. ([#126](https://github.com/ismaeel-ch/Turnkey/pull/126))

### Tests

- The production smoke test checks the model badge on the first screen and runs one Live build of the clinic sample
  when a model is connected. ([#131](https://github.com/ismaeel-ch/Turnkey/pull/131))

## [0.4.0] - 2026-11-26

Agent attribution on the canvas, one deliverable document per app, targeted re-runs after a workflow edit, and
spending caps.

### Added

- Export a built app as one deliverable document. ([#122](https://github.com/ismaeel-ch/Turnkey/pull/122))
- The canvas shows which agent made or last changed each table, field and screen. ([#114](https://github.com/ismaeel-ch/Turnkey/pull/114))
- After a workflow edit, only the affected stations re-run, debounced. ([#109](https://github.com/ismaeel-ch/Turnkey/pull/109))
- A daily dollar cap on model calls and daily limits on short-link saves. ([#110](https://github.com/ismaeel-ch/Turnkey/pull/110)) ([#113](https://github.com/ismaeel-ch/Turnkey/pull/113))
- Every API request is logged as structured JSON with its model cost. ([#94](https://github.com/ismaeel-ch/Turnkey/pull/94))
- Live also checks that Turnkey's own server answers. ([#124](https://github.com/ismaeel-ch/Turnkey/pull/124))
- An error in one part of the workspace shows a plain message with Try again instead of taking down the page.
  ([#125](https://github.com/ismaeel-ch/Turnkey/pull/125))
- The accessibility flow covers every screen, light and dark, and 390 px wide, with the fixes it found.
  ([#130](https://github.com/ismaeel-ch/Turnkey/pull/130))

### Changed

- LangGraph and the AG-UI client load on first use, with a bundle-size budget in CI. ([#81](https://github.com/ismaeel-ch/Turnkey/pull/81))
- Review steps move into their own module; store actions in the shell modules; stricter lint rules for typed code.
  ([#108](https://github.com/ismaeel-ch/Turnkey/pull/108)) ([#112](https://github.com/ismaeel-ch/Turnkey/pull/112)) ([#119](https://github.com/ismaeel-ch/Turnkey/pull/119))
- Unused workspace exports removed. ([#115](https://github.com/ismaeel-ch/Turnkey/pull/115))
- README, architecture and submission text refreshed; a pre-submission audit, an up-to-date SECURITY.md and a lint
  rule for server imports. ([#116](https://github.com/ismaeel-ch/Turnkey/pull/116)) ([#120](https://github.com/ismaeel-ch/Turnkey/pull/120))

### Tests

- The production smoke test also runs as a browser flow, with a manual live-site check. ([#118](https://github.com/ismaeel-ch/Turnkey/pull/118))

## [0.3.2] - 2026-11-26

Short links work with Vercel's new Blob connection, the agent route has more guard rails, and each release is
smoke-tested on the live site.

### Fixed

- Short links turn on with Vercel's new Blob connection (`BLOB_STORE_ID`, signed in with the deployment's token).
  ([#101](https://github.com/ismaeel-ch/Turnkey/pull/101))
- The workspace no longer crashes on load in development. ([#99](https://github.com/ismaeel-ch/Turnkey/pull/99))

### Changed

- The agent route applies the prompt policy, refuses cross-site calls and caps run bodies. ([#79](https://github.com/ismaeel-ch/Turnkey/pull/79))
- Each release is smoke-tested on the live site after it deploys. ([#92](https://github.com/ismaeel-ch/Turnkey/pull/92))
- The judges' first run is smoother, and a demo video script is added. ([#88](https://github.com/ismaeel-ch/Turnkey/pull/88))
- Dead exports, files and two unused dependencies are removed, with knip to find more. ([#90](https://github.com/ismaeel-ch/Turnkey/pull/90)) ([#100](https://github.com/ismaeel-ch/Turnkey/pull/100)) ([#102](https://github.com/ismaeel-ch/Turnkey/pull/102))
- More types in tests and share, with fewer casts. ([#95](https://github.com/ismaeel-ch/Turnkey/pull/95))

### Added

- Two new saved builds: a grant review desk with its own agent team, and purchase requests. ([#107](https://github.com/ismaeel-ch/Turnkey/pull/107))
- Phone and tablet layouts are polished, with a browser flow for screen sizes. ([#105](https://github.com/ismaeel-ch/Turnkey/pull/105))
- The workspace shell (shell-a, shell-b, shell-c) is typed. ([#80](https://github.com/ismaeel-ch/Turnkey/pull/80))

### Tests

- Short links against a fake Blob service; model gateway edge paths, team runner stops and routes with no model.
  ([#97](https://github.com/ismaeel-ch/Turnkey/pull/97)) ([#103](https://github.com/ismaeel-ch/Turnkey/pull/103))

## [0.3.1] - 2026-11-26

Picks up the production settings for the Claude API key and the short-link store, with typing and Fluent UI work.

### Changed

- More workspace modules are typed: the engine, the app definition, view specs, changes, UI, tester, activity and
  guide. ([#70](https://github.com/ismaeel-ch/Turnkey/pull/70)) ([#74](https://github.com/ismaeel-ch/Turnkey/pull/74)) ([#75](https://github.com/ismaeel-ch/Turnkey/pull/75)) ([#76](https://github.com/ismaeel-ch/Turnkey/pull/76))
- More of the workspace uses Fluent UI inputs, selects, text areas, chips and cards. ([#71](https://github.com/ismaeel-ch/Turnkey/pull/71)) ([#72](https://github.com/ismaeel-ch/Turnkey/pull/72))
- The deploy log lists the names of the production settings Vercel provides. ([#73](https://github.com/ismaeel-ch/Turnkey/pull/73))

## [0.3.0] - 2026-11-26

Live builds run on the server through the agent workflow, the workspace moves to Fluent UI, and shared apps get
short links.

### Added

- Each agent's steps are shown in an activity panel, with a "How it works" page. ([#58](https://github.com/ismaeel-ch/Turnkey/pull/58))
- Live builds run on the server step agent over AG-UI, and every build goes through the workflow graph.
  ([#60](https://github.com/ismaeel-ch/Turnkey/pull/60)) ([#48](https://github.com/ismaeel-ch/Turnkey/pull/48))
- An app's agent team runs as a LangGraph run on the server, and runs in Live. ([#35](https://github.com/ismaeel-ch/Turnkey/pull/35)) ([#52](https://github.com/ismaeel-ch/Turnkey/pull/52))
- Short links for shared apps. ([#63](https://github.com/ismaeel-ch/Turnkey/pull/63))
- The workspace is stored in IndexedDB, with .sqlite export and import, backup and restore. ([#53](https://github.com/ismaeel-ch/Turnkey/pull/53))

### Changed

- The workspace UI is built on Fluent UI React v9, including tabs, switches, message bars and menus. ([#44](https://github.com/ismaeel-ch/Turnkey/pull/44)) ([#62](https://github.com/ismaeel-ch/Turnkey/pull/62))
- A Claude API key is the deployed model backend. ([#66](https://github.com/ismaeel-ch/Turnkey/pull/66))
- The workspace data modules are typed, with a store hook. ([#56](https://github.com/ismaeel-ch/Turnkey/pull/56))

### Tests

- Unit tests and coverage for the foundation code, and a fix for the model-client tests. ([#22](https://github.com/ismaeel-ch/Turnkey/pull/22)) ([#64](https://github.com/ismaeel-ch/Turnkey/pull/64))

## [0.2.0] - 2026-11-26

The first release deployed by the release workflow. The `v0.1.0` tag was published as a pre-release and never
deployed, so this release also carries the changes merged just before it.

### Changed

- The workspace is real React modules; the legacy layer that ran the prototype's plain scripts is gone.
  ([#42](https://github.com/ismaeel-ch/Turnkey/pull/42))
- The model gateway accepts any OpenAI-compatible key and can use the Claude Code CLI for local runs.
  ([#41](https://github.com/ismaeel-ch/Turnkey/pull/41))
- CI runs only on pull requests labelled `ready-to-merge`; production deploys only on a release; Dependabot is off.
  ([#40](https://github.com/ismaeel-ch/Turnkey/pull/40))
- A release is made by merging a version bump in `package.json`, which deploys and then creates the tag and the
  GitHub release. CI shows as skipped, not failed, on pull requests without the label
  and on runs replaced by a newer one.
  ([#43](https://github.com/ismaeel-ch/Turnkey/pull/43))

## [0.1.0] - 2026-11-26

The React foundation: the prototype's workspace runs unchanged inside the Next.js app, with a model route and CI.

### Added

- The prototype's workspace modules run in Next.js 16 and React 19 through a compatibility layer, with all 286
  browser checks passing against the React app. ([#20](https://github.com/ismaeel-ch/Turnkey/pull/20))
- A model route (`POST /api/llm`) and a health route, so Live mode works once a key is set on Vercel.
  ([#20](https://github.com/ismaeel-ch/Turnkey/pull/20))
- Continuous integration: a secrets scan, lint, typecheck, unit tests, a production build, and one browser job per
  flow. ([#20](https://github.com/ismaeel-ch/Turnkey/pull/20))
- Shared dependencies are installed once for parallel work, and a runbook for that work is added.
  ([#21](https://github.com/ismaeel-ch/Turnkey/pull/21))
