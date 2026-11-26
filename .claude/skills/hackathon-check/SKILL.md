---
name: hackathon-check
description: Audit the repository against the Agent-A-Thon rules and filter checks and report every gap. Use before a release, before submission, or when asked whether the entry is compliant.
---

Check each item and report PASS or FAIL with the evidence. Do not fix anything in this pass; list what to fix.

1. **No key in the repo.** `npm run check:secrets`. Then `git log -p --all -S'sk-' --oneline | head` and `git ls-files | grep -i '\.env'` (only `.env.example` may appear).
2. **No public secret variables.** `git grep -n "NEXT_PUBLIC_"` must find nothing in source.
3. **Model calls only on the server.** `git grep -n "LITELLM\|OPENAI_API_KEY\|ANTHROPIC_API_KEY" -- src` must match only `src/server` and `src/app/api`. `git grep -n "from '@/server" -- src/platform src/workspace` must find nothing.
4. **Public or made-up data only.** Read the seed data and fixtures that changed since the last audit. No real people, clients or internal company data.
5. **Works with no login and with no model.** `LLM_PROVIDER= npm run build && npm run test:e2e -- demo` passes. The first screen needs no account from an outside service.
6. **Agentic and multi-agent, steps visible.** The workflow canvas shows each agent and its checks; the timeline and the debug drawer list their steps. Name the screens where an evaluator sees them.
7. **Live URL up and matching the repo.** Fetch `<live URL>/api/health`. `commit` must equal the head of `main`.
8. **Safe agent settings.** `.claude/settings.json` has `"defaultMode": "acceptEdits"` and the deny rules for environment files and pushes to `main`.
9. **Individual work, public repo.** The repository is public and owned by the entrant.
10. **Budget.** `/api/health` shows today's model calls. The caps in `src/server/guard/limits.ts` are set, and `LIVE_MODE=off` works.

Write the result to `docs/hackathon/checklist.md` with the date, and open one issue per FAIL.
