---
paths:
  - "src/server/graph/**"
  - "src/server/agents/**"
  - "src/platform/orchestrator/**"
---

# LangGraph code

- Read the installed package before writing: `node_modules/@langchain/langgraph/dist/**/*.d.ts` and its README. The API changes between versions.
- On the server import from `@langchain/langgraph`. In the browser import from `@langchain/langgraph/web`.
- State is typed with annotations. Nodes are small pure-ish functions that take state and return a partial update.
- Every loop has a cap that is part of the state (attempts, tool calls, total steps). At most three attempts per agent step.
- Agents return one JSON object. Code validates it and acts. Use native tool calling only where the gateway probe says it works; otherwise the JSON protocol.
- A graph gets its model through `src/server/llm`, never by constructing a client itself, so limits, provider choice and the mock all apply.
- Test every graph with the mock provider: the happy path, a repair, and running out of attempts. Draw the graph in the pull request.
