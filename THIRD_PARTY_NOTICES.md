# Third-party notices

Checked on Thu 26 Nov 2026, 16:19 UTC, against `main` at `353ab5d`. Versions come from `package.json` and the installed
`node_modules`. Each licence was read from the package's own `LICENSE` file or `license` field, not guessed.

## Code shipped to the browser or run on the server

| Package | Version | Licence | Used for | Where used |
| --- | --- | --- | --- | --- |
| next | 16.4.6 | MIT (Copyright (c) 2025 Vercel, Inc.) | the web framework and route handlers | `src/app`, `next.config.ts` |
| react | 19.3.1 | MIT (Meta Platforms, Inc.) | the page | `src/platform` |
| react-dom | 19.3.1 | MIT (Meta Platforms, Inc.) | the page | `src/platform` |
| @xyflow/react (React Flow) | 12.12.1 | MIT (Copyright (c) 2019-2025 webkid GmbH) | the workflow canvas | `src/platform/boot.ts`, `src/legacy/flow.js` |
| htm | 3.1.1 | Apache-2.0 | template tags for the compatibility layer | `src/platform/compat/html.ts` |
| sql.js | 1.12.0 | MIT (Copyright (c) 2017 sql.js authors) | SQLite in the browser | `public/vendor/sql-wasm.js`, `public/vendor/sql-wasm.wasm` |
| zod | 4.6.7 | MIT (Copyright (c) 2025 Colin McDonnell) | validation of inputs and model output | `src/shared`, `src/server` |
| openai | 7.65.0 | Apache-2.0 | OpenAI-compatible client, used for the gateway probe | `src/app/api/health/route.ts` |
| @ai-sdk/openai | 3.0.147 | Apache-2.0 (Copyright 2023 Vercel, Inc.) | AI SDK model for the spike | `src/lib/model.ts` |
| @copilotkit/runtime | 1.90.2 | MIT (Copyright (c) Atai Barkai) | agent runtime in the route handler | `src/app/api/copilotkit` |
| @copilotkit/react-core | 1.90.2 | MIT | spike page | `src/app/(spike)/spike/page.tsx` |
| @copilotkit/react-ui | 1.90.2 | MIT | declared in `package.json`; not imported in `src` on `main` | none yet |
| @ag-ui/client | 1.0.5 | MIT | AG-UI client | declared; not imported in `src` on `main`; planned `src/platform/agui` (WP-08) |
| @ag-ui/core | 1.0.5 | MIT | AG-UI types | declared; not imported in `src` on `main`; planned `src/server/agui` (WP-08) |
| @ag-ui/encoder | 1.0.5 | MIT | AG-UI event encoding | declared; not imported in `src` on `main`; planned `src/server/agui` (WP-08) |
| @langchain/core | 1.5.1 | MIT (Copyright (c) LangChain, Inc.) | model interface for the graphs | declared; not imported in `src` on `main`; planned graph code (WP-05, WP-06) |
| @langchain/langgraph | 1.7.5 | MIT (Copyright (c) 2024 LangChain) | agent graphs | declared; not imported in `src` on `main`; planned `src/server/graph` and `src/platform/orchestrator` (WP-05, WP-06, WP-09) |

## Design tokens and icons

| Asset | Version | Licence | Used for | Where used |
| --- | --- | --- | --- | --- |
| @fluentui/tokens | 1.0.0-alpha.24 | MIT (Copyright (c) Microsoft Corporation) | design tokens; the generated CSS is shipped | `scripts/build-legacy.mjs`, `src/legacy/app.css` |
| Fluent System Icons (`@fluentui/svg-icons`) | not pinned | MIT (Copyright (c) 2020 Microsoft Corporation) | 20px icons, generated into `src/legacy/icons.js` | `scripts/gen-icons.cjs`. The package is not in `package.json`; it is installed with `--no-save` when icons are regenerated. |

The Fluent icons licence was checked against `microsoft/fluentui-system-icons` on GitHub. The package version is not recorded in the repository.

## Build and test tools (not shipped to the browser)

| Package | Version | Licence |
| --- | --- | --- |
| @types/node | 22.20.7 | MIT |
| @types/react | 19.3.3 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @vitest/coverage-v8 | 5.1.2 | MIT |
| vitest | 5.1.2 | MIT |
| eslint | 9.39.5 | MIT |
| eslint-config-next | 16.4.6 | MIT |
| prettier | 3.10.1 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| jsdom | 31.0.1 | MIT |
| fake-indexeddb | 6.2.8 | Apache-2.0 |
| playwright | 1.63.0 | Apache-2.0 |

## Data sources

| Source | Used by | Licence or terms | Status |
| --- | --- | --- | --- |
| Wikipedia | the prototype's quest sources (`src/legacy/quests.js` link pattern), planned connector (WP-07, #8) | Text is under CC BY-SA 4.0 and GFDL, per Wikimedia's terms. Attribution and share-alike apply. | Licence from search results only. The Wikimedia terms page could not be fetched. |
| World Bank Open Data | planned connector (#8); quest fixtures | CC BY 4.0. Attribution required. | Verified on the World Bank public licences page. |
| OpenAlex | planned connector (#8) | Not verified. The OpenAlex licence pages read did not state a licence for the dataset. | OPEN: confirm before WP-07 ships. |
| arXiv | planned connector (#8) | Descriptive metadata: CC0 1.0, per arXiv's API terms. Do not imply arXiv endorses the project. Legacy API limit: one request every three seconds, one connection at a time. | Verified on arXiv's API terms page. |
| PatentsView | planned connector (#8) | Not verified. USPTO says PatentsView is migrating to its Open Data Portal, with search and API functions paused from 20 March 2026. The endpoint in the plan (`search.patentsview.org`) may not work. | OPEN: check the current API before WP-07 uses it. |
| Microsoft Learn MCP | listed in `src/legacy/builds.js` as a catalogue entry with a URL | Not checked. | OPEN: confirm terms if the app calls it. |

## Gaps raised

- OpenAlex dataset licence: not verified.
- PatentsView endpoint: migration to the USPTO Open Data Portal. Affects WP-07 (#8).
- Microsoft Learn: terms not checked.
