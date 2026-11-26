/**
 * The agents the CopilotKit runtime serves at /api/copilotkit, by id. The route reads `resolveAgents` on every
 * request, so an agent can be registered later (by a module that loads lazily) without touching the route.
 *
 *   default  the spike's Architect (a CopilotKit BuiltInAgent)
 *   step     one agent step as a checked graph run (agent-graphs): Live builds run every agent prompt here
 *   team     an app's agent team as a graph run (team-graph)
 *   echo     demo agent, only when LLM_PROVIDER=mock
 */
import type { AbstractAgent } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { litellmModel } from "@/lib/model";
import { NODE_KINDS } from "@/lib/canvas";
import { createEchoAgent, ECHO_AGENT_ID } from "./echo-agent";
import { wrapStepAgent } from "./step-adapter";

export type AgentMap = Record<string, AbstractAgent> & { default: AbstractAgent };

/** The spike's Architect, moved here unchanged. */
export function createArchitect(): AbstractAgent {
  return new BuiltInAgent({
    name: "Architect",
    model: litellmModel(),
    maxSteps: 3,
    prompt: [
      "You are the Architect agent in Turnkey, an app builder.",
      "The user describes an app. Put its building blocks on the shared canvas.",
      `Call the add_canvas_node tool once per block. Allowed kinds: ${NODE_KINDS.join(", ")}.`,
      "Add at most 5 nodes per turn. Keep titles under 6 words.",
      "After the tool calls, reply in one short sentence.",
    ].join("\n"),
  });
}

type Loader = () => Promise<AbstractAgent> | AbstractAgent;

/** Loaders by agent id. Each runs once, on the first request that needs it. */
const loaders = new Map<string, Loader>();
const loaded = new Map<string, AbstractAgent>();

/**
 * Add an agent by id. `step` and `team` call this from their own modules; the loader runs on first use.
 * Registering an id twice replaces the earlier one.
 */
export function registerAgent(id: string, loader: Loader): void {
  loaders.set(id, loader);
  loaded.delete(id);
}

/** Visitor key for the step agent's repair attempts: the route has no request to hand down, so they share one key. */
const STEP_REPAIRS = "agent:step:repair";

/**
 * Agent `step` (src/server/graph/step): the route's limiter has already counted the first model call of the run;
 * each repair attempt is counted here, so a repair loop is held to the same per-minute and daily caps.
 */
export async function createStepAguiAgent(): Promise<AbstractAgent> {
  const [{ createStepAgent }, { limiter, limitsFrom }] = await Promise.all([import("@/server/graph/step"), import("@/server/guard/limits")]);
  const limits = limitsFrom();
  return wrapStepAgent(
    createStepAgent({
      maxTokens: limits.maxOutputTokens,
      admit: (attempt) => {
        if (attempt === 1) return null;
        const v = limiter.take(STEP_REPAIRS, limits);
        return v.ok ? null : { code: v.code === "off" ? "not_configured" : v.code, message: v.message };
      },
    }),
  );
}

registerAgent("default", createArchitect);
registerAgent("step", createStepAguiAgent);
// `team` is registered the same way by team-graph once its factory is merged. See docs/architecture/ag-ui.md.

async function get(id: string): Promise<AbstractAgent | null> {
  const have = loaded.get(id);
  if (have) return have;
  const load = loaders.get(id);
  if (!load) return null;
  try {
    const agent = await load();
    loaded.set(id, agent);
    return agent;
  } catch (error) {
    // One broken agent must not take the others down.
    console.error(`[agui] agent '${id}' failed to load:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Every agent that can run right now. `default` is always present. */
export async function resolveAgents(env: Record<string, string | undefined> = process.env): Promise<AgentMap> {
  const out: Record<string, AbstractAgent> = {};
  for (const id of loaders.keys()) {
    const agent = await get(id);
    if (agent) out[id] = agent;
  }
  if ((env.LLM_PROVIDER ?? "").trim().toLowerCase() === "mock") {
    out[ECHO_AGENT_ID] ??= createEchoAgent();
  }
  if (!out.default) out.default = await Promise.resolve(createArchitect());
  return out as AgentMap;
}

/** Remove an agent by id (tests). */
export function unregisterAgent(id: string): void {
  loaders.delete(id);
  loaded.delete(id);
}
