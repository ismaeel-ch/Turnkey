# Demo video: script and shot list

A three-minute screen recording for the submission and for anyone who cannot open the live app. It opens on the guided
build (a sentence, the Planner's question, the plan, the build, the app's first use, a fix released as 1.1) and then
shows the agents' teamwork in the Sales bidding desk. It follows the README's walk-through, so a judge who watches it
can repeat it. Everything is recorded in **Demo** mode (saved builds, no model calls), except one optional Live shot.

## Before recording

- Browser at 1440 × 900, zoom 100 %, light theme, no extensions or bookmarks bar in view.
- Open https://turnkey-bay.vercel.app/ in a fresh private window so the first-run screens appear. Keep a second
  private window ready for shots 9 to 13 (Try a sample needs the first screen again).
- Close notifications. Record the browser window only, with system audio off and a microphone for the voice-over.
- Do the walk once without recording. The clinic build takes about 20 seconds, the bidding desk about 30, the Bid room
  run about 25. The "Judge walk" action clicks through the same path and shows how long each step takes.
- If **Live** is on in the title bar after **Describe your own**, switch it off before typing, so the clinic sentence
  replays the saved build.
- Data on screen is made up. Do not open a tab with anything else in it.

## Script

Times are targets. The voice-over is written to be read at a normal pace; cut lines rather than speed up.

| #   | Time      | Shot (what is on screen)                                                                                                                                                                                                                           | Voice-over                                                                                                                                                                                          | Criterion it serves           |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | 0:00–0:10 | Welcome screen. Hold on the headline, then press **Describe your own**.                                                                                                                                                                            | "Most teams need small business apps: a clinic desk, a leave form, a helpdesk. Turnkey builds one from one sentence, and you don't need to know how apps are made."                                 | Business value                |
| 2   | 0:10–0:25 | Type `A clinic books appointments for patients with its doctors`, press Enter. The steps bar shows Questions; the Planner's card asks "Should the front desk be able to read visit notes?" with the usual choice marked.                           | "First, the Planner agent says what it understood and asks only what changes the app. Each question has a usual choice, and I can skip any of them."                                                | Creativity, human in the loop |
| 3   | 0:25–0:40 | Pick the usual choice, then "Yes, add demo data". The plan fills in: who uses it, what it keeps, how an appointment moves, who can see and do what, the agents that will build it.                                                                 | "The plan is in plain words: three kinds of people, three lists, six stages, and a table of who can see what. Code picks the team from the plan, and nothing is built until I say so."              | Multi-agent orchestration     |
| 4   | 0:40–1:00 | Press **Build it**. The seven steps turn from Working to Done, each with its agent; the chat fills with their cards. Hold on "CareDesk is built. Every check passes." and its **Open the app** and **Change something** buttons.                   | "Each agent does one job and hands it on. Code checks every hand-off: here the List builder's first try was sent back and fixed. All 142 checks pass before the app is called ready."               | Agents check each other       |
| 5   | 1:00–1:15 | **App** tab, sign in as Sara Malik. The welcome: "You are here as Receptionist", what she can do, **Show me around**. Press it and step through two stops of the tour.                                                                             | "The app greets each person for their own job and shows them around. The doctor and the manager get their own welcome."                                                                             | Completeness, end to end      |
| 6   | 1:15–1:25 | The demo data bar: **Remove demo data**, confirm. The bar says "Demo data removed. The lists are empty and ready for real records."                                                                                                                | "It starts with made-up records to try, marked Demo. One press clears them, and the app is ready for real work."                                                                                    | Business value                |
| 7   | 1:25–1:45 | **Release**: release version 1.0. Under "Something wrong, or something missing?", press **Add a notes field to patients**. The plan card ("New feature, becomes version 1.1"), then **Go ahead**; the Try it card appears.                         | "After the first release, I just say what's missing. I get a plan first, the change goes into a draft only I can see, and people keep version 1.0 meanwhile."                                       | Technical execution           |
| 8   | 1:45–1:55 | **It works**, **Release it as 1.1**. The release choice Fixes 1.0.1, New features 1.1, Big change 2.0; release. Scroll to Versions: 1.1 current, 1.0 with Go back to this, and above them the "Release a new version" card.                        | "When it works, it goes out as 1.1. Every version keeps its tests, I can go back, and the next change can start whenever I like."                                                                   | Live product                  |
| 9   | 1:55–2:05 | Second window: press **Try a sample**, take the usual choice, **Build it**. The bidding desk builds and stops once after the rules: press **Looks right, continue**. Then press **Show how it was built**: the workflow canvas, each node Checked. | "Here's the same machinery in more detail. Behind the steps is a LangGraph workflow I can edit, with a check gate after every agent."                                                               | Multi-agent orchestration     |
| 10  | 2:05–2:20 | The Tests node shows "try 2"; click it. Run 1, 1 of 170 failed; repaired; Run 2, all passed. Then **Meeting**: a tile per agent.                                                                                                                   | "The Tester caught the Rules builder letting a bid manager delete a tender, which the brief forbids. It was repaired and every test passes. The meeting view shows the one at work as the speaker." | Each agent's steps visible    |
| 11  | 2:20–2:40 | **App**, sign in as Sana Malik, **Bid room**: pick **Port fleet tracking**, **Run the agents**. Qualifier, Pricing, the pause on "Your turn"; Continue; Red team verdict.                                                                          | "Apps can have agent teams of their own. The Qualifier scores the tender, Pricing works out three prices, the run stops so a person can add a condition, and the Red team gives the verdict."       | Creativity, human in the loop |
| 12  | 2:40–2:52 | Bug icon in the title bar: the debug drawer with AG-UI events and tool calls.                                                                                                                                                                      | "Every step streams over AG-UI. Debug mode shows each event, tool call, SQL statement and model call."                                                                                              | Technical execution           |
| 13  | 2:52–3:00 | End card with the live URL and the repository.                                                                                                                                                                                                     | "Turnkey. Say what the work is, answer a few questions, get the whole app. It's live at turnkey-bay.vercel.app."                                                                                    | Presentation                  |

## Optional Live shot (only if the model budget allows)

Record separately and use it in place of shots 2 and 3 if it works first time. Leave **Live** on, open a new tab, and
type a short sentence the saved builds do not cover (for example "A gym tracks member check-ins and trainer
sessions"). The Planner model writes its own questions and plan (two model calls, 16 to 32 seconds each); show the
cards and the plan, press **Build it**, and show the first two steps with the Model calls counter going up. Do not
retry more than once: each Live session is capped at 40 calls and the budget covers judging too. Turn Live off again
afterwards.

## End card

- Turnkey, SSI Agent-A-Thon 2026
- https://turnkey-bay.vercel.app/
- https://github.com/ismaeel-ch/Turnkey

## Checks before uploading

- No key, gateway address, email address or real company data is visible in any frame, including the debug drawer.
- The video shows the same version that is deployed (`/api/health` commit matches the head of `main`).
- Length is at most three minutes; captions match the voice-over.
