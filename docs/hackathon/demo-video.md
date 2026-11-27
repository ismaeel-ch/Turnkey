# Demo video: script and shot list

A three-minute screen recording for the submission and for anyone who cannot open the live app. It opens on the guided
build (a sentence, the Planner's question, the plan, the build, the app's first use), then changes the app and releases
version 1.1 **from the chat sidebar** (typed words and the cards the agents put in the chat), and ends on the agents' teamwork in the Sales bidding desk. It follows the
README's walk-through, so a judge who watches it can repeat it. Everything is recorded in **Demo** mode (saved builds,
no model calls), except one optional Live shot.

A silent rough cut of the whole path (2 min 41 s, made by the judge walk below) and a screenshot for each shot are in
the project files under `submission/video/`. Watch it once before recording: it shows what each screen looks like and
where to click. It is a robot's pace, so record your own take at a person's pace with the voice-over.

## Before recording

- Browser at 1440 × 900, zoom 100 %, light theme, no extensions or bookmarks bar in view.
- Open https://turnkey-bay.vercel.app/ in a fresh private window so the first-run screens appear. Keep a second
  private window ready for shots 9 to 12 (Try a sample needs the first screen again).
- Close notifications. Record the browser window only, with system audio off and a microphone for the voice-over.
- Do the walk once without recording. The clinic build takes about 20 seconds, the bidding desk about 30, the Bid room
  run about 25. Cut the waits in editing, or talk over them.
- If **Live** is on in the title bar after **Describe your own**, switch it off before typing, so the clinic sentence
  replays the saved build.
- Data on screen is made up. Do not open a tab with anything else in it.

## Script

Times are targets. The voice-over is written to be read at a normal pace; cut lines rather than speed up. "Type" means
type exactly the text in the code span. The chat sidebar is the **Builders** panel on the right; its box says "Ask for a
change to the app or to the workflow".

| #   | Time      | Do (exact clicks and typing)                                                                                                                                                                                                                                                                          | On screen when you finish                                                                                                                                                                                                       | Voice-over                                                                                                                                                                                          | Criterion                     |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | 0:00–0:10 | Hold two seconds on the welcome screen, then press **Describe your own**. Check that **Live** in the title bar is off.                                                                                                                                                                                | An empty workspace with one big box.                                                                                                                                                                                            | "Most teams need small business apps: a clinic desk, a leave form, a helpdesk. Turnkey builds one from one sentence, and you don't need to know how apps are made."                                 | Business value                |
| 2   | 0:10–0:25 | Type `A clinic books appointments for patients with its doctors` and press Enter. Pause two seconds on the question card.                                                                                                                                                                             | Steps bar on **Questions**; on the right the Planner's card "Should the front desk be able to read visit notes?", with **Usual choice** marked.                                                                                 | "First, the Planner agent says what it understood and asks only what changes the app. Each question has a usual choice, and I can skip any of them."                                                | Creativity, human in the loop |
| 3   | 0:25–0:40 | Press **No. Notes stay with doctors and the manager**, then **Yes, add demo data**. Scroll the plan slowly once.                                                                                                                                                                                      | The plan for **CareDesk**: Who uses it, How an appointment moves, What it keeps, Who can see and do what; "Nothing is built until you press Build it."                                                                          | "The plan is in plain words: three kinds of people, three lists, six stages, and a table of who can see what. Code picks the team from the plan, and nothing is built until I say so."              | Multi-agent orchestration     |
| 4   | 0:40–1:00 | Press **Build it**. Let the seven steps run; the chat fills with each agent's cards.                                                                                                                                                                                                                  | "CareDesk is built. All 7 steps are done. Every check passes." with **142 checks pass**, **Open the app** and **Change something**.                                                                                             | "Each agent does one job and hands it on. Code checks every hand-off: here the List builder's first try was sent back and fixed. All 142 checks pass before the app is called ready."               | Agents check each other       |
| 5   | 1:00–1:15 | Press the **App** tab, then **Sara Malik**. Press **Show me around** and press **Next** twice.                                                                                                                                                                                                        | "Welcome, Sara. You are here as Receptionist", then the tour's pop-ups over the front desk board.                                                                                                                               | "The app greets each person for their own job and shows them around. The doctor and the manager get their own welcome."                                                                             | Completeness, end to end      |
| 6   | 1:15–1:25 | Press **Next** to the end of the tour. In the demo data bar above the app press **Remove demo data**, then **Remove demo data** in the dialog.                                                                                                                                                        | "Demo data removed. The lists are empty and ready for real records."                                                                                                                                                            | "It starts with made-up records to try, marked Demo. One press clears them, and the app is ready for real work."                                                                                    | Business value                |
| 7   | 1:25–1:45 | In the chat, press the **Release version 1.0** chip under the messages. On the release card press **Release version 1.0**. Then click the chat box, type `Add a notes field to patients` and press Enter.                                                                                             | The "Version 1.0 released" card, then the Orchestrator's plan card: "Add a notes field to patients · New feature, becomes version 1.1", who works on it, "Nothing is lost", and **Go ahead**, **Change the plan**, **Not now**. | "I release version 1.0 right here in the chat. Then I change it just by asking. I get a plan first, and nothing changes until I say go ahead."                                                      | Human in the loop             |
| 8   | 1:45–1:55 | In the chat box type `go ahead` and press Enter. When the **Try it** card appears, type `it works`. Then type `release`; on the card press **New feature · 1.1** if it is not picked, then type `yes`.                                                                                                | "Version 1.1 is released." in the chat. Optional: open the **Release** tab and scroll to **Versions**: 1.1 Current, 1.0 with **Go back to this**.                                                                               | "The change goes into a draft only I can see, and people keep 1.0 meanwhile. When it works, I say release, and it goes out as 1.1. Every version keeps its tests, and I can go back."               | Live product                  |
| 9   | 1:55–2:05 | Second window: open the site, press **Try a sample**, then **Use the usual choices and show me the plan**, then **Build it**. Press **Next** through the four tour pop-ups. When the build stops after the rules, press **Looks right, continue**. When it is built, press **Show how it was built**. | The workflow canvas: seven stations, each **Checked**, with check gates between them.                                                                                                                                           | "Here's the same machinery in more detail. Behind the steps is a LangGraph workflow I can edit, with a check gate after every agent."                                                               | Multi-agent orchestration     |
| 10  | 2:05–2:20 | Click the **Tests** station (it says "try 2" and "1 repair"). Hold on the panel. Then press **Meeting** above the canvas.                                                                                                                                                                             | Run 1: 1 of 170 failed; repaired; Run 2: all 170 passed. Then the meeting view, a tile per agent.                                                                                                                               | "The Tester caught the Rules builder letting a bid manager delete a tender, which the brief forbids. It was repaired and every test passes. The meeting view shows the one at work as the speaker." | Each agent's steps visible    |
| 11  | 2:20–2:40 | Press **Workflow**, then the **App** tab, then **Sana Malik**. In the left menu press **Bid room**, press the **Port fleet tracking** chip, then **Run the agents**. When it pauses on "Your turn", type `Ask for a site visit first`, press **Add**, then **Continue**.                              | Qualifier scores, Pricing's three prices, the pause, then the Red team verdict "Bid with conditions".                                                                                                                           | "Apps can have agent teams of their own. The Qualifier scores the tender, Pricing works out three prices, the run stops so a person can add a condition, and the Red team gives the verdict."       | Creativity, human in the loop |
| 12  | 2:40–2:52 | Press the bug icon in the title bar. Then press the **Tool calls** tab in the drawer.                                                                                                                                                                                                                 | The debug drawer with the AG-UI events, then the tool calls.                                                                                                                                                                    | "Every step streams over AG-UI. Debug mode shows each event, tool call, SQL statement and model call."                                                                                              | Technical execution           |
| 13  | 2:52–3:00 | Cut to the end card.                                                                                                                                                                                                                                                                                  | End card (below).                                                                                                                                                                                                               | "Turnkey. Say what the work is, answer a few questions, get the whole app. It's live at turnkey-bay.vercel.app."                                                                                    | Presentation                  |

## Optional Live shot (only if the model budget allows)

Record separately and use it in place of shots 2 and 3 if it works first time. Leave **Live** on, open a new tab, and
type a short sentence the saved builds do not cover (for example `A gym tracks member check-ins and trainer
sessions`). The Planner model writes its own questions and plan (two model calls, 16 to 32 seconds each); show the
cards and the plan, press **Build it**, and show the first two steps with the Model calls counter going up. Do not
retry more than once: each Live session is capped at 40 calls and the budget covers judging too. Turn Live off again
afterwards.

## End card

- Turnkey
- https://turnkey-bay.vercel.app/
- https://github.com/ismaeel-ch/Turnkey

## Making the rough cut again

The judge walk (`tests/e2e/judge.cjs`) clicks the same path and can record it. Against a local production build:

```
npm run build && PORT=3333 npx next start
TK_URL=http://localhost:3333 JUDGE_SHOTS=/tmp/judge/shots JUDGE_VIDEO=/tmp/judge/video JUDGE_SLOWMO=350 node tests/e2e/judge.cjs
```

It writes one `.webm` per part (the clinic, then the bidding desk) and a screenshot for each step. Join them with
ffmpeg (`-f concat`, then `-c:v libx264 -crf 30 -pix_fmt yuv420p`). The same command with `TK_URL` set to the live site
records the deployed version.

## Checks before uploading

- No key, gateway address, email address or real company data is visible in any frame, including the debug drawer.
- The video shows the same version that is deployed (`/api/health` commit matches the head of `main`).
- Length is at most three minutes; captions match the voice-over.

## A narrated cut with a synthetic voice

With `JUDGE_VIDEO` set, the judge walk also writes `steps.json`: where each step starts and ends in its part's
recording. A narrated cut is made from that: each shot takes its pieces of the recording, fitted to the length of its
spoken line (sped up when longer, the last frame held when shorter), with the line read by a free open-source voice
(Kokoro) and a subtitle file to match. The finished cuts and the scripts that make them are in the project files under
`submission/video/` (`demo-voice-male.mp4`, `demo-voice-female.mp4`, `why-source/cut.py`). The recording runs about
0.7 s behind the step times, which `cut.py` allows for.
