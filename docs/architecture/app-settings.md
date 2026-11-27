# A built app's own settings

Every app Turnkey builds has a Settings page. The people who run the app open it from the gear in the app's header
(on a phone: the account sheet). The builder has a Settings button above the app that opens it as someone who may.

## Where a setting lives

| Setting                                          | Kept in                                     | Read by                                         |
| ------------------------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| App name                                         | `app.name`, `def.brief.name`                | the header, the sign-in screen, the workspace   |
| Colour, navigation, row height                   | `def.theme`                                 | `AppPane` in `src/workspace/runtime.tsx`        |
| People                                           | the `users` table, mirrored to `def.users`  | sign-in, access rules, share links and releases |
| Who may open Settings                            | `def.settings.admins`                       | `adminRoles`, `canOpenSettings`                 |
| Stage names                                      | `def.process.states[].label` (and the plan) | badges, boards, move buttons                    |
| Currency, number marks, dates, clock, week start | `def.settings.formats`                      | `fmtOf(def)`, `colFmt(def, column)`             |
| First page per kind of person                    | `def.settings.home`                         | `homeScreen` in `AppPane`                       |
| First view per list                              | `def.settings.views`                        | `defaultView` in `vxState` (`views-a.tsx`)      |

`def.settings` is missing until someone changes a setting. An app with no settings behaves exactly as apps did before
the page existed: `fmtOf` returns the old formatters and the app's release signature is unchanged.

## Code

- `src/workspace/app-settings.ts` reads: defaults, `normSettings` (checks settings that come from a share link against
  the app they belong to), who may open the page, and the formatters.
- `src/workspace/app-admin.ts` writes. Every change goes through `change()`: it is refused while the app is busy
  (a build, a pending approval, a queued re-run, a running agent team), then applied, given a new revision, and noted
  with `logChange` so the next release's notes mention it. A change that cannot affect what the tests check (a colour,
  a format) carries the last test results forward; a change to people does not.
- `src/workspace/app-settings-ui.tsx` is the page. It loads the first time it is opened.

## Rules the writer keeps

- Somebody can always open Settings.
- Every kind of person keeps at least one person, so no part of the work is left with nobody.
- Nobody removes themselves, and a person whom records or history name stays on the list.
- A value that is not on a fixed list (a currency, a view, a page a role cannot open) changes nothing.

## Who may open Settings by default

Until someone chooses, one kind of person may: the one whose name or job says they run things (manager, approver,
owner, director), and among those, or when nobody is, the one with the widest access. `adminRoles` in
`app-settings.ts` holds the rule.

## Checking it

- `tests/unit/app-settings.test.ts` and `tests/unit/app-admin.test.ts`.
- `npm run test:e2e -- settings` drives each section and checks that the app follows.
- The a11y flow scans every section in the light and the dark theme.
