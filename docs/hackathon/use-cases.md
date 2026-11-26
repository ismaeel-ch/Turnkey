# Use cases

This page says what Turnkey builds for the three suggested quests, for a sales bidding desk, and where a team at SSI
or a client could use it. Claims are kept to what can be checked in the repository or in the live app
(https://turnkey-bay.vercel.app/). Updated after release v0.3.2.

Turnkey is the "bring your own idea" entry: an agent team that builds business apps. The quest apps below are not
separate programs. Each one is built by Turnkey's builder agents from one sentence, and each has an agent team of its
own that works inside the finished app. The sentence, the roles, the tables and the team for each are saved builds in
`src/workspace/quests.ts` and `src/workspace/builds.ts`, so an evaluator can open them in Demo mode with no model.

## What every built app has

- A SQLite database with tables, made-up seed data and users for each role.
- Role-guarded endpoints, with rules tested for every role.
- Views (table, board, calendar, timeline, chart, pivot, tree, cards), a dashboard, forms and screens for each role.
- A guided tour that is replayed as an acceptance test, and test cases written by the Tester.
- A workflow (statuses and who may move a record between them).
- Releases (a numbered version, only when every test passes) and a share link.

## The three quests as three apps

In all three, the app's agents write to the app's own tables through its own API, as the person who pressed Run. The
access rules therefore apply to them. In Demo the run replays a saved script; in Live each agent makes its own model
call. Evidence and prior work in Demo are saved samples, not real citations: the apps and the About dialog say so.
In Live the team runs on the server and its agents look these sources up through the connectors (`src/server/connectors`), with a reviewer check after each agent.

### 1. Fact-check desk

For: an editorial or communications team that checks a draft before it goes out.

| Part     | What it is                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Roles    | Editor (sends in text, runs the agents), Senior editor (corrects verdicts, publishes the check), Reader (reads checks and evidence)                                                                                                                                                                          |
| Records  | checks, claims, evidence                                                                                                                                                                                                                                                                                     |
| Workflow | a check moves from queued to checking to checked to published                                                                                                                                                                                                                                                |
| Team     | **Extractor** splits the text into factual claims and leaves opinions out. **Researchers** look for evidence for each claim (tools: Wikipedia, World Bank). **Verifier** weighs the evidence and gives each claim a verdict and a confidence from 0 to 100. Thin evidence means "unverifiable", not a guess. |
| Handoff  | claims, then evidence linked to the claims, then verdicts written back onto the claims and a summary onto the check                                                                                                                                                                                          |
| Where    | in the app: the **Check room**. Saved runs: Company blog draft, Science class handout, Travel article                                                                                                                                                                                                        |

### 2. Prior-art scout

For: an inventor and an IP reviewer deciding whether an idea is worth pursuing.

| Part    | What it is                                                                                                                                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles   | Inventor (describes an idea, runs the scout), IP reviewer (reads every assessment, decides to pursue or shelve), Partner (reads assessments)                                                                                                               |
| Records | ideas, prior work, findings                                                                                                                                                                                                                                |
| Team    | **Search** looks for close work in patents, papers and preprints (tools: PatentsView, OpenAlex, arXiv). **Analyst** records what overlaps and what differs. **Critic** challenges the analysis, names risks and next steps, and rates how new the idea is. |
| Handoff | prior work, then findings that point at each piece of prior work, then risks, next steps and a novelty rating on the idea                                                                                                                                  |
| Where   | in the app: the **Scout room**. The prior work in the saved runs is illustrative, with codes that start with `SAMPLE-`                                                                                                                                     |

### 3. Skeptical debate partner

For: anyone about to make a decision who wants the case made against it before they commit.

| Part              | What it is                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles             | Team member (raises a motion, runs the debate, adds points), Facilitator (records the decision, parks or reopens a debate), Observer (reads)                                                                                                                                                |
| Records           | debates (the motion), arguments, takeaways. A debate moves from open to debating to summed up to decided or parked                                                                                                                                                                          |
| Team              | **For** makes the strongest honest case for the motion in three points. **Against** makes the case against and answers the points made for. **Moderator** weighs both sides and anything added from the floor, then records what is agreed, what is open, the risks and one recommendation. |
| Handoff           | arguments (Against replies to For's points, so they form a tree), then the Moderator's takeaway                                                                                                                                                                                             |
| Human in the loop | the run pauses before the Moderator: "Add a point of your own before the Moderator sums up, or continue."                                                                                                                                                                                   |
| Where             | in the app: the **Debate room**, with For and Against face to face                                                                                                                                                                                                                          |

## The sales bidding desk

For: a sales team that answers tenders and requests for proposals.

| Part              | What it is                                                                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles             | Bid manager (records tenders, runs the bid team), Sales director (approves or declines bids, records the result), Finance analyst (reads everything, changes nothing)                                                                                                                                            |
| Records           | tenders, score lines, price options, risks                                                                                                                                                                                                                                                                       |
| Workflow          | new, assessing, assessed, approved, won, lost, no bid. The agents take a tender from new to assessed. The director approves or declines, and later records the result                                                                                                                                            |
| Team              | **Qualifier** scores the tender 0 to 5 on fit, capacity, relationship, competition and time. **Pricing** works out three prices with margin and chance of winning and marks one as recommended. **Red team** challenges the bid (strengths, risks, conditions) and gives a go or no-go with a chance of winning. |
| Human in the loop | the run pauses before the Red team so a person can add a risk or a condition                                                                                                                                                                                                                                     |
| Also shows        | the Tester catching a planted mistake: the saved Backend answer lets bid managers delete tenders, which the brief forbids. The Tester's case fails, the Backend agent is asked to repair it, and the repair is applied only if every check still passes. Build tab, **Tests**.                                   |

Clients, tenders and prices in this app are made up.

## The grant review desk

For: a community foundation, or any team that gives money against applications.

| Part              | What it is                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles             | Programme officer (records applications, runs the review team), Board chair (approves every grant), Trustee (reads everything)                                                   |
| Records           | applications, score lines, award options, checks                                                                                                                                 |
| Workflow          | from received, through review, to awarded, declined or paid; the board chair decides                                                                                             |
| Team              | **Assessor** scores the application, **Budget reviewer** sizes the award options and marks one as recommended, **Due diligence** checks it and gives fund, fund less or decline. |
| Human in the loop | the run pauses before Due diligence so a person can add a condition                                                                                                              |

Applications and organisations in this app are made up. Saved build: `src/workspace/samples.ts`, next to a plain
purchase-requests app where nothing is ordered without approval.

## Where an SSI team or a client could use Turnkey

These are places where the pattern fits, not claims about any existing deployment. Turnkey's output is a prototype with
browser-side data. Each item says what would have to be true.

| Situation                                                                                             | What Turnkey gives them                                                                                        | What must be true first                                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A team wants to try an internal tool (a register, tracker or approval flow) before asking for a build | Describe it, watch the agents build it, click through it as each role, change it from chat, share it by link   | It is a prototype to learn from. Production data needs a server-side store, which Turnkey does not provide yet (ADR 1) |
| A pre-sales conversation where a client's process is described but not yet scoped                     | A working draft of the client's workflow and access rules in minutes, with test cases that state the rules     | The draft is made from the description only; real requirements still need a conversation                               |
| Checking who may do what in a workflow                                                                | The access matrix is tested for every role and shown in Details, API                                           | The rules are those the description gave; someone must read them                                                       |
| Bid or tender review in a sales team                                                                  | The bidding desk pattern: scoring, three price options, a red team, a director's approval                      | The scoring criteria and price rules are placeholders to replace with the team's own                                   |
| Reviewing drafts before they are published                                                            | The fact-check pattern: claims, evidence, verdicts, a senior editor's sign-off                                 | In Live the evidence comes from public sources; a team's own sources would need a new connector                        |
| Early idea screening                                                                                  | The prior-art pattern: close work, overlap, risks, a novelty rating                                            | It is a first screen, not a legal opinion; PatentsView, OpenAlex and arXiv lookups help, and a person still reviews    |
| Stress-testing a decision                                                                             | The debate pattern: the case for, the case against, a moderator's recommendation, a point added from the floor | The agents argue from what the model knows                                                                             |
| Teaching how agents are orchestrated                                                                  | Every handoff, check, send-back and approval is visible and replayable in Demo with no model                   | None                                                                                                                   |

## How to see all of this in two minutes

1. Open https://turnkey-bay.vercel.app/ with Live off (Demo).
2. Pick "Sales bidding desk". Watch Build, Workflow: each agent, the check after it, the approval the owner placed.
   Open **Tests** to see the Tester's failing case and the Backend's repair.
3. Open the **App** tab, sign in as a Bid manager, open the Bid room, pick a saved case and press Run. Watch the three
   agents write rows. The run pauses before the Red team.
4. Ask the chat for a change ("Add a notes field to score lines"). The plan card shows which stations re-run.
5. In the title bar open Debug mode to see the events, tool calls and model usage (samples in Demo).
