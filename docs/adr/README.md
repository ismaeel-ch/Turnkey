# Decision records

One short record for each numbered decision in section 2 of [`docs/PLAN.md`](../PLAN.md), plus two the owner made
later (9 and 10). Each says what the situation was, what was decided, and what follows. "Implementation" says
whether the decision is built, partly built or planned.

| No. | Decision                                                                                    | Implementation                                                                                      |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | [State and SQLite stay in the browser](0001-state-stays-in-the-browser.md)                  | Built                                                                                               |
| 2   | [One agent step per request](0002-one-agent-step-per-request.md)                            | Built for the model route; the server-side step graph is planned                                    |
| 3   | [LangGraph in two layers](0003-langgraph-in-two-layers.md)                                  | Partly built: the workflow graph exists but is not wired in; the server graphs are planned          |
| 4   | [AG-UI through CopilotKit's runtime](0004-ag-ui-through-copilotkit.md)                      | Partly built: runtime, registry, graph agent class and browser client exist; builds do not use them |
| 5   | [Definitions, not code](0005-definitions-not-code.md)                                       | Built                                                                                               |
| 6   | [Any model key](0006-any-model-key.md)                                                      | Built: LiteLLM, OpenAI-compatible, Anthropic, Claude Code CLI (local), mock                         |
| 7   | [JSON first, tool calling where it exists](0007-json-first-tool-calling-where-it-exists.md) | Built                                                                                               |
| 8   | [The workspace is ordinary code](0008-the-workspace-is-ordinary-code.md)                    | Built; typing module by module is in progress                                                       |
| 9   | [CI when ready, deploy only on a release](0009-ci-when-ready-deploy-on-release.md)          | Built                                                                                               |
| 10  | [Fluent 2 for the interface](0010-fluent-2-for-the-ui.md)                                   | In progress                                                                                         |
