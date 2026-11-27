# UI issues found in the visual QA pass

A pass over every main screen of the workspace on 26 Nov 2026, in light and dark, at 1440×900 and at 390×844 (phone),
against a production build with the stand-in model. Screenshots are in the project's shared folder,
`screens/ui-qa/` (named `desk|phone-light|dark-NN-screen.png`).

Phone layout, accessibility and the demo path have their own owners, so this list covers what looks broken or
inconsistent and notes phone-only items for those owners.

| #   | Where                                     | What is wrong                                                                                                                                                                      | Status |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Every dialog (Share, Workflow, Settings…) | Fluent's `DialogBody` grid beats our `.dlg` flex layout: the title sits in a 247px column with the close button in the middle of the header, and footer buttons stack on two rows. | Fixed  |
| 2   | Title bar, account button                 | The avatar is a Fluent `Button` that keeps its 96px minimum width, border and white fill, so it shows as an empty box with "DU" in it.                                             | Fixed  |
| 3   | Every screen on desktop                   | The "Agents" edge tab is fixed over the left edge of the page and covers content: the API method badges (PATCH, DELETE), test rows, timeline lane icons, connection cards.         | Fixed  |
| 4   | Dark theme badges                         | `.tab-n` ("new" on Release) and `.b-neutral` ("Off" on connections) use `colorNeutralBackground5`, which is pure black in dark, so they read as black holes.                       | Fixed  |
| 5   | Chat sidebar after a build                | The log scrolls to the bottom before the "Try a change" suggestions appear; they shrink the log and the last card (Test suite) ends up cut off.                                    | Fixed  |
| 6   | Details → Data                            | Dates and phone numbers wrap onto two lines (`2026-11-` / `25T09:00`), which doubles every row's height.                                                                           | Fixed  |
| 7   | Details → Connections                     | Four 250px columns squeeze each card: titles and "REST API · No key needed" wrap to three lines next to the switch.                                                                | Fixed  |
| 9   | Onboarding, account step                  | "Skip and use the demo account" is a subtle button whose padding pushes its text 13px right of the form's left edge.                                                               | Fixed  |
| 10  | Build → Workflow canvas                   | Sized to the window, the canvas fitted the graph by its height: node text was 6–7 px beside half a canvas of empty space.                                                          | Fixed  |
| 11  | Phone, Build                              | KPI cards are a sideways strip with the third card cut at the edge, and "Run again" sits on its own row. (Phone owner.)                                                            | Fixed  |
| 12  | Phone, toasts                             | Toasts sit over the last list item above the bottom nav. (Phone owner.)                                                                                                            | Fixed  |

## Second pass: features merged on 26–27 Nov

The same check, on the features merged after the first pass: Meeting view (#191), field editing on Data (#192), Look
menu (#194), team cost in the agent room (#185), Microsoft Learn connector (#188), step palette (#140) and the
first-screen choice (#128). Screenshots are in `screens/ui-qa-new-features/` in the project's shared folder.

| #   | Where                           | What is wrong                                                                                                                                                   | Status |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 13  | Whole workspace, theme "System" | Switching the device between light and dark while the page is open changed the CSS tokens but not Fluent's theme, so controls stayed in the old theme.          | Fixed  |
| 14  | Every dropdown                  | `.tk-field>.select{border:0}` removed the border Fluent draws on the native select, so dropdowns ("Text", "Pick a field", "Preview as") looked like plain text. | Fixed  |
| 15  | App page, Look menu             | The current choice was disabled and greyed, groups had no dividers, and 20 entries ran past the menu's height, hiding most accent colours.                      | Fixed  |
| 16  | Phone, Data → Columns           | The field editor wrapped raggedly: the type dropdown and Add field on one line, Remove alone on another.                                                        | Fixed  |
| 17  | Phone, Build                    | With Meeting added, the four view buttons pushed Run again past the right edge.                                                                                 | Fixed  |
| 18  | Build → Workflow palette        | The step tiles were one scrolling row with the last tile cut at the edge and no sign of more.                                                                   | Fixed  |
| 19  | Agent room, team cost           | Per-agent cost lines wrapped with a dot at the start of a line; the run total squeezed the case title.                                                          | Fixed  |
| 20  | Phone, Connections detail       | The tool table needed sideways scrolling to reach Test.                                                                                                         | Fixed  |
| 21  | First screen                    | Wrapped station chips started a line with an arrow; the tour still said "Workflow, Timeline and Log show the same run three ways".                              | Fixed  |

## Third pass: the workspace against Fluent 2's ramps

A pass on 27 Nov 2026 over the workspace's own screens (welcome, Home, questions, plan, build steps, Release, Details,
dialogs, menus), in light and dark, at 1440 px and 390 px, against Fluent 2's type ramp, corner radii, colour tokens
and control sizes. Before and after screenshots are in `screens/fluent2-workspace/` in the project's shared folder.
The agents chat and a built app's screens have their own passes.

| #   | Where                           | What is wrong                                                                                                                                                              | Status |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 22  | Every screen                    | Text sizes between the steps of Fluent's ramp (9, 11, 13, 15, 17, 18, 22, 26 px) and line heights to match (15, 18, 30, 34 px). Captions are 12/16 now, body text 14/20.   | Fixed  |
| 23  | Every screen                    | Corner radii between Fluent's steps (3, 5, 9, 10, 14, 18, 28 px). They are `borderRadiusMedium`, `Large`, `XLarge`, `2XLarge` or `Circular` now.                           | Fixed  |
| 24  | Home, prompt box                | A framed text area inside a framed box: two borders around one field. The box is the field's one frame, with Fluent's focus underline.                                     | Fixed  |
| 25  | Home cards, Build "ready" bar   | The main action of a card or a page ("Build this app", "Open the app") was a small 24 px button. Main actions are Fluent's standard 32 px.                                 | Fixed  |
| 26  | Release, steps across the top   | Step markers not yet reached were filled with `colorNeutralBackground5`, pure black in dark. They are outlined, like the markers on the welcome and the questions screens. | Fixed  |
| 27  | Title bar, dark                 | A tab under the pointer turned pure black (`colorNeutralBackground5`). It uses `colorNeutralBackground3Hover`.                                                             | Fixed  |
| 28  | Danger buttons, tour, step dots | Colours written as `#fff` or `rgba(0,0,0,.5)` instead of `colorNeutralForegroundOnBrand`, `colorBackgroundOverlay` and the danger hover and pressed tokens.                | Fixed  |

Rules for new workspace CSS, checked by `offRamp` in `tests/e2e/flows.cjs`: font sizes, line heights, weights and
radii are written as Fluent tokens (`var(--fontSizeBase300)`, `var(--lineHeightBase300)`, `var(--fontWeightSemibold)`,
`var(--borderRadiusMedium)`), never as pixel values; run `npm run theme` after using a token for the first time.

## Fourth pass: motion, actions and spacing against Fluent 2

A pass on 27 Nov 2026 over every main screen of the workspace and of a built app, desktop and phone, against Fluent
2's pages on motion, layout, buttons, dialogs, drawers, fields and message bars (issue #291). Before and after
screenshots are in `screens/fluent2-motion/` in the project's shared folder.

| #   | Where                               | What is wrong                                                                                                                                                              | Status |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 29  | Every screen                        | Almost nothing moved, and what did used its own timings (`.18s ease-out`, `.22s cubic-bezier(.2,.8,.2,1)`). Motion follows Fluent 2 now, on its duration and curve tokens. | Fixed  |
| 30  | Dialogs, toasts, record panel, form | They vanished the instant they were closed. Each plays a short exit first (Fluent: what leaves accelerates and is quicker than its entrance).                              | Fixed  |
| 31  | Every dialog and form               | The main action was last, to the right of Cancel. Fluent puts it first: to the left of, or above, the other actions.                                                       | Fixed  |
| 32  | Dialogs with Cancel, Close or Done  | A Close icon in the corner next to a button that closes the dialog. The icon shows only when no button closes it.                                                          | Fixed  |
| 33  | Share dialog, link notes            | "Release version 1.0 and make the link" is "Release and share" (Fluent: one or two words on a dialog button). "OK" on a note is "Got it".                                  | Fixed  |
| 34  | The plan, before a build            | "Change something" stood before "Build it". The main action leads.                                                                                                         | Fixed  |
| 35  | Many places                         | Paddings and gaps between the steps of Fluent's spacing ramp (3, 5, 7, 9, 14, 18 px). They are 4, 6, 8, 12, 16 or 20 px now.                                               | Fixed  |

How things move, in `src/styles/motion.css` (CSS, for what only arrives) and `src/workspace/motion.tsx` (Fluent's
motion components, for what also leaves):

| What                                            | Motion                                   | Duration, curve                                                      |
| ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| A view of the workspace, a page of a built app  | Fade                                     | `durationFast` (150 ms), `curveLinear`                               |
| Rows, cards, tiles, steps: a set of items       | Rise 8 px and fade, 30 ms apart, six max | `durationGentle` (250 ms), `curveDecelerateMid`                      |
| A chat message, a log line                      | Rise 8 px and fade                       | `durationNormal` (200 ms), `curveDecelerateMid`                      |
| A card in chat, a question, the command palette | Scale from 96% and fade                  | `durationGentle`, `curveDecelerateMid`                               |
| A message bar                                   | Drop 8 px and fade                       | `durationNormal`, `curveDecelerateMid`                               |
| The chat panel, the record panel of a built app | Slide from the end edge and fade         | in `durationGentle` decelerating, out `durationFast` accelerating    |
| A dialog                                        | Fluent's own: scale and fade             | Fluent's defaults, in and out                                        |
| A toast                                         | Rise 8 px and fade, and back             | in `durationNormal`, out `durationFast`                              |
| A sheet on a phone                              | Slide up from the bottom edge            | `durationSlow` (300 ms), `curveDecelerateMid`                        |
| A card or row under the pointer                 | Shadow, fill and border ease             | `durationFaster` (100 ms), `curveEasyEase`                           |
| A bar that fills, the tour's highlight          | Grows or travels in place                | `durationSlower` or `durationSlow`, `curveDecelerateMid` or EasyEase |

Rules for new UI, checked by `fluentMotion` in `tests/e2e/flows.cjs`:

- Durations and curves are Fluent's tokens (`var(--durationNormal)`, `var(--curveDecelerateMid)`, or `motionTokens`
  in script), never numbers. Run `npm run theme` after using a token for the first time.
- A change of destination is a fade. Large surfaces are not slid across the screen.
- Only the first six items of a set are offset, so a long list does not keep anyone waiting.
- Keyframes live inside `@media (prefers-reduced-motion: no-preference)`. With reduced motion on, nothing moves.
- In a dialog, drawer or form the main action comes first and there is one of them. `Dialog` in `ui.tsx` orders its
  footer itself and leaves out the Close icon when a footer button closes the dialog.
- Paddings, margins and gaps are 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 36 or 40 px.

Left as it is, on purpose: the steps of onboarding and of the tours keep "Back" on the left and the forward button
on the right, as Fluent's own teaching popover does, and keep the word "Continue", which the demo video, the judge
walk and the README use.
