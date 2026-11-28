# Every component against Fluent 2

One row per component or hand-styled element in Turnkey and in the apps it builds, with the Fluent 2 component it is,
or follows, and where it stands. Kept by the audit of 27 to 28 Nov 2026. Change a row when you change the component.

How to read the status:

- **Fluent**: drawn by a component of `@fluentui/react-components` v9 (through `src/workspace/ui.tsx`).
- **Follows**: written here because Fluent has no such component, or because it is a whole surface (a board card, a
  calendar cell). It uses Fluent's tokens for type, corners, colour and shadow, and has all five states: rest, hover,
  pressed, keyboard focus, disabled.
- **To do**: still differs from Fluent; the note says how.

Rules that hold for every row, checked in the browser flows:

- Text sizes, line heights, weights and corner radii are Fluent tokens, never pixel values (`offRamp` in
  `tests/e2e/flows.cjs`, now also inside a built app and the agents chat).
- Keyboard focus is one ring, `2px solid colorStrokeFocus2`, set once for `:focus-visible`.
- A hand-written button has a hover fill and a pressed fill (the "Fluent 2 states" section at the end of
  `src/styles/workspace.css`).
- Dark theme never fills with `colorNeutralBackground5` (pure black).

## Shared building blocks (`src/workspace/ui.tsx`)

| Component                | Fluent 2 counterpart                 | Status  | Notes                                                                                                                                               |
| ------------------------ | ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Btn`                    | Button (primary, secondary, subtle)  | Fluent  | Sizes small, medium, large. Icon-only buttons are square.                                                                                           |
| Tooltip on a button      | Tooltip                              | Fluent  | A `title` on `Btn` is Fluent's Tooltip: the name of an icon-only button, a description of any other. `Tip` does the same for a hand-written button. |
| `Chip`                   | ToggleButton, circular               | Fluent  |                                                                                                                                                     |
| `FilterChip`             | InteractionTag                       | Fluent  |                                                                                                                                                     |
| `Input`, `Textarea`      | Input, Textarea                      | Fluent  | The native element sits in Fluent's frame.                                                                                                          |
| `Select`                 | Select                               | Fluent  |                                                                                                                                                     |
| Date and number fields   | Input                                | Fluent  | The browser's own date picker inside Fluent's Input frame.                                                                                          |
| `Field`                  | Field                                | Fluent  | Label, hint, validation message.                                                                                                                    |
| `Switch`                 | Switch                               | Fluent  |                                                                                                                                                     |
| `Tabs`                   | TabList, Tab                         | Fluent  |                                                                                                                                                     |
| `Seg`                    | ToggleButton group                   | Follows | Fluent 2 web has no segmented control; subtle toggle buttons in one frame.                                                                          |
| `Menu`                   | Menu, MenuItem, MenuDivider, submenu | Fluent  | The current choice shows Fluent's checkmark column, to the left of the label.                                                                       |
| `Dialog`                 | Dialog                               | Fluent  | Main action first; no corner X beside a Close button.                                                                                               |
| `MBar`                   | MessageBar                           | Fluent  |                                                                                                                                                     |
| `Card`                   | Card                                 | Fluent  |                                                                                                                                                     |
| `Spinner`                | Spinner                              | Fluent  |                                                                                                                                                     |
| `Avatar`                 | Avatar                               | Fluent  | Sizes 20, 24, 32, 40. The role's accent gives the colour.                                                                                           |
| `IconAv`, `AgentAv`      | Avatar, square, with an icon         | Fluent  | Agents, steps and tools.                                                                                                                            |
| `LinkBtn`                | Link                                 | Fluent  | "Change", "Skip", "What is this?" and other actions inside a sentence.                                                                              |
| Badge (`.badge.b-*`)     | Badge, tint and outline              | Follows | Same size (20 px), padding, weight and palette tokens as Fluent's tint Badge.                                                                       |
| Counter on a tab         | CounterBadge                         | Follows | `.tab-n`.                                                                                                                                           |
| `Empty`                  | (pattern: empty state)               | Follows | Icon in a neutral circle, title, one line, one action.                                                                                              |
| Toast                    | Toaster, Toast, ToastTitle           | Fluent  | The store decides which toasts exist and for how long; Fluent draws them and plays them in and out.                                                 |
| Keyboard key (`.kbd`)    | (none)                               | Follows |                                                                                                                                                     |
| `Json`                   | Tree                                 | Follows | Debug only.                                                                                                                                         |
| `CheckList`              | (list with status icons)             | Follows |                                                                                                                                                     |
| "Made-up data" (`Proto`) | Badge, outline                       | Follows | Dashed on purpose: it marks demo content.                                                                                                           |

## Turnkey's own screens

| Component                     | Fluent 2 counterpart          | Status  | Notes                                                                    |
| ----------------------------- | ----------------------------- | ------- | ------------------------------------------------------------------------ |
| Title bar tabs                | TabList (browser-style tabs)  | Follows | Subtle hover and pressed fills; close and new-tab are subtle icon tiles. |
| Account button                | Avatar in a subtle button     | Fluent  |                                                                          |
| Live switch                   | Switch                        | Fluent  |                                                                          |
| Home prompt box               | Textarea                      | Fluent  | One frame, Fluent's focus underline.                                     |
| Template and quest cards      | Card                          | Fluent  |                                                                          |
| "Your apps" rows              | Card with a subtle row button | Follows |                                                                          |
| Onboarding steps, choices     | (stepper), Card as a radio    | Follows | Hover, pressed, selected (brand stroke and tint), disabled.              |
| Question cards (`.iv-opt`)    | Card as a radio               | Follows |                                                                          |
| Plan screen links             | Link                          | Fluent  |                                                                          |
| Build steps list              | Card, Avatar, Badge           | Fluent  |                                                                          |
| Workflow canvas nodes         | Card                          | Follows | Buttons inside a node are Fluent's subtle icon buttons with tooltips.    |
| Step palette tiles            | Button, outline, circular     | Follows |                                                                          |
| Canvas controls               | Toolbar of subtle buttons     | Fluent  |                                                                          |
| Number cards on Build         | Card                          | Follows |                                                                          |
| Timeline, log                 | (data views)                  | Follows |                                                                          |
| Agents chat: messages         | (chat pattern), Avatar        | Follows | Type ramp and corners are Fluent tokens.                                 |
| Agents chat: question options | Button, outline, full width   | Follows | Hover, pressed, chosen, disabled.                                        |
| Agents chat: suggestion chips | Button, circular              | Fluent  |                                                                          |
| Agents chat: composer         | Textarea with a send button   | Fluent  |                                                                          |
| Progress segments             | ProgressBar                   | Follows | One segment per step, so it is not one bar.                              |
| Meeting tiles                 | Card                          | Follows |                                                                          |
| Release steps across the top  | (stepper)                     | Follows |                                                                          |
| Release cards and history     | Card, Badge                   | Fluent  |                                                                          |
| Details: side list of tables  | Nav item                      | Follows | Subtle hover, pressed and selected.                                      |
| Details: data grid            | Table                         | Follows |                                                                          |
| Details: connections          | Card, Switch                  | Fluent  |                                                                          |
| Test suite rows               | Accordion                     | Follows |                                                                          |
| Share dialog                  | Dialog, Input, Button         | Fluent  |                                                                          |
| Command palette               | Dialog with a list            | Follows |                                                                          |
| Guide and tour                | TeachingPopover               | Follows | Overlay colour is `colorBackgroundOverlay`.                              |
| Phone: bottom tab bar         | (mobile tab bar)              | Follows | Hover and pressed added.                                                 |
| Phone: sheets and their rows  | Drawer, inline, at the bottom | Fluent  | The row's switch is drawn to Fluent's Switch (40 by 20, 14 px thumb).    |

## Inside a built app (`src/workspace/runtime.tsx`, `views-a.tsx`, `views-b.tsx`, `room-ui.tsx`)

| Component                     | Fluent 2 counterpart         | Status  | Notes                                                                      |
| ----------------------------- | ---------------------------- | ------- | -------------------------------------------------------------------------- |
| Header                        | (app bar)                    | Follows | Brand colour; owned by the built-app look pass.                            |
| Account switcher              | Subtle button with a Persona | Fluent  | Owned by the built-app look pass.                                          |
| Top navigation                | TabList                      | Follows | Underlined tabs, 44 px.                                                    |
| Side navigation, rail         | Nav                          | Follows | Selected fill, accent bar, pressed fill.                                   |
| Sign-in people                | Card with a Persona          | Follows | Avatar is Fluent's.                                                        |
| "Sign in with a username"     | Accordion header             | Follows | Subtle hover and pressed; no underline.                                    |
| View tabs, More views         | TabList, Menu                | Fluent  |                                                                            |
| Filter, Copy CSV, Columns     | Toolbar buttons              | Fluent  |                                                                            |
| Search                        | SearchBox                    | Fluent  | Input with a leading icon.                                                 |
| Table                         | Table                        | Follows | 44 px rows, 12 px semibold header, sortable header buttons.                |
| Board column and card         | Card                         | Follows | Hover lifts to shadow 8, pressed drops back.                               |
| Calendar chips                | (calendar)                   | Follows | Hover no longer goes black in dark.                                        |
| Timeline bars                 | (gantt)                      | Follows |                                                                            |
| Charts                        | (charts)                     | Follows | Text in text colours, a tip on every mark.                                 |
| Pivot                         | Table                        | Follows |                                                                            |
| Tree                          | Tree                         | Follows | Rows have subtle hover and pressed.                                        |
| Cards view                    | Card                         | Fluent  |                                                                            |
| Number cards on the dashboard | Card                         | Follows |                                                                            |
| Date range on the dashboard   | ToggleButton group           | Follows | `Seg`.                                                                     |
| Record form                   | Field, Input, Select         | Fluent  |                                                                            |
| Record drawer                 | Drawer, inline, at the end   | Fluent  | InlineDrawer with DrawerHeader and DrawerBody, placed over the app's pane. |
| Stage buttons on a record     | Button                       | Fluent  |                                                                            |
| Related records list          | List                         | Follows |                                                                            |
| Status and choice values      | Badge                        | Follows |                                                                            |
| Welcome card, tour, checklist | Card, TeachingPopover        | Follows |                                                                            |
| Demo data bar                 | MessageBar                   | Follows | Its link is Fluent's Link.                                                 |
| Agent room                    | Card, Avatar, Badge          | Follows |                                                                            |
| Phone: floating New button    | (FAB)                        | Follows | Fluent 2 web has none; 56 px, shadow 16.                                   |

## Still to do

Nothing is open. Add a row here when a new component is written by hand.
