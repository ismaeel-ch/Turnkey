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
