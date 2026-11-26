# Decision records

One short record for each numbered decision in section 2 of [`docs/PLAN.md`](../PLAN.md). Each says what the situation
was, what was decided, and what follows. "Implementation" says whether the decision is built or planned.

| No. | Decision                                                                                    | Implementation                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [State and SQLite stay in the browser](0001-state-stays-in-the-browser.md)                  | Built                                                                                                                                          |
| 2   | [One agent step per request](0002-one-agent-step-per-request.md)                            | Built for the model route; the server-side step graph is planned                                                                               |
| 3   | [LangGraph in two layers](0003-langgraph-in-two-layers.md)                                  | Planned (WP-05, WP-06, WP-09). The classic orchestrator is built and is the default                                                            |
| 4   | [AG-UI through CopilotKit's runtime](0004-ag-ui-through-copilotkit.md)                      | Partly built: the spike's agent runs in the runtime. The registry and client are planned (WP-08)                                               |
| 5   | [Definitions, not code](0005-definitions-not-code.md)                                       | Built                                                                                                                                          |
| 6   | [Any model key](0006-any-model-key.md)                                                      | Partly built: LiteLLM and OpenAI-compatible providers and the mock provider exist; Anthropic and Claude Code CLI providers are planned (WP-03) |
| 7   | [JSON first, tool calling where it exists](0007-json-first-tool-calling-where-it-exists.md) | Built for JSON; the tool-calling probe is built, native tool use in agents is planned                                                          |
| 8   | [The legacy modules are not rewritten](0008-legacy-modules-are-not-rewritten.md)            | Built                                                                                                                                          |
