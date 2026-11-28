# Why Turnkey: script for a short video

A video of about 100 seconds that explains the problem Turnkey solves and how it solves it, seen from a software house
that builds business apps for its clients. It is the companion to the demo video ([demo-video.md](demo-video.md)): this
one says why, the demo shows how. It mentions no company or event by name.

A finished version with the words on screen and no sound (`why-turnkey.mp4`) is in the project files under
`submission/video/`. It works as a silent video as it is. To add your voice, read the voice-over below over it, one
scene at a time.

The software house and its clients are a general example, not a real company. The limits in scene 12 come from
[use-cases.md](use-cases.md); keep them in, because they keep the claims honest.

## Script

| #   | Time      | On screen                                                       | Voice-over                                                                                                                                                                                                 |
| --- | --------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00–0:06 | Title: "Why I built Turnkey"                                    | "Why I built Turnkey."                                                                                                                                                                                     |
| 2   | 0:06–0:15 | The same requests, again and again                              | "A software house hears the same requests every week: a booking desk for a clinic, a leave form, an approval flow for purchases. Small apps, but each one matters to the client."                          |
| 3   | 0:15–0:24 | Weeks before anyone can click anything                          | "Each one still takes weeks: meetings, a written spec, a developer, a tester. The client sees nothing they can click until the end."                                                                       |
| 4   | 0:24–0:32 | The hardest part is saying what you need                        | "And the hardest part is the first one. Clients know their work, not how apps are made. They only know the spec was right when they can try it."                                                           |
| 5   | 0:32–0:40 | So small tools end up in spreadsheets                           | "So many small tools never get built. Teams keep using spreadsheets and email, with no rules about who can see or change what."                                                                            |
| 6   | 0:40–0:47 | Turnkey: one sentence in, a working app out                     | "Turnkey turns that around. You say what the work is in one sentence, and you get a working app, with its rules tested."                                                                                   |
| 7   | 0:47–0:55 | App: the Planner's question card                                | "First, a Planner agent asks only the questions that change the app, and every question has a usual answer."                                                                                               |
| 8   | 0:55–1:03 | App: the plan in plain words                                    | "Then it shows a plan in plain words: who uses it, what it keeps, how work moves, who can see what. Nothing is built until you say so."                                                                    |
| 9   | 1:03–1:12 | App: the build finished, all checks pass                        | "A team of agents builds it. Each does one job, and code checks every hand-off. Here, all 142 checks pass before the app is called ready."                                                                 |
| 10  | 1:12–1:20 | App: the Tester catches a mistake and it is repaired            | "When an agent gets something wrong, the Tester catches it and it goes back for repair. Here a bid manager could delete a tender, which the brief forbids."                                                |
| 11  | 1:20–1:28 | App: the receptionist's welcome; a change asked for in the chat | "The app greets each person for their own job. Later, you change it by asking in the chat, check the change in a draft, and release it as the next version."                                               |
| 12a | 1:28–1:36 | App: Home's "For a software house" section                      | "It also comes with the apps a software house runs on itself: a sprint board with bug triage, timesheets and client billing, and client onboarding. Each one works out its numbers and keeps its rules."   |
| 12  | 1:36–1:46 | What it means for a software house, and what it is not          | "For a software house, that means a working draft in the first meeting, and a tested starting point for developers. It is a prototype, not production: real data and real requirements still need people." |
| 13  | 1:46–1:52 | End card: "Turnkey" and the live address                        | "Turnkey. Say what the work is, get the whole app."                                                                                                                                                        |

## Making it again

The video is made from slides and screenshots of the app; nothing is filmed. The screenshots come from the judge walk
(see "Making the rough cut again" in [demo-video.md](demo-video.md)). The slides are HTML pages turned into images
with Playwright and joined with ffmpeg, each with a short fade. Change the words in this table first, then make it
again, so the script and the video say the same thing.
