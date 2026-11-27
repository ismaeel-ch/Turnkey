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
