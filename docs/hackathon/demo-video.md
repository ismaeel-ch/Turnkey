# Demo video: script and shot list

A three-minute screen recording for the submission and for anyone who cannot open the live app. It follows the
five-minute path in the README, so a judge who watches it can repeat it. Everything is recorded in **Demo** mode
(saved builds, no model calls), except one optional Live shot at the end.

## Before recording

- Browser at 1440 × 900, zoom 100 %, light theme, no extensions or bookmarks bar in view.
- Open https://turnkey-bay.vercel.app/ in a fresh private window so the first-run screens appear.
- Close notifications. Record the browser window only, with system audio off and a microphone for the voice-over.
- Do the walk once without recording: the saved build takes about 30 seconds, the Bid room run about 25.
- Data on screen is made up. Do not open a second tab with anything else in it.

## Script

Times are targets. The voice-over is written to be read at a normal pace; cut lines rather than speed up.

| #   | Time      | Shot (what is on screen)                                                                                                                                                             | Voice-over                                                                                                                                                                                                                                   | Criterion it serves           |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | 0:00–0:12 | Welcome screen. Hold on the headline and the row of stations.                                                                                                                        | "Most teams need small business apps: a bid tracker, a leave form, a helpdesk. Turnkey builds one from one sentence, with a team of agents you can watch."                                                                                   | Business value                |
| 2   | 0:12–0:22 | Get started, Skip and use the demo account, Demo stays selected, pick **Sales bidding desk**, Open my workspace.                                                                     | "No login needed. I'll use Demo, which replays a saved build through the real checks and the real database, so it costs nothing."                                                                                                            | Presentation, live product    |
| 3   | 0:22–0:50 | Build tab, Workflow. Nodes turn from Working to Checked one by one. Chat sidebar fills with each agent's card.                                                                       | "Five builder agents, each with one job: a Researcher writes the brief, then Database, Backend, View advisor and UI. Between every pair, code checks the handoff. If a check fails, the work goes back to the same agent with the failures." | Multi-agent orchestration     |
| 4   | 0:50–1:05 | The Tests node shows "try 2". Scroll to the Tester panel: Run 1, 1 of 170 failed; Backend repaired it; Run 2, all passed.                                                            | "The Tester writes test cases from the brief. Here it caught the Backend letting a bid manager delete a tender, which the brief forbids. The Backend repaired it, and all 170 tests pass."                                                   | Agents check each other       |
| 5   | 1:05–1:15 | Switch to **Timeline**, then **Log**.                                                                                                                                                | "The same run as a timeline of who worked when, and as a log of every step."                                                                                                                                                                 | Each agent's steps visible    |
| 6   | 1:15–1:35 | **App** tab. Sign in as Sana Malik. Pipeline, then switch **Preview as** to Omar Farooq, the sales director.                                                                         | "This is the app it built: SQLite tables, endpoints guarded by role, views and pages. Sana prepares bids. Only Omar, the director, can approve one."                                                                                         | Completeness, end to end      |
| 7   | 1:35–2:05 | **Bid room**. Press **Run** on "Fleet tracking for the port authority". Qualifier scores, Pricing prices, the run pauses on "Your turn". Press Continue; Red team gives its verdict. | "The app has its own team of agents. The Qualifier scores the tender, Pricing works out three prices, and before the Red team decides, the run stops so a person can add a condition."                                                       | Creativity, human in the loop |
| 8   | 2:05–2:25 | Chat sidebar: press **Add a notes field to score lines**. The plan card appears, then Applied, with "Ran again: Database → Backend → Views → Screens → Walkthrough".                 | "Changes come from chat. The Orchestrator plans the change and only the stations it touches run again. The tests are regenerated and must still pass."                                                                                       | Technical execution           |
| 9   | 2:25–2:40 | **Release** tab: Release version 1.0, then **Share by link** and the share dialog.                                                                                                   | "A release runs every test once more. Then the app can be shared by link and installed on its own, with its own data."                                                                                                                       | Live product                  |
| 10  | 2:40–2:52 | Bug icon in the title bar: the debug drawer with AG-UI events and tool calls.                                                                                                        | "Debug mode shows every AG-UI event, tool call, SQL statement and model call."                                                                                                                                                               | Technical execution           |
| 11  | 2:52–3:00 | Back to the Build tab, the finished workflow canvas. End card with the live URL and the repository.                                                                                  | "Turnkey. One sentence in, a working app out. It's live at turnkey-bay.vercel.app."                                                                                                                                                          | Presentation                  |

## Optional Live shot (only if the model budget allows)

Record separately and splice in after shot 8 if it works first time. Switch **Live** on in the title bar, open a new
tab, type a short sentence the saved builds do not cover (for example "A gym tracks member check-ins and trainer
sessions"), and show the first two agents working with real model calls and the Model calls counter going up. Do not
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
