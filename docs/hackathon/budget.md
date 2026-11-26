# Model budget

The deployed site has one Claude API key and about **$25** for all of judging. This page records what real Live builds
cost, which model answers each agent, and the guard-rail defaults that keep the budget for judges.

Measured on Thu 26 Nov 2026 (21:05 to 22:30 UTC) with `LLM_PROVIDER=claude-code` on a developer machine, using
`tests/e2e/live-real.cjs`: it types each sample's sentence into Home with Live on, so every agent is a real model call,
and reads the server's `[llm]` lines for calls and tokens.

## How a cost is worked out

The Claude Code command reports its own cost, but it adds about 1,850 tokens of its own scaffolding to every call and
caches with a one-hour write. A direct API call sends neither, so the "API cost" below is

    (prompt tokens - 1,850) x input price + output tokens x output price

with Claude Sonnet 5.5 at $2 / $10 and Claude Haiku 5.5 at $0.10 / $0.50 per million tokens (input / output). Output
tokens include thinking: both models think by default and thinking is billed as output. Each Live step sends one user
message and nothing else, so nothing is cached.

## Results

Every build below finished with all six stations ok, the guided tour passing, and every test passing (after at most
one repair round).

### One build of a sample app

| Models                                         | Clinic | Helpdesk | Leave  | Gym    | Calls per build | Time per build |
| ---------------------------------------------- | ------ | -------- | ------ | ------ | --------------- | -------------- |
| Sonnet for every agent                         | $0.203 | $0.189   | $0.183 | $0.203 | 6 to 7          | 100 to 115 s   |
| **Sonnet to design, Haiku for the rest** (now) | $0.111 | $0.083   | $0.090 | $0.103 | 6 to 8          | 85 to 130 s    |
| Haiku for every agent (the Quick setting)      | $0.013 | $0.009   | $0.013 | $0.009 | 6 to 8          | 75 to 115 s    |

A build uses about 30,000 to 45,000 prompt tokens and 10,000 to 19,000 output tokens. The Database step writes the
most (4,000 to 5,000 output tokens on Sonnet).

### One run of a quest app's own agent team (three agents, one input)

| Team                    | Calls | API cost |
| ----------------------- | ----- | -------- |
| Fact-check desk         | 11    | $0.084   |
| Prior-art scout         | 11    | $0.079   |
| Debate (Second Opinion) | 9     | $0.073   |

All three finished. The public sources (Wikipedia, OpenAlex and the others) are blocked from the machine the runs
were made on, so every lookup failed and the agents said so and worked from the text alone; on the live site the
lookups reach the sources.

## Which model answers which agent

`src/server/graph/step/tiers.ts`. On a normal build the agents that design the app stay on Sonnet; the ones that follow
a design already made go to Haiku:

| Sonnet (default tier)         | Haiku (quick tier)                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Researcher, Database, Backend | View advisor, UI (screens and tour), Tester, Backend repairs after failed tests, review steps, chat changes |

`LLM_QUICK_ROLES` changes the Haiku list (`none` puts every agent on Sonnet). The Quick setting in the workspace puts
every agent on Haiku. App agent teams choose their own tier per agent.

## Guard-rail defaults

`src/server/guard/limits.ts`. Counters live in each server instance's memory, so they are a brake, not an exact meter.

| Setting                 | Default | Why                                                                                             |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `LLM_DAILY_SPEND_USD`   | $5      | About 50 builds a day at $0.10. Five days of judging use the whole $25.                         |
| `LLM_DAILY_CALL_CAP`    | 600     | A backstop for calls that cannot be priced; the spend cap stops first on normal builds.         |
| `LLM_RATE_PER_MINUTE`   | 20      | One visitor's build makes 6 to 8 calls over about two minutes.                                  |
| `LLM_GLOBAL_PER_MINUTE` | 50      | Under the provider's limit.                                                                     |
| `LLM_MAX_OUTPUT_TOKENS` | 16,000  | Thinking counts as output; one Haiku Database step used 12,000. A cut-off answer costs a retry. |

Both daily caps start again at midnight UTC (5 AM in Pakistan).

### What $25 buys

At the defaults: 150 judge builds cost about $15 (at $0.10 each), leaving about $10 for team runs ($0.08 each), chat
changes and review steps. On Sonnet alone the same 150 builds would cost $28 to $30, more than the whole budget, which
is why the mix is the default.

### When the day's allowance is used up

A build stops at the next model call and the chat says, in the Orchestrator's words: "Today's allowance for live model
calls is used up, so Live builds are paused until midnight UTC. Saved builds, Demo and every app you already built keep
working." A team run says the same. Checked on 26 Nov with `LLM_DAILY_SPEND_USD=0.001`: the Researcher's call went
through, the Database call was refused, and the build ended with that sentence.

## Fixes that came out of the runs

- The test runner ignored a person named by full name in a test case ("omar siddiqui") and used the first person of the
  role instead, so tests about "one doctor must not see another's appointments" failed although the access rules were
  right. It now matches a username, a full name or a first name.
- Backend repairs could only say "let" or "stop", so a rule like "employees see only their own tickets" could not be
  repaired; they can now say "Let the employee see their own tickets", and see what they already tried in the run.
- The Tester was writing cases no access rule can make pass ("a ticket cannot start until it is assigned"); it is now
  told what the app enforces.
- The Database and Backend prompts say when a table needs an owner column and "own" access.
- A test step that expects a refusal now also passes when the workflow refuses a transition from the record's state
  (409), and a 400 there says plainly that the role was allowed and only the empty test values were refused, so the
  repair knows to take the permission away. Found by a clinic build on the live site.

## Re-running the measurement

    LLM_PROVIDER=claude-code npx next dev -p 3107 > /tmp/dev.log 2>&1 &
    TK_URL=http://localhost:3107 TK_LOG=/tmp/dev.log node tests/e2e/live-real.cjs clinic,helpdesk,leave,gym,factcheck,priorart,debate

`TK_TIER=quick` builds on Haiku only, `TK_DUMP=<folder>` saves each built app as JSON. Each line of output has
`usage.apiUsd`, the API cost worked out as above. A full run of the four samples on the default mix costs about $0.40
of API-equivalent tokens.
